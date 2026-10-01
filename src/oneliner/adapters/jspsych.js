// src/oneliner/adapters/jspsych.js
// The jsPsych 7 host: ch.js sits below jspsych.js and above the experiment
// code, so window.initJsPsych exists at boot and can be wrapped before the
// researcher calls it. The wrapper
//   1. adds ch.js's extensions to initJsPsych's list: OneLinerExtension
//      ('cyborg-hunter'), the honeypot and, when enabled, friction (deduped by
//      info.name: jsPsych keeps one instance per name but calls initialize()
//      once per listed entry, jspsych.js 7.3.1 :2667-2669 and :2941-2946);
//   2. adds participantId and cyborgHunterVersion to every row (addProperties,
//      once: the only static values);
//   3. wraps jsPsych.run so the timeline is walked and every trial object gets
//      the per-trial entries BEFORE run() builds its TimelineNode tree
//      (:2691). run is an own bound property (autoBind, :2648), so simulate()
//      goes through the wrapper too;
//   4. chains initJsPsych's on_finish: the last segment, the *Final totals,
//      friction stop, honeypot session summary and monitor teardown run
//      first, then the researcher's own on_finish (its return value, possibly
//      a promise, is passed back to jsPsych, :2968-2980). With data-replay
//      and a CyborgHunterConfig.replay.autoSave mode other than 'none', the
//      replay recorder's finalize() (serialize + save) is awaited in between.
// Per-trial segments and running totals are returned by OneLinerExtension's
// on_finish, merged into each row by jsPsych.
//
// Guards on this host. boot does not start them here; the injected guard
// extensions do, from their initialize(), which jsPsych calls inside run()
// after the window load event (prepareDom, :2882-2889). Between boot and that
// moment the monitor already records (the boot span), but the honeypot bait
// and friction are not active yet.
//
// One jsPsych instance per page is assumed: one boot monitor, one segmenter,
// one session. A second wrapped initJsPsych gets a catalogue warning; each
// instance's final hook writes to that instance's own data, and the first
// one to finish ends the session (later rows are left unmarked, see
// jspsych-extension.js).
//
// Nothing here throws into the page: a failure is logged from the catalogue
// (errors.js) and jsPsych runs as if ch.js were absent from that step on.

import { VERSION } from '../../shared/constants.js';
import { MESSAGES } from '../errors.js';
import { OneLinerExtension } from './jspsych-extension.js';

var CH_NAME = 'cyborg-hunter';
var HONEYPOT_NAME = 'guard-honeypot';
var FRICTION_NAME = 'guard-friction';
var REPLAY_NAME = 'cyborg-hunter-replay';
var ENTRY_TRIAL_LABEL = 'guard_friction_entry';   // GuardFriction.createEntryTrial's data label

function message(e) { return String((e && e.message) || e); }
function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

function nameOf(entry) {
  return entry && entry.type && entry.type.info ? entry.type.info.name : undefined;
}

export function isChType(type) {
  return !!(type && type.info && type.info.name === CH_NAME);
}

// Keeps the first entry per type.info.name. Entries without a name are kept
// as they are (jsPsych itself will report them).
export function dedupeExtensions(list) {
  var seen = Object.create(null);
  var out = [];
  (list || []).forEach(function (entry) {
    var name = nameOf(entry);
    if (name === undefined) { out.push(entry); return; }
    if (seen[name]) return;
    seen[name] = true;
    out.push(entry);
  });
  return out;
}

// Adds each of `entries` to every trial object of `timeline` that does not
// already list an extension of that name.
//
// jsPsych (:2160-2199) treats an object with `timeline` as a node and passes
// its other keys (type, extensions, data, ...) down to each child with a
// shallow Object.assign, so a child's own `extensions` replaces the parent's.
// The walk therefore carries the inherited type and extensions down, touches
// only trial objects (no `timeline`), and never wraps anything (a wrapper node
// would shift internal_node_id). A trial that inherits its parent's list gets
// its own copy of it plus ours.
//
// Rules: (a) a trial already listing a cyborg-hunter entry keeps it and gets
// no second one for that name; (b) an object reached twice (the same trial in
// two places) is handled once; a non-array `extensions` is left alone with a
// warning. A cyborg-hunter entry with null/undefined params gets `params: {}`.
//
// Each trial gets its own shallow copy of an entry and of its params:
// OneLinerExtension ties an on_load to its trial by the params object (see
// jspsych-extension.js). jsPsych 7.3.1 already deep-copies a trial before
// running it (TimelineNode.trial(), :2218-2222); the copy here does not rely
// on that. The copies are remembered across calls, so a timeline run twice
// does not count them as a researcher's own entry.
var injectedCopies = new WeakSet();

