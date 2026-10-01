// The vanilla host (any page without jsPsych): manual marks (data-ch-trial,
// CyborgHunter.mark()), page loads (form submit, pagehide), the
// cyborgHunterData hidden input, CyborgHunter.data(), and per-tab continuity
// across page loads through sessionStorage. Real monitor and segmenter under
// happy-dom, booted the way dist/ch.js boots (boot.test.js bootstrap: core
// signal modules read window/document, so modules load after the globals).
// The guard cores are fakes: the real ones bind to the first window that
// imports them.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { MESSAGES } from '../../src/oneliner/errors.js';
import { VERSION } from '../../src/shared/constants.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';

class StubResizeObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
}

const KEY = 'cyborg-hunter:oneliner:P1';
let win, boot, errors, warns, orig, contexts;

function useWindow(w) {
  win = w;
  global.window = w;
  global.document = w.document;
  global.Node = w.Node;
  global.MutationObserver = w.MutationObserver;
}

beforeEach(async () => {
  useWindow(new Window({ url: 'https://lab.example/page1.html' }));
  global.ResizeObserver = StubResizeObserver;
  ({ boot } = await import('../../src/oneliner/boot.js'));
  errors = []; warns = []; contexts = [];
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (m) => errors.push(String(m));
  console.warn = (m) => warns.push(String(m));
  console.info = () => {};
});

afterEach(() => {
  delete performance.timeOrigin;   // the own property laterPage() added; the prototype getter is back
  // Still captured: a page-1 monitor the test destroyed itself logs a second destroy.
  for (const c of contexts) {
    if (c && c.vanilla) c.vanilla.teardown();
    if (c && c.monitor) { try { c.monitor.destroy(); } catch { /* already destroyed */ } }
  }
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  win.close();
  delete global.window;
  delete global.document;
  delete global.Node;
  delete global.MutationObserver;
  delete global.ResizeObserver;
});

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// Every page load has its own performance.timeOrigin; one node process has
// one. Shift it for the rest of the test (restored in afterEach).
const realOrigin = performance.timeOrigin;
function laterPage(ms) {
  Object.defineProperty(performance, 'timeOrigin', { value: realOrigin + ms, configurable: true });
}

function start(dataset) {
  const ctx = boot({ script: { dataset: Object.assign({ participantId: 'P1', guards: 'none' }, dataset), src: 'https://cdn/x/ch.js' }, win });
  contexts.push(ctx);
  return ctx;
}

function el(html) {
  const host = win.document.createElement('div');
  host.innerHTML = html;
  win.document.body.appendChild(host);
  return host.firstElementChild;
}

