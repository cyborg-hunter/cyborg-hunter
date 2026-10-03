// ch.js against real jsPsych 7.3.1 (tests/fixtures/jspsych-7.3.1, vendored,
// MIT) under happy-dom, run in normal (not simulation) mode. The fakes in
// jspsych-adapter.test.js cannot reproduce jsPsych's own call order, and the
// cases below depend on it:
//   - a synchronous plugin (call-function) finishes inside its own trial()
//     call, so jsPsych runs that trial's load callback after the NEXT trial
//     has started (jspsych.js :3046-3056, :3101-3103);
//   - manual mode with ch.js alone: the researcher's extension calls
//     window.CyborgHunter.init() from inside loadExtensions;
//   - friction's entry trial starts friction from a timer, outside any
//     extension;
//   - two jsPsych instances on one page.
// Every scenario shares one happy-dom window (the guard cores bind to it at
// import); between scenarios the page is reset to "ch.js just loaded".
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const FIX = new URL('../fixtures/jspsych-7.3.1/', import.meta.url);
let win, boot, MESSAGES, CyborgHunterExtension, OneLinerExtension;

before(async () => {
  win = new Window({ url: 'https://lab.example/study.html' });
  for (const k of ['document', 'Node', 'MutationObserver', 'HTMLElement', 'Element', 'navigator', 'location',
    'getComputedStyle', 'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'Document', 'EventTarget', 'screen', 'NodeFilter']) {
    try { globalThis[k] = win[k]; } catch { /* read-only in this node version */ }
  }
  globalThis.window = win;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.addEventListener = win.addEventListener.bind(win);
  for (const f of ['jspsych.js', 'plugin-call-function.js', 'plugin-html-button-response.js']) {
    vm.runInThisContext(readFileSync(new URL(f, FIX), 'utf8'), { filename: f });
  }
  win.jsPsychModule = globalThis.jsPsychModule;
  win.jsPsychHtmlButtonResponse = globalThis.jsPsychHtmlButtonResponse;
  await import('../../src/jspsych/extension-guard-friction.js');
  await import('../../src/jspsych/extension-guard-honeypot.js');
  ({ CyborgHunterExtension } = await import('../../src/jspsych/extension-cyborg-hunter.js'));
  ({ OneLinerExtension } = await import('../../src/oneliner/adapters/jspsych-extension.js'));
  ({ boot } = await import('../../src/oneliner/boot.js'));
  ({ MESSAGES } = await import('../../src/oneliner/errors.js'));
});

after(async () => {
  await win.happyDOM.close();
});

let errors, warns, orig;
beforeEach(() => {
  errors = []; warns = [];
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (...a) => errors.push(a.map(String).join(' '));
  console.warn = (...a) => warns.push(a.map(String).join(' '));
  console.info = () => {};
  // "ch.js is about to load below jspsych.js": no sentinel, the real
  // initJsPsych, no <html jspsych> left over from the previous run.
  delete win.__cyborgHunterLoaded;
  delete win.CyborgHunter;
  delete win.CyborgHunterConfig;
  win.initJsPsych = globalThis.jsPsychModule.initJsPsych;
  win.document.documentElement.removeAttribute('jspsych');
  win.document.body.innerHTML = '';
});
// A scenario that fails before its experiment ends leaves the boot monitor's
// intervals (and maybe friction's) running, which would keep this file's
// process alive.
let current = null;
afterEach(() => {
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  try { if (win._guardFrictionToken) win.GuardFriction.stop(win._guardFrictionToken); } catch { /* not started */ }
  try { if (current) current.monitor.destroy(); } catch { /* the final hook destroyed it */ }
  current = null;
});

function bootCh(dataset, config) {
  if (config) win.CyborgHunterConfig = config;
  const ctx = boot({ script: { dataset: Object.assign({ participantId: 'P1' }, dataset || {}), src: 'https://x/ch.js' }, win });
  assert.ok(ctx, 'ch.js booted');
  current = ctx;
  return ctx;
}

// A plugin that renders, then finishes after `delay` ms (asynchronous, like
// any plugin waiting for a response).
class Timer {
  static info = { name: 'timer', parameters: {} };
  constructor(jsPsych) { this.jsPsych = jsPsych; }
  trial(el, trial) {
    el.innerHTML = '<p>timer</p>';
    setTimeout(() => this.jsPsych.finishTrial({}), trial.delay || 5);
  }
}
const callFunction = () => ({ type: globalThis.jsPsychCallFunction, func: () => 1 });
const named = (params) => [{ type: CyborgHunterExtension, params }];

async function runTimeline(jsPsych, timeline) {
  await jsPsych.run(timeline);
  return jsPsych.data.get().values();
}

describe('ch.js on real jsPsych: a synchronous trial before a named trial', () => {
  // call-function finishes inside its own trial() call, so its load callback
  // (jspsych.js :3101-3103) runs only after the next trial has started. It
  // must not re-run the extension's on_load and rename the trial that is now
  // open.
  for (const [label, gap] of [['next trial starts synchronously', undefined], ['next trial starts after a post_trial_gap', 20]]) {
    it(`the named trial keeps its trialId, phase and decoy opt-out (${label})`, async () => {
      const ctx = bootCh({}, { decoyAnswers: true });
      const rotated = [];
      const rotate = ctx.segmenter.rotate;
      ctx.segmenter.rotate = (o) => { rotated.push(o.trialId); return rotate(o); };
      const jsPsych = win.initJsPsych({});
      const cf = callFunction();
      if (gap !== undefined) cf.post_trial_gap = gap;
      const rows = await runTimeline(jsPsych, [
        { type: Timer, extensions: named({ trialId: 'A-named', phase: 'pA', decoyAnswer: false }) },
        cf,
        { type: Timer, extensions: named({ trialId: 'T-named', phase: 'pT', decoyAnswer: false }) }
      ]);
      assert.equal(rows.length, 3);
      const t = rows[2];
      assert.equal(t.integrity.trialId, 'T-named');
      assert.equal(t.integrity.phase, 'pT');
      assert.equal(t.integrity.decoy.level, 0, 'no decoy injected');
      assert.equal(t.integrity.decoy.source, 'skipped');
      assert.equal(t.integritySegment.trialId, 'T-named');
      assert.ok(typeof t.integrity.trialStart_perfNow === 'number');
      for (const r of rows) assert.ok(!('cyborgHunterError' in r), JSON.stringify(r.cyborgHunterError));
      assert.deepStrictEqual(rows.map((r) => r.integritySegment.segmentIndex), [0, 1, 2]);
      assert.equal(rows[2].integritySegmentFinal.segmentIndex, 3);
      // call-function never reached its load callback before it finished, so
      // only the two asynchronous trials open a host trial.
      assert.deepStrictEqual(rotated, ['A-named', 'T-named']);
      assert.deepStrictEqual(errors, []);
    });
  }

  // The call-function's own row is cut from the span opened at the previous
  // trial's on_finish (`gap-<index of that trial>`). A trialId/phase the
  // researcher set on the call-function names that row instead; the cut, the
  // rotations and the next trial stay as they were.
  for (const [label, gap] of [['next trial starts synchronously', undefined], ['next trial starts after a post_trial_gap', 20]]) {
    it(`a labelled call-function row carries its trialId and phase; an unlabelled one stays gap-<n> (${label})`, async () => {
      const ctx = bootCh();
      const rotated = [];
      const rotate = ctx.segmenter.rotate;
      ctx.segmenter.rotate = (o) => { rotated.push(o.trialId + '|' + o.phase); return rotate(o); };
      const jsPsych = win.initJsPsych({});
      const labelled = Object.assign(callFunction(), { extensions: named({ trialId: 'save-step', phase: 'setup' }) });
      const plain = callFunction();
      if (gap !== undefined) { labelled.post_trial_gap = gap; plain.post_trial_gap = gap; }
      const rows = await runTimeline(jsPsych, [
        { type: Timer, extensions: named({ trialId: 'A-named', phase: 'pA' }) },
        labelled,
        { type: Timer, extensions: named({ trialId: 'T-named', phase: 'pT' }) },
        plain,
        { type: Timer, extensions: named({ trialId: 'U-named', phase: 'pU' }) }
      ]);
      assert.equal(rows.length, 5);
      for (const r of rows) assert.ok(!('cyborgHunterError' in r), JSON.stringify(r.cyborgHunterError));
      assert.equal(rows[1].integrity.trialId, 'save-step');
      assert.equal(rows[1].integrity.phase, 'setup');
      assert.equal(rows[1].integritySegment.trialId, 'save-step');
      // Unlabelled: the span opened at trial 2's on_finish.
      assert.equal(rows[3].integrity.trialId, 'gap-2');
      assert.equal(rows[3].integrity.phase, 'default');
      assert.equal(rows[3].integritySegment.trialId, 'gap-2');
      for (const [i, id, phase] of [[0, 'A-named', 'pA'], [2, 'T-named', 'pT'], [4, 'U-named', 'pU']]) {
        assert.equal(rows[i].integrity.trialId, id);
        assert.equal(rows[i].integrity.phase, phase);
        assert.equal(rows[i].integritySegment.trialId, id);
      }
      assert.deepStrictEqual(rows.map((r) => r.integritySegment.segmentIndex), [0, 1, 2, 3, 4]);
      assert.equal(rows[4].integritySegmentFinal.segmentIndex, 5);
      assert.deepStrictEqual(rotated, ['A-named|pA', 'T-named|pT', 'U-named|pU']);
      assert.deepStrictEqual(errors, []);
    });

    it(`a call-function labelled with phase only keeps gap-<n> as its trialId (${label})`, async () => {
      bootCh();
      const jsPsych = win.initJsPsych({});
      const cf = Object.assign(callFunction(), { extensions: named({ phase: 'setup' }) });
      if (gap !== undefined) cf.post_trial_gap = gap;
      const rows = await runTimeline(jsPsych, [{ type: Timer }, cf, { type: Timer }]);
      assert.equal(rows.length, 3);
      for (const r of rows) assert.ok(!('cyborgHunterError' in r), JSON.stringify(r.cyborgHunterError));
      assert.equal(rows[1].integrity.trialId, 'gap-0');
      assert.equal(rows[1].integrity.phase, 'setup');
      assert.equal(rows[1].integritySegment.trialId, 'gap-0');
      assert.equal(rows[2].integrity.trialId, 'trial-2');
      assert.deepStrictEqual(errors, []);
    });
  }

  it('a call-function trial last in the timeline does not touch the finished session', async () => {
    bootCh();
    const jsPsych = win.initJsPsych({});
    const rows = await runTimeline(jsPsych, [{ type: Timer }, callFunction()]);
    assert.equal(rows.length, 2);
    for (const r of rows) assert.ok(!('cyborgHunterError' in r), JSON.stringify(r.cyborgHunterError));
    assert.deepStrictEqual(errors, []);
  });
});

// Like jsPsych 7's audio plugins (and custom plugins written the same way):
// trial() returns a Promise, so jsPsych does not run the load callback itself
// (jspsych.js :3099-3103); the plugin calls it later, once its stimulus is
// ready. Each run records performance.now() into `beforeLoad` just before
// that call (jsPsych copies array-valued trial parameters, so the list lives
// here rather than on the trial).
const beforeLoad = [];
class PromiseLoad {
  static info = { name: 'promise-load', parameters: {} };
  constructor(jsPsych) { this.jsPsych = jsPsych; }
  trial(el, trial, on_load) {
    return new Promise((resolve) => {
      setTimeout(() => {
        el.innerHTML = '<p>audio</p>';
        beforeLoad.push(performance.now());
        on_load();
        setTimeout(() => { this.jsPsych.finishTrial({}); resolve(); }, 5);
      }, 2);
    });
  }
}

describe('ch.js on real jsPsych: a synchronous trial before a promise-returning trial', () => {
  // With no gap, the call-function's late load callback runs after the next
  // trial's on_start but, the next trial's trial() having returned a Promise,
  // before that trial's own on_load. It must neither take that on_load's
  // place nor make the real one count as late.
  for (const [label, gap] of [['next trial starts synchronously', undefined], ['next trial starts after a post_trial_gap', 20]]) {
    it(`the named trial keeps its trialId, phase and decoy opt-out (${label})`, async () => {
      const ctx = bootCh({}, { decoyAnswers: true });
      const rotated = [];
      const rotate = ctx.segmenter.rotate;
      ctx.segmenter.rotate = (o) => { rotated.push(o.trialId + '|' + o.phase); return rotate(o); };
      const jsPsych = win.initJsPsych({});
      const cf = callFunction();
      if (gap !== undefined) cf.post_trial_gap = gap;
      const rows = await runTimeline(jsPsych, [
        { type: Timer, extensions: named({ trialId: 'A-named', phase: 'pA', decoyAnswer: false }) },
        cf,
        { type: PromiseLoad, extensions: named({ trialId: 'T-named', phase: 'pT', decoyAnswer: false }) }
      ]);
      assert.equal(rows.length, 3);
      const t = rows[2];
      assert.equal(t.integrity.trialId, 'T-named');
      assert.equal(t.integrity.phase, 'pT');
      assert.equal(t.integrity.decoy.level, 0, 'no decoy injected');
      assert.equal(t.integrity.decoy.source, 'skipped');
      assert.equal(t.integritySegment.trialId, 'T-named');
      for (const r of rows) assert.ok(!('cyborgHunterError' in r), JSON.stringify(r.cyborgHunterError));
      assert.deepStrictEqual(rotated, ['A-named|pA', 'T-named|pT']);
      assert.deepStrictEqual(errors, []);
    });

    it(`a labelled call-function keeps its label and the promise trial after it keeps its own (${label})`, async () => {
      const ctx = bootCh();
      const rotated = [];
      const rotate = ctx.segmenter.rotate;
      ctx.segmenter.rotate = (o) => { rotated.push(o.trialId + '|' + o.phase); return rotate(o); };
      const jsPsych = win.initJsPsych({});
      const cf = Object.assign(callFunction(), { extensions: named({ trialId: 'save-step', phase: 'setup' }) });
      if (gap !== undefined) cf.post_trial_gap = gap;
      const rows = await runTimeline(jsPsych, [
        { type: Timer, extensions: named({ trialId: 'A-named', phase: 'pA' }) },
        cf,
        { type: PromiseLoad, extensions: named({ trialId: 'T-named', phase: 'pT' }) }
      ]);
      assert.equal(rows.length, 3);
      for (const r of rows) assert.ok(!('cyborgHunterError' in r), JSON.stringify(r.cyborgHunterError));
      for (const [i, id, phase] of [[0, 'A-named', 'pA'], [1, 'save-step', 'setup'], [2, 'T-named', 'pT']]) {
        assert.equal(rows[i].integrity.trialId, id);
        assert.equal(rows[i].integrity.phase, phase);
        assert.equal(rows[i].integritySegment.trialId, id);
      }
      assert.deepStrictEqual(rotated, ['A-named|pA', 'T-named|pT']);
      assert.deepStrictEqual(errors, []);
    });

    it(`an injected-only (anonymous) promise trial anchors at its own on_load (${label})`, async () => {
      bootCh();
      const jsPsych = win.initJsPsych({});
      const cf = callFunction();
      if (gap !== undefined) cf.post_trial_gap = gap;
      beforeLoad.length = 0;
      const rows = await runTimeline(jsPsych, [{ type: Timer }, cf, { type: PromiseLoad }]);
      assert.equal(rows.length, 3);
      assert.equal(beforeLoad.length, 1);
      const t = rows[2];
      assert.ok(!('cyborgHunterError' in t), JSON.stringify(t.cyborgHunterError));
      assert.equal(typeof t.integrity.trialStart_perfNow, 'number');
      assert.ok(t.integrity.trialStart_perfNow >= beforeLoad[0],
        'anchor ' + t.integrity.trialStart_perfNow + ' precedes the plugin\'s on_load at ' + beforeLoad[0]);
      assert.deepStrictEqual(errors, []);
    });

    // A half-migrated page: ch.js is loaded, but the manual docs' per-trial
    // loop is still there and adds a cyborg-hunter entry with no params.
    // jsPsych then hands on_start and on_load `undefined` for every trial.
    it(`a researcher's params-less per-trial entry anchors at its own on_load (${label})`, async () => {
      bootCh();
      const jsPsych = win.initJsPsych({});
      const cf = callFunction();
      if (gap !== undefined) cf.post_trial_gap = gap;
      const tl = [{ type: Timer }, cf, { type: PromiseLoad }];
      tl.forEach((t) => { t.extensions = (t.extensions || []).concat([{ type: CyborgHunterExtension }]); });
      beforeLoad.length = 0;
      const rows = await runTimeline(jsPsych, tl);
      assert.equal(rows.length, 3);
      assert.equal(beforeLoad.length, 1);
      const t = rows[2];
      assert.ok(!('cyborgHunterError' in t), JSON.stringify(t.cyborgHunterError));
      assert.equal(typeof t.integrity.trialStart_perfNow, 'number');
      assert.ok(t.integrity.trialStart_perfNow >= beforeLoad[0],
        'anchor ' + t.integrity.trialStart_perfNow + ' precedes the plugin\'s on_load at ' + beforeLoad[0]);
      assert.deepStrictEqual(errors, []);
    });
  }
});

describe('ch.js on real jsPsych: per-trial params through window.jsPsychCyborgHunter (ch.js alone)', () => {
  // The documented { type: jsPsychCyborgHunter, params } entry, with ch.js as
  // the only Cyborg Hunter script: the global is ch.js's own class, so the
  // entry names the trial and does not switch to manual mode, even when it is
  // also listed in initJsPsych. (This file imports extension-cyborg-hunter.js,
  // which sets the global; it is cleared for the boot and restored after.)
  it('initJsPsych and trial entries of that type stay one-liner and keep their params', async () => {
    const saved = win.jsPsychCyborgHunter;
    delete win.jsPsychCyborgHunter;
    try {
      const ctx = bootCh();
      assert.ok(win.jsPsychCyborgHunter === OneLinerExtension, 'ch.js exposed its class');
      const jsPsych = win.initJsPsych({ extensions: [{ type: win.jsPsychCyborgHunter, params: {} }] });
      assert.equal(ctx.host, 'jspsych', 'not manual mode');
      const entry = () => [{ type: win.jsPsychCyborgHunter, params: { trialId: 'n1', phase: 'test' } }];
      const t1 = { type: Timer, extensions: entry() };
      const t2 = { type: Timer, extensions: [{ type: win.jsPsychCyborgHunter, params: { trialId: 'n2', phase: 'test' } }] };
      const rows = await runTimeline(jsPsych, [t1, callFunction(), t2]);
      for (const t of [t1, t2]) assert.equal(t.extensions.filter((e) => e.type.info.name === 'cyborg-hunter').length, 1);
      assert.equal(rows.length, 3);
      for (const [i, id] of [[0, 'n1'], [2, 'n2']]) {
        assert.equal(rows[i].integrity.trialId, id);
        assert.equal(rows[i].integrity.phase, 'test');
        assert.equal(rows[i].integritySegment.trialId, id);
      }
      for (const r of rows) assert.ok(!('cyborgHunterError' in r), JSON.stringify(r.cyborgHunterError));
      assert.deepStrictEqual(errors, []);
    } finally {
      win.jsPsychCyborgHunter = saved;
    }
  });
});

// ch.js stands down (double load after cyborg-hunter.min.js) or fails at
// boot or at the deferred session start: nothing is monitored, but the
// researcher's page must run exactly as it would without ch.js, including
// per-trial { type: jsPsychCyborgHunter, params } entries (jsPsych 7.3.1 calls
// this.extensions[name].on_start / on_load for each, :3027-3030, :3050-3053,
// so an unregistered name would throw) and documented CyborgHunter calls.
describe('ch.js on real jsPsych: ch.js did not start, the experiment still runs', () => {
  let savedClass;
  beforeEach(() => {
    savedClass = win.jsPsychCyborgHunter;
    delete win.jsPsychCyborgHunter;
    // A previous scenario's context (finalized) would make the extension
    // stand down for the wrong reason.
    OneLinerExtension.ctx = null;
  });
  afterEach(() => { win.jsPsychCyborgHunter = savedClass; });

  const perTrial = (id) => [{ type: win.jsPsychCyborgHunter, params: { trialId: id, phase: 'test' } }];
  async function runResearcherPage({ useNamespace }) {
    assert.ok(win.jsPsychCyborgHunter === OneLinerExtension, 'the class is there for the researcher\'s trials');
    const jsPsych = win.initJsPsych({});
    const timeline = [];
    if (useNamespace) {
      timeline.push(win.CyborgHunter.frictionEntryTrial());
      win.CyborgHunter.mark('x');
      win.CyborgHunter.data();
    }
    timeline.push({ type: Timer, extensions: perTrial('n1') }, callFunction(), { type: Timer, extensions: perTrial('n2') });
    const rows = await runTimeline(jsPsych, timeline);
    assert.equal(rows.length, 3, 'every trial ran (a skipped friction entry adds no row)');
    for (const r of rows) {
      for (const k of ['integrity', 'integritySegment', 'cyborgHunterError', 'participantId']) assert.ok(!(k in r), k + ' on a row');
    }
    return rows;
  }

  it('boot fails: per-trial entries and CyborgHunter calls run without errors', async () => {
    const r = boot({ script: { dataset: { participantId: 'P1' } }, win, monitorFactory: () => { throw new Error('kaboom'); } });
    assert.strictEqual(r, null);
    await runResearcherPage({ useNamespace: true });
    assert.deepStrictEqual(errors, [MESSAGES.bootFailed('kaboom')]);
    assert.deepStrictEqual(warns, [MESSAGES.notRunning()]);
  });

  // A manual page (cyborg-hunter.min.js swapped for ch.js, the researcher's
  // extension kept) whose ch.js failed: the extension's initialize() calls
  // window.CyborgHunter.init() on the inert namespace and then the monitor's
  // startSession(), on_finish its endTrial(), and finalize() its
  // getSessionReport() and destroy(). The timeline must still run to its end.
  it('boot fails on a manual page: the researcher\'s extension runs the timeline to completion', async () => {
    const r = boot({ script: { dataset: { participantId: 'P1' } }, win, monitorFactory: () => { throw new Error('kaboom'); } });
    assert.strictEqual(r, null);
    let saved = null;
    const jsPsych = win.initJsPsych({
      extensions: [{ type: CyborgHunterExtension, params: {} }],
      on_finish: () => {
        jsPsych.extensions['cyborg-hunter'].finalize();
        saved = jsPsych.data.get().values();
      }
    });
    const rows = await runTimeline(jsPsych, [
      { type: Timer, extensions: named({ trialId: 'm1' }) },
      callFunction(),
      { type: Timer, extensions: named({ trialId: 'm2' }) }
    ]);
    assert.equal(rows.length, 3, 'every trial ran');
    assert.ok(saved, 'the researcher\'s save after finalize() ran');
    assert.deepStrictEqual(errors, [MESSAGES.bootFailed('kaboom')]);
    assert.deepStrictEqual(warns, [MESSAGES.notRunning()]);
  });

  it('a failure after the jsPsych wrap: the wrap is replaced by the inert one', async () => {
    Object.defineProperty(win, 'CyborgHunter', { configurable: true, get() { return undefined; }, set() { throw new Error('locked'); } });
    try {
      assert.strictEqual(boot({ script: { dataset: { participantId: 'P1' } }, win }), null);
      await runResearcherPage({ useNamespace: false });
      assert.deepStrictEqual(errors, [MESSAGES.bootFailed('locked')]);
    } finally {
      delete win.CyborgHunter;
    }
  });

  it('double load after cyborg-hunter.min.js: ch.js stands down and the page runs', async () => {
    win.__cyborgHunterLoaded = 'cyborg-hunter.min.js';
    const core = { from: 'min.js' };
    win.CyborgHunter = core;
    assert.strictEqual(boot({ script: { dataset: { participantId: 'P1' } }, win }), null);
    await runResearcherPage({ useNamespace: false });
    assert.strictEqual(win.CyborgHunter, core);
    assert.deepStrictEqual(errors, [MESSAGES.doubleLoad('cyborg-hunter.min.js', 'ch.js')]);
  });

  it('the deferred session start fails (ch.js in <head>): initJsPsych called afterwards runs the page', async () => {
    const { init } = await import('../../src/core/monitor.js');
    const body = win.document.body;
    win.document.documentElement.removeChild(body);
    let ctx;
    try {
      ctx = boot({
        script: { dataset: { participantId: 'P1' } }, win,
        monitorFactory: (cfg) => Object.assign({}, init(cfg), { startSession() { throw new Error('no session'); } })
      });
      assert.ok(ctx, 'boot returned before the deferred start');
    } finally {
      win.document.documentElement.appendChild(body);
    }
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    assert.ok(ctx.bootError);
    // The namespace stays ch.js's own here (boot had returned), so its
    // frictionEntryTrial is the real entry trial: not used in this run.
    await runResearcherPage({ useNamespace: false });
    assert.deepStrictEqual(errors, [MESSAGES.bootFailed('no session')]);
  });
});

describe('ch.js on real jsPsych: a half-migrated manual page', () => {
  // ch.js replaced cyborg-hunter.min.js, but initJsPsych still lists
  // jsPsychCyborgHunter with the manual docs' params, and on_finish still
  // calls finalize(). Without finalize() on ch.js's class that call threw
  // and the researcher's save after it never ran.
  it('finalize() and the manual params only warn; the save after them runs and carries the final segment', async () => {
    const saved = win.jsPsychCyborgHunter;
    delete win.jsPsychCyborgHunter;
    try {
      bootCh();
      let jsPsych;
      let savedRows = null;
      jsPsych = win.initJsPsych({
        extensions: [{ type: win.jsPsychCyborgHunter, params: { participantId: 'OLD', preset: 'strict' } }],
        on_finish: () => {
          jsPsych.extensions['cyborg-hunter'].finalize();
          savedRows = jsPsych.data.get().values();
        }
      });
      await runTimeline(jsPsych, [{ type: Timer }, { type: Timer }]);
      assert.ok(savedRows, 'the researcher\'s save ran');
      assert.equal(savedRows.length, 2);
      assert.equal(savedRows[0].participantId, 'P1', 'the tag\'s id, not the params\'');
      assert.ok(savedRows[1].integritySegmentFinal);
      assert.deepStrictEqual(warns, [MESSAGES.extensionParamsIgnored(), MESSAGES.finalizeNotNeeded()]);
      assert.deepStrictEqual(errors, []);
    } finally {
      win.jsPsychCyborgHunter = saved;
    }
  });
});

describe('ch.js on real jsPsych: data-debug badge', () => {
  // jsPsych's prepareDom (jspsych.js 7.3.1 :2893-2920) replaces <body>'s
  // content, badge included, before the first trial.
  it('the badge is on the page while the first trial is on screen', async () => {
    bootCh({ debug: '' });
    console.info = () => {};
    const seen = [];
    class Probe {
      static info = { name: 'probe', parameters: {} };
      constructor(jsPsych) { this.jsPsych = jsPsych; }
      trial(el) {
        el.innerHTML = '<p>probe</p>';
        setTimeout(() => { seen.push(!!win.document.getElementById('ch-debug-badge')); this.jsPsych.finishTrial({}); }, 5);
      }
    }
    const jsPsych = win.initJsPsych({});
    await runTimeline(jsPsych, [{ type: Probe }, { type: Probe }]);
    assert.deepStrictEqual(seen, [true, true]);
  });
});

describe('ch.js on real jsPsych: manual mode with ch.js alone', () => {
  // The researcher kept extension-cyborg-hunter.js and its initJsPsych entry
  // but loads ch.js instead of cyborg-hunter.min.js: window.CyborgHunter is
  // ch.js's namespace, and its init() must give the extension a monitor.
  it('the manual extension gets a working monitor, run() resolves and rows carry integrity data', async () => {
    const ctx = bootCh();
    const jsPsych = win.initJsPsych({ extensions: [{ type: CyborgHunterExtension, params: {} }] });
    assert.equal(ctx.host, 'manual');
    let rows;
    try {
      rows = await runTimeline(jsPsych, [
        { type: Timer, extensions: named({ trialId: 'm1' }) },
        { type: Timer, extensions: named({ trialId: 'm2' }) }
      ]);
    } finally {
      try { jsPsych.extensions['cyborg-hunter'].monitor.destroy(); } catch { /* never created */ }
    }
    assert.equal(rows.length, 2);
    assert.equal(rows[0].integrity.trialId, 'm1');
    assert.equal(rows[1].integrity.trialId, 'm2');
    assert.ok(!('integritySegment' in rows[0]), 'ch.js injects nothing in manual mode');
    assert.deepStrictEqual(errors, [], 'manualInitOnOneLiner must not fire in manual mode');
  });
});

describe('ch.js on real jsPsych: friction entry trial without friction enabled', () => {
  it('warns at run() and friction is stopped when the experiment ends', async () => {
    bootCh({ guards: 'honeypot' });
    const jsPsych = win.initJsPsych({});
    const entry = win.GuardFriction.createEntryTrial();
    const done = runTimeline(jsPsych, [entry, { type: Timer, delay: 250 }]);
    assert.deepStrictEqual(warns, [MESSAGES.frictionEntryWithoutFriction()]);
    // The entry trial is a button trial; press it once it renders.
    for (let i = 0; i < 100 && !win.document.querySelector('.jspsych-btn'); i++) await new Promise((r) => setTimeout(r, 5));
    win.document.querySelector('.jspsych-btn').click();
    await done;
    assert.equal(win.GuardFriction.getCurrentState().active, false, 'friction stopped by the final hook');
  });
});

describe('ch.js on real jsPsych: two instances', () => {
  it('warns on the second initJsPsych; each instance finishes on its own data; later rows are not marked', async () => {
    bootCh();
    const first = win.initJsPsych({});
    const second = win.initJsPsych({});
    assert.deepStrictEqual(warns, [MESSAGES.secondJsPsychInstance()]);
    const a = await runTimeline(first, [{ type: Timer }]);
    assert.equal(a[a.length - 1].integritySegmentFinal.segmentIndex, 1, 'the final segment lands on the instance that finished');
    const b = await runTimeline(second, [{ type: Timer }, { type: Timer }]);
    for (const r of b) {
      assert.ok(!('cyborgHunterError' in r), JSON.stringify(r.cyborgHunterError));
      assert.ok(!('integritySegmentFinal' in r), 'the first instance\'s final segment is not written here');
    }
  });
});

// The manual extension (src/jspsych/extension-cyborg-hunter.js) with no ch.js
// on the page, every trial opted in by the forEach of
// docs/advanced-integration.md step 4 (entries without params). A
// call-function step's late load callback (see the top of this file) must not
// start a monitor trial: it threw "cannot transition from 'trial'" into
// jsPsych, and after a post_trial_gap the next trial's row took the step's
// label.
describe('manual extension on real jsPsych: a synchronous step', () => {
  let core;
  before(async () => { core = await import('../../src/core/index.js'); });

  for (const [label, gap, Next] of [
    ['next trial starts synchronously', undefined, Timer],
    ['next trial starts after a post_trial_gap', 20, Timer],
    ['the next trial returns a Promise', undefined, PromiseLoad],
  ]) {
    it(`throws nothing into jsPsych and the next trial keeps its own label (${label})`, async () => {
      win.CyborgHunter = core;
      const jsPsych = win.initJsPsych({ extensions: [{ type: CyborgHunterExtension, params: { participantId: 'P-MAN' } }] });
      current = jsPsych.extensions['cyborg-hunter'];   // afterEach destroys its monitor
      const cf = callFunction();
      if (gap !== undefined) cf.post_trial_gap = gap;
      const timeline = [{ type: Timer }, cf, { type: Next }, { type: Timer }];
      timeline.forEach((t) => { t.extensions = (t.extensions || []).concat([{ type: CyborgHunterExtension }]); });
      const rows = await runTimeline(jsPsych, timeline);
      assert.equal(rows.length, 4);
      assert.deepStrictEqual(rows.map((r) => (r.integrity ? r.integrity.trialId : null)), ['trial-0', null, 'trial-2', 'trial-3']);
      assert.deepStrictEqual(errors, []);
    });
  }

  // With a params object per trial (jsPsych copies each trial's parameters
  // before it runs), a promise trial's monitor trial starts at its own load.
  it('per-trial entries with params: the promise trial starts at its own on_load', async () => {
    win.CyborgHunter = core;
    const jsPsych = win.initJsPsych({ extensions: [{ type: CyborgHunterExtension, params: { participantId: 'P-MAN' } }] });
    current = jsPsych.extensions['cyborg-hunter'];
    const timeline = [{ type: Timer }, callFunction(), { type: PromiseLoad }];
    timeline.forEach((t) => { t.extensions = [{ type: CyborgHunterExtension, params: {} }]; });
    beforeLoad.length = 0;
    const rows = await runTimeline(jsPsych, timeline);
    assert.equal(rows[2].integrity.trialId, 'trial-2');
    assert.ok(rows[2].integrity.trialStart_perfNow >= beforeLoad[0],
      'anchor ' + rows[2].integrity.trialStart_perfNow + ' precedes the plugin\'s on_load at ' + beforeLoad[0]);
    assert.deepStrictEqual(errors, []);
  });
});

// The response click ends the trial from the plugin's own listener, before
// the click reaches the document: it is recorded on the way down, so it is in
// the row of the trial it ends rather than in the gap span after it.
describe('ch.js on real jsPsych: the response click', () => {
  it('a button response is in the mouse track of the trial it ends', async () => {
    bootCh();
    const jsPsych = win.initJsPsych({});
    const done = runTimeline(jsPsych, [{ type: win.jsPsychHtmlButtonResponse, stimulus: '<p>q</p>', choices: ['Yes'] }]);
    await new Promise((r) => setTimeout(r, 20));
    win.document.querySelector('.jspsych-btn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const rows = await done;
    assert.equal(rows.length, 1);
    assert.deepStrictEqual(rows[0].integrity.mouseTrack.filter((m) => m.type === 'click').length, 1);
    assert.deepStrictEqual(errors, []);
  });
});

// data-replay on real jsPsych. initJsPsych runs before cyborg-hunter-replay.js
// could have loaded, so ch.js lists a proxy whose async initialize() loads it
// and delegates; run() waits for it (loadExtensions awaits every
// initialize(), jspsych.js 7.3.1 :2946, run() :2695).
describe('ch.js on real jsPsych: lazy replay', () => {
  let RealReplay;
  before(async () => {
    await import('../../src/jspsych/extension-cyborg-hunter-replay.js');
    RealReplay = win.jsPsychCyborgHunterReplay;
  });
  afterEach(() => {
    win.jsPsychCyborgHunterReplay = RealReplay;
    win.happyDOM.settings.disableJavaScriptFileLoading = false;
  });

  it('records every trial; CyborgHunter.replay() in on_finish returns the recording', async () => {
    bootCh({ replay: '' });
    let recording = null;
    const jsPsych = win.initJsPsych({ on_finish: () => { recording = win.CyborgHunter.replay(); } });
    const rows = await runTimeline(jsPsych, [{ type: Timer }, { type: Timer }]);
    assert.equal(rows.length, 2);
    assert.ok(rows[1].integritySegment, 'the monitor segments as usual');
    assert.ok(recording, 'a recording came back');
    assert.equal(recording.schema_version, 2);
    assert.equal(recording.participant_id, 'P1');
    assert.deepStrictEqual(recording.segments.map((s) => s.label).filter(Boolean), ['trial-0', 'trial-1']);
    const ch = recording.extensions['cyborg-hunter'];
    assert.equal(ch.preset, 'standard', 'the session report rides along (the monitor is already destroyed by then)');
    assert.ok(ch.scoring, 'scoring from the session report');
    assert.equal(recording.host.name, 'jspsych');
    assert.equal(jsPsych.extensions['cyborg-hunter-replay'].inner.api, null, 'the recorder was destroyed');
    assert.deepStrictEqual(errors, []);
  });

  // A call-function's load callback comes late (see the top of this file):
  // it must not open a replay segment for a trial that ended, nor for the
  // next trial before that trial's own on_load.
  for (const [label, gap] of [['next trial starts synchronously', undefined], ['next trial starts after a post_trial_gap', 20]]) {
    it(`a call-function's late load opens no replay segment (${label})`, async () => {
      bootCh({ replay: '' });
      let recording = null;
      const jsPsych = win.initJsPsych({ on_finish: () => { recording = win.CyborgHunter.replay(); } });
      const cf = callFunction();
      if (gap !== undefined) cf.post_trial_gap = gap;
      const rows = await runTimeline(jsPsych, [{ type: Timer }, cf, { type: PromiseLoad }]);
      assert.equal(rows.length, 3);
      assert.deepStrictEqual(recording.segments.map((s) => s.label).filter(Boolean), ['trial-0', 'trial-2']);
      const failures = recording.extensions['cyborg-hunter'].capture_failures || [];
      assert.deepStrictEqual(failures.filter((f) => f.channel === 'lifecycle'), [], 'no trial was auto-closed');
      assert.deepStrictEqual(errors, []);
    });
  }

  // A half-migrated page: the manual docs' per-trial replay entry, written
  // without params, is still there. jsPsych would hand on_start and on_load
  // `undefined` for every trial, and the late load would pass for the
  // promise trial's own.
  it('a researcher\'s params-less per-trial replay entry: the promise trial\'s segment starts at its own on_load', async () => {
    bootCh({ replay: '' });
    let recording = null;
    const jsPsych = win.initJsPsych({ on_finish: () => { recording = win.CyborgHunter.replay(); } });
    const tl = [{ type: Timer }, callFunction(), { type: PromiseLoad }];
    tl.forEach((t) => { t.extensions = [{ type: win.jsPsychCyborgHunterReplay }]; });
    beforeLoad.length = 0;
    await runTimeline(jsPsych, tl);
    const seg = recording.segments.find((s) => s.label === 'trial-2');
    assert.ok(seg, JSON.stringify(recording.segments.map((s) => s.label)));
    const startedAt = recording.recording_started_at_perf + seg.t_load;
    assert.ok(startedAt >= beforeLoad[0], 'segment starts at ' + startedAt + ', before the plugin\'s on_load at ' + beforeLoad[0]);
    assert.deepStrictEqual(errors, []);
  });

  it('manual wiring: a labelled call-function\'s late load does not start the next trial\'s segment under its label', async () => {
    const replayEntry = (params) => [{ type: win.jsPsychCyborgHunterReplay, params }];
    const jsPsych = win.initJsPsych({
      extensions: [{ type: win.jsPsychCyborgHunterReplay, params: { participantId: 'P-M', tier: 'trace', autoSave: { mode: 'none' } } }],
    });
    const rows = await runTimeline(jsPsych, [
      { type: Timer, extensions: replayEntry({ trialId: 'first' }) },
      Object.assign(callFunction(), { extensions: replayEntry({ trialId: 'save-step' }) }),
      { type: PromiseLoad, extensions: replayEntry({ trialId: 'audio' }) },
    ]);
    assert.equal(rows.length, 3);
    const ext = jsPsych.extensions['cyborg-hunter-replay'];
    await ext.finalize();
    const recording = ext.getLastRecording();
    assert.deepStrictEqual(recording.segments.map((s) => s.label).filter(Boolean), ['first', 'audio']);
    const failures = recording.extensions['cyborg-hunter'].capture_failures || [];
    assert.deepStrictEqual(failures.filter((f) => f.channel === 'lifecycle'), []);
  });

  it('a replay script that fails to load is reported; the experiment runs without replay', async () => {
    delete win.jsPsychCyborgHunterReplay;
    win.happyDOM.settings.disableJavaScriptFileLoading = true;   // the script's error event, no fetch
    bootCh({ replay: '', replaySrc: 'https://x/missing-replay.js' });
    let recording;
    const jsPsych = win.initJsPsych({ on_finish: () => { recording = win.CyborgHunter.replay(); } });
    const rows = await runTimeline(jsPsych, [{ type: Timer }, { type: Timer }]);
    assert.equal(rows.length, 2);
    assert.ok(rows[1].integritySegmentFinal, 'the session ended normally');
    const ours = errors.filter((e) => e.startsWith('[cyborg-hunter]'));
    assert.equal(ours.length, 1, errors.join('\n'));
    assert.ok(ours[0].includes('https://x/missing-replay.js') && ours[0].includes('Fix: '), ours[0]);
    assert.strictEqual(recording, null);
  });

  it('CyborgHunterConfig.replay.autoSave: the recorder finalizes (and saves) before the researcher\'s on_finish', async () => {
    const order = [];
    win.jsPsychCyborgHunterReplay = class {
      static info = { name: 'cyborg-hunter-replay' };
      initialize(params) { order.push('initialize:' + params.autoSave.mode); this.api = {}; }
      on_start() {}
      on_load() {}
      on_finish() { return {}; }
      async finalize() { await new Promise((r) => setTimeout(r, 5)); order.push('finalize'); this.api = null; }
      getLastRecording() { return { schema_version: 2 }; }
    };
    bootCh({}, { replay: { tier: 'trace', autoSave: { mode: 'datapipe', experimentId: 'ABC123' } } });
    let recording = null;
    let finishArg = null;
    const jsPsych = win.initJsPsych({ on_finish: (data) => { finishArg = data; order.push('on_finish'); recording = win.CyborgHunter.replay(); } });
    await runTimeline(jsPsych, [{ type: Timer }]);
    assert.deepStrictEqual(order, ['initialize:datapipe', 'finalize', 'on_finish']);
    assert.ok(finishArg && typeof finishArg.values === 'function', 'the researcher\'s on_finish still gets jsPsych\'s data');
    assert.deepStrictEqual(recording, { schema_version: 2 }, 'replay() returns what finalize saved');
    assert.deepStrictEqual(warns, []);
  });

  it('a finalize that never settles is bounded: a catalogue warning, then the researcher\'s on_finish runs', async () => {
    win.jsPsychCyborgHunterReplay = class {
      static info = { name: 'cyborg-hunter-replay' };
      initialize() { this.api = {}; }
      on_start() {}
      on_load() {}
      on_finish() { return {}; }
      finalize() { return new Promise(() => {}); }
      getLastRecording() { return null; }
    };
    const ctx = bootCh({}, { replay: { tier: 'trace', autoSave: { mode: 'datapipe', experimentId: 'ABC123' } } });
    ctx.replayFinalizeTimeoutMs = 30;
    let finished = false;
    const jsPsych = win.initJsPsych({ on_finish: () => { finished = true; } });
    await runTimeline(jsPsych, [{ type: Timer }]);
    assert.ok(finished, 'the researcher\'s on_finish ran');
    assert.ok(warns.some((w) => w.startsWith('[cyborg-hunter]') && w.includes('Fix: ')), warns.join('\n'));
  });
});
