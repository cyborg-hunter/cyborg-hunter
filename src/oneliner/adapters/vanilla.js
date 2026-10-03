// src/oneliner/adapters/vanilla.js
// The vanilla host: any page without jsPsych (and a jsPsych page ch.js could
// not hook, see watchHostPlacement in adapters/jspsych.js). Boundaries come
// from two places, manual marks first:
//   marks       a click on (or inside) an element with data-ch-trial="id",
//               CyborgHunter.mark(id) / startTrial({ trialId }) / endTrial():
//               the open span becomes a 'manual' segment, the next span is
//               named id (or span-<index> without one);
//   page loads  a <form> submit (event or form.submit()) and pagehide: the
//               open span becomes a 'page' segment.
// Each segment becomes one row of a Shape-1 blob, the shape the CLI already
// reads (extract-core.js, Shape 1 + the 5th session convention):
//   { participantId, libraryVersion, cyborgHunterOneLiner: { version, host, pageCount },
//     trials: [{ trialId, integrity, integritySegment, integrityPasteCount,
//                integrityCopyCount, integrityDropCount, integritySoftScore,
//                integrityAnyHardTriggered, cyborgHunterError? }],
//     ...honeypot session summary (when the honeypot is on) }
// The blob reaches the researcher's data two ways: a hidden input named
// cyborgHunterData in the POST form being submitted (not cyborgHunter: raw
// .cyborgHunter is an older CLI convention expecting a session report), and
// CyborgHunter.data(), which closes the current segment first. A GET form
// gets no input: the blob, often megabytes, would go into the URL; its page
// still saves the session for the next page.
//
// Several pages. Every page load runs a new monitor whose performance.now()
// starts at 0 again. The accumulated blob is kept in sessionStorage (per tab;
// not the core's storage helpers, which are localStorage-first and would leak
// into the next participant on a shared browser) under
// cyborg-hunter:oneliner:session:<participantId> (boot.js keeps the id itself
// under cyborg-hunter:oneliner:pid), so the next page continues the
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
// does; form.submit() fires no submit event, so HTMLFormElement.prototype
// .submit is wrapped to do the same work just before the browser's submit
// (see wrappedSubmit).
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
// Listeners go on document and window (and the submit() wrap on the form
// prototype), which exist while ch.js runs in <head>; nothing here needs <body> before a click or a submit. The guards
// (honeypot bait, friction) wait for DOMContentLoaded in guards.js.
//
// installVanillaAdapter({ win, ctx, clock?, warnChars? }) → {
//   blob(), cut(source, nextTrialId?), persist(), restore(), teardown(),
//   noteError(text)   adds a cyborgHunterError note to this and later blobs
// }
//   ctx:        boot's context; gains ctx.handlers.mark / data / startFriction;
//               ctx.replay (data-replay, set later by replay-loader.js) follows
//               every cut and is stopped at pagehide
//   clock:      () => page origin, the segmenter's clock (performance.timeOrigin)
//   warnChars:  persist() warns once above this many characters (4,000,000)
// install restores the saved state first, so the boot span opened after it is
// named after the continued index. Nothing here throws into the page.

import { VERSION } from '../../shared/constants.js';
import { MESSAGES } from '../errors.js';

