// trial-filter.js
//
// Pure, DOM-free trial filtering for the bench timeline.
//
// Why this module exists: the filtering rules used to live inline in
// timeline.js, which cannot be imported under `node --test` (it reads jsPsych
// window globals and calls jsPsych.run() at import time). Extracting the sets
// plus one pure function makes the rules testable without touching the
// composition logic — timeline.js still owns the splicing/ordering.
//
// Filtering is by plugin `info.name`, which is how every trial in the bench
// (vendored upstream trials AND the custom grafted ones) identifies itself —
// a single mechanism, a single source of truth.

/** Trials filtered for ALL audiences (humans + bots). The multi-choice trial
 *  was deemed low-value and bloated the timeline; removed in the 2026-05-14
 *  redesign. */
export const ALWAYS_FILTERED = new Set(['survey-multi-choice']);

/** Browser Use can't complete these trial types (no clickable affordances —
 *  canvas drawing, sketchpad strokes, drag-and-drop, custom MediaRecorder).
 *  When ?bot-mode=1 is set, strip them so bot sweeps actually reach the end
 *  of the timeline. The custom recording trial (info.name
 *  'bench-recording-trial') flows through the same mechanism as the upstream
 *  trials — single source of truth. */
export const BOT_INCOMPATIBLE_TRIALS = new Set([
  'canvas-keyboard-response',
  'sketchpad',
  'free-sort',
  'bench-recording-trial',
]);

/** Trials filtered under ?demo=replay. The microphone trial asks a fresh
 *  cloner for a getUserMedia permission they did not sign up for, so the demo
 *  drops it; everything else in the vendored suite (canvas, sketchpad,
 *  free-sort, …) stays, because exercising the recorder is the point.
 *  This is a subset of BOT_INCOMPATIBLE_TRIALS (asserted in the tests). */
export const REPLAY_DEMO_FILTERED = new Set(['bench-recording-trial']);

/**
 * Plugin name of a jsPsych trial object, or `undefined` if it has no plugin.
 *
 * @param {object} trial
 * @returns {string|undefined}
 */
export function trialName(trial) {
  return trial?.type?.info?.name;
}

/**
 * Filter a list of trial objects by the active run modes.
 *
 * @param {object[]} trials
 * @param {{ botMode?: boolean, replayDemo?: boolean }} [modes]
 * @returns {object[]} a new array; input is not mutated
 */
export function filterTrials(trials, { botMode = false, replayDemo = false } = {}) {
  return trials.filter((t) => {
    const name = trialName(t);
    if (ALWAYS_FILTERED.has(name)) return false;
    if (botMode && BOT_INCOMPATIBLE_TRIALS.has(name)) return false;
    if (replayDemo && REPLAY_DEMO_FILTERED.has(name)) return false;
    return true;
  });
}
