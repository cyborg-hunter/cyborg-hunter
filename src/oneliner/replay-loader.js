// src/oneliner/replay-loader.js
// Session replay under the one-line setup, opt-in with data-replay. ch.js does
// not bundle the recorder: cyborg-hunter-replay.js (self-contained, the same
// file manual mode loads) is fetched only when data-replay is set, from the
// directory ch.js itself was loaded from, or from data-replay-src.
//
//   jsPsych  initJsPsych runs synchronously in the experiment code, before
//            the script can have loaded. ch.js therefore lists a proxy
//            extension (adapters/jspsych.js) whose async initialize() loads
//            the script and then hands over to the real replay extension:
//            jsPsych's run() awaits loadExtensions, which awaits every
//            initialize() (jspsych.js 7.3.1 :2695, :2946). The proxy keeps
//            the name 'cyborg-hunter-replay', so the replay extension finds
//            the monitor through jsPsych.extensions['cyborg-hunter'] as in
//            manual mode.
//   vanilla  the standalone recorder (window.CyborgHunterReplay.attach)
//            starts once the page has loaded (DOMContentLoaded) and follows
//            the segmenter: adapters/vanilla.js ends its trial and starts the
//            next span's at every cut, and stops it at pagehide. Recordings
//            are per page.
//
// CyborgHunter.replay() stops the recorder, serializes it and returns the
// recording for the researcher's own save code (default autoSave mode
// 'none'). CyborgHunterConfig.replay = { tier, autoSave } keeps the
// recorder's own DataPipe save available (adapters/jspsych.js finalizes it at
// the end of the session).
//
// Nothing here throws into the page. A script that fails to load (404,
// network, Content-Security-Policy) or does not arrive within LOAD_TIMEOUT_MS
// is a catalogue error, and the experiment runs on without replay: jsPsych's
// run() is waiting on the proxy's initialize(), so a stalled CDN must not
// hold the experiment back indefinitely.

import { VERSION } from '../shared/constants.js';
import { MESSAGES } from './errors.js';

var REPLAY_FILE = 'cyborg-hunter-replay.js';
var REPLAY_NAME = 'cyborg-hunter-replay';
var LOAD_TIMEOUT_MS = 15000;

function message(e) { return String((e && e.message) || e); }

// The recorder's defaults under the one-liner; the researcher's
// CyborgHunterConfig.replay keys (tier, autoSave) override them.
function recorderConfig(ctx, params) {
  return Object.assign({ participantId: ctx.participantId, autoSave: { mode: 'none' } }, params);
}

// data-replay-src when given, else cyborg-hunter-replay.js next to ch.js.
// scriptSrc is document.currentScript.src (entry.js); it is null for an
// inline or bundled ch.js, which has no directory to look in.
export function replaySrcFor(scriptSrc, override) {
  if (override) return override;
  if (!scriptSrc) {
    throw new Error('ch.js could not tell which URL it was loaded from (inline or bundled), so it cannot find ' +
      REPLAY_FILE + '; set data-replay-src');
  }
  return new URL(REPLAY_FILE, scriptSrc).href;
}

// One <script> per src and document; every caller gets the same promise.
var loads = new WeakMap();   // doc → { src: promise }

export function loadScript(doc, src, timeoutMs, nonce) {
  var perDoc = loads.get(doc);
  if (!perDoc) { perDoc = Object.create(null); loads.set(doc, perDoc); }
  if (perDoc[src]) return perDoc[src];
  var p = new Promise(function (resolve, reject) {
    var el = doc.createElement('script');
    var timer = setTimeout(function () {
      reject(new Error(src + ' timed out after ' + Math.round((timeoutMs || LOAD_TIMEOUT_MS) / 1000) + ' s'));
    }, timeoutMs || LOAD_TIMEOUT_MS);
    // Listeners before the append: a script can settle inside appendChild.
    el.addEventListener('load', function () { clearTimeout(timer); resolve(); });
    el.addEventListener('error', function () {
      clearTimeout(timer);
      reject(new Error('could not load ' + src + ' (missing file, network error or Content-Security-Policy)'));
    });
    // A page with a nonce-based Content-Security-Policy only runs scripts that carry its nonce.
    if (nonce) el.nonce = nonce;
    el.src = src;
    (doc.head || doc.documentElement || doc.body).appendChild(el);
  });
  perDoc[src] = p;
  return p;
}

