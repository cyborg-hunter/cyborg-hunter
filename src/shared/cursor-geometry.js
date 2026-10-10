// src/shared/cursor-geometry.js
// Geometry of a run of pointer samples ({x, y} objects): the length of the
// path through them, the straight-line distance from first to last, and how
// far the path strays from that straight line. Shared by the core's
// computeMouseMetrics (per trial) and the report's cursor analyzer (per
// movement), so the two never disagree on what a distance is. No rounding
// here: callers round for display.

function dist(a, b) {
  var dx = b.x - a.x, dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Sum of the distances between consecutive samples. 0 for fewer than two.
export function pathLength(points) {
  var total = 0;
  for (var i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

// Straight-line distance from the first sample to the last. 0 for fewer than two.
export function displacement(points) {
  if (points.length < 2) return 0;
  return dist(points[0], points[points.length - 1]);
}

// The largest perpendicular distance of any sample from the chord (first to
// last). When the chord has no length, the distance from the first point.
export function maxDeviation(points) {
  if (points.length < 2) return 0;
  var a = points[0], b = points[points.length - 1];
  var chord = dist(a, b);
  var max = 0;
  for (var i = 1; i < points.length - 1; i++) {
    var p = points[i];
    var d = chord === 0
      ? dist(a, p)
      : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / chord;
    if (d > max) max = d;
  }
  return max;
}
