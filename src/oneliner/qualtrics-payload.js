// src/oneliner/qualtrics-payload.js
// Builds the payload ch.js writes into Qualtrics embedded data. Qualtrics
// rejects a submit whose embedded data is too long (the participant sees an
// error and cannot go on), so the payload is the vanilla blob trimmed to a
// summary and, when that is still too long, reduced level by level until the
// serialized string fits the cap. Pure: no DOM, no monitor.
//
// buildQualtricsPayload({ blob, maxChars }) → { payload, json, chars, level }
//   blob      the vanilla adapter's blob() (Shape 1 rows, one integritySegment
//             per row); never mutated
//   maxChars  the cap on json.length
//   payload.cyborgHunterOneLiner.host = 'qualtrics'
//   payload.cyborgHunterOneLiner.truncated = false at level 0, otherwise
//     { level, droppedSessionEntries: { key: n }, pagesTrimmed, pagesDropped }
//
// The levels are cumulative; each is measured on the serialized string and
// the first that fits is returned:
//   0  trial reports without the raw traces (mouse, element trace, edit
//      timestamps) or pasted/dropped text; segments without windowPositions;
//      ai_report_session cut to AI_REPORT_MAX characters
//   1  each session key keeps its newest KEEP_SESSION_ENTRIES entries
//   2  every row but the newest has its event arrays emptied
//      (integrityTruncated: true); the counts stay in integrityPasteCount etc.
//      and in the segments' counters
//   3  only the newest KEEP_PAGES rows
//   4  the newest row alone, reduced to the schema's required fields, its
//      segment with no deltas; under 3,000 characters for the monitor's score
//      shape. Returned even when it does not fit a smaller cap: the Qualtrics
//      adapter compares `chars` with its cap and refuses to write.
// The newest row's segment carries the monitor's cumulative counters and
// score, which is what the CLI reads them from, so every level keeps them.

export var KEEP_SESSION_ENTRIES = 25;
export var KEEP_PAGES = 5;
export var AI_REPORT_MAX = 500;

var TRACE_KEYS = ['mouseTrack', 'mouseEvents', 'elementTrace', 'editTimestamps'];
// The first four event arrays are required by the trial schema
// (src/shared/schema.js), as are the REQUIRED_SCALARS.
var EVENT_KEYS = ['pasteEvents', 'copyEvents', 'dropEvents', 'tabAwayEvents', 'idleGaps',
  'syntheticInsertions', 'foreignInputEvents'];
var REQUIRED_SCALARS = ['trialId', 'libraryVersion', 'participantId', 'startTime', 'duration_ms',
  'trialSoftScore', 'trialSignals'];
var ROW_COUNT_KEYS = ['trialId', 'integrityPasteCount', 'integrityCopyCount', 'integrityDropCount',
  'integritySoftScore', 'integrityAnyHardTriggered'];

function withoutText(e) {
  if (!e || typeof e !== 'object' || !('text' in e)) return e;
  var c = Object.assign({}, e);
  delete c.text;
  return c;
}

function cut(s, n) {
  return typeof s === 'string' && s.length > n ? s.slice(0, n) : s;
}

// Level 0 for one trial report: a new object without the raw traces, and
// pasted/dropped text removed from fresh copies of the entries.
export function trimTrialReport(report) {
  if (!report || typeof report !== 'object') return report;
  var out = {};
  Object.keys(report).forEach(function (k) {
    if (TRACE_KEYS.indexOf(k) !== -1) return;
    var v = report[k];
    out[k] = (k === 'pasteEvents' || k === 'dropEvents') && Array.isArray(v) ? v.map(withoutText) : v;
  });
  return out;
}

function trimSegment(seg) {
  if (!seg || typeof seg !== 'object') return seg;
  var out = Object.assign({}, seg);
  if (seg.deltas && typeof seg.deltas === 'object') {
    out.deltas = Object.assign({}, seg.deltas);
    delete out.deltas.windowPositions;   // a 2 s poll: the longest session array
  }
  if (Array.isArray(seg.gap)) out.gap = seg.gap.map(trimTrialReport);
  return out;
}

function levelZero(blob) {
  var p = Object.assign({}, blob);
  p.cyborgHunterOneLiner = Object.assign({}, blob.cyborgHunterOneLiner, { host: 'qualtrics', truncated: false });
  p.trials = (blob.trials || []).map(function (row) {
    var r = Object.assign({}, row);
    if (row.integrity) r.integrity = trimTrialReport(row.integrity);
    if (row.integritySegment) r.integritySegment = trimSegment(row.integritySegment);
    return r;
  });
  if ('ai_report_session' in p) p.ai_report_session = cut(p.ai_report_session, AI_REPORT_MAX);
  return p;
}

function segs(p) {
  return p.trials.map(function (r) { return r.integritySegment; })
    .filter(function (s) { return s && s.deltas && typeof s.deltas === 'object'; });
}

function countDropped(t, deltas) {
  Object.keys(deltas || {}).forEach(function (k) {
    if (Array.isArray(deltas[k]) && deltas[k].length) {
      t.droppedSessionEntries[k] = (t.droppedSessionEntries[k] || 0) + deltas[k].length;
    }
  });
}