function paste(text) {
  const ta = el('<textarea></textarea>');
  ta.focus();
  const ev = new win.Event('paste', { bubbles: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
  ta.dispatchEvent(ev);
}

function click(node) {
  node.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// A form whose submit the test keeps on the page (no navigation in happy-dom).
function form() {
  const f = el('<form method="post" action="/submit"><textarea name="answer"></textarea></form>');
  f.addEventListener('submit', (e) => e.preventDefault());
  return f;
}

function submit(f) {
  f.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
}

function fakeHoneypot(violations, aiUse = false, aiReport = '') {
  return {
    init() {},
    getSessionSummary: () => ({
      guard_assistance_violations_session: JSON.stringify(violations),
      guard_assistance_violation_count_session: violations.length,
      ai_use_session: aiUse,
      ai_report_session: aiReport
    })
  };
}

describe('vanilla host: marks', () => {
  it('a data-ch-trial click closes the open span as a manual segment and opens the named one', () => {
    const ctx = start();
    const btn = el('<button data-ch-trial="q2">Next</button>');
    click(btn);
    const trials = ctx.vanilla.blob().trials;
    assert.strictEqual(trials.length, 1);
    assert.strictEqual(trials[0].trialId, 'span-0');
    assert.strictEqual(trials[0].integritySegment.source, 'manual');
    assert.strictEqual(trials[0].integritySegment.segmentIndex, 0);
    assert.deepStrictEqual(ctx.segmenter.state(), { open: true, segmentIndex: 1, currentTrialId: 'q2' });

    paste('answer text');
    const blob = win.CyborgHunter.data();
    assert.strictEqual(blob.trials.length, 2);
    assert.strictEqual(blob.trials[1].trialId, 'q2');
    assert.strictEqual(blob.trials[1].integrity.pasteEvents.length, 1);
    assert.strictEqual(blob.trials[1].integrityPasteCount, 1);
    assert.strictEqual(blob.trials[0].integrity.pasteEvents.length, 0);
    assert.deepStrictEqual(errors, []);
  });

  it('a click inside a marked element counts; a mark without a name opens span-<index>', () => {
    const ctx = start();
    const btn = el('<button data-ch-trial=""><span>Next</span></button>');
    click(btn.firstElementChild);
    assert.deepStrictEqual(ctx.segmenter.state().currentTrialId, 'span-1');
  });

  it('CyborgHunter.mark(id), startTrial({ trialId }) and endTrial() cut segments', () => {
    const ctx = start();
    win.CyborgHunter.mark('q1');
    win.CyborgHunter.startTrial({ trialId: 'q2' });
    win.CyborgHunter.endTrial();
    assert.deepStrictEqual(ctx.vanilla.blob().trials.map((t) => t.trialId), ['span-0', 'q1', 'q2']);
    assert.strictEqual(ctx.segmenter.state().currentTrialId, 'span-3');
  });

  it('CyborgHunter.data() closes the current segment and returns a Shape-1 blob the CLI reads', () => {
    win.GuardHoneypot = fakeHoneypot([]);
    start({ guards: 'honeypot' });
    paste('x');
    const blob = win.CyborgHunter.data();
    assert.strictEqual(blob.participantId, 'P1');
    assert.strictEqual(blob.libraryVersion, VERSION);
    assert.deepStrictEqual(blob.cyborgHunterOneLiner, { version: VERSION, host: 'vanilla', pageCount: 1 });
    assert.strictEqual(blob.trials[0].integrity.pasteEvents.length, 1);
    assert.strictEqual(blob.trials[0].integritySegment.segmentIndex, 0);
    assert.ok('ai_use_session' in blob, 'honeypot session summary at the top level');
    assert.strictEqual(blob.guard_assistance_violation_count_session, 0);
    for (const k of ['integrityCopyCount', 'integrityDropCount', 'integritySoftScore', 'integrityAnyHardTriggered']) {
      assert.ok(k in blob.trials[0], k);
    }

    const out = extractIntegrityData(JSON.parse(JSON.stringify(blob)), {});
    assert.deepStrictEqual(out.warnings, []);
    assert.ok(out.session, 'session found');
    assert.strictEqual(out.session.pasteCount, 1);
    assert.strictEqual(out.trials[0].pasteEvents.length, 1);
    assert.strictEqual(out.participantId, 'P1');
    assert.strictEqual(out.trials.length, 1);
  });

  it('without the honeypot the blob carries no honeypot keys', () => {
    start();
    assert.ok(!('ai_use_session' in win.CyborgHunter.data()));
  });
});

describe('vanilla host: forms and page loads', () => {
  it('submit cuts a page segment and writes the blob into one cyborgHunterData hidden input', () => {
    const ctx = start();
    const f = form();
    submit(f);
    let inputs = f.querySelectorAll('input[name=cyborgHunterData]');
    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(inputs[0].type, 'hidden');
    let blob = JSON.parse(inputs[0].value);
    assert.strictEqual(blob.trials.length, 1);
    assert.strictEqual(blob.trials[0].integritySegment.source, 'page');

    // A second submit (the first one failed validation) reuses the input.
    submit(f);
    inputs = f.querySelectorAll('input[name=cyborgHunterData]');
    assert.strictEqual(inputs.length, 1);
    assert.strictEqual(JSON.parse(inputs[0].value).trials.length, 2);
    assert.ok(win.sessionStorage.getItem(KEY), 'submit persists the session');
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
  });

  it('a form post fires submit then pagehide: pagehide does not cut an empty extra segment', () => {
    const ctx = start();
    const f = el('<form method="post" action="/submit"></form>');
    // Not prevented: the page would navigate.
    f.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials.length, 1);
  });

  it('a submit the page prevents (validation) leaves pagehide free to cut', () => {
    const ctx = start();
    submit(form());
    paste('later');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.strictEqual(saved.trials[1].integrity.pasteEvents.length, 1);
  });

  it('page loads: the next page restores the index, the earlier trials and the page count', () => {
    const ctx1 = start();
    paste('page one');
    win.CyborgHunter.mark('q1');
    win.dispatchEvent(new win.Event('pagehide'));
    const saved = win.sessionStorage.getItem(KEY);
    ctx1.vanilla.teardown();
    ctx1.monitor.destroy();

    // happy-dom's sessionStorage is per Window: carry the tab's storage over.
    // One node process has one performance.timeOrigin; page 2 gets its own.
    const page2 = new Window({ url: 'https://lab.example/page2.html' });
    page2.sessionStorage.setItem(KEY, saved);
    win.close();
    useWindow(page2);
    laterPage(30000);
    const ctx2 = start();
    assert.deepStrictEqual(ctx2.segmenter.state(), { open: true, segmentIndex: 2, currentTrialId: 'span-2' });
    assert.strictEqual(ctx2.vanilla.blob().trials.length, 2);

    el('<button data-ch-trial="page2-q1">Next</button>').click();
    const blob = win.CyborgHunter.data();
    assert.deepStrictEqual(blob.trials.map((t) => t.trialId), ['span-0', 'q1', 'span-2', 'page2-q1']);
    assert.deepStrictEqual(blob.trials.map((t) => t.integritySegment.segmentIndex), [0, 1, 2, 3]);
    assert.strictEqual(blob.cyborgHunterOneLiner.pageCount, 2);

    const origins = blob.trials.map((t) => t.integritySegment.pageOrigin);
    assert.strictEqual(origins[2] - origins[0], 30000);
    const out = extractIntegrityData(JSON.parse(JSON.stringify(blob)), {});
    assert.deepStrictEqual(out.warnings, []);
    assert.strictEqual(out.session.pasteCount, 1, 'counters add up across pages');
  });

  it('honeypot evidence from earlier pages is kept and tagged with its page origin', () => {
    win.GuardHoneypot = fakeHoneypot([{ reason: 'not_fullscreen', start: 100, end: 200, duration: 100 }], false, 'page one note');
    const ctx1 = start({ guards: 'honeypot' });
    win.dispatchEvent(new win.Event('pagehide'));
    const saved = win.sessionStorage.getItem(KEY);
    ctx1.vanilla.teardown();
    ctx1.monitor.destroy();

    const page2 = new Window({ url: 'https://lab.example/page2.html' });
    page2.sessionStorage.setItem(KEY, saved);
    win.close();
    useWindow(page2);
    laterPage(30000);
    win.GuardHoneypot = fakeHoneypot([{ reason: 'tab_hidden', start: 50, end: 60, duration: 10 }], true, '');
    start({ guards: 'honeypot' });
    const blob = win.CyborgHunter.data();
    const v = JSON.parse(blob.guard_assistance_violations_session);
    assert.deepStrictEqual(v.map((x) => [x.reason, x.start]), [['not_fullscreen', 100], ['tab_hidden', 50]]);
    assert.strictEqual(v[1].pageOrigin - v[0].pageOrigin, 30000);
    // The CLI puts both on the first page's clock.
    const out = extractIntegrityData(JSON.parse(JSON.stringify(blob)), {});
    assert.deepStrictEqual(out.guardFriction.violations.map((x) => x.t), [100, 30050]);
    assert.strictEqual(blob.guard_assistance_violation_count_session, 2);
    assert.strictEqual(blob.ai_use_session, true);
    assert.strictEqual(blob.ai_report_session, 'page one note');

    // persist() twice on one page does not duplicate that page's violations.
    win.dispatchEvent(new win.Event('pagehide'));
    win.dispatchEvent(new win.Event('pagehide'));
    const again = JSON.parse(JSON.parse(win.sessionStorage.getItem(KEY)).honeypot.guard_assistance_violations_session);
    assert.strictEqual(again.length, 2);
  });

  it('another participant id on the same tab starts fresh', () => {
    win.sessionStorage.setItem('cyborg-hunter:oneliner:OTHER', JSON.stringify({ segmentIndex: 5, pageCount: 3, trials: [{}] }));
    const ctx = start();
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 0);
    assert.strictEqual(ctx.vanilla.blob().cyborgHunterOneLiner.pageCount, 1);
  });

  it('unreadable or blocked sessionStorage never throws into the page', () => {
    win.sessionStorage.setItem(KEY, '{not json');
    const ctx = start();
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 0);
    Object.defineProperty(win, 'sessionStorage', { get() { throw new Error('blocked'); }, configurable: true });
    assert.doesNotThrow(() => win.dispatchEvent(new win.Event('pagehide')));
    assert.strictEqual(win.CyborgHunter.data().trials.length, 2);
  });

  it('warns once when the saved session approaches the sessionStorage limit', async () => {
    const { installVanillaAdapter } = await import('../../src/oneliner/adapters/vanilla.js');
    const ctx = start();
    ctx.vanilla.teardown();
    const small = installVanillaAdapter({ win, ctx, warnChars: 10 });
    small.persist();
    small.persist();
    assert.deepStrictEqual(warns.filter((w) => w.includes('sessionStorage')), [MESSAGES.storageNearlyFull()]);
    small.teardown();
  });
});

