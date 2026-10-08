// demo/analyze/worker-entry.js
// Everything the analyze page computes runs here, off the main thread, from a
// blob-URL worker (so it inherits the page's no-network policy). The CLI's own
// cores do the work: ingestFiles over the dropped files, buildReport into a
// streaming zip, renderInPageHtml for the report iframe, buildViewerModel +
// applyAssetMap for one replay at a time. Nothing is fetched: the viewer
// client, the report fonts and the sample dataset are baked in at build time.
//
// Protocol (every message is { type, ... }):
//   page → worker
//     { type: 'check',  files: [{ path, file: File } | { path, bytes: ArrayBuffer }], sample?: true }
//     { type: 'run',    files, sample?: true, config, participantIdField }
//     { type: 'reanalyze', config, participantIdField }  the last run's participants
//                   again under another config: analysis, figures, report and
//                   zip, with no file read (the settings panel's post-hoc keys);
//                   the keys only ingest reads (participantIdField,
//                   qualtricsField, singleParticipant) stay the run's
//     { type: 'replay', participantId }
//     { type: 'reset' }  start over: the last run's participants are let go
//   worker → page
//     ready         on boot: the baked assets and the tested cohort size
//     checked       counts: the files in each group ({ participant, replay,
//                   assets, ignored }); config: the merged config, and
//                   configWarnings its warnings; configFound, configPath:
//                   whether a cyborg-hunter.config.json was among the files,
//                   and its path (null without one); idSuggestion; sampled:
//                   the data files the suggestion was read from; recordings:
//                   the replay recordings among the JSON files, never sampled;
//                   and every file with what it was read as (files: [{path, kind}],
//                   kind data | recording | asset | config | ignored | unreadable)
//     progress      { phase: 'check' | 'ingest' | 'report', done, total, label? }
//     zip           { chunk } — the report zip, in order, buffer transferred
//     done          the in-page report html and what the page lists beside it;
//                   phases: the trial phases in the data, sorted; runId: the
//                   run id (report-core.js runIdOf); triageRows: each
//                   participant's tier and triage score in triage order
//                   (for the annotation export)
//     replay-model  { participantId, model }
//     error         { phase, message, warnings? }, phase 'ingest' or the type of
//                   the message that failed: 'check' | 'run' | 'reanalyze' |
//                   'replay'; warnings: ingest's own, on an ingest that found
//                   no participant data (the page lists them under the files)
import replayClientSrc from 'virtual:replay-client-src';
import fontFaceCss from 'virtual:font-face-css';
import sample from 'virtual:sample-data';
import { REPLAY_STYLES_CSS } from '../../src/cli/renderers/replay-styles.js';
import { ingestFiles } from '../../src/cli/ingest-core.js';
import { mergeConfig } from '../../src/cli/config-core.js';
import { buildReport, renderInPageHtml } from '../../src/cli/report-core.js';
import { buildAssetMap, applyAssetMap, assetNoteText, assetMatchSummary } from '../../src/cli/asset-match.js';
import { buildViewerModel } from '../../src/replay/viewer-model.js';
import { classifyFiles, CONFIG_NAME } from './classify-files.js';
import { peekParticipantFile } from './peek-files.js';
import { suggestIdField } from './participant-id-suggest.js';
import { createZipSink } from './zip-sink.js';
import { webGunzip, webSha256, bytesToBase64, offscreenCreateCanvas, offscreenEncodePng } from './web-deps.js';
import { TESTED_PARTICIPANTS, TESTED_FIXTURE } from './limits.js';

var post = function (msg, transfer) { self.postMessage(msg, transfer || []); };
var decode = function (bytes) { return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); };

// Lazy readers over File handles (over http the page passes the handles,
// never the bytes): a file is read when ingest or the matcher asks for it, one
// at a time. A page opened from file: sends each file's bytes instead (WebKit's
// worker cannot read a File there; page.js); the reader then serves a copy of
// them per read, as a File read hands out a fresh buffer each time.
function fileReader(entry) {
  var name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
  var bytes = entry.bytes ? new Uint8Array(entry.bytes) : null;
  return { name: name, path: entry.path, size: bytes ? bytes.length : entry.file.size,
    read: function () {
      if (bytes) return Promise.resolve(bytes.slice());
      return entry.file.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    } };
}
function textReader(path, text) {
  var bytes = new TextEncoder().encode(text);
  var name = path.slice(path.lastIndexOf('/') + 1);
  return { name: name, path: path, size: bytes.length, read: function () { return Promise.resolve(bytes); } };
}
function readersFor(msg) {
  if (msg.sample) return sample.files.map(function (f) { return textReader(f.path, f.text); });
  return msg.files.map(fileReader);
}

// The analyst's state between messages: what the last run read (its
// participants, the asset map, the notes and warnings, and its config), so a
// replay model can be built on request (one at a time, from the recording)
// and the report rendered again under another config without reading the
// files again (reanalyze).
var lastRun = null;