// makeReplayProxy({ doc, src, ctx, timeoutMs? }) → class ReplayProxyExtension
export function makeReplayProxy(opts) {
  var doc = opts.doc, src = opts.src, ctx = opts.ctx, timeoutMs = opts.timeoutMs;
  var win = ctx.win;

  class ReplayProxyExtension {
    static info = { name: REPLAY_NAME, version: VERSION, data: {} };

    constructor(jsPsych) {
      this.jsPsych = jsPsych;
      this.inner = null;   // the real replay extension, once loaded and initialized
    }

    // Always resolves: a rejection here would stop jsPsych's run().
    async initialize(params) {
      var inner = null;
      try {
        // Already on the page (a <script> of the researcher's own): no load.
        if (typeof win.jsPsychCyborgHunterReplay !== 'function') await loadScript(doc, src, timeoutMs, ctx.scriptNonce);
        var Inner = win.jsPsychCyborgHunterReplay;
        if (typeof Inner !== 'function') throw new Error(src + ' loaded but did not define jsPsychCyborgHunterReplay');
        inner = new Inner(this.jsPsych);
        inner.initialize(recorderConfig(ctx, params));
        this.inner = inner;
      } catch (e) {
        // A recorder attached before the failure would keep its listeners.
        if (inner && inner.api) { try { inner.api.destroy(); } catch (_) { /* already failing */ } }
        console.error(MESSAGES.replayUnavailable(message(e)));
      }
    }

    // jsPsych calls these on every trial that lists the extension: no-ops
    // until the real extension is in place, and never a throw into jsPsych.
    on_start(params) {
      if (!this.inner) return;
      try { this.inner.on_start(params); } catch (_) { /* replay only */ }
    }

    on_load(params) {
      if (!this.inner) return;
      try { this.inner.on_load(params); } catch (_) { /* replay only */ }
    }

    on_finish(params) {
      if (!this.inner) return {};
      try { return this.inner.on_finish(params) || {}; } catch (_) { return {}; }
    }

    finalize() {
      return this.inner ? this.inner.finalize() : Promise.resolve();
    }

    getLastRecording() {
      return this.inner ? this.inner.getLastRecording() : null;
    }
  }

  return ReplayProxyExtension;
}

// createVanillaReplay({ win, doc, src, ctx, timeoutMs? })
//   → Promise<{ api, startTrial(trialId), endTrial(), stop() }>
// The wrappers never throw (the recorder's lifecycle calls do, on a call out
// of order) and do nothing once stop() ran or replay() took the recording
// (handle.api is null then).
export function createVanillaReplay(opts) {
  var win = opts.win, doc = opts.doc, src = opts.src, ctx = opts.ctx;
  var ready = win.CyborgHunterReplay ? Promise.resolve() : loadScript(doc, src, opts.timeoutMs, ctx.scriptNonce);
  return ready.then(function () {
    var R = win.CyborgHunterReplay;
    if (!R || typeof R.attach !== 'function') throw new Error(src + ' loaded but did not define CyborgHunterReplay');
    var api = R.attach(recorderConfig(ctx, ctx.config.replay));
    var handle = {
      api: api,
      stopped: false,
      startTrial: function (trialId) {
        if (!handle.api || handle.stopped) return;
        try { handle.api.startTrial({ trialId: trialId }); } catch (_) { /* replay only */ }
      },
      endTrial: function () {
        if (!handle.api || handle.stopped) return;
        try { handle.api.endTrial(); } catch (_) { /* replay only */ }
      },
      stop: function () {
        if (!handle.api || handle.stopped) return;
        handle.stopped = true;
        try { handle.api.stopSession('finished'); } catch (_) { /* replay only */ }
      }
    };
    try {
      api.startSession();
      var state = ctx.segmenter.state();
      if (state.open) api.startTrial({ trialId: state.currentTrialId });
    } catch (e) {
      try { api.destroy(); } catch (_) { /* already failing */ }
      throw e;
    }
    return handle;
  });
}

