// Participant data files are untrusted input: whatever one file holds, the
// report for the rest of the cohort must still be written, and the damage
// must stay with that participant (a warning, a missing plot or replay).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { ingest } from '../../src/cli/ingest.js';
import { buildReport } from '../../src/cli/report-core.js';
import { mergeConfig } from '../../src/cli/config-core.js';
import { makeRecordingCanvasFactory } from './recording-canvas.js';

function memorySink() {
  const files = new Map();
  return { files, sink: (path, data) => { files.set(path, data); } };
}
const pngStub = async () => new Uint8Array([1, 2, 3]);

function integrity(pid, trialId, extra = {}) {
  return {
    trialId, participantId: pid, libraryVersion: '0.15.0',
    startTime: 1000, duration_ms: 5000, trialStart_perfNow: 1000,
    pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [],
    mouseEvents: [{ t: 0, x: 10, y: 10 }, { t: 50, x: 100, y: 120 }],
    editTimestamps: [1100, 1200],
    trialSoftScore: 0, trialSignals: {},
    ...extra,
  };
}
// A Shape-1 participant file with n trials.
function participantFile(pid, n = 2, trialExtra = {}, extra = {}) {
  const trials = [];
  for (let i = 0; i < n; i++) trials.push({ trialId: 't' + i, integrity: integrity(pid, 't' + i, trialExtra) });
  return { participantId: pid, trials, metadata: { startTime: '2026-01-01T00:00:00.000Z' }, ...extra };
}

// Trial fields that give a trial a bar on the typing chart: a saved rate and
// no saved edit times (keystroke dynamics off), so the typing analysis keeps
// the saved rate. (integrity()'s two edit times would be recomputed, and two
// edits are too few to judge a rate.)
const TYPED = { charsPerSec: 4, editTimestamps: [] };

