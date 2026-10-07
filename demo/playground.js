// demo/playground.js
// The scoring step's live soft score (demo.js wireScoringPanel): the
// visitor's own session so far, rescored under the step's weight edits.
// Changing analysis settings after the fact is the analyzer's job
// (demo/analyze/settings-panel.js); this file only re-scores collection-time
// data, which no analysis setting can do.
//
// Why a data pre-pass and not just config overrides (a config override alone
// cannot flip the tier): the analyzers trust DATA-CARRIED
// verdicts over analyst config on BOTH tiers —
//   HARD: summary.js prefers metadata.integritySession.anyHardTriggered
//         (falling back to trialSignals.hard.*.sessionTotal/countThreshold);
//   SOFT: triage.js flags against authoritativeSoftScore — the session's
//         softScore, computed once at collection (scoring.js) and never
//         re-derived by the CLI — and the participant's SAVED runtime
//         thresholds (session.config.thresholds.*) shadow CLI-side ones.
// So recomputeSignals() rewrites the records themselves, as if the
// participant had been screened under the given settings from the start,
// and the standard pipeline runs unchanged on the rewritten copy.
// The scoring weights are NOT hand-mirrored here: they arrive via the
// manifest's `presets` block, generated from src/shared/constants.js by
// tools/gen-signal-manifest.mjs and pinned to it by
// tests/tools/signal-manifest.test.js — single source, zero drift.
// JSON round-trip: every payload here is plain JSON (the exact shape saved
// to <pid>.json), so this is a safe, dependency-free deep clone.
// src/core/state-machine.js has its own deepCopy, but demo/*.js can only
// import files that ship to the site (tools/assemble-demo-site.mjs copies
// demo/ + dist/ only, not src/), so it isn't reachable from here.
function deepCopy(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

export function makeDebounced(fn, ms) {
  var id = null;
  return function () {
    var args = arguments;
    clearTimeout(id);
    id = setTimeout(function () { fn.apply(null, args); }, ms);
  };
}

// Pure pre-pass: deep-copies `payloads`, then rewrites them as if the
// participant(s) had been screened under `controls` (pasteHardCount,
// tabAwayCutoffMs, typingSpeedCps) with `scoring` — one manifest
// presets[*].scoring entry, {soft: {signal: {weight, maxPerTrial?}},
// softScoreThreshold} — instead of whatever actually ran. A faithful mirror
// of the library's collection-time logic, read from the source:
//
// 1. The paste HARD signal (src/core/scoring.js computeTrialScores +
//    src/core/monitor.js endTrial/getSessionReport):
//    - trialSignals.hard.paste.sessionTotal is the CUMULATIVE paste count
//      through that trial (monitor.js's sessionData.pasteCount, which only
//      ever increments) — recomputed here as a running total over trials in
//      array order, same as collection time.
//    - session.hardScore.paste = {count, threshold, triggered} and
//      session.anyHardTriggered = "any hard signal's triggered flag"
//      (monitor.js:428-433) — recomputed from that same running total vs.
//      controls.pasteHardCount. Other hard signals (drop; copy under
//      strict) have no control here, so their collection-time
//      triggered flag carries through unchanged and still contributes to
//      anyHardTriggered.
//
// 2. The FULL soft score (scoring.js's soft section, lines 50-125),
//    recomputed per trial from raw stored events with the manifest's
//    weights, then summed into session.softScore — the authoritative
//    number triage.js flags against:
//    - copy: copyEvents.length, capped at maxPerTrial, × weight (only when
//      the preset scores copy soft — strict doesn't);
//    - tabAway: tabAwayEvents with duration_ms STRICTLY > the control's
//      cutoff (same `>` boundary as scoring.js:63), capped, × weight;
//    - typingSpeed: stored raw charsPerSec > control cps → 1 hit × weight
//      (charsPerSec is measured data and never changes — only the verdict
//      on it does); skipped when the trial has no charsPerSec, same as
//      collection;
//    - sidebarEvent / devTools: the session-level event logs
//      (session.sidebarEvents / keyboardShortcuts) filtered to the trial's
//      [startTime, startTime + duration_ms] window, weight counted ONCE
//      when any hit lands in-window (scoring.js:95-117);
//    - foreignInput: weight once when the trial has any foreignInputEvents.
//    trialSignals.soft is rebuilt exactly as scoring.js builds it (copy/
//    tabAway entries always present when the preset scores them;
//    typingSpeed only with a charsPerSec; the last three only on hits).
//    All six soft signals' raw inputs ARE persisted in the payload (the
//    per-trial event arrays plus the session logs), so no term is carried
//    stale; a hand-crafted payload missing an array recomputes that term
//    to 0 hits — the same result collection-time scoring gives a genuinely
//    empty log.
//
// 3. session.softScoreThreshold ← scoring.softScoreThreshold, and the
//    saved runtime thresholds (session.config.thresholds.*) ← the controls:
//    summary.js / session-timeline-core.js / typing-profile-core.js resolve
//    thresholds as `participant.session?.config?.thresholds?.X ?? config…`
//    — the participant's saved values win — so the controls must land there
//    to move the binning and plots. metadata.integrityScore (payload.js's
//    mirror, which extract-core.js prefers when present) is kept in sync
//    throughout.
//
// Known non-emulated knob, disclosed: the strict preset's hard.copy
// countThreshold has no control here, so a strict re-score uses strict
// weights/thresholds but never flags copy as HARD — paste is the single
// hard knob.
export function recomputeSignals(payloads, controls, scoring) {
  var soft = (scoring && scoring.soft) || {};
  return (payloads || []).map(function (payload) {
    var p = deepCopy(payload);
    var trials = p.trials || [];
    var session = p.metadata && p.metadata.integritySession;
    var sessionSidebarEvents = (session && session.sidebarEvents) || [];
    var sessionKeyboardShortcuts = (session && session.keyboardShortcuts) || [];

    var runningPasteTotal = 0;
    var sessionSoftScore = 0;
    trials.forEach(function (t) {
      var integ = t && t.integrity;
      if (!integ) return;

      // ── Hard: paste — running session total vs. the control threshold ──
      var trialHits = (integ.pasteEvents || []).length;
      runningPasteTotal += trialHits;
      if (integ.trialSignals && integ.trialSignals.hard && integ.trialSignals.hard.paste) {
        integ.trialSignals.hard.paste = {
          trialHits: trialHits,
          sessionTotal: runningPasteTotal,
          countThreshold: controls.pasteHardCount,
        };
      }

      // ── Soft: full per-trial recompute, mirroring scoring.js:50-125 ──
      var trialSoftScore = 0;
      var softSignals = {};

      if (soft.copy) {
        var copyHits = (integ.copyEvents || []).length;
        var copyCapped = soft.copy.maxPerTrial != null
          ? Math.min(copyHits, soft.copy.maxPerTrial) : copyHits;
        var copyScore = copyCapped * soft.copy.weight;
        trialSoftScore += copyScore;
        softSignals.copy = { hits: copyHits, capped: copyCapped, score: copyScore };
      }

      if (soft.tabAway) {
        var tabHits = (integ.tabAwayEvents || []).filter(function (e) {
          return (e.duration_ms || 0) > controls.tabAwayCutoffMs;
        }).length;
        var tabCapped = soft.tabAway.maxPerTrial != null
          ? Math.min(tabHits, soft.tabAway.maxPerTrial) : tabHits;
        var tabScore = tabCapped * soft.tabAway.weight;
        trialSoftScore += tabScore;
        softSignals.tabAway = { hits: tabHits, capped: tabCapped, score: tabScore };
      }

      if (soft.typingSpeed && integ.charsPerSec != null) {
        var speedHit = integ.charsPerSec > controls.typingSpeedCps ? 1 : 0;
        var speedScore = speedHit * soft.typingSpeed.weight;
        trialSoftScore += speedScore;
        softSignals.typingSpeed = {
          charsPerSec: integ.charsPerSec, threshold: controls.typingSpeedCps,
          hit: speedHit, score: speedScore,
        };
      }

      // Session-scoped signals count toward this trial only inside its time
      // window — scoring.js's "trial window upper bound". Stored reports
      // always carry startTime + duration_ms; a payload missing either gets
      // an empty window (0 hits), never a widened one.
      var windowOk = typeof integ.startTime === 'number' && typeof integ.duration_ms === 'number';
      var trialEnd = windowOk ? integ.startTime + integ.duration_ms : 0;
      function hitsInWindow(events) {
        if (!windowOk) return 0;
        return events.filter(function (e) {
          return e.t >= integ.startTime && e.t <= trialEnd;
        }).length;
      }

      if (soft.sidebarEvent) {
        var sidebarHits = hitsInWindow(sessionSidebarEvents);
        if (sidebarHits > 0) {
          trialSoftScore += soft.sidebarEvent.weight;
          softSignals.sidebarEvent = { hits: sidebarHits, score: soft.sidebarEvent.weight };
        }
      }

      if (soft.devTools) {
        var devToolsHits = hitsInWindow(sessionKeyboardShortcuts);
        if (devToolsHits > 0) {
          trialSoftScore += soft.devTools.weight;
          softSignals.devTools = { hits: devToolsHits, score: soft.devTools.weight };
        }
      }

      if (soft.foreignInput && (integ.foreignInputEvents || []).length > 0) {
        trialSoftScore += soft.foreignInput.weight;
        softSignals.foreignInput = {
          hits: integ.foreignInputEvents.length, score: soft.foreignInput.weight,
        };
      }

      integ.trialSoftScore = trialSoftScore;
      if (integ.trialSignals) integ.trialSignals.soft = softSignals;
      sessionSoftScore += trialSoftScore;
    });
    var pasteTriggered = runningPasteTotal >= controls.pasteHardCount;

    if (session) {
      var otherHardTriggered = session.hardScore
        ? Object.keys(session.hardScore).some(function (k) {
            return k !== 'paste' && session.hardScore[k] && session.hardScore[k].triggered;
          })
        : false;
      var anyHardTriggered = pasteTriggered || otherHardTriggered;
      var newPasteHardScore = {
        count: runningPasteTotal, threshold: controls.pasteHardCount, triggered: pasteTriggered,
      };

      if (session.hardScore && session.hardScore.paste) session.hardScore.paste = newPasteHardScore;
      session.anyHardTriggered = anyHardTriggered;
      session.softScore = sessionSoftScore;
      session.softScoreThreshold = scoring.softScoreThreshold;

      if (session.config && session.config.thresholds) {
        session.config.thresholds.typingSpeedCps = controls.typingSpeedCps;
        session.config.thresholds.tabAwayDurationMs = controls.tabAwayCutoffMs;
      }

      var scoreMirror = p.metadata.integrityScore;
      if (scoreMirror) {
        if (scoreMirror.hardScore && scoreMirror.hardScore.paste) scoreMirror.hardScore.paste = newPasteHardScore;
        scoreMirror.anyHardTriggered = anyHardTriggered;
        scoreMirror.softScore = sessionSoftScore;
        scoreMirror.softScoreThreshold = scoring.softScoreThreshold;
      }
    }

    return p;
  });
}

// Resolves ONE canonical { preset, controls, scoring } view from the
// manifest's presets block + a state.scoringOverrides object (CODEX
// override contract: { weights, controls, preset }) — the merge every
// caller that needs "what should the pipeline run under right now" shares,
// today the scoring step's live soft-score readout. `weights` only ever
// overrides a signal's WEIGHT — maxPerTrial always comes from the preset
// (the scoring step has no maxPerTrial editor); a
// weight key the selected preset doesn't score (e.g. copy under strict) is
// silently ignored, same "no editor for a term that isn't scored" rule
// renderScoringPanel (demo.js) already follows. Returns null when the
// manifest has no presets block — nothing honest to recompute.
export function mergePlaygroundConfig(manifest, scoringOverrides) {
  var overrides = scoringOverrides || {};
  var presets = manifest.presets || {};
  var presetName = overrides.preset || manifest.preset || 'standard';
  var presetEntry = presets[presetName] || presets.standard;
  if (!presetEntry) return null;

  var controls = Object.assign({}, presetEntry.controls, overrides.controls || {});

  var baseSoft = (presetEntry.scoring && presetEntry.scoring.soft) || {};
  var weights = overrides.weights || {};
  var soft = {};
  Object.keys(baseSoft).forEach(function (key) {
    soft[key] = Object.assign({}, baseSoft[key],
      weights[key] != null ? { weight: weights[key] } : {});
  });

  return {
    preset: presetName,
    controls: controls,
    scoring: { soft: soft, softScoreThreshold: presetEntry.scoring.softScoreThreshold },
  };
}
