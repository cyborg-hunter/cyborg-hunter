// src/oneliner/boot.js
// Everything dist/ch.js does at load, in order:
//   1. double-load sentinel: if cyborg-hunter.min.js (or another ch.js)
//      already ran, say so and stop: no monitor, window.CyborgHunter untouched;
//   2. config (tag data-* attributes over window.CyborgHunterConfig);
//   3. participant id (warns when it has to fall back to a random id). The
//      id is kept for the tab in sessionStorage, so a later page without an
//      id of its own reuses the first page's random id (source 'session')
//      and continues its session; a URL, attribute or config id still wins;
//   4. a monitor (its session starts at step 6);
//   5. host: 'jspsych' when initJsPsych is already defined, else 'vanilla'
//      (the host adapters install their hooks into ctx.handlers). The vanilla
//      adapter (adapters/vanilla.js) is installed before the first span
//      opens: it restores a previous page's segment index, so the boot span
//      is named after the continued index;
//   6. the monitor's session starts and the segmenter keeps it inside a
//      trial from this moment on ('span-<index>'), so a paste before the
//      first host trial or mark is still recorded. The session start needs
//      document.body (core signals/browser.js observes it), so with ch.js in
//      <head> this step alone waits for DOMContentLoaded (a paste before
//      then is not recorded); a failure then is logged as bootFailed;
//   7. guards, vanilla host only (honeypot on by default, friction
//      observe-only when enabled). On the jsPsych host the injected guard
//      extensions own them: their initialize() runs GuardHoneypot.init and
//      friction's setJsPsych / injectRefusalNotices, and the entry trial
//      starts enforcement. Starting them here too would init the honeypot
//      twice (the second init resets its violation log). On the jsPsych host
//      initJsPsych is wrapped (adapters/jspsych.js); on both, a placement
//      check reports a ch.js tag above jspsych.js or below the experiment
//      code, and a jsPsych page that turns out not hookable falls back to the
//      vanilla host (its guards and adapter start then);
//   8. replay, only with data-replay (replay-loader.js): on the jsPsych
//      host a proxy extension the initJsPsych wrap lists, which loads
//      cyborg-hunter-replay.js in jsPsych's run(); on the vanilla host (and
//      on the not-hookable fallback) the standalone recorder, started after
//      DOMContentLoaded. CyborgHunter.replay() is wired either way;
//   9. window.CyborgHunter = the one-liner namespace, then the sentinel.
//
// boot({ script, win, monitorFactory?, participantParams? }) → ctx | null
//   script:            the ch.js <script> element (document.currentScript), or null
//   win:               the window (the core monitor itself uses the globals)
//   monitorFactory:    core init(); injectable for tests
//   participantParams: URL parameter names for the participant id, in order
// ctx = { config, participantId, participantIdSource, monitor, differ,
//         segmenter, host, scriptSrc, handlers, win, api, vanilla?,
//         replaySrc?, replayProxy? (jsPsych), replay? (vanilla handle) }
//
// boot never throws into the page: any failure is logged as bootFailed, a
// monitor created before the failure is destroyed, and boot returns null.
// The sentinel is set only after a successful boot, so a later
// cyborg-hunter.min.js still works if ch.js failed. The exception is a
// failure at the deferred session start (step 6, ch.js in <head>): boot has
// returned by then, so the namespace and the sentinel stay, and what can
// still be saved is marked (failDeferred below).

import { init } from '../core/monitor.js';
import { createSegmentDiffer } from './segment-diff.js';
import { createSegmenter } from './segmenter.js';
import { readConfig } from './config.js';
import { resolveParticipantId, randomParticipantId, DEFAULT_PARAMS } from './participant-id.js';
import { startGuards } from './guards.js';
import { buildPublicApi } from './api.js';
import { MESSAGES } from './errors.js';
import { installJsPsychAdapter, watchHostPlacement } from './adapters/jspsych.js';
import { installVanillaAdapter } from './adapters/vanilla.js';
import { installReplay } from './replay-loader.js';

// Not under the session prefix (adapters/vanilla.js, cyborg-hunter:oneliner:
// session:<id>), so no participant id can collide with it.
var PID_KEY = 'cyborg-hunter:oneliner:pid';

function sessionGet(win, key) {
  try { return win.sessionStorage.getItem(key); } catch (_) { return null; }
}
function sessionSet(win, key, value) {
  try { win.sessionStorage.setItem(key, value); } catch (_) { /* blocked: the id is per page then */ }
}

