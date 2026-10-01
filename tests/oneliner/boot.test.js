// boot() is everything dist/ch.js does at load: the double-load sentinel,
// config, participant id, a monitor kept inside a trial, guards, host
// detection and the window.CyborgHunter namespace. It never throws into the
// page. Real monitor under happy-dom; bootstrap mirrors segmenter.test.js
// (core signal modules read window/document, so modules load after globals).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { MESSAGES } from '../../src/oneliner/errors.js';
import { VERSION } from '../../src/shared/constants.js';

class StubResizeObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
}

let win, boot, startGuards, buildPublicApi, errors, warns, origError, origWarn, origInfo, ctx;

beforeEach(async () => {
  win = new Window({ url: 'https://lab.example/study.html' });
  global.window = win;
  global.document = win.document;
  global.Node = win.Node;
  global.MutationObserver = win.MutationObserver;
  global.ResizeObserver = StubResizeObserver;
  ({ boot } = await import('../../src/oneliner/boot.js'));
  ({ startGuards } = await import('../../src/oneliner/guards.js'));
  ({ buildPublicApi } = await import('../../src/oneliner/api.js'));
  errors = []; warns = [];
  origError = console.error; origWarn = console.warn; origInfo = console.info;
  console.error = (m) => errors.push(String(m));
  console.warn = (m) => warns.push(String(m));
  console.info = () => {};
  ctx = null;
});

afterEach(() => {
  console.error = origError; console.warn = origWarn; console.info = origInfo;
  if (ctx && ctx.monitor) { try { ctx.monitor.destroy(); } catch { /* already destroyed */ } }
  win.close();
  delete global.window;
  delete global.document;
  delete global.Node;
  delete global.MutationObserver;
  delete global.ResizeObserver;
});

const script = (dataset) => ({ dataset: dataset || {}, src: 'https://cdn/x/ch.js' });

