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
import { nodeDeps } from '../../src/cli/ingest.js';
import { KEY_FILE_BANNER, assignCodes, keyFileUpdate, pseudonymCode } from '../../src/cli/pseudonymize-core.js';
import { timelineScript } from '../../src/cli/renderers/timeline-client.js';
import { inlineSafeSrc } from '../../src/shared/inline-safe.js';
import { keyRecording, botGaps, humanGaps } from '../cli/typing-fixtures.js';
import { makeRecordingCanvasFactory } from '../cli/recording-canvas.js';

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

// The pseudonym key's secret the page sends with a pseudonymized run.
const SECRET = 'a'.repeat(64);

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const fileEntry = (dir, name, path) => ({ path: path || name, file: new File([readFileSync(dir + '/' + name)], name) });
// The bundled sessions as the page sends them after a `sample` reply: each
// file's bytes (the shape a page opened from file: sends).
async function sampleEntries(w) {
  w.send({ type: 'sample' });
  const { files } = await w.next('sample');
  return files.map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.text).buffer }));
}

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

test('sample hands over the bundled files as text, under their own names', async () => {
  const w = startWorker();
  w.send({ type: 'sample' });
  const { files } = await w.next('sample');
  assert.deepEqual(files.map((f) => f.path), ['DEMO-681w.json', 'DEMO-9mop.json', 'DEMO-a3f3.json', 'DEMO-bsq6.json', 'cyborg-hunter.config.json']);
  assert.equal(JSON.parse(files[0].text).participantId, 'DEMO-681w');
});

test('check on the sample finds four participant files and the id field its config names', async () => {
  const w = startWorker();
  const files = await sampleEntries(w);
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  // JSON files go to both lists: ingest tells a recording by its content.
  assert.deepEqual(checked.counts, { participant: 4, replay: 4, assets: 0, ignored: 0 });
  assert.equal(checked.configFound, true);
  assert.equal(checked.config.participantIdField, 'participantId');
  assert.deepEqual(checked.configWarnings, []);
  assert.equal(checked.idSuggestion.suggested, 'participantId');
  assert.equal(checked.sampled, 4);
});

// A recording in the drop used to leave no candidate at all: its keys
// (schema_version, segments, …) share nothing with a data file, and a field
// must be in every peeked file. Measured before the fix: [] for both drops,
// so the page fell back to participantId, which is wrong for jsPsych's subject_ID.
test('check skips replay recordings when it suggests the id field: a DEMO session and its replay, no config', async () => {
  const dir = 'tests/fixtures/demo';
  const w = startWorker();
  w.send({ type: 'check', files: [fileEntry(dir, 'DEMO-FIXT.json'), fileEntry(dir, 'DEMO-FIXT-replay-1785352263344.json')] });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  assert.deepEqual(checked.idSuggestion, { suggested: 'participantId', candidates: [{ field: 'participantId', reason: 'known name' }] });
  assert.equal(checked.sampled, 1);
  assert.equal(checked.recordings, 1);
});

test('check skips replay recordings when it suggests the id field: a jsPsych CSV and one replay, no config', async () => {
  const files = [fileEntry('tests/cli/fixtures', 'conj-disj-sample.csv', 'data/conj-disj-sample.csv'),
    fileEntry('tests/fixtures/demo', 'DEMO-FIXT-replay-1785352263344.json', 'replays/DEMO-FIXT-replay-1785352263344.json')];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  assert.deepEqual(checked.idSuggestion, { suggested: 'subjectId', candidates: [{ field: 'subjectId', reason: 'constant within each file, unique across files' }] });
  assert.equal(checked.sampled, 1);
  assert.equal(checked.recordings, 1);
});

// The page's file table lists every file with what the check read it as.
test('check tells what it read each file as: data, recording, asset, config, ignored, unreadable', async () => {
  const dir = 'tests/fixtures/demo';
  const files = [
    fileEntry(dir, 'DEMO-FIXT.json', 'study/DEMO-FIXT.json'),
    fileEntry(dir, 'DEMO-FIXT-replay-1785352263344.json', 'study/DEMO-FIXT-replay-1785352263344.json'),
    fileEntry(dir, 'cyborg-hunter.config.json', 'study/cyborg-hunter.config.json'),
    { path: 'study/css/style.css', file: new File(['p{}'], 'style.css') },
    { path: 'study/.DS_Store', file: new File(['x'], '.DS_Store') },
    { path: 'study/broken.json', file: new File(['{nope'], 'broken.json') },
  ];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  assert.deepEqual(checked.files.map((f) => [f.path.replace('study/', ''), f.kind]), [
    ['DEMO-FIXT.json', 'data'], ['DEMO-FIXT-replay-1785352263344.json', 'recording'], ['cyborg-hunter.config.json', 'config'],
    ['css/style.css', 'asset'], ['.DS_Store', 'ignored'], ['broken.json', 'unreadable']]);
  assert.equal(checked.configPath, 'study/cyborg-hunter.config.json');
});

