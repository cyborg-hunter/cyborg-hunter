// src/oneliner/replay-loader.js
// Session replay under the one-line setup. ch.js and ch-labjs.js carry the
// recorder (entry-replay.js) and record by default (data-replay="off" turns
// it off); ch-qualtrics.js does not, and with data-replay fetches
// cyborg-hunter-replay.js (the same file manual mode loads) from the
// directory it was loaded from, or from data-replay-src.
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
//   lab.js   starts once the page has loaded (DOMContentLoaded) and follows
//            the segmenter: the host adapter ends its trial and starts the
//            next span's at every cut; adapters/vanilla.js also stops it at
//            pagehide. Recordings are per page. A vanilla page the browser
//            shows again from the back/forward cache records on (see
//            restore() below).
//
// CyborgHunter.replay() stops the recorder, serializes it and returns the
// recording for the researcher's own save code (default autoSave mode
// 'none'; boot reminds the researcher to save it, replaySaveReminder, in
// place of the recorder's own warning). CyborgHunterConfig.replay = { tier, autoSave } keeps the
// recorder's own DataPipe save available (adapters/jspsych.js finalizes it at
// the end of the session).
//
// Nothing here throws into the page. A script that fails to load (404,
// network, Content-Security-Policy) or does not arrive within LOAD_TIMEOUT_MS
// is a catalogue error, and the experiment runs on without replay: jsPsych's
// run() is waiting on the proxy's initialize(), so a stalled CDN must not
// hold the experiment back indefinitely.

import './build-flags.js';
import { VERSION } from '../shared/constants.js';
import { MESSAGES } from './errors.js';

var REPLAY_FILE = 'cyborg-hunter-replay.js';
var REPLAY_NAME = 'cyborg-hunter-replay';
var LOAD_TIMEOUT_MS = 15000;

function message(e) { return String((e && e.message) || e); }

// The hosts that run the standalone recorder (window.CyborgHunterReplay
// .attach) rather than the jsPsych extension: vanilla and lab.js.
function standaloneRecorder(ctx) { return ctx.host !== 'jspsych' && ctx.host !== 'manual'; }

// The recorder's defaults under the one-liner; the researcher's
// CyborgHunterConfig.replay keys (tier, autoSave) override them.
// _ownerSavesRecording silences the recorder's "autoSave.mode is none"
// warning (src/replay/recorder.js), which names getRecording(): the
// one-liner's own reminder (replaySaveReminder below) names
// CyborgHunter.replay() instead.
function recorderConfig(ctx, params) {
  return Object.assign({ participantId: ctx.participantId, autoSave: { mode: 'none' }, _ownerSavesRecording: true }, params);
}

// Whether the one-line file bundles the recorder (entry-replay.js): its two
// globals are defined before boot runs, so nothing is loaded.
function bundled(win) {
  return !!win.CyborgHunterReplay && typeof win.CyborgHunterReplay.attach === 'function' &&
    typeof win.jsPsychCyborgHunterReplay === 'function';
}

// Whether the recording is saved with the data without the researcher's
// help: the bundled recorder writes pieces into the rows (jsPsych, lab.js)
// or the POST (pages without a framework), not into a Qualtrics survey.
export function replayAutoSaved(ctx) {
  return !!ctx.config.replay && !!ctx.replayBundled && !ctx.qualtricsLayout;
}

// Whether the researcher must save CyborgHunter.replay() themselves: replay
// is on and has a script URL, and the recorder does not save itself
// (CyborgHunterConfig.replay.autoSave, which only the jsPsych extension
// runs, or pieces in the saved data, replayAutoSaved). Read by debug.js for
// the summary. The wording is the caller's: the Qualtrics text
// (replayQualtrics, REPLAY_QUALTRICS_REMINDER) when ctx.qualtricsLayout is
// set, the generic one otherwise.
export function replaySaveReminderApplies(ctx) {
  if (!ctx.config.replay || replayAutoSaved(ctx)) return false;
  if (!ctx.replaySrc && !ctx.replayBundled) return false;
  var autoSave = ctx.config.replay.autoSave;
  var selfSaving = !!(autoSave && autoSave.mode && autoSave.mode !== 'none');
  return !(selfSaving && !standaloneRecorder(ctx));
}