export function injectExtensions(timeline, entries, seen) {
  seen = seen || new WeakSet();
  var result = { trials: 0, skippedOwnEntry: 0, sharedObjects: 0, entryTrialFound: false };
  var warnedFrozen = false;

  function copyOf(entry) {
    var c = Object.assign({}, entry);
    if (entry.params && typeof entry.params === 'object') c.params = Object.assign({}, entry.params);
    injectedCopies.add(c);
    return c;
  }

  function walkList(list, inherited) {
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) walkNode(list[i], inherited);
  }

  function walkNode(node, inherited) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) { result.sharedObjects += 1; return; }
    seen.add(node);
    var hasOwnList = own(node, 'extensions');
    var type = own(node, 'type') ? node.type : inherited.type;
    var list = hasOwnList ? node.extensions : inherited.extensions;
    if (node.timeline !== undefined) {
      walkList(node.timeline, { type: type, extensions: list });
      return;
    }
    if (type === undefined) return;   // not a trial; jsPsych reports a missing type itself
    if (list !== undefined && !Array.isArray(list)) {
      console.warn('[cyborg-hunter] a trial\'s extensions is not an array, so ch.js left that trial unmonitored');
      return;
    }
    result.trials += 1;
    if (node.data && node.data.trial_type_label === ENTRY_TRIAL_LABEL) result.entryTrialFound = true;

    list = list || [];
    // A researcher's own cyborg-hunter entry written without params (the
    // manual docs' per-trial loop) would reach on_start and on_load as
    // `undefined` on every trial, so a late load callback could pass for this
    // trial's own. Give it a params object; params a researcher wrote are
    // never touched. A frozen entry stays as it is (the write would throw and
    // leave the rest of the timeline unmonitored).
    list.forEach(function (e) {
      if (!e || !isChType(e.type) || e.params != null) return;
      try { e.params = {}; } catch (err) { /* frozen or sealed: left params-less */ }
    });
    var present = list.map(nameOf);
    // Counted only for a researcher's own entry, not one of ours already
    // pushed into an extensions array that several trials share.
    if (list.some(function (e) { return e && isChType(e.type) && !injectedCopies.has(e); })) {
      result.skippedOwnEntry += 1;
    }
    var missing = entries.filter(function (e) { return present.indexOf(nameOf(e)) === -1; });
    if (missing.length === 0) return;
    missing = missing.map(copyOf);
    // A frozen or sealed trial object (or extensions array) throws in strict
    // mode; that trial stays unmonitored and the walk goes on.
    try {
      if (hasOwnList) Array.prototype.push.apply(node.extensions, missing);
      else node.extensions = list.concat(missing);
    } catch (err) {
      result.trials -= 1;
      if (!warnedFrozen) {
        warnedFrozen = true;
        console.warn('[cyborg-hunter] a trial object could not be changed (frozen or sealed), so ch.js left it unmonitored');
      }
    }
  }

  walkList(timeline, { type: undefined, extensions: undefined });
  return result;
}

// Adds { type: OneLinerExtension, params: {} } to initJsPsych options whose
// extensions list (an array, or absent) has no 'cyborg-hunter' entry. jsPsych
// 7.3.1 calls this.extensions[name].on_start / on_load for every entry a
// trial lists (:3027-3030, :3050-3053), so a researcher trial typed
// jsPsychCyborgHunter needs an instance of that name registered, or it
// throws. A non-array list is left for jsPsych to report. Never throws.
function ensureChEntry(options) {
  try {
    var list = options.extensions;
    if (list === undefined || list === null) list = [];
    if (!Array.isArray(list)) return;
    if (list.some(function (e) { return nameOf(e) === CH_NAME; })) return;
    options.extensions = list.concat([{ type: OneLinerExtension, params: {} }]);
  } catch (_) { /* jsPsych runs as it would without ch.js */ }
}

