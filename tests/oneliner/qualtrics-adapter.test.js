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
import { MAX_CHARS, FIELD_NAME, STORED_FIELD, LEGACY_FIELD, installQualtricsAdapter, qualtricsSurveyId } from '../../src/oneliner/adapters/qualtrics.js';

class StubResizeObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
}

// The tab's saved session: per survey under the New Survey Taking Experience
// (the test survey is SV_test), unscoped under the legacy layout.
const KEY = 'cyborg-hunter:oneliner:session:P1';
const keyFor = (survey, pid = 'P1') => 'cyborg-hunter:oneliner:session:' + survey + ':' + pid;
const SCOPED = keyFor('SV_test');
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
  const ctx = fake.runHeader(() => boot({
    script: { dataset: Object.assign({ participantId: 'P1', guards: 'none' }, dataset), src: 'https://cdn/x/ch.js' },
    win,
    qualtricsMaxChars: maxChars
  }));
  contexts.push(ctx);
  return ctx;
}

// The writer again, with test options (a builder, a cap, the fallback
// switches). Qualtrics keeps the old writer's hook, inactive after teardown;
// the fake forgets it so the hook count starts again.
function reinstall(ctx, fake, opts) {
  ctx.qualtrics.teardown();
  fake.submitHooks.length = 0;
  ctx.qualtrics = fake.runHeader(() => installQualtricsAdapter(Object.assign({ win, ctx }, opts)));
  return ctx.qualtrics;
}

// A new page load in the same tab (a reload, the next legacy page, or
// another survey at `url`): the page's ch.js is gone and a new one boots.
// happy-dom's sessionStorage is per Window, so the tab's storage is copied
// over; one node process has one performance.timeOrigin, so the new page
// gets its own.
const realOrigin = performance.timeOrigin;
function nextPage(ctx, ms, url = 'https://survey.example/jfe/form/SV_test') {
  ctx.qualtrics.teardown();
  ctx.vanilla.teardown();
  ctx.monitor.destroy();
  const saved = {};
  for (let i = 0; i < win.sessionStorage.length; i++) {
    const k = win.sessionStorage.key(i);
    saved[k] = win.sessionStorage.getItem(k);
  }
  const page = new Window({ url });
  for (const [k, v] of Object.entries(saved)) page.sessionStorage.setItem(k, v);
  win.close();
  useWindow(page);
  Object.defineProperty(performance, 'timeOrigin', { value: realOrigin + ms, configurable: true });
}

