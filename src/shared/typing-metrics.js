// src/shared/typing-metrics.js
// The typing measures the library saves and the report recomputes from a
// session recording, in one place so the two never disagree. Pure, no DOM.
// Written in the core's style (var, function): the browser library bundles it.

function round(v, k) { return Math.round(v * k) / k; }

// The typing rate: (N − 1) edits per second between the first edit and the
// last (N edits enclose N − 1 gaps), rounded to 0.1. null with fewer than
// minEdits edits (2 when minEdits is missing or below 2: the formula needs
// two) or a span of zero. times: the edits' times in ms, ascending.
// Calibrated on recorded human sessions: no trial of 20 or more edits went
// above 9.5 per second, while about four in ten fields of 2 to 4 keys
// passed 10 by the old count (N over the span).
export function typingRate(times, minEdits) {
  var min = typeof minEdits === "number" && minEdits >= 2 ? minEdits : 2;
  if (!times || times.length < min) return null;
  var spanSec = (times[times.length - 1] - times[0]) / 1000;
  if (!(spanSec > 0)) return null;
  return round((times.length - 1) / spanSec, 10);
}

// A field's rhythm is summarized from this many gaps; a field with fewer
// leaves nothing (the library saves nothing for it, the report does not
// judge it).
export var RHYTHM_MIN_GAPS = 20;
// The share of gaps under this many milliseconds is saved (under60Share).
// Calibrated on recorded human sessions: no text field of 20 gaps or more
// had a median gap under 75 ms.
export var RHYTHM_FAST_GAP_MS = 60;

// { gaps, medianMs, under60Share, cv } for one or more gaps (ms): the
// count, the median (0.1 ms), the share under RHYTHM_FAST_GAP_MS (three
// decimals) and the coefficient of variation, standard deviation over mean
// (three decimals; the sample standard deviation, n − 1, as the calibration
// computed it; 0 when the mean is 0).
export function summarizeGaps(gaps) {
  var n = gaps.length;
  var sorted = gaps.slice().sort(function (a, b) { return a - b; });
  var mid = n >> 1;
  var median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  var sum = 0, under = 0, i;
  for (i = 0; i < n; i++) { sum += gaps[i]; if (gaps[i] < RHYTHM_FAST_GAP_MS) under++; }
  var mean = sum / n, ss = 0;
  for (i = 0; i < n; i++) ss += (gaps[i] - mean) * (gaps[i] - mean);
  var sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  return { gaps: n, medianMs: round(median, 10), under60Share: round(under / n, 1000), cv: mean > 0 ? round(sd / mean, 1000) : 0 };
}