test('run on the sample streams a zip of the full report and returns the in-page report', async () => {
  const w = startWorker();
  w.send({ type: 'check', files: await sampleEntries(w) });
  const checked = await w.next('checked');
  w.send({ type: 'run', files: await sampleEntries(w), config: checked.config, participantIdField: 'participantId' });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  const zip = concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk));
  assert.equal(done.zipBytes, zip.length);
  const files = unzipSync(zip);
  for (const f of REPORT_FILES) assert.ok(files[f], f + ' is in the zip');
  for (const f of ['summary.csv', 'triage.md', 'event-log.csv']) assert.equal(done.files[f], strFromU8(files[f]), f);
  assert.deepEqual(done.participants.map((p) => p.participantId).sort(), ['DEMO-681w', 'DEMO-9mop', 'DEMO-a3f3', 'DEMO-bsq6']);
  assert.deepEqual(done.triageOrder.slice().sort(), ['DEMO-681w', 'DEMO-9mop', 'DEMO-a3f3', 'DEMO-bsq6']);
  assert.equal(done.cursorLine, 'Pointer verdicts: 1 highly suspicious, 0 suspicious, 1 clean, 2 not assessed (4 sessions; 2 recorded without device facts)');
  assert.match(done.files['triage.md'], /\| DEMO-bsq6 \| \*\*HARD\*\* \| 21 \| 2 paste events; 2 copy events; 1 tab-away ≥10s; fast typing on 3 trials; 44 synthetic insertions; pointer verdict: highly suspicious \(clicks without a path 12\/12\) \|/);
  assert.equal(done.configUsed.participantIdField, 'participantId');
  assert.match(done.html, /DEMO-9mop/);
  const phases = new Set(w.messages.filter((m) => m.type === 'progress').map((m) => m.phase));
  assert.ok(phases.has('ingest') && phases.has('report'), [...phases].join(','));
});

// The Session timeline blocks' script is timeline-client.js's functions as
// their source text. In the bundle a function's toString is esbuild's
// reprint of it, so the analyzer takes the text node gives, baked at build
// time: its downloaded report is the CLI's byte for byte.
test('both reports carry the timeline script as node writes it, not the bundle\'s reprint', async () => {
  const w = startWorker();
  w.send({ type: 'check', files: await sampleEntries(w) });
  const checked = await w.next('checked');
  w.send({ type: 'run', files: await sampleEntries(w), config: checked.config, participantIdField: 'participantId' });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  const script = inlineSafeSrc(timelineScript());
  const files = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  assert.ok(strFromU8(files['index.html']).includes(script), 'the downloaded report');
  assert.ok(done.html.includes(script), 'the in-page report');
});

