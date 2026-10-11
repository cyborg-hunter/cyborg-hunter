// tests/cli/report-zoom.test.js
// The report's enlarged figure, as rendered markup: a 1:1 control, and a
// fullscreen control the page's script shows only where the document may go
// fullscreen. tests/e2e/report/zoom.spec.js clicks them in three engines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';

async function render() {
  const config = { outputDir: '.', participantIdField: 'participantId' };
  const raw = JSON.parse(readFileSync(new URL('../fixtures/demo/DEMO-FIXT.json', import.meta.url), 'utf8'));
  const p = extractIntegrityData(raw, config);
  const summaries = computeSummary([p], config);
  const triage = rankTriage(summaries, detectEdgeExits([p], config), config);
  return renderIndexHtml(summaries, triage, [p], config, true, {});
}

test('the enlarged figure has a 1:1 control and a fullscreen control that starts hidden', async () => {
  const html = await render();
  const box = html.slice(html.indexOf('<div id="lightbox"'), html.indexOf('<img id="lightbox-img"'));
  assert.match(box, /<button type="button" class="lightbox-zoom" aria-pressed="false"[^>]*>1:1<\/button>/);
  assert.match(box, /<button type="button" class="lightbox-fullscreen" hidden>Fullscreen<\/button>/);
});

test('at 1:1 the figure keeps its own pixel size and scrolls inside the overlay', async () => {
  const html = await render();
  assert.match(html, /\.lightbox-overlay\.actual \{[^}]*overflow: auto;/);
  assert.match(html, /\.lightbox-overlay\.actual img \{[^}]*max-width: none; max-height: none;/);
});
