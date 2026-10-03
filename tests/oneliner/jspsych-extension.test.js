// OneLinerExtension: the jsPsych extension ch.js injects into every trial.
// on_load rotates the segmenter into the host trial; on_finish cuts a segment
// and returns it (plus per-row running totals) so jsPsych merges it into the
// trial's own row (jspsych.js 7.3.1 :2772, :2814-2823). A fake segmenter
// stands in for the real one (segmenter.test.js covers that contract).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { OneLinerExtension } from '../../src/oneliner/adapters/jspsych-extension.js';
import { MESSAGES } from '../../src/oneliner/errors.js';

function segment(i) {
  return {
    segmentIndex: i, source: 'host', trialId: 't' + i, deltas: {},
    counters: { pasteCount: 2, copyCount: 1, dropCount: 0 },
    score: { softScore: 3.5, anyHardTriggered: true }
  };
}

function makeCtx(over) {
  const calls = [];
  const segmenter = {
    rotate: (o) => { calls.push(['rotate', o]); return null; },
    cut: (o) => { calls.push(['cut', o]); return { segment: segment(4), trialReport: { trialId: 't4', pasteEvents: [] } }; }
  };
  return { calls, ctx: Object.assign({ monitor: { id: 'm' }, segmenter, jspsych: { segmentsWritten: 0 } }, over || {}) };
}

const fakeJsPsych = (idx) => ({ getProgress: () => ({ current_trial_global: idx }) });

let errs, warns, origError, origWarn;
beforeEach(() => {
  errs = []; warns = [];
  origError = console.error; origWarn = console.warn;
  console.error = (m) => errs.push(String(m));
  console.warn = (m) => warns.push(String(m));
});
afterEach(() => { console.error = origError; console.warn = origWarn; OneLinerExtension.ctx = null; });

describe('OneLinerExtension: jsPsych hooks', () => {
  // jsPsych 7 calls these four unconditionally on every trial listing the
  // extension (on_start: jspsych.js :3027-3030); a missing one crashes the
  // next trial.
  for (const hook of ['initialize', 'on_start', 'on_load', 'on_finish']) {
    it(`exposes ${hook} as an instance method`, () => {
      assert.equal(typeof new OneLinerExtension({})[hook], 'function');
    });
  }

  it("keeps the 'cyborg-hunter' name and declares integrity + integritySegment", () => {
    assert.equal(OneLinerExtension.info.name, 'cyborg-hunter');
    assert.ok(OneLinerExtension.info.data.integrity);
    assert.ok(OneLinerExtension.info.data.integritySegment);
  });

  // The replay extension finds the monitor through
  // jsPsych.extensions['cyborg-hunter'].monitor.
  it('exposes the boot monitor as .monitor', () => {
    const { ctx } = makeCtx();
    OneLinerExtension.ctx = ctx;
    assert.strictEqual(new OneLinerExtension({}).monitor, ctx.monitor);
  });

  it('initialize and on_start never throw', () => {
    const ext = new OneLinerExtension({});
    assert.doesNotThrow(() => ext.initialize({}));
    assert.doesNotThrow(() => ext.on_start(undefined));
  });
});

// ch.js failed or stood down (boot.js): the class is still registered so
// researcher trials typed jsPsychCyborgHunter run, but no context is wired.
describe('OneLinerExtension: inert without a context', () => {
  it('every hook does nothing and never throws; .monitor is null', () => {
    const ext = new OneLinerExtension(fakeJsPsych(0));
    assert.strictEqual(OneLinerExtension.ctx, null);
    assert.strictEqual(ext.monitor, null);
    assert.strictEqual(ext.initialize({}), undefined);
    const p = { trialId: 'q1' };
    assert.doesNotThrow(() => { ext.on_start(p); ext.on_load(p); });
    assert.deepStrictEqual(ext.on_finish(p), {});
    assert.deepStrictEqual(errs, []);
  });
});

