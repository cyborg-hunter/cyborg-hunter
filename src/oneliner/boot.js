// src/oneliner/boot.js
// Everything dist/ch.js does at load, in order:
//   0. window.jsPsychCyborgHunter = OneLinerExtension unless a class is
//      already there, before anything that can stop or fail: the documented
//      per-trial { type: jsPsychCyborgHunter, params } entry then works with
//      ch.js alone, and never becomes a ReferenceError in the researcher's
//      code (extension-cyborg-hunter.js loaded first keeps its own class, and
//      loaded later replaces this one: manual mode either way when initJsPsych
//      lists it). With no context wired the class is inert;
//   1. double-load sentinel: if cyborg-hunter.min.js (or another ch.js)
//      already ran, say so and stop: no monitor, window.CyborgHunter untouched.
//      After min.js, initJsPsych gets the inert wrapper (below); after another
//      ch.js it is left to that one;
//   2. config (tag data-* attributes over window.CyborgHunterConfig);
//   3. participant id (warns when it has to fall back to a random id). The
//      id is kept for the tab in sessionStorage, so a later page without an
//      id of its own reuses the first page's random id (source 'session')
//      and continues its session; a URL, attribute or config id still wins.
//      Under Qualtrics' New Survey Taking Experience the kept id and the
//      saved session are per survey (ctx.qualtricsSurveyId, the SV_… id:
//      adapters/qualtrics.js qualtricsSurveyId): every survey on a brand
//      domain shares the tab's sessionStorage, and a second survey in the tab
//      must not continue the first. The Qualtrics check (step 5) is read
//      here already for that;
//   4. a monitor (its session starts at step 6);
//   5. host: 'jspsych' when initJsPsych is already defined, in a file built
//      with it (HAS_JSPSYCH), else 'vanilla' (the host adapters install their
//      hooks into ctx.handlers). On the
//      vanilla host a Qualtrics survey is recognised first
//      (adapters/qualtrics.js: ctx.qualtricsLayout 'new' | 'legacy' | null,
//      with a console warning for the legacy layout), before replay, whose
//      boot reminder depends on it. The vanilla
//      adapter (adapters/vanilla.js) is installed before the first span
//      opens: it restores a previous page's segment index, so the boot span
//      is named after the continued index. On a Qualtrics survey it leaves
//      the page boundary to the Qualtrics writer (ctx.qualtrics), installed
//      right after it: one capped embedded-data write per page submit;
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
//   9. window.CyborgHunter = the one-liner namespace; then the sentinel and
//      the re-run hook (win.__cyborgHunterOnRerun, called by a same-file
//      re-run of ch.js instead of a second boot: rerun.js, entry.js), and on
//      a Qualtrics survey the mark that makes such a re-run silent
//      (win.__cyborgHunterRerunHost; on other pages a second tag is loud);
//  10. data-debug only (debug.js): the badge and the console summary, shown
//      once now and again when the jsPsych timeline is walked.
//
// boot({ script, win, monitorFactory?, participantParams?, qualtricsMaxChars? }) → ctx | null
//   script:            the ch.js <script> element (document.currentScript), or null
//   win:               the window (the core monitor itself uses the globals)
//   monitorFactory:    core init(); injectable for tests
//   participantParams: URL parameter names for the participant id, in order
//   qualtricsMaxChars: the Qualtrics writer's cap; injectable for tests. A
//                      page reaches it through CyborgHunterConfig
//                      .qualtricsMaxChars (config.js), a test seam for the
//                      browser harness that can only lower the cap: the
//                      writer clamps either one to MAX_CHARS
//                      (adapters/qualtrics.js), so no option pushes a write
//                      above Qualtrics' limit
// ctx = { file (CH_FILE), wrongBuild (null | { host, file }), config,
//         participantId, participantIdSource, monitor, differ, segmenter,
//         host, scriptSrc, handlers, win, api, qualtricsLayout,
//         qualtricsSurveyId ('SV_…' on the new layout when found, else null),
//         rerunCount, vanilla?, qualtrics? (Qualtrics writer),
//         replaySrc?, replayProxy? (jsPsych), replay? (vanilla handle),
//         debug? (data-debug) }
//
// boot never throws into the page: any failure is logged as bootFailed, a
// monitor created before the failure is destroyed, and boot returns null.
// The sentinel is set only after a successful boot, so a later
// cyborg-hunter.min.js still works if ch.js failed. The exception is a
// failure at the deferred session start (step 6, ch.js in <head>): boot has
// returned by then, so the namespace and the sentinel stay, and what can
// still be saved is marked (failDeferred below).
//
// Whenever ch.js does not monitor (a failure, either kind, or the stand-down
// after min.js) the host page must still run as it would without ch.js:
// initJsPsych is left with only the inert wrapper (adapters/jspsych.js
// installInertWrapper), which lists OneLinerExtension when nothing named
// 'cyborg-hunter' is listed, so the researcher's jsPsychCyborgHunter trials
// find a registered instance; and a boot failure with no window.CyborgHunter
// yet leaves the inert namespace (api.js buildInertApi), so documented calls
// do not throw.
//
// Every one-line file runs this boot (build-targets.js). Each sets the same
// sentinel value, 'ch.js', so cyborg-hunter.min.js's footer and rerun.js read
// any of them as the one-line setup, and names itself in
// win.__cyborgHunterFile (non-enumerable), so a later double load names both
// files and rerun.js takes only the same file for a header re-run. ctx.file
// is the running file's name (CH_FILE, build-flags.js), for
// the messages that name it. Each call into the jsPsych adapter is guarded by
// HAS_JSPSYCH, and each into the Qualtrics adapter by HAS_QUALTRICS, so a
// file without one drops that code. A file on a page whose framework it does
// not carry logs one wrongBuild error naming the file that does
// (ctx.wrongBuild, which the data-debug badge shows too) and records the page
// as a page without a framework: ch.js on a survey without jsPsych names
// ch-qualtrics.js, a file without the jsPsych adapter on a jsPsych page names
// ch.js. The exception is ch-qualtrics.js on a survey that also runs jsPsych,
// whether jsPsych is there at boot or only by DOMContentLoaded: it records
// the survey as a Qualtrics page and logs one qualtricsJsPsych warning.

