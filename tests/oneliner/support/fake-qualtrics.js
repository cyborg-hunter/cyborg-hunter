// A stand-in for Qualtrics.SurveyEngine, as the header script sees it.
// Qualtrics keeps an embedded-data value only when the field is declared in
// Survey Flow, and drops any other write without an error; the fake does the
// same, so a test that forgets the declaration sees an empty POST.
//
// fakeSurveyEngine({ declared, persistCallbacks, layout, headerHooks }) → {
//   SE            the object to put at win.Qualtrics.SurveyEngine
//   store         { [storedField]: string }, declared fields only
//   submitHooks   the live addOnPageSubmit callbacks
//   otherHooks    addOnload / addOnReady / addOnUnload callbacks (never called)
//   submit(type, { blocked })  runs the hooks with type ('next' by default),
//                 returns a copy of store (what the page's POST carried), then
//                 clears the hooks unless persistCallbacks. blocked: the
//                 page's validation (force response) stops the submit after
//                 the hooks ran, so nothing is posted (null) and the page
//                 keeps its hooks
//   runHeader(fn)  runs fn as the header's code: boot, in the tests
//   rerunHeader(win, script)  the header running again on the next page, as
//                 entry.js handles a same-file re-run
//   totalChars()  the summed length of the stored values
// }
// layout 'new': setJSEmbeddedData(name, v) stores '__js_' + name;
//   getJSEmbeddedData(name) reads it back ('' when declared and unset, null
//   when undeclared). layout 'legacy': only setEmbeddedData(name, v), stored
//   under name, and getEmbeddedData(name), read back the same way.
// headerHooks false: an addOnPageSubmit call made from the header (inside
//   runHeader or rerunHeader) is accepted and never fires, the case the
//   write-on-re-run fallback is for; a question script's call still does.
import { markRerun, noteRerun } from '../../../src/oneliner/rerun.js';

export function fakeSurveyEngine({ declared = ['__js_cyborg_hunter'], persistCallbacks = false, layout = 'new', headerHooks = true } = {}) {
  const store = {};
  const submitHooks = [];
  const otherHooks = [];
  let inHeader = false;
  const keep = (field, v) => { if (declared.includes(field)) store[field] = String(v); };
  const read = (field) => {
    if (!declared.includes(field)) return null;
    return field in store ? store[field] : '';
  };
  const asHeader = (fn) => {
    inHeader = true;
    try { return fn(); } finally { inHeader = false; }
  };

  const SE = {
    addOnPageSubmit(fn) { if (headerHooks || !inHeader) submitHooks.push(fn); },
    addOnload(fn) { otherHooks.push(fn); },
    addOnReady(fn) { otherHooks.push(fn); },
    addOnUnload(fn) { otherHooks.push(fn); },
    setEmbeddedData(name, v) { if (layout === 'legacy') keep(name, v); }
  };
  if (layout === 'new') {
    SE.setJSEmbeddedData = (name, v) => keep('__js_' + name, v);
    SE.getJSEmbeddedData = (name) => read('__js_' + name);
  } else {
    SE.getEmbeddedData = (name) => read(name);
  }

  return {
    SE,
    store,
    submitHooks,
    otherHooks,
    submit(type = 'next', { blocked = false } = {}) {
      for (const fn of submitHooks.slice()) fn(type);
      if (blocked) return null;
      const posted = { ...store };
      if (!persistCallbacks) submitHooks.length = 0;
      return posted;
    },
    runHeader: asHeader,
    rerunHeader(win, script) {
      if (!markRerun(win)) throw new Error('rerunHeader: no ch.js of this version runs in this window');
      win.__cyborgHunterRerun = false;   // entry.js resets the flag before noting the re-run
      asHeader(() => noteRerun(win, script));
    },
    totalChars() {
      return Object.values(store).reduce((n, v) => n + v.length, 0);
    }
  };
}
