// Lazy session replay under the one-line setup (data-replay). ch.js does not
// bundle the replay recorder: it loads cyborg-hunter-replay.js from the URL
// ch.js itself came from (or data-replay-src) only when data-replay is set.
//   jsPsych  initJsPsych runs synchronously in the researcher's code, before
//            the script can have loaded, so ch.js lists a proxy extension
//            whose async initialize() loads the script and then delegates to
//            the real replay extension (jsPsych's run() awaits
//            loadExtensions, which awaits every initialize());
//   vanilla  the standalone recorder starts after DOMContentLoaded and
//            follows the segmenter's marks.
// CyborgHunter.replay() stops the recorder and returns the recording for the
// researcher's own save code. A load failure is a catalogue error and the
// experiment runs on without replay.
//
// The script element is never connected to a document here (a stub head
// records it), so nothing is fetched; load and error are dispatched by hand.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { VERSION } from '../../src/shared/constants.js';
import {
  replaySrcFor, loadScript, makeReplayProxy, createVanillaReplay, installReplay
} from '../../src/oneliner/replay-loader.js';
import { MESSAGES } from '../../src/oneliner/errors.js';

let win, errors, warns, orig;

beforeEach(() => {
  win = new Window({ url: 'https://lab.example/study.html' });
  errors = []; warns = [];
  orig = { error: console.error, warn: console.warn };
  console.error = (m) => errors.push(String(m));
  console.warn = (m) => warns.push(String(m));
});

afterEach(() => {
  console.error = orig.error; console.warn = orig.warn;
  win.close();
});

const SRC = 'https://unpkg.com/cyborg-hunter@0.10.0/dist/cyborg-hunter-replay.js';
const RECORDING = { schema_version: 2, segments: [] };

