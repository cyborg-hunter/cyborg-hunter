// The Qualtrics host: ch.js in a survey's header, a fake Qualtrics
// .SurveyEngine (support/fake-qualtrics.js) and the real monitor, segmenter
// and vanilla adapter under happy-dom, booted the way dist/ch.js boots
// (vanilla-adapter.test.js bootstrap). The writer owns the page boundary: one
// cut and one checked, capped write per submit task. Nothing it does may
// throw into Qualtrics' submit, and nothing unchecked may reach the setter:
// either would stop the participant on the page.
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
  delete performance.timeOrigin;   // the own property laterPage() added; the prototype getter is back
  win.HTMLFormElement.prototype.submit = nativeFormSubmit;
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  win.close();
  delete global.window;
  delete global.document;
  delete global.Node;
  delete global.MutationObserver;
  delete global.ResizeObserver;
});

function start(fake, { maxChars, dataset } = {}) {
  win.Qualtrics = { SurveyEngine: fake.SE };
  const ctx = boot({
    script: { dataset: Object.assign({ participantId: 'P1', guards: 'none' }, dataset), src: 'https://cdn/x/ch.js' },
    win,
    qualtricsMaxChars: maxChars
  });
  contexts.push(ctx);
  return ctx;
}

// The writer again, with test options (a builder, a cap, the fallback
// switches). Qualtrics keeps the old writer's hook, inactive after teardown;
// the fake forgets it so the hook count starts again.
function reinstall(ctx, fake, opts) {
  ctx.qualtrics.teardown();
  fake.submitHooks.length = 0;
  ctx.qualtrics = installQualtricsAdapter(Object.assign({ win, ctx }, opts));
  return ctx.qualtrics;
}

// A new page load in the same tab (a reload, or the next legacy page): the
// page's ch.js is gone and a new one boots. happy-dom's sessionStorage is
// per Window, so the tab's storage is copied over; one node process has one
// performance.timeOrigin, so the new page gets its own.
const realOrigin = performance.timeOrigin;
function nextPage(ctx, ms) {
  ctx.qualtrics.teardown();
  ctx.vanilla.teardown();
  ctx.monitor.destroy();
  const saved = {};
  for (let i = 0; i < win.sessionStorage.length; i++) {
    const k = win.sessionStorage.key(i);
    saved[k] = win.sessionStorage.getItem(k);
  }
  const page = new Window({ url: 'https://survey.example/jfe/form/SV_test' });
  for (const [k, v] of Object.entries(saved)) page.sessionStorage.setItem(k, v);
  win.close();
  useWindow(page);
  Object.defineProperty(performance, 'timeOrigin', { value: realOrigin + ms, configurable: true });
}

// Two user actions never share a task: the writer's latch clears on a
// zero-delay timer, which runs before this one.
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const segments = (p) => p.trials.map((t) => t.integritySegment.segmentIndex);
const isReduced = (w) => w.startsWith('[cyborg-hunter] The Qualtrics payload was reduced');

// What the writer stores when the builder's output cannot be written.
function assertMarker(v, code, cap = MAX_CHARS) {
  assert.strictEqual(typeof v, 'string', 'the field was written');
  assert.ok(bytes(v) <= cap, bytes(v) + ' bytes');
  const p = JSON.parse(v);
  assert.strictEqual(p.participantId, 'P1');
  assert.deepStrictEqual(p.trials, []);
  assert.strictEqual(p.cyborgHunterOneLiner.host, 'qualtrics');
  assert.strictEqual(p.cyborgHunterOneLiner.truncated, true);
  assert.strictEqual(p.cyborgHunterOneLiner.error, code);
  assert.ok(p.cyborgHunterError.includes(code), p.cyborgHunterError);
  return p;
}