function paste(text) {
  const ta = win.document.createElement('textarea');
  win.document.body.appendChild(ta);
  ta.focus();
  const ev = new win.Event('paste', { bubbles: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
  ta.dispatchEvent(ev);
}

describe('boot', () => {
  it('data-debug shows the badge and logs one summary; the id source is the resolved parameter name', () => {
    const infos = [];
    console.info = (m) => infos.push(String(m));
    win.history.pushState({}, '', '/study.html?workerId=W1');
    ctx = boot({ script: script({ debug: '', guards: 'none' }), win, participantParams: ['workerId'] });
    assert.strictEqual(infos.length, 1);
    assert.match(infos[0], /^Cyborg Hunter active · vanilla mode · 0 mark elements · ID from workerId · honeypot off · friction off$/);
    assert.strictEqual(win.document.getElementById('ch-debug-badge').textContent, infos[0]);
    assert.strictEqual(typeof win.__cyborgHunterDebug.stats().segmentWriteMs.push, 'function');
  });

  it('without data-debug there is no badge, no log, no global and no ctx.debug', () => {
    const infos = [];
    console.info = (m) => infos.push(String(m));
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(win.document.getElementById('ch-debug-badge'), null);
    assert.strictEqual(win.__cyborgHunterDebug, undefined);
    assert.strictEqual(ctx.debug, undefined);
    assert.deepStrictEqual(infos, []);
  });

  it('captures the ch.js tag\'s nonce for the replay script', () => {
    ctx = boot({ script: Object.assign(script({ participantId: 'P1', guards: 'none' }), { nonce: 'xyz' }), win });
    assert.strictEqual(ctx.scriptNonce, 'xyz');
  });

  it('creates a monitor inside a trial, sets the sentinel and the namespace', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.ok(ctx);
    assert.deepStrictEqual(ctx.segmenter.state(), { open: true, segmentIndex: 0, currentTrialId: 'span-0' });
    assert.strictEqual(win.__cyborgHunterLoaded, 'ch.js');
    assert.strictEqual(win.CyborgHunter.VERSION, VERSION);
    assert.ok(Object.isFrozen(win.CyborgHunter));
    assert.strictEqual(ctx.api, win.CyborgHunter);
    assert.strictEqual(ctx.participantId, 'P1');
    assert.strictEqual(ctx.scriptSrc, 'https://cdn/x/ch.js');
    assert.strictEqual(ctx.host, 'vanilla');
    assert.strictEqual(ctx.monitor.getSessionReport().config.participantId, 'P1');
    assert.deepStrictEqual(errors, []);
  });

  it('the boot span records a paste before any host trial exists', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    paste('pasted text');
    assert.strictEqual(ctx.monitor.getSessionReport().pasteCount, 1);
  });

  it('passes the preset and CyborgHunterConfig init() keys to the monitor; the tag wins', () => {
    win.CyborgHunterConfig = { preset: 'permissive', participantId: 'C1', thresholds: { typingSpeedCps: 99 } };
    ctx = boot({ script: script({ preset: 'strict', guards: 'none' }), win });
    const cfg = ctx.monitor.getSessionReport().config;
    assert.strictEqual(cfg.preset, 'strict');
    assert.strictEqual(cfg.thresholds.typingSpeedCps, 99);
    assert.strictEqual(ctx.participantId, 'C1');
  });

  it('reads the participant id from a URL parameter in the injected list', () => {
    win.location.href = 'https://lab.example/study.html?workerId=W9';
    ctx = boot({ script: script({ participantId: 'A1', guards: 'none' }), win, participantParams: ['workerId'] });
    assert.strictEqual(ctx.participantId, 'W9');
    assert.strictEqual(ctx.participantIdSource, 'url:workerId');
  });

  it('a random id is used, and warned about, when no id is found', () => {
    ctx = boot({ script: script({ guards: 'none' }), win });
    assert.match(ctx.participantId, /^ch-[0-9a-f]{12}$/);
    assert.strictEqual(ctx.participantIdSource, 'random');
    assert.ok(warns.includes(MESSAGES.randomId(ctx.participantId)), warns.join('\n'));
  });

  it('selects the jsPsych host when initJsPsych is already defined', () => {
    win.initJsPsych = function () {};
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(ctx.host, 'jspsych');
  });

  it('jsPsych host: boot wraps initJsPsych and the original still runs', () => {
    let called = 0;
    win.initJsPsych = function () { called++; return { data: { addProperties() {} }, run() {} }; };
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    win.initJsPsych({});
    assert.strictEqual(called, 1);
    assert.strictEqual(ctx.jspsych.invoked, true);
    assert.deepStrictEqual(errors, []);
  });

  it('jsPsych host with data-replay: initJsPsych gets the replay proxy extension, loaded from next to ch.js', () => {
    let opts = null;
    win.initJsPsych = function (o) { opts = o; return { data: { addProperties() {} }, run() {} }; };
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none', replay: 'dom' }), win });
    win.initJsPsych({});
    const entry = opts.extensions.find((e) => e.type.info.name === 'cyborg-hunter-replay');
    assert.ok(entry, 'the replay entry is listed');
    assert.strictEqual(entry.type, ctx.replayProxy);
    assert.deepStrictEqual(entry.params, { tier: 'dom' });
    assert.strictEqual(ctx.replaySrc, 'https://cdn/x/cyborg-hunter-replay.js');
    assert.deepStrictEqual(errors, []);
  });

  it('without data-replay no replay entry is listed and CyborgHunter.replay() warns', () => {
    let opts = null;
    win.initJsPsych = function (o) { opts = o; return { data: { addProperties() {} }, run() {} }; };
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    win.initJsPsych({});
    assert.ok(!opts.extensions.some((e) => e.type.info.name === 'cyborg-hunter-replay'));
    assert.strictEqual(win.CyborgHunter.replay(), null);
    assert.ok(warns.some((w) => w.includes('data-replay')), warns.join('\n'));
  });

  it('a script that is null (no document.currentScript) boots with defaults', () => {
    ctx = boot({ script: null, win });
    assert.ok(ctx);
    assert.strictEqual(ctx.scriptSrc, null);
    assert.strictEqual(ctx.segmenter.state().open, true);
  });

  it('double load: refuses to start a second monitor and leaves the namespace alone', () => {
    const existing = { from: 'min.js' };
    win.__cyborgHunterLoaded = 'cyborg-hunter.min.js';
    win.CyborgHunter = existing;
    let created = 0;
    const r = boot({ script: script({ participantId: 'P1' }), win, monitorFactory: () => { created++; return {}; } });
    assert.strictEqual(r, null);
    assert.deepStrictEqual(errors, [MESSAGES.doubleLoad('cyborg-hunter.min.js', 'ch.js')]);
    assert.strictEqual(win.CyborgHunter, existing);
    assert.strictEqual(win.__cyborgHunterLoaded, 'cyborg-hunter.min.js');
    assert.strictEqual(created, 0);
  });

  it('a failure inside boot is logged as bootFailed and never thrown to the page', () => {
    let r;
    assert.doesNotThrow(() => {
      r = boot({ script: script({ participantId: 'P1' }), win, monitorFactory: () => { throw new Error('kaboom'); } });
    });
    assert.strictEqual(r, null);
    assert.deepStrictEqual(errors, [MESSAGES.bootFailed('kaboom')]);
    assert.strictEqual(win.CyborgHunter, undefined);
    assert.strictEqual(win.__cyborgHunterLoaded, undefined);
  });

  it('a failure after the monitor exists destroys it (no orphan listeners)', () => {
    let destroyed = 0;
    const fakeMonitor = {
      startSession() { throw new Error('no session'); },
      destroy() { destroyed++; }
    };
    const r = boot({ script: script({ participantId: 'P1' }), win, monitorFactory: () => fakeMonitor });
    assert.strictEqual(r, null);
    assert.strictEqual(destroyed, 1);
    assert.deepStrictEqual(errors, [MESSAGES.bootFailed('no session')]);
  });

  it('CyborgHunter.init() after boot logs manualInitOnOneLiner and the monitor stays open', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    const ret = win.CyborgHunter.init({ participantId: 'X' });
    assert.strictEqual(ret, win.CyborgHunter);
    assert.deepStrictEqual(errors, [MESSAGES.manualInitOnOneLiner()]);
    assert.strictEqual(ctx.segmenter.state().open, true);
    paste('still recorded');
    assert.strictEqual(ctx.monitor.getSessionReport().pasteCount, 1);
    assert.strictEqual(ctx.monitor.getSessionReport().config.participantId, 'P1');
  });

  // Manual mode with ch.js alone (no cyborg-hunter.min.js after it): the
  // jsPsych adapter has handed over (ctx.host 'manual'), and the researcher's
  // extension calls window.CyborgHunter.init(), which must return a real
  // monitor instead of explaining itself.
  it('manual mode: CyborgHunter.init() returns a core monitor and logs nothing', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    ctx.segmenter.abandon();
    ctx.monitor.destroy();
    ctx.host = 'manual';
    const m = win.CyborgHunter.init({ participantId: 'X' });
    try {
      assert.notStrictEqual(m, win.CyborgHunter);
      assert.strictEqual(typeof m.startSession, 'function');
      m.startSession();
      assert.strictEqual(m.getSessionReport().config.participantId, 'X');
      assert.deepStrictEqual(errors, []);
    } finally {
      m.destroy();
    }
  });

  // On the jsPsych host the injected guard extensions own the guards: their
  // initialize() calls GuardHoneypot.init and friction's setJsPsych. Boot
  // starting them too would init the honeypot twice (the second init resets
  // its violation log) and leave friction observe-only past its entry trial.
  it('jsPsych host: boot leaves both guards to the jsPsych extensions', async () => {
    const calls = [];
    win.initJsPsych = function () {};
    win.GuardHoneypot = { init: () => calls.push('honeypot.init') };
    win.GuardFriction = { start: () => { calls.push('friction.start'); return 'T'; }, injectRefusalNotices: () => calls.push('friction.notices'), onViolation: () => () => {} };
    ctx = boot({ script: script({ participantId: 'P1', guards: 'honeypot,friction' }), win });
    await Promise.resolve();
    assert.strictEqual(ctx.host, 'jspsych');
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(win._guardFrictionToken, undefined);
  });

  it('vanilla host: boot starts the honeypot, friction\'s refusal notices (once) and friction observe-only', async () => {
    const calls = [];
    win.GuardHoneypot = { init: (o) => calls.push(['honeypot.init', o.jsPsych]) };
    win.GuardFriction = { start: (o) => { calls.push(['friction.start', o.observeOnly]); return 'T'; }, injectRefusalNotices: () => calls.push(['friction.notices']), onViolation: () => () => {} };
    ctx = boot({ script: script({ participantId: 'P1', guards: 'honeypot,friction' }), win });
    await Promise.resolve();
    assert.strictEqual(ctx.host, 'vanilla');
    assert.deepStrictEqual(calls, [['honeypot.init', null], ['friction.notices'], ['friction.start', true]]);
  });

  it('starts the honeypot guard by default', () => {
    const calls = [];
    win.GuardHoneypot = { init: (o) => calls.push(o) };
    ctx = boot({ script: script({ participantId: 'P1' }), win });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].jsPsych, null);
  });
});

