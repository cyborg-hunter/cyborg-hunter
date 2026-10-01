// src/oneliner/debug.js
// data-debug: a small fixed badge on the page, one console line per update,
// and the segment-write timings a later perf budget reads. Off by default;
// the docs say to remove it before launch, because participants can see it.
// boot only creates this when config.debug is on, so a page without
// data-debug pays nothing (no badge, no counters, no timing calls).
//
// createDebug({ doc, ctx, log = console.info })
//   → { update(), summary() → string, stats() → { segmentWriteMs }, remove() }
//
// summary():
//   Cyborg Hunter active · <jsPsych detected | vanilla mode> ·
//   <N trials instrumented | N mark elements> · ID from <source> ·
//   honeypot <on|off> · friction <off|observe|enforce>
//   N on jsPsych is the number of rows that got a segment so far
//   (ctx.jspsych.segmentsWritten), not the number of trial objects.
//   <source> is the URL parameter name that resolved, data-participant-id,
//   CyborgHunterConfig, or "random id (not linkable)".
//
// The badge never takes focus or clicks (pointer-events: none) and nothing
// here throws into the host page.

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

  function summary() {
    var hostPart, countPart;
    if (ctx.host === 'vanilla') {
      var marks = doc.querySelectorAll ? doc.querySelectorAll('[data-ch-trial]').length : 0;
      hostPart = 'vanilla mode';
      countPart = marks + ' mark elements';
    } else {
      hostPart = 'jsPsych detected';
      countPart = ((ctx.jspsych && ctx.jspsych.segmentsWritten) || 0) + ' trials instrumented';
    }
    return ['Cyborg Hunter active', hostPart, countPart,
      'ID from ' + idSource(ctx.participantIdSource),
      'honeypot ' + (ctx.config.guards.honeypot ? 'on' : 'off'),
      'friction ' + frictionMode(ctx)].join(' · ');
  }

  function render(text) {
    if (!badge) {
      if (!doc.body) {
        if (!waiting) {
          waiting = true;
          doc.addEventListener('DOMContentLoaded', function () {
            waiting = false;
            try { render(summary()); } catch (_) { /* the badge is optional */ }
          }, { once: true });
        }
        return;
      }
      badge = doc.getElementById(BADGE_ID) || doc.createElement('div');
      badge.id = BADGE_ID;
      badge.setAttribute('style', BADGE_STYLE);
      if (!badge.parentNode) doc.body.appendChild(badge);
    }
    badge.textContent = text;
  }

  return {
    summary: summary,
    stats: function () { return stats; },
    update: function () {
      try {
        var text = summary();
        render(text);
        log(text);
      } catch (_) { /* a debug aid never breaks the page */ }
    },
    remove: function () {
      try { if (badge && badge.parentNode) badge.parentNode.removeChild(badge); } catch (_) { /* ignore */ }
      badge = null;
    }
  };
}