export function boot(opts) {
  var win = opts.win;
  var monitorFactory = opts.monitorFactory || init;
  var monitor = null;
  var ctx = null;
  try {
    if (win.__cyborgHunterLoaded) {
      console.error(MESSAGES.doubleLoad(win.__cyborgHunterLoaded, 'ch.js'));
      return null;
    }

    var script = opts.script || null;
    var config = readConfig({ dataset: (script && script.dataset) || {}, globalConfig: win.CyborgHunterConfig });

    var pid = resolveParticipantId({
      search: (win.location && win.location.search) || '',
      attr: config.participantIdAttr,
      configId: config.monitor.participantId,
      params: opts.participantParams || DEFAULT_PARAMS,
      random: function () { return randomParticipantId(win.crypto || globalThis.crypto); }
    });
    if (pid.source === 'random') {
      var kept = sessionGet(win, PID_KEY);
      if (kept) pid = { id: kept, source: 'session' };
      else console.warn(MESSAGES.randomId(pid.id));
    }
    sessionSet(win, PID_KEY, pid.id);

    monitor = monitorFactory(Object.assign({}, config.monitor, { participantId: pid.id, preset: config.preset }));
    var differ = createSegmentDiffer(monitor);
    var segmenter = createSegmenter({ monitor: monitor, differ: differ });
    var host = typeof win.initJsPsych === 'function' ? 'jspsych' : 'vanilla';

    ctx = {
      config: config,
      participantId: pid.id,
      participantIdSource: pid.source,
      monitor: monitor,
      differ: differ,
      segmenter: segmenter,
      host: host,
      scriptSrc: (script && script.src) || null,
      scriptNonce: (script && script.nonce) || null,   // copied onto the lazily loaded replay <script>
      handlers: {},
      win: win,
      api: null
    };
    ctx.api = buildPublicApi(ctx);
    var replay = installReplay({ win: win, ctx: ctx });
    if (host === 'vanilla') ctx.vanilla = installVanillaAdapter({ win: win, ctx: ctx });

    // The session start observes document.body (core signals/browser.js), so
    // with ch.js in <head> it waits for DOMContentLoaded; everything else,
    // including the initJsPsych wrap the experiment code may call before
    // DOMContentLoaded, is in place at once.
    var adapter = null;   // the jsPsych adapter, set below
    if (win.document.body) startMonitoring(ctx);
    else {
      win.document.addEventListener('DOMContentLoaded', function () {
        try { startMonitoring(ctx); } catch (e) { failDeferred(ctx, adapter, e); }
      }, { once: true });
    }

    if (host === 'vanilla') {
      startGuards({ win: win, doc: win.document, guards: config.guards, debug: config.debug });
      replay.startVanilla();
    } else adapter = installJsPsychAdapter({ win: win, ctx: ctx });
    watchHostPlacement({
      win: win, doc: win.document, ctx: ctx, adapter: adapter,
      onVanilla: function () {
        try {
          startGuards({ win: win, doc: win.document, guards: config.guards, debug: config.debug });
          if (!ctx.vanilla) ctx.vanilla = installVanillaAdapter({ win: win, ctx: ctx });
          replay.startVanilla();
        } catch (e) {
          console.error(MESSAGES.bootFailed(String((e && e.message) || e)));
        }
      }
    });
    win.CyborgHunter = ctx.api;
    win.__cyborgHunterLoaded = 'ch.js';
    return ctx;
  } catch (e) {
    fail(ctx || { monitor: monitor }, e);
    return null;
  }
}

// The monitor's session and the first span ('span-<index>'). Skipped after a
// manual-mode hand-over, which destroyed the monitor already.
function startMonitoring(ctx) {
  if (ctx.host === 'manual') return;
  ctx.monitor.startSession();
  var started = ctx.segmenter.start();
  if (started && started.error) throw new Error('could not open the first trial: ' + started.error);
}

// The deferred session start failed. The segmenter is abandoned first (it
// closes a span the failure left open while the monitor is still alive, and
// latches, so a later cut() or finish() neither touches the destroyed
// monitor nor replaces the marker below). The monitor is destroyed and the
// failure logged once; ctx.bootError keeps the placement check from taking
// the page for one ch.js could not hook. Then:
//   vanilla  the adapter stays (cut() does nothing without an open span), so
//            data(), the form's hidden input and the next page still carry
//            the earlier pages, with a cyborgHunterError note;
//   jsPsych  the initJsPsych wrap is removed, so a later initJsPsych() runs
//            jsPsych as if ch.js were absent. An instance created before
//            DOMContentLoaded keeps the extensions already injected (they
//            stand down on ctx.bootError) and gets cyborgHunterError on every
//            row.
function failDeferred(ctx, adapter, e) {
  var msg = String((e && e.message) || e);
  ctx.bootError = msg;
  try { ctx.segmenter.abandon(); } catch (_) { /* already failing */ }
  try { ctx.monitor.destroy(); } catch (_) { /* already failing */ }
  console.error(MESSAGES.bootFailed(msg));
  try {
    if (ctx.vanilla) {
      var page = ctx.vanilla.blob().cyborgHunterOneLiner.pageCount;
      ctx.vanilla.noteError('Cyborg Hunter did not start on page ' + page + ': ' + msg);
    }
    if (adapter) {
      adapter.restore();
      if (ctx.jsPsych) ctx.jsPsych.data.addProperties({ cyborgHunterError: 'Cyborg Hunter did not start: ' + msg });
    }
  } catch (_) { /* the failure is logged above */ }
}

function fail(ctx, e) {
  if (ctx.vanilla) { try { ctx.vanilla.teardown(); } catch (_) { /* already failing */ } }
  if (ctx.monitor) { try { ctx.monitor.destroy(); } catch (_) { /* already failing; the boot error is the one to show */ } }
  console.error(MESSAGES.bootFailed(String((e && e.message) || e)));
}
