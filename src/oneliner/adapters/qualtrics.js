// src/oneliner/adapters/qualtrics.js
// The Qualtrics host: ch.js pasted into a survey's Look & Feel header. There
// is no jsPsych, so boot picks the vanilla host; this module tells boot that
// the page is a Qualtrics survey and which layout it runs, so the debug
// summary, the console messages and the embedded-data writer can name the
// right field.
//
// detectQualtrics(win) → null | { layout: 'new' | 'legacy' }
//   'new'     Qualtrics.SurveyEngine has addOnPageSubmit and setJSEmbeddedData
//             (the New Survey Taking Experience; the value lands in the Survey
//             Flow field __js_cyborg_hunter)
//   'legacy'  addOnPageSubmit and setEmbeddedData but no setJSEmbeddedData
//             (the older layout; the value lands in the field cyborg_hunter)
//   null      anything else: no Qualtrics global, or an object without the
//             page-submit API, which ch.js could not write through anyway
// Nothing here throws into the page: a Qualtrics global whose properties
// throw on access reads as no Qualtrics.
//
// installQualtricsAdapter({ win, ctx, maxChars?, builder?, registerOnce?, writeOnRerun? }) → {
//   write(reason) → null | { payload, written }   payload: what was checked
//                 and handed to Qualtrics (or the error marker); written:
//                 whether the setter took it. null once torn down
//   page()        1 at install, +1 per header re-run (Qualtrics re-renders
//                 the header on every page of the New Survey Taking
//                 Experience; under the legacy layout each page is a new boot)
//   declared()    whether the field reads back: null for now (no probe yet)
//   lastWrite()   null | { chars, cap, level, error? }, the last write the
//                 setter took; chars in UTF-8 bytes, like the cap
//   teardown()
// }
// The writer owns the page boundary, so boot installs the vanilla adapter
// with pageBoundaries: false (its submit and pagehide cuts would leave an
// empty extra segment per page). At each page submit the writer closes the
// open span as a 'page' segment, builds the payload from the vanilla blob
// (qualtrics-payload.js), checks it and writes it.
//
// Qualtrics refuses a submit whose embedded data is too long or malformed,
// and the participant cannot go on, so only a checked string reaches the
// setter: the builder's json, read once, must be a string within the cap in
// UTF-8 bytes (right whether Qualtrics counts characters or bytes) that
// parses to an object. Anything else (the builder threw, no string, not a
// JSON object, over the cap) is logged and replaced by an error marker of a
// fixed shape, a few hundred bytes, measured like any payload: a cap too
// small even for that gets nothing.
//
// One write per submit task: Qualtrics runs every addOnPageSubmit callback
// of a submit in one task, so a callback it kept from an earlier page cannot
// cut and write a second time; a zero-delay timer, or the next page, clears
// the latch. A submit that force-response validation then stops is a task of
// its own, and the submit after it writes again, with what came in between.
// CyborgHunter.data() cuts, writes and returns the checked payload (or the
// marker) on every call, and never takes a submit's write. A failed write is
// logged and noted in the blob, and the survey goes on.
//
// Nothing here throws into the page: the submit callback, the re-run hook
// and data() each end in a catch-all, and the error text, the console calls
// and the note they make cannot throw either.
//
// Two switches are set by checking a live multi-page survey:
//   REGISTER_ONCE   Qualtrics keeps addOnPageSubmit callbacks across pages,
//                   so the hook is registered once, not once per page
//   WRITE_ON_RERUN  the hook registered from the header never fires: each
//                   header re-run writes the page before it, and a
//                   final-page question script calls CyborgHunter.data()
//                   to write the last page
// installQualtricsAdapter also takes registerOnce / writeOnRerun, and a
// builder in place of buildQualtricsPayload, so tests cover both paths and
// every kind of bad builder output whatever the constants and the builder do.

import { VERSION } from '../../shared/constants.js';
import { MESSAGES } from '../errors.js';
import { buildQualtricsPayload } from '../qualtrics-payload.js';

