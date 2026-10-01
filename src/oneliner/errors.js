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
  // min.js's own sentinel found by a second copy of min.js: nothing to say
  // about ch.js, and no load order to claim.
  coreLoadedTwice: function () {
    return formatError('cyborg-hunter.min.js is loaded twice',
      'two <script> tags on this page load the monitor bundle',
      'keep one <script> tag',
      DOCS + 'advanced-integration.md#double-load');
  },
  notHookable: function () {
    return formatError('Not monitoring jsPsych trials',
      'ch.js loaded after initJsPsych() ran, or the page calls jsPsychModule.initJsPsych / new JsPsych directly (a bundler or ES module build), which never goes through window.initJsPsych',
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
  // console.warn, not error: the monitor still runs, on the standard preset.
  unknownPreset: function (value) {
    return formatError('Unknown preset "' + value + '"',
      'data-preset / CyborgHunterConfig.preset must be permissive, standard or strict; using standard',
      'use permissive, standard or strict',
      DOCS + 'quickstart.md#configuration');
  },
  bootFailed: function (msg) {
    return formatError('Cyborg Hunter did not start', msg, REPORT_FIX, DOCS + 'known-issues.md#one-line-setup');
  },
  // The jsPsych host: wrapping initJsPsych, walking the timeline at run(),
  // and the end-of-session hook. jsPsych keeps running after each of them.
  hookFailed: function (msg) {
    return formatError('Cyborg Hunter could not hook initJsPsych', msg, REPORT_FIX, DOCS + 'known-issues.md#one-line-setup');
  },
  instrumentFailed: function (msg) {
    return formatError('Cyborg Hunter could not instrument the timeline', msg, REPORT_FIX, DOCS + 'known-issues.md#one-line-setup');
  },
  sessionEndFailed: function (msg) {
    return formatError('Cyborg Hunter could not write the end-of-session data', msg, REPORT_FIX, DOCS + 'known-issues.md#one-line-setup');
  },
  guardFailed: function (guard, msg) {
    return formatError('The ' + guard + ' guard is not running', msg, REPORT_FIX, DOCS + 'known-issues.md#one-line-setup');
  },
  // console.warn: the experiment runs; the entry trial still starts friction,
  // but without the friction extension it has no jsPsych instance and no
  // refusal notices.
  frictionEntryWithoutFriction: function () {
    return formatError('Friction is only partly set up',
      'the timeline has friction\'s entry trial but data-guards does not enable friction',
      'add friction to data-guards (for example data-guards="honeypot friction"), or remove the entry trial',
      DOCS + 'known-issues.md#one-line-setup');
  },
  // Vanilla host: a mark click, a form submit or pagehide. The page carries on;
  // the segment may be missing from the blob.
  vanillaEventFailed: function (msg) {
    return formatError('Cyborg Hunter could not record a page boundary', msg, REPORT_FIX, DOCS + 'known-issues.md#one-line-setup');
  },
  // console.warn, vanilla host: CyborgHunter.startFriction() or a
  // data-ch-friction-start click still starts enforcement (as the jsPsych
  // entry trial does), but nothing injected the refusal notices.
  frictionStartWithoutFriction: function () {
    return formatError('Friction is only partly set up',
      'friction was started (data-ch-friction-start or CyborgHunter.startFriction()) but data-guards does not enable friction',
      'add friction to data-guards (for example data-guards="honeypot friction"), or remove the friction start',
      DOCS + 'known-issues.md#one-line-setup');
  },
  // console.warn, once per page, vanilla host: the whole session is kept in
  // sessionStorage so the last page's form carries it; browsers cap it at
  // about 5 MB per origin.
  storageNearlyFull: function () {
    return formatError('The saved session is approaching the sessionStorage limit',
      'the session kept for the next page is over 4 MB, mostly the raw mouse trace',
      'set CyborgHunterConfig.collectForPostHoc.rawMouseTrack = false',
      DOCS + 'known-issues.md#one-line-setup');
  },
  // console.error, vanilla host: the session could not be kept for the next
  // page (storage blocked or full). This page's form and data() still carry
  // everything recorded so far.
  storageFailed: function (msg) {
    return formatError('The session could not be carried to the next page', msg,
      'allow site storage for the study page, or save CyborgHunter.data() on every page',
      DOCS + 'known-issues.md#one-line-setup');
  },
  // console.warn: ch.js keeps one session per page. The session ends when the
  // first instance finishes; rows recorded after that carry no integrity data.
  secondJsPsychInstance: function () {
    return formatError('A second jsPsych instance was created',
      'ch.js records one session per page and ends it when the first instance finishes, so trials run after that are not monitored',
      'create one jsPsych instance with initJsPsych() and run one timeline, or use cyborg-hunter.min.js and the jsPsych extension (manual mode) for several instances',
      DOCS + 'known-issues.md#one-line-setup');
  }
};