// A small valid payload, as a builder returns it.
function fits(extra) {
  return Object.assign({ json: JSON.stringify({ participantId: 'P1', trials: [] }), level: 0 }, extra);
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
    assert.deepStrictEqual(segments(p), [0]);
    assert.strictEqual(p.trials[0].integrity.pasteEvents.length, 1);
    assert.ok(bytes(v) <= MAX_CHARS);
    assert.deepStrictEqual(ctx.qualtrics.lastWrite(), { chars: bytes(v), cap: MAX_CHARS, level: 0 });
    assert.deepStrictEqual(errors, []);
  });

  it('a hook Qualtrics keeps across pages and re-registers cannot write twice for one submit', async () => {
    const fake = fakeSurveyEngine({ persistCallbacks: true });
    const ctx = start(fake);
    fake.submit('next');
    await tick();
    fake.rerunHeader(win, null);                             // page 2: ensureHook registers again
    assert.strictEqual(fake.submitHooks.length, 2);
    assert.strictEqual(ctx.qualtrics.page(), 2);
    paste('page two');
    const posted = fake.submit('next');                      // both callbacks fire
    const p = JSON.parse(posted[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);              // one cut, not two
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    assert.strictEqual(p.trials[1].integrity.pasteEvents.length, 1);
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
    let builds = 0;
    reinstall(ctx, fake, { builder: (o) => { builds += 1; return buildQualtricsPayload(o); } });
    for (let i = 0; i < 400; i++) tabAway(3500);
    const posted = fake.submit('next');
    const v = posted[STORED_FIELD];
    assert.ok(bytes(v) <= MAX_CHARS, bytes(v) + ' bytes');
    const p = JSON.parse(v);
    assert.ok(p.cyborgHunterOneLiner.truncated.level >= 1);
    assert.strictEqual(ctx.qualtrics.lastWrite().level, p.cyborgHunterOneLiner.truncated.level);
    assert.strictEqual(builds, 1, 'one build per write: the warning does not build again');
    assert.strictEqual(warns.filter(isReduced).length, 1);
    assert.ok(p.trials[p.trials.length - 1].integritySegment.score, 'the newest segment keeps the score');
    assert.strictEqual(fake.totalChars(), v.length);
  });

  it('never writes above the cap, however low the cap', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake, { maxChars: 300 });
    paste('x');
    const v = fake.submit('next')[STORED_FIELD];
    // The builder's own payload when one fits, the error marker otherwise.
    assert.ok(bytes(v) <= 300, bytes(v) + ' bytes');
    assert.strictEqual(typeof JSON.parse(v), 'object');
    assert.strictEqual(ctx.qualtrics.lastWrite().chars, bytes(v));
  });

  it('a setter that throws is reported and the survey goes on', () => {
    const fake = fakeSurveyEngine();
    fake.SE.setJSEmbeddedData = () => { throw new Error('nope'); };
    const ctx = start(fake);
    assert.doesNotThrow(() => fake.submit('next'));
    assert.deepStrictEqual(errors, [MESSAGES.qualtricsWriteFailed('nope')]);
    assert.strictEqual(ctx.segmenter.state().open, true);
    assert.strictEqual(ctx.qualtrics.lastWrite(), null);
  });

  it('CyborgHunter.data() writes the field and returns the payload', () => {
    const fake = fakeSurveyEngine();
    start(fake);
    const d = win.CyborgHunter.data();
    assert.strictEqual(d.cyborgHunterOneLiner.host, 'qualtrics');
    assert.strictEqual(fake.store[STORED_FIELD], JSON.stringify(d));
  });
});

