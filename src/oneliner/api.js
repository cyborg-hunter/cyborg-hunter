// src/oneliner/api.js
// The window.CyborgHunter namespace under the one-line setup. It replaces the
// core's namespace (init + static helpers), so a researcher's leftover
// CyborgHunter.init() cannot destroy the one-liner's monitor (core init()
// destroys the previous instance): here init() only explains itself.
//
// buildPublicApi(ctx) → frozen {
//   VERSION,
//   mark(trialId?)          close the current segment, open the next
//   startTrial(opts)        ≡ mark(opts && opts.trialId)
//   endTrial()              ≡ mark()
//   data(), replay(), startFriction()
//   frictionEntryTrial(opts)   GuardFriction.createEntryTrial(opts)
//   init(cfg)               logs manualInitOnOneLiner, returns the namespace
//   preventTextSelection, addHoneypot, setAltText   (core static helpers)
// }
// mark/data/replay/startFriction depend on the host (jsPsych or vanilla); the
// host adapter installs them in ctx.handlers. Until it does they return
// undefined.

import { VERSION } from '../shared/constants.js';
import { preventTextSelection, addHoneypot, setAltText } from '../core/signals/dom-protection.js';
import { MESSAGES } from './errors.js';

export function buildPublicApi(ctx) {
  function handler(name) {
    return function () {
      var h = ctx.handlers && ctx.handlers[name];
      return h ? h.apply(null, arguments) : undefined;
    };
  }
  var mark = handler('mark');
  var api = {
    VERSION: VERSION,
    mark: mark,
    startTrial: function (opts) { return mark(opts && opts.trialId); },
    endTrial: function () { return mark(); },
    data: handler('data'),
    replay: handler('replay'),
    startFriction: handler('startFriction'),
    frictionEntryTrial: function (opts) { return ctx.win.GuardFriction.createEntryTrial(opts); },
    init: function () {
      console.error(MESSAGES.manualInitOnOneLiner());
      return api;
    },
    preventTextSelection: preventTextSelection,
    addHoneypot: addHoneypot,
    setAltText: setAltText
  };
  return Object.freeze(api);
}
