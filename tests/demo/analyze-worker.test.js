// The analyze worker's message protocol, run in node on the very source the
// page bundle embeds (tools/build-analyze.mjs builds it). `self` is a stand-in
// whose postMessage puts every message through structuredClone with its
// transfer list, as a real worker boundary does: a message that cannot cross
// fails here, and a transferred buffer is detached on the worker's side.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { File } from 'node:buffer';
import { createRequire } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';
import { buildWorkerSrc } from '../../tools/build-analyze.mjs';
import { REPORT_FILES } from '../../src/cli/report-core.js';
import { TESTED_PARTICIPANTS, TESTED_FIXTURE } from '../../demo/analyze/limits.js';
import { NODE_IMPORT } from '../cli/node-import-pattern.js';

if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;

let workerSrc;
before(async () => { workerSrc = await buildWorkerSrc(); });

function startWorker() {
  const messages = [];
  const waiting = [];
  const self = {
    postMessage(msg, transfer) {
      const copy = structuredClone(msg, { transfer: transfer || [] });
      messages.push(copy);
      for (const w of waiting.slice()) {
        if (w.types.includes(copy.type)) { waiting.splice(waiting.indexOf(w), 1); w.resolve(copy); }
      }
    },
  };
  new Function('self', workerSrc)(self);
  return {
    messages,
    send(msg) { messages.length = 0; self.onmessage({ data: msg }); },
    // Resolves on the first message of one of `types` posted from now on
    // (or already posted since the last send).
    next(...types) {
      const seen = messages.find((m) => types.includes(m.type));
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve) => waiting.push({ types, resolve }));
    },
  };
}

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const fileEntry = (dir, name, path) => ({ path: path || name, file: new File([readFileSync(dir + '/' + name)], name) });

test('announces itself with the baked assets and the tested cohort size', () => {
  const w = startWorker();
  const ready = w.messages.find((m) => m.type === 'ready');
  assert.ok(ready, 'ready is posted on boot');
  assert.match(ready.assets.replayClientSrc, /initChReplayViewer/);
  assert.match(ready.assets.fontFaceCss, /@font-face/);
  assert.ok(ready.assets.replayCss.length > 0);
  assert.deepEqual(ready.limits, { testedParticipants: TESTED_PARTICIPANTS, testedFixture: TESTED_FIXTURE });
});

test('the worker source reaches no network and no Node API', () => {
  // The page bundle carries this source as an escaped string, where the
  // bundle test's patterns cannot see it; the source itself is checked here.
  assert.equal(workerSrc.includes('registry.npmjs.org'), false, 'update check is unreachable');
  assert.doesNotMatch(workerSrc, NODE_IMPORT);
});

test('check on the sample finds three participant files and the id field its config names', async () => {
  const w = startWorker();
  w.send({ type: 'check', sample: true });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  assert.deepEqual(checked.counts, { participant: 3, replay: 0, assets: 0, ignored: 0 });
  assert.equal(checked.configFound, true);
  assert.equal(checked.config.participantIdField, 'subject_ID');
  assert.deepEqual(checked.configWarnings, []);
  assert.equal(checked.idSuggestion.suggested, 'subject_ID');
  assert.equal(checked.sampled, 3);
});

test('run on the sample streams a zip of the full report and returns the in-page report', async () => {
  const w = startWorker();
  w.send({ type: 'check', sample: true });
  const checked = await w.next('checked');
  w.send({ type: 'run', sample: true, config: checked.config, participantIdField: 'subject_ID' });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  const zip = concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk));
  assert.equal(done.zipBytes, zip.length);
  const files = unzipSync(zip);
  for (const f of REPORT_FILES) assert.ok(files[f], f + ' is in the zip');
  for (const f of ['summary.csv', 'triage.md', 'event-log.csv']) assert.equal(done.files[f], strFromU8(files[f]), f);
  assert.deepEqual(done.participants.map((p) => p.participantId).sort(), ['SYN-CLEAN-01', 'SYN-HARD-03', 'SYN-SOFT-02']);
  assert.deepEqual(done.triageOrder.slice().sort(), ['SYN-CLEAN-01', 'SYN-HARD-03', 'SYN-SOFT-02']);
  assert.equal(done.configUsed.participantIdField, 'subject_ID');
  assert.match(done.html, /SYN-HARD-03/);
  const phases = new Set(w.messages.filter((m) => m.type === 'progress').map((m) => m.phase));
  assert.ok(phases.has('ingest') && phases.has('report'), [...phases].join(','));
});