describe('Qualtrics host: what reaches the field', () => {
  it('a builder that throws: the error marker is written in its place, within the cap', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { builder: () => { throw new Error('builder boom'); } });
    assert.doesNotThrow(() => fake.submit('next'));
    const v = fake.store[STORED_FIELD];
    assertMarker(v, 'build-failed');
    assert.deepStrictEqual(errors, [MESSAGES.qualtricsWriteFailed('build-failed: builder boom')]);
    assert.deepStrictEqual(ctx.qualtrics.lastWrite(), { chars: bytes(v), cap: MAX_CHARS, level: null, error: 'build-failed' });
    assert.ok(ctx.vanilla.blob().cyborgHunterError.includes('build-failed: builder boom'));
  });

  it('builder output that is not a JSON object within the cap never reaches the setter', async () => {
    const emoji = JSON.stringify({ a: '😀'.repeat(MAX_CHARS / 4) });
    const cjk = JSON.stringify({ a: '中'.repeat(MAX_CHARS / 3) });
    // Within the cap counted in UTF-16 code units, over it in UTF-8 bytes.
    for (const j of [emoji, cjk]) assert.ok(j.length <= MAX_CHARS && bytes(j) > MAX_CHARS);
    const cases = [
      ['no-json', () => ({ json: 12345, level: 0 })],
      ['no-json', () => ({ json: new String('{}'), level: 0 })],   // a String object, not a string
      ['no-json', () => ({ json: null, reason: 'cap too small' })],
      ['no-json', () => undefined],
      ['no-json', () => null],
      ['invalid-json', () => ({ json: 'not-json', level: 0 })],
      ['invalid-json', () => ({ json: '123', level: 0 })],
      ['invalid-json', () => ({ json: '[{}]', level: 0 })],
      ['invalid-json', () => ({ json: 'null', level: 0 })],
      ['over-cap', () => ({ json: JSON.stringify({ a: 'x'.repeat(MAX_CHARS) }), level: 4 })],
      ['over-cap', () => ({ json: emoji, level: 0 })],
      ['over-cap', () => ({ json: cjk, level: 0 })],
      ['build-failed', () => ({ get json() { throw new Error('getter'); } })]
    ];
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    for (const [code, builder] of cases) {
      reinstall(ctx, fake, { builder });
      errors.length = 0;
      assert.doesNotThrow(() => fake.submit('next'));
      assertMarker(fake.store[STORED_FIELD], code);
      assert.strictEqual(errors.length, 1, code + ': ' + errors.join('\n'));
      assert.ok(errors[0].includes(code), errors[0]);
      await tick();
    }
  });

  it('the builder\'s json is read once, so the string checked is the string written', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    const good = fits().json;
    let reads = 0;
    reinstall(ctx, fake, { builder: () => ({ level: 0, get json() { reads += 1; return reads === 1 ? good : 'not-json'; } }) });
    fake.submit('next');
    assert.strictEqual(fake.store[STORED_FIELD], good);
    assert.strictEqual(reads, 1);
  });

  it('below the error marker\'s own size nothing is written, and nothing throws', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { maxChars: 50, builder: () => ({ json: JSON.stringify({ a: 'x'.repeat(100) }), level: 4 }) });
    assert.doesNotThrow(() => fake.submit('next'));
    assert.strictEqual(fake.store[STORED_FIELD], undefined);
    assert.strictEqual(ctx.qualtrics.lastWrite(), null);
    assert.deepStrictEqual(errors, [MESSAGES.qualtricsWriteFailed('over-cap')]);
  });

  it('the error marker\'s participant id loses its control characters and stops at 128 characters', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    ctx.participantId = 'A\u0000B\u001f\u009f' + 'x'.repeat(500);
    reinstall(ctx, fake, { builder: () => { throw new Error('builder boom'); } });
    fake.submit('next');
    const p = JSON.parse(fake.store[STORED_FIELD]);
    assert.strictEqual(p.cyborgHunterOneLiner.error, 'build-failed');
    assert.strictEqual(p.participantId, 'AB' + 'x'.repeat(126));
  });

  it('a reduced payload is written first; the warning names the full size only when the builder reports one', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { builder: () => fits({ level: 2, fullChars: 15000 }) });
    fake.submit('next');
    assert.deepStrictEqual(warns.filter(isReduced), [MESSAGES.qualtricsPayloadReduced(2, 15000, MAX_CHARS)]);
    assert.ok(warns[0].includes('the full summary was 15000 bytes'), warns[0]);
    for (const fullChars of [undefined, NaN, -1, Infinity, '15000']) {
      await tick();
      warns.length = 0;
      reinstall(ctx, fake, { builder: () => fits({ level: 2, fullChars }) });
      fake.submit('next');
      assert.deepStrictEqual(warns.filter(isReduced), [MESSAGES.qualtricsPayloadReduced(2, undefined, MAX_CHARS)], String(fullChars));
      assert.ok(warns[0].includes('the full summary was above the cap of ' + MAX_CHARS + ' bytes'), warns[0]);
    }
    // A console that cannot warn does not keep the payload from Qualtrics.
    await tick();
    delete fake.store[STORED_FIELD];
    console.warn = () => { throw new Error('console down'); };
    reinstall(ctx, fake, { builder: () => fits({ level: 2, fullChars: 15000 }) });
    assert.doesNotThrow(() => fake.submit('next'));
    assert.strictEqual(fake.store[STORED_FIELD], fits().json);
    assert.strictEqual(ctx.qualtrics.lastWrite().level, 2);
  });
});

