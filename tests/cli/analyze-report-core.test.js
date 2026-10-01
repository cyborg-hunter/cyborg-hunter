// buildReport writes every CLI output through a sink, in the CLI's order, and
// renderInPageHtml turns the same PNG bytes into data URIs for the browser.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { ingest } from '../../src/cli/ingest.js';
import { buildReport, renderInPageHtml, REPORT_FILES } from '../../src/cli/report-core.js';
import { buildSummaryCsv } from '../../src/cli/renderers/summary-csv.js';
import { makeRecordingCanvasFactory } from './recording-canvas.js';
import { mergeConfig } from '../../src/cli/config-core.js';

function memorySink() {
  const files = new Map();
  const order = [];
  return { files, order, sink: (path, data) => { files.set(path, data); order.push(path); } };
}
const CLI = { dataDir: 'tests/cli/fixtures', filePattern: '*_participant.json', participantIdField: 'participantId', integrityField: 'integrity' };
const DEMO = { dataDir: 'tests/fixtures/demo', filePattern: 'DEMO-*.json', participantIdField: 'participantId', integrityField: 'integrity' };
const cfg = (over) => mergeConfig(over).config;
const pngStub = async () => new Uint8Array([1, 2, 3]);

describe('buildReport', () => {
  it('sinks the text files in CLI order and reports the triage order', async () => {
    const { participants } = await ingest(CLI);
    const m = memorySink();
    const built = await buildReport(participants, cfg(CLI), { sink: m.sink, replayClientSrc: '', fontFaceCss: '' });
    assert.deepStrictEqual(m.order, REPORT_FILES);
    assert.strictEqual(m.files.get('summary.csv'), buildSummaryCsv(built.summaries, built.triage));
    assert.deepStrictEqual(built.triageOrder, built.triage.map((t) => t.participantId));
    assert.strictEqual(built.visualsRendered, false);
    assert.deepStrictEqual(built.warnings, []);
    assert.ok(/<title>/.test(m.files.get('index.html')));
  });

  it('draws the three plots per participant through the injected canvas and keeps the bytes on request', async () => {
    const { participants } = await ingest(CLI);
    const m = memorySink();
    const log = [];
    const built = await buildReport(participants, cfg(CLI),
      { sink: m.sink, createCanvas: makeRecordingCanvasFactory(log), encodePng: pngStub, keepImages: true, replayClientSrc: '', fontFaceCss: '' });
    assert.strictEqual(built.visualsRendered, true);
    const pngs = m.order.filter((p) => p.startsWith('images/'));
    assert.ok(pngs.length >= 3, 'at least one plot per kind');
    assert.ok(pngs.every((p) => /^images\/(trajectories|session_timeline|typing_profile)_[^/]+\.png$/.test(p)));
    const pid = participants[0].participantId;
    assert.deepStrictEqual([...built.images[pid].trajectories], [1, 2, 3]);
    // images/ come after the text files and before index.html, as the CLI writes them.
    assert.ok(m.order.indexOf(pngs[0]) > m.order.indexOf('extensions.csv'));
    assert.strictEqual(m.order[m.order.length - 1], 'index.html');
  });

  it('honours noVisuals even when a canvas is available', async () => {
    const { participants } = await ingest(CLI);
    const m = memorySink();
    const built = await buildReport(participants, cfg({ ...CLI, noVisuals: true }),
      { sink: m.sink, createCanvas: makeRecordingCanvasFactory([]), encodePng: pngStub, replayClientSrc: '', fontFaceCss: '' });
    assert.strictEqual(built.visualsRendered, false);
    assert.ok(!m.order.some((p) => p.startsWith('images/')));
  });

  it('warns once about a phase name that matches no trial', async () => {
    const { participants } = await ingest(CLI);
    const warned = [];
    const built = await buildReport(participants, cfg({ ...CLI, phaseScope: { include: ['clasification'] } }),
      { sink: () => {}, warn: (l) => warned.push(l), replayClientSrc: '', fontFaceCss: '' });
    assert.strictEqual(warned.length, 1);
    assert.match(warned[0], /phaseScope names match NO trial.*clasification/);
    assert.deepStrictEqual(built.warnings, warned);
  });

  it('sinks replay assets and the index references them', async () => {
    const { participants } = await ingest(DEMO);
    const m = memorySink();
    const built = await buildReport(participants, cfg(DEMO), { sink: m.sink, replayClientSrc: 'window.initChReplayViewer=function(){}', fontFaceCss: '' });
    assert.strictEqual(built.replayAssets.count, 1);
    assert.ok(m.files.has('replay/DEMO-FIXT.replay.js'));
    assert.ok(m.files.get('index.html').includes('data-replay-src="replay/DEMO-FIXT.replay.js"'));
    assert.ok(m.order.indexOf('replay/DEMO-FIXT.replay.js') < m.order.indexOf('index.html'));
  });
});

describe('renderInPageHtml', () => {
  it('embeds the same PNG bytes as data URIs and shows no replay section', async () => {
    const { participants } = await ingest(DEMO);
    const m = memorySink();
    const built = await buildReport(participants, cfg(DEMO),
      { sink: m.sink, createCanvas: makeRecordingCanvasFactory([]), encodePng: pngStub, keepImages: true, replayClientSrc: 'x', fontFaceCss: '' });
    const html = await renderInPageHtml(built, participants, cfg(DEMO), { replayClientSrc: 'x', fontFaceCss: '@font-face{}' });
    assert.ok(html.includes('data:image/png;base64,AQID'), 'bytes [1,2,3] → AQID');
    // The page's script always names .replay-block; the section itself must be absent.
    assert.ok(!html.includes('class="image-block replay-block"'), 'replay is shown outside the report');
    assert.ok(!html.includes('data-replay-src'));
    assert.ok(html.includes('@font-face{}'));
    assert.ok(!html.includes('images/trajectories_'), 'no file paths in the in-page report');
  });
});

describe('mergeConfig', () => {
  it('lays the file config over the defaults and returns the warnings loadConfig prints', () => {
    const { config, warnings } = mergeConfig({ filePattern: '*.csv', fliePattern: 'x', scoring: { softScoreThreshold: 'high' } });
    assert.strictEqual(config.filePattern, '*.csv');
    assert.strictEqual(config.assetsDir, null);
    assert.strictEqual(warnings.length, 2);
    assert.match(warnings[0], /fliePattern/);
    assert.match(warnings[1], /softScoreThreshold is not a number/);
  });

  it('treats a missing or non-object file config as empty', () => {
    assert.deepStrictEqual(mergeConfig(null), mergeConfig({}));
    assert.deepStrictEqual(mergeConfig(undefined).warnings, []);
  });

  it('knows the assetsDir key', () => {
    assert.deepStrictEqual(mergeConfig({ assetsDir: './styles' }).warnings, []);
  });
});