async function check(msg) {
  var readers = readersFor(msg);
  var groups = classifyFiles(readers);
  var fileConfig, configWarnings = [];
  if (groups.config) {
    try { fileConfig = JSON.parse(decode(await groups.config.read())); }
    catch (e) { configWarnings.push('failed to parse ' + CONFIG_NAME + ': ' + e.message); fileConfig = undefined; }
  }
  // undefined: no config (none dropped, or unreadable); anything else that
  // is not an object gets mergeConfig's warning, as in the CLI.
  var merged = mergeConfig(fileConfig);
  configWarnings = configWarnings.concat(merged.warnings);
  // A recording's keys are no data file's, and a field must be in every peeked
  // file to be suggested: one recording in the list left no candidate at all.
  var peeks = [], recordings = 0;
  // What each file was read as, for the page's file table: by name for
  // assets, the config and ignored files; by the peek for the rest.
  var kinds = Object.create(null);
  readers.forEach(function (r) { kinds[r.path] = 'ignored'; });
  groups.assets.forEach(function (r) { kinds[r.path] = 'asset'; });
  if (groups.config) kinds[groups.config.path] = 'config';
  for (var i = 0; i < groups.participant.length; i++) {
    var peek = await peekParticipantFile(groups.participant[i]);
    kinds[groups.participant[i].path] = peek && peek.recording ? 'recording' : peek ? 'data' : 'unreadable';
    if (peek && peek.recording) recordings++;
    else if (peek) peeks.push(peek);
    post({ type: 'progress', phase: 'check', done: i + 1, total: groups.participant.length });
  }
  var idSuggestion = suggestIdField(peeks);
  if (fileConfig && fileConfig.participantIdField) {
    idSuggestion.candidates.unshift({ field: fileConfig.participantIdField, reason: 'from ' + CONFIG_NAME });
    idSuggestion.suggested = fileConfig.participantIdField;
  }
  post({ type: 'checked',
    counts: { participant: groups.participant.length, replay: groups.replay.length, assets: groups.assets.length, ignored: groups.ignored.length },
    configFound: !!groups.config, config: merged.config, configWarnings: configWarnings,
    idSuggestion: idSuggestion, sampled: peeks.length, recordings: recordings,
    files: readers.map(function (r) { return { path: r.path, kind: kinds[r.path] }; }),
    configPath: groups.config ? groups.config.path : null });
}

// The config a run uses: the page's, with the file-system keys this page
// does not have (it reads dropped files, not a directory).
function runConfig(msg) {
  return Object.assign({}, msg.config, { participantIdField: msg.participantIdField, dataDir: '(dropped files)', replayDir: null, outputDir: 'cyborg-hunter-report' });
}

// The keys only ingest reads. A re-analysis reports the participants the run
// read, so these keep the run's values whatever the page sends.
var INGEST_KEYS = ['participantIdField', 'qualtricsField', 'singleParticipant'];

async function run(msg) {
  var readers = readersFor(msg);
  var groups = classifyFiles(readers);
  var config = runConfig(msg);
  post({ type: 'progress', phase: 'ingest', done: 0, total: groups.participant.length });
  var ingested = await ingestFiles({ participantFiles: groups.participant, replayFiles: groups.replay }, config,
    { gunzip: webGunzip, sha256: webSha256, shellHints: false });
  var participants = ingested.participants;
  if (participants.length === 0) {
    post({ type: 'error', phase: 'ingest', message: 'No participant data found in the dropped files.', warnings: ingested.warnings });
    return;
  }
  var recordings = participants.filter(function (p) { return p.replay && p.replay.recording; }).map(function (p) { return p.replay.recording; });
  var assets = await buildAssetMap(recordings, groups.assets);
  // Notes BEFORE the report pass: applyAssetMap (inside buildReplayAssets)
  // rewrites the recordings the models alias, after which matched sheets no
  // longer look external and the summary would undercount.
  // One recording the matcher cannot read loses its note, not the run.
  var assetNotes = {};
  participants.forEach(function (p) {
    if (!p.replay || !p.replay.recording) return;
    try { assetNotes[p.participantId] = assetNoteText(assetMatchSummary(p.replay.recording, assets.assetMap)); } catch (_) { assetNotes[p.participantId] = null; }
  });
  var state = lastRun = { participants: participants, assetMap: assets.assetMap, assetNotes: assetNotes,
    warnings: ingested.warnings.concat(assets.report.warnings), assetReport: assets.report, config: config };
  await renderRun(state, config);
}

// A re-analysis: the participants the last run read, under the config the
// page sends now. Ingest, matching, the notes and the keys only ingest reads
// are the run's; everything after them (analysis, figures, the report, the
// zip) is done again.
async function reanalyze(msg) {
  var state = lastRun;
  if (!state) {
    post({ type: 'error', phase: 'reanalyze', message: 'Build the report first: there is nothing to re-analyse.' });
    return;
  }
  var config = runConfig(msg);
  INGEST_KEYS.forEach(function (k) {
    if (k in state.config) config[k] = state.config[k]; else delete config[k];
  });
  await renderRun(state, config);
}

