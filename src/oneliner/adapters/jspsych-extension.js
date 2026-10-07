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
// A late on_load is dropped. A synchronous plugin (call-function) finishes
// inside its own trial() call, and jsPsych runs that trial's load callback
// only afterwards (jspsych.js 7.3.1 :3046-3056, :3101-3103), in one of two
// orders:
//   - nextTrial runs synchronously from finishTrial: the next trial's
//     on_start and on_load come first, then the stale on_load, which would
//     close the next trial's span as a gap and reopen it unnamed;
//   - post_trial_gap / default_iti > 0 defer nextTrial: the stale on_load
//     comes right after its own on_finish and would open a span for a trial
//     that already ended.
// A third order: when the next trial's trial() returns a Promise (jsPsych 7
// audio plugins, custom plugins), jsPsych leaves its load callback to the
// plugin (:3099-3103), so the stale on_load arrives after the next trial's
// on_start but before that trial's own on_load.
// An index check (current_trial_global) catches only the first order: in the
// second the index has not moved yet. So on_start arms the load and records
// the params object jsPsych passed; on_load counts only while armed and only
// with that same object; on_finish disarms. jsPsych hands one trial's
// on_start and on_load the same object (extension.params of the same trial,
// :3027-3030, :3046-3054), and the adapter gives every trial its own copy of
// the injected entry, so the stale call is rejected in all three orders.
// (jsPsych calls the extension's on_start on every trial that lists it, so
// every real on_load is armed.)
//
// The synchronous trial's own row is therefore cut from the gap span the
// previous cut opened, named `gap-<index of the previous trial>`. When
// on_finish finds the load still armed with this trial's params (it never
// rotated in) and those params carry a trialId and/or phase, the cut takes
// them as the closed span's label (segmenter.js cut's `label`): the row's
// integrity and integritySegment carry the researcher's names. Only the names
// change: the span, its counts and timing, and the next trial's naming and
// rotation stay as they are. Without a trialId or phase the row keeps
// `gap-<n>`; a label missing one of the two keeps the span's own value for it.
//
// After the session has ended (the final hook ran, ctx.jspsych.finalized),
// both hooks leave the segmenter alone: rows of a second jsPsych instance
// that runs afterwards get no cyborgHunterError ('finished') marker; the
// adapter warned about the second instance when it was created. They also
// stand down when the deferred session start failed (ctx.bootError, boot.js
// failDeferred), which marked every row already.
//
// ctx (set by installJsPsychAdapter): { monitor, segmenter, jspsych, debug? }.
// None of the hooks throws into jsPsych: a failure becomes cyborgHunterError
// on the row. With no ctx (ch.js failed or stood down, boot.js; the class is
// still registered so researcher trials typed jsPsychCyborgHunter run) every
// hook does nothing.
//
// Leftovers of manual wiring on a half-migrated page, where
// jsPsychCyborgHunter is this class: participantId / preset in the
// initJsPsych entry's params (initialize) and the on_finish finalize() call
// each warn once from the catalogue and are otherwise ignored; finalize()
// existing at all keeps the researcher's save code after it running.

import { MESSAGES } from '../errors.js';

// The names a researcher set on a trial, or null when there are none.
function labelOf(params) {
  if (!params) return null;
  var label = {};
  if (params.trialId) label.trialId = params.trialId;
  if (params.phase) label.phase = params.phase;
  return label.trialId || label.phase ? label : null;
}

export class OneLinerExtension {
  static info = {
    name: 'cyborg-hunter',
    // Hand-bumped with the package version (tests/cli/version-invariant.test.js
    // pins it to package.json by reading this literal).
    version: '0.12.0',
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
    this._loadArmed = false;
    this._armedParams = undefined;
    this._paramsWarned = false;
    this._finalizeWarned = false;
  }

  get monitor() {
    return OneLinerExtension.ctx ? OneLinerExtension.ctx.monitor : null;
  }

  // The monitor already exists (boot); nothing to set up. jsPsych passes the
  // initJsPsych entry's params (a researcher's entry wins the dedupe over
  // ours, adapters/jspsych.js).
  initialize(params) {
    if (this._paramsWarned || !params) return;
    if (params.participantId !== undefined || params.preset !== undefined) {
      this._paramsWarned = true;
      console.warn(MESSAGES.extensionParamsIgnored());
    }
  }

  // The manual extension's end-of-session call. ch.js ends the session from
  // initJsPsych's on_finish (adapters/jspsych.js), before the researcher's.
  finalize() {
    if (this._finalizeWarned) return;
    this._finalizeWarned = true;
    console.warn(MESSAGES.finalizeNotNeeded());
  }

  // jsPsych 7 calls on_start on every trial that lists the extension, before
  // the plugin's trial(): arm this trial's on_load, for these params only.
  on_start(params) {
    this._loadArmed = true;
    this._armedParams = params;
  }

  on_load(params) {
    var ctx = OneLinerExtension.ctx;
    // A late on_load (see the header) is dropped before anything is reset:
    // the trial now open keeps its anchor and any rotate error.
    if (!this._loadArmed || params !== this._armedParams) return;
    this._loadArmed = false;
    this._armedParams = undefined;
    this._loadError = null;
    if (!ctx || ctx.bootError || (ctx.jspsych && ctx.jspsych.finalized)) return;
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
    // jsPsych's prepareDom wiped <body>, badge included, before the first
    // trial; this puts it back while that trial is on screen.
    try { if (ctx.debug && ctx.debug.refresh) ctx.debug.refresh(); } catch (_) { /* a debug aid */ }
  }

  on_finish(params) {
    var ctx = OneLinerExtension.ctx;
    // Still armed with this trial's params: its on_load never came (a
    // synchronous plugin, see the header).
    var neverLoaded = this._loadArmed && params === this._armedParams;
    this._loadArmed = false;
    this._armedParams = undefined;
    if (!ctx || ctx.bootError || (ctx.jspsych && ctx.jspsych.finalized)) return {};
    // Timed only under data-debug: no clock reads otherwise.
    var t0 = ctx.debug ? performance.now() : 0;
    var out;
    try {
      var idx = this.jsPsych.getProgress().current_trial_global;
      var cutOpts = { source: 'host', nextTrialId: 'gap-' + idx };
      var label = neverLoaded ? labelOf(params) : null;
      if (label) cutOpts.label = label;
      var r = ctx.segmenter.cut(cutOpts);
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
      // The timing covers ch.js's cut plus output assembly, not jsPsych's own
      // merge of this output into the data row.
      if (ctx.debug && ctx.debug.stats) ctx.debug.stats().segmentWriteMs.push(performance.now() - t0);
      if (ctx.debug && ctx.debug.refresh) ctx.debug.refresh();   // after the timing push
    } catch (_) { /* debug counters are optional */ }
    return out;
  }
}