// What ch.js leaves on initJsPsych when it does not monitor: boot failed
// (boot.js fail()), the deferred session start failed (failDeferred, after
// restore()), or ch.js stood down after cyborg-hunter.min.js. Only
// ensureChEntry: OneLinerExtension.ctx is never set from here, so the entry
// is inert (no rotate, on_finish returns {}). Installed once, and only over a
// function (a page without jsPsych has nothing to wrap).
export function installInertWrapper(win) {
  var orig = win.initJsPsych;
  if (typeof orig !== 'function' || orig.__cyborgHunterInert) return;
  var wrapped = function (options) {
    options = options || {};
    ensureChEntry(options);
    return orig.apply(this, [options].concat(Array.prototype.slice.call(arguments, 1)));
  };
  wrapped.__cyborgHunterInert = true;
  win.initJsPsych = wrapped;
}

// Manual mode (the researcher wires the cyborg-hunter extension themselves):
// an initJsPsych entry named 'cyborg-hunter' whose class is not ours. Listing
// OneLinerExtension itself is still the one-liner.
export function detectManualMode(options) {
  var list = options && options.extensions;
  if (!Array.isArray(list)) return false;
  return list.some(function (e) { return !!e && isChType(e.type) && e.type !== OneLinerExtension; });
}

// Manual mode: the researcher's extension creates its own monitor, so ch.js
// hands over: its boot span is closed without a segment and its monitor is
// destroyed (two monitors would double-count every event).
//
// The researcher's extension calls window.CyborgHunter.init(), which is
// ch.js's namespace whether or not cyborg-hunter.min.js was loaded after
// ch.js (min.js's footer puts ch.js's namespace back; build.js). Its init()
// returns a core monitor once ctx.host is 'manual' (api.js), so the manual
// wiring works either way.
function handOver(ctx) {
  ctx.host = 'manual';
  try { ctx.segmenter.abandon(); } catch (_) { /* the hand-over continues */ }
  try { ctx.monitor.destroy(); } catch (_) { /* already destroyed */ }
  console.info('[cyborg-hunter] manual mode: initJsPsych lists a cyborg-hunter extension, so ch.js injects nothing; finalize() is still required.');
  // run() is never wrapped in manual mode, so this is the page's one summary.
  try { if (ctx.debug && ctx.debug.update) ctx.debug.update(); } catch (_) { /* a debug aid */ }
}

// The end of the session, from the chained on_finish of `jsPsych` (the
// instance that finished, not necessarily the latest one wrapped). Runs once;
// never throws. Friction is stopped before the honeypot writes its session
// summary, so a violation still open at the end is closed first
// (extension-guard-honeypot.js).
function runFinalHook(ctx, win, has, jsPsych) {
  if (ctx.jspsych.finalized) return;
  ctx.jspsych.finalized = true;
  var problems = [];
  var marker = null;
  function step(fn) {
    try { fn(); } catch (e) { problems.push(message(e)); }
  }
  step(function () {
    var r = ctx.segmenter.finish({ source: 'final' });
    if (r && r.segment) {
      var seg = r.segment;
      jsPsych.data.addDataToLastTrial({ integritySegmentFinal: seg });
      jsPsych.data.addProperties({
        integrityPasteCountFinal: seg.counters.pasteCount,
        integrityCopyCountFinal: seg.counters.copyCount,
        integrityDropCountFinal: seg.counters.dropCount,
        integritySoftScoreFinal: seg.score.softScore,
        integrityAnyHardTriggeredFinal: seg.score.anyHardTriggered
      });
    }
    // The segmenter has already logged its own failure.
    if (r && r.error) marker = r.error;
  });
  // Whenever friction holds a token, not only when ch.js injected friction:
  // the entry trial starts friction from its own on_finish timer even when
  // data-guards does not enable it, and its intervals and curtain would
  // outlive the experiment.
  step(function () {
    var token = win._guardFrictionToken;
    if (win.GuardFriction && token) win.GuardFriction.stop(token);
  });
  if (has(HONEYPOT_NAME)) {
    step(function () {
      if (win.GuardHoneypot) win.GuardHoneypot.attachToJsPsychData();
    });
  }
  step(function () { if (!ctx.bootError) ctx.monitor.destroy(); });   // failDeferred destroyed it

  if (problems.length) {
    console.error(MESSAGES.sessionEndFailed(problems.join('; ')));
    marker = marker ? marker + '; ' + problems.join('; ') : problems.join('; ');
  }
  if (marker) {
    try { jsPsych.data.addProperties({ cyborgHunterError: marker }); } catch (_) { /* logged above */ }
  }
  return finalizeReplay(ctx, jsPsych);
}

var FINALIZE_TIMEOUT_MS = 15000;