describe('vanilla host: boot timing', () => {
  it('ch.js in <head>: boots before <body> exists and the mark listeners work after DOMContentLoaded', () => {
    Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true });
    win.document.documentElement.removeChild(win.document.body);
    let ctx;
    assert.doesNotThrow(() => { ctx = start(); });
    assert.ok(ctx);
    const body = win.document.createElement('body');
    win.document.documentElement.appendChild(body);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    click(el('<button data-ch-trial="q1">Go</button>'));
    assert.strictEqual(ctx.segmenter.state().currentTrialId, 'q1');
    assert.deepStrictEqual(errors, []);
  });
});

describe('ch.js in <head> (no body yet)', () => {
  function head() {
    Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true });
    win.document.documentElement.removeChild(win.document.body);
  }
  function bodyAndReady() {
    win.document.documentElement.appendChild(win.document.createElement('body'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  }

  it('the session waits for DOMContentLoaded; a mark before it is a quiet no-op', () => {
    head();
    const ctx = start();
    assert.strictEqual(ctx.segmenter.state().open, false);
    assert.strictEqual(win.CyborgHunter.mark('early'), undefined);
    bodyAndReady();
    assert.deepStrictEqual(ctx.segmenter.state(), { open: true, segmentIndex: 0, currentTrialId: 'span-0' });
    assert.deepStrictEqual(errors, []);
  });

  it('jsPsych host: initJsPsych is wrapped at once, the span opens at DOMContentLoaded', () => {
    head();
    const orig = function () { return { data: { addProperties() {} }, run() {} }; };
    win.initJsPsych = orig;
    const ctx = start();
    assert.notStrictEqual(win.initJsPsych, orig);
    win.initJsPsych({});
    assert.strictEqual(ctx.jspsych.invoked, true);
    bodyAndReady();
    assert.strictEqual(ctx.segmenter.state().open, true);
    assert.deepStrictEqual(errors, []);
  });

  it('manual mode handed over before DOMContentLoaded: the session is not started on a destroyed monitor', () => {
    head();
    win.initJsPsych = function () { return { data: { addProperties() {} }, run() {} }; };
    const ctx = start();
    win.initJsPsych({ extensions: [{ type: class { static info = { name: 'cyborg-hunter' }; } }] });
    assert.strictEqual(ctx.host, 'manual');
    assert.doesNotThrow(bodyAndReady);
    assert.strictEqual(ctx.segmenter.state().open, false);
    assert.deepStrictEqual(errors, []);
  });
});

