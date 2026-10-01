// src/oneliner/adapters/vanilla.js
// The vanilla host: any page without jsPsych (and a jsPsych page ch.js could
// not hook, see watchHostPlacement in adapters/jspsych.js). Boundaries come
// from two places, manual marks first:
//   marks       a click on (or inside) an element with data-ch-trial="id",
//               CyborgHunter.mark(id) / startTrial({ trialId }) / endTrial():
//               the open span becomes a 'manual' segment, the next span is
//               named id (or span-<index> without one);
//   page loads  a <form> submit and pagehide: the open span becomes a 'page'
//               segment.
// Each segment becomes one row of a Shape-1 blob, the shape the CLI already
// reads (extract-core.js, Shape 1 + the 5th session convention):
//   { participantId, libraryVersion, cyborgHunterOneLiner: { version, host, pageCount },
//     trials: [{ trialId, integrity, integritySegment, integrityPasteCount,
//                integrityCopyCount, integrityDropCount, integritySoftScore,
//                integrityAnyHardTriggered, cyborgHunterError? }],
//     ...honeypot session summary (when the honeypot is on) }
// The blob reaches the researcher's data two ways: a hidden input named
// cyborgHunterData in the form being submitted (not cyborgHunter: raw
// .cyborgHunter is an older CLI convention expecting a session report), and
// CyborgHunter.data(), which closes the current segment first.
//
// Several pages. Every page load runs a new monitor whose performance.now()
// starts at 0 again. The accumulated blob is kept in sessionStorage (per tab;
// not the core's storage helpers, which are localStorage-first and would leak
// into the next participant on a shared browser) under
// cyborg-hunter:oneliner:<participantId>, so the next page continues the
// segment index and the last page's form carries the whole session. Each
// segment records its page origin (performance.timeOrigin); the CLI re-bases
// later pages onto the first page's clock. The honeypot's violation log is
// per page too: each entry carried forward is tagged with its page origin for
// the same re-base.
//
// A form post fires submit and then pagehide. The submit already closed the
// span, so pagehide only persists; without that the post would write an empty
// extra segment. A submit the page cancels (validation) leaves the page
// alive, so pagehide cuts again. form.requestSubmit() fires submit as a click
// does; form.submit() fires no submit event, only formdata (see onFormData).
//
// A page shown again from the back/forward cache (pageshow with persisted)
// keeps its monitor and this adapter's memory from before it was left; it
// re-adopts the saved session, which later pages have added to, so the
// indices continue and its next pagehide cuts again.
//
// When sessionStorage refuses the session (quota), a slim record still keeps
// the segment index and the page count; the next page's blob then carries a
// cyborgHunterError saying the earlier pages are only in their own saves.
// Such notes travel on to every later page (record field `errors`).
//
// Listeners go on document and window, which exist while ch.js runs in
// <head>; nothing here needs <body> before a click or a submit. The guards
// (honeypot bait, friction) wait for DOMContentLoaded in guards.js.
//
// installVanillaAdapter({ win, ctx, clock?, warnChars? }) → {
//   blob(), cut(source, nextTrialId?), persist(), restore(), teardown(),
//   noteError(text)   adds a cyborgHunterError note to this and later blobs
// }
//   ctx:        boot's context; gains ctx.handlers.mark / data / startFriction
//   clock:      () => page origin, the segmenter's clock (performance.timeOrigin)
//   warnChars:  persist() warns once above this many characters (4,000,000)
// install restores the saved state first, so the boot span opened after it is
// named after the continued index. Nothing here throws into the page.

import { VERSION } from '../../shared/constants.js';
import { MESSAGES } from '../errors.js';

var KEY_PREFIX = 'cyborg-hunter:oneliner:';
var WARN_CHARS = 4000000;
var HIDDEN_INPUT = 'cyborgHunterData';
var FULLSCREEN_SETTLE_MS = 100;   // the friction entry trial's own delay before start()

function message(e) { return String((e && e.message) || e); }

function closestAttr(target, attr) {
  return target && typeof target.closest === 'function' ? target.closest('[' + attr + ']') : null;
}