describe('Qualtrics host: nothing throws into the survey', () => {
  it('a thrown object without a prototype, or with a throwing message getter, is an unknown error', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    for (const thrown of [Object.create(null), { get message() { throw new Error('getter'); } }]) {
      reinstall(ctx, fake, { builder: () => { throw thrown; } });
      errors.length = 0;
      assert.doesNotThrow(() => fake.submit('next'));
      assertMarker(fake.store[STORED_FIELD], 'build-failed');
      assert.deepStrictEqual(errors, [MESSAGES.qualtricsWriteFailed('build-failed: unknown error')]);
      await tick();
    }
    fake.SE.setJSEmbeddedData = () => { throw Object.create(null); };
    reinstall(ctx, fake, {});
    errors.length = 0;
    assert.doesNotThrow(() => fake.submit('next'));
    assert.deepStrictEqual(errors, [MESSAGES.qualtricsWriteFailed('unknown error')]);
  });

  it('a console that throws stops neither the write nor the note', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    console.error = () => { throw new Error('console down'); };
    reinstall(ctx, fake, { builder: () => { throw new Error('builder boom'); } });
    assert.doesNotThrow(() => fake.submit('next'));
    assertMarker(fake.store[STORED_FIELD], 'build-failed');
    assert.ok(ctx.vanilla.blob().cyborgHunterError.includes('builder boom'));
  });

  it('a note that cannot be kept does not stop the error marker', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    ctx.vanilla.noteError = () => { throw new Error('notes down'); };
    reinstall(ctx, fake, { builder: () => { throw new Error('builder boom'); } });
    assert.doesNotThrow(() => fake.submit('next'));
    assertMarker(fake.store[STORED_FIELD], 'build-failed');
  });

  it('legacy layout: a session save that fails through a broken console stays inside the callback', () => {
    const fake = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    start(fake);
    Object.defineProperty(win, 'sessionStorage', { get() { throw new Error('blocked'); }, configurable: true });
    console.error = () => { throw new Error('console down'); };
    assert.doesNotThrow(() => fake.submit('next'));
    assert.ok(fake.store[LEGACY_FIELD], 'the write before the save went through');
  });

  it('a setter and a console that both throw, a note that cannot be kept, or Qualtrics gone at submit time', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    console.error = () => { throw new Error('console down'); };
    fake.SE.setJSEmbeddedData = () => { throw new Error('nope'); };
    assert.doesNotThrow(() => fake.submit('next'));
    await tick();
    console.error = (m) => errors.push(String(m));
    ctx.vanilla.noteError = () => { throw new Error('notes down'); };
    reinstall(ctx, fake, {});
    assert.doesNotThrow(() => fake.submit('next'));
    await tick();
    reinstall(ctx, fake, {});
    const hook = fake.submitHooks[0];
    delete win.Qualtrics;
    errors.length = 0;
    assert.doesNotThrow(() => hook('next'));
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].startsWith('[cyborg-hunter] Cyborg Hunter could not write to Qualtrics embedded data'), errors[0]);
  });

  it('CyborgHunter.data() with a throwing builder returns the error marker and builds once', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    let builds = 0;
    reinstall(ctx, fake, { builder: () => { builds += 1; throw new Error('builder boom'); } });
    let d;
    assert.doesNotThrow(() => { d = win.CyborgHunter.data(); });
    assert.strictEqual(builds, 1);
    assert.strictEqual(d.participantId, 'P1');
    assert.strictEqual(d.cyborgHunterOneLiner.error, 'build-failed');
    assert.strictEqual(fake.store[STORED_FIELD], JSON.stringify(d));
    // The setter refusing the marker too: still the marker, still one build.
    fake.SE.setJSEmbeddedData = () => { throw new Error('nope'); };
    builds = 0;
    assert.doesNotThrow(() => { d = win.CyborgHunter.data(); });
    assert.strictEqual(builds, 1);
    assert.strictEqual(d.cyborgHunterOneLiner.error, 'build-failed');
  });

  it('CyborgHunter.data() whose write the setter refuses still returns the checked payload', () => {
    const fake = fakeSurveyEngine();
    fake.SE.setJSEmbeddedData = () => { throw new Error('nope'); };
    start(fake);
    const d = win.CyborgHunter.data();
    assert.strictEqual(d.cyborgHunterOneLiner.host, 'qualtrics');
    assert.deepStrictEqual(segments(d), [0]);
    assert.deepStrictEqual(errors, [MESSAGES.qualtricsWriteFailed('nope')]);
  });

  it('the documented final-page CyborgHunter.data() line cannot make the submit throw', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    let boom = false;
    reinstall(ctx, fake, { builder: (o) => { if (boom) throw new Error('builder boom'); return buildQualtricsPayload(o); } });
    fake.submit('next');
    await tick();
    fake.rerunHeader(win, null);
    boom = true;
    fake.SE.addOnPageSubmit(function () { win.CyborgHunter.data(); });
    assert.doesNotThrow(() => fake.submit('next'));
    assertMarker(fake.store[STORED_FIELD], 'build-failed');
  });

  it('the re-run hook never throws, and the next page still gets its hook', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { writeOnRerun: true, builder: () => { throw new Error('builder boom'); } });
    assert.doesNotThrow(() => ctx.handlers.rerun());
    assert.strictEqual(ctx.qualtrics.page(), 2);
    assert.strictEqual(fake.submitHooks.length, 2);
    assertMarker(fake.store[STORED_FIELD], 'build-failed');
    console.error = () => { throw new Error('console down'); };
    fake.SE.addOnPageSubmit = () => { throw new Error('no hooks'); };
    assert.doesNotThrow(() => ctx.handlers.rerun());
    assert.strictEqual(ctx.qualtrics.page(), 3);
  });

  it('addOnPageSubmit and the console both throwing at install: boot still succeeds', () => {
    const fake = fakeSurveyEngine();
    fake.SE.addOnPageSubmit = () => { throw new Error('no hooks'); };
    console.error = () => { throw new Error('console down'); };
    const ctx = start(fake);
    assert.ok(ctx && ctx.qualtrics, 'the writer is installed');
    assert.ok(win.CyborgHunter.data().trials, 'data() still answers');
  });
});

