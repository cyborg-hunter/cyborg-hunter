// src/oneliner/segmenter.js
// Keeps the monitor permanently inside a trial. The core attaches its paste,
// typing, mouse, idle-gap and element-trace listeners only between startTrial
// and endTrial (monitor.js startTrial), so a paste outside a trial is never
// recorded. The one-line setup therefore opens a span at boot and, at every
// boundary, closes the current trial and opens the next one in the same call.
//
// createSegmenter({ monitor, differ, clock, sourceDefault }) → {
//   start({ trialId })          open the boot span; no-op if already open
//                               → null | { error }
//   rotate(opts)                close the span (a "gap"), open the host's trial;
//                               no segment; the gap report is buffered for the
//                               next cut() and also returned
//                               → gapReport | null (nothing was open) | { error }
//   cut({ source, nextTrialId?, nextOpts?, label? })   close + segment + open next
//                               label { trialId?, phase? } renames the span
//                               being closed, on its report and segment only
//                               (a host trial that never rotated in, e.g.
//                               jsPsych call-function, adapters/jspsych-extension.js)
//                               → { segment, trialReport }          success
//                               → { segment, trialReport, error }   cut OK, reopen failed
//                               → { error }                         nothing was cut
//   finish({ source })          close + segment, nothing reopened
//                               → { segment, trialReport } | null (closed) | { error }
//   abandon()                   close without a segment (manual-mode hand-over)
//                               → null | { error }
//   state()                     { open, segmentIndex, currentTrialId }
//   setSegmentIndex(n)          multi-page restore
//   evidence()                  how many entries of the open span count as
//                               something the participant did (see below);
//                               0 with no open span, Infinity when unreadable
//   holdsEvidence(floor?)       evidence() > floor (default 0) → boolean
// }
//   differ: createSegmentDiffer(monitor) (src/oneliner/segment-diff.js)
//   clock:  () => number, the page origin (performance.timeOrigin); injectable
//
// Contract for the host adapters: a result with `segment` must be saved even
// when it also carries `error` (the data is complete; only the next span failed
// to open, and the error becomes the cyborgHunterError marker). A result with
// `error` alone means nothing was cut.
//
// None of these throws into the host: a monitor or differ failure is logged
// and returned as { error: message }. After finish() or abandon() the segmenter
// is latched: start/rotate/cut return { error: 'finished' | 'abandoned' }
// without touching the monitor, and finish() returns null.
//
// Keeping `open` true to the monitor. The monitor has no state getter, but
// transition() is the FIRST statement of both startTrial and endTrial
// (monitor.js), and its rejection message names the current state. So:
//   - any endTrial throw leaves the monitor outside a trial (rejected, or
//     already transitioned) → open = false;
//   - a startTrial throw that is not a lifecycle rejection means the
//     transition happened → the trial IS open (listeners maybe partly
//     attached) → open = true, so cut()/finish() still segment it rather than
//     drop it, and endTrial's removeTrialListeners cleans up whatever attached;
//   - a startTrial rejected "from 'trial'" means a trial we thought closed is
//     still open → close it, keep its report as a gap, and retry once.

// What evidence() counts. Every entry in one of the open trial's arrays (a
// paste, a copy, an edit, a click, a tab-away...) and every new entry in a
// session array (segment-diff.js newEntries()), but not the samples that
// accumulate with movement alone: mouse moves (a click, mousedown or mouseup
// still counts) and the element trace, sampled under the pointer while it
// moves. Nor what timers record whatever the participant does: idle gaps
// (the idle check says nobody acted) and the background window-position
// samples (BACKGROUND_KEYS). A participant who moves the mouse, or waits,
// while the next page loads would otherwise add a segment to every page.
var NOT_ACTIONS = { elementTrace: true, idleGaps: true };
function trialEvidence(trial) {
  var n = 0;
  Object.keys(trial).forEach(function (k) {
    var v = trial[k];
    if (!Array.isArray(v) || NOT_ACTIONS[k]) return;
    n += k === 'mouseEvents' ? v.filter(function (m) { return !m || m.type !== 'move'; }).length : v.length;
  });
  return n;
}

// Mirrors the message thrown by monitor.js transition(); null when `e` is not
// a lifecycle rejection.
var LIFECYCLE_FROM = /invalid lifecycle call: cannot transition from '(\w+)'/;
function lifecycleFrom(e) {
  var m = LIFECYCLE_FROM.exec(String((e && e.message) || e));
  return m ? m[1] : null;
}