describe('public namespace', () => {
  function fakeCtx() {
    const marks = [];
    return {
      marks,
      ctx: { handlers: { mark: (id) => { marks.push(id); return 'marked'; } }, win: {} }
    };
  }

  it('exposes the documented members, frozen', () => {
    const api = buildPublicApi(fakeCtx().ctx);
    for (const k of ['VERSION', 'mark', 'startTrial', 'endTrial', 'data', 'replay', 'startFriction',
      'frictionEntryTrial', 'init', 'preventTextSelection', 'addHoneypot', 'setAltText']) {
      assert.ok(k in api, k);
    }
    assert.strictEqual(api.VERSION, VERSION);
    assert.ok(Object.isFrozen(api));
  });

  it('startTrial(opts) ≡ mark(opts.trialId); endTrial() ≡ mark()', () => {
    const f = fakeCtx();
    const api = buildPublicApi(f.ctx);
    assert.strictEqual(api.startTrial({ trialId: 'q1' }), 'marked');
    api.startTrial();
    api.endTrial();
    api.mark('q2');
    assert.deepStrictEqual(f.marks, ['q1', undefined, undefined, 'q2']);
  });

  it('host calls are no-ops until a host adapter wires them', () => {
    const api = buildPublicApi({ handlers: {}, win: {} });
    assert.strictEqual(api.mark('q1'), undefined);
    assert.strictEqual(api.data(), undefined);
    assert.strictEqual(api.replay(), undefined);
    assert.strictEqual(api.startFriction(), undefined);
  });

  it('frictionEntryTrial delegates to GuardFriction.createEntryTrial', () => {
    const trial = { type: 'x' };
    const api = buildPublicApi({ handlers: {}, win: { GuardFriction: { createEntryTrial: (o) => (o.msg === 'hi' ? trial : null) } } });
    assert.strictEqual(api.frictionEntryTrial({ msg: 'hi' }), trial);
  });
});