describe('Qualtrics host: one write per submit task', () => {
  it('a callback run twice in one task cuts and writes once; a later task writes again', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    const hook = fake.submitHooks[0];
    hook('next');
    hook('next');
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 1);
    await tick();
    paste('after');
    hook('next');
    assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    assert.deepStrictEqual(segments(JSON.parse(fake.store[STORED_FIELD])), [0, 1]);
  });

  // Qualtrics runs the page-submit callbacks before force-response
  // validation stops the page.
  it('a submit that validation stops writes, and the real submit after it writes again with what came between', async () => {
    const fake = fakeSurveyEngine();
    start(fake);
    paste('first try');
    assert.strictEqual(fake.submit('next', { blocked: true }), null);
    await tick();
    paste('after the validation message');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
    assert.strictEqual(p.trials[0].integrity.pasteEvents.length, 1);
    assert.strictEqual(p.trials[1].integrity.pasteEvents.length, 1);
  });

  it('CyborgHunter.data() cuts and writes on every call, and the submit after it still writes', () => {
    const fake = fakeSurveyEngine();
    start(fake);
    assert.deepStrictEqual(segments(win.CyborgHunter.data()), [0]);
    paste('after data()');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
    assert.strictEqual(p.trials[1].integrity.pasteEvents.length, 1);
  });

  it('CyborgHunter.data() inside the submit (the final-page line) adds a short segment and loses nothing', () => {
    const fake = fakeSurveyEngine();
    start(fake);
    fake.SE.addOnPageSubmit(function () { win.CyborgHunter.data(); });
    paste('final page');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
    assert.strictEqual(p.trials[0].integrity.pasteEvents.length, 1);
  });

  it('a timer that cannot be set leaves no latch behind', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    const setTimeoutBefore = win.setTimeout;
    win.setTimeout = () => { throw new Error('no timers'); };
    try {
      const hook = fake.submitHooks[0];
      hook('next');
      hook('next');
      assert.strictEqual(ctx.segmenter.state().segmentIndex, 2);
    } finally {
      win.setTimeout = setTimeoutBefore;
    }
  });

  it('a new page clears the latch even before the timer has run', () => {
    const fake = fakeSurveyEngine({ persistCallbacks: true });
    const ctx = start(fake, {});
    reinstall(ctx, fake, { registerOnce: true });
    fake.submit('next');
    fake.rerunHeader(win, null);
    paste('page two');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
  });
});

