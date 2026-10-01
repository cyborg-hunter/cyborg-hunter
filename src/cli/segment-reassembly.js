// src/cli/segment-reassembly.js
// CLI side of the rolling snapshot (0.10.0 one-line setup). The browser cuts
// the monitor's session arrays into per-segment deltas
// (src/oneliner/segment-diff.js) and saves one `integritySegment` per data
// row; this module puts them back together into the same session object
// finalize() dumps as `integritySession`, plus the score.
//
// Pure: no imports, no Node APIs — extract-core.js (bundled by the browser
// demo) depends on it.

// Field names that hold a performance.now()-style time. Everything else
// (duration_ms, ISO `timestamp` strings, counts) is left alone when re-basing.
// rebaseTimes() applies this at any depth, which is right for the SESSION
// arrays (every entry's t/start is a raw page performance.now()), but not for
// a whole trial report — use rebaseTrialReport() for those.
// Bare-number arrays are never shifted: editTimestamps holds absolute
// performance.now() values too, but the CLI only uses their differences
// (typing speed), so they are intentionally left on their own page's clock.
const TIME_KEYS = new Set(['t', 'start', 'startTime', 'trialStart_perfNow']);

// Mirrors ALIAS_KEYS in src/oneliner/segment-diff.js (a test pins the two
// equal): the alias key is not shipped in segments, so it is restored here
// pointing at its canonical key.
export const ALIAS_KEYS = { layoutShifts: 'viewportWidthShifts' };

// Trial-report fields that carry the page's performance.now() clock and so
// move with the page origin. Time base of each, from src/core:
//   startTime            performance.now() at startTrial   (monitor.js startTrial)
//   trialStart_perfNow   performance.now() at on_load      (jspsych extension on_load)
//   pasteEvents[].t      performance.now()                 (signals/clipboard.js)
//   copyEvents[].t       performance.now()                 (signals/clipboard.js)
//   dropEvents[].t       performance.now()                 (signals/clipboard.js)
//   tabAwayEvents[].start performance.now() at leave      (signals/focus.js)
//   idleGaps[].t         performance.now()                 (signals/focus.js)
//   syntheticInsertions[].t performance.now()              (signals/typing.js)
//   foreignInputEvents[].t  performance.now()              (signals/typing.js)
// NOT shifted (left as they are):
//   mouseTrack/mouseEvents[].t  ms since trial start       (signals/mouse.js)
//   elementTrace[].t            ms since trial start       (signals/browser.js)
//   mouseTrackingCappedAtMs, duration_ms  durations
//   editTimestamps              absolute, bare numbers — see TIME_KEYS note
//   anything else on the row (integrity, integritySegment, jsPsych columns)
const TRIAL_ANCHOR_KEYS = ['startTime', 'trialStart_perfNow'];
const TRIAL_PAGE_TIME_ARRAYS = ['pasteEvents', 'copyEvents', 'dropEvents', 'tabAwayEvents',
  'idleGaps', 'syntheticInsertions', 'foreignInputEvents'];

// Returns a shallow copy of a merged trial report with only the page-clock
// fields above shifted by offsetMs. Offset 0 returns the input itself.
export function rebaseTrialReport(trial, offsetMs) {
  if (!offsetMs || !trial || typeof trial !== 'object') return trial;
  const out = { ...trial };
  for (const k of TRIAL_ANCHOR_KEYS) {
    if (typeof out[k] === 'number') out[k] += offsetMs;
  }
  for (const k of TRIAL_PAGE_TIME_ARRAYS) {
    if (Array.isArray(out[k])) out[k] = rebaseTimes(out[k], offsetMs);
  }
  return out;
}

// Returns a deep copy of `value` with every numeric property named t, start,
// startTime or trialStart_perfNow shifted by offsetMs, at any depth.
// Offset 0 returns the input itself (no copy), so a single-page session costs
// nothing.
export function rebaseTimes(value, offsetMs) {
  if (!offsetMs) return value;
  return shift(value, offsetMs);
}

function shift(value, offsetMs) {
  if (Array.isArray(value)) return value.map(v => shift(v, offsetMs));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = (TIME_KEYS.has(k) && typeof v === 'number') ? v + offsetMs : shift(v, offsetMs);
  }
  return out;
}

function isSegment(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x) && typeof x.segmentIndex === 'number';
}

// Gathers every segment saved in a participant file, sorted by segmentIndex.
// Sources: raw.trials[*].integritySegment, raw.trials[*].integritySegmentFinal
// (any row) and raw.integritySegments (array). Non-objects are skipped — a CSV
// cell that failed to JSON.parse stays a string. When the same index appears
// twice, the first occurrence wins.
export function collectSegments(raw) {
  const found = [];
  if (raw && Array.isArray(raw.trials)) {
    for (const row of raw.trials) {
      if (!row || typeof row !== 'object') continue;
      if (isSegment(row.integritySegment)) found.push(row.integritySegment);
      if (isSegment(row.integritySegmentFinal)) found.push(row.integritySegmentFinal);
    }
  }
  if (raw && Array.isArray(raw.integritySegments)) {
    for (const s of raw.integritySegments) if (isSegment(s)) found.push(s);
  }
  // Array.prototype.sort is stable, so on equal indices the earlier-found
  // segment stays first and the duplicate check below keeps it.
  found.sort((a, b) => a.segmentIndex - b.segmentIndex);
  const out = [];
  for (const s of found) {
    if (out.length > 0 && out[out.length - 1].segmentIndex === s.segmentIndex) continue;
    out.push(s);
  }
  return out;
}

// Concatenates segment deltas in segmentIndex order into the finalize() dump
// shape: { pasteCount, copyCount, dropCount, <every array key>, layoutShifts,
// config } — score fields and libraryVersion are NOT in the session (finalize()
// stores them separately). Returns { session, score, pageOrigins } or null for
// no segments. Segments from a later page (different pageOrigin) have their
// times re-based to the first page's origin.
export function reassembleSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const sorted = segments.slice().sort((a, b) => a.segmentIndex - b.segmentIndex);

  const pageOrigins = [];
  for (const s of sorted) {
    if (!pageOrigins.includes(s.pageOrigin)) pageOrigins.push(s.pageOrigin);
  }

  const session = {};
  for (const s of sorted) {
    const offset = (typeof s.pageOrigin === 'number' && typeof pageOrigins[0] === 'number')
      ? s.pageOrigin - pageOrigins[0] : 0;
    for (const [key, entries] of Object.entries(s.deltas || {})) {
      if (!Array.isArray(entries)) continue;
      session[key] = (session[key] || []).concat(rebaseTimes(entries, offset));
    }
  }
  for (const [alias, canonical] of Object.entries(ALIAS_KEYS)) {
    if (!session[canonical]) session[canonical] = [];
    session[alias] = session[canonical];   // same array, as in the monitor
  }

  const last = sorted[sorted.length - 1];
  const counters = last.counters || {};
  // `?? 0` matches finalize()'s destructuring defaults.
  session.pasteCount = counters.pasteCount ?? 0;
  session.copyCount = counters.copyCount ?? 0;
  session.dropCount = counters.dropCount ?? 0;
  const withConfig = sorted.find(s => s.config);
  session.config = withConfig ? withConfig.config : undefined;

  return { session, score: last.score ?? null, pageOrigins };
}