// Stop, serialize, destroy. The recorder refuses stopSession once stopped,
// which is fine: the recording is complete then.
function takeRecording(holder, opts) {
  var api = holder.api;
  try { api.stopSession('finished'); } catch (_) { /* already stopped */ }
  try {
    return api.getRecording(opts);
  } finally {
    try { api.destroy(); } catch (_) { /* teardown best-effort */ }
    holder.api = null;   // the jsPsych extension's later finalize() is a no-op
  }
}

// The object holding the recorder handle (.api): the real jsPsych replay
// extension behind the proxy, or the vanilla handle.
function currentHolder(ctx) {
  if (ctx.host === 'vanilla') return ctx.replay || null;
  var ext = ctx.jsPsych && ctx.jsPsych.extensions && ctx.jsPsych.extensions[REPLAY_NAME];
  if (!ext) return null;
  return 'inner' in ext ? ext.inner : ext;
}

function replay(ctx) {
  if (!ctx.config.replay) { console.warn(MESSAGES.replayOff()); return null; }
  if (ctx.replayRecording) return ctx.replayRecording;
  var holder = currentHolder(ctx);
  if (holder && holder.api) {
    var report = null;
    try { report = ctx.monitor.getSessionReport(); } catch (_) { /* the recording stands on its own */ }
    var host = null;
    try { host = typeof holder._detectHost === 'function' ? holder._detectHost() : null; } catch (_) { /* optional */ }
    ctx.replayRecording = takeRecording(holder, { chSessionReport: report, host: host });
    return ctx.replayRecording;
  }
  // An autosaving finalize() (CyborgHunterConfig.replay.autoSave) took it.
  var last = holder && typeof holder.getLastRecording === 'function' ? holder.getLastRecording() : null;
  if (last) return last;
  // The holder exists but its recorder is gone and saved nothing: an autosaving
  // finalize() destroyed it and failed. Not "has not started yet".
  console.warn(holder ? MESSAGES.replayFinalizeFailed() : MESSAGES.replayNotReady());
  return null;
}

// installReplay({ win, ctx, doc?, timeoutMs? }) → { startVanilla() }
// Installs ctx.handlers.replay (CyborgHunter.replay()) whether or not replay
// is on. With data-replay: ctx.replaySrc, and on the jsPsych host
// ctx.replayProxy, which adapters/jspsych.js lists in initJsPsych.
// startVanilla() starts the vanilla recorder (vanilla host, or a jsPsych page
// ch.js could not hook), once, after DOMContentLoaded; it sets ctx.replay.
export function installReplay(opts) {
  var win = opts.win, ctx = opts.ctx;
  var doc = opts.doc || win.document;
  ctx.handlers.replay = function () {
    try { return replay(ctx); } catch (e) {
      console.error(MESSAGES.replayUnavailable(message(e)));
      return null;
    }
  };
  var none = { startVanilla: function () {} };
  if (!ctx.config.replay) return none;
  try {
    ctx.replaySrc = replaySrcFor(ctx.scriptSrc, ctx.config.replaySrc);
  } catch (e) {
    console.error(MESSAGES.replayUnavailable(message(e)));
    return none;
  }
  var autoSave = ctx.config.replay.autoSave;
  if (ctx.host === 'vanilla' && autoSave && autoSave.mode && autoSave.mode !== 'none') {
    console.warn(MESSAGES.replayAutoSaveVanilla());
  }
  if (ctx.host === 'jspsych') {
    ctx.replayProxy = makeReplayProxy({ doc: doc, src: ctx.replaySrc, ctx: ctx, timeoutMs: opts.timeoutMs });
  }

  var started = false;
  function start() {
    createVanillaReplay({ win: win, doc: doc, src: ctx.replaySrc, ctx: ctx, timeoutMs: opts.timeoutMs }).then(
      function (handle) { ctx.replay = handle; },
      function (e) { console.error(MESSAGES.replayUnavailable(message(e))); }
    );
  }
  return {
    startVanilla: function () {
      if (started) return;
      started = true;
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
      else start();
    }
  };
}