// A document whose <head> only records what is appended.
function stubDoc() {
  const appended = [];
  return {
    appended,
    readyState: 'complete',
    createElement: (tag) => win.document.createElement(tag),
    head: { appendChild: (el) => { appended.push(el); return el; } },
    addEventListener: (...a) => win.document.addEventListener(...a)
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// The recorder handle (src/replay/index.js attach()), recording every call.
function fakeApi(log) {
  return {
    startSession: () => { log.push('startSession'); },
    startTrial: (o) => { log.push('startTrial:' + o.trialId); },
    endTrial: () => { log.push('endTrial'); },
    stopSession: (reason) => { log.push('stopSession:' + reason); },
    getRecording: (opts) => { log.push('getRecording'); log.opts = opts; return RECORDING; },
    destroy: () => { log.push('destroy'); }
  };
}

// Stands in for window.jsPsychCyborgHunterReplay.
function fakeReplayExtension(log) {
  return class FakeReplay {
    constructor(jsPsych) { this.jsPsych = jsPsych; this.api = null; log.push('construct'); log.jsPsych = jsPsych; }
    initialize(params) { log.push('initialize'); log.params = params; this.api = fakeApi(log); }
    on_start() { log.push('on_start'); }
    on_load(p) { log.push('on_load:' + (p && p.trialId)); }
    on_finish() { log.push('on_finish'); return { replayed: true }; }
    async finalize() { log.push('finalize'); this.api = null; }
    getLastRecording() { return null; }
  };
}

function baseCtx(extra) {
  return Object.assign({
    participantId: 'P1',
    config: { replay: { tier: 'trace' }, replaySrc: null },
    scriptSrc: 'https://unpkg.com/cyborg-hunter@0.10.0/dist/ch.js',
    host: 'jspsych',
    handlers: {},
    win,
    monitor: { getSessionReport: () => ({ report: 1 }) },
    segmenter: { state: () => ({ open: true, currentTrialId: 'span-0', segmentIndex: 0 }) }
  }, extra || {});
}

describe('replaySrcFor', () => {
  it('the sibling of ch.js', () => {
    assert.strictEqual(replaySrcFor('https://unpkg.com/cyborg-hunter@0.10.0/dist/ch.js', null), SRC);
    assert.strictEqual(replaySrcFor('https://lab.example/js/ch.js?v=3', null), 'https://lab.example/js/cyborg-hunter-replay.js');
  });

  it('data-replay-src wins', () => {
    assert.strictEqual(replaySrcFor('https://cdn/x/ch.js', 'https://mine/r.js'), 'https://mine/r.js');
    assert.strictEqual(replaySrcFor(null, 'https://mine/r.js'), 'https://mine/r.js');
  });

  it('without its own URL (inline or bundled ch.js) and no override it throws for the caller to report', () => {
    assert.throws(() => replaySrcFor(null, null), /data-replay-src/);
  });
});

describe('loadScript', () => {
  it('appends one script per src and resolves on its load event', async () => {
    const doc = stubDoc();
    let done = false;
    const p = loadScript(doc, SRC).then(() => { done = true; });
    assert.strictEqual(loadScript(doc, SRC), loadScript(doc, SRC), 'one cached promise per src');
    assert.strictEqual(doc.appended.length, 1);
    assert.strictEqual(doc.appended[0].src, SRC);
    await flush();
    assert.strictEqual(done, false, 'pending until load');
    doc.appended[0].dispatchEvent(new win.Event('load'));
    await p;
    assert.strictEqual(done, true);
    loadScript(doc, 'https://other/r.js').catch(() => {});
    assert.strictEqual(doc.appended.length, 2, 'a different src gets its own script');
    doc.appended[1].dispatchEvent(new win.Event('error'));
  });

  it('rejects on the error event (404, network, CSP)', async () => {
    const doc = stubDoc();
    const p = loadScript(doc, SRC);
    doc.appended[0].dispatchEvent(new win.Event('error'));
    await assert.rejects(p, /could not load https:\/\/unpkg\.com/);
  });

  it('rejects when the script neither loads nor fails in time', async () => {
    const doc = stubDoc();
    await assert.rejects(loadScript(doc, SRC, 5), /timed out/);
  });
});

describe('loadScript nonce', () => {
  it('copies the ch.js tag\'s nonce onto the injected script', () => {
    const doc = stubDoc();
    loadScript(doc, SRC, undefined, 'abc123').catch(() => {});
    assert.strictEqual(doc.appended[0].nonce, 'abc123');
    loadScript(doc, 'https://other/r.js').catch(() => {});
    assert.ok(!doc.appended[1].nonce, 'no nonce on the tag: none set');
    doc.appended[0].dispatchEvent(new win.Event('error'));
    doc.appended[1].dispatchEvent(new win.Event('error'));
  });

  it('the proxy and the vanilla loader pass ctx.scriptNonce', async () => {
    const doc = stubDoc();
    const ctx = baseCtx({ scriptNonce: 'n1' });
    new (makeReplayProxy({ doc, src: SRC, ctx }))({}).initialize({});
    assert.strictEqual(doc.appended[0].nonce, 'n1');
    const doc2 = stubDoc();
    createVanillaReplay({ win, doc: doc2, src: SRC + '?v', ctx }).catch(() => {});
    assert.strictEqual(doc2.appended[0].nonce, 'n1');
    doc.appended[0].dispatchEvent(new win.Event('error'));
    doc2.appended[0].dispatchEvent(new win.Event('error'));
    await flush();
  });
});

describe('ReplayProxyExtension (jsPsych host)', () => {
  it('keeps the replay extension\'s name, so jsPsych.extensions[\'cyborg-hunter-replay\'] is the proxy', () => {
    const Proxy = makeReplayProxy({ doc: stubDoc(), src: SRC, ctx: baseCtx() });
    assert.deepStrictEqual(Proxy.info, { name: 'cyborg-hunter-replay', version: VERSION, data: {} });
  });

  it('initialize awaits the load, then constructs the real extension with participantId and autoSave none as defaults', async () => {
    const log = [];
    const doc = stubDoc();
    const ctx = baseCtx();
    const Proxy = makeReplayProxy({ doc, src: SRC, ctx });
    const jsPsych = { id: 'jsPsych' };
    const proxy = new Proxy(jsPsych);
    const init = proxy.initialize({ tier: 'trace' });
    await flush();
    assert.deepStrictEqual([...log], [], 'nothing constructed before the script loaded');
    win.jsPsychCyborgHunterReplay = fakeReplayExtension(log);
    doc.appended[0].dispatchEvent(new win.Event('load'));
    await init;
    assert.deepStrictEqual(log.slice(0, 2), ['construct', 'initialize']);
    assert.strictEqual(log.jsPsych, jsPsych);
    assert.deepStrictEqual(log.params, { participantId: 'P1', autoSave: { mode: 'none' }, _ownerSavesRecording: true, tier: 'trace' });
  });

  it('params override the defaults (CyborgHunterConfig.replay.autoSave)', async () => {
    const log = [];
    win.jsPsychCyborgHunterReplay = fakeReplayExtension(log);
    const doc = stubDoc();
    const proxy = new (makeReplayProxy({ doc, src: SRC, ctx: baseCtx() }))({});
    const autoSave = { mode: 'datapipe', experimentId: 'ABC123' };
    await proxy.initialize({ tier: 'dom', autoSave, participantId: 'X9' });
    assert.deepStrictEqual(log.params, { participantId: 'X9', autoSave, _ownerSavesRecording: true, tier: 'dom' });
    assert.strictEqual(doc.appended.length, 0, 'the extension was already on the page: nothing loaded');
  });

  it('per-trial hooks: inert before the load, delegated after', async () => {
    const log = [];
    const doc = stubDoc();
    const proxy = new (makeReplayProxy({ doc, src: SRC, ctx: baseCtx() }))({});
    const init = proxy.initialize({});
    proxy.on_start({});
    proxy.on_load({ trialId: 'early' });
    assert.deepStrictEqual(proxy.on_finish({}), {});
    assert.strictEqual(proxy.getLastRecording(), null);
    win.jsPsychCyborgHunterReplay = fakeReplayExtension(log);
    doc.appended[0].dispatchEvent(new win.Event('load'));
    await init;
    proxy.on_start({});
    proxy.on_load({ trialId: 'q1' });
    assert.deepStrictEqual(proxy.on_finish({}), { replayed: true });
    await proxy.finalize();
    assert.deepStrictEqual([...log], ['construct', 'initialize', 'on_start', 'on_load:q1', 'on_finish', 'finalize']);
  });

  it('a load failure is a catalogue error, initialize still resolves and the proxy stays inert', async () => {
    const log = [];
    const doc = stubDoc();
    const proxy = new (makeReplayProxy({ doc, src: SRC, ctx: baseCtx() }))({});
    const init = proxy.initialize({});
    doc.appended[0].dispatchEvent(new win.Event('error'));
    await init;   // resolves: jsPsych's run() awaits it
    win.jsPsychCyborgHunterReplay = fakeReplayExtension(log);
    assert.strictEqual(errors.length, 1, errors.join('\n'));
    assert.ok(errors[0].includes('Fix: '), errors[0]);
    assert.ok(errors[0].includes(SRC), errors[0]);
    assert.ok(errors[0].endsWith('known-issues.md#one-line-setup'), errors[0]);
    proxy.on_start({});
    proxy.on_load({ trialId: 'q1' });
    assert.deepStrictEqual(proxy.on_finish({}), {});
    await proxy.finalize();
    assert.strictEqual(proxy.getLastRecording(), null);
    assert.deepStrictEqual([...log], [], 'nothing reached the replay extension');
  });

  it('a script that loads but defines no replay extension is reported the same way', async () => {
    const doc = stubDoc();
    const proxy = new (makeReplayProxy({ doc, src: SRC, ctx: baseCtx() }))({});
    const init = proxy.initialize({});
    doc.appended[0].dispatchEvent(new win.Event('load'));
    await init;
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('jsPsychCyborgHunterReplay'), errors[0]);
    assert.deepStrictEqual(proxy.on_finish({}), {});
  });

  it('a replay extension whose initialize throws leaves the proxy inert', async () => {
    const log = [];
    const Fake = fakeReplayExtension(log);
    win.jsPsychCyborgHunterReplay = class extends Fake {
      initialize() { this.api = fakeApi(log); throw new Error('no body'); }
    };
    const proxy = new (makeReplayProxy({ doc: stubDoc(), src: SRC, ctx: baseCtx() }))({});
    await proxy.initialize({});
    assert.ok(errors[0].includes('no body'), errors.join('\n'));
    assert.ok(log.includes('destroy'), 'the half-started recorder is destroyed');
    assert.deepStrictEqual(proxy.on_finish({}), {});
  });
});

describe('CyborgHunter.replay()', () => {
  async function jsPsychCtx(log) {
    win.jsPsychCyborgHunterReplay = fakeReplayExtension(log);
    const ctx = baseCtx();
    installReplay({ win, ctx, doc: stubDoc() });
    const proxy = new ctx.replayProxy({ version: () => '7.3.1' });
    await proxy.initialize({ tier: 'trace' });
    ctx.jsPsych = { extensions: { 'cyborg-hunter-replay': proxy } };
    log.length = 0;
    return { ctx, proxy };
  }

  it('jsPsych: stops, serializes and destroys the recorder, in that order, and returns the recording', async () => {
    const log = [];
    const { ctx, proxy } = await jsPsychCtx(log);
    assert.strictEqual(ctx.handlers.replay(), RECORDING);
    assert.deepStrictEqual([...log], ['stopSession:finished', 'getRecording', 'destroy']);
    assert.deepStrictEqual(log.opts.chSessionReport, { report: 1 }, 'the session report rides along, as in finalize()');
    assert.strictEqual(proxy.inner.api, null, 'a later finalize() is a no-op');
  });

  it('a second call returns the same recording without touching the recorder', async () => {
    const log = [];
    const { ctx } = await jsPsychCtx(log);
    ctx.handlers.replay();
    log.length = 0;
    assert.strictEqual(ctx.handlers.replay(), RECORDING);
    assert.deepStrictEqual([...log], []);
    assert.deepStrictEqual(warns, []);
  });

  it('a recorder that refuses stopSession (already stopped) still serializes and is destroyed', async () => {
    const log = [];
    const { ctx, proxy } = await jsPsychCtx(log);
    proxy.inner.api.stopSession = () => { throw new Error('invalid lifecycle call: stopped → stopped'); };
    assert.strictEqual(ctx.handlers.replay(), RECORDING);
    assert.deepStrictEqual([...log], ['getRecording', 'destroy']);
  });

  it('replay off: null and a warning', () => {
    const ctx = baseCtx({ config: { replay: null, replaySrc: null } });
    installReplay({ win, ctx, doc: stubDoc() });
    assert.strictEqual(ctx.replayProxy, undefined);
    assert.strictEqual(ctx.handlers.replay(), null);
    assert.ok(warns[0].includes('data-replay'), warns.join('\n'));
    assert.ok(warns[0].includes('Fix: '), warns[0]);
  });

  it('not loaded yet (or failed): null and a warning', () => {
    const ctx = baseCtx();
    installReplay({ win, ctx, doc: stubDoc() });
    assert.strictEqual(ctx.handlers.replay(), null);
    ctx.jsPsych = { extensions: { 'cyborg-hunter-replay': new ctx.replayProxy({}) } };
    assert.strictEqual(ctx.handlers.replay(), null);
    assert.strictEqual(warns.length, 2, warns.join('\n'));
    assert.ok(warns.every((w) => w.includes('Fix: ')), warns.join('\n'));
  });

  it('jsPsych: a finalize that took the recorder but saved nothing warns replayFinalizeFailed, not "not started"', async () => {
    const log = [];
    const { ctx, proxy } = await jsPsychCtx(log);
    proxy.inner.api = null;   // finalize() destroyed the recorder; getLastRecording() is null
    assert.strictEqual(ctx.handlers.replay(), null);
    assert.strictEqual(warns.length, 1, warns.join('\n'));
    assert.ok(warns[0].includes('Fix: ') && !warns[0].includes('has not started yet'), warns[0]);
    assert.ok(warns[0].includes('save'), warns[0]);
  });

  it('vanilla host with autoSave: one catalogue warning at install (autoSave is jsPsych-only)', () => {
    const ctx = baseCtx({ host: 'vanilla', config: { replay: { tier: 'trace', autoSave: { mode: 'datapipe', experimentId: 'A' } }, replaySrc: null } });
    installReplay({ win, ctx, doc: stubDoc() });
    assert.strictEqual(warns.length, 1, warns.join('\n'));
    assert.ok(warns[0].includes('Fix: ') && warns[0].includes('jsPsych'), warns[0]);
  });

  it('vanilla host with autoSave none or absent, and jsPsych with autoSave: no such warning', () => {
    installReplay({ win, ctx: baseCtx({ host: 'vanilla', config: { replay: { autoSave: { mode: 'none' } }, replaySrc: null } }), doc: stubDoc() });
    installReplay({ win, ctx: baseCtx({ host: 'vanilla' }), doc: stubDoc() });
    installReplay({ win, ctx: baseCtx({ config: { replay: { autoSave: { mode: 'datapipe' } }, replaySrc: null } }), doc: stubDoc() });
    assert.deepStrictEqual(warns, []);
  });

  it('jsPsych: after an autosaving finalize() the recording it saved is returned', async () => {
    const log = [];
    const { ctx, proxy } = await jsPsychCtx(log);
    proxy.inner.getLastRecording = () => RECORDING;
    await proxy.finalize();
    assert.strictEqual(ctx.handlers.replay(), RECORDING);
    assert.deepStrictEqual(warns, []);
  });

  it('inline ch.js with data-replay and no data-replay-src: a catalogue error, no proxy, boot carries on', () => {
    const ctx = baseCtx({ scriptSrc: null });
    const r = installReplay({ win, ctx, doc: stubDoc() });
    assert.strictEqual(ctx.replayProxy, undefined);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('data-replay-src') && errors[0].includes('Fix: '), errors[0]);
    r.startVanilla();   // nothing to start
    assert.strictEqual(ctx.handlers.replay(), null);
  });
});

