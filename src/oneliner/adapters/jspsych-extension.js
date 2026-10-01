// src/oneliner/adapters/jspsych-extension.js
// The jsPsych extension ch.js injects into every trial (adapters/jspsych.js
// adds it to initJsPsych's list and to each trial object). Unlike the manual
// extension (src/jspsych/extension-cyborg-hunter.js) it creates no monitor:
// boot already has one, kept inside a trial by the segmenter. So:
//   on_load    rotate: close the span before this trial (a "gap"), open the
//              host trial;
//   on_finish  cut: close the host trial, turn everything since the last cut
//              into a segment, open the next gap span. The returned object is
//              merged into this trial's own row by jsPsych (jspsych.js 7.3.1
//              :2772, :2814-2823), before the trial's own on_finish, so
//              whatever save the researcher already does carries the segment
//              and the running totals up to this row.
//
// The class keeps info.name 'cyborg-hunter' (jsPsych keys its extension
// instances by name) and exposes `.monitor`, which the replay extension reads
// through jsPsych.extensions['cyborg-hunter'].monitor.
//
// A trial listing the manual class by name (a researcher-named entry with
// params.trialId) reaches this instance too, with its params, so its trialId
// names the segment.
//
// ctx (set by installJsPsychAdapter): { monitor, segmenter, jspsych, debug? }.
// None of the hooks throws into jsPsych: a failure becomes cyborgHunterError
// on the row.

export class OneLinerExtension {
  static info = {
    name: 'cyborg-hunter',
    // Hand-bumped with the package version (tests/cli/version-invariant.test.js
    // pins it to package.json by reading this literal).
    version: '0.9.1',
    data: {
      integrity: { type: 'object' },
      integritySegment: { type: 'object' }
    }
  };

  static ctx = null;

  constructor(jsPsych) {
    this.jsPsych = jsPsych;
    this._trialStart_perfNow = null;
    this._loadError = null;
  }

  get monitor() {
    return OneLinerExtension.ctx ? OneLinerExtension.ctx.monitor : null;
  }

  // The monitor already exists (boot); nothing to set up.
  initialize(_params) {}

  // jsPsych 7 calls on_start on every trial that lists the extension.
  on_start(_params) {}

  on_load(params) {
    var ctx = OneLinerExtension.ctx;
    this._loadError = null;
    if (!ctx) return;
    try {
      // Same anchor as the manual extension: ingest subtracts it from the
      // tab-away `start` times (same performance.now() clock).
      this._trialStart_perfNow = performance.now();
      var r = ctx.segmenter.rotate({
        trialId: (params && params.trialId) || 'trial-' + this.jsPsych.getProgress().current_trial_global,
        phase: (params && params.phase) || null,
        // ?? not ||: an explicit decoyAnswer:false (skip the decoy) must reach
        // the core as false.
        decoyAnswer: params && params.decoyAnswer !== undefined && params.decoyAnswer !== null ? params.decoyAnswer : null,
        experimentContainer: (params && params.experimentContainer) || null
      });
      if (r && r.error) this._loadError = r.error;
    } catch (e) {
      this._loadError = String((e && e.message) || e);
    }
  }

  on_finish(_params) {
    var ctx = OneLinerExtension.ctx;
    if (!ctx) return {};
    var t0 = performance.now();
    var out;
    try {
      var idx = this.jsPsych.getProgress().current_trial_global;
      var r = ctx.segmenter.cut({ source: 'host', nextTrialId: 'gap-' + idx });
      if (r && r.segment) {
        var report = r.trialReport || {};
        report.trialStart_perfNow = this._trialStart_perfNow;
        out = {
          integrity: report,
          integritySegment: r.segment,
          integrityPasteCount: r.segment.counters.pasteCount,
          integrityCopyCount: r.segment.counters.copyCount,
          integrityDropCount: r.segment.counters.dropCount,
          integritySoftScore: r.segment.score.softScore,
          integrityAnyHardTriggered: r.segment.score.anyHardTriggered
        };
        // A segment that comes with an error is complete; only the next span
        // failed to open. Save it, and mark the row.
        var err = r.error || this._loadError;
        if (err) out.cyborgHunterError = err;
        if (ctx.jspsych) ctx.jspsych.segmentsWritten = (ctx.jspsych.segmentsWritten || 0) + 1;
      } else {
        out = { cyborgHunterError: (r && r.error) || this._loadError || 'no segment' };
      }
    } catch (e) {
      out = { cyborgHunterError: String((e && e.message) || e) };
    }
    this._trialStart_perfNow = null;
    this._loadError = null;
    try {
      if (ctx.debug && ctx.debug.stats) ctx.debug.stats().segmentWriteMs.push(performance.now() - t0);
    } catch (_) { /* debug counters are optional */ }
    return out;
  }
}
