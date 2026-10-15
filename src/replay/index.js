// src/replay/index.js
// Public assembly for the replay recorder: singleton attach(), capture
// wiring by tier, serialization + persistence surface.
//
// Standalone usage (no jsPsych):
//   const rec = CyborgHunterReplay.attach({ participantId, tier: 'dom',
//     autoSave: { mode: 'datapipe', experimentId: 'ABC' } });
//   rec.startSession();
//   rec.startTrial({ trialId: 'r1' });  // optional bracketing
//   rec.endTrial();
//   rec.stopSession('finished');        // resumeSession() records on; call
//                                       // startTrial() right after it
//   await rec.autoSaveNow();            // or rec.getRecording() and DIY
//   rec.destroy();

import { createRecorder } from './recorder.js';
import { attachTraceCapture } from './capture-trace.js';
import { attachDomCapture } from './capture-dom.js';
import { createSpan } from './span.js';
import { serialize, SCHEMA_VERSION } from './serializer.js';
import { createPieceTaker } from './pieces.js';
import {
  replayFilename, buildReplayMeta, autoSave, compressRecording,
} from './persistence.js';

var _active = null;

// The researcher's redactSelector, checked once: null when it is usable (or
// absent, or there is no document to check it against), else the error the
// browser's selector parser threw. isRedacted() (redaction.js) turns a
// throwing selector into "redacts nothing", deliberately, so a typo would
// otherwise drop the configured redaction without a sign; attach() makes it
// loud instead. Checked on an empty fragment, which parses the selector and
// matches nothing.
function redactSelectorError(selector) {
  if (!selector || typeof document === 'undefined' || !document ||
      typeof document.createDocumentFragment !== 'function') return null;
  try {
    document.createDocumentFragment().querySelector(selector);
    return null;
  } catch (e) {
    return e || new Error('invalid selector');
  }
}

/**
 * Create (and replace) the singleton recorder.
 *
 * REDACTION CARRIES ACROSS RECORDINGS ON ONE PAGE. Spec §8 makes redaction a
 * property of the FILE, and the mechanism that enforces it — redaction.js's
 * taint set, which remembers every node whose content was ever withheld — has
 * PAGE lifetime, not recording lifetime. So a second `attach()` in the same
 * page load inherits the first's withholding: a field the first recording
 * redacted stays empty in the second even if the second configures no
 * redaction at all.
 *
 * This is deliberate. NOT for the reason this comment used to give: it said a
 * reset here would re-open the §8 move-out hole (a node withheld at a keyframe,
 * moved out of its container, re-serialized). That argument does not hold, and
 * an external review was right to say so. §8 scopes redaction PER FILE, and by
 * the time `attach()` runs the previous recording is serialized and closed —
 * nothing a second recorder does can put content into it, so a per-recording
 * reset could not re-expose anything there. The move-out hole lives WITHIN one
 * recording, where the set already closes it.
 *
 * The two reasons it does stand:
 *
 *   1. FAIL-CLOSED against FAIL-OPEN. A page-lifetime ratchet can only ever
 *      over-redact. A per-recording set can under-redact relative to today, and
 *      this program's invariant is that redaction leaks fail the build.
 *      Over-redaction is a diagnosable annoyance; under-redaction is a
 *      participant-privacy failure.
 *   2. It would re-open the THREADING SEAM this design closed. "One set per
 *      recorder" means threading an explicit object to four consumers (snapshot,
 *      mutations, initial-state, capture-trace), and partial threading fails
 *      OPEN — see the note in `startSession` below. Trading a known
 *      over-redaction for an unknown under-redaction runs the wrong way.
 *
 * The residual cost is real and narrow: a researcher who deliberately turns
 * redaction OFF for a later block of a same-page-load SPA gets a field that
 * stays empty with no explanation. The answer to that is to REPORT it, not to
 * remove the ratchet — `extensions["cyborg-hunter"].inherited_redaction_taint`
 * is true whenever this recording started on a page that had already withheld
 * something. Both the inheritance and the flag are pinned in capture-e2e.test.js.
 */
