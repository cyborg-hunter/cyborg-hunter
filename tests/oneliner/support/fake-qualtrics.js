// A stand-in for Qualtrics.SurveyEngine, as the header script sees it.
// Qualtrics keeps an embedded-data value only when the field is declared in
// Survey Flow, and drops any other write without an error; the fake does the
// same, so a test that forgets the declaration sees an empty POST.
// The page itself cannot tell: setJSEmbeddedData puts every value in a
// client-side object, and getJSEmbeddedData reads that object back, declared
// or not (checked on a live survey, 2026-10-05). The live POST carries every
// value the page set; Qualtrics stores the declared ones.
//
// fakeSurveyEngine({ declared, persistCallbacks, layout, headerHooks }) → {
//   SE            the object to put at win.Qualtrics.SurveyEngine
//   store         { [storedField]: string }, declared fields only
//   submitHooks   the live addOnPageSubmit callbacks
//   otherHooks    addOnload / addOnReady / addOnUnload callbacks (never called)
//   submit(type, { blocked })  runs the hooks with type ('next' by default),
//                 returns a copy of store (what Qualtrics kept from the
//                 page's POST: the declared fields), then
//                 clears the hooks unless persistCallbacks. blocked: the
//                 page's validation (force response) stops the submit after
//                 the hooks ran, so nothing is posted (null) and the page
//                 keeps its hooks
//   runHeader(fn)  runs fn as the header's code: boot, in the tests
//   rerunHeader(win, script)  the header running again on the next page, as
//                 entry.js handles a same-file re-run
//   totalChars()  the summed length of the stored values
// }
// layout 'new': setJSEmbeddedData(name, v) stores '__js_' + name when that
//   field is declared; getJSEmbeddedData(name) returns the value the page
//   last set under name, declared or not (undefined before any). layout
//   'legacy': only setEmbeddedData(name, v), stored under name, and
//   getEmbeddedData(name), read back the same way (the legacy getter is not
//   checked on a live survey; ch.js does not read it).
// headerHooks false: an addOnPageSubmit call made from the header (inside
//   runHeader or rerunHeader) is accepted and never fires, the case the
//   write-on-re-run fallback is for; a question script's call still does.
import { markRerun, noteRerun } from '../../../src/oneliner/rerun.js';

export function fakeSurveyEngine({ declared = ['__js_cyborg_hunter'], persistCallbacks = false, layout = 'new', headerHooks = true } = {}) {
  const store = {};
  const ed = {};   // the page's own copy of every value it set
  const submitHooks = [];
  const otherHooks = [];
  let inHeader = false;
  const keep = (field, v) => { if (declared.includes(field)) store[field] = String(v); };
  const set = (name, field, v) => { ed[name] = v; keep(field, v); };
  const read = (name) => ed[name];
  const asHeader = (fn) => {
    inHeader = true;
    try { return fn(); } finally { inHeader = false; }
  };

  const SE = {
    addOnPageSubmit(fn) { if (headerHooks || !inHeader) submitHooks.push(fn); },
    addOnload(fn) { otherHooks.push(fn); },
    addOnReady(fn) { otherHooks.push(fn); },
    addOnUnload(fn) { otherHooks.push(fn); },
    setEmbeddedData(name, v) { if (layout === 'legacy') set(name, name, v); }
  };
  if (layout === 'new') {
    SE.setJSEmbeddedData = (name, v) => set(name, '__js_' + name, v);
    SE.getJSEmbeddedData = (name) => read(name);
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
