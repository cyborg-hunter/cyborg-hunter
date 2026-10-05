// src/oneliner/qualtrics-payload.js
// Builds the payload ch.js writes into Qualtrics embedded data. Qualtrics
// rejects a submit whose embedded data is too long (the participant sees an
// error and cannot go on), so the payload is a summary of the vanilla blob
// and, when that is still too long, is reduced level by level until the
// serialized string fits the cap. Pure: no DOM, no monitor; never throws.
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
// buildQualtricsPayload({ blob, maxChars }) → {
//   payload    the object to write, or null
//   json       JSON.stringify(payload), or null: write nothing
//   chars      json's size in UTF-8 bytes (0 when json is null)
//   level      0-5, below
//   fullChars  the level-0 summary's size in UTF-8 bytes (0 when the blob
//              could not be read)
//   reason     level 5 only: why no ladder level was used
// }
//   blob      the vanilla adapter's blob() (Shape 1 rows, one integritySegment
//             per row); never mutated
//   maxChars  the cap, counted in UTF-8 bytes, which holds whether Qualtrics
//             counts characters or bytes (every character is at least one
//             byte); missing, or not a positive integer: DEFAULT_MAX_CHARS
// Whenever json is a string, chars <= maxChars: a caller writes json as it
// is, and writes nothing when it is null.
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
//   5  a cap too small for level 4, or a blob that cannot be read: only
//      { participantId, cyborgHunterOneLiner: { host, truncated: { level: 5 } },
//      trials: [] }, plus cyborgHunterError when the blob could not be read;
//      json null when even that does not fit
// The newest row's segment carries the monitor's cumulative counters and
// score, which is what the CLI reads them from, so levels 0-4 keep them.

export var KEEP_SESSION_ENTRIES = 25;
export var KEEP_PAGES = 5;
export var LABEL_MAX = 128;   // ids, names, types: UTF-16 code units
export var NOTE_MAX = 500;    // cyborgHunterError notes
// The cap when the caller gives none: MAX_CHARS of adapters/qualtrics.js,
// which imports this module (a test pins the two equal).
export var DEFAULT_MAX_CHARS = 12000;

var VIOLATIONS = 'guard_assistance_violations_session';

function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// The UTF-8 size of s, as TextEncoder counts it (a lone surrogate as the
// three bytes of U+FFFD).
function utf8Length(s) {
  if (!/[^\u0000-\u007f]/.test(s)) return s.length;
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

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
      out += c >= 0xd800 && c < 0xe000 ? '\ufffd' : v[i];   // a lone surrogate would serialize as an escape
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
// Never `data` (the typed text), nor the target's id or class: a page widget
// can set those from what was typed. The tag and the kind of input are fixed
// sets.
var FOREIGN = listOf({ t: num, targetTag: label, inputType: label });

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
// The honeypot's violation log (oldest first) keeps its newest
// KEEP_SESSION_ENTRIES the same way; its count field keeps the full number.
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
  if (p[VIOLATIONS]) {
    var log = JSON.parse(p[VIOLATIONS]);
    countDropped(t, VIOLATIONS, log.length - KEEP_SESSION_ENTRIES);
    p[VIOLATIONS] = JSON.stringify(log.slice(-KEEP_SESSION_ENTRIES));
  }
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

// Under the legacy layout every page is a full load with its own monitor,
// and the CLI adds up the last segment of each page origin
// (src/cli/segment-reassembly.js). When levels 3-4 drop every row of a page,
// that page's counters and score would go with them, so the last segments
// of the dropped pages are summed the way the CLI sums pages into one
// segment for integritySegments. It takes the earliest dropped page's origin
// and last index, which keeps the CLI's clock anchor and segment order. One
// page origin (the New Survey Taking Experience) never needs it.
function rollup(all, kept) {
  var keptOrigins = kept.map(function (r) { return r.integritySegment && r.integritySegment.pageOrigin; });
  var lasts = [];   // the last segment of each dropped page, in page order
  all.forEach(function (r) {
    var s = r.integritySegment;
    if (!s || typeof s.segmentIndex !== 'number' || keptOrigins.indexOf(s.pageOrigin) !== -1) return;
    for (var i = 0; i < lasts.length && lasts[i].pageOrigin !== s.pageOrigin; i++);
    if (i === lasts.length || s.segmentIndex > lasts[i].segmentIndex) lasts[i] = s;
  });
  if (!lasts.length) return null;
  var seg = { segmentIndex: lasts[0].segmentIndex, source: 'rollup', pageOrigin: lasts[0].pageOrigin, deltas: {},
    counters: { pasteCount: 0, copyCount: 0, dropCount: 0 } };
  var hard = {}, soft = 0, done = 0, last = null;
  lasts.forEach(function (s) {
    Object.keys(seg.counters).forEach(function (k) { seg.counters[k] += (s.counters && s.counters[k]) || 0; });
    if (!s.score) return;
    last = s.score;
    var hs = last.hardScore || {};
    Object.keys(hs).forEach(function (k) {
      var h = hard[k] || (hard[k] = { count: 0 });
      h.count += hs[k].count || 0;
      if (hs[k].threshold !== undefined) h.threshold = hs[k].threshold;
    });
    soft += last.softScore || 0;
    done += last.trialsCompleted || 0;
  });
  if (last) {
    var any = false;
    Object.keys(hard).forEach(function (k) {
      hard[k].triggered = typeof hard[k].threshold === 'number' && hard[k].count >= hard[k].threshold;
      any = any || hard[k].triggered;
    });
    seg.score = { hardScore: hard, softScore: soft, softScoreThreshold: last.softScoreThreshold,
      anyHardTriggered: any, trialsCompleted: done };
  }
  return seg;
}

// Level 3: the newest KEEP_PAGES rows. The first segment's config (preset,
// thresholds) moves onto the oldest kept segment so the CLI still bins this
// participant with the thresholds the monitor used.
function keepNewestRows(p, t, all) {
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
  var r = rollup(all, p.trials);
  if (r) p.integritySegments = [r];
}

// Own fields only: a key a page script put on Object.prototype is not data.
function copy(to, from, keys) {
  keys.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(from, k)) to[k] = from[k]; });
  return to;
}

