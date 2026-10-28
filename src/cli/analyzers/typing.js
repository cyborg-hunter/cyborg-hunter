// src/cli/analyzers/typing.js
// The report's typing section: per text field, how fast and how evenly the
// keys came (the rhythm), and per trial, the typing rate. Pure, no DOM, no
// I/O; every field read from data or a recording is type-checked, and
// nothing here throws (the analyzer page runs it on files a participant
// could have written).
//
// Sources, in order: the library's per-field summaries (trial reports from
// 0.17 on carry typingRhythm), else the session recording's key presses
// (printable, not repeated, no Ctrl or Meta, gaps between two presses of
// the same key left out), else nothing ("not recorded"). A recording whose
// key presses name no field (the trace tier's, or keys typed outside a dom-
// tier recording's page) also leaves the rhythm "not recorded", its source
// still the recording. The rate: the
// library's corrected charsPerSec (trials carrying typingEdits, 0.17 on),
// else recomputed from the trial's saved edit times (editTimestamps, kept
// when keystroke dynamics are on), else from the recording's input events
// (when the trial's segment holds at least one; a trace-tier recording holds
// none), else the saved charsPerSec under the old formula (N edits over the
// span, from 2 edits).
// A field is named by its tag alone, from either source: an element's id is
// never read (a page can mirror what is typed into an id).
//
// The rules and their limits live in TYPING_LIMITS with their meaning; the
// report writes them to typing-limits.json. Calibrated on recorded human
// sessions: across 1,580 text fields of 20 gaps or more, no field had a
// median gap under 75 ms, more than 0.39 of its gaps under 60 ms, or a gap
// variation under 0.3, and no trial of 20 or more edits passed 9.5 cps.
//
// Sections, in order: the rules; shared checks; matching trials to
// recording segments; reading a segment (key gaps, edit times); the
// analysis (analyzeTyping, fastTypingTrials).

import { RHYTHM_MIN_GAPS, RHYTHM_FAST_GAP_MS, summarizeGaps, typingRate } from '../../shared/typing-metrics.js';
import { verdictWord } from './cursor.js';

// ── The rules ───────────────────────────────────────────────────────────────

export const TYPING_LIMITS = {
  minGaps:   { value: RHYTHM_MIN_GAPS,    meaning: 'A text field is judged when it has at least this many gaps between one-character keystrokes (a gap between two presses of the same character is left out). Fewer: too short to judge. The library saves nothing for a shorter field.' },
  fastGapMs: { value: RHYTHM_FAST_GAP_MS, meaning: 'The speed rule: a field whose median gap is under this many milliseconds, or more than fastShare of whose gaps are, was typed faster than a person types. Fixed at 60: the library saves the share of gaps under 60 ms.' },
  fastShare: { value: 0.5,  meaning: 'The share of a field\'s gaps under fastGapMs above which the speed rule fires.' },
  evenCv:    { value: 0.2,  meaning: 'The evenness rule: a field whose gap variation (standard deviation over mean of its gaps) is under this was typed too evenly for a person.' },
  minEdits:  { value: 20,   meaning: 'The typing rate (edits − 1 per second between the first edit and the last) is judged on trials with at least this many edits, or the participant\'s own thresholds.typingMinEdits when the session report saved one; it counts as fast above the participant\'s own typingSpeedCps (10 by default). Data from libraries before 0.17 was judged from 2 edits, and the saved rate stays as it was when neither saved edit times nor a recording can recompute it.' }
};

function valuesOf(limits) {
  const out = {};
  for (const k of Object.keys(limits)) out[k] = limits[k].value;
  return out;
}

// ── Shared checks ───────────────────────────────────────────────────────────

