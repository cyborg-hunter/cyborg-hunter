// The two page-facing opts: the report tells its host which participant was
// selected, and the viewer stops offering a network fetch the host forbids.
// Both absent ⇒ output byte-identical (the snapshot test is the gate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';

const raw = JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT.json', 'utf8'));
const config = { outputDir: '.', participantIdField: 'participantId' };
const p = extractIntegrityData(raw, config);
const summaries = computeSummary([p], config);
const triage = rankTriage(summaries, detectEdgeExits([p], config), config);

test('selectionPostMessage emits a guarded postMessage inside selectById', async () => {
  const html = await renderIndexHtml(summaries, triage, [p], config, false, { selectionPostMessage: true });
  const i = html.indexOf('function selectById');
  const body = html.slice(i, html.indexOf('function openLegend', i));
  assert.match(body, /window\.parent\.postMessage\(\{ type: 'cyborg-hunter:select', participantId: pid \}, '\*'\)/);
  assert.match(body, /try \{ window\.parent\.postMessage\(.*\); \} catch \(e\) \{/);
});

test('without the opt no postMessage is emitted', async () => {
  const html = await renderIndexHtml(summaries, triage, [p], config, false, {});
  assert.equal(html.includes('cyborg-hunter:select'), false);
});

test('the viewer client honours opts.noExternalCss', () => {
  const src = readFileSync('src/cli/renderers/replay-viewer.client.js', 'utf8');
  assert.match(src, /opts && opts\.noExternalCss/);
  assert.match(src, /cannot be fetched under this page/);
});

test('preview-entry re-exports the page-facing cores', async () => {
  const entry = await import('../../src/cli/preview-entry.js');
  for (const name of ['ingestFiles', 'buildReport', 'renderInPageHtml', 'mergeConfig', 'buildAssetMap', 'applyAssetMap', 'assetMatchSummary', 'assetNoteText']) {
    assert.equal(typeof entry[name], 'function', name);
  }
});