// data-replay-src when given, else cyborg-hunter-replay.js next to the
// one-line file. scriptSrc is document.currentScript.src (entry.js); it is
// null for an inline or bundled file, which has no directory to look in.
// file names the one-line file in the error (ctx.file; ch.js without one).
export function replaySrcFor(scriptSrc, override, file) {
  if (override) return override;
  if (!scriptSrc) {
    throw new Error((file || 'ch.js') + ' could not tell which URL it was loaded from (inline or bundled), so it cannot find ' +
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
      this.taker = null;   // the recording in pieces, one per trial row (replayAutoSaved)
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
        // The taker reads the recorder's buffer, which stays readable after
        // CyborgHunter.replay() destroys the recorder, so pieces keep coming.
        if (replayAutoSaved(ctx)) {
          this.taker = inner.api.pieceTaker({ host: inner._detectHost() });
          ctx.replayTaker = this.taker;
        }
      } catch (e) {
        // A recorder attached before the failure would keep its listeners.
        if (inner && inner.api) { try { inner.api.destroy(); } catch (_) { /* already failing */ } }
        console.error(MESSAGES.replayUnavailable(message(e), ctx.file));
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

    // The trial's piece of the recording rides in its row, beside its
    // integrity segment: a save trial that takes its snapshot before the
    // session ends still has every earlier trial's piece (pieces.js).
    on_finish(params) {
      if (!this.inner) return {};
      var out = {};
      try { out = this.inner.on_finish(params) || {}; } catch (_) { /* replay only */ }
      if (this.taker) {
        try {
          var piece = this.taker.take({ skipEmpty: true });
          if (piece) out = Object.assign({}, out, { cyborgHunterReplay: piece });
        } catch (e) {
          out = Object.assign({}, out, { cyborgHunterReplayError: message(e) });
        }
      }
      return out;
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

// The first segment recorded after a back/forward-cache restore says so, in
// the segment's vendor data (spec §2 SegmentRecording `extensions`).
var RESTORED_FROM_BFCACHE = { 'cyborg-hunter': { restored_from: 'bfcache' } };

// createVanillaReplay({ win, doc, src, ctx, timeoutMs? })
//   → Promise<{ api, startTrial(trialId), endTrial(), stop(), restore(trialId) }>
// The wrappers never throw (the recorder's lifecycle calls do, on a call out
// of order) and do nothing once stop() ran or replay() took the recording
// (handle.api is null then), until restore().
//
// restore(trialId): the browser showed the page again from the back/forward
// cache (pageshow with persisted; adapters/vanilla.js). No script runs again,
// and pagehide stopped the recorder, so without this everything the
// participant does after pressing Back is missing from the replay. When ch.js
// saves the pieces itself (replayAutoSaved: ch.js and ch-labjs.js on a page
// without a framework), the restored visit is a NEW recording, because a
// resumed one would span the later pages' time and the CLI cannot join
// recordings that overlap; the first one's pieces stay in this page's POST.
// Otherwise (the researcher saves CyborgHunter.replay()) the
// recording RESUMES (recorder resumeSession) rather than a new one starting:
// a stop finalizes only end_reason, so the stopped recording can take later
// segments, and CyborgHunter.replay() keeps returning one recording per page,
// now holding both visits. A new recorder would have to replace this one
// (attach() destroys the previous recorder), and replay() would then need a
// second return value for a recording nobody saved yet. The first segment
// after the restore is a keyframe (capture-dom forces one on resume) and
// carries RESTORED_FROM_BFCACHE.
// One case cannot resume: replay() already took the recording (the
// researcher saved it before leaving, as the docs advise), and that destroyed
// the recorder. A new recorder starts then, and replay() returns the restored
// visit's recording; the earlier one is already in the researcher's hands.
// A failure is a catalogue error (MESSAGES.replayRestoreFailed); the stopped
// recording, or the one already taken, stays what replay() returns.
export function createVanillaReplay(opts) {
  var win = opts.win, doc = opts.doc, src = opts.src, ctx = opts.ctx;
  var ready = win.CyborgHunterReplay ? Promise.resolve() : loadScript(doc, src, opts.timeoutMs, ctx.scriptNonce);
  return ready.then(function () {
    var R = win.CyborgHunterReplay;
    if (!R || typeof R.attach !== 'function') throw new Error(src + ' loaded but did not define CyborgHunterReplay');
    var api = R.attach(recorderConfig(ctx, ctx.config.replay));
    // Pieces for the saved data (replayAutoSaved): the lab.js rows, or the
    // POST of a page without a framework.
    if (replayAutoSaved(ctx)) ctx.replayTaker = api.pieceTaker({ host: null });
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
      },
      restore: function (trialId) {
        try {
          if (handle.api && handle.stopped && !replayAutoSaved(ctx)) {
            handle.api.resumeSession();
          } else if (!handle.api || handle.stopped) {
            // With the pieces saved by ch.js (replayAutoSaved), a restored
            // visit is a recording of its own: resumed, the first one would
            // span the later pages' time, and the CLI cannot join recordings
            // that overlap. The first one's pieces so far stay in this page's
            // POST (taken now, before its recorder goes).
            var carried = null;
            if (handle.api) {
              if (replayAutoSaved(ctx)) carried = piecesSoFar(ctx);
              try { handle.api.destroy(); } catch (_) { /* replaced below */ }
              handle.api = null;
            }
            var fresh = win.CyborgHunterReplay.attach(recorderConfig(ctx, ctx.config.replay));
            try { fresh.startSession(); } catch (e) {
              try { fresh.destroy(); } catch (_) { /* already failing */ }
              throw e;
            }
            handle.api = fresh;
            ctx.replayRecording = null;   // replay() takes the new recording
            // A new recording, so new pieces (a new recording_id).
            if (replayAutoSaved(ctx)) {
              ctx.replayTaker = fresh.pieceTaker({ host: null });
              if (carried) ctx.replayTaker.sent = carried;
            }
          } else {
            return;   // still recording: no pagehide stopped it
          }
          handle.stopped = false;
        } catch (e) {
          console.error(MESSAGES.replayRestoreFailed(message(e), ctx.file));
          return;
        }
        try { handle.api.startTrial({ trialId: trialId, extensions: RESTORED_FROM_BFCACHE }); } catch (_) { /* replay only */ }
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

// The next piece (pieces.js) for a host's row or POST, or null: replay is
// off or not auto-saved, the recorder is not running yet, or nothing closed
// since the last piece. Throws on failure; the caller records the note.
export function takePiece(ctx) {
  return ctx.replayTaker ? ctx.replayTaker.take({ skipEmpty: true }) : null;
}

// Every piece of the current recording so far, a new one taken first, or
// null when there are none to take (replay off, not auto-saved, or the
// recorder not started yet). For a page without a framework: each POST, and
// CyborgHunter.data(), carries the whole page's recording so far, so a
// submit the page cancels (validation) loses nothing; the reader counts a
// repeated piece once. Kept in memory only: sessionStorage could not hold a
// recording (about 5 MB per origin), so each page sends its own.
export function piecesSoFar(ctx) {
  var taker = ctx.replayTaker;
  if (!taker) return null;
  var list = taker.sent || (taker.sent = []);
  var p = taker.take({ skipEmpty: true });
  if (p) list.push(p);
  return list.length ? list.slice() : null;
}

// The session's last piece (pieces.js), for the host's session end: stops
// the recorder (CyborgHunter.replay() still returns the whole recording
// afterwards) and returns { piece, meta } or null when no pieces are taken.
// Throws on failure; the caller records the note.
export function takeFinalPiece(ctx) {
  var taker = ctx.replayTaker;
  if (!taker) return null;
  var holder = currentHolder(ctx);
  if (holder && holder.api) {
    try { holder.api.stopSession('finished'); } catch (_) { /* already stopped */ }
  }
  var piece = taker.take({ final: true });
  return {
    piece: piece,
    meta: { schema_version: 2, saved_to: 'rows', recording_id: taker.recordingId, pieces: piece.seq + 1 }
  };
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
// extension behind the proxy, or the standalone recorder's handle.
function currentHolder(ctx) {
  if (standaloneRecorder(ctx)) return ctx.replay || null;
  var ext = ctx.jsPsych && ctx.jsPsych.extensions && ctx.jsPsych.extensions[REPLAY_NAME];
  if (!ext) return null;
  return 'inner' in ext ? ext.inner : ext;
}

function replay(ctx) {
  if (!ctx.config.replay) { console.warn(MESSAGES.replayOff(ctx.file)); return null; }
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
// startVanilla() starts the standalone recorder (vanilla and lab.js hosts, or
// a jsPsych page ch.js could not hook), once, after DOMContentLoaded; it sets
// ctx.replay.
export function installReplay(opts) {
  var win = opts.win, ctx = opts.ctx;
  var doc = opts.doc || win.document;
  ctx.handlers.replay = function () {
    try { return replay(ctx); } catch (e) {
      console.error(MESSAGES.replayUnavailable(message(e), ctx.file));
      return null;
    }
  };
  var none = { startVanilla: function () {} };
  if (!ctx.config.replay) return none;
  ctx.replayBundled = bundled(win);
  // data-replay-src says where ch-qualtrics.js loads the recorder from; a
  // file that carries it loads nothing, so the attribute does nothing there.
  if (ctx.replayBundled && ctx.config.replaySrc) console.info(MESSAGES.replaySrcIgnored(ctx.file));
  if (!ctx.replayBundled) {
    try {
      ctx.replaySrc = replaySrcFor(ctx.scriptSrc, ctx.config.replaySrc, ctx.file);
    } catch (e) {
      console.error(MESSAGES.replayUnavailable(message(e), ctx.file));
      return none;
    }
  }
  var autoSave = ctx.config.replay.autoSave;
  if (standaloneRecorder(ctx) && autoSave && autoSave.mode && autoSave.mode !== 'none') {
    console.warn(MESSAGES.replayAutoSaveVanilla(replayAutoSaved(ctx)));
  }
  // With data-debug the summary says it (debug.js), so the page gets one line.
  // Under Qualtrics the reminder also says the recording never goes into
  // embedded data (boot sets ctx.qualtricsLayout before this runs).
  if (!ctx.debug && replaySaveReminderApplies(ctx)) {
    console.info(ctx.qualtricsLayout ? MESSAGES.replayQualtrics() : MESSAGES.replaySaveReminder(ctx.file));
  }
  if (HAS_JSPSYCH && ctx.host === 'jspsych') {
    ctx.replayProxy = makeReplayProxy({ doc: doc, src: ctx.replaySrc, ctx: ctx, timeoutMs: opts.timeoutMs });
  }

  var started = false;
  function start() {
    createVanillaReplay({ win: win, doc: doc, src: ctx.replaySrc, ctx: ctx, timeoutMs: opts.timeoutMs }).then(
      function (handle) { ctx.replay = handle; },
      function (e) { console.error(MESSAGES.replayUnavailable(message(e), ctx.file)); }
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