// The test starts at another address, before anything boots.
function openAt(url) {
  const page = new Window({ url });
  win.close();
  useWindow(page);
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

  // A test seam for the browser harness (tests/e2e/oneliner), which has no
  // other way into boot: not a researcher option. It can only lower the cap.
  it('CyborgHunterConfig.qualtricsMaxChars lowers the cap and never reaches the monitor', () => {
    win.CyborgHunterConfig = { qualtricsMaxChars: 3000 };
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    for (let i = 0; i < 40; i++) tabAway(3500);
    const v = fake.submit('next')[STORED_FIELD];
    assert.strictEqual(ctx.qualtrics.lastWrite().cap, 3000);
    assert.ok(bytes(v) <= 3000, bytes(v) + ' bytes');
    assert.ok(!('qualtricsMaxChars' in ctx.config.monitor));
    assert.deepStrictEqual(warns.filter((w) => w.includes('qualtricsMaxChars')), []);
  });

  it('CyborgHunterConfig.qualtricsMaxChars above MAX_CHARS is clamped: no page config can raise the cap', () => {
    win.CyborgHunterConfig = { qualtricsMaxChars: 50000 };
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    for (let i = 0; i < 150; i++) tabAway(3500);
    const v = fake.submit('next')[STORED_FIELD];
    assert.strictEqual(ctx.qualtrics.lastWrite().cap, MAX_CHARS);
    assert.ok(bytes(v) <= MAX_CHARS, bytes(v) + ' bytes');
    assert.ok(JSON.parse(v).cyborgHunterOneLiner.truncated.level >= 1, 'reduced to the default cap');
  });

  for (const bad of [0, -1, 1.5, '50000', NaN, Infinity, null]) {
    it('CyborgHunterConfig.qualtricsMaxChars ' + String(bad) + ' leaves the cap at MAX_CHARS', () => {
      win.CyborgHunterConfig = { qualtricsMaxChars: bad };
      const fake = fakeSurveyEngine();
      const ctx = start(fake);
      fake.submit('next');
      assert.strictEqual(ctx.qualtrics.lastWrite().cap, MAX_CHARS);
    });
  }

  // The writer clamps its own cap, so neither boot's test option nor an
  // install option can raise it above MAX_CHARS with the real builder.
  it('boot\'s qualtricsMaxChars above MAX_CHARS is clamped by the writer', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake, { maxChars: 50000 });
    for (let i = 0; i < 150; i++) tabAway(3500);
    const v = fake.submit('next')[STORED_FIELD];
    assert.strictEqual(ctx.qualtrics.lastWrite().cap, MAX_CHARS);
    assert.ok(bytes(v) <= MAX_CHARS, bytes(v) + ' bytes');
    assert.ok(JSON.parse(v).cyborgHunterOneLiner.truncated.level >= 1, 'reduced to the default cap');
  });

  it('installQualtricsAdapter({ maxChars }) above MAX_CHARS is clamped; a lower one is kept', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { maxChars: 50000 });
    for (let i = 0; i < 150; i++) tabAway(3500);
    const v = fake.submit('next')[STORED_FIELD];
    assert.strictEqual(ctx.qualtrics.lastWrite().cap, MAX_CHARS);
    assert.ok(bytes(v) <= MAX_CHARS, bytes(v) + ' bytes');
    reinstall(ctx, fake, { maxChars: 3000 });
    const low = fake.submit('next')[STORED_FIELD];
    assert.strictEqual(ctx.qualtrics.lastWrite().cap, 3000);
    assert.ok(bytes(low) <= 3000, bytes(low) + ' bytes');
  });

  for (const bad of [0, -1, 1.5, '5000', NaN, Infinity, null, {}]) {
    it('installQualtricsAdapter({ maxChars: ' + String(bad) + ' }) writes under MAX_CHARS', () => {
      const fake = fakeSurveyEngine();
      const ctx = start(fake);
      reinstall(ctx, fake, { maxChars: bad });
      fake.submit('next');
      assert.strictEqual(ctx.qualtrics.lastWrite().cap, MAX_CHARS);
    });
  }
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

  it('CyborgHunter.data() with a throwing builder returns the error marker and builds once', async () => {
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
    await tick();                                            // a later call: a task of its own
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

  // A page script can make every JSON.stringify throw. Then nothing can be
  // written, the error marker included, but no entry point may throw: a
  // researcher's own unwrapped data() call sits in a submit callback.
  it('a page whose Object.prototype.toJSON throws: data(), the submit and the re-run throw nothing and write nothing', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    paste('x');
    let d;
    Object.defineProperty(Object.prototype, 'toJSON', { value() { throw new Error('toJSON boom'); }, configurable: true, writable: true });
    try {
      assert.doesNotThrow(() => { d = win.CyborgHunter.data(); });
      assert.doesNotThrow(() => fake.submit('next'));
      assert.doesNotThrow(() => ctx.handlers.rerun());
    } finally {
      delete Object.prototype.toJSON;
    }
    // The builder could serialize nothing (no json), and neither could the
    // marker that data() returns in its place.
    assert.strictEqual(d.cyborgHunterOneLiner.error, 'no-json');
    assert.deepStrictEqual(d.trials, []);
    assert.strictEqual(fake.store[STORED_FIELD], undefined);
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

  it('CyborgHunter.data() cuts and writes on every call, and the submit after it still writes', async () => {
    const fake = fakeSurveyEngine();
    start(fake);
    assert.deepStrictEqual(segments(win.CyborgHunter.data()), [0]);
    await tick();                                            // the participant's submit is a task of its own
    assert.deepStrictEqual(segments(win.CyborgHunter.data()), [0, 1]);
    await tick();
    paste('after data()');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1, 2]);
    assert.strictEqual(p.trials[2].integrity.pasteEvents.length, 1);
  });

  // The final-page line and the writer's own hook run in one submit task, in
  // either order: whichever runs first cuts and writes, the other adds
  // nothing, so the page is one row.
  it('CyborgHunter.data() inside the submit, after the writer\'s hook: no second cut, data() returns what was written', () => {
    const fake = fakeSurveyEngine();
    start(fake);
    let d = null;
    fake.SE.addOnPageSubmit(function () { d = win.CyborgHunter.data(); });
    paste('final page');
    const v = fake.submit('next')[STORED_FIELD];
    const p = JSON.parse(v);
    assert.deepStrictEqual(segments(p), [0]);
    assert.strictEqual(p.trials[0].integrity.pasteEvents.length, 1);
    assert.strictEqual(JSON.stringify(d), v);
  });

  it('CyborgHunter.data() inside the submit, before the writer\'s hook: the hook adds no cut, and the page counts as submitted', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    paste('page one');
    fake.submit('next');
    await tick();
    fake.SE.addOnPageSubmit(function () { win.CyborgHunter.data(); });   // the question script, as page 2 renders
    fake.rerunHeader(win, null);                                         // then the header: its hook comes second
    paste('page two');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
    assert.deepStrictEqual(p.trials.map((t) => t.integrity.pasteEvents.length), [1, 1]);
    await tick();
    fake.rerunHeader(win, null);
    assert.strictEqual(ctx.qualtrics.missed(), 0, 'a submit task whose cut data() made is not a miss');
    assert.strictEqual(fake.store[STORED_FIELD], JSON.stringify(p));
  });

  // In a hidden tab the latch's timer may still be pending at the next user
  // input; input always starts a new task, so it clears the latch.
  for (const type of ['pointerdown', 'keydown']) {
    it('a ' + type + ' clears the latch: CyborgHunter.data() then the participant\'s submit, with no timer between, cuts twice', () => {
      const fake = fakeSurveyEngine();
      const ctx = start(fake);
      win.CyborgHunter.data();
      paste('after data()');
      win.document.dispatchEvent(new win.Event(type, { bubbles: true }));
      const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
      assert.deepStrictEqual(segments(p), [0, 1]);
      assert.strictEqual(p.trials[1].integrity.pasteEvents.length, 1);
      ctx.qualtrics.teardown();                              // the listener goes with the writer
      assert.doesNotThrow(() => win.document.dispatchEvent(new win.Event(type, { bubbles: true })));
    });
  }

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

  // Write on re-run with a header hook that fires after all, on some pages or
  // on all: a page its submit wrote is not written again by the re-run, so
  // there is one row per page and no empty row between a submit and a re-run.
  const pastes = (p) => p.trials.map((t) => t.integrity.pasteEvents.length);

  it('write on re-run, with a header hook that fires on page one only: one row per page', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { writeOnRerun: true });
    let sets = 0;
    const set = fake.SE.setJSEmbeddedData;
    fake.SE.setJSEmbeddedData = (n, v) => { sets += 1; set(n, v); };
    paste('page one');
    fake.submit('next');                                     // the hook fires: page one written
    await tick();
    for (const pasted of [false, true]) {                    // pages two and three
      fake.rerunHeader(win, null);
      fake.submitHooks.length = 0;                           // from here the header's hook never fires
      if (pasted) paste('page three');
      fake.submit('next');
      await tick();
    }
    fake.rerunHeader(win, null);                             // page four
    fake.submitHooks.length = 0;
    fake.SE.addOnPageSubmit(function () { win.CyborgHunter.data(); });   // the call the documented final-page line makes
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1, 2, 3]);
    assert.deepStrictEqual(pastes(p), [1, 0, 1, 0]);
    assert.strictEqual(sets, 4, 'one write per page');
  });

  it('write on re-run, with a header hook that fires on every page: one row per page', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { writeOnRerun: true });
    let sets = 0;
    const set = fake.SE.setJSEmbeddedData;
    fake.SE.setJSEmbeddedData = (n, v) => { sets += 1; set(n, v); };
    for (let i = 1; i <= 4; i++) {
      if (i > 1) fake.rerunHeader(win, null);
      if (i % 2) paste('page ' + i);
      fake.submit('next');
      await tick();
    }
    const p = JSON.parse(fake.store[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1, 2, 3]);
    assert.deepStrictEqual(pastes(p), [1, 0, 1, 0]);
    assert.strictEqual(sets, 4);
  });

  it('write on re-run: CyborgHunter.data() mid-page does not stand in for the page\'s write', () => {
    const fake = fakeSurveyEngine({ headerHooks: false });
    const ctx = start(fake);
    reinstall(ctx, fake, { writeOnRerun: true });
    win.CyborgHunter.data();                                 // the researcher's own call
    paste('after data()');
    fake.rerunHeader(win, null);                             // the re-run still writes page one
    const p = JSON.parse(fake.store[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
    assert.deepStrictEqual(pastes(p), [0, 1]);
  });

  it('write on re-run, hook firing: CyborgHunter.data() before the submit does not take the submit\'s write', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { writeOnRerun: true });
    win.CyborgHunter.data();
    await tick();
    paste('after data()');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(pastes(p), [0, 1]);
    fake.rerunHeader(win, null);                             // the submit wrote: nothing more
    assert.strictEqual(fake.store[STORED_FIELD], JSON.stringify(p));
  });

  it('write on re-run: a submit whose setter threw is retried by the re-run', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { writeOnRerun: true });
    const set = fake.SE.setJSEmbeddedData;
    fake.SE.setJSEmbeddedData = () => { throw new Error('nope'); };
    paste('page one');
    fake.submit('next');
    await tick();
    fake.SE.setJSEmbeddedData = set;
    fake.rerunHeader(win, null);
    const p = JSON.parse(fake.store[STORED_FIELD]);
    // The failed submit's cut stays; the retry adds the span up to the re-run.
    assert.deepStrictEqual(segments(p), [0, 1]);
    assert.deepStrictEqual(pastes(p), [1, 0]);
  });

  // The case the switch is for: the header's hook is taken and never fires.
  it('write on re-run, with a header hook that never fires: the submit writes nothing, the re-run writes the page before, the final-page line the last', () => {
    const fake = fakeSurveyEngine({ headerHooks: false });
    const ctx = start(fake);
    reinstall(ctx, fake, { writeOnRerun: true });
    paste('page one');
    fake.submit('next');
    assert.strictEqual(fake.store[STORED_FIELD], undefined);
    fake.rerunHeader(win, null);                             // page two's header writes page one
    const p1 = JSON.parse(fake.store[STORED_FIELD]);
    assert.deepStrictEqual(segments(p1), [0]);
    assert.strictEqual(p1.trials[0].integrity.pasteEvents.length, 1);
    paste('last page');
    fake.SE.addOnPageSubmit(function () { win.CyborgHunter.data(); });   // the call the documented final-page line makes
    const p2 = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p2), [0, 1]);
    assert.strictEqual(p2.trials[1].integrity.pasteEvents.length, 1);
    assert.strictEqual(ctx.qualtrics.page(), 2);
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
    assert.deepStrictEqual(JSON.parse(win.sessionStorage.getItem(SCOPED)).trials.map((t) => t.integritySegment.segmentIndex), [0, 1]);

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
    assert.strictEqual(win.sessionStorage.getItem(SCOPED), null);
    assert.strictEqual(win.sessionStorage.getItem(KEY), null);
  });
});