// The sample added to a cohort already listed, as the page adds it: without
// its config. The cohort's CSV is keyed by subjectId, the sessions by
// participantId; no id field is in every file, so the check suggests none,
// and a run under participantId reads the CSV's participant as unknown.
test('beside a CSV keyed by another field, the sample reads under participantId and the CSV\'s participant is unknown', async () => {
  const w = startWorker();
  const files = async () => [fileEntry('tests/cli/fixtures', 'conj-disj-sample.csv'),
    ...(await sampleEntries(w)).filter((f) => f.path !== 'cyborg-hunter.config.json')];
  w.send({ type: 'check', files: await files() });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  assert.equal(checked.configFound, false);
  assert.equal(checked.idSuggestion.suggested, null);
  w.send({ type: 'run', files: await files(), config: checked.config, participantIdField: 'participantId' });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  assert.ok(done.warnings.some((x) => /conj-disj-sample\.csv/.test(x.file)
    && x.warnings.some((t) => /field "participantId" not found.*defaulted to "unknown"/.test(t))), JSON.stringify(done.warnings));
  assert.deepEqual(done.participants.map((p) => p.participantId).sort(), ['DEMO-681w', 'DEMO-9mop', 'DEMO-a3f3', 'DEMO-bsq6', 'unknown']);
  assert.ok(done.triageOrder.includes('unknown'), done.triageOrder.join(','));
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

// The settings panel's post-hoc keys re-run the report from the participants
// the last run read. The replay pass inside it rewrites the recordings it
// styles, so the check that matters is that a second pass writes the same
// replay files and keeps the first asset note (a re-count after the rewrite
// says nothing matched).
test('reanalyze re-renders the last run under another config: the same replay files and notes, new scores', async () => {
  const dir = 'tests/fixtures/demo';
  const recName = readdirSync(dir).find((f) => /-replay-\d+\.json$/.test(f));
  const rec = JSON.parse(readFileSync(dir + '/' + recName, 'utf8'));
  rec.stylesheets.push({ id: 999, kind: 'link', href: 'https://exp.example.org/study/css/style.css', css: null, media: null });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const files = [
    fileEntry(dir, 'DEMO-FIXT.json', 'study/data/DEMO-FIXT.json'),
    { path: 'study/data/' + recName, file: new File([JSON.stringify(rec)], recName) },
    { path: 'study/css/style.css', file: new File(['.stim{background:url("../img/bg.png")}'], 'style.css') },
    { path: 'study/img/bg.png', file: new File([png], 'bg.png') },
  ];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  w.send({ type: 'run', files, config: checked.config, participantIdField: 'participantId' });
  const first = await w.next('done', 'error');
  assert.equal(first.type, 'done', first.message);
  const zip1 = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  w.send({ type: 'reanalyze', config: { ...checked.config, scoreWeights: { paste: 1 } }, participantIdField: 'participantId' });
  const second = await w.next('done', 'error');
  assert.equal(second.type, 'done', second.message);
  const zip2 = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  assert.equal(strFromU8(zip2['replay/DEMO-FIXT.replay.js']), strFromU8(zip1['replay/DEMO-FIXT.replay.js']), 'the same replay file');
  assert.equal(second.participants[0].assetNote, first.participants[0].assetNote);
  assert.match(second.participants[0].assetNote, /1 of 1 stylesheets matched/);
  // The zip's own report words the note in its replay section, from the pass.
  assert.match(strFromU8(zip2['index.html']), /Experiment assets: 1 of 1 stylesheets matched/);
  assert.notEqual(strFromU8(zip2['score-weights.json']), strFromU8(zip1['score-weights.json']), 'the new weights');
  assert.equal(second.configUsed.scoreWeights.paste, 1);
  assert.ok(w.messages.every((m) => m.type !== 'progress' || m.phase !== 'ingest'), 'nothing was read again');
});

test('reanalyze before any run is an error, not a silent no-op', async () => {
  const w = startWorker();
  w.send({ type: 'reanalyze', config: {}, participantIdField: 'participantId' });
  const err = await w.next('error', 'done');
  assert.deepEqual([err.type, err.phase], ['error', 'reanalyze']);
  assert.match(err.message, /Build the report first/);
});

// Only ingest reads the id field, the Qualtrics column and the one-participant
// filter. The participants a re-analysis reports were read under the run's,
// so its configUsed keeps those, whatever the page sends.
test('reanalyze keeps the keys ingest read under the run, whatever the page sends', async () => {
  const w = startWorker();
  const files = await sampleEntries(w);
  w.send({ type: 'check', files });
  const checked = await w.next('checked');
  w.send({ type: 'run', files: await sampleEntries(w), config: checked.config, participantIdField: 'participantId' });
  const first = await w.next('done', 'error');
  assert.equal(first.type, 'done', first.message);
  w.send({ type: 'reanalyze', config: { ...checked.config, qualtricsField: 'other_column', singleParticipant: 'DEMO-9mop' }, participantIdField: 'another_field' });
  const second = await w.next('done', 'error');
  assert.equal(second.type, 'done', second.message);
  assert.equal(second.configUsed.participantIdField, 'participantId');
  assert.equal(second.configUsed.qualtricsField, first.configUsed.qualtricsField);
  assert.equal('singleParticipant' in second.configUsed, 'singleParticipant' in first.configUsed);
  assert.deepEqual(second.participants.map((p) => p.participantId), first.participants.map((p) => p.participantId));
});

// A reset while a report renders lets go of the run; the render already under
// way finishes over the state it started with instead of failing half-way.
test('a reset while the report renders does not turn the render into an error', async () => {
  const w = startWorker();
  const files = await sampleEntries(w);
  w.send({ type: 'check', files });
  const checked = await w.next('checked');
  w.send({ type: 'run', files: await sampleEntries(w), config: checked.config, participantIdField: 'participantId' });
  assert.equal((await w.next('done', 'error')).type, 'done');
  w.send({ type: 'reanalyze', config: checked.config, participantIdField: 'participantId' });
  await w.next('zip');
  w.send({ type: 'reset' });
  const end = await w.next('done', 'error');
  assert.equal(end.type, 'done', end.message);
  w.send({ type: 'replay', participantId: 'DEMO-9mop' });
  assert.equal((await w.next('replay-model', 'error')).type, 'error', 'the reset still let go of the run');
});

// Under the config the run used, a re-analysis is the run again: every file
// in the zip, the in-page report and what the page lists beside it. The
// stylesheet imports two sheets, one of which imports the other: a spliced
// sheet keeps its own imports as URLs, which a second pass over the same
// recording must leave as the first wrote them. The time a
// report was built is the one part of index.html that differs between the two
// passes (the run id is the cohort's own), so the reports compare without it.
const withoutRunTime = (html) => html.replace(/<time class="run-time" datetime="[^"]*">[^<]*<\/time>/, '<time class="run-time"></time>');
test('reanalyze under the same config gives the first report again, file for file', async () => {
  const dir = 'tests/fixtures/demo';
  const recName = readdirSync(dir).find((f) => /-replay-\d+\.json$/.test(f));
  const rec = JSON.parse(readFileSync(dir + '/' + recName, 'utf8'));
  rec.stylesheets.push({ id: 999, kind: 'link', href: 'https://exp.example.org/study/css/style.css', css: null, media: null });
  const data = JSON.parse(readFileSync(dir + '/DEMO-FIXT.json', 'utf8'));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const style = '@import "theme.css";\n@import "vars.css";\n.stim{background:url("../img/bg.png")}';
  const files = [
    { path: 'study/data/DEMO-FIXT.json', file: new File([JSON.stringify(data)], 'DEMO-FIXT.json') },
    { path: 'study/data/' + recName, file: new File([JSON.stringify(rec)], recName) },
    { path: 'study/css/style.css', file: new File([style], 'style.css') },
    { path: 'study/css/theme.css', file: new File(['@import "vars.css";\n.t{}'], 'theme.css') },
    { path: 'study/css/vars.css', file: new File([':root{--v:1}'], 'vars.css') },
    { path: 'study/img/bg.png', file: new File([png], 'bg.png') },
  ];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  w.send({ type: 'run', files, config: checked.config, participantIdField: 'participantId' });
  const first = await w.next('done', 'error');
  assert.equal(first.type, 'done', first.message);
  // The page reads no phases from a run, so the result carries none.
  assert.equal(Object.hasOwn(first, 'phases'), false);
  const zip1 = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  w.send({ type: 'reanalyze', config: checked.config, participantIdField: 'participantId' });
  const second = await w.next('done', 'error');
  assert.equal(second.type, 'done', second.message);
  assert.equal(Object.hasOwn(second, 'phases'), false);
  const zip2 = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  assert.deepEqual(Object.keys(zip2).sort(), Object.keys(zip1).sort());
  assert.ok(zip1['replay/DEMO-FIXT.replay.js'], 'the replay pass ran');
  for (const name of Object.keys(zip1)) {
    if (name === 'index.html') assert.equal(withoutRunTime(strFromU8(zip2[name])), withoutRunTime(strFromU8(zip1[name])), name);
    else assert.ok(Buffer.from(zip2[name]).equals(Buffer.from(zip1[name])), name);
  }
  assert.equal(second.runId, first.runId);
  assert.equal(withoutRunTime(second.html), withoutRunTime(first.html));
  assert.deepEqual(second.participants, first.participants);
  assert.deepEqual(second.triageOrder, first.triageOrder);
  assert.deepEqual(second.files, first.files);
});

// The settings panel re-renders the last run on every change, from the
// participants the run read. The replay pass takes a recording it cannot
// load out of the participants the report shows; a re-render that started
// from those lost all the analysis had read from that recording. Two
// synthetic sessions (typing-fixtures.js keys): each types a tutorial field
// at a person's pace and its main field at software speed, in a recorded
// text field. SYN-U's recording names no recorder version, so ingest
// attaches it and the replay pass cannot load it; SYN-L's loads. SYN-U
// pastes once, so a paste weight moves its score.
function rereadCohort() {
  const session = (pid, loadable) => {
    const rec = keyRecording([['tutorial', 10, humanGaps(40, 1)], ['main', 60010, botGaps(30)]]);
    rec.participant_id = pid;
    rec.recorder = loadable ? { name: 'synthetic', version: '1.0.0' } : { name: 'synthetic' };
    rec.extensions = { 'cyborg-hunter': { tier: 'dom' } };
    const trials = rec.segments.map((s) => {
      const startTime = rec.recording_started_at_perf + s.t_load;
      const pasteEvents = !loadable && s.label === 'tutorial' ? [{ type: 'paste', t: startTime + 500, text: '' }] : [];
      return { trialId: s.label, integrity: { trialId: s.label, participantId: pid, phase: s.label, startTime, duration_ms: 5000,
        libraryVersion: '0.16.0', pasteEvents, copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0, trialSignals: {} } };
    });
    return [
      { path: 'data/' + pid + '.json', file: new File([JSON.stringify({ participantId: pid, trials })], pid + '.json') },
      { path: 'data/' + pid + '-replay-1000.json', file: new File([JSON.stringify(rec)], pid + '-replay-1000.json') },
    ];
  };
  return [...session('SYN-U', false), ...session('SYN-L', true)];
}

test('a re-analysis under another weight reads a recording the replay pass could not load, as a fresh build does', async () => {
  // A canvas that records what is drawn: the typing chart writes a bare R
  // over each trial whose analysis says the rhythm rule fired (byIndex), and
  // one in its legend.
  const log = [];
  const record = makeRecordingCanvasFactory(log);
  globalThis.OffscreenCanvas = function (wd, ht) {
    const c = record(wd, ht);
    c.convertToBlob = async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    return c;
  };
  try {
    const files = rereadCohort();
    const build = async (w, type, config) => {
      const from = log.length;
      w.send({ type, files, config, participantIdField: 'participantId' });
      const done = await w.next('done', 'error');
      assert.equal(done.type, 'done', done.message);
      return { done, zip: zipOf(w), rMarks: log.slice(from).filter((c) => c[0] === 'fillText' && c[1] === 'R').length };
    };
    const w = startWorker();
    w.send({ type: 'check', files });
    const checked = await w.next('checked', 'error');
    assert.equal(checked.type, 'checked', checked.message);
    const weighted = { ...checked.config, scoreWeights: { paste: 1 } };
    const first = await build(w, 'run', checked.config);
    const second = await build(w, 'reanalyze', weighted);
    const fresh = await build(startWorker(), 'run', weighted);

    // summary.csv: the same rows but for the score and the tier (its 3rd and
    // 4th columns), and the run's rates and verdict for SYN-U come from its
    // recording.
    const rowOf = (done, pid) => done.files['summary.csv'].split('\n').find((l) => l.startsWith(pid + ','));
    const unweighted = (done) => done.files['summary.csv'].trim().split('\n').map((l) => l.replace(/^([^,]*,[^,]*),[^,]*,[^,]*,/, '$1,,,')).sort();
    assert.match(rowOf(first.done, 'SYN-U'), /,highly suspicious,.*,recording$/);
    assert.notEqual(rowOf(second.done, 'SYN-U').split(',')[2], rowOf(first.done, 'SYN-U').split(',')[2], 'the paste weight moved the score');
    assert.deepEqual(unweighted(second.done), unweighted(first.done));
    // The typing analysis as the page shows it, and the chart's R marks.
    const typingOf = (html) => html.match(/<section class="participant" id="p-SYN-U"[\s\S]*?(<div class="typing-section">[\s\S]*?<\/div>)/)[1];
    assert.match(typingOf(first.done.html), /Computed from the session recording/);
    assert.equal(typingOf(second.done.html), typingOf(first.done.html));
    assert.equal(typingOf(strFromU8(second.zip['index.html'])), typingOf(strFromU8(first.zip['index.html'])));
    assert.ok(first.rMarks > 0, 'the run drew R marks');
    assert.equal(second.rMarks, first.rMarks);
    // The replay note: the page's, and the zip report's replay section.
    assert.match(first.done.participants.find((p) => p.participantId === 'SYN-U').replayError, /recorder \{name, version\}/);
    assert.deepEqual(second.done.participants, first.done.participants);
    const noteOf = (zip) => strFromU8(zip['index.html']).match(/<p class="replay-note replay-warn">[^\n]*SYN-U-replay-1000\.json<\/p>/)[0];
    assert.equal(noteOf(second.zip), noteOf(first.zip));

    // And the re-analysis is the fresh build under the new weight, file for file.
    assert.deepEqual(Object.keys(second.zip).sort(), Object.keys(fresh.zip).sort());
    for (const name of Object.keys(fresh.zip)) {
      if (name === 'index.html') assert.equal(withoutRunTime(strFromU8(second.zip[name])), withoutRunTime(strFromU8(fresh.zip[name])), name);
      else assert.ok(Buffer.from(second.zip[name]).equals(Buffer.from(fresh.zip[name])), name);
    }
    assert.equal(withoutRunTime(second.done.html), withoutRunTime(fresh.done.html));
    assert.deepEqual(second.done.participants, fresh.done.participants);
    assert.deepEqual(second.done.reportWarnings, fresh.done.reportWarnings);
    assert.equal(second.rMarks, fresh.rMarks);
  } finally {
    delete globalThis.OffscreenCanvas;
  }
});

// The run id names the cohort (report-core.js runIdOf): a re-analysis of the
// same participants keeps it, so annotations stored under it stay with the
// report.
test('done carries the run id, and a re-analysis keeps it', async () => {
  const w = startWorker();
  const files = await sampleEntries(w);
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  w.send({ type: 'run', files: await sampleEntries(w), config: checked.config, participantIdField: 'participantId' });
  const first = await w.next('done', 'error');
  assert.equal(first.type, 'done', first.message);
  assert.match(first.runId, /^[0-9a-f]{16}$/);
  assert.ok(first.html.includes('<code class="mono run-id">' + first.runId + '</code>'), 'the in-page report shows it');
  w.send({ type: 'reanalyze', config: { ...checked.config, scoreWeights: { paste: 1 } }, participantIdField: 'participantId' });
  const second = await w.next('done', 'error');
  assert.equal(second.type, 'done', second.message);
  assert.equal(second.runId, first.runId);
});

// The page's annotation export writes each participant's tier and triage
// score, in triage order: the same score summary.csv carries.
test('done lists each participant\'s tier and triage score, in triage order', async () => {
  const w = startWorker();
  const files = await sampleEntries(w);
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  w.send({ type: 'run', files: await sampleEntries(w), config: checked.config, participantIdField: 'participantId' });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  assert.deepEqual(done.triageRows.map((r) => [r.participantId, r.tier]), [['DEMO-9mop', 'hard'], ['DEMO-bsq6', 'hard'], ['DEMO-681w', 'soft'], ['DEMO-a3f3', 'clean']]);
  const scores = Object.fromEntries(done.files['summary.csv'].trim().split('\n').slice(1).map((l) => l.split(',')).map((c) => [c[0], Number(c[2])]));
  for (const r of done.triageRows) assert.equal(r.triageScore, scores[r.participantId], r.participantId);
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

test('a recording with fields of the wrong shape, which the viewer keeps, does not stop the run', async () => {
  const dir = 'tests/fixtures/demo';
  const recName = readdirSync(dir).find((f) => /-replay-\d+\.json$/.test(f));
  const rec = JSON.parse(readFileSync(dir + '/' + recName, 'utf8'));
  rec.stylesheets = {};
  rec.segments[0].initial_dom.children = {};
  const files = [
    fileEntry(dir, 'DEMO-FIXT.json', 'study/data/DEMO-FIXT.json'),
    { path: 'study/data/' + recName, file: new File([JSON.stringify(rec)], recName) },
    { path: 'study/img/bg.png', file: new File([new Uint8Array([1])], 'bg.png') },
  ];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  w.send({ type: 'run', files, config: checked.config, participantIdField: checked.idSuggestion.suggested });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  assert.deepEqual(done.participants.map((p) => [p.participantId, p.hasReplay]), [['DEMO-FIXT', true]]);
  w.send({ type: 'replay', participantId: 'DEMO-FIXT' });
  const served = await w.next('replay-model', 'error');
  assert.equal(served.type, 'replay-model', served.message);
});

test('dropped files sent as bytes (a page opened from file:) check and run as File handles do', async () => {
  const dir = 'examples/demo-sessions';
  const paths = readdirSync(dir + '/data').filter((f) => f.endsWith('.json')).sort().map((f) => 'data/' + f).concat(['cyborg-hunter.config.json']);
  const asFiles = () => paths.map((p) => fileEntry(dir, p, 'sessions/' + p));
  // A fresh ArrayBuffer per message, as the page reads one for each.
  const asBytes = () => paths.map((p) => ({ path: 'sessions/' + p, bytes: new Uint8Array(readFileSync(dir + '/' + p)).buffer }));
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
  assert.equal(viaBytes.checked.idSuggestion.suggested, 'participantId', 'the config was read from its bytes');
  assert.deepEqual(viaBytes.triageOrder, ['DEMO-9mop', 'DEMO-bsq6', 'DEMO-681w', 'DEMO-a3f3']);
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
    const files = await sampleEntries(w);
    w.send({ type: 'check', files });
    const checked = await w.next('checked');
    w.send({ type: 'run', files: await sampleEntries(w), config: checked.config, participantIdField: 'participantId' });
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

// config.pseudonymize: the zip, the in-page report and everything done
// carries for the page use codes; the key that maps them back comes in
// done.pseudonymKey, never in the zip. The page sends its secret with each
// run (demo/analyze/pseudonym-key.js): a re-analysis under it keeps the
// codes (and gives the same zip again), and turning the setting off gives
// the plain report back.
test('a pseudonymized run: no raw id in the zip or the in-page report, the key apart, the codes kept by a re-analysis', async () => {
  const RAW = 'PROLIFICX5d1e9f00aa';
  const dir = 'tests/fixtures/demo';
  const recName = readdirSync(dir).find((f) => /-replay-\d+\.json$/.test(f));
  const rec = JSON.parse(readFileSync(dir + '/' + recName, 'utf8'));
  rec.participant_id = RAW;
  const data = readFileSync(dir + '/DEMO-FIXT.json', 'utf8').replaceAll('DEMO-FIXT', RAW);
  const recFile = recName.replace('DEMO-FIXT', RAW);
  const files = [
    { path: 'data/' + RAW + '.json', file: new File([data], RAW + '.json') },
    { path: 'data/' + recFile, file: new File([JSON.stringify(rec)], recFile) },
  ];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.config.pseudonymize, false, 'off by default');
  const config = { ...checked.config, pseudonymize: true };
  w.send({ type: 'run', files, config, participantIdField: 'participantId', pseudonymSecret: SECRET });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  const zip = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  for (const [name, bytes] of Object.entries(zip)) {
    assert.ok(!name.includes(RAW), name);
    assert.ok(!Buffer.from(bytes).toString('latin1').includes(RAW), name + ' carries the raw id');
  }
  assert.ok(!Object.keys(zip).some((n) => /pseudonym/i.test(n)), 'the key is not in the zip');
  const { warnings, ...shown } = done;   // ingest's own diagnostics, for the analyst's screen
  assert.ok(!JSON.stringify(shown).replace(JSON.stringify(done.pseudonymKey), '').includes(RAW), 'nothing done carries but the key names the raw id');
  const code = done.participants[0].participantId;
  assert.match(code, /^P-[0-9a-f]{10}$/);
  assert.ok(zip['replay/' + code + '.replay.js'], 'the replay is filed under the code');
  assert.match(done.pseudonymKey, new RegExp('\\n' + code + ',' + RAW + '\\n$'));
  assert.ok(done.pseudonymKey.startsWith('# cyborg-hunter pseudonym key — keep private; do not share with the report\n# secret,'));
  w.send({ type: 'replay', participantId: code });
  const model = await w.next('replay-model', 'error');
  assert.equal(model.type, 'replay-model', model.message);
  assert.equal(model.model.pid, code, 'the replay card shows the code too');

  w.send({ type: 'reanalyze', config, participantIdField: 'participantId', pseudonymSecret: SECRET });
  const again = await w.next('done', 'error');
  assert.equal(again.type, 'done', again.message);
  const zip2 = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  for (const name of Object.keys(zip)) {
    if (name === 'index.html') assert.equal(withoutRunTime(strFromU8(zip2[name])), withoutRunTime(strFromU8(zip[name])), name);
    else assert.ok(Buffer.from(zip2[name]).equals(Buffer.from(zip[name])), name);
  }
  assert.equal(again.pseudonymKey, done.pseudonymKey);

  w.send({ type: 'reanalyze', config: checked.config, participantIdField: 'participantId' });
  const plain = await w.next('done', 'error');
  assert.equal(plain.type, 'done', plain.message);
  assert.deepEqual(plain.participants.map((p) => p.participantId), [RAW]);
  assert.equal(plain.pseudonymKey, null);
});

// A missing recording's save pointer (integrityReplayMeta.saved_to, which a
// DataPipe save names after the id) is printed in the report: coded too.
test('a pseudonymized run: a missing recording\'s save pointer names no raw id in the zip or the in-page report', async () => {
  const RAW = 'PROLIFICX5d1e9f00aa';
  const p = JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT.json', 'utf8').replaceAll('DEMO-FIXT', RAW));
  p.trials.forEach((t) => { t.integrityReplayMeta = { schema_version: 2, tier: 'dom', saved_to: 'datapipe:EXP/' + RAW + '-replay-1.json' }; });
  const files = [{ path: 'data/' + RAW + '.json', file: new File([JSON.stringify(p)], RAW + '.json') }];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  w.send({ type: 'run', files, config: { ...checked.config, pseudonymize: true }, participantIdField: 'participantId', pseudonymSecret: SECRET });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  const zip = unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk)));
  for (const [name, bytes] of Object.entries(zip)) assert.ok(!Buffer.from(bytes).toString('latin1').includes(RAW), name + ' names the participant');
  assert.ok(!done.html.includes(RAW), 'the in-page report names the participant');
  assert.match(strFromU8(zip['index.html']), /saved_to: <strong>datapipe:EXP\/P-[0-9a-f]{10}-replay-1\.json<\/strong>/);
});

// The key file the analyzer remembers (demo/analyze/pseudonym-key.js): one
// among the dropped files is read as the key, never as data. Its secret goes
// back to the page in checked.pseudonymKeys, and it stays out of every
// output, even in a run whose files still list it.
const PSEUDO_RAW = 'PROLIFICX5d1e9f00aa';
function pseudoCohort() {
  const data = readFileSync('tests/fixtures/demo/DEMO-FIXT.json', 'utf8').replaceAll('DEMO-FIXT', PSEUDO_RAW);
  return [{ path: 'data/' + PSEUDO_RAW + '.json', file: new File([data], PSEUDO_RAW + '.json') }];
}
async function cliKeyFile(ids) {
  return keyFileUpdate(null, SECRET, await assignCodes(ids, SECRET, nodeDeps.hmacSha256)).text;
}
function zipOf(w) { return unzipSync(concat(w.messages.filter((m) => m.type === 'zip').map((m) => m.chunk))); }

test('a key file among the dropped files is the key, not data: its secret goes to the page, and the codes are the CLI\'s for it', async () => {
  // A key the CLI wrote for another cohort, renamed: told by its banner.
  const keyText = await cliKeyFile(['MTURKA2Z9QX7YYB']);
  const files = [...pseudoCohort(), { path: 'keys/old-key.csv', file: new File([keyText], 'old-key.csv') }];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  assert.deepEqual(checked.pseudonymKeys, [{ path: 'keys/old-key.csv', secret: SECRET }]);
  assert.deepEqual(checked.files.find((f) => f.path === 'keys/old-key.csv'), { path: 'keys/old-key.csv', kind: 'key' });
  assert.equal(checked.counts.participant, 1, 'not counted as a data file');
  assert.equal(checked.sampled, 1, 'not peeked for the id field');
  // The page leaves it out of later runs; a run that still sends it must not read it either.
  w.send({ type: 'run', files, config: { ...checked.config, pseudonymize: true }, participantIdField: 'participantId', pseudonymSecret: checked.pseudonymKeys[0].secret });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  assert.deepEqual(done.participants.map((p) => p.participantId), [await pseudonymCode(SECRET, PSEUDO_RAW, nodeDeps.hmacSha256)], 'the CLI\'s code for this key');
  assert.deepEqual(done.warnings, [], 'nothing was read from the key file');
  const zip = zipOf(w);
  for (const [name, bytes] of Object.entries(zip)) {
    const text = Buffer.from(bytes).toString('utf8');
    for (const s of [SECRET, 'MTURKA2Z9QX7YYB', PSEUDO_RAW, 'old-key', KEY_FILE_BANNER]) assert.ok(!text.includes(s) && !name.includes(s), name + ' carries ' + s);
  }
  for (const s of [SECRET, 'MTURKA2Z9QX7YYB', 'old-key', KEY_FILE_BANNER]) assert.ok(!done.html.includes(s), 'the in-page report carries ' + s);
  assert.ok(done.pseudonymKey.startsWith(KEY_FILE_BANNER + '\n# secret,' + SECRET + '\n'), 'the key download is made from the same secret');
});

test('a file that looks like a key file but is not one is refused, and is not read as data either', async () => {
  const files = [...pseudoCohort(),
    { path: 'cyborg-hunter-pseudonyms.csv', file: new File(['code,participantId\nP-0123456789,MTURKA2Z9QX7YYB\n'], 'cyborg-hunter-pseudonyms.csv') },
    { path: 'k.csv', file: new File([KEY_FILE_BANNER + '\n# secret,xyz\n'], 'k.csv') }];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  assert.equal(checked.type, 'checked', checked.message);
  assert.deepEqual(checked.pseudonymKeys.map((k) => [k.path, 'secret' in k]), [['cyborg-hunter-pseudonyms.csv', false], ['k.csv', false]]);
  assert.match(checked.pseudonymKeys[0].error, /banner/);
  assert.match(checked.pseudonymKeys[1].error, /secret/);
  assert.deepEqual(checked.files.filter((f) => f.kind === 'key').map((f) => f.path), ['cyborg-hunter-pseudonyms.csv', 'k.csv']);
  w.send({ type: 'run', files, config: checked.config, participantIdField: 'participantId' });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  assert.deepEqual(done.participants.map((p) => p.participantId), [PSEUDO_RAW], 'the refused files are not participants');
  for (const [name, bytes] of Object.entries(zipOf(w))) assert.ok(!Buffer.from(bytes).toString('utf8').includes('MTURKA2Z9QX7YYB'), name);
});

test('the same secret in two worker sessions gives the same codes and the same key; a pseudonymized run without one is refused', async () => {
  const run = async () => {
    const w = startWorker();
    const files = pseudoCohort();
    w.send({ type: 'check', files });
    const checked = await w.next('checked', 'error');
    w.send({ type: 'run', files, config: { ...checked.config, pseudonymize: true }, participantIdField: 'participantId', pseudonymSecret: SECRET });
    const done = await w.next('done', 'error');
    assert.equal(done.type, 'done', done.message);
    return { w, checked, done };
  };
  const first = await run();
  const second = await run();
  assert.deepEqual(second.done.participants.map((p) => p.participantId), first.done.participants.map((p) => p.participantId));
  assert.equal(second.done.pseudonymKey, first.done.pseudonymKey);
  // The page always sends one: a run without it would make codes no later
  // visit could make again.
  first.w.send({ type: 'reanalyze', config: { ...first.checked.config, pseudonymize: true }, participantIdField: 'participantId' });
  const refused = await first.w.next('done', 'error');
  assert.equal(refused.type, 'error');
  assert.match(refused.message, /pseudonym key/);
});

// Ingest's warnings are listed on the page beside the report, so under
// config.pseudonymize they name participants by their codes too.
test('a pseudonymized run: the warnings the page lists name participants by their codes', async () => {
  const RAW = 'PROLIFICX5d1e9f00aa';
  const data = readFileSync('tests/fixtures/demo/DEMO-FIXT.json', 'utf8').replaceAll('DEMO-FIXT', RAW);
  // Two uploads of one participant: ingest warns, naming the id and the files.
  const files = [
    { path: 'data/' + RAW + '.json', file: new File([data], RAW + '.json') },
    { path: 'data/' + RAW + '-again.json', file: new File([data], RAW + '-again.json') },
  ];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  w.send({ type: 'run', files, config: { ...checked.config, pseudonymize: true }, participantIdField: 'participantId', pseudonymSecret: SECRET });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  assert.ok(done.warnings.some((x) => /duplicate participantId/.test(x.warnings.join(' '))), 'the warning is still there');
  assert.ok(!JSON.stringify(done.warnings).includes(RAW), JSON.stringify(done.warnings));
  w.send({ type: 'reanalyze', config: checked.config, participantIdField: 'participantId' });
  const plain = await w.next('done', 'error');
  assert.ok(JSON.stringify(plain.warnings).includes(RAW), 'a plain report keeps the ids in its warnings');
});

// A recording whose elements nest 20,000 deep is small on the wire; it costs
// its participant the replay, with a warning, and the run goes on.
test('a recording nested very deeply: the run finishes, that replay is reported as not written', async () => {
  const dir = 'tests/fixtures/demo';
  const recName = readdirSync(dir).find((f) => /-replay-\d+\.json$/.test(f));
  const rec = JSON.parse(readFileSync(dir + '/' + recName, 'utf8'));
  // The deep tree's text is built by hand: the test's own JSON.stringify of
  // it overflowed the stack on the Node CI runs (20).
  const open = [], close = [];
  for (let i = 20000; i >= 1; i--) {
    open.push('{"id":' + (700000 + i) + ',"kind":"element","tag":"div","attrs":{},"children":[');
    close.push(']}');
  }
  const deepJson = open.join('') + '{"id":700000,"kind":"element","tag":"img","attrs":{"src":"img/x.png"},"children":[]}' + close.join('');
  rec.segments.find((s) => s.initial_dom).initial_dom.children.push({ deepMarker: true });
  const other = JSON.parse(readFileSync(dir + '/' + recName, 'utf8'));
  other.participant_id = 'OTHER';
  const data = readFileSync(dir + '/DEMO-FIXT.json', 'utf8');
  const files = [
    { path: 'data/DEMO-FIXT.json', file: new File([data], 'DEMO-FIXT.json') },
    { path: 'data/' + recName, file: new File([JSON.stringify(rec).replace('{"deepMarker":true}', deepJson)], recName) },
    { path: 'data/OTHER.json', file: new File([data.replaceAll('DEMO-FIXT', 'OTHER')], 'OTHER.json') },
    { path: 'data/other-session.json', file: new File([JSON.stringify(other)], 'other-session.json') },
  ];
  const w = startWorker();
  w.send({ type: 'check', files });
  const checked = await w.next('checked', 'error');
  w.send({ type: 'run', files, config: checked.config, participantIdField: 'participantId' });
  const done = await w.next('done', 'error');
  assert.equal(done.type, 'done', done.message);
  const deep = done.participants.find((p) => p.participantId === 'DEMO-FIXT');
  assert.equal(deep.hasReplay, false);
  assert.match(deep.replayError, /could not be written/);
  assert.ok(done.reportWarnings.some((x) => x.includes('DEMO-FIXT')), done.reportWarnings.join(' / '));
  assert.equal(done.participants.find((p) => p.participantId === 'OTHER').hasReplay, true);
});
