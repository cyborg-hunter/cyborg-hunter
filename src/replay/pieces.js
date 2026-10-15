// src/replay/pieces.js
// A recording delivered in pieces, and put back together.
//
// Why: a save-as-a-trial plugin (DataPipe's jsPsychPipe, jsPsychSavePavlovia)
// takes its snapshot of jsPsych.data when the save trial STARTS, before the
// session's end code runs. A recording attached at the end of the session
// never reaches that file. So under the one-line setup the recording travels
// the way the integrity segments do: a piece in each trial's row (or, on a
// page without jsPsych, in each POST), holding what closed since the last
// piece. A save trial then has every piece before it, and the loss bound is
// the integrity data's: only what follows the last saved row can be missing.
//
// Pieces are a TRANSPORT. What anything reads is still a SessionRecording v2,
// rebuilt here. The machine check (tests/replay/pieces.test.js): every piece
// of a recording, reassembled, equals serialize() of the same buffer without
// the CH report merge, which pieces never carry because the integrity data
// already sits beside them.
//
// A piece:
//   { kind: 'ch-replay-piece', v: 1,
//     recording_id,     ties the pieces of one recording together
//     seq,              0, 1, 2 …; gaps are named on reassembly
//     header,           the first piece only (serializer.js headerOut)
//     stylesheets,      when they changed since the last piece (cross-origin
//                       fills land in place after the start), else absent
//     segments,         the segments closed since the last piece, v2 shape,
//                       with their position in the whole recording as index
//     streams: { viewport_changes, guard_violations, root_attr_events,
//                capture_failures },   entries since the last piece
//     capture_stopped,  the flag as it stands (it only ever turns on)
//     end }             { ended_at_perf, end_reason } on the final piece, else null

import {
  segmentOut, streamOut, byTime, convertTimes, headerOut, assembleRecording
} from './serializer.js';

export var PIECE_KIND = 'ch-replay-piece';
export var PIECE_VERSION = 1;