describe('vanilla host: friction', () => {
  function fakeFriction(log) {
    return {
      start: (o) => { log.push(['start', o.observeOnly]); return 'TOKEN' + log.length; },
      requestFullscreen: () => log.push(['requestFullscreen']),
      injectRefusalNotices: () => log.push(['injectRefusalNotices']),
      onViolation: () => () => {}
    };
  }

  it('enabled: refusal notices once at boot, observe-only until data-ch-friction-start, then enforcing', async () => {
    const log = [];
    win.GuardFriction = fakeFriction(log);
    start({ guards: 'friction' });
    await tick();
    assert.deepStrictEqual(log, [['injectRefusalNotices'], ['start', true]]);
    click(el('<button data-ch-friction-start>Begin</button>'));
    assert.deepStrictEqual(log.slice(2), [['requestFullscreen']], 'fullscreen is requested inside the click');
    await tick(150);
    assert.deepStrictEqual(log.slice(2), [['requestFullscreen'], ['start', false]]);
    assert.strictEqual(win._guardFrictionToken, 'TOKEN4');
    assert.strictEqual(log.filter((e) => e[0] === 'injectRefusalNotices').length, 1);
  });

  it('CyborgHunter.startFriction() without friction enabled warns and still starts enforcing', async () => {
    const log = [];
    win.GuardFriction = fakeFriction(log);
    start();
    win.CyborgHunter.startFriction();
    await tick(150);
    assert.deepStrictEqual(log, [['requestFullscreen'], ['start', false]]);
    assert.deepStrictEqual(warns, [MESSAGES.frictionStartWithoutFriction()]);
  });
});

describe('host-specific calls', () => {
  it('jsPsych host: mark() and data() warn and do nothing', () => {
    win.initJsPsych = function () {};
    const ctx = start();
    assert.strictEqual(win.CyborgHunter.mark('q1'), undefined);
    assert.strictEqual(win.CyborgHunter.data(), undefined);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 0);
    assert.deepStrictEqual(warns, [
      '[cyborg-hunter] mark()/data() are vanilla-mode calls; jsPsych trials are segmented automatically',
      '[cyborg-hunter] mark()/data() are vanilla-mode calls; jsPsych trials are segmented automatically'
    ]);
  });

  it('not hookable (jsPsych ran without ch.js): falls back to vanilla, with its guards and handlers', async () => {
    const log = [];
    win.GuardHoneypot = { init: () => log.push('honeypot.init'), getSessionSummary: fakeHoneypot([]).getSessionSummary };
    win.initJsPsych = function () {};
    const ctx = start({ guards: 'honeypot' });
    assert.deepStrictEqual(log, []);
    win.document.documentElement.setAttribute('jspsych', 'present');
    await tick();
    assert.strictEqual(ctx.host, 'vanilla');
    assert.deepStrictEqual(log, ['honeypot.init']);
    paste('x');
    const blob = win.CyborgHunter.data();
    assert.strictEqual(blob.trials[0].integrity.pasteEvents.length, 1);
    assert.ok('ai_use_session' in blob);
  });
});