// The report pass over a run's participants. `state` is the run's, passed in:
// a reset during the pass lets go of lastRun without pulling it from under
// this one. The replay pass inside buildReport rewrites the recordings it
// styles, and a second pass over the same objects writes what the first
// wrote because replay-assets-core.js keeps the first note and asset-match.js
// rewrites each stylesheet once (tests/demo/analyze-worker.test.js compares
// two zips file for file, with a stylesheet two others import).
async function renderRun(state, config) {
  var participants = state.participants, assetNotes = state.assetNotes;
  // Copied before transfer: a pass-through chunk aliases the bytes the sink
  // was given, and keepImages still needs those for the in-page data URIs.
  var zip = createZipSink(function (chunk) { var copy = chunk.slice(); post({ type: 'zip', chunk: copy }, [copy.buffer]); });
  var fileTexts = {};
  var sink = function (path, data) {
    if (path === 'summary.csv' || path === 'triage.md' || path === 'event-log.csv') fileTexts[path] = data;
    zip.sink(path, data);
    post({ type: 'progress', phase: 'report', done: 0, total: 0, label: path });
  };
  var built = await buildReport(participants, config, {
    sink: sink, keepImages: true, assetMap: state.assetMap,
    createCanvas: typeof OffscreenCanvas === 'function' ? offscreenCreateCanvas : null, encodePng: offscreenEncodePng,
    replayClientSrc: replayClientSrc, fontFaceCss: fontFaceCss, sha256: webSha256,
  });
  zip.end();
  var html = await renderInPageHtml(built, participants, config, { replayClientSrc: replayClientSrc, fontFaceCss: fontFaceCss, bytesToBase64: bytesToBase64 });
  post({ type: 'done', html: html, triageOrder: built.triageOrder, counts: built.counts, runId: built.runId,
    participants: participants.map(function (p) {
      var has = !!(p.replay && p.replay.recording);
      return { participantId: p.participantId, hasReplay: has,
        assetNote: has ? assetNotes[p.participantId] : null,
        replayError: p.replay && p.replay.error ? (p.replay.reason || p.replay.error) : null };
    }),
    warnings: state.warnings, reportWarnings: built.warnings, assetReport: state.assetReport,
    phases: phasesOf(participants), files: fileTexts, configUsed: config, zipBytes: zip.bytes,
    triageRows: built.triage.map(function (t) {
      return { participantId: t.participantId, tier: t.hardTriggered ? 'hard' : t.softFlagged ? 'soft' : 'clean', triageScore: t.score };
    }) });
}

// The trial phases in the data (done.phases), named as phase scope names
// them: a trial without a phase is 'default' (src/cli/analyzers/phase-scope.js).
function phasesOf(participants) {
  var seen = Object.create(null), out = [];
  participants.forEach(function (p) {
    (p.trials || []).forEach(function (t) {
      var phase = (t && t.phase) ?? 'default';
      if (typeof phase === 'string' && phase && !seen[phase]) { seen[phase] = true; out.push(phase); }
    });
  });
  return out.sort();
}

function replay(msg) {
  var p = lastRun && lastRun.participants.find(function (x) { return x.participantId === msg.participantId; });
  if (!p || !p.replay || !p.replay.recording) { post({ type: 'error', phase: 'replay', message: 'No replay for ' + msg.participantId }); return; }
  // Built fresh on every request: the zip pass consumed its own model, and
  // holding every cohort model would defeat reading one artifact at a time.
  var model = buildViewerModel(p.replay.recording);
  // A recording the matcher cannot read is shown styled as far as the apply got.
  try { applyAssetMap(model, lastRun.assetMap); } catch (_) { /* the model stays loadable */ }
  post({ type: 'replay-model', participantId: msg.participantId, model: model });
}

self.onmessage = function (ev) {
  var msg = ev.data || {};
  if (msg.type === 'reset') { lastRun = null; return; }
  var job = msg.type === 'check' ? check(msg) : msg.type === 'run' ? run(msg) : msg.type === 'reanalyze' ? reanalyze(msg)
    : msg.type === 'replay' ? Promise.resolve().then(function () { replay(msg); }) : null;
  if (!job) return;
  job.catch(function (e) { post({ type: 'error', phase: msg.type, message: e && e.message ? e.message : String(e) }); });
};

post({ type: 'ready', assets: { replayClientSrc: replayClientSrc, replayCss: REPLAY_STYLES_CSS, fontFaceCss: fontFaceCss },
  limits: { testedParticipants: TESTED_PARTICIPANTS, testedFixture: TESTED_FIXTURE } });