// The replay recorder's own save (DataPipe, CyborgHunterConfig.replay
// .autoSave), before the researcher's on_finish saves the data, so the rows
// carry its integrityReplayMeta (the order manual mode documents). With the
// default mode 'none' nothing happens here: the researcher's save code calls
// CyborgHunter.replay(). Only the proxy ch.js listed is finalized; a
// researcher's own replay entry is theirs to finalize. → a promise or null.
function finalizeReplay(ctx, jsPsych) {
  var r = ctx.config.replay;
  if (!r || !r.autoSave || !r.autoSave.mode || r.autoSave.mode === 'none' || !ctx.replayProxy) return null;
  try {
    var ext = jsPsych.extensions && jsPsych.extensions[REPLAY_NAME];
    if (!(ext instanceof ctx.replayProxy)) return null;
    // finalize() never throws (extension-cyborg-hunter-replay.js); the catch is for the host's sake.
    // Bounded: a save that never settles must not hold back the researcher's
    // own save and redirect.
    var timer = null;
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () {
        console.warn(MESSAGES.replayFinalizeTimedOut());
        resolve();
      }, ctx.replayFinalizeTimeoutMs || FINALIZE_TIMEOUT_MS);
    });
    var done = Promise.resolve(ext.finalize()).catch(function (e) {
      console.error(MESSAGES.sessionEndFailed('replay: ' + message(e)));
    });
    return Promise.race([done, timeout]).then(function () { clearTimeout(timer); });
  } catch (e) {
    console.error(MESSAGES.sessionEndFailed('replay: ' + message(e)));
    return null;
  }
}

// installJsPsychAdapter({ win, ctx }) → { restore() }
//   ctx: boot's context; gains ctx.jspsych = { invoked, instrumented,
//   entryTrialFound, segmentsWritten, finalized }, ctx.jsPsych (the instance)
//   and, in manual mode, ctx.host = 'manual'.
export function installJsPsychAdapter(opts) {
  var win = opts.win, ctx = opts.ctx;
  var orig = win.initJsPsych;
  ctx.jspsych = { invoked: false, instrumented: 0, entryTrialFound: false, segmentsWritten: 0, finalized: false };

  win.initJsPsych = function (options) {
    if (ctx.jspsych.invoked) console.warn(MESSAGES.secondJsPsychInstance());
    ctx.jspsych.invoked = true;
    options = options || {};
    var manual = false;
    var ours = null;
    var frictionEntry = null;
    try {
      if (detectManualMode(options)) {
        manual = true;
        handOver(ctx);
      } else {
        ours = [{ type: OneLinerExtension, params: {} }];
        if (ctx.config.guards.honeypot && win.jsPsychGuardHoneypot) {
          ours.push({ type: win.jsPsychGuardHoneypot, params: {} });
        }
        if (ctx.config.guards.friction && win.jsPsychGuardFriction) {
          // Observe-only unless the timeline has the entry trial (decided in
          // run() below, before jsPsych reads the params in loadExtensions).
          frictionEntry = { type: win.jsPsychGuardFriction, params: { observeOnly: true } };
          ours.push(frictionEntry);
        }
        if (ctx.config.replay && ctx.replayProxy) ours.push({ type: ctx.replayProxy, params: ctx.config.replay });
        options.extensions = dedupeExtensions((options.extensions || []).concat(ours));
      }
    } catch (e) {
      console.error(MESSAGES.hookFailed(message(e)));
      // The inert entry the researcher's jsPsychCyborgHunter trials need
      // (OneLinerExtension.ctx is not wired on this path).
      ensureChEntry(options);
      return orig(options);
    }
    if (manual) return orig(options);

    // The entries jsPsych will instantiate, one per name (a researcher's own
    // copy of a guard extension wins over ours, first entry per name).
    var listed = options.extensions;
    var ourNames = ours.map(nameOf);
    var injected = listed.filter(function (e) { return ourNames.indexOf(nameOf(e)) !== -1; });
    function has(name) { return injected.some(function (e) { return nameOf(e) === name; }); }
    // Friction listed at all, ours or the researcher's own entry: either one
    // sets friction up for the entry trial.
    var frictionListed = listed.some(function (e) { return nameOf(e) === FRICTION_NAME; });

    // jsPsych calls on_finish as this.opts.on_finish(...) (:2969), so `this`
    // is the options object: the instance is captured below, per call.
    var jsPsych = null;
    var userFinish = options.on_finish;
    options.on_finish = function () {
      var self = this, args = arguments;
      var pending = runFinalHook(ctx, win, has, jsPsych);
      function researcherFinish() {
        return typeof userFinish === 'function' ? userFinish.apply(self, args) : undefined;
      }
      return pending ? pending.then(researcherFinish) : researcherFinish();
    };

    jsPsych = orig(options);
    try {
      OneLinerExtension.ctx = ctx;
      ctx.jsPsych = jsPsych;
      jsPsych.data.addProperties({ participantId: ctx.participantId, cyborgHunterVersion: VERSION });
      var origRun = jsPsych.run;
      jsPsych.run = function (timeline) {
        try {
          var r = injectExtensions(timeline, injected);
          ctx.jspsych.instrumented = r.trials;
          ctx.jspsych.entryTrialFound = r.entryTrialFound;
          // Shared with the initJsPsych list, which loadExtensions reads
          // after this.
          if (frictionEntry) frictionEntry.params.observeOnly = !r.entryTrialFound;
          if (r.entryTrialFound && !frictionListed) console.warn(MESSAGES.frictionEntryWithoutFriction());
        } catch (e) {
          console.error(MESSAGES.instrumentFailed(message(e)));
        }
        // The page's one summary, even when the walk failed (counts what it got).
        try { if (ctx.debug && ctx.debug.update) ctx.debug.update(); } catch (_) { /* a debug aid */ }
        return origRun.apply(this, arguments);
      };
    } catch (e) {
      console.error(MESSAGES.hookFailed(message(e)));
    }
    return jsPsych;
  };

  return { restore: function () { win.initJsPsych = orig; } };
}