// At most this many trial ids are listed for a tell (as the cursor section's).
const MAX_IDS = 10;
const CLOCK_TOLERANCE_MS = 1000;   // a trial's start and its segment's, on one clock
// The recorder's segment for what happens between trials (src/replay/recorder.js):
// no trial's, whatever a file's trials are called.
const SESSION_LABEL = '__session__';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const eventsOf = (seg) => (isObj(seg) && Array.isArray(seg.events) ? seg.events.filter(isObj) : []);
// An id or a label as text (a string, or a finite number as text), else null.
const asText = (v) => (typeof v === 'string' || isNum(v) ? String(v) : null);
// A trial's own id as text, else null.
const ownIdOf = (t) => (isObj(t) ? asText(t.trialId) : null);
// A trial's id as text; a trial without a usable id is named by its place.
const trialIdOf = (t, i) => ownIdOf(t) ?? `trial ${i + 1}`;

// ── Matching trials to recording segments ───────────────────────────────────

// A segment's time origin, as the recording format defines it
// (docs/session-recording-v2.md §3, "Segment time origin"): the first of
// t_load, t_dom_ready and t_start that is a number, else its first event's
// t. Times are milliseconds after recording_started_at_perf (§7, "Time").
function originOf(seg) {
  for (const k of ['t_load', 't_dom_ready', 't_start']) if (isNum(seg[k])) return seg[k];
  const first = eventsOf(seg).find((e) => isNum(e.t));
  return first ? first.t : null;
}

// A min-heap of candidate pairs { d, i, c }: the nearer first, then the
// earlier trial, then the segment earlier in the recording.
const before = (a, b) => a.d < b.d || (a.d === b.d && (a.i < b.i || (a.i === b.i && a.c.k < b.c.k)));
function heapPush(h, x) {
  h.push(x);
  for (let k = h.length - 1; k > 0;) {
    const p = (k - 1) >> 1;
    if (!before(h[k], h[p])) break;
    [h[k], h[p]] = [h[p], h[k]];
    k = p;
  }
}
function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    for (let k = 0; ;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < h.length && before(h[l], h[m])) m = l;
      if (r < h.length && before(h[r], h[m])) m = r;
      if (m === k) break;
      [h[k], h[m]] = [h[m], h[k]];
      k = m;
    }
  }
  return top;
}

// The clock rule for one label: of every (trial, segment) pair whose starts
// lie within CLOCK_TOLERANCE_MS, the nearest is taken first (a tie: the
// earlier trial, then the segment earlier in the recording), then the
// nearest of what is left, and so on. Of two short trials with one id, the
// first does not take the second's segment when the recording began
// between them.
//
// Done on one time line, so that a file holding thousands of one label
// costs neither memory for every pair nor time for redoing each trial's
// nearest pick after every take: the nearest pair left never has a trial or
// segment strictly between its two starts (that one would be nearer), so
// only neighbours on the line are candidates. Trials and segments at one
// exact time form a group, taken in trial order and recording order. A take
// moves on in at most two groups and offers only the pairs that touch them
// (a group left empty joins its two neighbours), so the heap holds a few
// entries per trial and segment.
// idx: the trials' indices (on the clock, this label); segs: the label's segments.
function matchOnClock(idx, segs, trials, base, take) {
  const items = [];
  for (const i of idx) items.push({ p: trials[i].startTime, i });
  for (const c of segs) if (c.o !== null && isNum(base + c.o)) items.push({ p: base + c.o, c });
  items.sort((a, b) => a.p - b.p);   // stable: trial order, then recording order, at one time
  const groups = [];
  for (const it of items) {
    let g = groups[groups.length - 1];
    if (!g || g.p !== it.p) {
      g = { p: it.p, trials: [], segs: [], th: 0, sh: 0, prev: g || null, next: null };
      if (g.prev) g.prev.next = g;
      groups.push(g);
    }
    if (it.c) g.segs.push(it.c); else g.trials.push(it.i);
  }
  // Offer the pairs of first-free items inside a group (b === a) or between
  // two neighbours a < b; d is |(base + o) - startTime|, either direction.
  const heap = [];
  const push = (d, gt, gs) => {
    const i = gt.trials[gt.th], c = gs.segs[gs.sh];
    if (i !== undefined && c !== undefined && d <= CLOCK_TOLERANCE_MS) heapPush(heap, { d, i, c, gt, gs });
  };
  const offer = (a, b) => {
    if (!a || !b) return;
    push(b.p - a.p, a, b);
    if (a !== b) push(b.p - a.p, b, a);
  };
  for (const g of groups) { offer(g, g); offer(g, g.next); }
  while (heap.length) {
    const { i, c, gt, gs } = heapPop(heap);
    // Stale: the pair's trial or segment is no longer its group's first free
    // one (taken since; the pair there now was offered when that happened).
    if (gt.trials[gt.th] !== i || gs.segs[gs.sh] !== c) continue;
    take(i, c);
    gt.th++;
    gs.sh++;
    for (const g of new Set([gt, gs])) {
      if (g.th === g.trials.length && g.sh === g.segs.length) {   // empty: its neighbours meet
        if (g.prev) g.prev.next = g.next;
        if (g.next) g.next.prev = g.prev;
        offer(g.prev, g.next);
      } else {
        offer(g, g);
        offer(g.prev, g);
        offer(g, g.next);
      }
    }
  }
}