function parseViolations(summary) {
  try {
    var v = JSON.parse((summary && summary.guard_assistance_violations_session) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (_) { return []; }
}

export function installVanillaAdapter(opts) {
  var win = opts.win, ctx = opts.ctx;
  var clock = opts.clock || function () { return performance.timeOrigin; };
  var warnChars = opts.warnChars || WARN_CHARS;
  var key = KEY_PREFIX + ctx.participantId;
  var doc = win.document;

  var trials = [];
  var pageCount = 1;
  var earlierHoneypot = null;   // merged honeypot summary of earlier pages
  var restored = false;
  var submitted = false;        // this page's span was closed by a form submit
  var warnedSize = false;
  var notes = [];               // cyborgHunterError notes, this page's and earlier pages'

  function readState() {
    try {
      var raw = win.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }   // blocked storage or a damaged value: start fresh
  }

  // On failure (usually the quota) a slim record keeps the indices counting.
  function writeState(json) {
    try {
      win.sessionStorage.setItem(key, json);
      return;
    } catch (e) {
      console.error(MESSAGES.storageFailed(message(e)));
    }
    try {
      win.sessionStorage.setItem(key, JSON.stringify({
        segmentIndex: ctx.segmenter.state().segmentIndex,
        pageCount: pageCount,
        trials: [],
        storageError: true,
        errors: notes
      }));
    } catch (_) { /* storage blocked altogether: logged above */ }
  }

  function usable(saved) {
    return !!saved && typeof saved.segmentIndex === 'number' && Array.isArray(saved.trials);
  }

  // Takes over a saved record's counters and notes (not its trials).
  function adopt(saved) {
    pageCount = (typeof saved.pageCount === 'number' ? saved.pageCount : 1) + 1;
    earlierHoneypot = saved.honeypot || null;
    notes = Array.isArray(saved.errors) ? saved.errors.slice() : [];
    if (saved.storageError) {
      notes.push('session storage full on page ' + (pageCount - 1) + '; earlier pages only in their own saves');
    }
    ctx.segmenter.setSegmentIndex(saved.segmentIndex);
  }

  function restore() {
    if (restored) return null;
    restored = true;
    var saved = readState();
    if (!usable(saved)) return null;
    trials = saved.trials.concat(trials);
    adopt(saved);
    return saved;
  }

  // Earlier pages' honeypot summary plus this page's, re-stringified as the
  // honeypot writes it. null when the honeypot is off on this page and no
  // earlier page had it.
  function honeypotSummary() {
    var hp = ctx.config.guards.honeypot ? win.GuardHoneypot : null;
    var current = null;
    if (hp) {
      try { current = hp.getSessionSummary(); } catch (_) { current = null; }
    }
    if (!current) return earlierHoneypot;
    var origin = clock();
    // Earlier entries tagged with this page's origin are this page's own
    // (re-adopted after the back/forward cache); `current` has them all.
    var earlier = parseViolations(earlierHoneypot).filter(function (v) { return v.pageOrigin !== origin; });
    var violations = earlier.concat(parseViolations(current).map(function (v) {
      return Object.assign({}, v, { pageOrigin: origin });
    }));
    var reports = [earlierHoneypot && earlierHoneypot.ai_report_session, current.ai_report_session]
      .filter(function (r) { return typeof r === 'string' && r.length > 0; });
    return {
      guard_assistance_violations_session: JSON.stringify(violations),
      guard_assistance_violation_count_session: violations.length,
      ai_use_session: !!(earlierHoneypot && earlierHoneypot.ai_use_session === true) || current.ai_use_session === true,
      ai_report_session: reports.join('\n')
    };
  }

  function blob() {
    var b = {
      participantId: ctx.participantId,
      libraryVersion: VERSION,
      cyborgHunterOneLiner: { version: VERSION, host: 'vanilla', pageCount: pageCount },
      trials: trials.slice()
    };
    var hp = honeypotSummary();
    if (hp) Object.assign(b, hp);
    if (notes.length) b.cyborgHunterError = notes.join('; ');
    return b;
  }

  // Segmenter contract: a result with `segment` is saved even when it also
  // carries `error` (only the next span failed to open); `error` alone means
  // nothing was cut.
  function cut(source, nextTrialId) {
    // Nothing to cut before the session has started (ch.js in <head>, before
    // DOMContentLoaded) or after a span failed to reopen; the segmenter would
    // log the monitor's lifecycle rejection.
    if (!ctx.segmenter.state().open) return { error: 'no open span' };
    var r;
    try {
      r = ctx.segmenter.cut({ source: source, nextTrialId: nextTrialId || undefined });
    } catch (e) {
      r = { error: message(e) };   // the segmenter does not throw; kept for the host's sake
    }
    if (r && r.segment) {
      var seg = r.segment;
      var row = {
        trialId: seg.trialId,
        integrity: r.trialReport || {},
        integritySegment: seg,
        integrityPasteCount: seg.counters.pasteCount,
        integrityCopyCount: seg.counters.copyCount,
        integrityDropCount: seg.counters.dropCount,
        integritySoftScore: seg.score.softScore,
        integrityAnyHardTriggered: seg.score.anyHardTriggered
      };
      if (r.error) row.cyborgHunterError = r.error;
      trials.push(row);
      submitted = false;
    }
    return r;
  }

  function persist() {
    var json;
    try {
      json = JSON.stringify({
        segmentIndex: ctx.segmenter.state().segmentIndex,
        pageCount: pageCount,
        trials: trials,
        honeypot: honeypotSummary(),
        errors: notes
      });
    } catch (e) {
      console.error(MESSAGES.storageFailed(message(e)));
      return;
    }
    if (json.length > warnChars && !warnedSize) {
      warnedSize = true;
      console.warn(MESSAGES.storageNearlyFull());
    }
    writeState(json);
  }

  // Mirrors the friction entry trial: fullscreen is requested inside the
  // click (the user gesture), enforcement starts once it has settled.
  // observeOnly: false explicitly, since start() keeps an earlier
  // observe-only setting when the option is absent.
  function startFriction() {
    var F = win.GuardFriction;
    if (!F) return;
    if (!ctx.config.guards.friction) console.warn(MESSAGES.frictionStartWithoutFriction());
    try { F.requestFullscreen(); } catch (e) { console.error(MESSAGES.guardFailed('friction', message(e))); }
    win.setTimeout(function () {
      try {
        var token = F.start({ jsPsych: null, observeOnly: false, debug: !!ctx.config.debug });
        Object.defineProperty(win, '_guardFrictionToken', {
          value: token, writable: false, enumerable: false, configurable: true
        });
      } catch (e) {
        console.error(MESSAGES.guardFailed('friction', message(e)));
      }
    }, FULLSCREEN_SETTLE_MS);
  }

  function onClick(ev) {
    try {
      var mark = closestAttr(ev.target, 'data-ch-trial');
      if (mark) cut('manual', mark.getAttribute('data-ch-trial'));
      if (closestAttr(ev.target, 'data-ch-friction-start')) startFriction();
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  // Capture phase on document: runs before the page's own submit handlers,
  // so a FormData built there already holds the value.
  function onSubmit(ev) {
    try {
      var form = ev.target;
      cut('page');
      submitted = true;
      // A cancelled submit (validation) keeps the page, so its next pagehide
      // must cut. Decided once the page's own handlers have run; a bubble
      // listener would miss a page that stops the event's propagation.
      win.setTimeout(function () { if (ev.defaultPrevented) submitted = false; }, 0);
      persist();
      if (!form || typeof form.querySelector !== 'function') return;
      var input = form.querySelector('input[name="' + HIDDEN_INPUT + '"]');
      if (!input) {
        input = doc.createElement('input');
        input.type = 'hidden';
        input.name = HIDDEN_INPUT;
        form.appendChild(input);
      }
      input.value = JSON.stringify(blob());
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  // form.submit() posts without a submit event; building its entry list
  // fires formdata, so the blob goes along (with the segments cut so far:
  // nothing is cut here, since new FormData(form) fires formdata too; the
  // following pagehide cuts and saves this page's last span for the next
  // page). After a submit event the hidden input is already in the list.
  function onFormData(ev) {
    try {
      var fd = ev.formData;
      if (fd && typeof fd.has === 'function' && !fd.has(HIDDEN_INPUT)) fd.set(HIDDEN_INPUT, JSON.stringify(blob()));
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  // Back/forward cache: see the header. Without a usable record (storage
  // blocked) the page keeps what it had in memory.
  function onPageShow(ev) {
    if (!ev || !ev.persisted) return;
    try {
      submitted = false;
      var saved = readState();
      if (!usable(saved)) return;
      trials = saved.trials.slice();
      adopt(saved);
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  function onPageHide() {
    try {
      if (!submitted) cut('page');
      persist();
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  restore();
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('formdata', onFormData, true);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);

  ctx.handlers.mark = function (trialId) { cut('manual', trialId); };
  ctx.handlers.data = function () { cut('manual'); return blob(); };
  ctx.handlers.startFriction = startFriction;

  return {
    blob: blob,
    cut: cut,
    persist: persist,
    restore: restore,
    noteError: function (text) { notes.push(String(text)); },
    teardown: function () {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('submit', onSubmit, true);
      doc.removeEventListener('formdata', onFormData, true);
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('pageshow', onPageShow);
      delete ctx.handlers.mark;
      delete ctx.handlers.data;
      delete ctx.handlers.startFriction;
    }
  };
}