describe('Qualtrics host: the fallbacks live verification can pick', () => {
  // A hook Qualtrics keeps across pages: one registration serves the survey.
  it('register once: a re-run adds no hook and each page is still written once', async () => {
    const fake = fakeSurveyEngine({ persistCallbacks: true });
    const ctx = start(fake);
    reinstall(ctx, fake, { registerOnce: true });
    assert.strictEqual(fake.submitHooks.length, 1);
    fake.submit('next');
    await tick();
    fake.rerunHeader(win, null);
    assert.strictEqual(fake.submitHooks.length, 1);
    paste('page two');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
  });

  // The header's hook never fires: each re-run writes the page before it, and
  // a final-page question script calls CyborgHunter.data() for the last page.
  it('write on re-run: the re-run writes the previous page and data() still writes the last one', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { writeOnRerun: true });
    paste('page one');
    fake.rerunHeader(win, null);
    const p1 = JSON.parse(fake.store[STORED_FIELD]);
    assert.deepStrictEqual(segments(p1), [0]);
    assert.strictEqual(p1.trials[0].integrity.pasteEvents.length, 1);
    assert.strictEqual(ctx.qualtrics.page(), 2);
    paste('page two');
    const d = win.CyborgHunter.data();
    assert.deepStrictEqual(segments(d), [0, 1]);
    assert.strictEqual(fake.store[STORED_FIELD], JSON.stringify(d));
  });
});

