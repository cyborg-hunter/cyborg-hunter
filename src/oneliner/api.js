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
//   init(cfg)               logs manualInitOnOneLiner, returns the namespace;
//                           in manual mode, the core init(cfg)
//   preventTextSelection, addHoneypot, setAltText   (core static helpers)
// }
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
    // .init(). With cyborg-hunter.min.js loaded after ch.js that is the core
    // namespace; with ch.js alone it is this one, so init() hands out a core
    // monitor here (ch.js's own monitor is already destroyed by then).
    // ctx.host is read at call time: the hand-over happens after boot.
    init: function (cfg) {
      if (ctx.host === 'manual') return coreInit(cfg);
      console.error(MESSAGES.manualInitOnOneLiner());
      return api;
    },
    preventTextSelection: preventTextSelection,
    addHoneypot: addHoneypot,
    setAltText: setAltText
  };
  return Object.freeze(api);
}