// A half-migrated manual page: ch.js is loaded, but the manual docs' wiring
// is still there. jsPsychCyborgHunter is ch.js's class, so it gets the
// initJsPsych entry's params and the on_finish finalize() call.
describe('OneLinerExtension: leftovers from manual wiring', () => {
  it('finalize() exists, does nothing and warns once', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(0));
    assert.strictEqual(ext.finalize(), undefined);
    ext.finalize();
    assert.deepStrictEqual(warns, [MESSAGES.finalizeNotNeeded()]);
    assert.deepStrictEqual(calls, [], 'the session is not touched');
    OneLinerExtension.ctx = null;
    assert.doesNotThrow(() => new OneLinerExtension(fakeJsPsych(0)).finalize());
  });

  it('participantId or preset in the initJsPsych params are warned about once', () => {
    const ext = new OneLinerExtension(fakeJsPsych(0));
    ext.initialize({ participantId: 'P9', preset: 'strict' });
    ext.initialize({ preset: 'strict' });
    assert.deepStrictEqual(warns, [MESSAGES.extensionParamsIgnored()]);
    new OneLinerExtension(fakeJsPsych(0)).initialize({ preset: 'permissive' });
    assert.equal(warns.length, 2, 'preset alone is warned about too');
  });

  it('no warning for ch.js\'s own params or trial params', () => {
    const ext = new OneLinerExtension(fakeJsPsych(0));
    ext.initialize({});
    ext.initialize(undefined);
    ext.initialize({ trialId: 'x', phase: 'p' });
    assert.deepStrictEqual(warns, []);
  });
});

