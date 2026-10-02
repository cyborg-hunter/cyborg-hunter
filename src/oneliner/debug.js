// src/oneliner/debug.js
// data-debug: a small fixed badge on the page, one console line per update,
// and the segment-write timings a later perf budget reads. Off by default;
// the docs say to remove it before launch, because participants can see it.
// boot only creates this when config.debug is on, so a page without
// data-debug pays nothing (no badge, no counters, no timing calls).
//
// createDebug({ doc, ctx, log = console.info })
//   → { update(), refresh(), logWhenParsed(), summary() → string, badgeText() → string,
//        stats() → { segmentWriteMs }, remove() }
//
// summary():
//   Cyborg Hunter active · <jsPsych detected | vanilla mode> ·
//   <N trials instrumented | N mark elements> · ID from <source> ·
//   honeypot <on|off> · friction <off|observe|enforce>
//   In manual mode: Cyborg Hunter active · manual mode · the page's
//   cyborg-hunter extension monitors the trials
//   N on jsPsych is the PLANNED count: unique trial objects the timeline walk
//   instrumented (ctx.jspsych.instrumented). On vanilla it is the number of
//   [data-ch-trial] elements in the DOM.
//   One summary is logged per page: update() logs, refresh() never does. The
//   badge on jsPsych shows live progress, "written/planned trials"
//   (ctx.jspsych.segmentsWritten / instrumented), or "N trials (M planned)"
//   once loops / timeline_variables write more rows than planned (so never
//   "5/3"); refresh() updates it.
//   <source> is the URL parameter name that resolved, data-participant-id,
//   CyborgHunterConfig, or "random id (not linkable)".
//   With data-replay (and no recorder autoSave) the summary, not the badge,
//   ends with " · data-replay is on: save CyborgHunter.replay() in your save
//   code", in place of boot's console.info reminder (replay-loader.js).
//
// The badge never takes focus or clicks (pointer-events: none) and nothing
// here throws into the host page. update() and refresh() re-attach it when
// the host has wiped it from the document (jsPsych's run() resets <body>).

import { REPLAY_SAVE_REMINDER } from './errors.js';
import { replaySaveReminderApplies } from './replay-loader.js';

var BADGE_ID = 'ch-debug-badge';
var BADGE_STYLE = 'position:fixed;left:8px;bottom:8px;z-index:2147483646;font:12px/1.4 system-ui;' +
  'background:#111;color:#fff;padding:6px 8px;border-radius:4px;opacity:.9;pointer-events:none';

function idSource(source) {
  if (typeof source === 'string' && source.indexOf('url:') === 0) return source.slice(4);
  if (source === 'attribute') return 'data-participant-id';
  if (source === 'config') return 'CyborgHunterConfig';
  return 'random id (not linkable)';   // 'random', or 'session' (a random id kept from an earlier page)
}

function frictionMode(ctx) {
  if (!ctx.config.guards.friction) return 'off';
  // On jsPsych the entry trial turns enforcement on; otherwise observe-only.
  return ctx.host === 'jspsych' && ctx.jspsych && ctx.jspsych.entryTrialFound ? 'enforce' : 'observe';
}

export function createDebug(opts) {
  var doc = opts.doc, ctx = opts.ctx;
  var log = opts.log || function (m) { console.info(m); };
  var stats = { segmentWriteMs: [] };
  var badge = null;
  var waiting = false;

  function parts(live) {
    // Manual mode (the hand-over in adapters/jspsych.js): ch.js instruments
    // no trial and runs no guard, so there is nothing of its own to count.
    if (ctx.host === 'manual') {
      return ['Cyborg Hunter active', 'manual mode', 'the page\'s cyborg-hunter extension monitors the trials'].join(' · ');
    }
    var hostPart, countPart;
    if (ctx.host === 'vanilla') {
      var marks = doc.querySelectorAll ? doc.querySelectorAll('[data-ch-trial]').length : 0;
      hostPart = 'vanilla mode';
      countPart = marks + ' mark elements';
    } else {
      hostPart = 'jsPsych detected';
      var js = ctx.jspsych || {};
      var written = js.segmentsWritten || 0, planned = js.instrumented || 0;
      if (!live) countPart = planned + ' trials instrumented';
      else if (written > planned) countPart = written + ' trials (' + planned + ' planned)';   // loops repeat one trial object
      else countPart = written + '/' + planned + ' trials';
    }
    var out = ['Cyborg Hunter active', hostPart, countPart,
      'ID from ' + idSource(ctx.participantIdSource),
      'honeypot ' + (ctx.config.guards.honeypot ? 'on' : 'off'),
      'friction ' + frictionMode(ctx)];
    if (!live && replaySaveReminderApplies(ctx)) out.push(REPLAY_SAVE_REMINDER);
    return out.join(' · ');
  }
  function summary() { return parts(false); }
  function badgeText() { return parts(true); }

  function render(text) {
    if (!badge) {
      if (!doc.body) {
        if (!waiting) {
          waiting = true;
          doc.addEventListener('DOMContentLoaded', function () {
            waiting = false;
            try { render(badgeText()); } catch (_) { /* the badge is optional */ }
          }, { once: true });
        }
        return;
      }
      badge = doc.getElementById(BADGE_ID) || doc.createElement('div');
      badge.id = BADGE_ID;
      badge.setAttribute('style', BADGE_STYLE);
    }
    // jsPsych 7 sets display_element.innerHTML in run(), and display_element
    // defaults to <body>, so the badge appended at boot is gone by the first
    // trial. The same node goes back (getElementById no longer finds it, so a
    // lookup would make a second one); under <html> if a page has no <body>.
    if (!badge.isConnected) (doc.body || doc.documentElement).appendChild(badge);
    badge.textContent = text;
  }

  return {
    summary: summary,
    badgeText: badgeText,
    stats: function () { return stats; },
    update: function () {
      try {
        render(badgeText());
        log(summary());
      } catch (_) { /* a debug aid never breaks the page */ }
    },
    // Badge only, no console line (a row was written).
    refresh: function () {
      try { render(badgeText()); } catch (_) { /* a debug aid never breaks the page */ }
    },
    // update() once the DOM is parsed, so vanilla mark elements are all there.
    logWhenParsed: function () {
      try {
        var self = this;
        if (doc.readyState === 'loading' && doc.addEventListener) {
          doc.addEventListener('DOMContentLoaded', function () { self.update(); }, { once: true });
        } else this.update();
      } catch (_) { /* a debug aid never breaks the page */ }
    },
    remove: function () {
      try { if (badge && badge.parentNode) badge.parentNode.removeChild(badge); } catch (_) { /* ignore */ }
      badge = null;
    }
  };
}
