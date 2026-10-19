// src/core/signals/typing.js
// Typing speed measurement and synthetic insertion detection.
//
// Synthetic insertion: text inserted without a preceding keydown event.
// This catches execCommand('insertText'), clipboard-manager pastes,
// and browser extension injections that bypass the paste event.
//
// Typing speed: computed at endTrial() from edit timestamps, (N − 1) edits
// per second from thresholds.typingMinEdits edits (20). The threshold
// (default 10 cps) flags unusually fast typing that suggests AI assistance.

import { typingRate, summarizeGaps, RHYTHM_MIN_GAPS } from '../../shared/typing-metrics.js';

/**
 * Attaches trial-scoped typing and synthetic insertion listeners.
 * Called from monitor.js at startTrial() time.
 *
 * Note: The clipboardManager signal handles both synthetic insertion
 * detection AND edit timestamp collection. When clipboardManager is off
 * but typingSpeed is on, a simpler input listener collects timestamps.
 * With signals.typingRhythm on, a third listener feeds ctx.typingRhythm
 * (see createTypingRhythm).
 */
// A field typing goes into. Tag names are compared upper-cased: a page served
// as application/xhtml+xml reports them in lower case.
function isTextField(el) {
  var tag = String(el.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || !!el.isContentEditable;
}

// ── Typing rhythm (signals.typingRhythm) ──
// Per trial and per text field: the gaps between one-character typed
// insertions (input events with inputType "insertText" and one character of
// data). A paste, an IME commit, an autocorrect replacement or a number
// spinner step is another inputType and is left out; a deletion or a line
// break in between does not break the run. A gap is dropped when the
// inserted character equals the previous one (a repeated letter, a key
// tapped over and over: not rhythm). The character is compared here, kept
// only until the next one, and never saved. The gaps stay in this object,
// which the monitor keeps outside trialData; endTrial saves only
// summarizeTypingRhythm's numbers.
// Input events trail their keydown by about a millisecond, so these gaps
// are the gaps between keystrokes.
export function createTypingRhythm() {
  return { fields: [] };
}

// One input event into the accumulator; t: its time in ms. A field is told
// apart from another by its element and named by its tag alone: the
// element's id is never read (a page can mirror what is typed into an id).
export function addRhythmInput(acc, target, inputType, data, t) {
  if (inputType !== "insertText" || typeof data !== "string" || data.length !== 1 || typeof t !== "number") return;
  var f = null;
  for (var i = 0; i < acc.fields.length; i++) {
    if (acc.fields[i].el === target) { f = acc.fields[i]; break; }
  }
  if (!f) {
    f = { el: target, tag: String(target.tagName || "").toLowerCase(), lastT: null, lastChar: null, gaps: [] };
    acc.fields.push(f);
  }
  if (f.lastT !== null && data !== f.lastChar && t >= f.lastT) f.gaps.push(t - f.lastT);
  f.lastT = t;
  f.lastChar = data;
}

// The trial's summaries: one per field with at least RHYTHM_MIN_GAPS gaps,
// { field: { tag }, gaps, medianMs, under60Share, cv }. A shorter field
// leaves nothing.
export function summarizeTypingRhythm(acc) {
  var out = [];
  for (var i = 0; i < acc.fields.length; i++) {
    var f = acc.fields[i];
    if (f.gaps.length < RHYTHM_MIN_GAPS) continue;
    var s = summarizeGaps(f.gaps);
    out.push({ field: { tag: f.tag }, gaps: s.gaps, medianMs: s.medianMs, under60Share: s.under60Share, cv: s.cv });
  }
  return out;
}

export function attachTypingSignals(ctx) {
  var config = ctx.config;
  var trialData = ctx.trialData;

  // ── Synthetic insertion detection + edit timestamps ──
  if (config.signals.clipboardManager) {
    var _lastKeydownTime = 0;
    ctx.addTrialListener(document, "keydown", function () {
      _lastKeydownTime = performance.now();
    });
    ctx.addTrialListener(document, "input", function (e) {
      if (e.target && isTextField(e.target)) {
        // Record edit timestamp for typing speed computation
        trialData.editTimestamps.push(performance.now());

        // Check if this input arrived without a recent keydown
        if (performance.now() - _lastKeydownTime > config.thresholds.syntheticGapMs && e.inputType === "insertText") {
          var dataLen = (e.data || "").length;
          trialData.syntheticInsertions.push({
            type: "synthetic_insertion", t: performance.now(),
            dataLength: dataLen
          });
          ctx.fireSignal("syntheticInsertion", e, { dataLength: dataLen });
        }
      }
    }, true); // capture phase to catch before frameworks
  }

  // ── Fallback: keystroke timestamps for typing speed only ──
  // If clipboardManager isn't enabled, still collect edit timestamps
  // for typing speed computation via a simpler listener.
  if (config.signals.typingSpeed && !config.signals.clipboardManager) {
    ctx.addTrialListener(document, "input", function (e) {
      if (e.target && isTextField(e.target)) {
        trialData.editTimestamps.push(performance.now());
      }
    }, true);
  }

  // ── Typing rhythm: per-field gaps, summarized at endTrial ──
  if (config.signals.typingRhythm && ctx.typingRhythm) {
    var rhythm = ctx.typingRhythm;
    ctx.addTrialListener(document, "input", function (e) {
      if (e.target && isTextField(e.target)) addRhythmInput(rhythm, e.target, e.inputType, e.data, performance.now());
    }, true);
  }
}

/**
 * Attaches trial-scoped foreign input detection.
 * When experimentContainer is set, tracks input events that land on
 * elements OUTSIDE the experiment's DOM. This catches participants
 * typing into AI extension sidebars, chatbot widgets, etc.
 */
export function attachForeignInputSignals(ctx) {
  var config = ctx.config;
  var trialData = ctx.trialData;

  ctx.addTrialListener(document, "input", function (e) {
    var target = e.target;
    if (!target) return;
    var isTextInput = isTextField(target);
    if (!isTextInput) return;
    var known = ctx.isKnownInput(target);
    if (known === false) {
      var entry = {
        t: performance.now(),
        targetTag: target.tagName || "unknown",
        targetId: (target.id || "").slice(0, 50),
        targetClass: (target.className || "").toString().slice(0, 100),
        inputType: e.inputType || ""
      };
      if (config.collectForPostHoc.foreignInputContent) {
        entry.data = e.data || "";
      }
      trialData.foreignInputEvents.push(entry);
      // The onSignal payload follows the same content switch as the trial
      // log: the typed characters reach the researcher's callback only when
      // foreignInputContent is on. The raw DOM event `e` is still passed
      // through unchanged; what a callback reads from it (e.g. e.data)
      // remains the researcher's own responsibility.
      var signalData = {
        targetTag: entry.targetTag,
        targetId: entry.targetId,
        targetClass: entry.targetClass
      };
      if (config.collectForPostHoc.foreignInputContent) {
        signalData.data = e.data || "";
      }
      ctx.fireSignal("typingOutsideExperiment", e, signalData);
    }
  }, true);
}

/**
 * Computes typing speed (chars per second) from edit timestamps.
 * Called from monitor.js at endTrial() time with thresholds.typingMinEdits.
 * (N − 1) edits per second over the span from the first edit to the last;
 * null with fewer than minEdits edits or a zero span: a short field's burst
 * says nothing about the typist (src/shared/typing-metrics.js).
 */
export function computeTypingSpeed(editTimestamps, minEdits) {
  return typingRate(editTimestamps, minEdits);
}
