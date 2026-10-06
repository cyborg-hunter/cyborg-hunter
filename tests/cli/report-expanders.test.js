// tests/cli/report-expanders.test.js
// The report's expand controls, as rendered markup: the paste-evidence toggle
// and the session-signal cells. tests/e2e/report/expanders.spec.js clicks
// them in three engines. The participant (tests/fixtures/cli/expanders-participant.json)
// has one long paste, five sidebar openings logged as eleven open/close
// entries (the first one detected twice), and six keyboard shortcuts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';

const FIXTURE = new URL('../fixtures/cli/expanders-participant.json', import.meta.url);

async function render() {
  const config = { outputDir: '.', participantIdField: 'participantId' };
  const p = extractIntegrityData(JSON.parse(readFileSync(FIXTURE, 'utf8')), config);
  const summaries = computeSummary([p], config);
  const triage = rankTriage(summaries, detectEdgeExits([p], config), config);
  return renderIndexHtml(summaries, triage, [p], config, false, {});
}

describe('paste evidence', () => {
  it('a long paste\'s full text carries no hidden attribute: the stylesheet hides it until the entry is expanded', async () => {
    const html = await render();
    const full = html.match(/<span class="paste-full mono"[^>]*>/g);
    assert.equal(full.length, 1, 'one long paste');
    // [hidden] is display:none !important in the report's stylesheet, so a
    // hidden attribute outranks the .expanded rule and the toggle shows nothing.
    assert.equal(full[0], '<span class="paste-full mono">');
    assert.match(html, /\.paste-entry:not\(\.expanded\) \.paste-full \{ display: none; \}/);
  });
});

// One session-signal cell's markup, from its title to the next cell (or to
// the end of the grid).
function cellOf(html, title) {
  const start = html.indexOf('<div class="sig-cell-title">' + title + '</div>');
  assert.ok(start >= 0, 'a "' + title + '" cell');
  const next = html.indexOf('<div class="sig-cell">', start);
  return html.slice(start, next >= 0 ? next : html.indexOf('</div></div>', start));
}
const items = (markup) => [...markup.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);

describe('session-signal cells', () => {
  it('a cell lists its first three items and keeps the rest in a details element whose summary counts them', async () => {
    const cell = cellOf(await render(), 'Kb shortcuts');
    const open = cell.slice(0, cell.indexOf('<details'));
    const more = cell.slice(cell.indexOf('<details'));
    assert.deepEqual(items(open), ['Ctrl+C', 'Ctrl+V', 'Ctrl+Tab']);
    assert.match(more, /^<details class="sig-more"><summary class="muted">… \+3 more<\/summary>/);
    assert.deepEqual(items(more), ['Alt+Tab', 'Ctrl+F', 'Ctrl+T']);
  });

  it('no cell ends in an inert "more" line', async () => {
    assert.doesNotMatch(await render(), /<li class="muted">… \+\d+ more<\/li>/);
  });
});
