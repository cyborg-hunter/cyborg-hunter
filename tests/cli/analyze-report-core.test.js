// buildReport writes every CLI output through a sink, in the CLI's order, and
// renderInPageHtml turns the same PNG bytes into data URIs for the browser.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingest } from '../../src/cli/ingest.js';
import { buildReport, renderInPageHtml, REPORT_FILES } from '../../src/cli/report-core.js';
import { buildSummaryCsv } from '../../src/cli/renderers/summary-csv-core.js';
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

// A participant id that is a number (a CSV's dynamic typing, a study that
// stores one) reached the plot file names as a number and stopped the whole
// report at the image step. Every input shape keys it by its string.
describe('numeric participant ids', () => {
  let d;
  const integrity = (pid) => ({
    trialId: 't1', participantId: pid, libraryVersion: '0.6.0', startTime: 1000, duration_ms: 5000, trialStart_perfNow: 1000,
    pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0, trialSignals: {}
  });
  const row = (pid) => ({ sender: 'a', participantId: pid, integrity: integrity(pid) });
  const config = (over) => ({ dataDir: d, filePattern: '*.json', participantIdField: 'participantId', integrityField: 'integrity', ...over });
  before(() => {
    d = mkdtempSync(join(tmpdir(), 'ch-numeric-ids-'));
    writeFileSync(join(d, 'shape1.json'), JSON.stringify({ participantId: 41, trials: [{ trialId: 't1', integrity: integrity(41) }] }));
    writeFileSync(join(d, 'zero.json'), JSON.stringify({ participantId: 0, trials: [{ trialId: 't1', integrity: integrity(0) }] }));
    writeFileSync(join(d, 'rows.csv'), 'participantId,integrity\n42,"' + JSON.stringify(integrity(42)).replace(/"/g, '""') + '"\n');
    writeFileSync(join(d, 'array.json'), JSON.stringify([row(43)]));
    writeFileSync(join(d, 'transmit.json'), JSON.stringify({ metadata: { slice: 0, id: 'up-1', payload: 'full' }, url: 'https://x/', data: [row(44)] }));
  });
  after(() => rmSync(d, { recursive: true, force: true }));

  it('every shape is keyed by the id\'s string, and the report draws every plot', async () => {
    const { participants } = await ingest(config());
    assert.deepStrictEqual(participants.map((p) => p.participantId).sort(), ['0', '41', '42', '43', '44']);
    const m = memorySink();
    await buildReport(participants, cfg(config()),
      { sink: m.sink, createCanvas: makeRecordingCanvasFactory([]), encodePng: pngStub, replayClientSrc: '', fontFaceCss: '' });
    assert.ok(m.files.has('images/trajectories_42.png'), [...m.files.keys()].join(', '));
    assert.ok(m.files.has('images/session_timeline_0.png'), [...m.files.keys()].join(', '));
  });

  it('--participant 42 finds the participant whose CSV holds the number 42', async () => {
    const { participants } = await ingest(config({ singleParticipant: '42' }));
    assert.deepStrictEqual(participants.map((p) => p.participantId), ['42']);
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
    assert.ok(html.includes('cyborg-hunter:select'));
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

  it('treats a missing file config as empty', () => {
    assert.deepStrictEqual(mergeConfig(undefined), mergeConfig({}));
    assert.deepStrictEqual(mergeConfig(undefined).warnings, []);
  });

  // Valid JSON that is not an object (null, a list, a string, a number)
  // configures nothing: say so rather than run on the defaults silently.
  it('ignores a file config that is not an object, with a warning', () => {
    for (const [value, kind] of [[null, 'null'], [[{ dataDir: 'x' }], 'an array'], ['x', 'a string'], [3, 'a number']]) {
      const { config, warnings } = mergeConfig(value);
      assert.deepStrictEqual(config, mergeConfig({}).config);
      assert.deepStrictEqual(warnings, ['the config file holds ' + kind + ', not a JSON object; its settings are ignored']);
    }
  });

  it('knows the assetsDir key', () => {
    assert.deepStrictEqual(mergeConfig({ assetsDir: './styles' }).warnings, []);
  });
});
