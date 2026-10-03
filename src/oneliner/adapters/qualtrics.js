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

export var FIELD_NAME = 'cyborg_hunter';          // the name passed to setJSEmbeddedData
export var STORED_FIELD = '__js_cyborg_hunter';   // the Survey Flow field (New Survey Taking Experience)
export var LEGACY_FIELD = 'cyborg_hunter';        // the Survey Flow field under the legacy layout (setEmbeddedData)
// The longest serialized payload ch.js writes into one submit. The live limit
// sits between about 19,900 and 38,000 characters per submit and is shared
// with the survey's own embedded data, so the cap leaves headroom.
export var MAX_CHARS = 12000;

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
