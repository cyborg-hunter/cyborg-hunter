// src/oneliner/boot.js
// Everything dist/ch.js does at load, in order:
//   1. double-load sentinel: if cyborg-hunter.min.js (or another ch.js)
//      already ran, say so and stop: no monitor, window.CyborgHunter untouched;
//   2. config (tag data-* attributes over window.CyborgHunterConfig);
//   3. participant id (warns when it has to fall back to a random id);
//   4. a monitor, its session started, kept inside a trial by the segmenter
//      from this moment on ('span-0'), so a paste before the first host
//      trial is still recorded;
//   5. host: 'jspsych' when initJsPsych is already defined, else 'vanilla'
//      (the host adapters install their hooks into ctx.handlers);
//   6. guards, vanilla host only (honeypot on by default, friction
//      observe-only when enabled). On the jsPsych host the injected guard
//      extensions own them: their initialize() runs GuardHoneypot.init and
//      friction's setJsPsych / injectRefusalNotices, and the entry trial
//      starts enforcement. Starting them here too would init the honeypot
//      twice (the second init resets its violation log);
//   7. window.CyborgHunter = the one-liner namespace, then the sentinel.
//
// boot({ script, win, monitorFactory?, participantParams? }) → ctx | null
//   script:            the ch.js <script> element (document.currentScript), or null
//   win:               the window (the core monitor itself uses the globals)
//   monitorFactory:    core init(); injectable for tests
//   participantParams: URL parameter names for the participant id, in order
// ctx = { config, participantId, participantIdSource, monitor, differ,
//         segmenter, host, scriptSrc, handlers, win, api }
//
// boot never throws into the page: any failure is logged as bootFailed, a
// monitor created before the failure is destroyed, and boot returns null.
// The sentinel is set only after a successful boot, so a later
// cyborg-hunter.min.js still works if ch.js failed.

import { init } from '../core/monitor.js';
import { createSegmentDiffer } from './segment-diff.js';
import { createSegmenter } from './segmenter.js';
import { readConfig } from './config.js';
import { resolveParticipantId, randomParticipantId, DEFAULT_PARAMS } from './participant-id.js';
import { startGuards } from './guards.js';
import { buildPublicApi } from './api.js';
import { MESSAGES } from './errors.js';

export function boot(opts) {
  var win = opts.win;
  var monitorFactory = opts.monitorFactory || init;
  var monitor = null;
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
    if (pid.source === 'random') console.warn(MESSAGES.randomId(pid.id));

    monitor = monitorFactory(Object.assign({}, config.monitor, { participantId: pid.id, preset: config.preset }));
    monitor.startSession();
    var differ = createSegmentDiffer(monitor);
    var segmenter = createSegmenter({ monitor: monitor, differ: differ });
    var started = segmenter.start({ trialId: 'span-0' });
    if (started && started.error) throw new Error('could not open the first trial: ' + started.error);

    var host = typeof win.initJsPsych === 'function' ? 'jspsych' : 'vanilla';
    if (host === 'vanilla') {
      startGuards({ win: win, doc: win.document, guards: config.guards, debug: config.debug });
    }

    var ctx = {
      config: config,
      participantId: pid.id,
      participantIdSource: pid.source,
      monitor: monitor,
      differ: differ,
      segmenter: segmenter,
      host: host,
      scriptSrc: (script && script.src) || null,
      handlers: {},
      win: win,
      api: null
    };
    ctx.api = buildPublicApi(ctx);
    win.CyborgHunter = ctx.api;
    win.__cyborgHunterLoaded = 'ch.js';
    return ctx;
  } catch (e) {
    if (monitor) { try { monitor.destroy(); } catch (_) { /* already failing; the boot error is the one to show */ } }
    console.error(MESSAGES.bootFailed(String((e && e.message) || e)));
    return null;
  }
}