// Level 1: walk the segments newest first; each key keeps entries until
// KEEP_SESSION_ENTRIES are kept, the older ones are dropped and counted.
function keepNewestSessionEntries(p, t) {
  var left = {};
  segs(p).reverse().forEach(function (s) {
    Object.keys(s.deltas).forEach(function (k) {
      var arr = s.deltas[k];
      if (!Array.isArray(arr)) return;
      if (!(k in left)) left[k] = KEEP_SESSION_ENTRIES;
      var keep = Math.min(arr.length, left[k]);
      if (keep < arr.length) {
        t.droppedSessionEntries[k] = (t.droppedSessionEntries[k] || 0) + arr.length - keep;
        s.deltas[k] = keep ? arr.slice(arr.length - keep) : [];
      }
      left[k] -= keep;
    });
  });
}

// Level 2: every row but the newest loses its per-event detail.
function emptyOlderRows(p, t) {
  p.trials.slice(0, -1).forEach(function (r) {
    if (r.integrity && typeof r.integrity === 'object') {
      EVENT_KEYS.forEach(function (k) { if (Array.isArray(r.integrity[k])) r.integrity[k] = []; });
    }
    if (r.integritySegment) delete r.integritySegment.gap;
    r.integrityTruncated = true;
  });
  t.pagesTrimmed = Math.max(0, p.trials.length - 1);
}

// Level 3: the newest KEEP_PAGES rows. The first segment's config (preset,
// thresholds) moves onto the oldest kept segment so the CLI still bins this
// participant with the thresholds the monitor used.
function keepNewestRows(p, t) {
  if (p.trials.length <= KEEP_PAGES) return;
  var dropped = p.trials.slice(0, p.trials.length - KEEP_PAGES);
  p.trials = p.trials.slice(-KEEP_PAGES);
  var config;
  dropped.forEach(function (r) {
    var s = r.integritySegment;
    if (s && s.deltas) countDropped(t, s.deltas);
    if (s && s.config && config === undefined) config = s.config;
  });
  var first = p.trials[0].integritySegment;
  if (config !== undefined && first && !first.config) first.config = config;
  t.pagesDropped += dropped.length;
  t.pagesTrimmed = p.trials.length - 1;
}

// Level 4: a fixed set of short fields only, so its size does not grow with
// the session.
function minimal(p, t) {
  var out = {
    participantId: p.participantId,
    libraryVersion: p.libraryVersion,
    cyborgHunterOneLiner: p.cyborgHunterOneLiner,
    trials: []
  };
  if ('ai_use_session' in p) out.ai_use_session = p.ai_use_session;
  if ('guard_assistance_violation_count_session' in p) {
    out.guard_assistance_violation_count_session = p.guard_assistance_violation_count_session;
  }
  if ('cyborgHunterError' in p) out.cyborgHunterError = cut(p.cyborgHunterError, AI_REPORT_MAX);
  var last = p.trials[p.trials.length - 1];
  t.pagesDropped += Math.max(0, p.trials.length - 1);
  p.trials.slice(0, -1).forEach(function (r) { if (r.integritySegment) countDropped(t, r.integritySegment.deltas); });
  t.pagesTrimmed = last ? 1 : 0;
  if (!last) return out;
  var row = { integrityTruncated: true };
  ROW_COUNT_KEYS.forEach(function (k) { if (k in last) row[k] = last[k]; });
  if (last.integrity && typeof last.integrity === 'object') {
    row.integrity = {};
    REQUIRED_SCALARS.forEach(function (k) { if (k in last.integrity) row.integrity[k] = last.integrity[k]; });
    EVENT_KEYS.slice(0, 4).forEach(function (k) { row.integrity[k] = []; });
  }
  var s = last.integritySegment;
  if (s && typeof s === 'object') {
    countDropped(t, s.deltas);
    row.integritySegment = { segmentIndex: s.segmentIndex, source: s.source, trialId: s.trialId,
      pageOrigin: s.pageOrigin, deltas: {}, counters: s.counters, score: s.score };
  }
  out.trials.push(row);
  return out;
}

export function buildQualtricsPayload(opts) {
  var maxChars = opts.maxChars;
  var p = levelZero(opts.blob);
  var json = JSON.stringify(p);
  if (json.length <= maxChars) return { payload: p, json: json, chars: json.length, level: 0 };

  // Every later level works on a parsed copy of level 0 (the raw traces are
  // already gone, so the copy is small) and is free to change it in place.
  var work = JSON.parse(json);
  var t = { level: 1, droppedSessionEntries: {}, pagesTrimmed: 0, pagesDropped: 0 };
  work.cyborgHunterOneLiner.truncated = t;
  var steps = [keepNewestSessionEntries, emptyOlderRows, keepNewestRows];
  for (var i = 0; i < steps.length; i++) {
    t.level = i + 1;
    steps[i](work, t);
    json = JSON.stringify(work);
    if (json.length <= maxChars) return { payload: work, json: json, chars: json.length, level: t.level };
  }
  t.level = 4;
  var last = minimal(work, t);
  json = JSON.stringify(last);
  return { payload: last, json: json, chars: json.length, level: 4 };
}