import './build-flags.js';
import { init } from '../core/monitor.js';
import { createSegmentDiffer } from './segment-diff.js';
import { createSegmenter } from './segmenter.js';
import { readConfig } from './config.js';
import { resolveParticipantId, randomParticipantId, DEFAULT_PARAMS } from './participant-id.js';
import { startGuards } from './guards.js';
import { buildPublicApi, buildInertApi } from './api.js';
import { MESSAGES } from './errors.js';
import { installJsPsychAdapter, installInertWrapper, watchHostPlacement } from './adapters/jspsych.js';
import { OneLinerExtension } from './adapters/jspsych-extension.js';
import { installVanillaAdapter } from './adapters/vanilla.js';
import { detectQualtrics, qualtricsSurveyId, installQualtricsAdapter } from './adapters/qualtrics.js';
import { installReplay } from './replay-loader.js';
import { createDebug } from './debug.js';

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
  var adapter = null;   // the jsPsych adapter, once installed (step 7)
  try {
    // detectManualMode (adapters/jspsych.js) treats this class as the one-liner.
    if (HAS_JSPSYCH && win.jsPsychCyborgHunter === undefined) win.jsPsychCyborgHunter = OneLinerExtension;
  } catch (_) { /* a locked global: the researcher's own script tag still works */ }
  try {
    if (win.__cyborgHunterLoaded) {
      // A one-line file of an earlier release set only the sentinel.
      var first = win.__cyborgHunterLoaded === 'ch.js' && typeof win.__cyborgHunterFile === 'string' ? win.__cyborgHunterFile : win.__cyborgHunterLoaded;
      console.error(MESSAGES.doubleLoad(first, CH_FILE));
      // Another ch.js already wraps initJsPsych; a second wrapper would list
      // this bundle's own class, which that ch.js takes for a manual-mode
      // extension (detectManualMode compares classes).
      if (HAS_JSPSYCH && win.__cyborgHunterLoaded !== 'ch.js') installInertWrapper(win);
      return null;
    }

    var script = opts.script || null;
    var config = readConfig({ dataset: (script && script.dataset) || {}, globalConfig: win.CyborgHunterConfig });
    // The page's framework, against the ones this file carries (step 5). A
    // file with the jsPsych adapter takes a page with jsPsych for a jsPsych
    // page, Qualtrics or not. The others look for a Qualtrics survey first:
    // ch-qualtrics.js records a survey that also runs jsPsych as a Qualtrics
    // page, with one warning that its trials get no rows of their own. A
    // framework the file does not carry gets one wrongBuild error naming the
    // file that does, and the page is recorded as a page without a framework.
    var jsPsychPage = typeof win.initJsPsych === 'function';
    // A Qualtrics survey (the vanilla host; the layout goes on ctx at step
    // 5). Under the new layout the kept id and the saved session are per
    // survey. Not under the legacy layout, where every page is a new load: an
    // address without the survey id on a later page would lose the earlier
    // pages.
    var qualtricsSeen = HAS_JSPSYCH && jsPsychPage ? null : detectQualtrics(win);
    var qualtrics = HAS_QUALTRICS ? qualtricsSeen : null;
    var wrongBuild = qualtricsSeen && !HAS_QUALTRICS ? { host: 'Qualtrics', file: 'ch-qualtrics.js' }
      : jsPsychPage && !HAS_JSPSYCH && !qualtrics ? { host: 'jsPsych', file: 'ch.js' } : null;
    if (wrongBuild) console.error(MESSAGES.wrongBuild(wrongBuild.host, wrongBuild.file, CH_FILE));
    else if (qualtrics && jsPsychPage) console.warn(MESSAGES.qualtricsJsPsych());
    var surveyId = HAS_QUALTRICS && qualtrics && qualtrics.layout === 'new' ? qualtricsSurveyId(win, config.qualtricsSurveyIdAttr) : null;
    var pidKey = surveyId ? PID_KEY + ':' + surveyId : PID_KEY;

    var pid = resolveParticipantId({
      search: (win.location && win.location.search) || '',
      attr: config.participantIdAttr,
      configId: config.monitor.participantId,
      params: opts.participantParams || DEFAULT_PARAMS,
      random: function () { return randomParticipantId(win.crypto || globalThis.crypto); }
    });
    if (pid.source === 'random') {
      var kept = sessionGet(win, pidKey);
      if (kept) pid = { id: kept, source: 'session' };
      else console.warn(MESSAGES.randomId(pid.id, CH_FILE));
    }
    sessionSet(win, pidKey, pid.id);

    monitor = monitorFactory(Object.assign({}, config.monitor, { participantId: pid.id, preset: config.preset }));
    var differ = createSegmentDiffer(monitor);
    var segmenter = createSegmenter({ monitor: monitor, differ: differ });
    var host = HAS_JSPSYCH && jsPsychPage ? 'jspsych' : 'vanilla';

    ctx = {
      file: CH_FILE,
      wrongBuild: wrongBuild,
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
      api: null,
      qualtricsLayout: null,
      qualtricsSurveyId: surveyId
    };
    ctx.api = buildPublicApi(ctx);
    // data-debug only: the badge, the console summary and the perf counters.
    if (config.debug) {
      ctx.debug = createDebug({ doc: win.document, ctx: ctx });
      win.__cyborgHunterDebug = { stats: ctx.debug.stats };
    }
    // The Qualtrics layout (read above): set before installReplay, whose boot
    // reminder names Qualtrics when this is set.
    if (host === 'vanilla') {
      ctx.qualtricsLayout = qualtrics ? qualtrics.layout : null;
      if (ctx.qualtricsLayout === 'legacy') console.warn(MESSAGES.qualtricsLegacyLayout());
    }
    var replay = installReplay({ win: win, ctx: ctx });
    if (host === 'vanilla') {
      // Under Qualtrics the writer owns the page boundary: the vanilla
      // adapter cuts on marks only, and keeps the session per survey on the
      // new layout. With data-debug the badge shows each write.
      // The cap's two overrides are for tests.
      ctx.vanilla = installVanillaAdapter({ win: win, ctx: ctx, pageBoundaries: !ctx.qualtricsLayout, keyScope: surveyId });
      if (HAS_QUALTRICS && ctx.qualtricsLayout) {
        ctx.qualtrics = installQualtricsAdapter({
          win: win, ctx: ctx, maxChars: opts.qualtricsMaxChars || config.qualtricsMaxChars,   // the writer clamps it to MAX_CHARS
          onWrite: ctx.debug ? function () { ctx.debug.refresh(); } : null
        });
      }
    }

    // The session start observes document.body (core signals/browser.js), so
    // with ch.js in <head> it waits for DOMContentLoaded; everything else,
    // including the initJsPsych wrap the experiment code may call before
    // DOMContentLoaded, is in place at once.
    if (win.document.body) startMonitoring(ctx);
    else {
      win.document.addEventListener('DOMContentLoaded', function () {
        if (ctx.bootError) return;   // boot failed after this was registered: logged, monitor gone
        try { startMonitoring(ctx); } catch (e) { failDeferred(ctx, adapter, e); }
      }, { once: true });
    }

    if (host === 'vanilla') {
      startGuards({ win: win, doc: win.document, guards: config.guards, debug: config.debug });
      replay.startVanilla();
    } else if (HAS_JSPSYCH) adapter = installJsPsychAdapter({ win: win, ctx: ctx });
    if (HAS_JSPSYCH) watchHostPlacement({
      win: win, doc: win.document, ctx: ctx, adapter: adapter,
      onVanilla: function () {
        try {
          startGuards({ win: win, doc: win.document, guards: config.guards, debug: config.debug });
          if (!ctx.vanilla) ctx.vanilla = installVanillaAdapter({ win: win, ctx: ctx });
          replay.startVanilla();
          if (ctx.debug) ctx.debug.logWhenParsed();
        } catch (e) {
          console.error(MESSAGES.bootFailed(String((e && e.message) || e)));
        }
      }
    });
    else if (!jsPsychPage) noticeLateJsPsych(win, ctx);
    try {
      Object.defineProperty(win, '__cyborgHunterFile', {
        value: CH_FILE, writable: false, enumerable: false, configurable: true
      });
    } catch (_) { /* a page's own locked name: a diagnostic mark must never stop monitoring */ }
    win.CyborgHunter = ctx.api;
    win.__cyborgHunterLoaded = 'ch.js';
    // A host that re-renders its header runs this same ch.js again
    // (rerun.js, entry.js): the re-run calls this hook instead of booting.
    // Non-enumerable, so it stays out of the page's own window walks; not
    // writable, so a plain assignment by page code cannot replace it.
    ctx.rerunCount = 0;
    Object.defineProperty(win, '__cyborgHunterOnRerun', {
      value: function (info) {
        ctx.rerunCount += 1;
        var h = ctx.handlers.rerun;
        if (h) {
          try { h(info); } catch (e) { console.error(MESSAGES.rerunFailed(String((e && e.message) || e))); }
        }
        if (ctx.debug) ctx.debug.refresh();
      },
      writable: false, enumerable: false, configurable: true
    });
    // Only Qualtrics re-runs its header, so only a page where this file found
    // a Qualtrics survey takes a second run of this version for a re-run
    // (rerun.js markRerun); elsewhere a second tag stays the loud double load.
    // That includes a file without the Qualtrics adapter, which said so once
    // (wrongBuild) and must not repeat it on every page.
    if (qualtricsSeen) {
      Object.defineProperty(win, '__cyborgHunterRerunHost', {
        value: 'qualtrics', writable: false, enumerable: false, configurable: true
      });
    }
    // One console summary per page: vanilla logs once the DOM is parsed;
    // jsPsych logs from the wrapped run() (after the walk), so here it only
    // shows the badge.
    if (ctx.debug) {
      if (host === 'jspsych') ctx.debug.refresh(); else ctx.debug.logWhenParsed();
    }
    return ctx;
  } catch (e) {
    fail(win, ctx || { monitor: monitor }, adapter, e);
    return null;
  }
}

