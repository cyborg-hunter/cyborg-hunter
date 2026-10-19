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
