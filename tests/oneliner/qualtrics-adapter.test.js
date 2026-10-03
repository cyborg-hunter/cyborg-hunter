// The Qualtrics host: ch.js in a survey's header, a fake Qualtrics
// .SurveyEngine (support/fake-qualtrics.js) and the real monitor, segmenter
// and vanilla adapter under happy-dom, booted the way dist/ch.js boots
// (vanilla-adapter.test.js bootstrap). The writer owns the page boundary: one
// cut and one capped write per page submit.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { MESSAGES } from '../../src/oneliner/errors.js';
import { fakeSurveyEngine } from './support/fake-qualtrics.js';
import { buildQualtricsPayload } from '../../src/oneliner/qualtrics-payload.js';
import { MAX_CHARS, STORED_FIELD, LEGACY_FIELD, installQualtricsAdapter } from '../../src/oneliner/adapters/qualtrics.js';

class StubResizeObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
}

const KEY = 'cyborg-hunter:oneliner:session:P1';
let win, boot, errors, warns, orig, contexts, nativeFormSubmit, clock;

// Before the dynamic import: core signals/focus.js listens on the global
// window, so a window created after the import would record no tab-away.
function useWindow(w) {
  win = w;
  global.window = w;
  global.document = w.document;
  global.Node = w.Node;
  global.MutationObserver = w.MutationObserver;
}

beforeEach(async () => {
  useWindow(new Window({ url: 'https://survey.example/jfe/form/SV_test' }));
  global.ResizeObserver = StubResizeObserver;
  ({ boot } = await import('../../src/oneliner/boot.js'));
  errors = []; warns = []; contexts = [];
  nativeFormSubmit = win.HTMLFormElement.prototype.submit;
  clock = 1000;
  Object.defineProperty(performance, 'now', { value: () => clock, configurable: true });
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (m) => errors.push(String(m));
  console.warn = (m) => warns.push(String(m));
  console.info = () => {};
});

afterEach(() => {
  for (const c of contexts.slice().reverse()) {
    if (c && c.qualtrics) c.qualtrics.teardown();
    if (c && c.vanilla) c.vanilla.teardown();
    if (c && c.monitor) { try { c.monitor.destroy(); } catch { /* already destroyed */ } }
  }
  delete performance.now;   // the own property beforeEach added; the prototype method is back
  win.HTMLFormElement.prototype.submit = nativeFormSubmit;
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  win.close();
  delete global.window;
  delete global.document;
  delete global.Node;
  delete global.MutationObserver;
  delete global.ResizeObserver;
});

