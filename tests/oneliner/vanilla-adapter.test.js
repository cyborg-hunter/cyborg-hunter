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
import { attach as attachRecorder } from '../../src/replay/index.js';
import { validateStrict } from '../../src/shared/schema-v2-validator.js';

class StubResizeObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
}

const KEY = 'cyborg-hunter:oneliner:session:P1';
const PID_KEY = 'cyborg-hunter:oneliner:pid';
let win, boot, errors, warns, orig, contexts, nativeFormSubmit;

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
  // happy-dom shares element classes between Windows: put submit() back after each test.
  nativeFormSubmit = win.HTMLFormElement.prototype.submit;
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (m) => errors.push(String(m));
  console.warn = (m) => warns.push(String(m));
  console.info = () => {};
});

afterEach(() => {
  delete performance.timeOrigin;   // the own property laterPage() added; the prototype getter is back
  // Still captured: a page-1 monitor the test destroyed itself logs a second destroy.
  for (const c of contexts.slice().reverse()) {   // last wrap of submit() first
    if (c && c.vanilla) c.vanilla.teardown();
    if (c && c.monitor) { try { c.monitor.destroy(); } catch { /* already destroyed */ } }
  }
  win.HTMLFormElement.prototype.submit = nativeFormSubmit;
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

  // ch.js cuts at a mark from its own click listener on the document. The
  // mouse button events are recorded before any document listener runs, so
  // each mark click is in the span it ends (as a jsPsych response click is
  // in the trial it ends), once.
  it('each mark click is recorded once, in the span it ends', () => {
    start();
    const press = (node) => {
      for (const type of ['mousedown', 'mouseup', 'click']) node.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true }));
    };
    press(el('<button data-ch-trial="q1">Start</button>'));
    press(el('<button data-ch-trial="q2"><span>Next</span></button>').firstElementChild);
    const kinds = win.CyborgHunter.data().trials.map((t) => t.trialId + ':' + t.integrity.mouseTrack.map((m) => m.type).join(','));
    assert.deepStrictEqual(kinds, ['span-0:down,up,click', 'q1:down,up,click', 'q2:']);
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

  it('a submit the page prevents (validation) leaves pagehide free to cut', async () => {
    const ctx = start();
    submit(form());
    await tick();   // the prevented submit is noticed after the page's handlers ran
    paste('later');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.strictEqual(saved.trials[1].integrity.pasteEvents.length, 1);
  });

  // A dialog form closes its <dialog> and the page stays: no page segment,
  // and the real pagehide still cuts what came after it.
  it('a method="dialog" form submit cuts nothing; pagehide keeps the data after it', () => {
    const ctx = start();
    paste('before');
    submit(el('<form method="dialog"><button>OK</button></form>'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 0);
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.strictEqual(saved.trials.length, 1);
    assert.strictEqual(saved.trials[0].integritySegment.source, 'page');
    assert.strictEqual(saved.trials[0].integrity.pasteEvents.length, 2);
  });

  it('a submitter with formmethod="dialog" on a POST form cuts nothing and adds no hidden input', () => {
    const ctx = start();
    const f = el('<form method="post" action="/submit"><button formmethod="dialog">Close</button></form>');
    f.dispatchEvent(new win.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: f.querySelector('button') }));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 0);
    assert.strictEqual(f.querySelectorAll('input[name=cyborgHunterData]').length, 0);
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials[0].integrity.pasteEvents.length, 1);
  });

  // A form that targets another window (or a frame) leaves this page where
  // it is: the post still carries the blob, and the real pagehide still cuts.
  it('a target="_blank" POST carries the blob and pagehide keeps the data after it', () => {
    const ctx = start();
    paste('before');
    const f = form();
    f.setAttribute('target', '_blank');
    submit(f);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    assert.strictEqual(JSON.parse(f.querySelector('input[name=cyborgHunterData]').value).trials.length, 1);
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.strictEqual(saved.trials.length, 2);
    assert.strictEqual(saved.trials[1].integrity.pasteEvents.length, 1);
  });

  it('a submitter with formtarget="_blank" leaves the next pagehide to cut', () => {
    const ctx = start();
    const f = el('<form method="post" action="/submit"><button formtarget="_blank">Preview</button></form>');
    f.addEventListener('submit', (e) => e.preventDefault());
    f.dispatchEvent(new win.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: f.querySelector('button') }));
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials[1].integrity.pasteEvents.length, 1);
  });

  it('a form targeting this window by keyword still counts as the page load', () => {
    const ctx = start();
    const f = form();
    f.setAttribute('target', '_self');
    submit(f);
    // Still inside the submit task: the page's own cancel has not been seen yet.
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
  });

  // Browsers read the target as written: with spaces around it, " _self " or
  // " " is the name of another window, so the page stays.
  for (const target of [' ', ' _self ']) {
    it(`a form target of ${JSON.stringify(target)} names another window; pagehide keeps the data after it`, async () => {
      const ctx = start();
      const f = el('<form method="post" action="/submit"></form>');
      f.setAttribute('target', target);
      submit(f);   // not prevented: the post goes to that other window
      await tick();
      paste('after');
      win.dispatchEvent(new win.Event('pagehide'));
      assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
      assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials[1].integrity.pasteEvents.length, 1);
    });
  }

  // form.dispatchEvent(new Event('submit')) runs the page's submit handlers.
  // Chromium and WebKit submit nothing for it; Firefox still sends the form.
  // happy-dom leaves isTrusted unset; a browser sets it to false on such an
  // event.
  function untrustedSubmit(f) {
    const ev = new win.Event('submit', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'isTrusted', { value: false });
    f.dispatchEvent(ev);
  }

  it('a submit event the page dispatches itself is not counted as leaving; a later pagehide keeps the data after it', async () => {
    const ctx = start();
    const f = el('<form method="post" action="/submit"></form>');
    untrustedSubmit(f);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    assert.strictEqual(f.querySelectorAll('input[name=cyborgHunterData]').length, 1, 'its handlers still see the blob');
    await tick();
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials[1].integrity.pasteEvents.length, 1);
  });

  // Firefox: the dispatched event sends the form and the page goes. The post
  // carries everything so far, and pagehide closes at most one extra,
  // empty segment.
  it('a dispatched submit event that does send the form loses nothing; pagehide adds at most one empty segment', async () => {
    start();
    paste('before');
    const f = el('<form method="post" action="/submit"></form>');
    untrustedSubmit(f);
    const posted = JSON.parse(f.querySelector('input[name=cyborgHunterData]').value);
    assert.deepStrictEqual(posted.trials.map((t) => t.integrity.pasteEvents.length), [1]);
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));   // the page leaves, with nothing recorded since
    const saved = JSON.parse(win.sessionStorage.getItem(KEY)).trials;
    assert.strictEqual(saved[0].integrity.pasteEvents.length, 1, 'the data before the submit is kept');
    assert.ok(saved.length <= 2, 'at most one extra segment');
    for (const t of saved.slice(1)) {
      assert.strictEqual(t.integrity.pasteEvents.length, 0);
      assert.strictEqual(t.integritySoftScore, 0, 'the extra segment is empty');
    }
  });

  // In a browser a control named "method" shadows form.method (the form's
  // named properties override its own); happy-dom does not do that, so the
  // test puts the control in its place.
  for (const name of ['method', 'getAttribute']) {
    it(`a POST form with a control named "${name}" still gets the hidden input`, () => {
      start();
      const f = form();
      const field = el(`<input name="${name}" value="by-hand">`);
      f.appendChild(field);
      Object.defineProperty(f, name, { value: field, configurable: true });
      submit(f);
      assert.strictEqual(f.querySelectorAll('input[name=cyborgHunterData]').length, 1);
      assert.deepStrictEqual(errors, []);
    });
  }

  it('a method="dialog" form with a control named "method" is still a dialog submit; pagehide keeps the data after it', () => {
    const ctx = start();
    paste('before');
    const f = el('<form method="dialog"><button>OK</button></form>');
    const field = el('<input name="method" value="by-hand">');
    f.appendChild(field);
    Object.defineProperty(f, 'method', { value: field, configurable: true });
    submit(f);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 0);
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.strictEqual(saved.trials.length, 1);
    assert.strictEqual(saved.trials[0].integrity.pasteEvents.length, 2);
  });

  // The target is read the same way: a control named "getAttribute" or
  // "hasAttribute" does not break the post into another window.
  for (const name of ['getAttribute', 'hasAttribute']) {
    it(`a target="_blank" POST with a control named "${name}" carries the blob; pagehide keeps the data after it`, async () => {
      const ctx = start();
      const f = el('<form method="post" action="/submit" target="_blank"></form>');
      const field = el(`<input name="${name}" value="by-hand">`);
      f.appendChild(field);
      Object.defineProperty(f, name, { value: field, configurable: true });
      submit(f);
      assert.strictEqual(f.querySelectorAll('input[name=cyborgHunterData]').length, 1);
      await tick();
      paste('after');
      win.dispatchEvent(new win.Event('pagehide'));
      assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
      assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials[1].integrity.pasteEvents.length, 1);
      assert.deepStrictEqual(errors, []);
    });
  }

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
    win.sessionStorage.setItem('cyborg-hunter:oneliner:session:OTHER', JSON.stringify({ segmentIndex: 5, pageCount: 3, trials: [{}] }));
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

  // A host adapter can keep one session per scope (Qualtrics: per survey).
  it('keyScope saves and restores under a scoped key; without it the key is unchanged', async () => {
    const { installVanillaAdapter } = await import('../../src/oneliner/adapters/vanilla.js');
    const ctx = start();
    ctx.vanilla.teardown();
    const plain = installVanillaAdapter({ win, ctx });
    plain.persist();
    plain.teardown();
    assert.ok(win.sessionStorage.getItem(KEY), 'cyborg-hunter:oneliner:session:P1');
    win.sessionStorage.removeItem(KEY);

    const scoped = installVanillaAdapter({ win, ctx, keyScope: 'SV_abc' });
    scoped.persist();
    scoped.teardown();
    assert.strictEqual(win.sessionStorage.getItem(KEY), null);
    assert.ok(win.sessionStorage.getItem('cyborg-hunter:oneliner:session:SV_abc:P1'));

    const same = installVanillaAdapter({ win, ctx, keyScope: 'SV_abc' });
    assert.strictEqual(same.blob().cyborgHunterOneLiner.pageCount, 2, 'the same scope restores');
    same.teardown();
    const other = installVanillaAdapter({ win, ctx, keyScope: 'SV_other' });
    assert.strictEqual(other.blob().cyborgHunterOneLiner.pageCount, 1, 'another scope starts fresh');
    other.teardown();
  });
});