describe('guards', () => {
  function fakes() {
    const log = [];
    const friction = {
      start: (o) => { log.push(['friction.start', o]); return 'TOKEN'; },
      injectRefusalNotices: () => log.push(['friction.notices']),
      onViolation: () => () => {}
    };
    const honeypot = { init: (o) => log.push(['honeypot.init', o]) };
    return { log, friction, honeypot };
  }

  it('honeypot on, friction off by default: honeypot init at once with the friction core', () => {
    const f = fakes();
    const w = { GuardHoneypot: f.honeypot, GuardFriction: f.friction };
    startGuards({ win: w, doc: { body: {} }, guards: { honeypot: true, friction: false }, debug: false });
    assert.deepStrictEqual(f.log, [['honeypot.init', { jsPsych: null, friction: f.friction, debug: false }]]);
  });

  it('friction observe-only starts in a microtask (after the honeypot subscribed) and stashes its token', async () => {
    const f = fakes();
    const w = { GuardHoneypot: f.honeypot, GuardFriction: f.friction };
    startGuards({ win: w, doc: { body: {} }, guards: { honeypot: true, friction: true }, debug: true });
    assert.deepStrictEqual(f.log.map((e) => e[0]), ['honeypot.init', 'friction.notices']);
    await Promise.resolve();
    assert.deepStrictEqual(f.log.map((e) => e[0]), ['honeypot.init', 'friction.notices', 'friction.start']);
    assert.deepStrictEqual(f.log[2][1], { jsPsych: null, observeOnly: true, debug: true });
    assert.strictEqual(w._guardFrictionToken, 'TOKEN');
    assert.ok(!Object.keys(w).includes('_guardFrictionToken'), 'token slot is non-enumerable');
  });

  it('without a body yet, both guards wait for DOMContentLoaded, honeypot first', async () => {
    const f = fakes();
    const listeners = {};
    const doc = { body: null, addEventListener: (t, fn) => { listeners[t] = fn; } };
    const w = { GuardHoneypot: f.honeypot, GuardFriction: f.friction };
    startGuards({ win: w, doc, guards: { honeypot: true, friction: true }, debug: false });
    await Promise.resolve();
    assert.deepStrictEqual(f.log, []);
    listeners.DOMContentLoaded();
    await Promise.resolve();
    assert.deepStrictEqual(f.log.map((e) => e[0]), ['honeypot.init', 'friction.notices', 'friction.start']);
  });

  it("guards 'none' starts nothing; missing guard cores are skipped", async () => {
    const f = fakes();
    startGuards({ win: { GuardHoneypot: f.honeypot, GuardFriction: f.friction }, doc: { body: {} }, guards: { honeypot: false, friction: false } });
    await Promise.resolve();
    assert.deepStrictEqual(f.log, []);
    assert.doesNotThrow(() => startGuards({ win: {}, doc: { body: {} }, guards: { honeypot: true, friction: true } }));
    await Promise.resolve();
  });

  it('a guard that throws is reported loudly and does not stop the other', async () => {
    const f = fakes();
    const w = { GuardHoneypot: { init: () => { throw new Error('hp broke'); } }, GuardFriction: f.friction };
    startGuards({ win: w, doc: { body: {} }, guards: { honeypot: true, friction: true } });
    await Promise.resolve();
    assert.deepStrictEqual(errors, [MESSAGES.guardFailed('honeypot', 'hp broke')]);
    assert.deepStrictEqual(f.log.map((e) => e[0]), ['friction.notices', 'friction.start']);
  });
});

