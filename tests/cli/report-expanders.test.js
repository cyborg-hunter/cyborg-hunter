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