// A file without the jsPsych adapter whose tag sits above jspsych.js: the
// check at step 5 ran before initJsPsych existed, so the file looks once more
// when the DOM is parsed (the jsPsych adapter's placement check does the same
// for ch.js). It is registered only when jsPsych was absent at boot: a page
// whose jsPsych was already there got its one message at step 5. A document
// already parsed at boot was fully seen by step 5. It only reports:
// initJsPsych is left alone and the page stays as boot found it. On a
// Qualtrics survey (ch-qualtrics.js; ctx.qualtricsLayout is set only with
// HAS_QUALTRICS) that is a Qualtrics page, with the same qualtricsJsPsych
// warning; elsewhere a page without a framework, with one wrongBuild error
// naming ch.js.
function noticeLateJsPsych(win, ctx) {
  var doc = win.document;
  if (doc.readyState !== 'loading') return;
  doc.addEventListener('DOMContentLoaded', function () {
    if (ctx.wrongBuild || typeof win.initJsPsych !== 'function') return;
    if (ctx.qualtricsLayout) { console.warn(MESSAGES.qualtricsJsPsych()); return; }
    ctx.wrongBuild = { host: 'jsPsych', file: 'ch.js' };
    console.error(MESSAGES.wrongBuild('jsPsych', 'ch.js', CH_FILE));
  }, { once: true });
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
      if (HAS_JSPSYCH) installInertWrapper(ctx.win);
      if (ctx.jsPsych) ctx.jsPsych.data.addProperties({ cyborgHunterError: 'Cyborg Hunter did not start: ' + msg });
    }
  } catch (_) { /* the failure is logged above */ }
}

// A failure inside boot(). ctx.bootError keeps the placement check
// (watchHostPlacement, registered before some steps that can fail) from
// taking the page for one ch.js could not hook and starting the vanilla
// path. A jsPsych wrap already installed is removed (it would drive the
// destroyed monitor) and the inert wrapper takes its place.
function fail(win, ctx, adapter, e) {
  var msg = String((e && e.message) || e);
  ctx.bootError = msg;
  if (ctx.qualtrics) { try { ctx.qualtrics.teardown(); } catch (_) { /* already failing */ } }
  if (ctx.vanilla) { try { ctx.vanilla.teardown(); } catch (_) { /* already failing */ } }
  if (ctx.monitor) { try { ctx.monitor.destroy(); } catch (_) { /* already failing; the boot error is the one to show */ } }
  console.error(MESSAGES.bootFailed(msg));
  try {
    if (adapter) adapter.restore();
    if (HAS_JSPSYCH) installInertWrapper(win);
  } catch (_) { /* the failure is logged above */ }
  try {
    if (win.CyborgHunter === undefined) win.CyborgHunter = buildInertApi(CH_FILE);
  } catch (_) { /* a locked global */ }
}