export var FIELD_NAME = 'cyborg_hunter';          // the name passed to setJSEmbeddedData
export var STORED_FIELD = '__js_cyborg_hunter';   // the Survey Flow field (New Survey Taking Experience)
export var LEGACY_FIELD = 'cyborg_hunter';        // the Survey Flow field under the legacy layout (setEmbeddedData)
// The longest serialized payload ch.js writes into one submit, in UTF-8
// bytes. The live limit sits between about 19,900 and 38,000 characters per
// submit and is shared with the survey's own embedded data, so the cap
// leaves headroom.
export var MAX_CHARS = 12000;
export var REGISTER_ONCE = false;
export var WRITE_ON_RERUN = false;
var ID_MAX = 128;    // the error marker's participant id, in UTF-16 code units
var NOTE_MAX = 200;  // an error's text: it becomes a note every later payload carries

export function detectQualtrics(win) {
  try {
    var se = win.Qualtrics && win.Qualtrics.SurveyEngine;
    if (!se || typeof se.addOnPageSubmit !== 'function') return null;
    if (typeof se.setJSEmbeddedData === 'function') return { layout: 'new' };
    if (typeof se.setEmbeddedData === 'function') return { layout: 'legacy' };
    return null;
  } catch (_) {
    return null;
  }
}

// Whatever was thrown: an object without a prototype, or one whose message
// getter throws, has no string form.
function message(e) {
  try { return String((e && e.message) || e).slice(0, NOTE_MAX); } catch (_) { return 'unknown error'; }
}

// The page's console may be broken too; the write never depends on it.
function log(kind, text) {
  try { console[kind](text); } catch (_) { /* nothing left to tell */ }
}

// UTF-8 bytes. A string never has fewer UTF-8 bytes than UTF-16 code units.
function utf8Bytes(s) {
  try { return new TextEncoder().encode(s).length; } catch (_) { return Infinity; }
}