describe('OneLinerExtension: on_load', () => {
  // jsPsych's prepareDom wipes <body> (and the badge with it) before the
  // first trial; on_load runs inside that trial, so the badge is back while
  // the trial is on screen, not only after its on_finish.
  it('refreshes the debug badge after the rotate; a stale on_load does not', () => {
    const { ctx, calls } = makeCtx();
    const order = [];
    ctx.debug = { refresh: () => order.push('refresh:' + calls.length) };
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(0));
    const p = {};
    ext.on_start(p);
    ext.on_load(p);
    assert.deepStrictEqual(order, ['refresh:1']);
    ext.on_load(p);
    assert.deepStrictEqual(order, ['refresh:1']);
  });

  it('a throwing debug refresh never reaches jsPsych', () => {
    const { ctx } = makeCtx();
    ctx.debug = { refresh: () => { throw new Error('badge'); } };
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(0));
    const p = {};
    ext.on_start(p);
    assert.doesNotThrow(() => ext.on_load(p));
    assert.ok(!('cyborgHunterError' in ext.on_finish(p)));
  });

  it('rotates into the host trial with trialId, phase and decoyAnswer:false passed through', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(3));
    const p = { trialId: 'q1', phase: 'test', decoyAnswer: false };
    ext.on_start(p);
    ext.on_load(p);
    const [name, o] = calls[0];
    assert.equal(name, 'rotate');
    assert.equal(o.trialId, 'q1');
    assert.equal(o.phase, 'test');
    assert.strictEqual(o.decoyAnswer, false, 'an explicit false opt-out must reach the core as false');
  });

  it('names an unnamed trial trial-<global index>; missing params become null', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(7));
    ext.on_start(undefined);
    ext.on_load(undefined);
    const o = calls[0][1];
    assert.equal(o.trialId, 'trial-7');
    assert.strictEqual(o.phase, null);
    assert.strictEqual(o.decoyAnswer, null);
    assert.strictEqual(o.experimentContainer, null);
  });

  it('never throws when the segmenter throws', () => {
    const { ctx } = makeCtx();
    ctx.segmenter.rotate = () => { throw new Error('boom'); };
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(0));
    const p = {};
    ext.on_start(p);
    assert.doesNotThrow(() => ext.on_load(p));
  });

  // A synchronous plugin (call-function) finishes inside its own trial()
  // call; jsPsych runs its load callback afterwards (jspsych.js :3101-3103),
  // either after the next trial's on_load (nextTrial ran synchronously) or
  // before the next trial's on_start (post_trial_gap / default_iti > 0).
  it('an on_load arriving after its trial finished does not rotate (next trial not started yet)', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(1));
    const p = {};
    ext.on_start(p);
    ext.on_finish(p);
    ext.on_load(p);
    assert.deepStrictEqual(calls.map((c) => c[0]), ['cut']);
  });

  it('a stale on_load after the next trial loaded does not rename it', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(2));
    const cf = {}, next = { trialId: 'T-named' };
    ext.on_start(cf);                         // call-function
    ext.on_finish(cf);                        // ... finishes inside trial()
    ext.on_start(next);                       // next trial starts synchronously
    ext.on_load(next);
    ext.on_load(cf);                          // call-function's late load callback
    assert.deepStrictEqual(calls.map((c) => c[0] + ':' + (c[1].trialId || c[1].nextTrialId)), ['cut:gap-2', 'rotate:T-named']);
  });

  // When the next trial's trial() returns a Promise (jsPsych 7 audio plugins),
  // jsPsych leaves its load callback to the plugin, so the stale call arrives
  // between the next trial's on_start and its own on_load. Each on_load is
  // tied to its trial by the params object jsPsych passes (the same object to
  // on_start and on_load of one trial, jspsych.js :3027-3054).
  it('a stale on_load before a promise trial\'s own on_load neither rotates nor disarms it', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(2));
    const cf = {}, next = { trialId: 'T-named', phase: 'pT', decoyAnswer: false };
    ext.on_start(cf);
    ext.on_finish(cf);
    ext.on_start(next);
    ext.on_load(cf);                          // call-function's late load callback
    ext.on_load(next);                        // the plugin's own call, later
    assert.deepStrictEqual(calls.map((c) => c[0] + ':' + (c[1].trialId || c[1].nextTrialId)), ['cut:gap-2', 'rotate:T-named']);
    assert.strictEqual(calls[1][1].decoyAnswer, false);
    assert.equal(calls[1][1].phase, 'pT');
  });

  // The call-function's row is cut from the gap span the previous cut opened.
  // A trialId/phase the researcher set on it (seen at on_start; on_load never
  // came) labels that cut; only the labels present are passed.
  it('a labelled trial that finished before its on_load labels its cut with its trialId and phase', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(2));
    const cf = { trialId: 'save-step', phase: 'setup', decoyAnswer: false };
    ext.on_start(cf);
    ext.on_finish(cf);
    ext.on_load(cf);                          // the late load callback is still dropped
    assert.deepStrictEqual(calls, [['cut', { source: 'host', nextTrialId: 'gap-2', label: { trialId: 'save-step', phase: 'setup' } }]]);
  });

  it('a synchronous trial labelled with phase only passes only the phase', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(2));
    const cf = { phase: 'setup' };
    ext.on_start(cf);
    ext.on_finish(cf);
    assert.deepStrictEqual(calls, [['cut', { source: 'host', nextTrialId: 'gap-2', label: { phase: 'setup' } }]]);
  });

  it('an unlabelled or params-less synchronous trial cuts without a label', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(2));
    for (const cf of [{}, undefined, { decoyAnswer: false }]) {
      ext.on_start(cf);
      ext.on_finish(cf);
    }
    assert.deepStrictEqual(calls.map((c) => c[1]), [0, 1, 2].map(() => ({ source: 'host', nextTrialId: 'gap-2' })));
  });

  it('a trial whose on_load rotated cuts without a label (its span already carries the names)', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(3));
    const p = { trialId: 'q1', phase: 'test' };
    ext.on_start(p);
    ext.on_load(p);
    ext.on_finish(p);
    assert.deepStrictEqual(calls[1], ['cut', { source: 'host', nextTrialId: 'gap-3' }]);
  });

  it('after the session has ended, on_load does not touch the segmenter', () => {
    const { ctx, calls } = makeCtx({ jspsych: { finalized: true } });
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(0));
    const p = {};
    ext.on_start(p);
    ext.on_load(p);
    assert.deepStrictEqual(calls, []);
  });
});

