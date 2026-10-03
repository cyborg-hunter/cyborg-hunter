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
// installQualtricsAdapter({ win, ctx, maxChars? }) → {
//   write(reason) → null | { chars, cap, level, payload }
//   page()        1 at install, +1 per header re-run (Qualtrics re-renders
//                 the header on every page of the New Survey Taking
//                 Experience; under the legacy layout each page is a new boot)
//   declared()    whether the field reads back: null for now (no probe yet)
//   lastWrite()   null | { chars, cap, level }
//   teardown()
// }
// The writer owns the page boundary, so boot installs the vanilla adapter
// with pageBoundaries: false (its submit and pagehide cuts would leave an
// empty extra segment per page). At each page submit the writer closes the
// open span as a 'page' segment, builds the payload from the vanilla blob
// (qualtrics-payload.js) and writes it, never longer than the cap: Qualtrics
// refuses a submit whose embedded data is too long, and the participant
// cannot go on. One write per page: a second call on the same page (a hook
// Qualtrics kept from an earlier page, or CyborgHunter.data() before the
// submit) returns null and touches nothing. A failed write is logged and
// noted in the blob, and the survey goes on. Nothing here throws into the
// page.
//
// Two switches are set by checking a live multi-page survey:
//   REGISTER_ONCE   Qualtrics keeps addOnPageSubmit callbacks across pages,
//                   so the hook is registered once, not once per page
//   WRITE_ON_RERUN  the hook registered from the header never fires: each
//                   header re-run writes the page before it, and a
//                   final-page question script calls CyborgHunter.data()
//                   to write the last page
// installQualtricsAdapter also takes registerOnce / writeOnRerun, so tests
// cover both paths whatever the constants say.

import { MESSAGES } from '../errors.js';
import { buildQualtricsPayload } from '../qualtrics-payload.js';

export var FIELD_NAME = 'cyborg_hunter';          // the name passed to setJSEmbeddedData
export var STORED_FIELD = '__js_cyborg_hunter';   // the Survey Flow field (New Survey Taking Experience)
export var LEGACY_FIELD = 'cyborg_hunter';        // the Survey Flow field under the legacy layout (setEmbeddedData)
// The longest serialized payload ch.js writes into one submit. The live limit
// sits between about 19,900 and 38,000 characters per submit and is shared
// with the survey's own embedded data, so the cap leaves headroom.
export var MAX_CHARS = 12000;
export var REGISTER_ONCE = false;
export var WRITE_ON_RERUN = false;

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

function message(e) { return String((e && e.message) || e); }

export function installQualtricsAdapter(opts) {
  var win = opts.win, ctx = opts.ctx;
  var maxChars = opts.maxChars || MAX_CHARS;
  var registerOnce = opts.registerOnce === undefined ? REGISTER_ONCE : opts.registerOnce;
  var writeOnRerun = opts.writeOnRerun === undefined ? WRITE_ON_RERUN : opts.writeOnRerun;
  var legacy = ctx.qualtricsLayout === 'legacy';
  var page = 1;
  var writtenPage = null;      // the page whose one write is used up
  var registeredPage = null;   // the page the last addOnPageSubmit call was for
  var last = null;
  var active = true;
  var vanillaData = ctx.handlers.data;

  function build() {
    return buildQualtricsPayload({ blob: ctx.vanilla.blob(), maxChars: maxChars });
  }

  function failed(msg) {
    console.error(MESSAGES.qualtricsWriteFailed(msg));
    ctx.vanilla.noteError('Qualtrics write failed on page ' + page + ': ' + msg);
  }

  // reason ('submit:next', 'data', 'rerun') is for reading the code only.
  function write(reason) {
    if (!active || writtenPage === page) return null;
    writtenPage = page;   // a failed write uses up the page's write too
    var result = null;
    try {
      ctx.vanilla.cut('page');   // { error } alone (no open span): write what exists
      var b = build();
      if (b.chars > maxChars) {
        failed('payload over cap after reduction');
      } else {
        if (b.level > 0) {
          // The message names the size before reduction; only this slow
          // path pays for the second build.
          var full = buildQualtricsPayload({ blob: ctx.vanilla.blob(), maxChars: Infinity }).chars;
          console.warn(MESSAGES.qualtricsPayloadReduced(b.level, full, maxChars));
        }
        var se = win.Qualtrics.SurveyEngine;
        if (legacy) se.setEmbeddedData(LEGACY_FIELD, b.json);
        else se.setJSEmbeddedData(FIELD_NAME, b.json);
        last = { chars: b.chars, cap: maxChars, level: b.level };
        result = { chars: b.chars, cap: maxChars, level: b.level, payload: b.payload };
      }
    } catch (e) {
      failed(message(e));
    }
    // Legacy pages are full page loads: the next page's boot restores the
    // session from here (adapters/vanilla.js). Not on the new layout, where
    // the page stays and this would stringify the raw traces at every submit.
    if (legacy) ctx.vanilla.persist();
    return result;
  }

  function onPageSubmit(type) {
    write('submit:' + type);
  }

  function ensureHook() {
    if (registeredPage !== null && (registerOnce || registeredPage === page)) return;
    try {
      win.Qualtrics.SurveyEngine.addOnPageSubmit(onPageSubmit);
      registeredPage = page;
    } catch (e) {
      console.error(MESSAGES.qualtricsWriteFailed('addOnPageSubmit: ' + message(e)));
    }
  }

  ensureHook();
  // A re-run is the next page. With writeOnRerun the page before it is
  // written first, under its own page number, so the new page keeps its
  // write for CyborgHunter.data() on the final page.
  ctx.handlers.rerun = function () {
    if (writeOnRerun) write('rerun');
    page += 1;
    writtenPage = null;
    ensureHook();
  };
  ctx.handlers.data = function () {
    var r = write('data');
    return r ? r.payload : build().payload;
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