test('a run with a recording serves the same styled replay model the zip carries', async () => {
  // The fixture's recording plus one external stylesheet the dropped folder
  // supplies, with an image of its own: the matcher, the note and the
  // rewrite all run, on the zip pass and again on each replay request.
  const dir = 'tests/fixtures/demo';
  const recName = readdirSync(dir).find((f) => /-replay-\d+\.json$/.test(f));
  const rec = JSON.parse(readFileSync(dir + '/' + recName, 'utf8'));
  rec.stylesheets.push({ id: 999, kind: 'link', href: 'https://exp.example.org/study/css/style.css', css: null, media: null });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const files = [
    fileEntry(dir, 'DEMO-FIXT.json', 'study/data/DEMO-FIXT.json'),
    fileEntry(dir, 'cyborg-hunter.config.json', 'study/cyborg-hunter.config.json'),
    { path: 'study/data/' + recName, file: new File([JSON.stringify(rec)], recName) },
    { path: 'study/css/style.css', file: new File(['.stim{background:url("../img/bg.png")}'], 'style.css') },
    { path: 'study/img/bg.png', file: new File([png], 'bg.png') },
  ];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  assert.deepEqual(checked.counts, { participant: 2, replay: 2, assets: 2, ignored: 0 }, 'JSON files are both participant and replay candidates');
  assert.equal(checked.idSuggestion.suggested, 'participantId');
  w.send({ type: 'run', files, config: checked.config, participantIdField: checked.idSuggestion.suggested });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  assert.deepEqual(done.participants.map((p) => [p.participantId, p.hasReplay]), [['DEMO-FIXT', true]]);
  assert.match(done.participants[0].assetNote, /1 of 1 stylesheets matched/);
  assert.match(done.participants[0].assetNote, /1 of 1 images matched/);
  assert.deepEqual(done.assetReport.matched.map((m) => m.path).sort(), ['study/css/style.css', 'study/img/bg.png']);
  const zipped = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  const script = strFromU8(zipped['replay/DEMO-FIXT.replay.js']);
  const fromZip = JSON.parse(script.slice(script.indexOf('] = ') + 4).replace(/;\s*$/, ''));
  const styled = fromZip.stylesheets.find((x) => x.href === 'https://exp.example.org/study/css/style.css');
  assert.ok(styled.css.includes('data:image/png;base64,' + Buffer.from(png).toString('base64')), styled.css);
  w.send({ type: 'replay', participantId: 'DEMO-FIXT' });
  const served = await w.next('replay-model', 'error');
  assert.equal(served.type, 'replay-model', served.message);
  assert.equal(served.participantId, 'DEMO-FIXT');
  assert.deepEqual(served.model, fromZip);
  // Asked twice, built twice: the same model again.
  w.send({ type: 'replay', participantId: 'DEMO-FIXT' });
  assert.deepEqual((await w.next('replay-model')).model, fromZip);
});

test('a dropped file whose name differs from the recorded URL only in case still styles the replay', async () => {
  const dir = 'tests/fixtures/demo';
  const recName = readdirSync(dir).find((f) => /-replay-\d+\.json$/.test(f));
  const rec = JSON.parse(readFileSync(dir + '/' + recName, 'utf8'));
  rec.stylesheets.push({ id: 999, kind: 'link', href: 'https://exp.example.org/study/css/style.css', css: null, media: null });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const files = [
    fileEntry(dir, 'DEMO-FIXT.json', 'study/data/DEMO-FIXT.json'),
    { path: 'study/data/' + recName, file: new File([JSON.stringify(rec)], recName) },
    { path: 'study/css/style.css', file: new File(['.stim{background:url("../img/bg.png")}'], 'style.css') },
    { path: 'study/Img/BG.PNG', file: new File([png], 'BG.PNG') },
  ];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  w.send({ type: 'run', files, config: checked.config, participantIdField: checked.idSuggestion.suggested });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  assert.deepEqual(done.assetReport.matched.map((m) => m.path).sort(), ['study/Img/BG.PNG', 'study/css/style.css']);
  assert.match(done.participants[0].assetNote, /1 of 1 images matched/);
  const zipped = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  assert.ok(strFromU8(zipped['replay/DEMO-FIXT.replay.js']).includes('data:image/png;base64,' + Buffer.from(png).toString('base64')));
});

