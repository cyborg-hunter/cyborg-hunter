// src/oneliner/errors.js
// The one-line setup's loud errors. Every message names the problem, its
// cause, the fix and a doc link, in that order, so a researcher reading the
// console knows what to change without opening the source:
//   [cyborg-hunter] <problem>: <cause>. Fix: <fix>. <link>
// build.js imports MESSAGES for the cyborg-hunter.min.js double-load footer,
// so the bundle and the catalogue share one string. The guard cores are plain
// IIFEs that cannot import this file; their double-load messages are written
// out in the same format (tests/oneliner/errors.test.js checks all of them).

export const DOCS = 'https://github.com/cyborg-hunter/cyborg-hunter/blob/main/docs/';

export function formatError(problem, cause, fix, link) {
  return '[cyborg-hunter] ' + problem + ': ' + cause + '. Fix: ' + fix + '. ' + link;
}

// For one-off messages; the catalogue entries below are passed to
// console.error directly (they are already formatted).
export function loudError(problem, cause, fix, link) {
  console.error(formatError(problem, cause, fix, link));
}

var REPORT_FIX = 'open an issue with this message and your <script> tag';

export const MESSAGES = {
  doubleLoad: function (first, second) {
    return formatError('Not starting a second monitor', second + ' was loaded after ' + first,
      'load only one of ch.js and cyborg-hunter.min.js (the one-liner already contains the monitor)',
      DOCS + 'advanced-integration.md#double-load');
  },
  notHookable: function () {
    return formatError('Not monitoring jsPsych trials', 'ch.js loaded after initJsPsych() ran',
      'move the ch.js <script> above your experiment code (and below jspsych.js)',
      DOCS + 'quickstart.md#placement');
  },
  loadedAboveJsPsych: function () {
    return formatError('Not monitoring jsPsych trials',
      'ch.js was loaded before jspsych.js, so initJsPsych could not be wrapped',
      'move the ch.js <script> below jspsych.js and above your experiment code',
      DOCS + 'quickstart.md#placement');
  },
  // The URL parameter names are not spelled out here: the caller supplies the
  // list (participant-id.js), and the docs anchor documents it.
  randomId: function (id) {
    return formatError('Participant rows cannot be linked to your platform ID',
      'no PROLIFIC-style URL parameter, data-participant-id or CyborgHunterConfig.participantId was found; using ' + id,
      'add data-participant-id="..." to the ch.js tag or pass the ID in the URL',
      DOCS + 'quickstart.md#participant-id');
  },
  manualInitOnOneLiner: function () {
    return formatError('CyborgHunter.init() called while the one-liner is running',
      'ch.js already created the monitor at page load',
      'remove the init()/startTrial()/endTrial() code, or switch to cyborg-hunter.min.js for manual mode',
      DOCS + 'advanced-integration.md#manual-mode');
  },
  bootFailed: function (msg) {
    return formatError('Cyborg Hunter did not start', msg, REPORT_FIX, DOCS + 'known-issues.md#one-line-setup');
  },
  guardFailed: function (guard, msg) {
    return formatError('The ' + guard + ' guard is not running', msg, REPORT_FIX, DOCS + 'known-issues.md#one-line-setup');
  }
};