describe('vanilla replay', () => {
  function fakeStandalone(log) {
    return {
      attach: (cfg) => { log.push('attach'); log.cfg = cfg; return fakeApi(log); }
    };
  }

  it('createVanillaReplay loads, attaches with the defaults, starts the session and the current span', async () => {
    const log = [];
    const doc = stubDoc();
    const ctx = baseCtx({ host: 'vanilla' });
    const p = createVanillaReplay({ win, doc, src: SRC, ctx });
    win.CyborgHunterReplay = fakeStandalone(log);
    doc.appended[0].dispatchEvent(new win.Event('load'));
    const h = await p;
    assert.deepStrictEqual([...log], ['attach', 'startSession', 'startTrial:span-0']);
    assert.deepStrictEqual(log.cfg, { participantId: 'P1', autoSave: { mode: 'none' }, _ownerSavesRecording: true, tier: 'trace' });
    h.endTrial();
    h.startTrial('q1');
    h.stop();
    h.stop();
    h.startTrial('late');   // after stop: ignored
    assert.deepStrictEqual(log.slice(3), ['endTrial', 'startTrial:q1', 'stopSession:finished']);
  });

  it('the recorder\'s own throws stay inside the wrappers', async () => {
    const log = [];
    win.CyborgHunterReplay = fakeStandalone(log);
    const h = await createVanillaReplay({ win, doc: stubDoc(), src: SRC, ctx: baseCtx({ host: 'vanilla' }) });
    h.api.endTrial = () => { throw new Error('invalid lifecycle call'); };
    assert.doesNotThrow(() => h.endTrial());
  });

  it('createVanillaReplay rejects on a load failure', async () => {
    const doc = stubDoc();
    const p = createVanillaReplay({ win, doc, src: SRC, ctx: baseCtx({ host: 'vanilla' }) });
    doc.appended[0].dispatchEvent(new win.Event('error'));
    await assert.rejects(p, /could not load/);
  });

  it('installReplay starts it after DOMContentLoaded; replay() stops, serializes and destroys it', async () => {
    const log = [];
    win.CyborgHunterReplay = fakeStandalone(log);
    const doc = stubDoc();
    doc.readyState = 'loading';
    const ctx = baseCtx({ host: 'vanilla' });
    installReplay({ win, ctx, doc }).startVanilla();
    await flush();
    assert.deepStrictEqual([...log], [], 'waits for DOMContentLoaded');
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await flush();
    assert.ok(ctx.replay, 'the handle is on ctx for the vanilla adapter');
    log.length = 0;
    assert.strictEqual(ctx.handlers.replay(), RECORDING);
    assert.deepStrictEqual([...log], ['stopSession:finished', 'getRecording', 'destroy']);
    ctx.replay.startTrial('after');   // the adapter's next mark: ignored
    assert.deepStrictEqual([...log], ['stopSession:finished', 'getRecording', 'destroy']);
  });

  it('installReplay logs a load failure once and replay() then warns', async () => {
    const doc = stubDoc();
    const ctx = baseCtx({ host: 'vanilla' });
    installReplay({ win, ctx, doc }).startVanilla();
    doc.appended[0].dispatchEvent(new win.Event('error'));
    await flush();
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('Fix: '), errors[0]);
    assert.strictEqual(ctx.replay, undefined);
    assert.strictEqual(ctx.handlers.replay(), null);
    assert.strictEqual(warns.length, 1);
  });
});