// Placement diagnosis, registered by boot on every host.
//   jsPsych host: if jsPsych starts running without initJsPsych having gone
//     through the wrapper, ch.js was loaded after the experiment code called
//     it. jsPsych marks <html jspsych="present"> only once run() is past the
//     window load event and extension loading (:2693-2696), so the check
//     watches for that attribute rather than DOMContentLoaded. Then the
//     wrapper is removed, ctx.host becomes 'vanilla' and onVanilla() (from
//     boot) starts the guards and the vanilla adapter.
//   vanilla host: if initJsPsych appears by DOMContentLoaded, ch.js was
//     loaded above jspsych.js. Otherwise, if jsPsych starts running anyway
//     (the same attribute), the page built jsPsych from a bundler or ES
//     module, which never defines window.initJsPsych: notHookable, once.
//     ctx.host stays 'vanilla' either way.
export function watchHostPlacement(opts) {
  var win = opts.win, doc = opts.doc, ctx = opts.ctx, adapter = opts.adapter;
  var onVanilla = opts.onVanilla;
  if (!doc || !doc.documentElement) return;
  if (ctx.host === 'jspsych') {
    var root = doc.documentElement;
    var notHookable = function () {
      // bootError: the deferred session start failed and removed the wrap.
      if (ctx.bootError || (ctx.jspsych && ctx.jspsych.invoked)) return;
      console.error(MESSAGES.notHookable());
      ctx.host = 'vanilla';
      if (adapter) adapter.restore();
      if (onVanilla) onVanilla();
    };
    if (root.hasAttribute('jspsych')) { notHookable(); return; }
    if (typeof win.MutationObserver !== 'function') return;
    var mo = new win.MutationObserver(function () {
      if (!root.hasAttribute('jspsych')) return;
      mo.disconnect();
      notHookable();
    });
    mo.observe(root, { attributes: true, attributeFilter: ['jspsych'] });
  } else {
    var reported = false;
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', function () {
        if (reported || typeof win.initJsPsych !== 'function') return;
        reported = true;
        console.error(MESSAGES.loadedAboveJsPsych());
      }, { once: true });
    }
    var vroot = doc.documentElement;
    var bundled = function () {
      if (reported || ctx.bootError || ctx.host === 'manual') return;
      reported = true;
      console.error(MESSAGES.notHookable());
    };
    if (vroot.hasAttribute('jspsych')) { bundled(); return; }
    if (typeof win.MutationObserver !== 'function') return;
    var vmo = new win.MutationObserver(function () {
      if (!vroot.hasAttribute('jspsych')) return;
      vmo.disconnect();
      bundled();
    });
    vmo.observe(vroot, { attributes: true, attributeFilter: ['jspsych'] });
  }
}
