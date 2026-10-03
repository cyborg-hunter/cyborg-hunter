// src/oneliner/qualtrics-payload.js
// Builds the payload ch.js writes into Qualtrics embedded data. Qualtrics
// rejects a submit whose embedded data is too long (the participant sees an
// error and cannot go on), so the payload is a summary of the vanilla blob
// and, when that is still too long, is reduced level by level until the
// serialized string fits the cap. Pure: no DOM, no monitor.
//
// The summary is built from allowlists, not by deleting known fields: each
// object (the blob, a row, a trial report, a segment and its deltas, a score,
// an event) keeps only the fields listed below, a number only when it is
// finite, and a string with its control characters removed, cut to LABEL_MAX
// UTF-16 code units (an error note: NOTE_MAX). So the payload never holds
// typed, pasted or dropped text, the honeypot's self-report text (only its
// length), mouse or element traces, keystroke timings or window positions,
// and a field ch.js does not know never reaches Qualtrics. A session array or
// trial-report field the monitor gains later has to be added here on purpose
// (a test pins these lists against the monitor's own fields), whereas
// segment-diff.js ships every array the monitor has.
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
//   0  the summary
//   1  each session array keeps its newest KEEP_SESSION_ENTRIES entries
//   2  every row but the newest has its event arrays emptied
//      (integrityTruncated: true); the counts stay in integrityPasteCount etc.
//      and in the segments' counters
//   3  only the newest KEEP_PAGES rows
//   4  the newest row alone, reduced to the schema's required fields, its
//      segment with no deltas
// The newest row's segment carries the monitor's cumulative counters and
// score, which is what the CLI reads them from, so every level keeps them.

export var KEEP_SESSION_ENTRIES = 25;
export var KEEP_PAGES = 5;
export var LABEL_MAX = 128;   // ids, names, types: UTF-16 code units
export var NOTE_MAX = 500;    // cyborgHunterError notes

