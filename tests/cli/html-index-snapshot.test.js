// tests/cli/html-index-snapshot.test.js
// Full-output snapshot of renderIndexHtml with ALL opts absent. This is the
// contract every later opt (imageSources and its in-page hash guard,
// replayShownExternally, ...) must not disturb: defaults absent ⇒ output
// identical to this file.
// Regenerate ONLY when a deliberate default-output change is intended:
//   SNAPSHOT_UPDATE=1 node --test tests/cli/html-index-snapshot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { analyzeCursor } from '../../src/cli/analyzers/cursor.js';
import { analyzeDeviceMasking } from '../../src/cli/analyzers/device-masking.js';
import { analyzeTyping } from '../../src/cli/analyzers/typing.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXT = join(here, '..', 'fixtures', 'demo', 'DEMO-FIXT.json');

function build() {
  const raw = JSON.parse(readFileSync(FIXT, 'utf8'));
  const config = { outputDir: '.', participantIdField: 'participantId' };
  const p = extractIntegrityData(raw, config);
  const summaries = computeSummary([p], config);
  // As report-core.js does: the cursor section and device masking ride on the summary.
  summaries[0].cursorAnalysis = analyzeCursor([p])[0];
  summaries[0].deviceMasking = analyzeDeviceMasking(p);
  // And the typing section, as report-core.js attaches it.
  summaries[0].typingAnalysis = analyzeTyping(p, config);
  const edgeExits = detectEdgeExits([p], config);
  const triage = rankTriage(summaries, edgeExits, config);
  return { summaries, triage, participants: [p], config };
}

function snapshotCase(name, file, visualsRendered) {
  test(name, async () => {
    const { summaries, triage, participants, config } = build();
    const html = await renderIndexHtml(summaries, triage, participants, config, visualsRendered, {});
    const SNAP = join(here, '..', 'fixtures', 'cli', file);
    if (process.env.SNAPSHOT_UPDATE === '1' || !existsSync(SNAP)) { writeFileSync(SNAP, html); return; }
    assert.equal(html, readFileSync(SNAP, 'utf8'));
  });
}
snapshotCase('renderIndexHtml default output (visuals off) is snapshot-identical', 'index-default.snapshot.html', false);
snapshotCase('renderIndexHtml default output (visuals on) is snapshot-identical', 'index-default-visuals.snapshot.html', true);

test('the detail pane has one column width, the session timeline charts\' own', async () => {
  const { summaries, triage, participants, config } = build();
  const html = await renderIndexHtml(summaries, triage, participants, config, true, {});
  assert.ok(html.includes('.detail .participant > :not(.replay-block),'), 'only the replay is exempt from the column');
  assert.ok(html.includes('.detail .replay-block > :not(.replay-mount) { max-width: 1000px; }'));
  // The enlarged mouse plot has its own 800px limit; nothing else may.
  assert.ok(!html.replace(/\.tl-plot-frame \{[^}]*\}/, '').includes('max-width: 800px'), 'no section keeps the old column');
  assert.ok(!/\.tl-block \{ max-width/.test(html), 'the timeline block has no width of its own');
  assert.ok(html.includes('minmax(max(110px, calc((100% - 30px) / 6)), 1fr)'), 'the signal grid stops at six columns');
});