// Qualtrics keeps a response across a reload ("Allow respondents to finish
// later" is on by default) and resumes it on the same page, while the
// reload boots a new ch.js in the same tab.
describe('Qualtrics host: a reload', () => {
  it('pagehide saves the session without a cut, and the resumed page\'s write holds every page', async () => {
    const fake1 = fakeSurveyEngine();
    const ctx1 = start(fake1);
    paste('page one');
    fake1.submit('next');
    await tick();
    fake1.rerunHeader(win, null);
    paste('page two');
    fake1.submit('next');
    await tick();
    fake1.rerunHeader(win, null);                            // page three, then the reload
    win.dispatchEvent(new win.Event('pagehide'));
    assert.deepStrictEqual(ctx1.segmenter.state(), { open: true, segmentIndex: 2, currentTrialId: 'span-2' }, 'no cut');
    assert.deepStrictEqual(JSON.parse(win.sessionStorage.getItem(KEY)).trials.map((t) => t.integritySegment.segmentIndex), [0, 1]);

    nextPage(ctx1, 30000);
    const fake2 = fakeSurveyEngine();
    start(fake2);
    const p = JSON.parse(fake2.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1, 2]);
    assert.strictEqual(p.trials[0].integrity.pasteEvents.length, 1);
    assert.strictEqual(p.trials[1].integrity.pasteEvents.length, 1);
    assert.strictEqual(p.cyborgHunterOneLiner.pageCount, 2, 'two page loads');
  });

  it('a writer torn down saves nothing at pagehide', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    win.CyborgHunter.mark('q2');
    ctx.qualtrics.teardown();
    win.dispatchEvent(new win.Event('pagehide'));
    assert.strictEqual(win.sessionStorage.getItem(KEY), null);
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

  it('every submit callback saves the session, the second callback of a task included', () => {
    const fake = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    start(fake);
    const hook = fake.submitHooks[0];
    hook('next');
    win.CyborgHunter.mark('q2');                              // a cut between two callbacks of one task
    hook('next');
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.deepStrictEqual(saved.trials.map((t) => t.integritySegment.segmentIndex), [0, 1]);
  });

  it('the next page load restores the session, and its write carries both pages', () => {
    const fake1 = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    const ctx1 = start(fake1);
    paste('page one');
    fake1.submit('next');
    win.dispatchEvent(new win.Event('pagehide'));
    nextPage(ctx1, 30000);
    const fake2 = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    start(fake2);
    const p = JSON.parse(fake2.submit('next')[LEGACY_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
    assert.strictEqual(p.trials[0].integrity.pasteEvents.length, 1);
    assert.strictEqual(p.cyborgHunterOneLiner.pageCount, 2);
  });

  // Every legacy page is a new boot, so the header-run count is 1 on each.
  it('page(), the debug summary and the failure note count the page loads', () => {
    const fake1 = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    const ctx1 = start(fake1, { dataset: { debug: '' } });
    assert.strictEqual(ctx1.qualtrics.page(), 1);
    fake1.submit('next');
    win.dispatchEvent(new win.Event('pagehide'));
    nextPage(ctx1, 30000);
    const fake2 = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    fake2.SE.setEmbeddedData = () => { throw new Error('nope'); };
    const ctx2 = start(fake2, { dataset: { debug: '' } });
    assert.strictEqual(ctx2.qualtrics.page(), 2);
    assert.ok(ctx2.debug.summary().includes(' · page 2 · '), ctx2.debug.summary());
    fake2.submit('next');
    assert.ok(ctx2.vanilla.blob().cyborgHunterError.includes('Qualtrics write failed on page 2: nope'), ctx2.vanilla.blob().cyborgHunterError);
  });

  it('pagehide saves a cut no submit saved', () => {
    const fake = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    start(fake);
    win.CyborgHunter.mark('q2');
    win.dispatchEvent(new win.Event('pagehide'));
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.deepStrictEqual(saved.trials.map((t) => t.integritySegment.segmentIndex), [0]);
  });

  it('the submit after CyborgHunter.data() saves what came between', () => {
    const fake = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    start(fake);
    win.CyborgHunter.data();
    paste('after data()');
    fake.submit('next');
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.deepStrictEqual(saved.trials.map((t) => t.integritySegment.segmentIndex), [0, 1]);
    assert.strictEqual(saved.trials[1].integrity.pasteEvents.length, 1);
  });
});