// The recorder's own "autoSave.mode is none" warning is silenced under the
// one-liner (recorderConfig's _ownerSavesRecording; it names getRecording(),
// which one-liner users never call), so the one-liner says it itself: one
// console.info at install, or, with data-debug, a part of the debug summary
// (debug.js) instead.
describe('the replay save reminder', () => {
  let infos, origInfo;
  beforeEach(() => { infos = []; origInfo = console.info; console.info = (m) => infos.push(String(m)); });
  afterEach(() => { console.info = origInfo; });

  it('data-replay without data-debug: one console.info at install, on either host', () => {
    installReplay({ win, ctx: baseCtx(), doc: stubDoc() });
    installReplay({ win, ctx: baseCtx({ host: 'vanilla' }), doc: stubDoc() });
    assert.deepStrictEqual(infos, [MESSAGES.replaySaveReminder(), MESSAGES.replaySaveReminder()]);
  });

  it('none with data-debug (the summary says it), with replay off, with no replay URL, or when the recorder saves itself (jsPsych autoSave)', () => {
    installReplay({ win, ctx: baseCtx({ debug: { summary() {} } }), doc: stubDoc() });
    installReplay({ win, ctx: baseCtx({ config: { replay: null, replaySrc: null } }), doc: stubDoc() });
    installReplay({ win, ctx: baseCtx({ scriptSrc: null }), doc: stubDoc() });
    installReplay({ win, ctx: baseCtx({ config: { replay: { autoSave: { mode: 'datapipe' } }, replaySrc: null } }), doc: stubDoc() });
    assert.deepStrictEqual(infos, []);
  });

  it('vanilla with autoSave set: still reminded (autoSave is jsPsych-only)', () => {
    installReplay({ win, ctx: baseCtx({ host: 'vanilla', config: { replay: { autoSave: { mode: 'datapipe' } }, replaySrc: null } }), doc: stubDoc() });
    assert.deepStrictEqual(infos, [MESSAGES.replaySaveReminder()]);
  });
});
