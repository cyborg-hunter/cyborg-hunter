// tests/replay/pieces.test.js
// A recording delivered in pieces (src/replay/pieces.js), one per trial end,
// and put back together by the reader.
//
// Why pieces exist: a save-as-a-trial plugin (DataPipe's jsPsychPipe) takes
// its snapshot of jsPsych.data when the save trial STARTS, before the
// session's end code runs, so a recording attached at the end never reaches
// the saved file. Pieces ride in each trial's row instead, the way the
// integrity segments already do.
//
// The pieces are a transport, not a format. The machine check that keeps it
// that way: reassembling every piece of a recording yields EXACTLY what
// serialize() returns for the same buffer (without the CH report merge, which
// pieces never carry because the integrity data sits beside them), and the
// result passes the strict conformance profile.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRecorder } from '../../src/replay/recorder.js';
import { serialize } from '../../src/replay/serializer.js';
import { createPieceTaker, reassemblePieces, groupPieces, isPiece } from '../../src/replay/pieces.js';
import { validateStrict } from '../../src/shared/schema-v2-validator.js';

const HOST = { name: 'jspsych', version: '7.3.1' };

function strict(rec) {
  const result = validateStrict(rec);
  assert.deepEqual(result.errors, [], 'strict validation errors');
  return rec;
}

// A JSON round trip, as a CSV cell or a POST body would put a piece through.
const viaJson = (p) => JSON.parse(JSON.stringify(p));

// A three-trial session with events between trials (an implicit segment),
// session-level stream entries and a capture failure, cut into pieces at
// each trial end and once more at the end.
function session() {
  const rec = createRecorder({ participantId: 'P-PIECES', autoSave: { mode: 'none' }, _ownerSavesRecording: true });
  const taker = createPieceTaker(() => rec.getState(), { host: HOST, recordingId: 'rid-1' });
  const pieces = [];
  rec.startSession();
  rec.pushViewportChange({ w: 1000, h: 700, dpr: 1, scale: 1, offset_x: 0, offset_y: 0 });

  rec.startTrial({ trialId: 'q1', plugin: 'survey-text' });
  rec.pushRecord({ type: 'mouse.move', x: 1, y: 2 });
  rec.pushRecord({ type: 'key.down', key: 'a', code: 'KeyA', mods: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false, target: null });
  rec.endTrial();
  pieces.push(taker.take());

  // Between trials: lands in an implicit segment, closed by the next startTrial.
  rec.pushRecord({ type: 'mouse.move', x: 3, y: 4 });
  rec.pushGuardViolation({ reason: 'tab_hidden' });

  rec.startTrial({ trialId: 'q2', plugin: 'survey-text' });
  rec.pushRecord({ type: 'mouse.click', x: 5, y: 6, button: 0, target: null });
  rec.pushViewportChange({ w: 900, h: 700, dpr: 1, scale: 1, offset_x: 0, offset_y: 0 });
  rec.captureFailure('test_channel', new Error('a failure mid-trial'));
  rec.endTrial();
  pieces.push(taker.take());

  rec.startTrial({ trialId: 'q3', plugin: 'html-button-response' });
  rec.pushRecord({ type: 'mouse.click', x: 7, y: 8, button: 0, target: null });
  rec.endTrial();
  pieces.push(taker.take());

  rec.stopSession('finished');
  pieces.push(taker.take({ final: true }));
  return { rec, pieces };
}

