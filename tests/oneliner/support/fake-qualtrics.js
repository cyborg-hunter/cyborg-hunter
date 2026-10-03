// A stand-in for Qualtrics.SurveyEngine, as the header script sees it.
// Qualtrics keeps an embedded-data value only when the field is declared in
// Survey Flow, and drops any other write without an error; the fake does the
// same, so a test that forgets the declaration sees an empty POST.
//
// fakeSurveyEngine({ declared, persistCallbacks, layout }) → {
//   SE            the object to put at win.Qualtrics.SurveyEngine
//   store         { [storedField]: string }, declared fields only
//   submitHooks   the live addOnPageSubmit callbacks
//   otherHooks    addOnload / addOnReady / addOnUnload callbacks (never called)
//   submit(type)  runs the hooks with type ('next' by default), returns a copy
//                 of store (what the page's POST carried), then clears the
//                 hooks unless persistCallbacks
//   rerunHeader(win, script)  the header running again on the next page, as
//                 entry.js handles a same-file re-run
//   totalChars()  the summed length of the stored values
// }
// layout 'new': setJSEmbeddedData(name, v) stores '__js_' + name;
//   getJSEmbeddedData(name) reads it back ('' when declared and unset, null
//   when undeclared). layout 'legacy': only setEmbeddedData(name, v), stored
//   under name.
import { markRerun, noteRerun } from '../../../src/oneliner/rerun.js';

export function fakeSurveyEngine({ declared = ['__js_cyborg_hunter'], persistCallbacks = false, layout = 'new' } = {}) {
  const store = {};
  const submitHooks = [];
  const otherHooks = [];
  const keep = (field, v) => { if (declared.includes(field)) store[field] = String(v); };

  const SE = {
    addOnPageSubmit(fn) { submitHooks.push(fn); },
    addOnload(fn) { otherHooks.push(fn); },
    addOnReady(fn) { otherHooks.push(fn); },
    addOnUnload(fn) { otherHooks.push(fn); },
    setEmbeddedData(name, v) { if (layout === 'legacy') keep(name, v); }
  };
  if (layout === 'new') {
    SE.setJSEmbeddedData = (name, v) => keep('__js_' + name, v);
    SE.getJSEmbeddedData = (name) => {
      const field = '__js_' + name;
      if (!declared.includes(field)) return null;
      return field in store ? store[field] : '';
    };
  }

  return {
    SE,
    store,
    submitHooks,
    otherHooks,
    submit(type = 'next') {
      for (const fn of submitHooks.slice()) fn(type);
      const posted = { ...store };
      if (!persistCallbacks) submitHooks.length = 0;
      return posted;
    },
    rerunHeader(win, script) {
      if (!markRerun(win)) throw new Error('rerunHeader: no ch.js of this version runs in this window');
      win.__cyborgHunterRerun = false;   // entry.js resets the flag before noting the re-run
      noteRerun(win, script);
    },
    totalChars() {
      return Object.values(store).reduce((n, v) => n + v.length, 0);
    }
  };
}