// sessionStorage is per origin and tab, and every survey on a Qualtrics brand
// domain shares the origin: under the New Survey Taking Experience the saved
// session (and a kept random id) are per survey, so a second survey in the
// tab, under the same participant id, does not continue the first.
describe('Qualtrics host: one saved session per survey', () => {
  it('the survey id comes from the address, a preview address, or the tag', () => {
    const at = (path, attr) => {
      const w = new Window({ url: 'https://brand.qualtrics.com' + path });
      try { return qualtricsSurveyId(w, attr); } finally { w.close(); }
    };
    assert.strictEqual(at('/jfe/form/SV_1AbC2dEf3GhI4jK'), 'SV_1AbC2dEf3GhI4jK');
    assert.strictEqual(at('/jfe/form/SV_1AbC2dEf3GhI4jK?Q_DL=xyz_SV_1AbC2dEf3GhI4jK_MLRP_abc&Q_CHL=gl'), 'SV_1AbC2dEf3GhI4jK');
    assert.strictEqual(at('/jfe/preview/previewId/0a1b2c3d-4e5f-6789/SV_1AbC2dEf3GhI4jK?Q_CHL=preview&Q_SurveyVersionID=current'), 'SV_1AbC2dEf3GhI4jK');
    assert.strictEqual(at('/SE/?SID=SV_1AbC2dEf3GhI4jK'), 'SV_1AbC2dEf3GhI4jK');
    assert.strictEqual(at('/jfe/form/my-study'), null);
    // In the query only SID names the survey; any other parameter may hold an
    // id of another survey (a referrer, a redirect).
    assert.strictEqual(at('/my-study?from=SV_1AbC2dEf3GhI4jK'), null);
    assert.strictEqual(at('/my-study?SID=SV_1AbC2dEf3GhI4jK&from=SV_Other'), 'SV_1AbC2dEf3GhI4jK');
    assert.strictEqual(at('/my-study?from=x&SID=SV_1AbC2dEf3GhI4jK'), 'SV_1AbC2dEf3GhI4jK');
    assert.strictEqual(at('/my-study?XSID=SV_1AbC2dEf3GhI4jK'), null);
    assert.strictEqual(at('/my-study-SV_1AbC2dEf3GhI4jK'), null, 'a path part that only contains an id');
    assert.strictEqual(at('/jfe/form/SV_1AbC2dEf3GhI4jK', 'SV_FromTag9'), 'SV_FromTag9');
    assert.strictEqual(at('/jfe/form/my-study', ' SV_FromTag9 '), 'SV_FromTag9');
    // Piped text Qualtrics did not resolve, or anything else, is not an id.
    assert.strictEqual(at('/jfe/form/SV_1AbC2dEf3GhI4jK', '${e://Field/SurveyID}'), 'SV_1AbC2dEf3GhI4jK');
    assert.strictEqual(at('/jfe/form/my-study', 'study-2'), null);
    assert.strictEqual(qualtricsSurveyId({ get location() { throw new Error('locked'); } }, null), null);
  });

  it('survey B in the same tab, under the same participant id, starts empty', async () => {
    const fakeA = fakeSurveyEngine();
    const ctxA = start(fakeA);
    assert.strictEqual(ctxA.qualtricsSurveyId, 'SV_test');
    paste('survey A');
    fakeA.submit('next');
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));
    assert.ok(win.sessionStorage.getItem(SCOPED), 'survey A is saved under its own key');

    nextPage(ctxA, 30000, 'https://survey.example/jfe/form/SV_other');
    const fakeB = fakeSurveyEngine();
    const ctxB = start(fakeB);
    assert.strictEqual(ctxB.vanilla.blob().trials.length, 0);
    const p = JSON.parse(fakeB.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0]);
    assert.strictEqual(p.trials[0].integrity.pasteEvents.length, 0, 'nothing of survey A');
    assert.strictEqual(p.cyborgHunterOneLiner.pageCount, 1);
    assert.ok(win.sessionStorage.getItem(SCOPED), 'survey A\'s record is left as it was');
  });

  it('without a configured id: a reload of survey A keeps A\'s random id; survey B gets its own and starts empty', async () => {
    const anon = { dataset: { participantId: undefined } };
    const fakeA = fakeSurveyEngine();
    const ctxA = start(fakeA, anon);
    const idA = ctxA.participantId;
    assert.strictEqual(ctxA.participantIdSource, 'random');
    fakeA.submit('next');
    await tick();
    win.dispatchEvent(new win.Event('pagehide'));

    nextPage(ctxA, 30000);
    const ctxA2 = start(fakeSurveyEngine(), anon);
    assert.strictEqual(ctxA2.participantId, idA);
    assert.strictEqual(ctxA2.participantIdSource, 'session');
    assert.strictEqual(ctxA2.vanilla.blob().trials.length, 1, 'the reload continues survey A');
    win.dispatchEvent(new win.Event('pagehide'));

    nextPage(ctxA2, 60000, 'https://survey.example/jfe/form/SV_other');
    const fakeB = fakeSurveyEngine();
    const ctxB = start(fakeB, anon);
    assert.notStrictEqual(ctxB.participantId, idA);
    assert.strictEqual(ctxB.participantIdSource, 'random');
    assert.strictEqual(ctxB.vanilla.blob().trials.length, 0);
    assert.deepStrictEqual(segments(JSON.parse(fakeB.submit('next')[STORED_FIELD])), [0]);
  });

  it('data-qualtrics-survey-id scopes the session in place of the address', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake, { dataset: { qualtricsSurveyId: 'SV_FromTag9' } });
    assert.strictEqual(ctx.qualtricsSurveyId, 'SV_FromTag9');
    win.dispatchEvent(new win.Event('pagehide'));
    assert.ok(win.sessionStorage.getItem(keyFor('SV_FromTag9')));
    assert.strictEqual(win.sessionStorage.getItem(SCOPED), null);
  });

  it('no survey id: the key is unscoped, as before, and the debug summary says so', () => {
    openAt('https://brand.qualtrics.com/jfe/form/my-study');
    const fake = fakeSurveyEngine();
    const ctx = start(fake, { dataset: { debug: '' } });
    assert.strictEqual(ctx.qualtricsSurveyId, null);
    win.dispatchEvent(new win.Event('pagehide'));
    assert.ok(win.sessionStorage.getItem(KEY));
    assert.ok(ctx.debug.summary().includes('no survey id in the address or data-qualtrics-survey-id'), ctx.debug.summary());
  });

  it('the legacy layout keeps the unscoped key', () => {
    const fake = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    const ctx = start(fake);
    assert.strictEqual(ctx.qualtricsSurveyId, null);
    fake.submit('next');
    assert.ok(win.sessionStorage.getItem(KEY));
    assert.strictEqual(win.sessionStorage.getItem(SCOPED), null);
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

  it('the submit after CyborgHunter.data() saves what came between', async () => {
    const fake = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    start(fake);
    win.CyborgHunter.data();
    await tick();                                            // the submit is a task of its own
    paste('after data()');
    fake.submit('next');
    const saved = JSON.parse(win.sessionStorage.getItem(KEY));
    assert.deepStrictEqual(saved.trials.map((t) => t.integritySegment.segmentIndex), [0, 1]);
    assert.strictEqual(saved.trials[1].integrity.pasteEvents.length, 1);
  });
});