/**
 * For each trial, the recording segment that holds it, or null: an array of
 * the same length as `trials`, by position (a caller finds a trial's segment
 * at that trial's index). `trials` not an array gives [].
 *
 * A segment matches a trial whose id is its label (the recorder labels a
 * segment with its trial's id, src/replay/serializer.js; §3 `label`), both
 * read as text: the recorder writes a numeric id as a number. When the
 * recording's start time and the trial's start are both numbers (one page,
 * one clock), the segment must start within CLOCK_TOLERANCE_MS of the
 * trial, the nearest pairs taken first (matchOnClock); otherwise, and when
 * no segment does (pages joined onto another clock),
 * only an id that is unique among the trials and among the segments
 * matches. A label shared by several trials, with no clock to tell them
 * apart, matches nothing; so does a trial without an id, and the
 * whole-session segment. Each segment goes to one trial at most.
 */
export function matchTrialSegments(trials, recording) {
  if (!Array.isArray(trials)) return [];
  const out = trials.map(() => null);
  if (!isObj(recording) || recording.schema_version !== 2 || !Array.isArray(recording.segments)) return out;
  // Per label, its segments as { s, o, k, used }: the segment, its origin,
  // its place in the recording, and whether a trial has it (kept here, never
  // written onto the segment).
  const byLabel = new Map();
  recording.segments.forEach((s, k) => {
    const label = isObj(s) ? asText(s.label) : null;
    if (label === null || label === SESSION_LABEL) return;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push({ s, o: originOf(s), k, used: false });
  });
  const ids = trials.map(ownIdOf);
  const idCount = new Map();
  for (const id of ids) if (id !== null) idCount.set(id, (idCount.get(id) || 0) + 1);
  const take = (i, c) => { out[i] = c.s; c.used = true; };

  // By the clock, label by label (a trial only ever matches its own label).
  const base = isNum(recording.recording_started_at_perf) ? recording.recording_started_at_perf : null;
  if (base !== null) {
    const onClock = new Map();
    trials.forEach((t, i) => {
      if (ids[i] === null || !isNum(t.startTime) || !byLabel.has(ids[i])) return;
      if (!onClock.has(ids[i])) onClock.set(ids[i], []);
      onClock.get(ids[i]).push(i);
    });
    for (const [label, idx] of onClock) matchOnClock(idx, byLabel.get(label), trials, base, take);
  }

  // By the id alone, for a trial the clock did not place: only when its id
  // is unique among the trials and among the segments.
  ids.forEach((id, i) => {
    if (out[i] !== null || id === null || idCount.get(id) !== 1) return;
    const all = byLabel.get(id) || [];
    if (all.length === 1 && !all[0].used) take(i, all[0]);
  });
  return out;
}

// ── Reading a segment ───────────────────────────────────────────────────────

