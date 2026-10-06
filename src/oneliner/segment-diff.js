// src/oneliner/segment-diff.js
// Turns the monitor's cumulative session report into per-segment deltas.
// The session arrays are append-only (every write in src/core is a .push), so
// "what happened since the last cut" is report[key].slice(lastSeen[key]).
// Keys are discovered at every cut, not fixed at build time, so a signal added
// to the core later flows through without touching this file.
//
// createSegmentDiffer(monitor) → { cut(meta) → segment, seen() → {[key]: number},
//                                  newEntries(report) → number }
//   monitor: anything with getSessionReport() and getSessionScore()
//   meta: { segmentIndex, source: 'manual'|'host'|'page'|'final', trialId,
//           pageOrigin, trialReport?, gapReports? }
//   segment: { segmentIndex, source, trialId, pageOrigin,
//              deltas: { [arrayKey]: any[] },   // every array key except aliases
//              counters: { pasteCount, copyCount, dropCount },
//              score: getSessionScore() verbatim,
//              gap?: [...],                     // non-empty gap reports only
//              config?, libraryVersion? }       // segmentIndex === 0 only
//
// The CLI side (src/cli/segment-reassembly.js) concatenates the deltas back
// into the session shape finalize() dumps.

// Keys that are the same array as another key inside the monitor (monitor.js
// keeps layoutShifts as a deprecated alias of viewportWidthShifts). Skipped on
// the way out so the entries are not shipped twice; restored on the way in
// (src/cli/segment-reassembly.js keeps a copy; a test pins the two equal).
export const ALIAS_KEYS = { layoutShifts: 'viewportWidthShifts' };

// Session arrays the core fills on a timer whatever the participant does
// (windowPositions: one sample every 2 s, src/core/signals/browser.js). A cut
// saves them like any other, but their new entries alone do not make a span
// worth cutting (see newEntries()).
export const BACKGROUND_KEYS = { windowPositions: true };

export function createSegmentDiffer(monitor) {
  var lastSeen = {};
  function arrayKeys(report) {
    return Object.keys(report).filter(function (k) {
      return Array.isArray(report[k]) && !(k in ALIAS_KEYS);
    });
  }
  // A gap report covers the time between two host trials. Most are empty;
  // only those with paste/copy/drop/synthetic-insertion evidence are kept,
  // and only those four arrays plus the duration (no mouse trace).
  function nonEmptyGap(r) {
    var keys = ['pasteEvents', 'copyEvents', 'dropEvents', 'syntheticInsertions'];
    var any = keys.some(function (k) { return Array.isArray(r[k]) && r[k].length > 0; });
    if (!any) return null;
    var out = { duration_ms: r.duration_ms };
    keys.forEach(function (k) { out[k] = r[k] || []; });
    return out;
  }
  return {
    seen: function () { return Object.assign({}, lastSeen); },
    // How many entries the next cut would take from the session arrays,
    // background ones left out.
    newEntries: function (report) {
      return arrayKeys(report).reduce(function (n, k) {
        return k in BACKGROUND_KEYS ? n : n + Math.max(0, report[k].length - (lastSeen[k] || 0));
      }, 0);
    },
    cut: function (meta) {
      var report = monitor.getSessionReport();   // one deep copy per cut (monitor.js getSessionReport); O(session size)
      var deltas = {};
      arrayKeys(report).forEach(function (k) {
        var from = lastSeen[k] || 0;
        deltas[k] = report[k].slice(from);
        lastSeen[k] = report[k].length;
      });
      var seg = {
        segmentIndex: meta.segmentIndex, source: meta.source, trialId: meta.trialId, pageOrigin: meta.pageOrigin,
        deltas: deltas,
        counters: { pasteCount: report.pasteCount, copyCount: report.copyCount, dropCount: report.dropCount },
        score: monitor.getSessionScore()
      };
      var gaps = (meta.gapReports || []).map(nonEmptyGap).filter(Boolean);
      if (gaps.length) seg.gap = gaps;
      if (meta.segmentIndex === 0) { seg.config = report.config; seg.libraryVersion = report.libraryVersion; }
      return seg;
    }
  };
}