// Qualtrics keeps an embedded-data value only when the field is declared in
// Survey Flow, and drops it silently otherwise. The page cannot tell which:
// getJSEmbeddedData reads back the page's own copy of what it set, declared
// or not (live survey, 2026-10-05). So the writer never reads the field back,
// declared() stays null (the badge says unknown) and nothing is logged; the
// stored value (View Response, the export) is the check.
describe('Qualtrics host: is the field declared', () => {
  it('unknown before and after a write to a declared field, with nothing logged', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    assert.strictEqual(ctx.qualtrics.declared(), null);
    fake.submit('next');
    assert.ok(fake.store[STORED_FIELD]);
    assert.strictEqual(ctx.qualtrics.declared(), null);
    assert.deepStrictEqual(errors, []);
  });

  it('unknown for an undeclared field too, though Qualtrics drops its value, with nothing logged', async () => {
    const fake = fakeSurveyEngine({ declared: [] });
    const ctx = start(fake);
    assert.deepStrictEqual(fake.submit('next'), {});
    assert.strictEqual(typeof fake.SE.getJSEmbeddedData(FIELD_NAME), 'string');   // the page's own copy reads back
    await tick();
    fake.rerunHeader(win, null);
    fake.submit('next');
    win.CyborgHunter.data();
    assert.strictEqual(ctx.qualtrics.declared(), null);
    assert.deepStrictEqual(errors, []);
  });

  it('the field is never read back', async () => {
    const fake = fakeSurveyEngine();
    let reads = 0;
    const get = fake.SE.getJSEmbeddedData;
    fake.SE.getJSEmbeddedData = (name) => { reads += 1; return get(name); };
    start(fake);
    win.CyborgHunter.data();
    fake.submit('next');
    await tick();
    fake.rerunHeader(win, null);
    fake.submit('next');
    assert.strictEqual(reads, 0);
  });

  it('a getter that is missing, throws or reads back something else is unknown, and nothing throws', () => {
    const answers = [
      ['missing', undefined],
      ['throws', () => { throw new Error('locked'); }],
      ['other string', () => 'something else'],
      ['empty', () => ''],
      ['a number', () => 42]
    ];
    let ctx = null;
    for (const [label, getter] of answers) {
      if (ctx) nextPage(ctx, 1000);                          // one ch.js per window
      const fake = fakeSurveyEngine();
      if (getter === undefined) delete fake.SE.getJSEmbeddedData; else fake.SE.getJSEmbeddedData = getter;
      ctx = start(fake);
      assert.doesNotThrow(() => fake.submit('next'), label);
      assert.ok(fake.store[STORED_FIELD], label + ': the write is not held back');
      assert.strictEqual(ctx.qualtrics.declared(), null, label);
    }
    assert.deepStrictEqual(errors, []);
  });

  it('a page whose write fails leaves it unknown', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    fake.submit('next');
    await tick();
    fake.rerunHeader(win, null);
    fake.SE.setJSEmbeddedData = () => { throw new Error('nope'); };
    fake.submit('next');
    assert.strictEqual(ctx.qualtrics.declared(), null);
  });

  it('the error marker is written like a payload, and the field stays unknown', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    reinstall(ctx, fake, { builder: () => { throw new Error('boom'); } });
    fake.submit('next');
    assertMarker(fake.store[STORED_FIELD], 'build-failed');
    assert.strictEqual(ctx.qualtrics.declared(), null);
  });

  it('legacy layout: unknown whether cyborg_hunter is declared or not, and only the layout warning is logged', () => {
    const ok = fakeSurveyEngine({ layout: 'legacy', declared: [LEGACY_FIELD] });
    const c1 = start(ok);
    ok.submit('next');
    assert.ok(ok.store[LEGACY_FIELD]);
    assert.strictEqual(ok.store[STORED_FIELD], undefined);
    assert.strictEqual(c1.qualtrics.declared(), null);
    nextPage(c1, 30000);
    const bad = fakeSurveyEngine({ layout: 'legacy', declared: [] });
    const c2 = start(bad);
    bad.submit('next');
    assert.deepStrictEqual(bad.store, {});
    assert.strictEqual(c2.qualtrics.declared(), null);
    assert.deepStrictEqual(errors, []);
    // The one legacy warning is boot's, at detection.
    assert.deepStrictEqual(warns.filter((w) => w.startsWith('[cyborg-hunter] Qualtrics legacy layout')), [MESSAGES.qualtricsLegacyLayout(), MESSAGES.qualtricsLegacyLayout()]);
  });
});

