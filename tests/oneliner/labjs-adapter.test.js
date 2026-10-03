// The lab.js host adapter's pure parts: detection, placement diagnosis, the
// trial rules and trial naming. Plain objects stand in for lab.js components;
// labjs-real.test.js covers the real builds.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { detectLabJs, watchLabJsPlacement, isContainer, isTrial, idOf, datastoreOf, trialOptions } from '../../src/oneliner/adapters/labjs.js';
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
  it('a plain page says nothing; neither does a failed boot or a host that is not vanilla', () => {
    watchLabJsPlacement({ win, doc: win.document, ctx: { host: 'vanilla' } });
    win.lab = fakeLab();
    watchLabJsPlacement({ win, doc: win.document, ctx: { host: 'vanilla', bootError: 'x' } });
    watchLabJsPlacement({ win, doc: win.document, ctx: { host: 'labjs' } });
    assert.deepStrictEqual(errors, []);
  });
  // The tag above a builder export's lib/lab.js: by DOMContentLoaded the page
  // has both the global and the section. The global decides.
  it('both the global and a data-labjs-section element: loadedAboveLabJs only', () => {
    win.document.body.innerHTML = '<main data-labjs-section="main"></main>';
    win.lab = fakeLab();
    watchLabJsPlacement({ win, doc: win.document, ctx: { host: 'vanilla' } });
    assert.deepStrictEqual(errors, [MESSAGES.loadedAboveLabJs()]);
  });
  it('a host that changes, or a boot that fails, between registering and DOMContentLoaded: nothing', () => {
    const doc = win.document;
    Object.defineProperty(doc, 'readyState', { configurable: true, get: () => 'loading' });
    const changed = { host: 'vanilla' };
    const failed = { host: 'vanilla' };
    watchLabJsPlacement({ win, doc, ctx: changed });
    watchLabJsPlacement({ win, doc, ctx: failed });
    win.lab = fakeLab();
    changed.host = 'labjs';
    failed.bootError = 'x';
    doc.dispatchEvent(new win.Event('DOMContentLoaded'));
    assert.deepStrictEqual(errors, []);
  });
  it('never throws, whatever it is given', () => {
    assert.doesNotThrow(() => watchLabJsPlacement());
    assert.doesNotThrow(() => watchLabJsPlacement({ win, ctx: { host: 'vanilla' } }));
    assert.doesNotThrow(() => watchLabJsPlacement({ win, doc: null, ctx: { host: 'vanilla' } }));
    const doc = {};
    Object.defineProperty(doc, 'readyState', { get() { throw new Error('locked'); } });
    assert.doesNotThrow(() => watchLabJsPlacement({ win, doc, ctx: { host: 'vanilla' } }));
    assert.deepStrictEqual(errors, []);
  });
});

// A stand-in component: `meta` is constructor.metadata, `parent` the tree link.
function comp(opts) {
  class Fake {}
  Fake.metadata = { module: ['x'], nestedComponents: (opts && opts.nested) || [] };
  const c = new Fake();
  c.options = Object.assign({ id: null, parameters: {} }, (opts && opts.options) || {});
  c.internals = (opts && opts.internals) || {};
  c.parent = (opts && opts.parent) || undefined;
  c.data = {};
  if (opts && 'id' in opts) Object.defineProperty(c, 'id', { get: opts.id });
  if (opts && opts.aggregateParameters) Object.defineProperty(c, 'aggregateParameters', { get: () => opts.aggregateParameters });
  return c;
}
class Parallel {}
const labWithParallel = { flow: { Parallel } };

describe('trial rules', () => {
  it('a leaf is a trial; a container is not; a skipped leaf is decided by the caller from data.ended_on', () => {
    assert.strictEqual(isContainer(comp({ nested: ['content'] })), true);
    assert.strictEqual(isContainer(comp()), false);
    assert.strictEqual(isTrial(comp(), labWithParallel), true);
    assert.strictEqual(isTrial(comp({ nested: ['content'] }), labWithParallel), false);
  });
  it('a Parallel is the trial and its descendants are not', () => {
    const par = new Parallel();
    par.options = { id: '2' }; par.internals = {}; par.data = {};
    assert.strictEqual(isTrial(par, labWithParallel), true);
    const child = comp({ parent: par });
    const grandchild = comp({ parent: comp({ nested: ['content'], parent: par }) });
    assert.strictEqual(isTrial(child, labWithParallel), false);
    assert.strictEqual(isTrial(grandchild, labWithParallel), false);
    assert.strictEqual(isTrial(child, { flow: {} }), true, 'a lab without Parallel (23) has no such rule');
  });
});