// What a refused attach() returns: every method does nothing, and nothing
// is recorded or saved. `refused: true` says so to code that checks.
function refusedApi() {
  var noop = function () { return api; };
  var api = {
    refused: true,
    startSession: noop, startTrial: noop, endTrial: noop, stopSession: noop, resumeSession: noop,
    getRecording: function () { return null; },
    getRecordingCompressed: function () { return Promise.resolve(null); },
    pieceTaker: function () { return { take: function () { return null; } }; },
    autoSaveNow: function () {
      return Promise.resolve({ recording: null, saveResult: { saved_to: 'no_session' },
        meta: { schema_version: SCHEMA_VERSION, saved_to: 'no_session', note: 'attach() was refused; nothing recorded' } });
    },
    destroy: function () {}
  };
  return api;
}

export function attach(userConfig) {
  // The one-line setup (ch.js, ch-labjs.js) records by default and saves its
  // recording with the data (_ownerSavesRecording marks its recorder). A
  // page's own attach() would destroy that recording and leave a near-empty
  // one in the saved data, so it is refused, loudly, with a recorder that
  // does nothing. The one-line setup's own re-attach still replaces.
  if (_active && _active.config._ownerSavesRecording && !(userConfig && userConfig._ownerSavesRecording)) {
    console.error('[cyborg-hunter-replay] attach() refused: ch.js is already recording this page and saves the ' +
      'recording with your data. Get it with CyborgHunter.replay(), or set data-replay="off" on the ch.js tag to ' +
      'record with your own attach() instead.');
    return refusedApi();
  }
  if (_active) {
    console.warn('[cyborg-hunter-replay] attach() called while a recorder is active — replacing the previous instance (its unsaved recording is discarded).');
    _active.destroy();
    _active = null;
  }

  var rec = createRecorder(userConfig);

  // An invalid redactSelector redacts nothing (redaction.js isRedacted):
  // warned here, once, and recorded in the recording as a capture failure at
  // startSession below, so that its time falls inside the session.
  var redactError = redactSelectorError(rec.config.redactSelector);
  if (redactError) {
    console.warn('[cyborg-hunter-replay] redactSelector "' + String(rec.config.redactSelector) +
      '" is not a valid CSS selector, so it redacts nothing (password fields are still withheld). Fix the selector.');
  }

  var api = {
    // Exposed for tests and advanced integrations; not part of the
    // documented surface.
    _recorder: rec,
    config: rec.config,

    startSession: function () {
      rec.startSession();
      if (redactError) {
        rec.captureFailure('redact_selector', new Error(
          'redactSelector "' + String(rec.config.redactSelector) + '" is not a valid CSS selector, so it redacted nothing (' +
          String((redactError && redactError.message) || redactError) + ')'));
      }
      // ONE capture span per recording (span.js): the node ids the keyframe
      // assigns and the record of what the file contains. Both capture modules
      // get the SAME object, because an event's `target` and a patch's `node`
      // are the same numbering or neither of them means anything. Created here,
      // reset at each keyframe by the DOM capture.
      var span = createSpan();
      // The §8 redaction taint set is deliberately NOT threaded alongside it.
      // Both capture modules accept one, and threading an explicit object to
      // some consumers and not others is the failure this seam invites: the
      // halves stop sharing, and a field moved out of a redacted container is
      // re-exposed by whichever half was forgotten. Passing NONE puts every
      // consumer — snapshot, mutations, initial-state, capture-trace — on
      // redaction.js's single module-level set, which is the symmetric answer
      // and the fail-closed one: a future consumer that forgets to thread
      // still lands in the same place. Its cost is that two recorders on one
      // page can over-redact each other's nodes, which is the safe direction,
      // and is what redaction.js documents.
      //
      // Capture modules attach after the session transition so nothing
      // touches the DOM until the researcher opts in. Trace capture goes
      // FIRST for one mundane reason: `attachDomCapture` needs
      // `trace.getScrolledElements` as a VALUE, and that handle only exists
      // once trace capture has attached.
      //
      // Not because of hook ordering. `getScrolledElements()` prunes detached
      // elements on read (capture-trace.js), so the trial-start prune hook is
      // redundant for the seed and reversing the two attachments changes
      // nothing observable. That hook stays for the other reason it was
      // written: the tracker is a STRONG Set, so pruning once per trial bounds
      // its growth even across trials where nothing reads it.
      //
      // The handle is passed as a live function rather than as a snapshot of
      // the Set, so that elements which first scroll after this line are still
      // seeded — see capture-dom.test.js ("enumerates capture-trace's scrolled
      // elements", which adds to the set after attach) and end to end in
      // capture-e2e.test.js ("the second keyframe seeds the scroll it
      // inherited"). Neither test DISCRIMINATES, though: `getScrolledElements`
      // returns the live Set by reference, so caching its result here would
      // pass both. The function form buys independence from that — a tracker
      // that returned a copy, or rebuilt its set, would still work — which is
      // a property of the seam, not one today's tests can see.
      var trace = attachTraceCapture(rec, { span: span });
      if (rec.config.tier === 'dom' || rec.config.tier === 'canvas') {
        // 'canvas' is accepted for forward compat but captures at dom tier
        // in v0.7 (canvas snapshots arrive with the v0.8 diff codec).
        attachDomCapture(rec, {
          span: span,
          scrolled: trace.getScrolledElements,
        });
      }
      return api;
    },

    startTrial: function (opts) { rec.startTrial(opts); return api; },
    endTrial: function () { rec.endTrial(); return api; },
    stopSession: function (reason) { rec.stopSession(reason); return api; },
    // Records again after a stop, in the same recording (recorder.js). Call
    // startTrial() right after: the first segment after a resume is a
    // keyframe, and an event that arrives before it opens loses its target id
    // (capture-dom.js empties the span at resume).
    resumeSession: function () { rec.resumeSession(); return api; },

    getRecording: function (opts) {
      return serialize(rec.getState(), opts || {});
    },

    // The recording in pieces, one per call to take(), each holding what
    // closed since the last (pieces.js). The one-line setup writes them into
    // the rows the experiment already saves, so a save trial that takes its
    // snapshot mid-session still has every earlier trial's recording.
    // opts: { host, recordingId }.
    pieceTaker: function (opts) {
      return createPieceTaker(rec.getState, opts || {});
    },

    getRecordingCompressed: function (opts) {
      return compressRecording(api.getRecording(opts));
    },

    // Serialize + persist with the configured autoSave mode; returns
    // { recording, saveResult, meta } so callers (the jsPsych adapter, or a
    // standalone researcher) can attach the meta pointer to their data.
    // Teardown-safe: if the session never started (nothing to serialize),
    // it degrades to a no_session result instead of throwing, so a finish
    // path is never interrupted — while a DIRECT getRecording() before
    // startSession still throws to surface the programmer error.
    autoSaveNow: async function (opts) {
      if (rec.getState().sessionStart == null) {
        return {
          recording: null,
          saveResult: { saved_to: 'no_session' },
          meta: { schema_version: SCHEMA_VERSION, saved_to: 'no_session',
                  note: 'recorder was never started; nothing to save' }
        };
      }
      var recording = api.getRecording(opts);
      var saveResult = await autoSave(recording, rec.config.autoSave);
      var meta = buildReplayMeta(recording, saveResult.saved_to);
      if (saveResult.error) meta.save_error = saveResult.error;
      return { recording: recording, saveResult: saveResult, meta: meta };
    },

    destroy: function () {
      rec.destroy();
      if (_active === api) _active = null;
    }
  };

  _active = api;
  return api;
}

export { replayFilename, buildReplayMeta, serialize };

// Browser global — same pattern as the guard extensions (explicit window
// assignment; no esbuild globalName). replayFilename rides along so a
// researcher saving the recording to their own server names it exactly as
// the CLI expects (sanitized participant id), without an ES import.
// Keeps the first definition, as the guard cores do: a page's own
// CyborgHunterReplay, or a second copy of this file, is not overwritten.
// Quiet when ch.js re-runs in a host that re-renders its header (Qualtrics;
// src/oneliner/rerun.js sets the flag).
if (typeof window !== 'undefined') {
  if (!window.CyborgHunterReplay) {
    window.CyborgHunterReplay = { attach: attach, replayFilename: replayFilename };
  } else if (!window.__cyborgHunterRerun) {
    console.error('[cyborg-hunter-replay] Not redefining CyborgHunterReplay: it is already defined, so two scripts on ' +
      'this page include the session recorder, or the page defines that name. Fix: keep one of them (ch.js and ' +
      'ch-labjs.js already contain the recorder).');
  }
}