describe('Qualtrics host: the debug badge', () => {
  it('a submit alone updates the badge with the last write', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake, { dataset: { debug: '' } });
    fake.submit('next');
    const text = win.document.getElementById('ch-debug-badge').textContent;
    assert.match(text, new RegExp('^Cyborg Hunter active · Qualtrics detected · page 1 · field __js_cyborg_hunter unknown · .* · last write \\d+/' + MAX_CHARS + ' bytes$'));
    assert.ok(text.endsWith('last write ' + ctx.qualtrics.lastWrite().chars + '/' + MAX_CHARS + ' bytes'), text);
  });

  it('after a re-run: page, field, re-runs and last write, on one badge', () => {
    const fake = fakeSurveyEngine();
    start(fake, { dataset: { debug: '' } });
    fake.submit('next');
    fake.rerunHeader(win, null);
    const text = win.document.getElementById('ch-debug-badge').textContent;
    assert.match(text, new RegExp('Qualtrics detected · page 2 · field __js_cyborg_hunter unknown · .* · header re-run ×1 · last write \\d+/' + MAX_CHARS + ' bytes$'));
    assert.strictEqual(win.document.querySelectorAll('#ch-debug-badge').length, 1);
  });

  it('an undeclared field reads unknown on the badge, like a declared one', () => {
    const fake = fakeSurveyEngine({ declared: [] });
    start(fake, { dataset: { debug: '' } });
    fake.submit('next');
    assert.ok(win.document.getElementById('ch-debug-badge').textContent.includes('field __js_cyborg_hunter unknown'));
  });

  it('a badge that throws cannot reach the submit', () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake, { dataset: { debug: '' } });
    ctx.debug.refresh = () => { throw new Error('badge'); };
    assert.doesNotThrow(() => fake.submit('next'));
    assert.ok(fake.store[STORED_FIELD]);
  });
});

