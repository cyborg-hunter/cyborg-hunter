// The lab.js host adapter's pure parts: detection, placement diagnosis, the
// trial rules and trial naming. Plain objects stand in for lab.js components;
// labjs-real.test.js covers the real builds.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { detectLabJs, watchLabJsPlacement } from '../../src/oneliner/adapters/labjs.js';
import { MESSAGES } from '../../src/oneliner/errors.js';

function fakeLab(opts) {
  class Component { run() {} end() {} }
  if (opts && opts.flip) Component.prototype.lock = function () {};
  return { version: (opts && opts.version) || '20.2.4', core: { Component }, flow: {}, html: {} };
}

let errors, warns, orig;
beforeEach(() => {
  errors = []; warns = [];
  orig = { error: console.error, warn: console.warn };
  console.error = (m) => errors.push(String(m));
  console.warn = (m) => warns.push(String(m));
});
afterEach(() => { console.error = orig.error; console.warn = orig.warn; });

describe('detectLabJs', () => {
  it('finds the global, its version and the classic generation', () => {
    const lab = fakeLab();
    const d = detectLabJs({ lab });
    assert.strictEqual(d.lab, lab);
    assert.strictEqual(d.version, '20.2.4');
    assert.strictEqual(d.generation, 'classic');
  });
  it('a Component prototype with lock() is the flip generation; a missing version reads unknown', () => {
    const lab = fakeLab({ flip: true, version: undefined });
    delete lab.version;
    assert.deepStrictEqual(detectLabJs({ lab }), { lab, version: 'unknown', generation: 'flip' });
  });
  it('returns null without the global, without core.Component, or when the global throws on access', () => {
    assert.strictEqual(detectLabJs({}), null);
    assert.strictEqual(detectLabJs({ lab: { version: '1' } }), null);
    assert.strictEqual(detectLabJs({ lab: { core: { Component: 42 } } }), null);
    const win = {};
    Object.defineProperty(win, 'lab', { get() { throw new Error('locked'); } });
    assert.strictEqual(detectLabJs(win), null);
  });
});

describe('watchLabJsPlacement', () => {
  let win;
  beforeEach(() => { win = new Window({ url: 'https://lab.example/study.html' }); });
  afterEach(() => win.close());

  it('a lab global that appears by DOMContentLoaded: loadedAboveLabJs, once', () => {
    const ctx = { host: 'vanilla' };
    const doc = win.document;
    Object.defineProperty(doc, 'readyState', { configurable: true, get: () => 'loading' });
    watchLabJsPlacement({ win, doc, ctx });
    assert.deepStrictEqual(errors, []);
    win.lab = fakeLab();
    doc.dispatchEvent(new win.Event('DOMContentLoaded'));
    doc.dispatchEvent(new win.Event('DOMContentLoaded'));
    assert.deepStrictEqual(errors, [MESSAGES.loadedAboveLabJs()]);
  });
  it('no global but a data-labjs-section element: labjsNotHookable', () => {
    win.document.body.innerHTML = '<main data-labjs-section="main"></main>';
    watchLabJsPlacement({ win, doc: win.document, ctx: { host: 'vanilla' } });   // DOM already parsed: checks now
    assert.deepStrictEqual(errors, [MESSAGES.labjsNotHookable()]);
  });
  it('a plain page says nothing; so do a failed boot and a page that stopped being vanilla', () => {
    watchLabJsPlacement({ win, doc: win.document, ctx: { host: 'vanilla' } });
    win.lab = fakeLab();
    watchLabJsPlacement({ win, doc: win.document, ctx: { host: 'vanilla', bootError: 'x' } });
    watchLabJsPlacement({ win, doc: win.document, ctx: { host: 'labjs' } });
    assert.deepStrictEqual(errors, []);
  });
});
