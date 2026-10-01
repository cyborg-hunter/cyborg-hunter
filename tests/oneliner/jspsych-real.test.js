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
    assert.equal(jsPsych.extensions['cyborg-hunter-replay'].inner.api, null, 'the recorder was destroyed');
    assert.deepStrictEqual(errors, []);
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
    const jsPsych = win.initJsPsych({ on_finish: () => { order.push('on_finish'); recording = win.CyborgHunter.replay(); } });
    await runTimeline(jsPsych, [{ type: Timer }]);
    assert.deepStrictEqual(order, ['initialize:datapipe', 'finalize', 'on_finish']);
    assert.deepStrictEqual(recording, { schema_version: 2 }, 'replay() returns what finalize saved');
    assert.deepStrictEqual(warns, []);
  });
});