function start(fake, { maxChars } = {}) {
  win.Qualtrics = { SurveyEngine: fake.SE };
  const ctx = boot({
    script: { dataset: { participantId: 'P1', guards: 'none' }, src: 'https://cdn/x/ch.js' },
    win,
    qualtricsMaxChars: maxChars
  });
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

function form() {
  const f = el('<form method="post" action="/submit"><textarea name="answer"></textarea></form>');
  f.addEventListener('submit', (e) => e.preventDefault());
  return f;
}

function submit(f) {
  f.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
}

function tabAway(ms) {
  win.dispatchEvent(new win.Event('blur'));
  clock += ms;
  win.dispatchEvent(new win.Event('focus'));
}

describe('Qualtrics host: the page-submit writer', () => {
  it('registers one page-submit hook and writes the field exactly once per submit', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    assert.strictEqual(fake.submitHooks.length, 1);
    paste('page one');
    const posted = fake.submit('next');
    const v = posted[STORED_FIELD];
    assert.ok(v, 'the field was written');
    const p = JSON.parse(v);
    assert.strictEqual(p.participantId, 'P1');
    assert.strictEqual(p.cyborgHunterOneLiner.host, 'qualtrics');
    assert.deepStrictEqual(p.trials.map((t) => t.integritySegment.segmentIndex), [0]);
    assert.strictEqual(p.trials[0].integrity.pasteEvents.length, 1);
    assert.ok(v.length <= MAX_CHARS);
    assert.deepStrictEqual(ctx.qualtrics.lastWrite(), { chars: v.length, cap: MAX_CHARS, level: 0 });
    assert.deepStrictEqual(errors, []);
  });

  it('a hook Qualtrics keeps across pages and re-registers cannot write twice for one submit', () => {
    const fake = fakeSurveyEngine({ persistCallbacks: true });
    const ctx = start(fake);
    fake.submit('next');
    fake.rerunHeader(win, null);                             // page 2: ensureHook registers again
    assert.strictEqual(fake.submitHooks.length, 2);
    assert.strictEqual(ctx.qualtrics.page(), 2);
    paste('page two');
    const posted = fake.submit('next');                      // both callbacks fire
    const p = JSON.parse(posted[STORED_FIELD]);
    assert.deepStrictEqual(p.trials.map((t) => t.integritySegment.segmentIndex), [0, 1]);   // one cut, not two
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    assert.strictEqual(p.trials[1].integrity.pasteEvents.length, 1);
  });

  it('a header re-run adds no hook when the page did not change, and a second write on the same page is a no-op', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    assert.strictEqual(ctx.qualtrics.write('data') !== null, true);
    assert.strictEqual(ctx.qualtrics.write('data'), null);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    assert.strictEqual(fake.submitHooks.length, 1);
  });

  it('vanilla page listeners are not installed: a form submit inside the survey cuts nothing', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    const f = form(); submit(f);
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(ctx.vanilla.blob().trials.length, 0);
    assert.strictEqual(f.querySelector('input[name="cyborgHunterData"]'), null);
    assert.strictEqual(win.HTMLFormElement.prototype.submit, nativeFormSubmit);
  });

  it('an over-cap session is reduced before it is written, flagged, and still scores', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    for (let i = 0; i < 400; i++) tabAway(3500);
    const posted = fake.submit('next');
    const v = posted[STORED_FIELD];
    assert.ok(v.length <= MAX_CHARS, v.length + ' chars');
    const p = JSON.parse(v);
    assert.ok(p.cyborgHunterOneLiner.truncated.level >= 1);
    assert.strictEqual(ctx.qualtrics.lastWrite().level, p.cyborgHunterOneLiner.truncated.level);
    const reduced = warns.filter((w) => w.startsWith('[cyborg-hunter] The Qualtrics payload was reduced'));
    assert.strictEqual(reduced.length, 1);
    const full = buildQualtricsPayload({ blob: ctx.vanilla.blob(), maxChars: Infinity }).chars;
    assert.ok(full > MAX_CHARS, full + ' chars before reduction');
    assert.ok(reduced[0].includes('the full summary was ' + full + ' characters'), 'names the size before reduction: ' + reduced[0]);
    assert.ok(p.trials[p.trials.length - 1].integritySegment.score, 'the newest segment keeps the score');
    assert.strictEqual(fake.totalChars(), v.length);
  });

  it('never writes above the cap even when the cap is absurdly low', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake, { maxChars: 300 });
    paste('x');
    const posted = fake.submit('next');
    assert.strictEqual(posted[STORED_FIELD], undefined);
    assert.ok(errors.some((e) => e.includes('payload over cap after reduction')));
    assert.ok(ctx.vanilla.blob().cyborgHunterError.includes('over cap'));
    assert.strictEqual(ctx.qualtrics.lastWrite(), null);
  });

  it('a setter that throws is reported and the survey goes on', () => {
    const fake = fakeSurveyEngine();
    fake.SE.setJSEmbeddedData = () => { throw new Error('nope'); };
    const ctx = start(fake);
    assert.doesNotThrow(() => fake.submit('next'));
    assert.deepStrictEqual(errors, [MESSAGES.qualtricsWriteFailed('nope')]);
    assert.strictEqual(ctx.segmenter.state().open, true);
  });

  it('CyborgHunter.data() writes the field and returns the payload', () => {
    const fake = fakeSurveyEngine();
    start(fake);
    const d = win.CyborgHunter.data();
    assert.strictEqual(d.cyborgHunterOneLiner.host, 'qualtrics');
    assert.strictEqual(fake.store[STORED_FIELD], JSON.stringify(d));
  });

  it('CyborgHunter.data() after the page was written returns the payload without a second write', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    const first = win.CyborgHunter.data();
    const again = win.CyborgHunter.data();
    assert.deepStrictEqual(again, first);
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
  });
});

describe('Qualtrics host: the fallbacks live verification can pick', () => {
  // A hook Qualtrics keeps across pages: one registration serves the survey.
  it('register once: a re-run adds no hook and each page is still written once', () => {
    const fake = fakeSurveyEngine({ persistCallbacks: true });
    const ctx = start(fake);
    ctx.qualtrics.teardown();
    fake.submitHooks.length = 0;
    ctx.qualtrics = installQualtricsAdapter({ win, ctx, registerOnce: true });
    assert.strictEqual(fake.submitHooks.length, 1);
    fake.submit('next');
    fake.rerunHeader(win, null);
    assert.strictEqual(fake.submitHooks.length, 1);
    paste('page two');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(p.trials.map((t) => t.integritySegment.segmentIndex), [0, 1]);
  });

  // The header's hook never fires: each re-run writes the page before it, and
  // a final-page question script calls CyborgHunter.data() for the last page.
  it('write on re-run: the re-run writes the previous page and data() still writes the last one', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    ctx.qualtrics.teardown();
    ctx.qualtrics = installQualtricsAdapter({ win, ctx, writeOnRerun: true });
    paste('page one');
    fake.rerunHeader(win, null);
    const p1 = JSON.parse(fake.store[STORED_FIELD]);
    assert.deepStrictEqual(p1.trials.map((t) => t.integritySegment.segmentIndex), [0]);
    assert.strictEqual(p1.trials[0].integrity.pasteEvents.length, 1);
    assert.strictEqual(ctx.qualtrics.page(), 2);
    paste('page two');
    const d = win.CyborgHunter.data();
    assert.deepStrictEqual(d.trials.map((t) => t.integritySegment.segmentIndex), [0, 1]);
    assert.strictEqual(fake.store[STORED_FIELD], JSON.stringify(d));
  });
});

describe('Qualtrics host: the legacy layout', () => {
  it('writes cyborg_hunter through setEmbeddedData and keeps the session for the next page load', () => {
    const fake = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    const ctx = start(fake);
    assert.strictEqual(ctx.qualtricsLayout, 'legacy');
    paste('page one');
    const p = JSON.parse(fake.submit('next')[LEGACY_FIELD]);
    assert.strictEqual(p.trials[0].integrity.pasteEvents.length, 1);
    // Each legacy page is a full load: the next page's boot restores this.
    assert.strictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials.length, 1);
  });
});