describe('OneLinerExtension: on_finish', () => {
  it('returns integrity, integritySegment and the five per-row running totals', () => {
    const { ctx, calls } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(4));
    const p = { trialId: 't4' };
    ext.on_start(p);
    ext.on_load(p);
    const out = ext.on_finish({});
    assert.deepStrictEqual(calls[1], ['cut', { source: 'host', nextTrialId: 'gap-4' }]);
    assert.equal(out.integrity.trialId, 't4');
    assert.equal(typeof out.integrity.trialStart_perfNow, 'number');
    assert.equal(out.integritySegment.segmentIndex, 4);
    assert.strictEqual(out.integrityPasteCount, 2);
    assert.strictEqual(out.integrityCopyCount, 1);
    assert.strictEqual(out.integrityDropCount, 0);
    assert.strictEqual(out.integritySoftScore, 3.5);
    assert.strictEqual(out.integrityAnyHardTriggered, true);
    assert.ok(!('cyborgHunterError' in out));
    assert.equal(ctx.jspsych.segmentsWritten, 1);
  });

  it('a trial whose plugin skipped on_load does not inherit the previous trial anchor', () => {
    const { ctx } = makeCtx();
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(4));
    const p = {};
    ext.on_start(p);
    ext.on_load(p);
    ext.on_finish(p);
    assert.strictEqual(ext.on_finish({}).integrity.trialStart_perfNow, null);
  });

  it('a segment cut with a failed reopen is still returned, with the error marker', () => {
    const { ctx } = makeCtx();
    ctx.segmenter.cut = () => ({ segment: segment(2), trialReport: { trialId: 't2' }, error: 'reopen failed' });
    OneLinerExtension.ctx = ctx;
    const out = new OneLinerExtension(fakeJsPsych(2)).on_finish({});
    assert.equal(out.integritySegment.segmentIndex, 2);
    assert.equal(out.cyborgHunterError, 'reopen failed');
  });

  it('a segmenter error returns { cyborgHunterError } and never throws', () => {
    const { ctx } = makeCtx();
    ctx.segmenter.cut = () => ({ error: 'segment write failed' });
    OneLinerExtension.ctx = ctx;
    const out = new OneLinerExtension(fakeJsPsych(1)).on_finish({});
    assert.deepStrictEqual(out, { cyborgHunterError: 'segment write failed' });
  });

  it('a throwing segmenter returns { cyborgHunterError } and never throws', () => {
    const { ctx } = makeCtx();
    ctx.segmenter.cut = () => { throw new Error('kaput'); };
    OneLinerExtension.ctx = ctx;
    let out;
    assert.doesNotThrow(() => { out = new OneLinerExtension(fakeJsPsych(1)).on_finish({}); });
    assert.equal(out.cyborgHunterError, 'kaput');
  });

  it('a rotate error at on_load is carried onto the row', () => {
    const { ctx } = makeCtx();
    ctx.segmenter.rotate = () => ({ error: 'rotation failed' });
    OneLinerExtension.ctx = ctx;
    const ext = new OneLinerExtension(fakeJsPsych(1));
    const p = {};
    ext.on_start(p);
    ext.on_load(p);
    const out = ext.on_finish(p);
    assert.equal(out.integritySegment.segmentIndex, 4);
    assert.equal(out.cyborgHunterError, 'rotation failed');
  });

  // A second jsPsych instance running after the first one ended the session
  // (adapters/jspsych.js warns about it at initJsPsych): its rows are left
  // alone rather than marked with the segmenter's 'finished' error.
  it('after the session has ended, returns {} without cutting', () => {
    const { ctx, calls } = makeCtx({ jspsych: { finalized: true } });
    OneLinerExtension.ctx = ctx;
    assert.deepStrictEqual(new OneLinerExtension(fakeJsPsych(5)).on_finish({}), {});
    assert.deepStrictEqual(calls, []);
  });

  it('without a context (ch.js did not boot) returns {}', () => {
    assert.deepStrictEqual(new OneLinerExtension(fakeJsPsych(0)).on_finish({}), {});
  });

  it('records its own duration when the debug counters exist', () => {
    const { ctx } = makeCtx();
    const samples = [];
    ctx.debug = { stats: () => ({ segmentWriteMs: samples }) };
    OneLinerExtension.ctx = ctx;
    new OneLinerExtension(fakeJsPsych(0)).on_finish({});
    assert.equal(samples.length, 1);
    assert.ok(samples[0] >= 0);
  });

  it('refreshes the debug badge after each written row, after the timing push', () => {
    const { ctx } = makeCtx();
    const order = [];
    ctx.debug = { stats: () => ({ segmentWriteMs: { push() { order.push('timing'); } } }), refresh: () => order.push('refresh') };
    OneLinerExtension.ctx = ctx;
    new OneLinerExtension(fakeJsPsych(0)).on_finish({});
    assert.deepStrictEqual(order, ['timing', 'refresh']);
  });
});