export function createSegmenter(opts) {
  var monitor = opts.monitor;
  var differ = opts.differ;
  var clock = opts.clock || function () { return performance.timeOrigin; };
  var sourceDefault = opts.sourceDefault || 'host';

  var open = false;
  var latched = null;    // 'finished' | 'abandoned': the segmenter no longer drives the monitor
  var segmentIndex = 0;
  var currentTrialId = null;
  var gapReports = [];   // gap trial reports since the last cut

  function fail(what, e) {
    var message = String((e && e.message) || e);
    console.error('[cyborg-hunter] ' + what + ' failed: ' + message);
    return { error: message };
  }

  // A span the host did not name is called after the segment it will become.
  function spanId() { return 'span-' + segmentIndex; }

  function closeTrial() {
    try { return monitor.endTrial(); }
    finally { open = false; }
  }

  // The explicit trialId always wins: it is assigned last, so a trialId inside
  // `extra` (nextOpts, rotate's opts) can never rename the span.
  function openTrial(trialId, extra) {
    var args = Object.assign({}, extra || {}, { trialId: trialId });
    try {
      monitor.startTrial(args);
    } catch (e) {
      var from = lifecycleFrom(e);
      if (from === 'trial') {
        gapReports.push(closeTrial());
        monitor.startTrial(args);
      } else {
        if (from === null) { currentTrialId = trialId; open = true; }
        throw e;
      }
    }
    currentTrialId = trialId;
    open = true;
  }

  // Close the open trial and turn everything since the last cut into a segment.
  // A label renames the closed span after the fact: the monitor ran it under
  // its old name (decoy lookup, signal callbacks), only the saved names change.
  // The report is endTrial's own copy, so renaming it touches nothing else.
  function closeAndSegment(source, label) {
    var report = closeTrial();
    var trialId = currentTrialId;
    if (label && label.trialId) { trialId = label.trialId; if (report) report.trialId = label.trialId; }
    if (label && label.phase && report) report.phase = label.phase;
    var segment = differ.cut({
      segmentIndex: segmentIndex, source: source, trialId: trialId,
      pageOrigin: clock(), trialReport: report, gapReports: gapReports
    });
    gapReports = [];
    segmentIndex += 1;
    return { segment: segment, trialReport: report };
  }

  return {
    start: function (o) {
      if (latched) return { error: latched };
      if (open) return null;
      try {
        openTrial((o && o.trialId) || spanId());
        return null;
      } catch (e) { return fail('start', e); }
    },

    rotate: function (o) {
      if (latched) return { error: latched };
      o = o || {};
      var gap = null;
      try {
        if (open) {
          gap = closeTrial();
          gapReports.push(gap);
        }
      } catch (e) { return fail('trial rotation', e); }
      var extra = Object.assign({}, o);
      delete extra.trialId;
      try {
        openTrial(o.trialId || spanId(), extra);
      } catch (e) { return fail('trial rotation', e); }   // the gap, if any, stays buffered
      return gap;
    },

    cut: function (o) {
      if (latched) return { error: latched };
      o = o || {};
      var out;
      try {
        out = closeAndSegment(o.source || sourceDefault, o.label);
      } catch (e) { return fail('segment write', e); }
      try {
        openTrial(o.nextTrialId || spanId(), o.nextOpts);
      } catch (e) { out.error = fail('trial reopen', e).error; }
      return out;
    },

    finish: function (o) {
      if (latched) return null;
      latched = 'finished';
      if (!open) return null;
      try {
        return closeAndSegment((o && o.source) || 'final');
      } catch (e) { return fail('segment write', e); }
    },

    // Hands the monitor to the host (manual mode). Gap reports still buffered
    // are intentionally discarded: no cut() follows, and the abandoned spans
    // carry no host trial to attach them to.
    abandon: function () {
      if (latched) return null;
      latched = 'abandoned';
      if (!open) return null;
      try {
        closeTrial();
        return null;
      } catch (e) { return fail('abandon', e); }
    },

    state: function () {
      return { open: open, segmentIndex: segmentIndex, currentTrialId: currentTrialId };
    },

    setSegmentIndex: function (n) { segmentIndex = n; },

    // A read that fails counts as evidence (Infinity): the host then cuts,
    // which costs at most an extra segment, where a wrong "nothing" would
    // lose one.
    evidence: function () {
      if (latched || !open) return 0;
      try {
        var trial = monitor.getTrialSnapshot();
        return (trial ? trialEvidence(trial) : 0) + differ.newEntries(monitor.getSessionReport());
      } catch (e) { return Infinity; }
    },

    holdsEvidence: function (floor) {
      return this.evidence() > (floor || 0);
    }
  };
}
