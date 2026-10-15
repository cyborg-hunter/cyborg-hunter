// src/core/signals/clipboard.js
// Handles paste, copy, cut, and drop detection.
//
// Paste and drop are "hard" signals (count-based screenout).
// Copy is both hard (in strict preset) and soft (weighted).
//
// ctx.knownInputs is a shared array. dom-protection.js pushes injected decoy
// text here. clipboard.js checks against it when detecting pastes. This avoids
// circular imports — modules communicate through ctx, not through each other.

/**
 * Attaches clipboard-related trial listeners (paste, copy, cut, drop).
 * Called from monitor.js at startTrial() time.
 *
 * @param {Object} ctx - Shared context with config, trialData, addTrialListener,
 *                        fireSignal, isKnownInput, sessionData
 */
export function attachClipboardSignals(ctx) {
  var config = ctx.config;
  var trialData = ctx.trialData;

  // The pasted or dropped text to store, within the caps: at most
  // thresholds.maxPasteDropChars of one event, and what is left of
  // thresholds.maxPasteDropCharsPerTrial after this trial's earlier pastes
  // and drops (null switches either cap off). One paste can be many MB, and
  // the trial report rides with the participant's responses, so an uncapped
  // paste could push the submission past a platform's upload limit. The
  // caller always keeps the full length; `truncated` says text was cut.
  function keptText(text) {
    var limit = text.length;
    var perEvent = config.thresholds.maxPasteDropChars;
    var perTrial = config.thresholds.maxPasteDropCharsPerTrial;
    if (perEvent != null) limit = Math.min(limit, perEvent);
    if (perTrial != null) {
      var used = 0;
      var stored = trialData.pasteEvents.concat(trialData.dropEvents);
      for (var i = 0; i < stored.length; i++) {
        if (typeof stored[i].text === "string") used += stored[i].text.length;
      }
      limit = Math.min(limit, Math.max(0, perTrial - used));
    }
    return { text: text.slice(0, limit), truncated: limit < text.length };
  }

  // Adds the stored text (and `truncated` when it was cut) to the log entry
  // and the onSignal payload alike, so both carry the same content.
  function addText(entry, signal, text) {
    var kept = keptText(text);
    entry.text = kept.text;
    signal.text = kept.text;
    if (kept.truncated) {
      entry.truncated = true;
      signal.truncated = true;
    }
  }

  // ── Paste detection ──
  if (config.signals.paste) {
    ctx.addTrialListener(document, "paste", function (e) {
      var text = "";
      try { text = (e.clipboardData || window.clipboardData).getData("text"); } catch (err) {}
      var pastedLength = text.length;
      if (pastedLength >= config.thresholds.pasteMinChars) {
        var known = ctx.isKnownInput(e.target);
        var entry = {
          type: "paste", t: performance.now(),
          pastedLength: pastedLength,
          isKnownInput: known
        };
        // The onSignal payload follows the same content switch and caps as
        // the trial log: pasted text is handed to the researcher's callback
        // only when pasteDropContent is on. The raw DOM event `e` is still
        // passed through unchanged; what a callback reads from it (e.g. the
        // clipboardData) remains the researcher's own responsibility.
        var pasteSignal = { pastedLength: pastedLength, isKnownInput: known };
        if (config.collectForPostHoc.pasteDropContent) {
          addText(entry, pasteSignal, text);
        }
        trialData.pasteEvents.push(entry);
        ctx.sessionData.pasteCount++;
        ctx.fireSignal("paste", e, pasteSignal);
      }
    });
  }

  // ── Copy detection ──
  if (config.signals.copy) {
    ctx.addTrialListener(document, "copy", function (e) {
      var sel = window.getSelection();
      var selectedText = sel ? sel.toString() : "";
      var selectedLength = selectedText.length;
      trialData.copyEvents.push({
        type: "copy", t: performance.now(),
        selectedLength: selectedLength
      });
      ctx.sessionData.copyCount++;
      ctx.fireSignal("copy", e, { selectedLength: selectedLength });
    });

    // Cut is logged under the copy signal (same data concern — text leaving
    // the page). Stored in copyEvents alongside copy entries, and — like copy —
    // increments the session copyCount so the hard-copy screenout counts cuts
    // too. Without this, a cut showed up in the per-trial hard `trialHits` and
    // in the soft-copy score but never in the session total that actually
    // triggers, so strict-preset hard-copy could not fire on cuts.
    ctx.addTrialListener(document, "cut", function (e) {
      trialData.copyEvents.push({
        type: "cut", t: performance.now()
      });
      ctx.sessionData.copyCount++;
      ctx.fireSignal("cut", e, {});
    });
  }

  // ── Drop detection ──
  // Gated on its own signal flag (presets declare drop explicitly). Was
  // previously gated on paste by copy-paste error, so disabling paste
  // silently disabled drop — a separately hard-scored signal.
  if (config.signals.drop) {
    ctx.addTrialListener(document, "drop", function (e) {
      var text = "";
      try { text = e.dataTransfer.getData("text"); } catch (err) {}
      var droppedLength = text.length;
      if (droppedLength >= config.thresholds.dropMinChars) {
        var known = ctx.isKnownInput(e.target);
        var entry = {
          type: "drop", t: performance.now(),
          droppedLength: droppedLength,
          isKnownInput: known
        };
        // Same content switch and caps as paste (see above); the raw event
        // `e` is passed through unchanged and stays the researcher's
        // responsibility.
        var dropSignal = { droppedLength: droppedLength, isKnownInput: known };
        if (config.collectForPostHoc.pasteDropContent) {
          addText(entry, dropSignal, text);
        }
        trialData.dropEvents.push(entry);
        ctx.sessionData.dropCount++;
        ctx.fireSignal("drop", e, dropSignal);
      }
    });
  }
}