// A key press the rhythm counts: a printable one-character key (not a
// repeat, no Ctrl or Meta) at a time, whose anchor (§6) is an input or a
// textarea. → that tag, or null. Which field it went to is the event's target.
function typedKeyTag(e) {
  if (e.type !== 'key.down' || e.repeat === true || typeof e.key !== 'string' || e.key.length !== 1 || !isNum(e.t)) return null;
  const mods = isObj(e.mods) ? e.mods : {};
  if (mods.ctrl === true || mods.meta === true) return null;
  const tag = isObj(e.anchor) && typeof e.anchor.tag === 'string' ? e.anchor.tag.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' ? tag : null;
}

/**
 * The text fields typed into in a segment, from its key presses (§5.2
 * key.down; the field's tag from the event's anchor, §6): one entry per
 * event target whose anchor is an input or a textarea, in the order of its
 * first counted key, with the gaps (ms) between its printable key presses
 * (one-character key, not a repeat, no Ctrl or Meta).
 * → [{ field: { tag: 'input' | 'textarea' }, gaps: number[] }]
 *
 * A gap between two presses of the same key (by code) is left out: a
 * repeated letter or a key tapped over and over is not rhythm. A key left
 * out (Backspace, Enter, a chord) does not break the run: the next gap
 * spans it, as the library's does. A redacted key press has no key and is
 * not counted. A recording without a DOM (trace tier) gives its key presses
 * no target, so it yields no field (hasUntargetedTyping tells that apart
 * from no typing).
 */
export function recordingKeyGaps(seg) {
  const byNode = new Map();
  for (const e of eventsOf(seg)) {
    const tag = typedKeyTag(e);
    if (tag === null || !Number.isInteger(e.target)) continue;
    let f = byNode.get(e.target);
    if (!f) { f = { field: { tag }, gaps: [], lastT: null, lastCode: null }; byNode.set(e.target, f); }
    // The recorder writes code '' when the browser gives none; the key stands in.
    const code = typeof e.code === 'string' && e.code ? e.code : e.key;
    // A gap is kept when it is at most MAX_SAFE_INTEGER ms: finite (two
    // finite times can be Infinity apart), and small enough that the sums
    // and squares summarizeGaps takes stay finite.
    const gap = e.t - f.lastT;
    if (f.lastT !== null && code !== f.lastCode && gap >= 0 && gap <= Number.MAX_SAFE_INTEGER) f.gaps.push(gap);
    f.lastT = e.t;
    f.lastCode = code;
  }
  return [...byNode.values()].map((f) => ({ field: f.field, gaps: f.gaps }));
}

// Whether a segment holds a key press the rhythm would count that names no
// field: a recording without the page's DOM (trace tier) keeps the anchor's
// tag but gives the key press no target, so its keys cannot be told apart
// by field. A recording that keeps the page (dom tier) does the same for a
// key typed into a field outside the part of the page it records (§7,
// "target: null").
function hasUntargetedTyping(seg) {
  return eventsOf(seg).some((e) => typedKeyTag(e) !== null && !Number.isInteger(e.target));
}

// The recorder's tier as the recording names it
// (extensions['cyborg-hunter'].tier), or null.
function tierOf(recording) {
  const ext = isObj(recording) && isObj(recording.extensions) ? recording.extensions['cyborg-hunter'] : null;
  return isObj(ext) && typeof ext.tier === 'string' ? ext.tier : null;
}

/**
 * The times (ms) of a segment's edits, ascending: every input.value and
 * input.checked event (§5.2), redacted ones included. These are the inputs
 * the library counts as edits (text fields, checkboxes, radios; not a
 * select). The recorder writes at most one input.value per field per
 * animation frame, so typing faster than a key a frame (about 16 ms) leaves
 * fewer edits here than the library counted.
 */
export function recordingEditTimes(seg) {
  return eventsOf(seg).filter((e) => (e.type === 'input.value' || e.type === 'input.checked') && isNum(e.t))
    .map((e) => e.t).sort((a, b) => a - b);
}

// ── The analysis ────────────────────────────────────────────────────────────

