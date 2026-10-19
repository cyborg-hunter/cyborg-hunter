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
// the same key left out), else nothing ("not recorded"). The rate: the
// library's corrected charsPerSec (trials carrying typingEdits, 0.17 on),
// else recomputed from the recording's input events, else the saved
// charsPerSec under the old formula (N edits over the span, from 2 edits).
// A field is named by its tag alone, from either source: an element's id is
// never read (a page can mirror what is typed into an id).
//
// The rules and their limits live in TYPING_LIMITS with their meaning; the
// report writes them to typing-limits.json. Calibrated on recorded human
// sessions: across 1,580 text fields of 20 gaps or more, no field had a
// median gap under 75 ms, more than 0.39 of its gaps under 60 ms, or a gap
// variation under 0.3, and no trial of 20 or more edits passed 9.5 cps.

// At most this many trial ids are listed for a tell (as the cursor section's).
const MAX_IDS = 10;
const CLOCK_TOLERANCE_MS = 1000;   // a trial's start and its segment's, on one clock
// The recorder's segment for what happens between trials (src/replay/recorder.js):
// no trial's, whatever a file's trials are called.
const SESSION_LABEL = '__session__';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const eventsOf = (seg) => (isObj(seg) && Array.isArray(seg.events) ? seg.events.filter(isObj) : []);
// A trial's own id as text (a string, or a number as text), else null.
const ownIdOf = (t) => (isObj(t) && (typeof t.trialId === 'string' || isNum(t.trialId)) ? String(t.trialId) : null);
// A trial's id as text; a trial without a usable id is named by its place.
const trialIdOf = (t, i) => ownIdOf(t) ?? `trial ${i + 1}`;

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
 * segment with its trial's id, src/replay/serializer.js; §3 `label`). When the
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
    if (!isObj(s) || typeof s.label !== 'string' || s.label === SESSION_LABEL) return;
    if (!byLabel.has(s.label)) byLabel.set(s.label, []);
    byLabel.get(s.label).push({ s, o: originOf(s), k, used: false });
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
 * no target, so it yields no field.
 */
export function recordingKeyGaps(seg) {
  const byNode = new Map();
  for (const e of eventsOf(seg)) {
    if (e.type !== 'key.down' || e.repeat === true || typeof e.key !== 'string' || e.key.length !== 1 || !isNum(e.t)) continue;
    const mods = isObj(e.mods) ? e.mods : {};
    if (mods.ctrl === true || mods.meta === true) continue;
    const tag = isObj(e.anchor) && typeof e.anchor.tag === 'string' ? e.anchor.tag.toLowerCase() : '';
    if ((tag !== 'input' && tag !== 'textarea') || !Number.isInteger(e.target)) continue;
    let f = byNode.get(e.target);
    if (!f) { f = { field: { tag }, gaps: [], lastT: null, lastCode: null }; byNode.set(e.target, f); }
    // The recorder writes code '' when the browser gives none; the key stands in.
    const code = typeof e.code === 'string' && e.code ? e.code : e.key;
    if (f.lastT !== null && code !== f.lastCode && e.t >= f.lastT) f.gaps.push(e.t - f.lastT);
    f.lastT = e.t;
    f.lastCode = code;
  }
  return [...byNode.values()].map((f) => ({ field: f.field, gaps: f.gaps }));
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
