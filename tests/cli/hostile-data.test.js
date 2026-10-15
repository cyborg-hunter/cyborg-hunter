// Participant data files are untrusted input: whatever one file holds, the
// report for the rest of the cohort must still be written, and the damage
// must stay with that participant (a warning, a missing plot or replay).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      'BOOM.json': participantFile('BOOM', 2, { charsPerSec: 4 }),
      'B.json': participantFile('B', 2, { charsPerSec: 4 }),
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
      'MANY.json': participantFile('MANY', 900, { charsPerSec: 4 }),
    });
    const log = [];
    const { built, files } = await report(participants, config, { createCanvas: limitedCanvasFactory(log) });
    assert.deepStrictEqual(built.warnings, []);
    assert.ok(files.has('images/trajectories_MANY.png'));
    assert.ok(files.has('images/typing_profile_MANY.png'));
    const sizes = log.filter((e) => e[0] === 'createCanvas');
    assert.ok(sizes.every(([, w, h]) => w <= MAX_SIDE && h <= MAX_SIDE), JSON.stringify(sizes));
    // Each capped plot says how many trials it shows.
    const texts = log.filter((e) => e[0] === 'fillText').map((e) => String(e[1]));
    assert.ok(texts.some((t) => /first 400 of 900 trials/.test(t)), 'the trajectory grid says it is capped');
    assert.ok(texts.some((t) => /first 800 of 900 trials/.test(t)), 'the typing profile says it is capped');
  });
});
