// The CLI finds a session recording that arrived in pieces (src/replay/
// pieces.js) wherever the researcher's saving code put them: in the rows of
// a jsPsych or lab.js file (JSON or CSV), in a saved cyborgHunterReplay POST
// field, or in CyborgHunter.data() output. It rebuilds the recording and
// attaches it by the participant_id it carries; one recording per page of a
// study without a framework is joined into one replay.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Papa from 'papaparse';
import { ingest } from '../../src/cli/ingest.js';
import { createRecorder } from '../../src/replay/recorder.js';
import { createPieceTaker } from '../../src/replay/pieces.js';
import { validateStrict } from '../../src/shared/schema-v2-validator.js';

// A recording of `trials` trials, as pieces: one per trial end and a final
// one. `epoch` is the page's wall-clock start.
function recordedPieces(pid, trials, epoch, opts = {}) {
  const realNow = Date.now;
  if (epoch) Date.now = () => epoch;
  try {
    const rec = createRecorder({ participantId: pid, autoSave: { mode: 'none' }, _ownerSavesRecording: true });
    const taker = createPieceTaker(() => rec.getState(), { recordingId: opts.recordingId });
    rec.startSession();
    const pieces = [];
    for (let i = 0; i < trials; i++) {
      rec.startTrial({ trialId: 't' + i });
      rec.pushRecord({ type: 'mouse.click', x: i, y: i, button: 0, target: null });
      rec.endTrial();
      pieces.push(taker.take());
    }
    rec.stopSession('finished');
    if (opts.final !== false) pieces.push(taker.take({ final: true }));
    return pieces;
  } finally {
    Date.now = realNow;
  }
}

function integrity(pid, trialId) {
  return {
    trialId, participantId: pid, libraryVersion: '0.15.0',
    startTime: 1000, duration_ms: 5000, trialStart_perfNow: 1000,
    pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [],
    trialSoftScore: 0, trialSignals: {},
  };
}

// jsPsych rows as ch.js writes them: one piece per trial row, the final
// piece on the last row.
function jsPsychRows(pid, pieces) {
  const trialPieces = pieces.filter((p) => !p.end);
  const final = pieces.find((p) => p.end);
  return trialPieces.map((p, i) => ({
    participantId: pid, trialId: 't' + i, integrity: integrity(pid, 't' + i),
    cyborgHunterReplay: p,
    ...(final && i === trialPieces.length - 1 ? { cyborgHunterReplayFinal: final } : {}),
  }));
}

const cfg = (d) => ({ dataDir: d, filePattern: '*.{json,csv}', integrityField: 'integrity', participantIdField: 'participantId' });

async function run(files) {
  const d = mkdtempSync(join(tmpdir(), 'ch-pieces-'));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(d, name), content);
    return await ingest(cfg(d));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