// A library summary as the analyzer reads it, or null when it is unusable: a
// whole count of gaps and three measures in their ranges. The field keeps
// its tag alone (lower case, at most 32 characters, whatever element it
// names); an id in the data is not read.
function libraryField(e) {
  if (!isObj(e) || !isObj(e.field) || !Number.isInteger(e.gaps) || !isNum(e.medianMs) || !isNum(e.under60Share) || !isNum(e.cv)) return null;
  if (e.medianMs < 0 || e.under60Share < 0 || e.under60Share > 1 || e.cv < 0) return null;
  const tag = typeof e.field.tag === 'string' ? e.field.tag.toLowerCase().slice(0, 32) : '';
  return { field: { tag }, gaps: e.gaps, medianMs: e.medianMs, under60Share: e.under60Share, cv: e.cv };
}

// A trial's saved edit times (ms, one per edit; the library keeps them when
// keystroke dynamics are on), the numbers among them in time order, or null
// when there is none: with keystroke dynamics off the library writes an
// empty list, and a list without a number is treated as no list. A copy:
// the participant's own list is never sorted in place.
function editTimesOf(t) {
  if (!Array.isArray(t.editTimestamps)) return null;
  const times = t.editTimestamps.filter(isNum).sort((a, b) => a - b);
  return times.length ? times : null;
}

// The typing-speed cutoff the library screened this participant with (saved
// in the session report), else the CLI's, else 10, each only when it is a
// number. The summary's fast-typing count reads it here too (summary.js),
// and the typing chart by the same rule (timeline-layout.js
// typingThreshold), so a trial is fast alike in all three.
export function cutoffOf(p, config) {
  const session = isObj(p.session) ? p.session : {};
  const saved = isObj(session.config) ? session.config.thresholds : null;
  if (isObj(saved) && isNum(saved.typingSpeedCps)) return saved.typingSpeedCps;
  return isObj(config) && isNum(config.typingSpeedThreshold_cps) ? config.typingSpeedThreshold_cps : 10;
}

// The typing-rate minimum the library judged this participant with (saved
// in the session report from 0.17 on): a whole number of 2 or more, as the
// library accepts, else TYPING_LIMITS.minEdits.
function minEditsOf(p) {
  const session = isObj(p.session) ? p.session : {};
  const saved = isObj(session.config) ? session.config.thresholds : null;
  const v = isObj(saved) ? saved.typingMinEdits : null;
  return Number.isInteger(v) && v >= 2 ? v : TYPING_LIMITS.minEdits.value;
}

// The smallest and the largest of one measure over fields (a loop, not
// Math.min(...): a spread of some 200,000 fields overflows the stack).
const least = (fs, k) => fs.reduce((m, f) => Math.min(m, f[k]), Infinity);
const most = (fs, k) => fs.reduce((m, f) => Math.max(m, f[k]), -Infinity);

// The participant's rate source: the weakest any judged trial used; with
// none judged, the strongest there is.
const RATE_SOURCES = ['old formula', 'recording', 'edit times', 'library'];

/**
 * One participant's typing analysis (the shape report-core attaches as
 * summary.typingAnalysis; the module header names the sources).
 *
 * The analysed trials are participant.trials (the objects among them, in
 * order); after phase scoping, the scoped ones. options.allTrials, when it is
 * a list, holds the participant's trials before scoping: segments are then
 * matched over all of them (so an id's count is the session's, and a
 * warm-up trial's segment never passes to a main trial of the same id), and
 * each analysed trial takes the segment matched to the same trial object
 * (applyPhaseScope keeps the objects). Only analysed trials are judged.
 *
 * byIndex is aligned with the analysed trials (one entry per trial, in
 * order): the typing chart draws from it, so trials that share an id stay
 * apart. byTrial is keyed by trial id for readers that only have an id:
 * trials that share an id share an entry (judged if any of them was, with
 * the largest judged rate). fields[].trialIndex is the field's trial's
 * place among the analysed trials. Both index the object trials of the
 * analysed list (participant.trials.filter(isObj)), not participant.trials
 * itself.
 *
 * rate.minEdits is the edits a trial needs before its rate is recomputed
 * and judged: the participant's saved typingMinEdits, else 20.
 */