describe('idOf', () => {
  it('reads options.id first, then the id getter, and joins an array id', () => {
    assert.strictEqual(idOf(comp({ options: { id: '1_2' } })), '1_2');
    assert.strictEqual(idOf(comp({ options: { id: undefined }, id: () => '3_0' })), '3_0');
    assert.strictEqual(idOf(comp({ options: { id: 7 } })), '7');
    assert.strictEqual(idOf(comp({ options: { id: undefined }, id: () => [1, 0] })), '1_0');
  });
  it('a throwing id getter (lab.js 20.x root) and a missing id give null', () => {
    assert.strictEqual(idOf(comp({ id: () => { throw new Error('split of null'); } })), null);
    assert.strictEqual(idOf(comp()), null);
  });
});

describe('datastoreOf', () => {
  const ds = { commit() {}, data: [] };
  it('options.datastore (classic) or the controller global (flip); null without a commit()', () => {
    assert.strictEqual(datastoreOf(comp({ options: { datastore: ds } })), ds);
    assert.strictEqual(datastoreOf(comp({ internals: { controller: { global: { datastore: ds } } } })), ds);
    assert.strictEqual(datastoreOf(comp({ options: { datastore: {} } })), null);
    assert.strictEqual(datastoreOf(comp()), null);
  });
});

describe('trialOptions', () => {
  const o = { generation: 'classic', index: 4, rerun: 1 };
  it('precedence: options.cyborgHunter, parameters, data-ch-trial in the content, the id, trial-<n>', () => {
    const win = new Window();
    const el = win.document.createElement('div');
    el.innerHTML = '<form data-ch-trial="from-mark"></form>';
    const all = comp({ options: { id: '0_1', el, cyborgHunter: { trialId: 'own', phase: 'p', decoyAnswer: false, experimentContainer: '#x' } },
      aggregateParameters: { chTrialId: 'param', chPhase: 'pp', chDecoyAnswer: 'yes' } });
    assert.deepStrictEqual(trialOptions(all, o), { trialId: 'own', phase: 'p', decoyAnswer: false, experimentContainer: '#x' });
    const params = comp({ options: { id: '0_1', el }, aggregateParameters: { chTrialId: 'param', chPhase: 'pp', chDecoyAnswer: 'yes' } });
    assert.deepStrictEqual(trialOptions(params, o), { trialId: 'param', phase: 'pp', decoyAnswer: 'yes', experimentContainer: null });
    const mark = comp({ options: { id: '0_1', el } });
    assert.strictEqual(trialOptions(mark, o).trialId, 'from-mark');
    const own = comp({ options: { id: '0_1' } });
    assert.deepStrictEqual(trialOptions(own, o), { trialId: '0_1', phase: null, decoyAnswer: null, experimentContainer: null });
    assert.strictEqual(trialOptions(comp(), o).trialId, 'trial-4');
    win.close();
  });
  it('the flip generation reads the element from internals.context.el', () => {
    const win = new Window();
    const el = win.document.createElement('div');
    el.innerHTML = '<p data-ch-trial="flip-mark"></p>';
    const c = comp({ options: { id: undefined }, internals: { context: { el } }, id: () => '1' });
    assert.strictEqual(trialOptions(c, { generation: 'flip', index: 0, rerun: 1 }).trialId, 'flip-mark');
    win.close();
  });
  it('a re-run leaf gets #<n> on a derived id, never on a given name', () => {
    assert.strictEqual(trialOptions(comp({ options: { id: '2' } }), { generation: 'classic', index: 9, rerun: 2 }).trialId, '2#2');
    assert.strictEqual(trialOptions(comp(), { generation: 'classic', index: 9, rerun: 3 }).trialId, 'trial-9#3');
    assert.strictEqual(trialOptions(comp({ options: { id: '2', cyborgHunter: { trialId: 'named' } } }), { generation: 'classic', index: 9, rerun: 2 }).trialId, 'named');
  });
  it('a component outside a tree (no aggregateParameters) falls back to options.parameters', () => {
    const c = comp({ options: { parameters: { chTrialId: 'own-params' } } });
    Object.defineProperty(c, 'aggregateParameters', { get() { throw new Error('no parents'); } });
    assert.strictEqual(trialOptions(c, o).trialId, 'own-params');
  });
});