describe('ingest: recordings in pieces', () => {
  it('jsPsych JSON rows: the pieces rebuild the recording, attached to its participant', async () => {
    const pieces = recordedPieces('P-JSON', 3);
    const { participants } = await run({ 'P-JSON.json': JSON.stringify(jsPsychRows('P-JSON', pieces)) });
    assert.strictEqual(participants.length, 1);
    const rec = participants[0].replay.recording;
    assert.deepStrictEqual(validateStrict(rec).errors, []);
    assert.deepStrictEqual(rec.segments.map((s) => s.label), ['t0', 't1', 't2']);
    assert.strictEqual(rec.extensions['cyborg-hunter'].reassembly, undefined);
  });

  it('jsPsych CSV: pieces in JSON cells rebuild the same recording', async () => {
    const pieces = recordedPieces('P-CSV', 2);
    const rows = jsPsychRows('P-CSV', pieces).map((r) => Object.fromEntries(Object.entries(r).map(
      ([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])));
    const { participants } = await run({ 'P-CSV.csv': Papa.unparse(rows) });
    assert.deepStrictEqual(participants[0].replay.recording.segments.map((s) => s.label), ['t0', 't1']);
  });

  it('a save trial before the end: the rows saved so far give the recording up to there', async () => {
    const pieces = recordedPieces('P-SAVE', 3);
    const rows = jsPsychRows('P-SAVE', pieces).slice(0, 2).map((r) => { delete r.cyborgHunterReplayFinal; return r; });
    const { participants, warnings } = await run({ 'P-SAVE.json': JSON.stringify(rows) });
    const rec = participants[0].replay.recording;
    assert.deepStrictEqual(rec.segments.map((s) => s.label), ['t0', 't1']);
    assert.strictEqual(rec.extensions['cyborg-hunter'].reassembly.missing_end, true);
    assert.ok(!warnings.some((w) => String(w.warnings).match(/missing/)), 'a missing end is not worth a warning');
  });

  it('pages without a framework: one saved field per page, joined into one replay', async () => {
    const page1 = recordedPieces('P-PAGES', 1, 1_751_600_000_000, { final: false });
    const page2 = recordedPieces('P-PAGES', 2, 1_751_600_060_000, { final: false });
    const blob = { participantId: 'P-PAGES', trials: [{ integrity: integrity('P-PAGES', 'span-0') }] };
    const { participants, warnings } = await run({
      'P-PAGES.json': JSON.stringify(blob),
      'P-PAGES-page1-replay.json': JSON.stringify(page1),
      'P-PAGES-page2-replay.json': JSON.stringify(page2),
    });
    assert.strictEqual(participants.length, 1, 'a file of pieces is not participant data');
    const rec = participants[0].replay.recording;
    assert.deepStrictEqual(validateStrict(rec).errors, []);
    assert.deepStrictEqual(rec.segments.map((s) => s.label), ['t0', 't0', 't1']);
    assert.strictEqual(rec.extensions['cyborg-hunter'].merged_pages.length, 2);
    assert.ok(warnings.some((w) => String(w.warnings).match(/joined into one replay/)));
  });

  it('CyborgHunter.data() output saved as is: the pieces beside the session are found', async () => {
    const pieces = recordedPieces('P-DATA', 2, null, { final: false });
    const out = { participantId: 'P-DATA', trials: [{ integrity: integrity('P-DATA', 'span-0') }], cyborgHunterReplay: pieces };
    const { participants } = await run({ 'P-DATA.json': JSON.stringify(out) });
    assert.deepStrictEqual(participants[0].replay.recording.segments.map((s) => s.label), ['t0', 't1']);
  });

  it('a gap in the pieces is rebuilt without it and reported', async () => {
    const pieces = recordedPieces('P-GAP', 3);
    const rows = jsPsychRows('P-GAP', pieces);
    delete rows[1].cyborgHunterReplay;
    const { participants, warnings } = await run({ 'P-GAP.json': JSON.stringify(rows) });
    assert.deepStrictEqual(participants[0].replay.recording.segments.map((s) => s.label), ['t0', 't2']);
    assert.ok(warnings.some((w) => String(w.warnings).match(/1 of them are missing/)));
  });

  it('without the first piece nothing is rebuilt, and that is reported', async () => {
    const pieces = recordedPieces('P-HEAD', 2);
    const rows = jsPsychRows('P-HEAD', pieces);
    delete rows[0].cyborgHunterReplay;
    const { participants, warnings } = await run({ 'P-HEAD.json': JSON.stringify(rows) });
    assert.strictEqual(participants[0].replay, null);
    assert.ok(warnings.some((w) => String(w.warnings).match(/first one, which carries the recording's header, is missing/)));
  });

  it('pieces for a participant who is not in the data are reported, not attached', async () => {
    const stray = recordedPieces('NOBODY', 1);
    const pieces = recordedPieces('P-HERE', 1);
    const { participants, warnings } = await run({
      'P-HERE.json': JSON.stringify(jsPsychRows('P-HERE', pieces)),
      'stray.json': JSON.stringify(stray),
    });
    assert.strictEqual(participants.length, 1);
    assert.ok(participants[0].replay.recording);
    assert.ok(warnings.some((w) => String(w.warnings).match(/recorded for "NOBODY"/)));
  });
});