// A page submitted before the header ran again on it: Qualtrics renders the
// next page at once, and the header's script (fetched again) may land late.
// The fake's submit() then runs whatever callbacks are live: a kept one
// (persistCallbacks), or none when Qualtrics drops them after each submit.
describe('Qualtrics host: a submit before the header ran again', () => {
  const note = (p) => String(p.cyborgHunterError || '');

  it('kept callbacks: the old hook writes the page, and the late re-runs add nothing', async () => {
    const fake = fakeSurveyEngine({ persistCallbacks: true });
    const ctx = start(fake, { dataset: { debug: '' } });
    paste('page one');
    fake.submit('next');
    await tick();
    paste('page two');                                       // page 2, its header still loading
    const p2 = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p2), [0, 1]);
    assert.deepStrictEqual(p2.trials.map((t) => t.integrity.pasteEvents.length), [1, 1]);
    await tick();
    fake.rerunHeader(win, null);                             // page 2's header, late
    fake.rerunHeader(win, null);                             // page 3's
    paste('page three');
    const p3 = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p3), [0, 1, 2]);         // no extra row
    assert.deepStrictEqual(p3.trials.map((t) => t.integrity.pasteEvents.length), [1, 1, 1]);
    assert.strictEqual(ctx.qualtrics.missed(), 0);
    assert.strictEqual(note(p3), '');
    assert.ok(!win.document.getElementById('ch-debug-badge').textContent.includes('missed'));
  });

  it('dropped callbacks: the missed page is written at the next re-run, as a row of its own, with a note', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake, { dataset: { debug: '' } });
    paste('page one');
    const p1 = fake.submit('next')[STORED_FIELD];
    await tick();
    paste('page two');                                       // page 2, its header still loading: no hook
    assert.strictEqual(fake.submit('next')[STORED_FIELD], p1, 'Qualtrics posts the stale value');
    await tick();
    fake.rerunHeader(win, null);                             // page 2's header, after page 2 went
    assert.strictEqual(fake.store[STORED_FIELD], p1, 'nothing is known to be missed yet');
    fake.rerunHeader(win, null);                             // page 3's: one page change without a submit
    const caught = JSON.parse(fake.store[STORED_FIELD]);
    assert.deepStrictEqual(segments(caught), [0, 1]);
    assert.deepStrictEqual(caught.trials.map((t) => t.integrity.pasteEvents.length), [1, 1]);
    assert.match(note(caught), /submitted before Cyborg Hunter's page-submit hook was in place/);
    assert.strictEqual(ctx.qualtrics.missed(), 1);
    assert.match(win.document.getElementById('ch-debug-badge').textContent, / · submits missed ×1 · last write /);
    paste('page three');
    const p3 = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p3), [0, 1, 2]);         // one row per page
    assert.deepStrictEqual(p3.trials.map((t) => t.integrity.pasteEvents.length), [1, 1, 1]);
    assert.strictEqual(p3.trials[2].integritySegment.counters.pasteCount, 3);
    await tick();
    fake.rerunHeader(win, null);
    assert.strictEqual(ctx.qualtrics.missed(), 1, 'a page whose submit wrote is not caught up again');
    assert.deepStrictEqual(errors, []);
  });

  it('on time, a stopped submit and a retry: no catch-up, no note', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    fake.submit('next', { blocked: true });
    await tick();
    fake.submit('next');
    await tick();
    fake.rerunHeader(win, null);
    fake.submit('next');
    await tick();
    fake.rerunHeader(win, null);
    const p = JSON.parse(fake.store[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1, 2]);          // the stopped submit's cut, page 1, page 2
    assert.strictEqual(ctx.qualtrics.missed(), 0);
    assert.strictEqual(note(p), '');
  });

  it('write on re-run keeps its own rule: every re-run writes the page before, without a missed note', () => {
    const fake = fakeSurveyEngine({ headerHooks: false });
    const ctx = start(fake);
    reinstall(ctx, fake, { writeOnRerun: true });
    fake.rerunHeader(win, null);
    fake.rerunHeader(win, null);
    const p = JSON.parse(fake.store[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
    assert.strictEqual(ctx.qualtrics.missed(), 0);
    assert.strictEqual(note(p), '');
  });
});