// Level 4: the newest row with the schema's required fields only, and no
// violation log (its count field stays); every value was bounded at level 0,
// so its size does not grow with the session.
function newestOnly(p, t, all) {
  var last = p.trials[p.trials.length - 1];
  p.trials.forEach(function (r) { if (r.integritySegment) countDeltas(t, r.integritySegment.deltas); });
  if (p[VIOLATIONS]) countDropped(t, VIOLATIONS, JSON.parse(p[VIOLATIONS]).length);
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
  var r = rollup(all, [last]);
  if (r) out.integritySegments = [r];
  return out;
}

function result(payload, json, chars, level, full) {
  return { payload: payload, json: json, chars: chars, level: level, fullChars: full };
}

// Level 5: a fixed shape, so the CLI still links the response and reports
// the reduction; when even this does not fit the cap, no payload at all.
function minimal(pid, cap, full, reason, failed) {
  var p = {};
  if (pid) p.participantId = pid;
  p.cyborgHunterOneLiner = { host: 'qualtrics', truncated: { level: 5 } };
  p.trials = [];
  if (failed) p.cyborgHunterError = 'the Qualtrics payload could not be built';
  var json = null;
  try { json = JSON.stringify(p); } catch (_) { /* a page whose Object.prototype.toJSON throws */ }
  var n = json === null ? Infinity : utf8Length(json);
  var out = n <= cap ? result(p, json, n, 5, full)
    : result(null, null, 0, 5, full);
  out.reason = n <= cap ? reason
    : reason + (json === null ? '; nor can the minimal payload be serialized' : '; nor does the minimal payload (' + n + ' bytes)');
  return out;
}

export function buildQualtricsPayload(opts) {
  var cap = DEFAULT_MAX_CHARS;
  var pid;
  var full = 0;
  try {
    var o = opts || {};
    if (Number.isInteger(o.maxChars) && o.maxChars > 0) cap = o.maxChars;
    var b = o.blob;
    if (!isObject(b)) return minimal(pid, cap, full, 'no blob to summarize', true);
    pid = label(b.participantId);
    var p = summary(b);
    var json = JSON.stringify(p);
    var n = full = utf8Length(json);
    if (n <= cap) return result(p, json, n, 0, full);

    // Every later level works on a parsed copy of level 0 (the raw traces are
    // already gone, so the copy is small) and is free to change it in place.
    var work = JSON.parse(json);
    var all = work.trials;   // every row, for the rollup of pages levels 3-4 drop
    var t = { level: 1, droppedSessionEntries: {}, pagesTrimmed: 0, pagesDropped: 0 };
    work.cyborgHunterOneLiner.truncated = t;
    var steps = [keepNewestSessionEntries, emptyOlderRows, keepNewestRows, newestOnly];
    for (var i = 0; i < steps.length; i++) {
      t.level = i + 1;
      var out = steps[i](work, t, all) || work;
      json = JSON.stringify(out);
      n = utf8Length(json);
      if (n <= cap) return result(out, json, n, t.level, full);
    }
    return minimal(pid, cap, full, 'level 4 (' + n + ' bytes) does not fit the cap (' + cap + ' bytes)', false);
  } catch (e) {
    // A blob that is not plain data (a getter that throws, say). The message
    // goes to the caller only, never into the payload.
    var why = 'the payload could not be built';
    try { why += ': ' + label(String(e && e.message)); } catch (_) { /* a thrown value that cannot be printed */ }
    return minimal(pid, cap, full, why, true);
  }
}