function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// The kinds of value a field can hold: each returns what to keep, or
// undefined to leave the field out.
function num(v) { return typeof v === 'number' && isFinite(v) ? v : undefined; }
function bool(v) { return v === true || v === false || v === null ? v : undefined; }   // null: isKnownInput without a container
function text(v, max) {
  if (typeof v !== 'string') return undefined;
  if (v.length <= max && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/.test(v)) return v;
  var out = '';
  for (var i = 0; i < v.length && out.length < max; i++) {
    var c = v.charCodeAt(i);
    if (c < 32 || (c >= 127 && c < 160)) continue;   // control characters (6 bytes each once escaped)
    if (c >= 0xd800 && c < 0xdc00 && (v.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      if (out.length + 2 > max) break;               // a pair is kept whole or not at all
      out += v.slice(i, i + 2);
      i++;
    } else {
      out += c >= 0xd800 && c < 0xe000 ? '�' : v[i];   // a lone surrogate would serialize as an escape
    }
  }
  return out;
}
function label(v) { return text(v, LABEL_MAX); }
function note(v) { return text(v, NOTE_MAX); }

// A new object holding only spec's fields, each passed through its kind;
// undefined when v is not an object.
function pick(v, spec) {
  if (!isObject(v)) return undefined;
  var out = {};
  Object.keys(spec).forEach(function (k) {
    var kept = spec[k](v[k]);
    if (kept !== undefined) out[k] = kept;
  });
  return out;
}
function fields(spec) { return function (v) { return pick(v, spec); }; }
function listOf(spec) {
  return function (v) {
    return Array.isArray(v) ? v.map(function (e) { return pick(e, spec) || {}; }) : undefined;
  };
}
function nums(v) {
  return Array.isArray(v) ? v.filter(function (n) { return num(n) !== undefined; }) : undefined;
}

// Events, in the shapes src/core/signals writes them.
var PASTE = listOf({ type: label, t: num, pastedLength: num, isKnownInput: bool });   // never `text`
var COPY = listOf({ type: label, t: num, selectedLength: num });
var DROP = listOf({ type: label, t: num, droppedLength: num, isKnownInput: bool });   // never `text`
var TAB_AWAY = listOf({ start: num, duration_ms: num, type: label, timestamp: label });
var IDLE = listOf({ duration_ms: num, t: num });
var INSERTION = listOf({ type: label, t: num, dataLength: num });
var FOREIGN = listOf({ t: num, targetTag: label, targetId: label, targetClass: label, inputType: label });   // never `data`: the typed text

// The trial report's event arrays (level 2 empties them on older rows).
var EVENTS = { pasteEvents: PASTE, copyEvents: COPY, dropEvents: DROP, tabAwayEvents: TAB_AWAY,
  idleGaps: IDLE, syntheticInsertions: INSERTION, foreignInputEvents: FOREIGN };

var HARD_SIGNAL = fields({ trialHits: num, sessionTotal: num, countThreshold: num });
var SOFT_SIGNAL = fields({ hits: num, capped: num, score: num });
// A trial report (monitor.js endTrial) without mouseTrack, elementTrace,
// editTimestamps, the mouse-cap flags and decoy (whose injectedText is page
// text).
var TRIAL = Object.assign({
  trialId: label, phase: label, startTime: num, duration_ms: num, libraryVersion: label, participantId: label,
  timestamp: label, charsPerSec: num, trialSoftScore: num,
  mouseMetrics: fields({ pathEfficiency: num, directionChanges: num, speedVariance: num, moveCount: num }),
  trialSignals: fields({
    hard: fields({ paste: HARD_SIGNAL, copy: HARD_SIGNAL, drop: HARD_SIGNAL }),
    soft: fields({ copy: SOFT_SIGNAL, tabAway: SOFT_SIGNAL, sidebarEvent: SOFT_SIGNAL, devTools: SOFT_SIGNAL,
      foreignInput: SOFT_SIGNAL, typingSpeed: fields({ charsPerSec: num, threshold: num, hit: num, score: num }) })
  })
}, EVENTS);

// The monitor's session arrays as segment-diff.js ships them, without
// windowPositions (a 2 s poll of where the window sits on the screen).
var DELTAS = {
  tabAwaySums: nums, tabAwayEvents: TAB_AWAY, charsPerSec: nums, idleGaps: IDLE,
  sidebarEvents: listOf({ type: label, method: label, deltaIW: num, innerWidth: num, baselineIW: num, gap: num, duration_ms: num, t: num }),
  devToolsEvents: listOf({ t: num }),
  aiExtensionsFound: listOf({ name: label, t: num }),
  keyboardShortcuts: listOf({ combo: label, t: num }),
  extensionInjections: listOf({ tag: label, hasShadow: bool, t: num }),
  viewportWidthShifts: listOf({ oldWidth: num, newWidth: num, delta: num, t: num }),
  zoomChanges: listOf({ from: num, to: num, t: num })
};

var HARD = fields({ count: num, threshold: num, triggered: bool });
var SEGMENT = fields({
  segmentIndex: num, source: label, trialId: label, pageOrigin: num,
  deltas: fields(DELTAS),
  counters: fields({ pasteCount: num, copyCount: num, dropCount: num }),
  score: fields({ hardScore: fields({ paste: HARD, copy: HARD, drop: HARD }), softScore: num,
    softScoreThreshold: num, anyHardTriggered: bool, trialsCompleted: num }),
  gap: listOf({ duration_ms: num, pasteEvents: PASTE, copyEvents: COPY, dropEvents: DROP, syntheticInsertions: INSERTION }),
  config: fields({ preset: label, participantId: label, thresholds: fields({ tabAwayDurationMs: num, typingSpeedCps: num }) }),
  libraryVersion: label
});
var ROW = fields({
  trialId: label, integrity: fields(TRIAL), integritySegment: SEGMENT,
  integrityPasteCount: num, integrityCopyCount: num, integrityDropCount: num,
  integritySoftScore: num, integrityAnyHardTriggered: bool, cyborgHunterError: note
});
var VIOLATION = listOf({ reason: label, start: num, end: num, duration: num, in_progress: bool, pageOrigin: num });

// Level 0 for one trial report (exported for the tests).
export function trimTrialReport(report) { return pick(report, TRIAL); }

// The honeypot's violation log is a JSON string (adapters/vanilla.js).
function violationLog(v) {
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return undefined; }
  }
  return Array.isArray(v) ? JSON.stringify(VIOLATION(v)) : undefined;
}

// Level 0. ai_report_session is the honeypot's free-text box, which the
// participant writes: only its length is kept.
function summary(b) {
  var p = pick(b, { participantId: label, libraryVersion: label });
  p.cyborgHunterOneLiner = Object.assign(pick(b.cyborgHunterOneLiner, { version: label, pageCount: num }) || {},
    { host: 'qualtrics', truncated: false });
  p.trials = Array.isArray(b.trials) ? b.trials.map(ROW).filter(Boolean) : [];
  Object.assign(p, pick(b, { guard_assistance_violations_session: violationLog,
    guard_assistance_violation_count_session: num, ai_use_session: bool, cyborgHunterError: note }));
  if (typeof b.ai_report_session === 'string') p.ai_report_session_length = b.ai_report_session.length;
  return p;
}