// What the count of re-runs against submit tasks cannot see, and the note.
describe('Qualtrics host: the limits of the missed-submit count', () => {
  const pastes = (p) => p.trials.map((t) => t.integrity.pasteEvents.length);

  it('every header re-run late, callbacks dropped: no page is caught up, two pages share a row, no note', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    paste('page one');
    fake.submit('next');                                     // page 1: the boot's hook
    await tick();
    paste('page two');
    fake.submit('next');                                     // page 2, before its header: no hook
    await tick();
    fake.rerunHeader(win, null);                             // page 2's header lands on page 3
    paste('page three');
    fake.submit('next');                                     // page 3, before its own header: page 2's hook
    await tick();
    fake.rerunHeader(win, null);                             // page 3's header lands on page 4
    const p = JSON.parse(fake.store[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1]);
    assert.deepStrictEqual(pastes(p), [1, 2]);               // nothing lost, but pages 2 and 3 are one row
    assert.strictEqual(ctx.qualtrics.missed(), 0);
    assert.strictEqual(p.cyborgHunterError, undefined);
  });

  it('a stopped submit and its retry, then a page without a hook: the miss is hidden, the pages share a row', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake);
    fake.submit('next', { blocked: true });                  // force response: callbacks ran, no page change
    await tick();
    fake.submit('next');
    await tick();
    fake.rerunHeader(win, null);                             // page 2
    fake.submitHooks.length = 0;                             // its hook is gone before the submit
    paste('page two');
    fake.submit('next');
    await tick();
    fake.rerunHeader(win, null);                             // page 3: two re-runs, three submit tasks
    paste('page three');
    const p = JSON.parse(fake.submit('next')[STORED_FIELD]);
    assert.deepStrictEqual(segments(p), [0, 1, 2]);
    assert.deepStrictEqual(pastes(p), [0, 0, 2]);
    assert.strictEqual(ctx.qualtrics.missed(), 0);
    assert.strictEqual(p.cyborgHunterError, undefined);
  });

  it('the missed-page note is one note with a count, however many pages were missed', async () => {
    const fake = fakeSurveyEngine();
    const ctx = start(fake, { dataset: { debug: '' } });
    for (let i = 0; i < 3; i++) {                            // three pages submitted with no hook
      fake.submitHooks.length = 0;
      fake.submit('next');
      await tick();
      fake.rerunHeader(win, null);
    }
    const p = JSON.parse(fake.store[STORED_FIELD]);
    assert.strictEqual(ctx.qualtrics.missed(), 3);
    const notes = String(p.cyborgHunterError).split('; ');
    assert.strictEqual(notes.filter((n) => /page-submit hook was in place/.test(n)).length, 1);
    assert.match(p.cyborgHunterError, /\(×3\)$/);
    ctx.vanilla.noteError('a later note');
    assert.match(ctx.vanilla.blob().cyborgHunterError, /\(×3\); a later note$/);
    assert.match(win.document.getElementById('ch-debug-badge').textContent, / · submits missed ×3 · /);
  });
});