export function installQualtricsAdapter(opts) {
  var win = opts.win, ctx = opts.ctx;
  var maxChars = opts.maxChars || MAX_CHARS;
  var builder = opts.builder || buildQualtricsPayload;
  var registerOnce = opts.registerOnce === undefined ? REGISTER_ONCE : opts.registerOnce;
  var writeOnRerun = opts.writeOnRerun === undefined ? WRITE_ON_RERUN : opts.writeOnRerun;
  var legacy = ctx.qualtricsLayout === 'legacy';
  var page = 1;
  var registeredPage = null;   // the page the last addOnPageSubmit call was for
  var submitting = false;      // this submit task has written
  var warnedPage = null;       // the page the reduced-payload warning was logged on
  var last = null;
  var active = true;
  var vanillaData = ctx.handlers.data;

  function failed(cause) {
    log('error', MESSAGES.qualtricsWriteFailed(cause));
    try { ctx.vanilla.noteError('Qualtrics write failed on page ' + page + ': ' + cause); } catch (_) { /* logged above */ }
  }

  // The builder's result, checked. Each field is read once: a getter could
  // answer differently the second time, and the string checked must be the
  // string written. → { json, payload, bytes, level, full } or { code, detail? }
  function build() {
    var json, level, full;
    try {
      var r = builder({ blob: ctx.vanilla.blob(), maxChars: maxChars });
      if (r !== null && r !== undefined) { json = r.json; level = r.level; full = r.fullChars; }
    } catch (e) {
      return { code: 'build-failed', detail: message(e) };
    }
    if (typeof json !== 'string') return { code: 'no-json' };
    // The length test first: a string far over the cap is neither encoded nor parsed.
    var bytes = json.length > maxChars ? Infinity : utf8Bytes(json);
    if (!(bytes <= maxChars)) return { code: 'over-cap' };
    var payload = null;
    try { payload = JSON.parse(json); } catch (_) { /* below */ }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { code: 'invalid-json' };
    return {
      json: json, payload: payload, bytes: bytes,
      level: typeof level === 'number' && isFinite(level) ? level : null,
      full: typeof full === 'number' && isFinite(full) && full > 0 ? full : undefined
    };
  }

  // Written in place of a payload that failed its check: fixed fields and the
  // participant id without control characters, cut to ID_MAX, so a few
  // hundred bytes at most. Cannot throw.
  function marker(code) {
    var id = '';
    try { id = String(ctx.participantId).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, ID_MAX); } catch (_) { /* no id */ }
    var payload = {
      participantId: id,
      libraryVersion: VERSION,
      cyborgHunterOneLiner: { version: VERSION, host: 'qualtrics', truncated: true, error: code },
      trials: [],
      cyborgHunterError: 'the Qualtrics payload could not be written (' + code + ')'
    };
    var json = JSON.stringify(payload);
    return { json: json, payload: payload, bytes: utf8Bytes(json) };
  }

  function set(json) {
    try {
      var se = win.Qualtrics.SurveyEngine;
      if (legacy) se.setEmbeddedData(LEGACY_FIELD, json);
      else se.setJSEmbeddedData(FIELD_NAME, json);
      return true;
    } catch (e) {
      failed(message(e));
      return false;
    }
  }

  // reason ('submit', 'data', 'rerun') is for reading the code only.
  function write(reason) {
    if (!active) return null;
    try {
      try { ctx.vanilla.cut('page'); } catch (e) {   // { error } alone (no open span): write what exists
        log('error', MESSAGES.vanillaEventFailed(message(e)));
      }
      var b = build();
      if (b.code) {
        failed(b.code + (b.detail ? ': ' + b.detail : ''));
        var m = marker(b.code);
        var ok = m.bytes <= maxChars && set(m.json);
        if (ok) last = { chars: m.bytes, cap: maxChars, level: null, error: b.code };
        return { payload: m.payload, written: ok };
      }
      if (!set(b.json)) return { payload: b.payload, written: false };
      last = { chars: b.bytes, cap: maxChars, level: b.level };
      // After the setter, so a broken console cannot keep the payload back.
      if (b.level > 0 && warnedPage !== page) {
        warnedPage = page;
        log('warn', MESSAGES.qualtricsPayloadReduced(b.level, b.full, maxChars));
      }
      return { payload: b.payload, written: true };
    } catch (_) {
      return null;
    }
  }

  function onPageSubmit() {
    try {
      if (!active) return;
      if (!submitting) {
        submitting = true;
        // Without a timer there is no latch: an extra write beats none.
        try { win.setTimeout(function () { submitting = false; }, 0); } catch (_) { submitting = false; }
        write('submit');
      }
      // Legacy pages are full page loads: the next page's boot restores the
      // session from here (adapters/vanilla.js), so every callback saves,
      // latched or not. Not on the new layout, where the page stays and this
      // would stringify the raw traces at every submit.
      if (legacy) ctx.vanilla.persist();
    } catch (_) { /* never into Qualtrics' submit */ }
  }

  function ensureHook() {
    if (registeredPage !== null && (registerOnce || registeredPage === page)) return;
    try {
      win.Qualtrics.SurveyEngine.addOnPageSubmit(onPageSubmit);
      registeredPage = page;
    } catch (e) {
      log('error', MESSAGES.qualtricsWriteFailed('addOnPageSubmit: ' + message(e)));
    }
  }

  ensureHook();
  // A re-run is the next page, so any submit from here is a new one. With
  // writeOnRerun the page before it is written first, under its own page
  // number.
  ctx.handlers.rerun = function () {
    try {
      if (writeOnRerun) write('rerun');
      page += 1;
      submitting = false;
      ensureHook();
    } catch (_) { /* never into the header's re-run */ }
  };
  ctx.handlers.data = function () {
    try { return write('data').payload; } catch (_) { return marker('build-failed').payload; }
  };

  return {
    write: write,
    page: function () { return page; },
    declared: function () { return null; },
    lastWrite: function () { return last; },
    teardown: function () {
      active = false;   // a hook Qualtrics already holds cannot be removed
      delete ctx.handlers.rerun;
      ctx.handlers.data = vanillaData;
    }
  };
}
