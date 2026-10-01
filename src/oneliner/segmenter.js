// src/oneliner/segmenter.js
// Keeps the monitor permanently inside a trial. The core attaches its paste,
// typing, mouse, idle-gap and element-trace listeners only between startTrial
// and endTrial (monitor.js startTrial), so a paste outside a trial is never
// recorded. The one-line setup therefore opens a span at boot and, at every
// boundary, closes the current trial and opens the next one in the same call.
//
// createSegmenter({ monitor, differ, clock, sourceDefault }) → {
//   start({ trialId })          open the boot span; no-op if already open
//   rotate(opts)                close the span (a "gap"), open the host's trial;
//                               no segment; the gap report is buffered for the
//                               next cut() and also returned
//   cut({ source, nextTrialId?, nextOpts? })   close + segment + open next
//                               → { segment, trialReport } | { error }
//   finish({ source })          close + segment, nothing reopened; null if closed
//   abandon()                   close without a segment (manual-mode hand-over)
//   state()                     { open, segmentIndex, currentTrialId }
//   setSegmentIndex(n)          multi-page restore
// }
//   differ: createSegmentDiffer(monitor) (src/oneliner/segment-diff.js)
//   clock:  () => number, the page origin (performance.timeOrigin); injectable
//
// None of these throws into the host: a monitor or differ failure is logged
// and returned as { error: message }, and the segmenter is marked closed so a
// later start() can reopen it.

export function createSegmenter(opts) {
  var monitor = opts.monitor;
  var differ = opts.differ;
  var clock = opts.clock || function () { return performance.timeOrigin; };
  var sourceDefault = opts.sourceDefault || 'host';

  var open = false;
  var segmentIndex = 0;
  var currentTrialId = null;
  var gapReports = [];   // gap trial reports since the last cut

  function fail(what, e) {
    open = false;
    var message = String((e && e.message) || e);
    console.error('[cyborg-hunter] ' + what + ' failed: ' + message);
    return { error: message };
  }

  // A span the host did not name is called after the segment it will become.
  function spanId() { return 'span-' + segmentIndex; }

  function openTrial(trialId, extra) {
    monitor.startTrial(Object.assign({}, extra || {}, { trialId: trialId }));
    currentTrialId = trialId;
    open = true;
  }

  // Close the open trial and turn everything since the last cut into a segment.
  function closeAndSegment(source) {
    var report = monitor.endTrial();
    open = false;
    var segment = differ.cut({
      segmentIndex: segmentIndex, source: source, trialId: currentTrialId,
      pageOrigin: clock(), trialReport: report, gapReports: gapReports
    });
    gapReports = [];
    segmentIndex += 1;
    return { segment: segment, trialReport: report };
  }

  return {
    start: function (o) {
      if (open) return;
      try {
        openTrial((o && o.trialId) || spanId());
      } catch (e) { return fail('start', e); }
    },

    rotate: function (o) {
      o = o || {};
      try {
        var gap = null;
        if (open) {
          gap = monitor.endTrial();
          open = false;
          gapReports.push(gap);
        }
        var extra = Object.assign({}, o);
        delete extra.trialId;
        openTrial(o.trialId || spanId(), extra);
        return gap;
      } catch (e) { return fail('trial rotation', e); }
    },

    cut: function (o) {
      o = o || {};
      try {
        var out = closeAndSegment(o.source || sourceDefault);
        openTrial(o.nextTrialId || spanId(), o.nextOpts);
        return out;
      } catch (e) { return fail('segment write', e); }
    },

    finish: function (o) {
      if (!open) return null;
      try {
        return closeAndSegment((o && o.source) || 'final');
      } catch (e) { return fail('segment write', e); }
    },

    abandon: function () {
      if (!open) return;
      try {
        monitor.endTrial();
        open = false;
      } catch (e) { return fail('abandon', e); }
    },

    state: function () {
      return { open: open, segmentIndex: segmentIndex, currentTrialId: currentTrialId };
    },

    setSegmentIndex: function (n) { segmentIndex = n; }
  };
}