var KEY_PREFIX = 'cyborg-hunter:oneliner:session:';
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
  var submitted = false;        // this page's span was closed by a submit that replaces the page
  var submitTask = null;        // the submit events of the running task: { events, committed }
  var carrying = false;         // carry() is cutting for a submit
  var warnedSize = false;
  var noticedGet = false;       // the GET-form console.info, once per page
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
    // Any other cut (a mark, CyborgHunter.data()) during a submit's task
    // opens a span the submit did not close: the task's decision no longer
    // applies, and the next pagehide must cut.
    if (!carrying) submitTask = null;
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
      followReplay();
    }
    return r;
  }

  // data-replay: the recorder's trials follow the segments (replay-loader.js
  // sets ctx.replay once the recorder has started; its calls never throw).
  function followReplay() {
    if (!ctx.replay) return;
    ctx.replay.endTrial();
    var state = ctx.segmenter.state();
    if (state.open) ctx.replay.startTrial(state.currentTrialId);
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

  function effectiveMethod(form, submitter) {
    return String((submitter && submitter.formMethod) || form.method || 'get').toLowerCase();
  }

  // Whether the submit replaces this page: its target (the submitter's
  // formtarget, the form's target, then <base target>) is empty, a keyword
  // for this window (_self; _top and _parent unload this page too), or this
  // window's own name. _blank, or a name for another window or a frame,
  // leaves this page where it is. The value is compared as written, as
  // browsers do: " _self " is a window name, not the keyword.
  function replacesPage(form, submitter) {
    var t = null;
    if (submitter && submitter.hasAttribute && submitter.hasAttribute('formtarget')) t = submitter.getAttribute('formtarget');
    if (t === null && form.hasAttribute && form.hasAttribute('target')) t = form.getAttribute('target');
    if (t === null) {
      var base = doc.querySelector ? doc.querySelector('base[target]') : null;
      t = base ? base.getAttribute('target') : '';
    }
    t = String(t || '');
    var keyword = t.toLowerCase();
    if (t === '' || keyword === '_self' || keyword === '_top' || keyword === '_parent') return true;
    return keyword !== '_blank' && t === win.name;
  }

  // The work of a form submit: close the span, save the session, and put the
  // blob into a POST form's hidden input. `cutSpan` false keeps the span as it
  // is (form.submit() called right after a submit event closed it). A dialog
  // submit (method or formmethod "dialog") only closes its <dialog>: the page
  // stays, so it is not a page load and the next pagehide must still cut. A
  // form outside the document submits nothing at all. A submit into another
  // window or a frame posts the blob, but this page stays too, so its
  // pagehide still cuts what comes after. Returns whether the submit
  // replaces this page.
  function submitsAnything(form, submitter) {
    return !form || (effectiveMethod(form, submitter) !== 'dialog' && form.isConnected !== false);
  }
  function carry(form, submitter, cutSpan) {
    if (!submitsAnything(form, submitter)) return false;
    if (cutSpan) {
      carrying = true;
      try { cut('page'); } finally { carrying = false; }
    }
    var replaces = !form || replacesPage(form, submitter);
    submitted = replaces;
    persist();
    if (!form || typeof form.querySelector !== 'function') return replaces;
    var input = form.querySelector('input[name="' + HIDDEN_INPUT + '"]');
    if (effectiveMethod(form, submitter) !== 'post') {
      if (input) input.parentNode.removeChild(input);   // left by an earlier POST submit of this form
      if (!noticedGet) {
        noticedGet = true;
        console.info('[cyborg-hunter] A GET form was submitted: its data does not get cyborgHunterData (it would go into the URL). The session is kept for the next page and CyborgHunter.data().');
      }
      return replaces;
    }
    if (!input) {
      input = doc.createElement('input');
      input.type = 'hidden';
      input.name = HIDDEN_INPUT;
      form.appendChild(input);
    }
    input.value = JSON.stringify(blob());
    return replaces;
  }

  // Capture phase on document: runs before the page's own submit handlers,
  // so a FormData built there already holds the value.
  function onSubmit(ev) {
    try {
      if (!submitsAnything(ev.target, ev.submitter)) return;
      // A cancelled submit (validation) keeps the page, so the next pagehide
      // must cut. Decided once the page's own handlers have run (a bubble
      // listener would miss a page that stops the event's propagation), for
      // every submit event of this task together: the page goes if one of
      // them replaces it and was not cancelled, or if a handler called
      // form.submit() on a form that replaces it. A cut or a back/forward
      // restore in between drops the task (submitTask), and the flag stays
      // as they left it.
      if (!submitTask) {
        var task = submitTask = { events: [], committed: false };
        win.setTimeout(function () {
          if (submitTask !== task) return;
          submitTask = null;
          submitted = task.committed || task.events.some(function (e) {
            return e.replaces && !e.ev.defaultPrevented;
          });
        }, 0);
      }
      var entry = { ev: ev, replaces: false };
      submitTask.events.push(entry);
      entry.replaces = carry(ev.target, ev.submitter, true);
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  // form.submit() fires no submit event. The wrap does the submit's work for
  // that form just before the browser's submit() builds the entry list, so
  // the post carries the blob with this page's open span. When a submit event
  // has just closed the span (a page handler that calls form.submit()), it
  // is not cut again. this, the arguments and the return value pass through,
  // and the browser's submit() always runs. Not covered: submit() on a form
  // in another frame (its own HTMLFormElement.prototype), or a reference to
  // the original submit() the page took before ch.js ran. requestSubmit()
  // and submit buttons do not go through submit(); they fire the event.
  var formProto = win.HTMLFormElement && win.HTMLFormElement.prototype;
  var nativeSubmit = formProto && typeof formProto.submit === 'function' ? formProto.submit : null;
  var active = true;
  function wrappedSubmit() {
    if (active) {
      try {
        // Inside a submit event's task the event has already cut the span.
        var task = submitTask;
        if (carry(this, null, !submitted && !task) && task) task.committed = true;
      } catch (e) {
        console.error(MESSAGES.vanillaEventFailed(message(e)));
      }
    }
    return nativeSubmit.apply(this, arguments);
  }

  // Back/forward cache: see the header. Without a usable record (storage
  // blocked) the page keeps what it had in memory; with a slim one, its
  // trials (earlier pages' and its own) but the record's counters and notes.
  function onPageShow(ev) {
    if (!ev || !ev.persisted) return;
    try {
      submitted = false;
      submitTask = null;
      var saved = readState();
      if (!usable(saved)) return;
      // A slim record (storage full) has no trials: keep the ones in memory.
      if (!saved.storageError) trials = saved.trials.slice();
      adopt(saved);
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  function onPageHide() {
    try {
      if (!submitted) cut('page');
      persist();
      if (ctx.replay) ctx.replay.stop();
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  restore();
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('submit', onSubmit, true);
  if (nativeSubmit) formProto.submit = wrappedSubmit;
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
      active = false;
      if (nativeSubmit && formProto.submit === wrappedSubmit) formProto.submit = nativeSubmit;
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('pageshow', onPageShow);
      delete ctx.handlers.mark;
      delete ctx.handlers.data;
      delete ctx.handlers.startFriction;
    }
  };
}