// A second copy of a guard core (ch.js bundles both, so ch.js plus an
// extension-guard-*.js tag, in either order) used to throw "Cannot redefine
// property". Each core now keeps the
// first definition and logs one loud error instead. The query string makes
// Node evaluate the module a second time, like a second <script> tag.
describe('guard cores on a second load', () => {
  for (const [file, name] of [['extension-guard-honeypot.js', 'GuardHoneypot'], ['extension-guard-friction.js', 'GuardFriction']]) {
    it(name + ': keeps the first definition and logs a catalogue error', async () => {
      global.Document = win.Document;
      global.requestAnimationFrame = win.requestAnimationFrame.bind(win);
      try {
        const base = '../../src/jspsych/' + file;
        await import(base + '?load=first-' + name);
        const first = win[name];
        assert.ok(first);
        await assert.doesNotReject(import(base + '?load=second-' + name));
        assert.strictEqual(win[name], first);
        assert.strictEqual(errors.length, 1);
        // Order-neutral: ch.js may be the first or the second copy.
        assert.match(errors[0], new RegExp('^\\[cyborg-hunter\\] Not redefining ' + name + ': ' + name +
          ' is already defined, so two scripts on this page include the .+\\. Fix: keep one of them .+\\. https://.+advanced-integration\\.md#double-load$'));
        assert.ok(!errors[0].includes('loaded after'), errors[0]);
      } finally {
        delete global.Document;
        delete global.requestAnimationFrame;
      }
    });
  }
});

// Where ch.js sits relative to jspsych.js and the experiment code decides
// whether initJsPsych can be wrapped. jsPsych 7.3.1 sets the <html jspsych>
// attribute only once run() is past prepareDom (which waits for window load,
// :2885-2888) and loadExtensions (:2693-2696), so "initJsPsych ran without
// us" is detected when that attribute appears, not at DOMContentLoaded.
describe('host diagnosis', () => {
  const tick = () => new Promise((r) => setTimeout(r, 10));
  function loading() {
    Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true });
  }

  it('not hookable: jsPsych starts running but initJsPsych never went through ch.js', async () => {
    const original = function () {};
    win.initJsPsych = original;
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    win.document.documentElement.setAttribute('jspsych', 'present');
    await tick();
    assert.deepStrictEqual(errors, [MESSAGES.notHookable()]);
    assert.strictEqual(ctx.host, 'vanilla');
    assert.strictEqual(win.initJsPsych, original, 'the wrapper is removed');
  });

  it('no error when initJsPsych went through ch.js before jsPsych started', async () => {
    win.initJsPsych = function () { return { data: { addProperties() {} }, run() {} }; };
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    win.initJsPsych({});
    win.document.documentElement.setAttribute('jspsych', 'present');
    await tick();
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(ctx.host, 'jspsych');
  });

  it('loaded above jspsych.js: initJsPsych appears before DOMContentLoaded', async () => {
    loading();
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(ctx.host, 'vanilla');
    win.initJsPsych = function () {};
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await tick();
    assert.deepStrictEqual(errors, [MESSAGES.loadedAboveJsPsych()]);
    assert.strictEqual(ctx.host, 'vanilla');
  });

  it('a page without jsPsych stays quiet', async () => {
    loading();
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await tick();
    assert.deepStrictEqual(errors, []);
  });
});

