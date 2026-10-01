// src/oneliner/api.js
// The window.CyborgHunter namespace under the one-line setup. It replaces the
// core's namespace (init + static helpers), so a researcher's leftover
// CyborgHunter.init() cannot destroy the one-liner's monitor (core init()
// destroys the previous instance): here init() only explains itself, except
// in manual mode (below).
//
// buildPublicApi(ctx) → frozen {
//   VERSION,
//   mark(trialId?)          close the current segment, open the next
//   startTrial(opts)        ≡ mark(opts && opts.trialId)
//   endTrial()              ≡ mark()
//   data(), startFriction()
//   replay()                stop the replay recorder (data-replay) and return
//                           its recording for the researcher's own save code;
//                           null, with a warning, when replay is off or not
//                           started yet (replay-loader.js)
//   frictionEntryTrial(opts)   GuardFriction.createEntryTrial(opts)
//   init(cfg)               logs manualInitOnOneLiner, returns inertMonitor(api)
//                           (below); in manual mode, the core init(cfg)
//   preventTextSelection, addHoneypot, setAltText   (core static helpers)
// }
// buildInertApi() → the same members, inert (ch.js failed; see below).
// mark/data/startFriction depend on the host (jsPsych or vanilla); the host
// adapter installs them in ctx.handlers, and boot installs replay
// (replay-loader.js). Until then they return undefined. mark() (with startTrial/endTrial) and data() are vanilla calls:
// on the jsPsych host, and in manual mode, they warn and do nothing (ctx.host
// is read at call time: a jsPsych page ch.js cannot hook becomes vanilla
// after boot).

import { VERSION } from '../shared/constants.js';
import { init as coreInit } from '../core/monitor.js';
import { preventTextSelection, addHoneypot, setAltText } from '../core/signals/dom-protection.js';
import { MESSAGES } from './errors.js';

var VANILLA_ONLY = '[cyborg-hunter] mark()/data() are vanilla-mode calls; jsPsych trials are segmented automatically';

// What init() returns when it must not start a second monitor: a copy of the
// namespace with the core monitor's documented methods as no-ops, so
// half-migrated standalone code (CyborgHunter.init(cfg).startSession(), …
// .endTrial().foo = 1, a manual jsPsych extension on a failed ch.js) runs on
// without throwing and without driving ch.js's monitor. startTrial/endTrial
// shadow the namespace's mark() aliases on purpose. A plain copy, not
// Object.create(api): the namespace is frozen, and assigning over an
// inherited read-only property (startTrial, endTrial) throws. endTrial()
// returns a fresh object each call (the manual extension writes to it).
function inertMonitor(api) {
  return Object.assign({}, api, {
    startSession: function () {},
    startTrial: function () {},
    endTrial: function () { return {}; },
    getSessionReport: function () { return {}; },
    getSessionScore: function () { return {}; },
    shouldScreenout: function () { return false; },
    destroy: function () {}
  });
}

export function buildPublicApi(ctx) {
  function handler(name) {
    return function () {
      var h = ctx.handlers && ctx.handlers[name];
      return h ? h.apply(null, arguments) : undefined;
    };
  }
  function vanillaOnly(name) {
    var h = handler(name);
    return function () {
      if (ctx.host === 'jspsych' || ctx.host === 'manual') {
        console.warn(VANILLA_ONLY);
        return undefined;
      }
      return h.apply(null, arguments);
    };
  }
  var mark = vanillaOnly('mark');
  var api = {
    VERSION: VERSION,
    mark: mark,
    startTrial: function (opts) { return mark(opts && opts.trialId); },
    endTrial: function () { return mark(); },
    data: vanillaOnly('data'),
    replay: handler('replay'),
    startFriction: handler('startFriction'),
    frictionEntryTrial: function (opts) { return ctx.win.GuardFriction.createEntryTrial(opts); },
    // Manual mode (adapters/jspsych.js handOver): the researcher's own
    // jsPsych extension creates the monitor by calling window.CyborgHunter
    // .init(). That is this namespace, with ch.js alone and with
    // cyborg-hunter.min.js loaded after ch.js (min.js's footer restores it;
    // build.js), so init() hands out a core monitor here (ch.js's own monitor
    // is already destroyed by then). ctx.host is read at call time: the
    // hand-over happens after boot.
    init: function (cfg) {
      if (ctx.host === 'manual') return coreInit(cfg);
      console.error(MESSAGES.manualInitOnOneLiner());
      return inertMonitor(api);
    },
    preventTextSelection: preventTextSelection,
    addHoneypot: addHoneypot,
    setAltText: setAltText
  };
  return Object.freeze(api);
}

// window.CyborgHunter when ch.js failed and nothing else defined it (boot.js
// fail()): the same members, each returning a harmless value, so documented
// calls in the experiment code do not throw. The first call logs notRunning
// once. Return values:
//   mark / startTrial / endTrial / startFriction   undefined
//   data()     { libraryVersion, trials: [], cyborgHunterError }, so a save
//              of it still parses and says why it is empty
//   replay()   null (as when replay is off)
//   init()     inertMonitor(api) (as the one-liner's init() outside manual
//              mode), so a manual extension or standalone code runs on
//   frictionEntryTrial()   a timeline node jsPsych skips (conditional_function
//              false): no row, and friction is not started with nothing to
//              stop it at the end
// The core's static helpers (preventTextSelection, addHoneypot, setAltText)
// do not depend on the monitor and stay real.
export function buildInertApi() {
  var warned = false;
  function noted(value) {
    return function () {
      if (!warned) { warned = true; console.warn(MESSAGES.notRunning()); }
      return typeof value === 'function' ? value() : value;
    };
  }
  // Never run (the node is skipped), but a valid trial in case a host walks it.
  function Skipped(jsPsych) { this.jsPsych = jsPsych; }
  Skipped.info = { name: 'cyborg-hunter-skipped', parameters: {} };
  Skipped.prototype.trial = function () { this.jsPsych.finishTrial({}); };
  var api = {
    VERSION: VERSION,
    mark: noted(undefined),
    startTrial: noted(undefined),
    endTrial: noted(undefined),
    data: noted(function () {
      return { libraryVersion: VERSION, trials: [], cyborgHunterError: 'Cyborg Hunter did not start on this page' };
    }),
    replay: noted(null),
    startFriction: noted(undefined),
    frictionEntryTrial: noted(function () {
      return { timeline: [{ type: Skipped }], conditional_function: function () { return false; } };
    }),
    init: noted(function () { return inertMonitor(api); }),
    preventTextSelection: preventTextSelection,
    addHoneypot: addHoneypot,
    setAltText: setAltText
  };
  return Object.freeze(api);
}