function randomId() {
  var c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (c && typeof c.getRandomValues === 'function') {
    var b = new Uint8Array(8);
    c.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/**
 * createPieceTaker(getState, opts) → { recordingId, take({ final }) }
 *   getState  — the recorder's getState (read at every take)
 *   opts.host — spec §2 host record, written into the header
 *   opts.recordingId — fixed id (tests); random otherwise
 *
 * take({ final, skipEmpty }) returns the next piece. With skipEmpty, a
 * piece that would carry nothing new returns null and uses no seq (a
 * trial that never opened a segment, e.g. jsPsych's call-function, then
 * adds nothing to its row). take() never throws once the session started
 * (a serialization failure is the caller's to catch and note). The cursors
 * advance only after the piece is built, so a failed take loses nothing: the
 * next one covers it.
 */
export function createPieceTaker(getState, opts) {
  opts = opts || {};
  var recordingId = opts.recordingId || randomId();
  var seq = 0;
  var segmentsSent = 0;
  var sent = { viewportChanges: 0, guardViolations: 0, rootAttrEvents: 0, captureFailures: 0 };
  var sheetsSent = null;   // JSON of the stylesheets as last sent

  function take(takeOpts) {
    var final = !!(takeOpts && takeOpts.final);
    var state = getState();
    var s0 = state.sessionStart;
    if (s0 == null) throw new Error('[cyborg-hunter-replay] no piece before startSession()');

    // Closed segments only (tEnd set), except on the final piece, which takes
    // whatever is left, an open segment included (serialize() does the same).
    var trials = state.trials;
    var upto = segmentsSent;
    while (upto < trials.length && (final || trials[upto].tEnd != null)) upto++;
    var segments = [];
    for (var i = segmentsSent; i < upto; i++) segments.push(segmentOut(trials[i], i, s0).segment);

    var vc = state.viewportChanges || [];
    var gv = state.guardViolations || [];
    var ra = state.rootAttrEvents || [];
    var cf = state.captureFailures || [];
    var piece = {
      kind: PIECE_KIND,
      v: PIECE_VERSION,
      recording_id: recordingId,
      seq: seq,
      header: seq === 0 ? headerOut(state, { host: opts.host || null }) : null,
      segments: segments,
      streams: {
        // Sorted within the piece; see reassemblePieces for why that is
        // enough for the whole stream to come back in serialize()'s order.
        viewport_changes: streamOut(byTime(vc.slice(sent.viewportChanges)), s0),
        guard_violations: convertTimes(gv.slice(sent.guardViolations), s0),
        root_attr_events: convertTimes(ra.slice(sent.rootAttrEvents), s0),
        capture_failures: convertTimes(cf.slice(sent.captureFailures), s0)
      },
      capture_stopped: !!state.captureStopped,
      end: null
    };
    var sheetsJson = JSON.stringify(state.stylesheets || []);
    if (sheetsJson !== sheetsSent) piece.stylesheets = JSON.parse(sheetsJson);
    if (takeOpts && takeOpts.skipEmpty && !final && !piece.header && !piece.stylesheets &&
        !segments.length && !piece.streams.viewport_changes.length && !piece.streams.guard_violations.length &&
        !piece.streams.root_attr_events.length && !piece.streams.capture_failures.length) {
      return null;
    }
    if (final) {
      // serialize()'s ended_at_perf: the last moment any segment observed.
      var lastT = s0;
      for (var j = 0; j < trials.length; j++) {
        var t = endOf(trials[j]);
        if (t > lastT) lastT = t;
      }
      piece.end = { ended_at_perf: lastT, end_reason: state.endReason || 'aborted' };
    }

    seq++;
    segmentsSent = upto;
    sent.viewportChanges = vc.length;
    sent.guardViolations = gv.length;
    sent.rootAttrEvents = ra.length;
    sent.captureFailures = cf.length;
    sheetsSent = sheetsJson;
    return piece;
  }

  return { recordingId: recordingId, take: take };
}

// segmentOut's lastT without copying the events.
function endOf(trial) {
  var last = trial.tLoad;
  var ev = trial.events;
  if (ev.length) {
    last = ev[0].t;
    for (var i = 1; i < ev.length; i++) if (ev[i].t > last) last = ev[i].t;
  }
  if (trial.tEnd != null && trial.tEnd > last) last = trial.tEnd;
  return last;
}

export function isPiece(p) {
  return !!p && typeof p === 'object' && p.kind === PIECE_KIND && p.v === PIECE_VERSION &&
    typeof p.recording_id === 'string' && p.recording_id !== '' &&
    typeof p.seq === 'number' && p.seq >= 0 && Math.floor(p.seq) === p.seq &&
    Array.isArray(p.segments) && !!p.streams && typeof p.streams === 'object';
}

// Pieces by recording, in no particular order; anything that is not a piece
// is ignored. → Map<recording_id, piece[]>
export function groupPieces(list) {
  var groups = new Map();
  (list || []).forEach(function (p) {
    if (!isPiece(p)) return;
    if (!groups.has(p.recording_id)) groups.set(p.recording_id, []);
    groups.get(p.recording_id).push(p);
  });
  return groups;
}

/**
 * The pieces of ONE recording → a SessionRecording v2.
 *
 * Order-independent, and a repeated piece (the same seq twice, e.g. a row
 * saved twice) counts once. A delivery with parts missing still yields a
 * valid recording: missing segments are left out (positions close up), a
 * missing final piece leaves end_reason 'aborted' with ended_at_perf at the
 * last observed moment, and the CH vendor block names what is missing as
 * `reassembly: { complete: false, missing_seq, missing_end }`. Throws only
 * when the first piece, the one with the header, is missing.
 *
 * Stream order: each piece's viewport entries are sorted, and pieces hold
 * consecutive slices of the recorder's push order. The recorder runs its
 * boundary flushes before every segment closes, so nothing older than a
 * piece's entries arrives after it; concatenation in seq order is then the
 * whole stream sorted, which is what serialize() writes. The other streams
 * are unsorted in serialize() too, and concatenate in push order.
 */
export function reassemblePieces(pieces) {
  var bySeq = new Map();
  (pieces || []).forEach(function (p) {
    if (isPiece(p) && !bySeq.has(p.seq)) bySeq.set(p.seq, p);
  });
  var first = bySeq.get(0);
  if (!first || !first.header) {
    throw new Error('the first piece of the recording (the one with its header) is missing');
  }
  var seqs = Array.from(bySeq.keys()).sort(function (a, b) { return a - b; });
  var maxSeq = seqs[seqs.length - 1];
  var finalSeq = null;
  seqs.forEach(function (s) { if (bySeq.get(s).end) finalSeq = s; });
  var lastSeq = finalSeq != null ? Math.max(finalSeq, maxSeq) : maxSeq;
  var missing = [];
  for (var s = 0; s <= lastSeq; s++) if (!bySeq.has(s)) missing.push(s);

  var segments = [];
  var vc = [], gv = [], ra = [], cf = [];
  var stylesheets = [];
  var captureStopped = false;
  var end = null;
  seqs.forEach(function (sq) {
    var p = bySeq.get(sq);
    p.segments.forEach(function (seg) {
      segments.push(Object.assign({}, seg, { index: segments.length }));
    });
    var st = p.streams || {};
    Array.prototype.push.apply(vc, st.viewport_changes || []);
    Array.prototype.push.apply(gv, st.guard_violations || []);
    Array.prototype.push.apply(ra, st.root_attr_events || []);
    Array.prototype.push.apply(cf, st.capture_failures || []);
    if (Array.isArray(p.stylesheets)) stylesheets = p.stylesheets;
    if (p.capture_stopped) captureStopped = true;
    if (p.end) end = p.end;
  });

  var h = first.header;
  if (!end) {
    // The last observed moment, back on the capture clock.
    var last = 0;
    segments.forEach(function (seg) {
      if (typeof seg.t_end === 'number' && seg.t_end > last) last = seg.t_end;
      seg.events.forEach(function (e) { if (typeof e.t === 'number' && e.t > last) last = e.t; });
    });
    end = { ended_at_perf: h.recording_started_at_perf + last, end_reason: 'aborted' };
  }

  var reassembly = (missing.length || finalSeq == null)
    ? { complete: false, missing_seq: missing, missing_end: finalSeq == null }
    : null;

  return assembleRecording({
    header: h,
    stylesheets: stylesheets,
    viewportChanges: vc.slice().sort(function (a, b) { return a.t - b.t; }),
    guardViolations: gv,
    rootAttrEvents: ra,
    captureFailures: cf,
    captureStopped: captureStopped,
    chReport: null,
    end: end,
    segments: segments,
    reassembly: reassembly
  });
}
