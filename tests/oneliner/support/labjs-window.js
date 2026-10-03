// A happy-dom window with the globals a vendored lab.js build needs, and the
// build loaded into it. Shared by labjs-real.test.js (both generations) and
// usable from any oneliner test that wants real lab.js.
//   createLabWindow({ build }) → { win, lab, generation }
//     build: '20.2.4' or '23.0.0-alpha9' (tests/fixtures/labjs-<build>/lab.js)
//     generation: 'classic' (20.x) | 'flip' (22/23: Component.prototype.lock)
//   closeLabWindow(win)   async: closes it (cancelling its pending frames) and
//                         restores the globals it replaced
//   datastoreOf(study)    study.options.datastore (classic) or the controller's
// Beyond happy-dom's defaults the builds need, found by running them:
//   - window.AudioContext: lab.js's Controller constructs one;
//   - requestAnimationFrame / cancelAnimationFrame / requestIdleCallback;
//   - HTMLAnchorElement and XMLHttpRequest at load (file-saver's checks);
//   - a CanvasRenderingContext2D class, with the fake 2D context an instance
//     of it (23's canvas render checks instanceof); happy-dom's getContext()
//     returns null, so a Proxy of no-op methods stands in;
//   - globalThis.self = win (the UMD build assigns self.lab);
//   - window.Proxy: 20.x calls `new window.Proxy(...)`, and happy-dom's
//     window has none, so the window gets Node's.
// Only DEFINED window globals are copied onto globalThis; copying an undefined
// one (happy-dom lacks several) breaks both builds. Several of the copied names
// are Node's own (fetch, Event, navigator, Blob...), so each global is saved
// before it is replaced and put back on close. The frame and idle stand-ins run
// on the window's timers, so closing the window cancels a frame still pending
// from a study that had not finished.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const COPY = ['document', 'Node', 'MutationObserver', 'HTMLElement', 'Element', 'navigator', 'location',
  'getComputedStyle', 'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'Document', 'EventTarget',
  'screen', 'NodeFilter', 'DOMParser', 'DocumentFragment', 'HTMLCanvasElement', 'HTMLAnchorElement',
  'HTMLFormElement', 'HTMLInputElement', 'HTMLImageElement', 'HTMLAudioElement', 'Image', 'Audio',
  'XMLHttpRequest', 'Blob', 'FormData', 'fetch', 'sessionStorage', 'localStorage'];

class StubResizeObserver { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} }
class FakeContext2D {}

// The globals createLabWindow sets, and their descriptors before it ran
// (undefined when the name did not exist).
const TOUCHED = ['window', 'self', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
  'CanvasRenderingContext2D', ...COPY];
let saved = null;

export function createLabWindow(opts) {
  const build = opts.build;
  const win = new Window({ url: 'https://lab.example/study.html' });
  win.document.body.innerHTML = '<main data-labjs-section="main"></main>';
  if (!saved) saved = new Map(TOUCHED.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of COPY) {
    if (win[k] === undefined) continue;
    try { globalThis[k] = win[k]; } catch { /* read-only in this node version */ }
  }
  globalThis.window = win;
  globalThis.self = win;
  win.Proxy = Proxy;
  globalThis.ResizeObserver = StubResizeObserver;
  win.AudioContext = class { constructor() { this.state = 'running'; } resume() { return Promise.resolve(); } };
  globalThis.requestAnimationFrame = win.requestAnimationFrame = (cb) => win.setTimeout(() => cb(performance.now()), 4);
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame = (id) => win.clearTimeout(id);
  win.requestIdleCallback = (cb) => win.setTimeout(cb, 0);
  win.CanvasRenderingContext2D = globalThis.CanvasRenderingContext2D = FakeContext2D;
  const noop = () => {};
  win.HTMLCanvasElement.prototype.getContext = function () {
    const canvas = this;
    return new Proxy(new FakeContext2D(), {
      get: (t, p) => (p === 'canvas' ? canvas : (p === 'isPointInPath' ? () => false : noop))
    });
  };
  const src = readFileSync(new URL('../../fixtures/labjs-' + build + '/lab.js', import.meta.url), 'utf8');
  vm.runInThisContext(src, { filename: 'lab-' + build + '.js' });
  const lab = win.lab;
  if (!lab || typeof lab.core.Component !== 'function') throw new Error('lab.js ' + build + ' did not define window.lab');
  const generation = typeof lab.core.Component.prototype.lock === 'function' ? 'flip' : 'classic';
  return { win, lab, generation };
}

export async function closeLabWindow(win) {
  try { await win.happyDOM.close(); } catch { /* already closed */ }
  for (const [k, d] of saved || []) {
    try {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    } catch { /* a non-configurable global stays */ }
  }
  saved = null;
}

export function datastoreOf(study) {
  return study.options.datastore || study.internals.controller.global.datastore;
}