// data-debug: exactly one console summary per page, with the right count.
describe('data-debug summary count', () => {
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const debugScript = () => script({ debug: '', participantId: 'P1', guards: 'none' });
  const badge = () => win.document.getElementById('ch-debug-badge').textContent;
  let infos;
  beforeEach(() => { infos = []; console.info = (m) => infos.push(String(m)); });

  it('jsPsych: one summary, logged after the walk, showing the planned count', () => {
    let js;
    win.initJsPsych = function () { js = { data: { addProperties() {} }, run() {} }; return js; };
    ctx = boot({ script: debugScript(), win });
    assert.strictEqual(infos.length, 0, 'nothing logged at boot on jsPsych');
    win.initJsPsych({});
    js.run([{ type: function () {} }, { type: function () {} }, { timeline: [{ type: function () {} }] }]);
    assert.strictEqual(infos.length, 1);
    assert.match(infos[0], /jsPsych detected · 3 trials instrumented/);
  });

  it('jsPsych: the badge shows written/planned and updates per row without new logs', () => {
    let js;
    win.initJsPsych = function () { js = { data: { addProperties() {} }, run() {} }; return js; };
    ctx = boot({ script: debugScript(), win });
    win.initJsPsych({});
    js.run([{ type: function () {} }, { type: function () {} }]);
    assert.match(badge(), /0\/2 trials/);
    ctx.jspsych.segmentsWritten = 1;
    ctx.debug.refresh();
    assert.match(badge(), /1\/2 trials/);
    ctx.jspsych.segmentsWritten = 2;
    ctx.debug.refresh();
    assert.match(badge(), /2\/2 trials/);
    assert.strictEqual(infos.length, 1);
  });

  it('jsPsych: a failing timeline walk still logs the one summary', () => {
    let js;
    win.initJsPsych = function () { js = { data: { addProperties() {} }, run() {} }; return js; };
    ctx = boot({ script: debugScript(), win });
    win.initJsPsych({});
    const bad = { get timeline() { throw new Error('boom'); } };
    js.run([bad]);
    assert.strictEqual(infos.filter((m) => m.startsWith('Cyborg Hunter active')).length, 1);
  });

  it('jsPsych manual mode: run() is not wrapped, so the hand-over logs the one summary', () => {
    win.initJsPsych = function () { return { data: { addProperties() {} }, run() {} }; };
    ctx = boot({ script: debugScript(), win });
    class Manual {}
    Manual.info = { name: 'cyborg-hunter' };
    win.initJsPsych({ extensions: [{ type: Manual }] });
    assert.strictEqual(infos.filter((m) => m.startsWith('Cyborg Hunter active')).length, 1);
  });

  it('vanilla with ch.js in <head>: the summary counts marks after DOMContentLoaded', () => {
    Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true });
    ctx = boot({ script: debugScript(), win });
    assert.strictEqual(infos.length, 0, 'not logged before the DOM is parsed');
    win.document.body.innerHTML = '<button data-ch-trial="a"></button><button data-ch-trial="b"></button>';
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    assert.strictEqual(infos.length, 1);
    assert.match(infos[0], /vanilla mode · 2 mark elements/);
  });

  it('not hookable fallback: one summary, from the vanilla path', async () => {
    win.initJsPsych = function () {};
    ctx = boot({ script: debugScript(), win });
    assert.strictEqual(infos.length, 0);
    win.document.documentElement.setAttribute('jspsych', 'present');
    await tick();
    assert.strictEqual(infos.length, 1);
    assert.match(infos[0], /vanilla mode/);
  });
});
