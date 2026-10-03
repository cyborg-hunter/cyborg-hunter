// src/oneliner/adapters/labjs.js
// The lab.js host: window.lab (the UMD build the builder exports as lib/lab.js)
// exists at boot, and every component of a study runs through
// lab.core.Component.prototype.run and .end. Both are patched once:
//   run   after lab.js has inserted the component's content, a leaf component
//         (metadata.nestedComponents empty; a flow.Parallel counts as the
//         leaf and its descendants do not) opens a host trial (segmenter
//         rotate), named from, in order: options.cyborgHunter.trialId,
//         parameters.chTrialId, a [data-ch-trial] element in its content, its
//         own id (sender_id), 'trial-<n>';
//   end   BEFORE lab.js's own end() commits the row, the open trial is cut and
//         the segment, the trial report and the running totals go into
//         component.data, which that end() commits; the root component's end
//         also runs the final hook (last segment, honeypot summary, friction
//         stop, monitor teardown) and writes the *Final fields onto the last
//         trial row through datastore.update, before the researcher's own
//         on('end') handlers run.
// Containers (Sequence, Loop, Frame) commit rows too; they carry no columns.
// A component that ends inside its own run() (skip, Dummy) opened no trial.
//
// Two generations of lab.js share the hooks and differ in five places,
// detected by feature (Component.prototype.lock), never by version:
//   classic (20.x)   run(frameTimestamp, frameSynced); end(reason, …) once;
//                    options.datastore; options.el; options.id (the id
//                    getter throws when options.id is null: the root)
//   flip (22/23)     run({ controlled }): only a controlled run is a run (an
//                    uncontrolled study.run() delegates to the controller);
//                    end() twice (uncontrolled from a response or timeout,
//                    then controlled from the flip; the controlled pass
//                    commits); a skipped component rejects run() with
//                    AbortFlip; internals.controller.global.datastore;
//                    internals.context.el; the id getter
//
// Nothing here throws into lab.js: a hook failure becomes cyborgHunterError on
// the row and one catalogue error per page, and lab.js runs as if ch.js were
// absent from that component on. Guards and replay are the vanilla host's
// standalone ones (boot.js); the vanilla adapter is not installed on this
// host, so the friction start mark (data-ch-friction-start) is handled here.

import { VERSION } from '../../shared/constants.js';
import { MESSAGES } from '../errors.js';

function message(e) { return String((e && e.message) || e); }

export function detectLabJs(win) {
  try {
    var lab = win.lab;
    if (!lab || !lab.core || typeof lab.core.Component !== 'function') return null;
    var proto = lab.core.Component.prototype;
    if (!proto || typeof proto.run !== 'function' || typeof proto.end !== 'function') return null;
    return {
      lab: lab,
      version: typeof lab.version === 'string' ? lab.version : 'unknown',
      generation: typeof proto.lock === 'function' ? 'flip' : 'classic'
    };
  } catch (_) { return null; }   // a locked or throwing global: not lab.js
}

// Vanilla host only. The two diagnoses are decided once the DOM is parsed.
export function watchLabJsPlacement(opts) {
  var win = opts.win, doc = opts.doc, ctx = opts.ctx;
  var done = false;
  function check() {
    if (done) return;
    done = true;
    try {
      if (ctx.bootError || ctx.host !== 'vanilla') return;
      if (detectLabJs(win)) console.error(MESSAGES.loadedAboveLabJs());
      else if (doc.querySelector && doc.querySelector('[data-labjs-section]')) console.error(MESSAGES.labjsNotHookable());
    } catch (_) { /* a diagnosis only */ }
  }
  if (doc.readyState === 'loading' && doc.addEventListener) doc.addEventListener('DOMContentLoaded', check, { once: true });
  else check();
}
