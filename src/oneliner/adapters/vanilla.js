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
// alive, so pagehide cuts again. So does a submit whose navigation never
// commits (a 204 answer, a download, a javascript: action, a beforeunload
// "Stay"), which nothing on the page announces: once the span the submit
// opened holds anything the participant did (segmenter holdsEvidence()),
// pagehide and form.submit() cut it whatever the submit decided.
// form.requestSubmit() fires submit as a click does; form.submit() fires no
// submit event, so HTMLFormElement.prototype.submit is wrapped to do the
// same work just before the browser's submit (see wrappedSubmit).
//
// The page's own submit handlers run after ch.js's and may still change the
// form's method or target; the browser reads both after them, building the
// entry list (the formdata event) in between. onFormData puts the blob into
// that entry list, or takes it out, by the method the browser will use, and
// notes whether the form still replaces this page.
//
// A page shown again from the back/forward cache (pageshow with persisted)
// keeps its monitor and this adapter's memory from before it was left; it
// re-adopts the saved session, which later pages have added to, so the
// indices continue and its next pagehide cuts again. With data-replay the
// recorder, stopped at pagehide, records again: the same recording goes on
// with a keyframe segment marked as a back/forward-cache restore (see
// restore() in replay-loader.js), named after the open span.
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
//               every cut, is stopped at pagehide and restored at a
//               back/forward-cache pageshow
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
  var submittingForm = null;    // the form whose form.submit() is running (wrappedSubmit)
  var cuts = 0;                 // segments cut so far on this page
  var written = null;           // the hidden input carry() last wrote: { form, cuts (when) }
  var floor = 0;                // evidence the span a submit opened held when the submit's task ended
  var floorTask = null;         // that task has not ended yet (settleFloorLater)
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
      cuts += 1;
      submitted = false;
      floor = 0;
      floorTask = null;
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

  // A form's attributes are read through Element.prototype: a control named
  // "method" in the form shadows form.method, and one named "getAttribute"
  // or "hasAttribute" shadows that method. null when the attribute is absent
  // (or the node is not an element).
  var elementGetAttribute = win.Element && win.Element.prototype.getAttribute;
  function attr(node, name) {
    try { return elementGetAttribute.call(node, name); } catch (_) { return null; }
  }

  // A value other than post or dialog is a GET.
  function effectiveMethod(form, submitter) {
    return String((submitter && submitter.formMethod) || attr(form, 'method') || 'get').toLowerCase();
  }

  // Whether the submit replaces this page: its target (the submitter's
  // formtarget, the form's target, then <base target>) is empty, a keyword
  // for this window (_self; _top and _parent unload this page too), or this
  // window's own name. _blank, or a name for another window or a frame,
  // leaves this page where it is. The value is compared as written, as
  // browsers do: " _self " is a window name, not the keyword.
  function replacesPage(form, submitter) {
    var t = submitter ? attr(submitter, 'formtarget') : null;
    if (t === null) t = attr(form, 'target');
    if (t === null) {
      var base = doc.querySelector ? doc.querySelector('base[target]') : null;
      t = base ? base.getAttribute('target') : '';
    }
    t = String(t || '');
    var keyword = t.toLowerCase();
    if (t === '' || keyword === '_self' || keyword === '_top' || keyword === '_parent') return true;
    return keyword !== '_blank' && t === win.name;
  }

  // The event that made the page submit goes on after the cut, in the same
  // task: the click that a page's own onclick handler answered with
  // form.submit() reaches the document's listeners, a checkbox's input and
  // change events follow its click. What it adds to the span the submit
  // opened is the submit's own, not something the participant did on a page
  // that stayed, so the evidence that span holds when the task ends is its
  // floor, and only what comes later counts (actedSinceSubmit()).
  function settleFloorLater() {
    var token = floorTask = {};
    win.setTimeout(function () {
      if (floorTask !== token) return;
      floorTask = null;
      var n = ctx.segmenter.evidence();
      floor = isFinite(n) ? n : 0;   // unreadable: everything counts
    }, 0);
  }

  // Whether the span a same-window submit opened holds something the
  // participant did after that submit's task (see settleFloorLater).
  function actedSinceSubmit() {
    return !floorTask && ctx.segmenter.holdsEvidence(floor);
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
      try { if (cut('page').segment) settleFloorLater(); } finally { carrying = false; }
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
    written = { form: form, cuts: cuts };
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
      // them leaves (see leaves()), or if a handler called form.submit() on
      // a form that replaces it. A cut or a back/forward restore in between
      // drops the task (submitTask), and the flag stays as they left it.
      if (!submitTask) {
        var task = submitTask = { events: [], committed: false };
        win.setTimeout(function () {
          if (submitTask !== task) return;
          submitTask = null;
          submitted = task.committed || task.events.some(leaves);
        }, 0);
      }
      // `final`: whether the form replaces this page as the browser read it
      // (onFormData), null until then.
      submitTask.events.push({ ev: ev, form: ev.target, submitter: ev.submitter || null, final: null });
      carry(ev.target, ev.submitter, true);
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  // Whether one submit event of a task replaced the page. Not when the page
  // cancelled it, nor when the page dispatched it itself (isTrusted false):
  // its handlers run and may read the blob, but Chromium and WebKit submit
  // nothing for it. Firefox still sends the form; the pagehide that follows
  // then closes one extra, empty segment. Nothing is lost either way.
  // Otherwise by the form's method and target after the page's handlers:
  // as the browser read them (onFormData), or, when no formdata event came
  // (a browser without one), as they are now.
  function leaves(e) {
    if (e.ev.isTrusted === false || e.ev.defaultPrevented) return false;
    if (e.final !== null) return e.final;
    return submitsAnything(e.form, e.submitter) && replacesPage(e.form, e.submitter);
  }

  // The formdata event of a submission ch.js saw: the browser is building
  // its entry list, after the page's submit handlers ran and before it reads
  // the method and target (the HTML form submission algorithm). The entry
  // list gets the blob when the method is POST, and loses it otherwise (a
  // handler turned the POST into a GET: the blob would go into the URL);
  // the blob is rebuilt when a segment was cut since carry() wrote it. Only
  // while form.submit() runs (its formdata event is that form's, with no
  // submitter) or for a form with a submit event in the running task: any
  // other formdata event, a FormData the page builds itself, is left alone.
  function onFormData(ev) {
    try {
      var form = ev.target, submitter = null;
      if (!submittingForm) {
        var entry = null;
        var events = submitTask ? submitTask.events : [];
        for (var i = events.length - 1; i >= 0 && !entry; i--) if (events[i].form === form) entry = events[i];
        if (!entry) return;
        submitter = entry.submitter;
        entry.final = submitsAnything(form, submitter) && replacesPage(form, submitter);
      }
      var fd = ev.formData;
      if (!fd || typeof fd.set !== 'function') return;
      if (submitsAnything(form, submitter) && effectiveMethod(form, submitter) === 'post') {
        var fresh = written && written.form === form && written.cuts === cuts;
        if (!fresh || !fd.has(HIDDEN_INPUT)) fd.set(HIDDEN_INPUT, JSON.stringify(blob()));
      } else if (fd.has(HIDDEN_INPUT)) {
        fd.delete(HIDDEN_INPUT);
        var input = form.querySelector('input[name="' + HIDDEN_INPUT + '"]');
        if (input) input.parentNode.removeChild(input);
      }
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  // form.submit() fires no submit event. The wrap does the submit's work for
  // that form just before the browser's submit() builds the entry list, so
  // the post carries the blob with this page's open span. When a submit event
  // has just closed the span (a page handler that calls form.submit()), it
  // is not cut again. Neither is the span a same-window submit opened while
  // it holds nothing the participant did: that submit's navigation may still
  // be under way. this, the arguments and the return value pass through,
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
        var cutSpan = !task && (!submitted || actedSinceSubmit());
        if (carry(this, null, cutSpan) && task) task.committed = true;
      } catch (e) {
        console.error(MESSAGES.vanillaEventFailed(message(e)));
      }
    }
    var outer = submittingForm;
    submittingForm = this;
    try {
      return nativeSubmit.apply(this, arguments);
    } finally {
      submittingForm = outer;
    }
  }

  // Back/forward cache: see the header. Without a usable record (storage
  // blocked) the page keeps what it had in memory; with a slim one, its
  // trials (earlier pages' and its own) but the record's counters and notes.
  function onPageShow(ev) {
    if (!ev || !ev.persisted) return;
    try {
      submitted = false;
      submitTask = null;
      floor = 0;
      floorTask = null;
      var saved = readState();
      if (usable(saved)) {
        // A slim record (storage full) has no trials: keep the ones in memory.
        if (!saved.storageError) trials = saved.trials.slice();
        adopt(saved);
      }
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
    // After the integrity state, and whatever became of it: restore() logs
    // its own failures and never throws. The restored segment is named after
    // the open span, as followReplay names them; with no open span (it
    // failed to reopen at the cut) currentTrialId still names the closed
    // one, so the segment gets no name rather than that one, and keeps its
    // marker and keyframe.
    if (ctx.replay) {
      var state = ctx.segmenter.state();
      ctx.replay.restore(state.open ? state.currentTrialId : null);
    }
  }

  // After a same-window submit the span is cut only when it holds something
  // the participant did: the navigation may never have committed (see the
  // header), and an empty one would only add a segment.
  function onPageHide() {
    try {
      if (!submitted || actedSinceSubmit()) cut('page');
      persist();
      if (ctx.replay) ctx.replay.stop();
    } catch (e) {
      console.error(MESSAGES.vanillaEventFailed(message(e)));
    }
  }

  restore();
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('formdata', onFormData, true);
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
      doc.removeEventListener('formdata', onFormData, true);
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