describe('vanilla host: page-load edge cases', () => {
  // happy-dom's sessionStorage is per Window: copy the tab's storage over.
  function nextPage(ms) {
    const saved = {};
    for (let i = 0; i < win.sessionStorage.length; i++) {
      const k = win.sessionStorage.key(i);
      saved[k] = win.sessionStorage.getItem(k);
    }
    const page = new Window({ url: 'https://lab.example/next.html' });
    for (const [k, v] of Object.entries(saved)) page.sessionStorage.setItem(k, v);
    win.close();
    useWindow(page);
    laterPage(ms);
  }
  function endPage(ctx) {
    win.dispatchEvent(new win.Event('pagehide'));
    ctx.vanilla.teardown();
    ctx.monitor.destroy();
  }

  it('without a participant id, the next page in the tab keeps the first random id and continues the index', () => {
    const ctx1 = boot({ script: { dataset: { guards: 'none' } }, win });
    contexts.push(ctx1);
    assert.match(ctx1.participantId, /^ch-[0-9a-f]{12}$/);
    assert.strictEqual(ctx1.participantIdSource, 'random');
    paste('page one');
    endPage(ctx1);
    const warnedOnPage1 = warns.filter((w) => w === MESSAGES.randomId(ctx1.participantId)).length;
    assert.strictEqual(warnedOnPage1, 1);

    nextPage(30000);
    const ctx2 = boot({ script: { dataset: { guards: 'none' } }, win });
    contexts.push(ctx2);
    assert.strictEqual(ctx2.participantId, ctx1.participantId);
    assert.strictEqual(ctx2.participantIdSource, 'session');
    assert.strictEqual(warns.filter((w) => w.includes('cannot be linked')).length, 1, 'no second random-id warning');
    assert.deepStrictEqual(ctx2.segmenter.state(), { open: true, segmentIndex: 1, currentTrialId: 'span-1' });
    assert.strictEqual(win.CyborgHunter.data().cyborgHunterOneLiner.pageCount, 2);
  });

  it('a URL, attribute or config id still wins over the id kept in the tab', () => {
    win.sessionStorage.setItem(PID_KEY, 'ch-000000000000');
    const ctx = start();
    assert.strictEqual(ctx.participantId, 'P1');
    assert.strictEqual(win.sessionStorage.getItem(PID_KEY), 'P1');
  });

  // happy-dom's real submit() navigates; a stub installed before boot stands
  // in for the browser's and records the entry list it would post.
  function stubNativeSubmit() {
    const posted = [];
    win.HTMLFormElement.prototype.submit = function (...args) {
      posted.push({ form: this, args, data: new win.FormData(this).get('cyborgHunterData') });
      return 'native result';
    };
    return posted;
  }

  it('form.submit() (no submit event) posts cyborgHunterData with this page\'s open span', () => {
    const posted = stubNativeSubmit();
    const ctx = start();
    paste('before a programmatic submit');
    const f = el('<form method="post" action="/submit"><input name="answer" value="a"></form>');
    assert.strictEqual(f.submit('x'), 'native result', 'return value passed through');
    assert.strictEqual(posted.length, 1);
    // happy-dom hands the method its form without the Proxy f is: compare by content.
    assert.strictEqual(posted[0].form.querySelector('input[name=answer]').value, 'a', 'this is the form');
    assert.deepStrictEqual(posted[0].args, ['x'], 'arguments passed through');
    const blob = JSON.parse(posted[0].data);
    assert.strictEqual(blob.trials.length, 1);
    assert.strictEqual(blob.trials[0].integritySegment.source, 'page');
    assert.strictEqual(blob.trials[0].integrity.pasteEvents.length, 1);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials.length, 1, 'persisted');

    // The post fires pagehide next: no empty extra segment.
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    assert.deepStrictEqual(errors, []);
  });

  it('form.submit() from inside a submit handler does not cut a second, empty segment', () => {
    const posted = stubNativeSubmit();
    const ctx = start();
    const f = el('<form method="post" action="/submit"></form>');
    f.addEventListener('submit', (e) => { e.preventDefault(); f.submit(); });
    submit(f);
    assert.strictEqual(posted.length, 1);
    assert.strictEqual(JSON.parse(posted[0].data).trials.length, 1);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
  });

  // The browser ignores submit() on a form that is not in the document.
  it('form.submit() on a form outside the document cuts nothing', () => {
    const posted = stubNativeSubmit();
    const ctx = start();
    const f = win.document.createElement('form');
    f.method = 'post';
    f.submit();
    assert.strictEqual(posted.length, 1, 'the browser\'s submit still runs');
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 0);
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials[0].integrity.pasteEvents.length, 1);
  });

  it('form.submit() from a submit handler of a _blank form cuts once; pagehide cuts the rest', () => {
    const posted = stubNativeSubmit();
    const ctx = start();
    const f = el('<form method="post" action="/submit" target="_blank"></form>');
    f.addEventListener('submit', (e) => { e.preventDefault(); f.submit(); });
    submit(f);
    assert.strictEqual(posted.length, 1);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
  });

  // The handler cancelled the event but submitted the form itself: the page
  // still goes, and its pagehide (after the task that ran the handler) must
  // not cut an empty segment.
  it('a cancelled submit followed by form.submit() still counts as the page load', async () => {
    stubNativeSubmit();
    const ctx = start();
    const f = el('<form method="post" action="/submit"></form>');
    f.addEventListener('submit', (e) => { e.preventDefault(); f.submit(); });
    submit(f);
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
  });

  it('a cancelled submit whose handler submits a form outside the document still leaves pagehide to cut', async () => {
    stubNativeSubmit();
    const ctx = start();
    const f = el('<form method="post" action="/submit"></form>');
    const detached = win.document.createElement('form');
    f.addEventListener('submit', (e) => { e.preventDefault(); detached.submit(); });
    submit(f);
    await tick();
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
  });

  it('a cancelled submit does not undo a later submit in the same task', async () => {
    const ctx = start();
    const a = el('<form method="post" action="/a"></form>');
    a.addEventListener('submit', (e) => e.preventDefault());
    const b = el('<form method="post" action="/b"></form>');
    submit(a);
    submit(b);
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
  });

  it('a cancelled _blank submit after a page-replacing one leaves the page load in place', async () => {
    const ctx = start();
    const popup = el('<form method="post" action="/preview" target="_blank"></form>');
    popup.addEventListener('submit', (e) => e.preventDefault());
    const f = el('<form method="post" action="/submit"></form>');
    f.addEventListener('submit', () => submit(popup));
    submit(f);
    await tick();
    const before = ctx.segmenter.state().segmentIndex;
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, before);
  });

  // A same-window post that never unloads the page (a 204 answer, a
  // download, Stop, a beforeunload "Stay"): a later cancelled submit hands
  // the next pagehide its cut back.
  it('a same-window submit that did not leave, then a cancelled submit: pagehide still cuts', async () => {
    const ctx = start();
    submit(el('<form method="post" action="/a"></form>'));
    await tick();
    submit(form());
    await tick();
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 3);
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.strictEqual(saved.trials.length, 3);
    assert.strictEqual(saved.trials[2].integrity.pasteEvents.length, 1);
  });

  // The same post that never left, then form.submit() into a new window: that
  // submit keeps the page too, so pagehide closes what came after the post.
  // (Where the window post's own span ends is not pinned here: only that
  // nothing after it is lost.)
  it('a same-window submit that did not leave, then form.submit() into a new window: pagehide still cuts', async () => {
    const posted = stubNativeSubmit();
    start();
    submit(el('<form method="post" action="/a"></form>'));
    await tick();
    el('<form method="post" action="/preview" target="_blank"></form>').submit();
    assert.strictEqual(posted.length, 1);
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    const trials = JSON.parse(win.sessionStorage.getItem(KEY)).trials;
    assert.strictEqual(trials[trials.length - 1].integrity.pasteEvents.length, 1);
  });

  it('a mark from the page\'s own submit handler leaves the next pagehide its cut', async () => {
    const ctx = start();
    const f = el('<form method="post" action="/a"></form>');
    f.addEventListener('submit', () => win.CyborgHunter.mark('next'));
    submit(f);
    await tick();
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 3);
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials[2].integrity.pasteEvents.length, 1);
  });

  it('a page restored from the back/forward cache before the submit settles still cuts at pagehide', async () => {
    const ctx = start();
    submit(el('<form method="post" action="/a"></form>'));
    const back = new win.Event('pageshow');
    Object.defineProperty(back, 'persisted', { value: true });
    win.dispatchEvent(back);
    await tick();
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials[1].integrity.pasteEvents.length, 1);
  });

  it('two cancelled submits in one task leave pagehide to cut', async () => {
    const ctx = start();
    const a = form();
    const b = form();
    submit(a);
    submit(b);
    await tick();
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 3);
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials[2].integrity.pasteEvents.length, 1);
  });

  // A same-window submit whose navigation never commits: the answer is a 204
  // or a download, the action is javascript:, or the participant answers a
  // beforeunload prompt with "Stay". The page stays and nothing says so; what
  // the participant does next must still reach the session and the next post.
  const pasteCounts = (trials) => trials.map((t) => t.integrity.pasteEvents.length);

  it('a same-window submit that never leaves: what comes after it is cut at pagehide', async () => {
    start();
    paste('before');
    submit(el('<form method="post" action="/save"></form>'));   // not prevented: the page would go
    await tick();
    paste('after');
    win.dispatchEvent(new win.Event('pagehide'));   // the participant leaves by a link
    assert.deepStrictEqual(pasteCounts(JSON.parse(win.sessionStorage.getItem(KEY)).trials), [1, 1]);
  });

  it('a same-window submit that never leaves, then form.submit(): the post carries what came after it', async () => {
    const posted = stubNativeSubmit();
    start();
    paste('before');
    submit(el('<form method="post" action="/save"></form>'));
    await tick();
    paste('after');
    el('<form method="post" action="/final"></form>').submit();
    assert.strictEqual(posted.length, 1);
    assert.deepStrictEqual(pasteCounts(JSON.parse(posted[0].data).trials), [1, 1]);
    win.dispatchEvent(new win.Event('pagehide'));   // that post leaves: no empty extra segment
    assert.deepStrictEqual(pasteCounts(JSON.parse(win.sessionStorage.getItem(KEY)).trials), [1, 1]);
  });

  it('a same-window submit that never leaves, then a click: pagehide keeps the click', async () => {
    const ctx = start();
    submit(el('<form method="post" action="/save"></form>'));
    await tick();
    click(el('<button type="button">Next</button>'));
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    const clicks = JSON.parse(win.sessionStorage.getItem(KEY)).trials[1].integrity.mouseTrack.filter((m) => m.type === 'click');
    assert.strictEqual(clicks.length, 1);
  });

  // Mouse movement alone is not counted: a participant who moves the mouse
  // while the next page loads would otherwise add a segment to every page.
  it('a submit then pagehide with only mouse movement in between adds no segment', async () => {
    const ctx = start();
    submit(el('<form method="post" action="/submit"></form>'));
    await tick();
    win.document.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 40 }));
    assert.ok(ctx.monitor.getTrialSnapshot().mouseEvents.length > 0, 'the movement was recorded');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
  });

  // A page that submits from its own click handler (onclick="form.submit()",
  // a link's onclick, a listener added by the page's script): the handler
  // runs before the click reaches the document, so the cut comes in the
  // middle of the click. The click belongs to the span the submit closes,
  // and the span it opens holds nothing: its pagehide adds no segment.
  const clicksPerRow = (trials) => trials.map((t) => t.integrity.mouseTrack.filter((m) => m.type === 'click').length);
  const selfSubmitting = {
    'a button whose click handler calls form.submit()': (f) => {
      const b = el('<button type="button">Next</button>');
      b.addEventListener('click', () => f.submit());
      return b;
    },
    'a link whose click handler calls form.submit()': (f) => {
      const a = el('<a href="#next">Next</a>');
      a.addEventListener('click', (e) => { e.preventDefault(); f.submit(); });
      return a;
    },
  };
  for (const [name, make] of Object.entries(selfSubmitting)) {
    it(`${name}: the click is posted with the span it closes, and pagehide adds no segment`, async () => {
      const posted = stubNativeSubmit();
      const ctx = start();
      const f = el('<form method="post" action="/next"></form>');
      click(make(f));
      assert.strictEqual(posted.length, 1);
      assert.deepStrictEqual(clicksPerRow(JSON.parse(posted[0].data).trials), [1]);
      await tick();
      win.dispatchEvent(new win.Event('pagehide'));
      assert.strictEqual(ctx.segmenter.state().segmentIndex, 1, 'no extra segment');
    });
  }

  // The click's own consequences in the same task (a checkbox's input and
  // change events come after the click) are the submit's, not something the
  // participant did on a page that stayed.
  it('a checkbox whose click handler submits: its input event after the click adds no segment', async () => {
    const posted = stubNativeSubmit();
    const ctx = start();
    const f = el('<form method="post" action="/next"><input type="checkbox" name="agree"></form>');
    const box = f.querySelector('input');
    box.addEventListener('click', () => f.submit());
    click(box);   // happy-dom toggles it and fires input and change after the click, as browsers do
    assert.strictEqual(posted.length, 1);
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
  });

  it('a second click on such a button submits again, with that click in the span it closes', async () => {
    const posted = stubNativeSubmit();
    const ctx = start();
    const f = el('<form method="post" action="/next"></form>');
    const b = selfSubmitting['a button whose click handler calls form.submit()'](f);
    click(b);
    await tick();
    click(b);   // again, before the next page arrives
    assert.strictEqual(posted.length, 2);
    assert.deepStrictEqual(clicksPerRow(JSON.parse(posted[1].data).trials), [1, 1]);
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
  });

  it('a page that stays after such a submit: a later click is kept at pagehide', async () => {
    stubNativeSubmit();
    const ctx = start();
    const f = el('<form method="post" action="/next"></form>');
    click(selfSubmitting['a button whose click handler calls form.submit()'](f));
    await tick();   // the answer was a 204: the page stays
    click(el('<button type="button">Back to the task</button>'));
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    assert.deepStrictEqual(clicksPerRow(JSON.parse(win.sessionStorage.getItem(KEY)).trials), [1, 1]);
  });

  // The browser reads a submission's method and target after the submit
  // handlers ran, and builds its entry list (the formdata event) in between.
  // happy-dom fires no formdata event: this dispatches the one the browser
  // would, with the FormData it would post.
  function formdata(f) {
    const fd = new win.FormData(f);
    const ev = new win.Event('formdata', { bubbles: true });
    Object.defineProperty(ev, 'formData', { value: fd });
    f.dispatchEvent(ev);
    return fd;
  }

  it('a submit handler that turns a GET form into a POST: the post carries cyborgHunterData', () => {
    start();
    paste('before');
    const f = el('<form action="/sink"><input name="q" value="a"></form>');
    f.addEventListener('submit', () => f.setAttribute('method', 'post'));
    submit(f);
    const fd = formdata(f);
    assert.strictEqual(fd.get('q'), 'a');
    assert.deepStrictEqual(pasteCounts(JSON.parse(fd.get('cyborgHunterData')).trials), [1]);
  });

  it('a submit handler that turns a POST form into a GET: the blob stays out of the URL', () => {
    start();
    const f = el('<form method="post" action="/sink"><input name="q" value="a"></form>');
    f.addEventListener('submit', () => f.setAttribute('method', 'get'));
    submit(f);
    const fd = formdata(f);
    assert.strictEqual(fd.get('q'), 'a');
    assert.strictEqual(fd.has('cyborgHunterData'), false);
    assert.strictEqual(f.querySelectorAll('input[name=cyborgHunterData]').length, 0);
  });

  // A guard against double submission: the page's handler disables every
  // control, ch.js's hidden input included, and a disabled control is left
  // out of the entry list. The blob goes in all the same.
  it('a submit handler that disables every input: the post still carries cyborgHunterData', () => {
    start();
    paste('before');
    const f = el('<form method="post" action="/sink"><input name="q" value="a"></form>');
    f.addEventListener('submit', () => f.querySelectorAll('input').forEach((i) => { i.disabled = true; }));
    submit(f);
    const fd = formdata(f);
    assert.strictEqual(fd.has('q'), false, 'the page\'s own field stays out, as it asked');
    assert.deepStrictEqual(pasteCounts(JSON.parse(fd.get('cyborgHunterData')).trials), [1]);
  });

  it('a formdata event outside a submission (the page\'s own FormData) is left alone', () => {
    start();
    const f = el('<form method="post" action="/submit"><input name="q" value="a"></form>');
    assert.strictEqual(formdata(f).has('cyborgHunterData'), false);
  });

  // form.submit() posts by the form's own method: a submitter of the event
  // whose handler called it has no say.
  it('form.submit() from the handler of a formmethod="get" submit still posts the blob', () => {
    const posted = [];
    win.HTMLFormElement.prototype.submit = function () { posted.push(formdata(this).get('cyborgHunterData')); };
    start();
    const f = el('<form method="post" action="/submit"><button formmethod="get">Search</button></form>');
    f.addEventListener('submit', (e) => { e.preventDefault(); f.submit(); });
    f.dispatchEvent(new win.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: f.querySelector('button') }));
    assert.strictEqual(posted.length, 1);
    assert.strictEqual(JSON.parse(posted[0]).trials.length, 1);
  });

  for (const withFormdata of [true, false]) {
    const how = withFormdata ? '' : ' (no formdata event)';
    it('a submit handler that sends a same-window post into a new window: pagehide still cuts' + how, async () => {
      const ctx = start();
      const f = el('<form method="post" action="/submit"></form>');
      f.addEventListener('submit', () => f.setAttribute('target', '_blank'));
      submit(f);
      if (withFormdata) formdata(f);
      await tick();
      win.dispatchEvent(new win.Event('pagehide'));   // the page stayed: its span is cut like any page's
      assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    });

    it('a submit handler that sends a new-window post into this window: no empty extra segment' + how, async () => {
      const ctx = start();
      const f = el('<form method="post" action="/submit" target="_blank"></form>');
      f.addEventListener('submit', () => f.removeAttribute('target'));
      submit(f);
      if (withFormdata) formdata(f);
      await tick();
      win.dispatchEvent(new win.Event('pagehide'));
      assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    });
  }

  it('form.submit() never throws into the page and always calls the browser\'s submit', () => {
    const posted = stubNativeSubmit();
    const ctx = start();
    ctx.segmenter.cut = () => { throw new Error('boom'); };
    ctx.segmenter.state = () => { throw new Error('boom'); };
    const f = el('<form method="post" action="/submit"></form>');
    assert.doesNotThrow(() => f.submit());
    assert.strictEqual(posted.length, 1);
    assert.ok(errors.some((e) => e.includes('boom')));
  });

  it('a FormData the page builds itself does not carry the blob', () => {
    start();
    const f = el('<form method="post" action="/submit"><input name="answer" value="a"></form>');
    const fd = new win.FormData(f);
    assert.strictEqual(fd.has('cyborgHunterData'), false);
    assert.strictEqual(fd.get('answer'), 'a');
  });

  it('a GET form gets no hidden input (it would go into the URL); the session is still saved', () => {
    const infos = [];
    console.info = (m) => infos.push(String(m));
    const ctx = start();
    const f = el('<form action="/search"><input name="q" value="a"></form>');
    f.addEventListener('submit', (e) => e.preventDefault());
    submit(f);
    assert.strictEqual(f.querySelectorAll('input[name=cyborgHunterData]').length, 0);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials.length, 1);
    submit(f);
    assert.strictEqual(infos.length, 1, 'one console.info per page');

    // A GET submitter on a POST form: also no input, and a stale one is removed.
    const p = el('<form method="POST" action="/submit"><button formmethod="get">Search</button></form>');
    p.addEventListener('submit', (e) => e.preventDefault());
    submit(p);
    assert.strictEqual(p.querySelectorAll('input[name=cyborgHunterData]').length, 1, 'method="POST" counts as post');
    const ev = new win.Event('submit', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'submitter', { value: p.querySelector('button') });
    p.dispatchEvent(ev);
    assert.strictEqual(p.querySelectorAll('input[name=cyborgHunterData]').length, 0);
    assert.deepStrictEqual(errors, []);
  });

  it('requestSubmit() and a submit-button click still go through the submit event once', () => {
    const posted = stubNativeSubmit();
    const ctx = start();
    const f = form();
    f.requestSubmit();
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    assert.strictEqual(f.querySelectorAll('input[name=cyborgHunterData]').length, 1);
    const g = el('<form method="post" action="/submit"><button type="submit">Send</button></form>');
    g.addEventListener('submit', (e) => e.preventDefault());
    click(g.querySelector('button'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    assert.strictEqual(JSON.parse(g.querySelector('input[name=cyborgHunterData]').value).trials.length, 2);
    assert.strictEqual(posted.length, 0, 'the prototype submit() is not involved');
  });

  it('teardown puts the browser\'s submit() back', () => {
    const native = win.HTMLFormElement.prototype.submit;
    const ctx = start();
    assert.notStrictEqual(win.HTMLFormElement.prototype.submit, native);
    ctx.vanilla.teardown();
    assert.strictEqual(win.HTMLFormElement.prototype.submit, native);
  });

  // A host adapter that owns the page boundary (Qualtrics) installs the
  // vanilla adapter with pageBoundaries: false.
  it('pageBoundaries: false installs no submit, pagehide or submit() wrap', async () => {
    const { installVanillaAdapter } = await import('../../src/oneliner/adapters/vanilla.js');
    const posted = stubNativeSubmit();
    const native = win.HTMLFormElement.prototype.submit;
    const ctx = start();
    ctx.vanilla.teardown();
    ctx.vanilla = installVanillaAdapter({ win, ctx, pageBoundaries: false });
    assert.strictEqual(win.HTMLFormElement.prototype.submit, native, 'submit() is not wrapped');

    const f = form();
    submit(f);
    f.submit();
    assert.strictEqual(posted.length, 1, 'the browser\'s submit() still runs');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.vanilla.blob().trials.length, 0);
    assert.strictEqual(f.querySelector('input[name="cyborgHunterData"]'), null);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 0);

    click(el('<button data-ch-trial="q2">Next</button>'));
    assert.strictEqual(ctx.vanilla.blob().trials.length, 1, 'a mark still cuts');
    assert.strictEqual(ctx.vanilla.blob().trials[0].integritySegment.source, 'manual');
    assert.deepStrictEqual(errors, []);
  });

  for (const name of ['participantId', 'pid']) {
    it(`a participant named '${name}' keeps the id and a working multi-page session`, () => {
      const ctx1 = start({ participantId: name });
      paste('page one');
      win.CyborgHunter.mark('q1');
      endPage(ctx1);
      nextPage(30000);
      const ctx2 = start({ participantId: name });
      assert.strictEqual(ctx2.participantId, name);
      assert.deepStrictEqual(ctx2.segmenter.state(), { open: true, segmentIndex: 2, currentTrialId: 'span-2' });
      const blob = win.CyborgHunter.data();
      assert.strictEqual(blob.cyborgHunterOneLiner.pageCount, 2);
      assert.deepStrictEqual(blob.trials.map((t) => t.trialId), ['span-0', 'q1', 'span-2']);
      assert.strictEqual(win.sessionStorage.getItem(PID_KEY), name);
      assert.deepStrictEqual(errors, []);
    });
  }

  it('a page that stops the propagation of a prevented submit still leaves pagehide free to cut', async () => {
    const ctx = start();
    const f = el('<form method="post" action="/submit"></form>');
    f.addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); });
    submit(f);
    await tick();
    paste('after validation');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
  });

  it('sessionStorage full: a slim record keeps the indices, the next page carries a cyborgHunterError', () => {
    const store = {};
    const full = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        if (k === KEY && JSON.parse(v).trials.length > 0) throw new Error('QuotaExceededError');
        store[k] = v;
      }
    };
    Object.defineProperty(win, 'sessionStorage', { value: full, configurable: true });
    const ctx1 = start();
    paste('page one');
    win.CyborgHunter.mark('q1');
    endPage(ctx1);
    assert.deepStrictEqual(JSON.parse(store[KEY]), { segmentIndex: 2, pageCount: 1, trials: [], storageError: true, errors: [] });
    assert.ok(errors.some((e) => e.startsWith('[cyborg-hunter] The session could not be carried')));

    const page2 = new Window({ url: 'https://lab.example/page2.html' });
    win.close();
    useWindow(page2);
    page2.sessionStorage.setItem(KEY, store[KEY]);
    laterPage(30000);
    const ctx2 = start();
    assert.deepStrictEqual(ctx2.segmenter.state(), { open: true, segmentIndex: 2, currentTrialId: 'span-2' });
    const note = 'session storage full on page 1; earlier pages only in their own saves';
    const blob = win.CyborgHunter.data();
    assert.strictEqual(blob.cyborgHunterError, note);
    assert.strictEqual(blob.cyborgHunterOneLiner.pageCount, 2);
    const out = extractIntegrityData(JSON.parse(JSON.stringify(blob)), {});
    assert.ok(out.warnings.some((w) => w.includes(note)));

    // The note travels on to later pages.
    win.dispatchEvent(new win.Event('pagehide'));
    assert.deepStrictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).errors, [note]);
  });

  it('back/forward cache: a page shown again re-adopts the saved session and cuts again at pagehide', () => {
    win.GuardHoneypot = fakeHoneypot([{ reason: 'tab_hidden', start: 10, end: 20, duration: 10 }]);
    const ctx = start({ guards: 'honeypot' });
    const f = el('<form method="post" action="/next"></form>');
    submit(f);   // not prevented: the browser navigates to the next page
    win.dispatchEvent(new win.Event('pagehide'));

    // The next page added two segments, a violation, and saved.
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    const pageB = saved.trials[0].integritySegment.pageOrigin + 30000;
    const row = (i) => ({ trialId: 'b' + i, integrity: {}, integritySegment: { segmentIndex: i, pageOrigin: pageB } });
    saved.trials.push(row(1), row(2));
    saved.segmentIndex = 3;
    saved.pageCount = 2;
    const hp = JSON.parse(saved.honeypot.guard_assistance_violations_session);
    hp.push({ reason: 'not_fullscreen', start: 5, end: 9, duration: 4, pageOrigin: pageB });
    saved.honeypot.guard_assistance_violations_session = JSON.stringify(hp);
    win.sessionStorage.setItem(KEY, JSON.stringify(saved));

    const normal = new win.Event('pageshow');
    Object.defineProperty(normal, 'persisted', { value: false });
    win.dispatchEvent(normal);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1, 'a normal pageshow changes nothing');

    const back = new win.Event('pageshow');
    Object.defineProperty(back, 'persisted', { value: true });
    win.dispatchEvent(back);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 3);
    const blob = ctx.vanilla.blob();
    assert.deepStrictEqual(blob.trials.map((t) => t.integritySegment.segmentIndex), [0, 1, 2]);
    assert.strictEqual(blob.cyborgHunterOneLiner.pageCount, 3);
    const v = JSON.parse(blob.guard_assistance_violations_session);
    assert.deepStrictEqual(v.map((x) => x.reason).sort(), ['not_fullscreen', 'tab_hidden'], "this page's violation is not counted twice");

    paste('back again');
    win.dispatchEvent(new win.Event('pagehide'));
    const after = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.deepStrictEqual(after.trials.map((t) => t.integritySegment.segmentIndex), [0, 1, 2, 3]);
    assert.strictEqual(after.trials[3].integrity.pasteEvents.length, 1);
  });

  it('back/forward cache with a slim (storage full) record: the page keeps the trials it has', () => {
    const ctx = start();
    paste('page one');
    win.CyborgHunter.mark('q1');
    win.dispatchEvent(new win.Event('pagehide'));
    // A later page found the storage full and left a slim record.
    win.sessionStorage.setItem(KEY, JSON.stringify({ segmentIndex: 4, pageCount: 2, trials: [], storageError: true, errors: [] }));
    const back = new win.Event('pageshow');
    Object.defineProperty(back, 'persisted', { value: true });
    win.dispatchEvent(back);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 4);
    const blob = ctx.vanilla.blob();
    assert.deepStrictEqual(blob.trials.map((t) => t.trialId), ['span-0', 'q1']);
    assert.strictEqual(blob.cyborgHunterOneLiner.pageCount, 3);
    assert.match(blob.cyborgHunterError, /session storage full on page 2/);
  });
});