describe('pieces: round trip', () => {
  it('every piece, reassembled, equals serialize() of the same buffer', () => {
    const { rec, pieces } = session();
    const whole = serialize(rec.getState(), { host: HOST });
    const back = strict(reassemblePieces(pieces.map(viaJson)));
    assert.deepEqual(back, whole);
  });

  it('piece order does not matter', () => {
    const { rec, pieces } = session();
    const shuffled = [pieces[2], pieces[0], pieces[3], pieces[1]].map(viaJson);
    assert.deepEqual(reassemblePieces(shuffled), serialize(rec.getState(), { host: HOST }));
  });

  it('each piece carries only what closed since the previous one', () => {
    const { pieces } = session();
    assert.deepEqual(pieces.map(p => p.segments.map(s => s.label)),
      [['q1'], ['__session__', 'q2'], ['q3'], []]);
    // Positional indices continue across pieces.
    assert.deepEqual(pieces.flatMap(p => p.segments.map(s => s.index)), [0, 1, 2, 3]);
    assert.ok(pieces[0].header, 'the first piece carries the header');
    assert.equal(pieces[1].header, null);
    assert.equal(pieces[3].end.end_reason, 'finished');
    assert.deepEqual(pieces.map(p => p.seq), [0, 1, 2, 3]);
    assert.ok(pieces.every(isPiece));
  });

  it('an open trial waits for the piece after it closes', () => {
    const rec = createRecorder({ participantId: 'P', autoSave: { mode: 'none' }, _ownerSavesRecording: true });
    const taker = createPieceTaker(() => rec.getState(), { recordingId: 'r' });
    rec.startSession();
    rec.startTrial({ trialId: 'open' });
    rec.pushRecord({ type: 'mouse.move', x: 1, y: 1 });
    const p0 = taker.take();
    assert.deepEqual(p0.segments, []);
    rec.endTrial();
    const p1 = taker.take();
    assert.deepEqual(p1.segments.map(s => s.label), ['open']);
  });

  it('a later change to the stylesheets ships in a later piece', () => {
    const rec = createRecorder({ participantId: 'P', autoSave: { mode: 'none' }, _ownerSavesRecording: true });
    const taker = createPieceTaker(() => rec.getState(), { recordingId: 'r' });
    rec.startSession();
    const sheets = [{ id: 1, kind: 'link', href: 'https://example.org/a.css', css: null, media: null }];
    rec.setStylesheets(sheets);
    rec.startTrial({ trialId: 't' });
    rec.endTrial();
    const p0 = taker.take();
    // A cross-origin fill lands after the first piece (capture-dom fills the
    // sheet objects in place).
    sheets[0].css = '.late{}';
    rec.stopSession('finished');
    const p1 = taker.take({ final: true });
    assert.equal(p0.stylesheets[0].css, null);
    assert.equal(p1.stylesheets[0].css, '.late{}');
    assert.deepEqual(reassemblePieces([p0, p1].map(viaJson)), serialize(rec.getState(), {}));
  });
});

describe('pieces: incomplete deliveries', () => {
  it('without the final piece the recording is valid and says its end is missing', () => {
    const { pieces } = session();
    const rec = strict(reassemblePieces(pieces.slice(0, 3).map(viaJson)));
    assert.equal(rec.segments.length, 4);
    assert.equal(rec.end_reason, 'aborted');
    assert.deepEqual(rec.extensions['cyborg-hunter'].reassembly,
      { complete: false, missing_seq_ranges: [], missing_end: true });
  });

  it('a gap in the sequence leaves out those segments and names the gap', () => {
    const { pieces } = session();
    const rec = strict(reassemblePieces([pieces[0], pieces[2], pieces[3]].map(viaJson)));
    assert.deepEqual(rec.segments.map(s => s.label), ['q1', 'q3']);
    assert.deepEqual(rec.segments.map(s => s.index), [0, 1]);
    assert.deepEqual(rec.extensions['cyborg-hunter'].reassembly,
      { complete: false, missing_seq_ranges: [[1, 1]], missing_end: false });
  });

  it('a complete delivery carries no reassembly note', () => {
    const { pieces } = session();
    assert.equal(reassemblePieces(pieces).extensions['cyborg-hunter'].reassembly, undefined);
  });

  it('without the first piece there is no header to build from', () => {
    const { pieces } = session();
    assert.throws(() => reassemblePieces(pieces.slice(1)), /header/);
  });
});

describe('pieces: grouping', () => {
  it('groups pieces by recording and ignores anything that is not a piece', () => {
    const a = session().pieces;
    const b = session().pieces.map(p => Object.assign({}, p, { recording_id: 'rid-2' }));
    const groups = groupPieces([a[1], b[0], { not: 'a piece' }, null, a[0], b[1]]);
    assert.deepEqual([...groups.keys()].sort(), ['rid-1', 'rid-2']);
    assert.equal(groups.get('rid-1').length, 2);
  });

  it('a repeated piece (the same seq twice, e.g. a re-saved row) counts once', () => {
    const { rec, pieces } = session();
    const twice = [...pieces, pieces[1]].map(viaJson);
    assert.deepEqual(reassemblePieces(twice), serialize(rec.getState(), { host: HOST }));
  });
});

// The same check on a real capture: happy-dom, the dom tier (keyframes, DOM
// patches, form state), typing, and pieces taken at each trial end through
// the public recorder API, as the one-line setup will.
import { Window } from 'happy-dom';
import * as CHReplay from '../../src/replay/index.js';

