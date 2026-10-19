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

import { typingRate } from '../../shared/typing-metrics.js';

/**
 * Attaches trial-scoped typing and synthetic insertion listeners.
 * Called from monitor.js at startTrial() time.
 *
 * Note: The clipboardManager signal handles both synthetic insertion
 * detection AND edit timestamp collection. When clipboardManager is off
 * but typingSpeed is on, a simpler input listener collects timestamps.
 */
// A field typing goes into. Tag names are compared upper-cased: a page served
// as application/xhtml+xml reports them in lower case.
function isTextField(el) {
  var tag = String(el.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || !!el.isContentEditable;
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