export function analyzeTyping(participant, config = {}, options = {}) {
  const L = valuesOf(TYPING_LIMITS);
  const p = isObj(participant) ? participant : {};
  const trials = Array.isArray(p.trials) ? p.trials.filter(isObj) : [];
  const recording = isObj(p.replay) && isObj(p.replay.recording) ? p.replay.recording : null;
  const cutoff = cutoffOf(p, config);
  const minEdits = minEditsOf(p);

  // Each analysed trial's recording segment, or null.
  const all = isObj(options) && Array.isArray(options.allTrials) ? options.allTrials : trials;
  const matched = matchTrialSegments(all, recording);
  const segOf = new Map(all.map((t, i) => [t, matched[i]]));
  const segs = trials.map((t) => segOf.get(t) || null);

  // The rhythm, field by field.
  const source = trials.some((t) => Array.isArray(t.typingRhythm)) ? 'library' : segs.some(Boolean) ? 'recording' : null;
  const fields = [];
  let shortFields = source === 'recording' ? 0 : null;
  trials.forEach((t, i) => {
    const trialId = trialIdOf(t, i);
    const judge = (f) => fields.push({ trialId, trialIndex: i, ...f,
      speed: f.medianMs < L.fastGapMs || f.under60Share > L.fastShare, evenness: f.cv < L.evenCv });
    if (source === 'library') {
      for (const e of Array.isArray(t.typingRhythm) ? t.typingRhythm : []) {
        const f = libraryField(e);
        if (f && f.gaps >= L.minGaps) judge(f);
      }
    } else if (source === 'recording' && segs[i]) {
      // recordingKeyGaps can give a field no gap (one key press): too short.
      for (const k of recordingKeyGaps(segs[i])) {
        if (k.gaps.length >= L.minGaps) judge({ field: { tag: k.field.tag }, ...summarizeGaps(k.gaps) });
        else shortFields++;
      }
    }
  });

  // The verdict: one kind of rule (speed or evenness) makes the session
  // suspicious; both kinds in one field, highly suspicious.
  const speedFields = fields.filter((f) => f.speed), evenFields = fields.filter((f) => f.evenness);
  const both = fields.some((f) => f.speed && f.evenness);
  let state = 'ok', level, verdictReason = null;
  if (source === null) {
    state = 'not recorded'; level = -1;
    verdictReason = !recording ? 'typing rhythm not recorded (library before 0.17 or signals.typingRhythm off) and no session recording'
      // Matched, but only to trials outside the phase scope.
      : matched.some(Boolean) ? 'typing rhythm not recorded and the session recording matches no trial in the phase scope'
      : 'typing rhythm not recorded and the session recording matches no trial';
  } else if (!fields.length) {
    level = -1;
    // From the recording, over the judged trials' segments only (typing
    // between trials, in an unmatched segment or outside the phase scope is
    // not theirs): key presses that name no field (a recording without the
    // page's DOM) leave the rhythm not recorded; else either no character
    // was typed into a text field (shortcuts such as Cmd+V and an editable
    // area's keys are not counted), or every field was too short.
    if (source === 'recording' && segs.some((s) => s !== null && hasUntargetedTyping(s))) {
      state = 'not recorded';
      // A dom- or canvas-tier recording (both record the page): keys typed
      // into a field outside the recorded part of the page. Otherwise
      // (trace tier, or no tier named): a recording without the page.
      verdictReason = tierOf(recording) === 'dom' || tierOf(recording) === 'canvas'
        ? 'the session recording does not say which field each key went to (typed outside the recorded page)'
        : 'the session recording does not say which field each key went to (recorded without the page)';
    } else {
      state = 'not assessed';
      verdictReason = source === 'recording' && shortFields === 0 ? 'the session recording holds no typed characters in a text field of the judged trials'
        : `no text field reached ${L.minGaps} key gaps`;
    }
  } else {
    level = both ? 2 : speedFields.length || evenFields.length ? 1 : 0;
  }
  const idsOf = (fs) => [...new Set(fs.map((f) => f.trialId))];
  const tells = [];
  const tellLevel = both ? 'high' : 'low';
  if (speedFields.length) {
    const ms = Math.round(least(speedFields, 'medianMs'));
    const share = Math.round(100 * most(speedFields, 'under60Share'));
    const ids = idsOf(speedFields);
    tells.push({ id: 'typingSpeed', level: tellLevel, text: `keys pressed faster than a person types: median gap ${ms} ms, ${share}% of gaps under ${L.fastGapMs} ms`,
      short: `median gap ${ms} ms`, trialIds: ids.slice(0, MAX_IDS), trials: ids.length });
  }
  if (evenFields.length) {
    // "0.3 or more": the lowest variation of a recorded human field was 0.31.
    const cv = least(evenFields, 'cv').toFixed(2);
    const ids = idsOf(evenFields);
    tells.push({ id: 'typingEvenness', level: tellLevel, text: `keys pressed too evenly: gap variation ${cv}, where people vary by 0.3 or more`,
      short: `gap variation ${cv}`, trialIds: ids.slice(0, MAX_IDS), trials: ids.length });
  }

  // The rate, trial by trial: the library's (0.17 on: typingEdits is
  // there), else from the saved edit times, else from the recording when
  // the trial's segment holds an edit, else the old formula's saved number.
  // A segment without an edit is no source: the trace tier records key
  // presses but no input event (an input event needs a node, §5.2), so
  // such a trial keeps its saved rate, as if no segment had matched. oldCps
  // keeps that saved number wherever the rate was recomputed.
  const rateTrials = trials.map((t, i) => {
    const trialId = trialIdOf(t, i);
    const saved = isNum(t.charsPerSec) ? t.charsPerSec : null;
    const times = isNum(t.typingEdits) ? null : editTimesOf(t);
    const fromRecording = segs[i] ? recordingEditTimes(segs[i]) : [];
    let r;
    if (isNum(t.typingEdits)) r = { source: 'library', cps: saved, edits: t.typingEdits, oldCps: null };
    else if (times) r = { source: 'edit times', cps: typingRate(times, minEdits), edits: times.length, oldCps: saved };
    else if (fromRecording.length) r = { source: 'recording', cps: typingRate(fromRecording, minEdits), edits: fromRecording.length, oldCps: saved };
    else r = { source: 'old formula', cps: saved, edits: null, oldCps: null };
    const judged = r.cps !== null;
    return { trialId, ...r, judged, fast: judged && r.cps > cutoff };
  });
  const rateSource = RATE_SOURCES.find((s) => rateTrials.some((r) => r.judged && r.source === s))
    || RATE_SOURCES.slice().reverse().find((s) => rateTrials.some((r) => r.source === s)) || 'old formula';

  // Per trial: its judged rate and whether a rhythm rule fired in it (the
  // fired trials gathered once, so this stays linear in trials and fields).
  const firedIds = new Set(), firedIndexes = new Set();
  for (const f of fields) if (f.speed || f.evenness) { firedIds.add(f.trialId); firedIndexes.add(f.trialIndex); }
  const byTrial = Object.create(null);
  for (const r of rateTrials) {
    const cps = r.judged ? r.cps : null;
    const prev = byTrial[r.trialId] || { cps: null, judged: false };
    byTrial[r.trialId] = { cps: prev.cps === null || (cps !== null && cps > prev.cps) ? cps : prev.cps,
      judged: prev.judged || r.judged, rhythm: firedIds.has(r.trialId) };
  }
  const byIndex = rateTrials.map((r, i) => ({ cps: r.judged ? r.cps : null, judged: r.judged, rhythm: firedIndexes.has(i) }));

  return { state, level, verdict: verdictWord(level), verdictReason, source, tells, fields, shortFields,
    rate: { source: rateSource, cutoffCps: cutoff, minEdits, trials: rateTrials }, byTrial, byIndex, limits: L };
}

// How many trials typed faster than the cutoff, by the rates above.
export const fastTypingTrials = (analysis) => analysis.rate.trials.filter((r) => r.fast).length;