// Ingests `files` ({ name: object | string }) from a fresh directory.
async function ingestFilesOf(files, over = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ch-hostile-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(d, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    const config = mergeConfig({ dataDir: d, filePattern: '*.{json,csv}', participantIdField: 'participantId', integrityField: 'integrity', ...over }).config;
    return { ...(await ingest(config)), config };
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

async function report(participants, config, deps = {}) {
  const m = memorySink();
  const built = await buildReport(participants, config, {
    sink: m.sink, createCanvas: makeRecordingCanvasFactory([]), encodePng: pngStub,
    replayClientSrc: '', fontFaceCss: '', ...deps,
  });
  return { built, files: m.files };
}

describe('an entry that is not an object in a signal array', () => {
  it('is skipped with a warning, and the report is written', async () => {
    const { participants, warnings, config } = await ingestFilesOf({
      'A.json': participantFile('A', 2, {
        pasteEvents: [null], copyEvents: [null], syntheticInsertions: [null],
        mouseEvents: [null, { t: 0, x: 1, y: 1 }], extensionsDetected: [null, 'Some AI'],
      }, { metadata: { integritySession: { aiExtensionsFound: [null], windowPositions: [null], tabAwaySums: [1, 2] } } }),
      'B.json': participantFile('B'),
    });
    const a = participants.find((p) => p.participantId === 'A');
    assert.deepStrictEqual(a.trials[0].pasteEvents, []);
    assert.deepStrictEqual(a.trials[0].mouseEvents, [{ t: 0, x: 1, y: 1 }]);
    assert.deepStrictEqual(a.trials[0].extensionsDetected, ['Some AI'], 'a name given as a string is kept');
    assert.deepStrictEqual(a.trials[0].editTimestamps, [1100, 1200], 'a list of numbers is left alone');
    assert.ok(warnings.some((w) => /pasteEvents/.test(String(w.warnings)) && /skipped/.test(String(w.warnings))));
    const { files } = await report(participants, config);
    assert.ok(files.has('index.html'));
    assert.ok(files.has('event-log.csv'));
  });
});

// node-canvas refuses a side longer than 32767 pixels, and so do browsers.
const MAX_SIDE = 32767;
function limitedCanvasFactory(log) {
  const make = makeRecordingCanvasFactory(log);
  return (w, h) => {
    if (w > MAX_SIDE) throw new Error('Canvas width cannot exceed ' + MAX_SIDE);
    if (h > MAX_SIDE) throw new Error('Canvas height cannot exceed ' + MAX_SIDE);
    return make(w, h);
  };
}

describe('the plots of one participant', () => {
  it('a plot that fails for one participant is a warning naming them; the report and the others\' plots are written', async () => {
    const { participants, config } = await ingestFilesOf({
      'BOOM.json': participantFile('BOOM', 2, TYPED),
      'B.json': participantFile('B', 2, TYPED),
    });
    // A canvas whose text drawing fails whenever it names BOOM.
    const make = makeRecordingCanvasFactory([]);
    const createCanvas = (w, h) => {
      const c = make(w, h);
      const ctx = c.getContext();
      const failing = new Proxy(ctx, { get: (t, k) => (k === 'fillText'
        ? (s, ...rest) => { if (String(s).includes('BOOM')) throw new Error('cannot draw'); return t.fillText(s, ...rest); }
        : t[k]) });
      return { ...c, getContext: () => failing };
    };
    const { built, files } = await report(participants, config, { createCanvas });
    assert.ok(files.has('index.html'));
    for (const kind of ['trajectories', 'typing_profile']) {
      assert.ok(files.has(`images/${kind}_B.png`), kind + ' for B');
      assert.ok(!files.has(`images/${kind}_BOOM.png`), kind + ' for BOOM');
      const label = kind === 'trajectories' ? 'trajectories' : 'typing profile';
      assert.ok(built.warnings.some((w) => w.includes(label) && w.includes('BOOM') && w.includes('cannot draw')),
        `a warning names BOOM for ${label}: ${built.warnings.join(' / ')}`);
    }
  });

  it('a participant with many trials still gets plots, each canvas within the size browsers and node-canvas allow', async () => {
    const { participants, config } = await ingestFilesOf({
      'MANY.json': participantFile('MANY', 900, TYPED),
    });
    const log = [];
    const { built, files } = await report(participants, config, { createCanvas: limitedCanvasFactory(log) });
    assert.deepStrictEqual(built.warnings, []);
    assert.ok(files.has('images/trajectories_MANY.png'));
    assert.ok(files.has('images/typing_profile_MANY.png'));
    const sizes = log.filter((e) => e[0] === 'createCanvas');
    assert.ok(sizes.every(([, w, h]) => w <= MAX_SIDE && h <= MAX_SIDE), JSON.stringify(sizes));
    // The trajectory grid says how many trials it shows. The typing profile
    // needs no cap: these trials carry start times, so it is drawn on the
    // session time axis, as wide as the timeline whatever the trial count.
    const texts = log.filter((e) => e[0] === 'fillText').map((e) => String(e[1]));
    assert.ok(texts.some((t) => /first 400 of 900 trials/.test(t)), 'the trajectory grid says it is capped');
    assert.ok(texts.includes('Typing Speed Profile — MANY'), 'the typing profile, on the time axis and uncapped');
    assert.ok(sizes.filter(([, w]) => w === 1000).length >= 2, 'the timeline and the typing profile, 1000 px wide');
  });
});

describe('a recording whose page nests elements very deeply', () => {
  it('costs that participant their replay, with the reason; the report is written for everyone', async () => {
    const fixture = (name) => readFileSync(join('tests/fixtures/demo', name), 'utf8');
    const rec = JSON.parse(fixture('DEMO-FIXT-replay-1785352263344.json'));
    const keyframe = rec.segments.find((s) => s.initial_dom);
    // Small on the wire, but deeper than JSON.stringify can follow. The text
    // is built by hand: the test's own JSON.stringify of it overflowed the
    // stack on the Node CI runs (20), which is the failure under test.
    const DEPTH = 30000;
    const open = [], close = [];
    for (let i = DEPTH; i >= 1; i--) {
      open.push('{"id":' + (700000 + i) + ',"kind":"element","tag":"div","attrs":{},"children":[');
      close.push(']}');
    }
    const deepJson = open.join('') + '{"id":700000,"kind":"element","tag":"div","attrs":{},"children":[]}' + close.join('');
    keyframe.initial_dom.children.push({ deepMarker: true });
    const recJson = JSON.stringify(rec).replace('{"deepMarker":true}', deepJson);
    const other = JSON.parse(fixture('DEMO-FIXT-replay-1785352263344.json'));
    other.participant_id = 'OTHER';
    const { participants, config } = await ingestFilesOf({
      'DEMO-FIXT.json': fixture('DEMO-FIXT.json'),
      'DEMO-FIXT-replay-1785352263344.json': recJson,
      'OTHER.json': fixture('DEMO-FIXT.json').replaceAll('DEMO-FIXT', 'OTHER'),
      'OTHER-replay-1785352263344.json': JSON.stringify(other),
    });
    const { built, files } = await report(participants, config, { createCanvas: null });
    assert.ok(files.has('index.html'));
    assert.ok(files.has('replay/OTHER.replay.js'), 'the other participant keeps their replay');
    assert.ok(!files.has('replay/DEMO-FIXT.replay.js'));
    // The report shows the pass's copy (built.participants); the participant
    // the report was given keeps its recording.
    const deep = built.participants.find((p) => p.participantId === 'DEMO-FIXT');
    assert.strictEqual(deep.replay.error, 'unloadable');
    assert.match(deep.replay.reason, /could not be written/);
    assert.ok(participants.find((p) => p.participantId === 'DEMO-FIXT').replay.recording);
    assert.ok(built.replayAssets.skipped.some((s) => s.participantId === 'DEMO-FIXT'));
    assert.ok(built.warnings.some((w) => w.includes('DEMO-FIXT') && w.includes('could not be written')), built.warnings.join(' / '));
  });
});

describe('file names made from participant ids', () => {
  const fixture = (name) => readFileSync(join('tests/fixtures/demo', name), 'utf8');
  // A participant with the demo fixture's data and recording under `pid`.
  const withReplay = (pid) => {
    const rec = JSON.parse(fixture('DEMO-FIXT-replay-1785352263344.json'));
    rec.participant_id = pid;
    return {
      ['p' + Math.abs(hash(pid)) + '.json']: fixture('DEMO-FIXT.json').replaceAll('"DEMO-FIXT"', JSON.stringify(pid)),
      ['rec-' + Math.abs(hash(pid)) + '.json']: JSON.stringify(rec),
    };
  };
  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

  it('a very long id still gets its replay file, under a name the file system accepts', async () => {
    const long1 = 'L'.repeat(300) + '1';
    const long2 = 'L'.repeat(300) + '2';
    const { participants, config } = await ingestFilesOf({ ...withReplay(long1), ...withReplay(long2) });
    assert.strictEqual(participants.filter((p) => p.replay && p.replay.recording).length, 2);
    const out = mkdtempSync(join(tmpdir(), 'ch-hostile-out-'));
    try {
      const sink = (path, data) => {
        mkdirSync(dirname(join(out, path)), { recursive: true });
        writeFileSync(join(out, path), data);
      };
      await buildReport(participants, config, { sink, replayClientSrc: '', fontFaceCss: '' });
      const names = readdirSync(join(out, 'replay'));
      assert.strictEqual(names.length, 2);
      assert.ok(names.every((n) => n.length < 100), names.join(', '));
      assert.deepStrictEqual(participants.map((p) => p.replay.assetPath).sort(), names.map((n) => 'replay/' + n).sort());
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('ids that differ only in case get plot files that differ in more than case, and each pane shows its own', async () => {
    const { participants, config } = await ingestFilesOf({
      'lower.json': participantFile('abc', 2, { charsPerSec: 4 }),
      'upper.json': participantFile('ABC', 2, { charsPerSec: 5 }),
      'other.json': participantFile('Xyz', 2, { charsPerSec: 5 }),
    });
    const { files } = await report(participants, config);
    const images = [...files.keys()].filter((f) => f.startsWith('images/'));
    // One file per participant and plot on a file system that ignores case.
    assert.strictEqual(new Set(images.map((f) => f.toLowerCase())).size, images.length, images.join(', '));
    assert.ok(files.has('images/trajectories_Xyz.png'), 'an id that meets no other keeps its name');
    const html = files.get('index.html');
    assert.strictEqual(images.filter((f) => f.startsWith('images/trajectories_')).length, 3);
    const srcs = ['abc', 'ABC'].map((pid) => {
      const from = html.indexOf(`id="p-${pid}"`);
      const next = html.indexOf('id="p-', from + 1);
      const pane = html.slice(from, next === -1 ? undefined : next);
      const src = pane.match(/src="(images\/trajectories_[^"]+)"/)[1];
      assert.ok(files.has(src), src);
      return src;
    });
    assert.notStrictEqual(srcs[0].toLowerCase(), srcs[1].toLowerCase(), 'the two panes show two files');
  });
});