function segments(p) {
  return p.trials.map(function (r) { return r.integritySegment; })
    .filter(function (s) { return s && s.deltas; });
}

function countDropped(t, key, n) {
  if (n > 0) t.droppedSessionEntries[key] = (t.droppedSessionEntries[key] || 0) + n;
}

function countDeltas(t, deltas) {
  Object.keys(deltas || {}).forEach(function (k) { countDropped(t, k, deltas[k].length); });
}

// Level 1: walk the segments newest first; each key keeps entries until
// KEEP_SESSION_ENTRIES are kept, the older ones are dropped and counted.
function keepNewestSessionEntries(p, t) {
  var left = {};
  segments(p).reverse().forEach(function (s) {
    Object.keys(s.deltas).forEach(function (k) {
      var arr = s.deltas[k];
      if (!(k in left)) left[k] = KEEP_SESSION_ENTRIES;
      var keep = Math.min(arr.length, left[k]);
      countDropped(t, k, arr.length - keep);
      s.deltas[k] = arr.slice(arr.length - keep);
      left[k] -= keep;
    });
  });
}

// Level 2: every row but the newest loses its per-event detail.
function emptyOlderRows(p, t) {
  p.trials.slice(0, -1).forEach(function (r) {
    if (r.integrity) Object.keys(EVENTS).forEach(function (k) { if (r.integrity[k]) r.integrity[k] = []; });
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
  var dropped = p.trials.slice(0, -KEEP_PAGES);
  p.trials = p.trials.slice(-KEEP_PAGES);
  var config;
  dropped.forEach(function (r) {
    var s = r.integritySegment;
    if (!s) return;
    countDeltas(t, s.deltas);
    if (!config) config = s.config;
  });
  var first = p.trials[0].integritySegment;
  if (config && first && !first.config) first.config = config;
  t.pagesDropped += dropped.length;
  t.pagesTrimmed = p.trials.length - 1;
}

function copy(to, from, keys) {
  keys.forEach(function (k) { if (k in from) to[k] = from[k]; });
  return to;
}

// Level 4: the newest row with the schema's required fields only; every
// value was bounded at level 0, so its size does not grow with the session.
function newestOnly(p, t) {
  var last = p.trials[p.trials.length - 1];
  p.trials.forEach(function (r) { if (r.integritySegment) countDeltas(t, r.integritySegment.deltas); });
  t.pagesDropped += Math.max(0, p.trials.length - 1);
  t.pagesTrimmed = last ? 1 : 0;
  var out = copy({}, p, ['participantId', 'libraryVersion', 'cyborgHunterOneLiner', 'ai_use_session',
    'ai_report_session_length', 'guard_assistance_violation_count_session', 'cyborgHunterError']);
  out.trials = [];
  if (!last) return out;
  var row = copy({}, last, ['trialId', 'integrityPasteCount', 'integrityCopyCount', 'integrityDropCount',
    'integritySoftScore', 'integrityAnyHardTriggered']);
  row.integrityTruncated = true;
  if (last.integrity) {
    row.integrity = copy({}, last.integrity, ['trialId', 'libraryVersion', 'participantId', 'startTime',
      'duration_ms', 'trialSoftScore', 'trialSignals']);
    ['pasteEvents', 'copyEvents', 'dropEvents', 'tabAwayEvents'].forEach(function (k) { row.integrity[k] = []; });
  }
  var s = last.integritySegment;
  if (s) {
    row.integritySegment = copy({}, s, ['segmentIndex', 'source', 'trialId', 'pageOrigin', 'counters', 'score']);
    row.integritySegment.deltas = {};
  }
  out.trials.push(row);
  return out;
}

export function buildQualtricsPayload(opts) {
  var maxChars = opts.maxChars;
  var p = summary(opts.blob);
  var json = JSON.stringify(p);
  if (json.length <= maxChars) return { payload: p, json: json, chars: json.length, level: 0 };

  // Every later level works on a parsed copy of level 0 (the raw traces are
  // already gone, so the copy is small) and is free to change it in place.
  var work = JSON.parse(json);
  var t = { level: 1, droppedSessionEntries: {}, pagesTrimmed: 0, pagesDropped: 0 };
  work.cyborgHunterOneLiner.truncated = t;
  var steps = [keepNewestSessionEntries, emptyOlderRows, keepNewestRows, newestOnly];
  var out;
  for (var i = 0; i < steps.length; i++) {
    t.level = i + 1;
    out = steps[i](work, t) || work;
    json = JSON.stringify(out);
    if (json.length <= maxChars) break;
  }
  return { payload: out, json: json, chars: json.length, level: t.level };
}