test('dropped files sent as bytes (a page opened from file:) check and run as File handles do', async () => {
  const dir = 'examples/synthetic-pilot';
  const paths = readdirSync(dir + '/data').filter((f) => f.endsWith('.csv')).sort().map((f) => 'data/' + f).concat(['cyborg-hunter.config.json']);
  const asFiles = () => paths.map((p) => fileEntry(dir, p, 'pilot/' + p));
  // A fresh ArrayBuffer per message, as the page reads one for each.
  const asBytes = () => paths.map((p) => ({ path: 'pilot/' + p, bytes: new Uint8Array(readFileSync(dir + '/' + p)).buffer }));
  const outcome = async (files) => {
    const w = startWorker();
    w.send({ type: 'check', files: files() });
    const checked = await w.next('checked', 'error');
    assert.equal(checked.type, 'checked', checked.message);
    w.send({ type: 'run', files: files(), config: checked.config, participantIdField: checked.idSuggestion.suggested });
    const done = await w.next('done', 'error');
    assert.equal(done.type, 'done', done.message);
    return { checked, triageOrder: done.triageOrder, counts: done.counts, files: done.files, warnings: done.warnings };
  };
  const viaBytes = await outcome(asBytes);
  assert.deepEqual(viaBytes, await outcome(asFiles));
  assert.equal(viaBytes.checked.idSuggestion.suggested, 'subject_ID', 'the config was read from its bytes');
  assert.deepEqual(viaBytes.triageOrder, ['SYN-HARD-03', 'SYN-SOFT-02', 'SYN-CLEAN-01']);
});

test('reset lets go of the last run: its replays are no longer served', async () => {
  const dir = 'tests/fixtures/demo';
  const recName = readdirSync(dir).find((f) => /-replay-\d+\.json$/.test(f));
  const files = [fileEntry(dir, 'DEMO-FIXT.json', 'data/DEMO-FIXT.json'), fileEntry(dir, recName, 'data/' + recName)];
  const w = startWorker();
  w.send({ type: 'run', files, config: {}, participantIdField: 'participantId' });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  assert.deepEqual(done.participants.map((p) => [p.participantId, p.hasReplay]), [['DEMO-FIXT', true]]);
  w.send({ type: 'replay', participantId: 'DEMO-FIXT' });
  assert.equal((await w.next('replay-model', 'error')).type, 'replay-model');
  w.send({ type: 'reset' });
  w.send({ type: 'replay', participantId: 'DEMO-FIXT' });
  const after = await w.next('replay-model', 'error');
  assert.equal(after.type, 'error');
  assert.equal(after.phase, 'replay');
});

test('a dropped config whose JSON is not an object is ignored with the CLI\'s warning', async () => {
  const w = startWorker();
  w.send({ type: 'check', files: [{ path: 'cyborg-hunter.config.json', file: new File(['[]'], 'cyborg-hunter.config.json') }] });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  assert.deepEqual(checked.configWarnings, ['the config file holds an array, not a JSON object; its settings are ignored']);
});

test('errors name their phase', async () => {
  const w = startWorker();
  w.send({ type: 'replay', participantId: 'nobody' });
  const noRun = await w.next('error');
  assert.equal(noRun.phase, 'replay');
  w.send({ type: 'run', files: [{ path: 'notes.csv', file: new File(['a,b\n'], 'notes.csv') }], config: {}, participantIdField: 'subject_ID' });
  const empty = await w.next('error', 'done');
  assert.equal(empty.type, 'error');
  assert.equal(empty.phase, 'ingest');
});

// The image path needs a canvas; node-canvas stands in for OffscreenCanvas
// when it is installed (an optional dependency).
let nodeCanvas = null;
try { nodeCanvas = createRequire(import.meta.url)('canvas'); } catch { /* optional */ }

test('plots reach the zip and the in-page report as the same PNG bytes', { skip: !nodeCanvas && 'node-canvas not installed' }, async () => {
  globalThis.OffscreenCanvas = function (wd, ht) {
    const c = nodeCanvas.createCanvas(wd, ht);
    c.convertToBlob = async () => new Blob([c.toBuffer('image/png')], { type: 'image/png' });
    return c;
  };
  try {
    const w = startWorker();
    w.send({ type: 'check', sample: true });
    const checked = await w.next('checked');
    w.send({ type: 'run', sample: true, config: checked.config, participantIdField: 'subject_ID' });
    const done = await w.next('done', 'error');
    assert.equal(done.type, 'done', done.message);
    const zipped = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
    const pngs = Object.keys(zipped).filter((p) => p.endsWith('.png'));
    assert.ok(pngs.length >= 3, pngs.join(','));
    // The zip chunks crossed with their buffers transferred; the in-page
    // copies must still be whole.
    for (const p of pngs) {
      const b64 = Buffer.from(zipped[p]).toString('base64');
      assert.ok(done.html.includes('data:image/png;base64,' + b64), p + ' inlined intact');
    }
  } finally {
    delete globalThis.OffscreenCanvas;
  }
});
