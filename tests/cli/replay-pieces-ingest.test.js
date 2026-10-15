// The CLI finds a session recording that arrived in pieces (src/replay/
// pieces.js) wherever the researcher's saving code put them: in the rows of
// a jsPsych or lab.js file (JSON or CSV), in a saved cyborgHunterReplay POST
// field, or in CyborgHunter.data() output. It rebuilds the recording and
// attaches it to the participant whose data file held it (a file of pieces
// alone: by the participant_id it carries); one recording per page of a
// study without a framework is joined into one replay.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Papa from 'papaparse';
import { ingest } from '../../src/cli/ingest.js';
import { createRecorder } from '../../src/replay/recorder.js';
import { createPieceTaker, reassemblePieces } from '../../src/replay/pieces.js';
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

  it('the same recording in the rows and in a saved replay() file counts once, without a warning', async () => {
    const pieces = recordedPieces('P-BOTH', 2);
    const whole = reassemblePieces(pieces);
    const { participants, warnings } = await run({
      'P-BOTH.json': JSON.stringify(jsPsychRows('P-BOTH', pieces)),
      'P-BOTH-replay-1751600000000.json': JSON.stringify(whole),
    });
    assert.deepStrictEqual(participants[0].replay.recording.segments.map((s) => s.label), ['t0', 't1']);
    assert.deepStrictEqual(warnings.filter((w) => /replay/i.test(String(w.warnings))), []);
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

// Who a recording is credited to. Pieces (or recordings) found inside a
// participant's own data file belong to that file's participant only; a file
// of recording data alone is attached by the participant_id it carries, and
// several recordings for one participant are joined, or one chosen, only when
// they were recorded in one browser (user_agent).
const withUa = (pieces, ua) => { pieces.find((p) => p.seq === 0).header.user_agent = ua; return pieces; };
const labels = (p) => p.replay.recording.segments.map((s) => s.label);
const text = (warnings) => warnings.map((w) => w.file + ': ' + w.warnings.join(' ')).join('\n');

describe('ingest: which participant a recording is credited to', () => {
  it('pieces in one participant\'s file whose header names another are attached to no one, with a warning naming the file', async () => {
    const own = recordedPieces('B', 3, 1_700_000_000_000, { recordingId: 'b-own' });
    // Joinable in time with B's recording (a later page), and a copy of B's
    // start with more segments: neither may reach B.
    const later = recordedPieces('A', 2, 1_700_000_900_000, { recordingId: 'later' });
    later[0].header.participant_id = 'B';
    const same = recordedPieces('A', 5, 1_700_000_000_000, { recordingId: 'same' });
    same[0].header.participant_id = 'B';
    same[0].header.recording_started_at_perf = own[0].header.recording_started_at_perf;
    for (const forged of [later, same]) {
      const { participants, warnings } = await run({
        'A.json': JSON.stringify(jsPsychRows('A', forged)),
        'B.json': JSON.stringify(jsPsychRows('B', own)),
      });
      const a = participants.find((p) => p.participantId === 'A');
      const b = participants.find((p) => p.participantId === 'B');
      assert.strictEqual(a.replay, null);
      assert.deepStrictEqual(labels(b), ['t0', 't1', 't2'], 'B keeps their own recording, alone');
      assert.match(text(warnings), /A\.json: .*"B".*not attached/);
      assert.doesNotMatch(text(warnings), /joined/);
    }
  });

  it('pieces in a lab.js file whose header carries ch.js\'s own id (kept as cyborgHunterParticipantId) are the file\'s participant\'s', async () => {
    const pieces = recordedPieces('ch-abc123', 2);
    const rows = jsPsychRows('ch-abc123', pieces).map((r, i) => ({
      ...r, cyborgHunterParticipantId: 'ch-abc123', participantId: i === 0 ? 'STUDY-7' : undefined,
    }));
    const { participants, warnings } = await run({ 'STUDY-7.json': JSON.stringify(rows) });
    assert.strictEqual(participants[0].participantId, 'STUDY-7');
    assert.deepStrictEqual(labels(participants[0]), ['t0', 't1'], text(warnings));
  });

  it('the same recording in the participant\'s rows and in a saved file: the copy from the rows is kept', async () => {
    const pieces = recordedPieces('P-OWN', 3, 1_751_600_000_000);
    const whole = reassemblePieces(pieces);
    // The rows stop at a save trial; the file holds the whole recording.
    const rows = jsPsychRows('P-OWN', pieces).slice(0, 2).map((r) => { delete r.cyborgHunterReplayFinal; return r; });
    const { participants, warnings } = await run({
      'P-OWN.json': JSON.stringify(rows),
      'P-OWN-replay-1751600000000.json': JSON.stringify(whole),
    });
    assert.deepStrictEqual(labels(participants[0]), ['t0', 't1']);
    assert.deepStrictEqual(warnings.filter((w) => /replay/i.test(String(w.warnings))), []);
  });

  it('pieces of one recording id in two participants\' files are not joined across them, and that is reported', async () => {
    const a = recordedPieces('A', 3, 1_700_000_000_000, { recordingId: 'shared', final: false });
    const b = recordedPieces('B', 3, 1_700_000_000_000, { recordingId: 'shared' });
    // B's pieces continue A's numbering, without a header of their own.
    for (const p of b) { p.seq += 3; p.header = null; }
    const { participants, warnings } = await run({
      'A.json': JSON.stringify(jsPsychRows('A', a)),
      'B.json': JSON.stringify(jsPsychRows('B', b)),
    });
    const pa = participants.find((p) => p.participantId === 'A');
    const pb = participants.find((p) => p.participantId === 'B');
    assert.deepStrictEqual(labels(pa), ['t0', 't1', 't2'], 'A keeps only their own pieces');
    assert.strictEqual(pb.replay, null);
    assert.match(text(warnings), /shared.*2 participants/);

    // Both with a header: each keeps their own.
    const a2 = recordedPieces('A', 2, 1_700_000_000_000, { recordingId: 'shared' });
    const b2 = recordedPieces('B', 3, 1_700_000_000_000, { recordingId: 'shared' });
    const second = await run({ 'A.json': JSON.stringify(jsPsychRows('A', a2)), 'B.json': JSON.stringify(jsPsychRows('B', b2)) });
    assert.deepStrictEqual(labels(second.participants.find((p) => p.participantId === 'A')), ['t0', 't1']);
    assert.deepStrictEqual(labels(second.participants.find((p) => p.participantId === 'B')), ['t0', 't1', 't2']);
    assert.match(text(second.warnings), /shared/);
  });

  it('a recording file from another browser than the participant\'s own data is not joined to it', async () => {
    const own = withUa(recordedPieces('B', 3, 1_700_000_000_000, { recordingId: 'b-own' }), 'Browser-B');
    const other = reassemblePieces(withUa(recordedPieces('B', 2, 1_700_000_900_000, { recordingId: 'other' }), 'Browser-X'));
    const sameUa = reassemblePieces(withUa(recordedPieces('B', 1, 1_700_001_800_000, { recordingId: 'next' }), 'Browser-B'));
    const { participants, warnings } = await run({
      'B.json': JSON.stringify(jsPsychRows('B', own)),
      'session-x.json': JSON.stringify(other),
      'session-next.json': JSON.stringify(sameUa),
    });
    const rec = participants[0].replay.recording;
    assert.deepStrictEqual(rec.segments.map((s) => s.label), ['t0', 't1', 't2', 't0'], 'the same browser\'s page is joined');
    assert.strictEqual(rec.user_agent, 'Browser-B');
    assert.match(text(warnings), /session-x\.json.*another browser/);
  });

  // A participant who moved to another device mid-study (a reload on a phone)
  // has recordings from two browsers in their own data. Both are theirs:
  // the browser check is for recordings found elsewhere, and the switch is
  // itself worth seeing.
  it('two browsers within the participant\'s own data: both are kept and joined', async () => {
    const first = withUa(recordedPieces('B', 2, 1_700_000_000_000, { recordingId: 'b-desk' }), 'Browser-Desk');
    const second = withUa(recordedPieces('B', 1, 1_700_000_900_000, { recordingId: 'b-phone' }), 'Browser-Phone');
    const rows = jsPsychRows('B', first).concat(jsPsychRows('B', second));
    const { participants, warnings } = await run({ 'B.json': JSON.stringify(rows) });
    assert.ok(participants[0].replay && participants[0].replay.recording, text(warnings));
    assert.deepStrictEqual(labels(participants[0]), ['t0', 't1', 't0']);
    assert.doesNotMatch(text(warnings), /another browser|different browsers/);
  });

  it('recording files for one participant from different browsers, with none in their own data: none is attached, and that is reported', async () => {
    const blob = { participantId: 'P-UA', trials: [{ integrity: integrity('P-UA', 'span-0') }] };
    const page1 = withUa(recordedPieces('P-UA', 1, 1_751_600_000_000, { final: false }), 'Browser-1');
    const page2 = withUa(recordedPieces('P-UA', 2, 1_751_600_060_000, { final: false }), 'Browser-2');
    const { participants, warnings } = await run({
      'P-UA.json': JSON.stringify(blob),
      'P-UA-page1-replay.json': JSON.stringify(page1),
      'P-UA-page2-replay.json': JSON.stringify(page2),
    });
    assert.strictEqual(participants[0].replay.error, 'ambiguous');
    assert.match(participants[0].replay.reason, /browser/);
    assert.match(text(warnings), /P-UA.*different browsers.*none attached/);
  });

  it('a recording file that copies the participant\'s start with more segments does not replace their own', async () => {
    const own = recordedPieces('B', 2, 1_700_000_000_000, { recordingId: 'b-own' });
    const copy = reassemblePieces(recordedPieces('B', 4, 1_700_000_000_000, { recordingId: 'copy' }));
    copy.recording_started_at_perf = own[0].header.recording_started_at_perf;
    const { participants, warnings } = await run({
      'B.json': JSON.stringify(jsPsychRows('B', own)),
      'session.json': JSON.stringify(copy),
    });
    assert.deepStrictEqual(labels(participants[0]), ['t0', 't1']);
    assert.doesNotMatch(text(warnings), /joined/);
  });

  it('pieces in a data file that gives no participant are reported, not attached', async () => {
    const pieces = recordedPieces('Z', 1);
    const rows = [{ participantId: 'Z', cyborgHunterReplay: pieces[0], cyborgHunterReplayFinal: pieces[1] }];
    const { participants, warnings } = await run({
      'Z.json': JSON.stringify(rows),
      'P-HERE.json': JSON.stringify(jsPsychRows('P-HERE', recordedPieces('P-HERE', 1))),
    });
    assert.deepStrictEqual(participants.map((p) => p.participantId), ['P-HERE']);
    assert.match(text(warnings), /Z\.json: Replay pieces in Z's data file are not attached/);
  });
});