describe('pieces: a real dom-tier capture', () => {
  it('reassembles to exactly what getRecording() returns', async () => {
    const win = new Window({ url: 'https://example.org/exp/' });
    win.document.body.innerHTML = '<div id="stage"><p id="msg">Q?</p><input id="answer" type="text"></div>';
    const saved = { window: globalThis.window, document: globalThis.document,
      MutationObserver: globalThis.MutationObserver, requestAnimationFrame: globalThis.requestAnimationFrame };
    let raf = [];
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.MutationObserver = win.MutationObserver;
    globalThis.requestAnimationFrame = (fn) => raf.push(fn);
    async function settle() {
      for (let i = 0, quiet = 0; i < 50 && quiet < 2; i++) {
        await new Promise((r) => setImmediate(r));
        if (raf.length) { raf.splice(0).forEach((fn) => fn(0)); quiet = 0; } else quiet++;
      }
    }
    try {
      const doc = win.document;
      const api = CHReplay.attach({ participantId: 'P-DOM', tier: 'dom', root: '#stage',
        keyframeEvery: 1, autoSave: { mode: 'none' }, _ownerSavesRecording: true });
      const taker = api.pieceTaker({ host: HOST, recordingId: 'dom-1' });
      const pieces = [];
      api.startSession();
      for (const id of ['t1', 't2', 't3']) {
        api.startTrial({ trialId: id });
        await settle();
        const input = doc.getElementById('answer');
        input.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, key: 'x', code: 'KeyX' }));
        input.value += 'x';
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
        doc.getElementById('msg').textContent = 'Q after ' + id;
        await settle();
        api.endTrial();
        pieces.push(taker.take());
        // Between trials: a DOM change lands in an implicit segment.
        doc.getElementById('msg').textContent = 'between ' + id;
        await settle();
      }
      api.stopSession('finished');
      pieces.push(taker.take({ final: true }));
      const whole = strict(api.getRecording({ host: HOST }));
      const back = strict(reassemblePieces(pieces.map(viaJson)));
      assert.deepEqual(back, whole);
      assert.ok(whole.segments.length >= 3);
      assert.ok(whole.segments.some((s) => s.events.some((e) => e.type.startsWith('dom.'))), 'DOM patches were recorded');
      assert.ok(whole.segments.some((s) => s.events.some((e) => e.type === 'key.down')), 'keys were recorded');
      api.destroy();
    } finally {
      Object.assign(globalThis, { window: saved.window, document: saved.document, MutationObserver: saved.MutationObserver });
      if (saved.requestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = saved.requestAnimationFrame;
    }
  });
});

describe('pieces: skipEmpty', () => {
  it('a take with nothing new returns null and keeps the sequence unbroken', () => {
    const rec = createRecorder({ participantId: 'P', autoSave: { mode: 'none' }, _ownerSavesRecording: true });
    const taker = createPieceTaker(() => rec.getState(), { recordingId: 'r' });
    rec.startSession();
    const p0 = taker.take({ skipEmpty: true });       // the header always goes
    assert.equal(p0.seq, 0);
    assert.equal(taker.take({ skipEmpty: true }), null);
    rec.startTrial({ trialId: 'a' });
    rec.endTrial();
    const p1 = taker.take({ skipEmpty: true });
    assert.equal(p1.seq, 1);
    rec.stopSession('finished');
    const p2 = taker.take({ final: true, skipEmpty: true });
    assert.equal(p2.seq, 2);
    assert.equal(reassemblePieces([p0, p1, p2]).extensions['cyborg-hunter'].reassembly, undefined);
  });
});

describe('pieces: hostile input', () => {
  // Pieces come from participant data. An edited seq must not make a reader
  // walk to it or allocate per missing value.
  it('a seq far past any real session is not a piece; a large gap is one range', () => {
    const { pieces } = session();
    const far = Object.assign({}, pieces[1], { seq: 2 ** 31 });
    assert.equal(isPiece(far), false);
    const late = Object.assign({}, pieces[1], { seq: 90000 });
    const t0 = Date.now();
    const rec = reassemblePieces([pieces[0], late, pieces[2]]);
    assert.ok(Date.now() - t0 < 100, 'no walk over the gap');
    assert.deepEqual(rec.extensions['cyborg-hunter'].reassembly.missing_seq_ranges, [[1, 1], [3, 89999]]);
  });
});