describe('deferred session start fails (ch.js in <head>)', () => {
  function head() {
    Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true });
    win.document.documentElement.removeChild(win.document.body);
  }
  function bodyAndReady() {
    win.document.documentElement.appendChild(win.document.createElement('body'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  }
  async function failingStart() {
    const { init } = await import('../../src/core/monitor.js');
    const ctx = boot({
      script: { dataset: { participantId: 'P1', guards: 'none' } }, win,
      monitorFactory: (cfg) => Object.assign({}, init(cfg), { startSession() { throw new Error('no session'); } })
    });
    contexts.push(ctx);
    return ctx;
  }

  it('vanilla: logged once; data() and the form still carry earlier pages, marked', async () => {
    win.sessionStorage.setItem(KEY, JSON.stringify({ segmentIndex: 1, pageCount: 1, trials: [{ trialId: 'span-0', integrity: {}, integritySegment: { segmentIndex: 0 } }] }));
    head();
    await failingStart();
    bodyAndReady();
    assert.deepStrictEqual(errors, [MESSAGES.bootFailed('no session')]);
    const blob = win.CyborgHunter.data();
    assert.strictEqual(blob.trials.length, 1);
    assert.match(blob.cyborgHunterError, /did not start on page 2: no session/);
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).errors.length, 1);
  });

  it('a first span left open by the failure is abandoned before the monitor goes: later cuts stay quiet', async () => {
    const { init } = await import('../../src/core/monitor.js');
    head();
    const ctx = boot({
      script: { dataset: { participantId: 'P1', guards: 'none' } }, win,
      monitorFactory: (cfg) => {
        const m = init(cfg);
        const realStart = m.startTrial;
        // Listeners attach, then something throws: the segmenter counts the span as open.
        return Object.assign({}, m, { startTrial(o) { realStart.call(m, o); throw new Error('listener failed'); } });
      }
    });
    contexts.push(ctx);
    bodyAndReady();
    const logged = errors.length;
    assert.ok(errors.includes(MESSAGES.bootFailed('could not open the first trial: listener failed')));
    assert.strictEqual(ctx.segmenter.state().open, false);
    const blob = win.CyborgHunter.data();
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(errors.length, logged, 'no monitor errors after the failure');
    assert.strictEqual(blob.trials.length, 0);
    assert.match(blob.cyborgHunterError, /did not start on page 1/);
  });

  it('jsPsych host, initJsPsych not called yet: the wrap is replaced by the inert one and the page is not taken for unhookable', async () => {
    head();
    const seen = [];
    const props = [];
    const orig = function (o) { seen.push(o); return { data: { addProperties(p) { props.push(p); } }, run() {} }; };
    win.initJsPsych = orig;
    const ctx = await failingStart();
    bodyAndReady();
    win.initJsPsych({});
    const { OneLinerExtension } = await import('../../src/oneliner/adapters/jspsych-extension.js');
    assert.deepStrictEqual(seen[0].extensions.map((e) => e.type), [OneLinerExtension], 'only the inert entry');
    assert.deepStrictEqual(props, [], 'the full wrap is gone');
    win.document.documentElement.setAttribute('jspsych', 'present');
    await tick();
    assert.strictEqual(ctx.host, 'jspsych');
    assert.deepStrictEqual(errors, [MESSAGES.bootFailed('no session')]);
  });

  it('jsPsych host, instance already created: every row gets the cyborgHunterError marker', async () => {
    head();
    const props = [];
    const orig = function () { return { data: { addProperties(p) { props.push(p); } }, run() {} }; };
    win.initJsPsych = orig;
    await failingStart();
    win.initJsPsych({});
    bodyAndReady();
    assert.ok(props.some((p) => /did not start/.test(p.cyborgHunterError || '')));
    assert.notStrictEqual(win.initJsPsych, orig, 'the inert wrapper, not the full wrap');
    // The extension injected into that instance stands down: no per-trial errors.
    const { OneLinerExtension } = await import('../../src/oneliner/adapters/jspsych-extension.js');
    const ext = new OneLinerExtension({ getProgress: () => ({ current_trial_global: 0 }) });
    ext.on_start({}); ext.on_load({});
    assert.deepStrictEqual(ext.on_finish({}), {});
    assert.deepStrictEqual(errors, [MESSAGES.bootFailed('no session')]);
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
      '[cyborg-hunter] mark()/data() are vanilla-mode calls; jsPsych and lab.js trials are segmented automatically',
      '[cyborg-hunter] mark()/data() are vanilla-mode calls; jsPsych and lab.js trials are segmented automatically'
    ]);
  });

  it('on the lab.js host mark() and data() warn and do nothing', () => {
    class Component { async run() {} async end() {} }
    Component.metadata = { module: ['core'], nestedComponents: [] };
    win.lab = { version: '20.2.4', core: { Component }, flow: {}, html: {} };
    const ctx = start();
    assert.strictEqual(ctx.host, 'labjs');
    assert.strictEqual(win.CyborgHunter.mark('x'), undefined);
    assert.strictEqual(win.CyborgHunter.data(), undefined);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 0);
    assert.deepStrictEqual(warns, ['[cyborg-hunter] mark()/data() are vanilla-mode calls; jsPsych and lab.js trials are segmented automatically', '[cyborg-hunter] mark()/data() are vanilla-mode calls; jsPsych and lab.js trials are segmented automatically']);
    ctx.labjsAdapter.restore();
  });

  it('not hookable, guards the researcher listed already running: the fallback does not start them again', async () => {
    const log = [];
    win.GuardHoneypot = { init: () => log.push('honeypot.init'), getSessionSummary: fakeHoneypot([]).getSessionSummary };
    win.GuardFriction = {
      start: () => { log.push('friction.start'); return 'T'; },
      injectRefusalNotices: () => log.push('injectRefusalNotices'),
      onViolation: () => () => {}
    };
    win.initJsPsych = function () {};
    const ctx = start({ guards: 'honeypot,friction' });
    // What the researcher's own guard extensions left behind at initialize().
    el('<div id="fg-honeypot"></div>');
    el('<div id="ai-research-notice"></div>');
    win.document.documentElement.setAttribute('jspsych', 'present');
    await tick();
    assert.strictEqual(ctx.host, 'vanilla');
    assert.deepStrictEqual(log, []);
  });

  it('not hookable, friction token already set (no notice in the DOM): friction is not started again', async () => {
    const log = [];
    win.GuardFriction = {
      start: () => { log.push('friction.start'); return 'T'; },
      injectRefusalNotices: () => log.push('injectRefusalNotices'),
      onViolation: () => () => {}
    };
    Object.defineProperty(win, '_guardFrictionToken', { value: 'THEIRS', configurable: true });
    win.initJsPsych = function () {};
    start({ guards: 'friction' });
    win.document.documentElement.setAttribute('jspsych', 'present');
    await tick();
    assert.deepStrictEqual(log, []);
    assert.strictEqual(win._guardFrictionToken, 'THEIRS');
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

// data-replay on a vanilla page: the standalone recorder (window
// CyborgHunterReplay, a fake here, already on the page so nothing is
// fetched) starts once the page has loaded and follows the segmenter: every
// cut ends the recorder's trial and starts the next span's; pagehide stops it.
describe('vanilla host: data-replay', () => {
  function fakeReplay() {
    const log = [];
    win.CyborgHunterReplay = {
      attach: (cfg) => {
        log.cfg = cfg;
        return {
          startSession: () => log.push('startSession'),
          startTrial: (o) => { log.push('startTrial:' + o.trialId); if (o.extensions) log.extensions = o.extensions; },
          endTrial: () => log.push('endTrial'),
          stopSession: (r) => log.push('stopSession:' + r),
          resumeSession: () => log.push('resumeSession'),
          getRecording: () => { log.push('getRecording'); return { schema_version: 2 }; },
          destroy: () => log.push('destroy')
        };
      }
    };
    return log;
  }

  it('marks and a form submit move the recorder\'s trials with the segments; pagehide stops it', async () => {
    const log = fakeReplay();
    const ctx = start({ replay: '' });
    await tick();
    assert.deepStrictEqual([...log], ['startSession', 'startTrial:span-0']);
    assert.strictEqual(log.cfg.participantId, 'P1');
    assert.deepStrictEqual(log.cfg.autoSave, { mode: 'none' });
    click(el('<button data-ch-trial="q1">Next</button>'));
    win.CyborgHunter.mark('q2');
    submit(form());
    win.dispatchEvent(new win.Event('pagehide'));
    assert.deepStrictEqual(log.slice(2), [
      'endTrial', 'startTrial:q1',
      'endTrial', 'startTrial:q2',
      'endTrial', 'startTrial:span-3',
      'stopSession:finished'
    ]);
    assert.strictEqual(ctx.vanilla.blob().trials.length, 3);
    assert.deepStrictEqual(errors, []);
  });

  it('CyborgHunter.replay() returns the recording; later marks leave the destroyed recorder alone', async () => {
    const log = fakeReplay();
    start({ replay: 'dom' });
    await tick();
    assert.strictEqual(log.cfg.tier, 'dom');
    log.length = 0;
    assert.deepStrictEqual(win.CyborgHunter.replay(), { schema_version: 2 });
    assert.deepStrictEqual([...log], ['stopSession:finished', 'getRecording', 'destroy']);
    win.CyborgHunter.mark('q9');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.deepStrictEqual([...log], ['stopSession:finished', 'getRecording', 'destroy']);
  });

  // The back/forward cache: the browser shows the page again with its
  // scripts' memory intact (pageshow, persisted) and runs no script again.
  function pageshow(persisted) {
    const ev = new win.Event('pageshow');
    Object.defineProperty(ev, 'persisted', { value: persisted });
    win.dispatchEvent(ev);
  }

  it('back/forward cache: pagehide stops the recorder, a persisted pageshow resumes it with a segment marked as a restore', async () => {
    const log = fakeReplay();
    const ctx = start({ replay: '' });
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    assert.deepStrictEqual(log.slice(2), ['endTrial', 'startTrial:span-1', 'stopSession:finished']);
    // A later page saved the session further on.
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    saved.segmentIndex = 4;
    win.sessionStorage.setItem(KEY, JSON.stringify(saved));

    pageshow(false);
    assert.strictEqual(log.length, 5, 'a pageshow that is not a restore does nothing');
    pageshow(true);
    assert.deepStrictEqual(log.slice(5), ['resumeSession', 'startTrial:span-1']);
    assert.deepStrictEqual(log.extensions, { 'cyborg-hunter': { restored_from: 'bfcache' } });
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 4, 'integrity re-adopts the saved session as before');
    win.CyborgHunter.mark('q1');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.deepStrictEqual(log.slice(7), ['endTrial', 'startTrial:q1', 'endTrial', 'startTrial:span-6', 'stopSession:finished']);
    assert.deepStrictEqual(errors, []);
  });

  it('back/forward cache with replay off: nothing is started', async () => {
    const log = fakeReplay();
    start();
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    pageshow(true);
    assert.deepStrictEqual([...log], []);
    assert.deepStrictEqual(errors, []);
  });

  it('back/forward cache: a recorder that fails to resume is a catalogue error, and integrity carries on', async () => {
    const log = fakeReplay();
    const attach = win.CyborgHunterReplay.attach;
    win.CyborgHunterReplay.attach = (cfg) => Object.assign(attach(cfg), { resumeSession: () => { throw new Error('cannot resume'); } });
    const ctx = start({ replay: '' });
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    saved.segmentIndex = 4;
    win.sessionStorage.setItem(KEY, JSON.stringify(saved));
    pageshow(true);
    assert.strictEqual(errors.length, 1);
    const [head] = MESSAGES.replayRestoreFailed('\u0000').split('\u0000');
    assert.ok(errors[0].startsWith(head) && errors[0].includes('cannot resume'), errors[0]);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 4);
    paste('after the restore');
    const blob = win.CyborgHunter.data();
    assert.strictEqual(blob.trials[blob.trials.length - 1].integrity.pasteEvents.length, 1, 'integrity records on');
    assert.deepStrictEqual(log.slice(2), ['endTrial', 'startTrial:span-1', 'stopSession:finished'],
      'the recorder that did not resume is left alone');
  });

  it('back/forward cache without a saved session (storage blocked): the recorder still resumes', async () => {
    const log = fakeReplay();
    start({ replay: '' });
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    win.sessionStorage.removeItem(KEY);
    pageshow(true);
    assert.deepStrictEqual(log.slice(5), ['resumeSession', 'startTrial:span-1']);
    assert.deepStrictEqual(errors, []);
  });

  it('back/forward cache with the real recorder: replay() returns one recording, the restored visit in a keyframe segment marked as a restore', async () => {
    win.CyborgHunterReplay = { attach: attachRecorder };
    start({ replay: 'dom' });
    await tick();
    el('<p id="first-visit">one</p>');
    win.CyborgHunter.mark('q1');
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    el('<p id="changed-while-away">two</p>');   // dropped: the recorder is stopped
    await tick();
    pageshow(true);
    click(el('<button id="after-back">Next</button>'));
    await tick();
    const rec = win.CyborgHunter.replay();

    assert.deepStrictEqual(validateStrict(rec).errors, []);
    assert.deepStrictEqual(rec.segments.map((s) => s.label), ['span-0', 'q1', 'span-2', 'span-2']);
    const restored = rec.segments[3];
    assert.deepStrictEqual(restored.extensions, { 'cyborg-hunter': { restored_from: 'bfcache', root_attrs: {} } });
    assert.strictEqual(restored.initial_dom.id, 1, 'a keyframe, ids from 1');
    assert.ok(JSON.stringify(restored.initial_dom).includes('changed-while-away'));
    assert.ok(restored.events.some((e) => e.type === 'mouse.click'), 'the click after Back is recorded');
    // Each keyframe states <html>'s attributes (root_attrs; none on this
    // page), and a continuation states nothing: span-0 and span-2 open with a
    // keyframe, q1 continues span-0.
    const html = { 'cyborg-hunter': { root_attrs: {} } };
    assert.deepStrictEqual(rec.segments.slice(0, 3).map((s) => s.extensions), [html, null, html]);
    assert.strictEqual(rec.end_reason, 'finished');
    assert.strictEqual(win.CyborgHunter.replay(), rec, 'later calls return the same recording');
    assert.deepStrictEqual(errors, []);
  });

  it('back/forward cache after a span failed to reopen: the restored segment takes no closed span\'s name', async () => {
    const log = fakeReplay();
    const ctx = start({ replay: '' });
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    // The monitor refused to open the next span: the segmenter is closed,
    // and currentTrialId still names the span it just cut.
    const state = ctx.segmenter.state;
    ctx.segmenter.state = () => Object.assign(state(), { open: false });
    pageshow(true);
    assert.deepStrictEqual(log.slice(5), ['resumeSession', 'startTrial:null']);
    assert.deepStrictEqual(log.extensions, { 'cyborg-hunter': { restored_from: 'bfcache' } }, 'still marked');
  });

  it('back/forward cache, three times over with the real recorder: one marked keyframe per restore, no doubled capture', async () => {
    win.CyborgHunterReplay = { attach: attachRecorder };
    start({ replay: 'dom' });
    await tick();
    const button = el('<button id="b">Next</button>');
    for (let i = 0; i < 3; i++) {
      win.dispatchEvent(new win.Event('pagehide'));
      el('<p>away ' + i + '</p>');
      await tick();
      pageshow(true);
      click(button);
      await tick();
    }
    const rec = win.CyborgHunter.replay();
    assert.deepStrictEqual(validateStrict(rec).errors, []);
    const marked = rec.segments.filter((s) => s.extensions && s.extensions['cyborg-hunter'] &&
      s.extensions['cyborg-hunter'].restored_from === 'bfcache');
    assert.strictEqual(marked.length, 3);
    for (const s of marked) {
      assert.strictEqual(s.initial_dom && s.initial_dom.id, 1, 'segment ' + s.index + ' is a keyframe');
      assert.strictEqual(s.events.filter((e) => e.type === 'mouse.click').length, 1,
        'one click recorded once in segment ' + s.index + ' (no listener added per resume)');
    }
    assert.deepStrictEqual(rec.segments.map((s) => s.label),
      ['span-0', 'span-1', 'span-1', 'span-2', 'span-2', 'span-3', 'span-3']);
    assert.deepStrictEqual(rec.extensions['cyborg-hunter'].capture_failures, []);
    assert.strictEqual(rec.end_reason, 'finished');
    assert.deepStrictEqual(errors, []);
  });

  it('without data-replay nothing is loaded and replay() warns', async () => {
    const log = fakeReplay();
    start();
    await tick();
    assert.deepStrictEqual([...log], []);
    assert.strictEqual(win.CyborgHunter.replay(), null);
    assert.ok(warns.some((w) => w.includes('data-replay')), warns.join('\n'));
  });
});
