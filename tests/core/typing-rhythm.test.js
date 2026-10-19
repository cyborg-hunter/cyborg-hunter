// tests/core/typing-rhythm.test.js
// Per-field typing rhythm in the library (signals.typingRhythm): the gaps
// between one-character typed insertions, per trial and per text field,
// saved as four numbers and the field's tag once a field has 20 gaps. The
// characters, the gaps themselves and the element's id never leave the
// browser.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { summarizeGaps, RHYTHM_MIN_GAPS, RHYTHM_FAST_GAP_MS } from '../../src/shared/typing-metrics.js';
import { createTypingRhythm, addRhythmInput, summarizeTypingRhythm, attachTypingSignals } from '../../src/core/signals/typing.js';
import { PRESETS } from '../../src/shared/constants.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
// A stand-in element. It carries an id so the tests show the id is ignored.
const field = (tagName = 'TEXTAREA', id = '') => ({ tagName, id });
// `text` typed into `el`, one insertText per character, `step` ms apart.
function type(acc, el, text, step = 150, t0 = 1000) {
  for (let i = 0; i < text.length; i++) addRhythmInput(acc, el, 'insertText', text[i], t0 + i * step);
}

describe('summarizeGaps', () => {
  it('the count, the median, the share under 60 ms and the variation (sample SD over mean)', () => {
    const g = [...Array(10).fill(50), ...Array(10).fill(100)];
    assert.deepEqual(summarizeGaps(g), { gaps: 20, medianMs: 75, under60Share: 0.5, cv: 0.342 });
    assert.deepEqual(summarizeGaps([40, 40, 40]), { gaps: 3, medianMs: 40, under60Share: 1, cv: 0 });
    assert.deepEqual(summarizeGaps([0, 0, 0]), { gaps: 3, medianMs: 0, under60Share: 1, cv: 0 });   // a mean of 0: cv 0, not NaN
    assert.equal(RHYTHM_MIN_GAPS, 20);
    assert.equal(RHYTHM_FAST_GAP_MS, 60);
  });
});

describe('the rhythm accumulator', () => {
  it('counts one-character insertText only: pastes, IME commits, replacements, deletions and longer data are left out', () => {
    const acc = createTypingRhythm(); const el = field();
    addRhythmInput(acc, el, 'insertText', 'a', 0);
    addRhythmInput(acc, el, 'insertFromPaste', 'b', 10);
    addRhythmInput(acc, el, 'insertCompositionText', 'c', 20);
    addRhythmInput(acc, el, 'insertReplacementText', 'd', 30);
    addRhythmInput(acc, el, 'deleteContentBackward', null, 40);
    addRhythmInput(acc, el, 'insertText', 'ef', 50);
    addRhythmInput(acc, el, 'insertText', '😀', 60);   // two code units
    addRhythmInput(acc, el, 'insertText', 'g', 200);
    assert.deepEqual(acc.fields[0].gaps, [200]);       // a → g; everything between is skipped
  });
  it('drops a gap between two equal characters; the run goes on from the second', () => {
    const acc = createTypingRhythm();
    type(acc, field(), 'aab', 100);
    assert.deepEqual(acc.fields[0].gaps, [100]);       // a → a dropped, a → b kept
  });
  it('keeps fields apart, by element', () => {
    const acc = createTypingRhythm(); const a = field('TEXTAREA', 'a'), b = field('INPUT', 'b');
    for (let i = 0; i < 10; i++) {
      addRhythmInput(acc, a, 'insertText', ALPHABET[i], i * 200);
      addRhythmInput(acc, b, 'insertText', ALPHABET[i], i * 200 + 50);
    }
    assert.deepEqual(acc.fields.map((f) => [f.tag, f.gaps.length]), [['textarea', 9], ['input', 9]]);
    assert.deepEqual(acc.fields[0].gaps, Array(9).fill(200));
  });
  it('a field under 20 gaps leaves nothing; 20 gaps leave one summary of numbers and a tag', () => {
    const acc = createTypingRhythm();
    type(acc, field('TEXTAREA', 'short'), ALPHABET.slice(0, 20), 150);            // 19 gaps
    type(acc, field('TEXTAREA', 'x'.repeat(80)), ALPHABET.slice(0, 21), 150);     // 20 gaps
    const out = summarizeTypingRhythm(acc);
    assert.deepEqual(out, [{ field: { tag: 'textarea' }, gaps: 20, medianMs: 150, under60Share: 0, cv: 0 }]);
  });
  it('the field is named by its tag alone: the element\'s id is never read', () => {
    const acc = createTypingRhythm();
    const el = { tagName: 'INPUT', get id() { throw new Error('the id was read'); } };
    type(acc, el, ALPHABET.slice(0, 21), 100);
    assert.deepEqual(summarizeTypingRhythm(acc)[0].field, { tag: 'input' });
  });
});

describe('the listener', () => {
  beforeEach(() => { globalThis.document = {}; });
  afterEach(() => { delete globalThis.document; });
  const ctxWith = (on) => {
    const handlers = {};
    return {
      handlers, typingRhythm: createTypingRhythm(),
      config: { signals: { typingRhythm: on, clipboardManager: false, typingSpeed: false }, thresholds: {} },
      trialData: { editTimestamps: [], syntheticInsertions: [] },
      addTrialListener: (target, event, handler) => { (handlers[event] = handlers[event] || []).push(handler); },
      fireSignal: () => {},
    };
  };
  it('feeds characters typed into text fields to the trial\'s accumulator', () => {
    const ctx = ctxWith(true);
    attachTypingSignals(ctx);
    assert.equal(ctx.handlers.input.length, 1);
    ctx.handlers.input[0]({ target: { tagName: 'TEXTAREA', id: 'q' }, inputType: 'insertText', data: 'a' });
    ctx.handlers.input[0]({ target: { tagName: 'BUTTON', id: 'b' }, inputType: 'insertText', data: 'b' });
    assert.deepEqual(ctx.typingRhythm.fields.map((f) => f.tag), ['textarea']);
  });
  it('switched off: no listener', () => {
    const ctx = ctxWith(false);
    attachTypingSignals(ctx);
    assert.equal(ctx.handlers.input, undefined);
  });
  it('every preset switches it on', () => {
    for (const p of Object.values(PRESETS)) assert.equal(p.signals.typingRhythm, true);
  });
});

describe('endTrial saves the summaries, never the gaps', () => {
  let win, init;
  beforeEach(async () => {
    win = new Window();
    Object.assign(global, { window: win, document: win.document, Node: win.Node, MutationObserver: win.MutationObserver,
      ResizeObserver: class { observe() {} disconnect() {} } });
    ({ init } = await import('../../src/core/monitor.js'));
  });
  afterEach(() => {
    win.close();
    for (const k of ['window', 'document', 'Node', 'MutationObserver', 'ResizeObserver']) delete global[k];
  });
  // One input event per character, as a browser fires them for typing.
  function typeInto(el, text) {
    for (const ch of text) {
      const e = new win.Event('input', { bubbles: true });
      Object.defineProperty(e, 'inputType', { value: 'insertText' });
      Object.defineProperty(e, 'data', { value: ch });
      el.dispatchEvent(e);
    }
  }
  function run(config, text) {
    const m = init({ participantId: 'R2', ...config });
    m.startSession();
    m.startTrial({ trialId: 'q1' });
    const box = document.createElement('textarea');
    box.id = 'answer';
    document.body.appendChild(box);
    typeInto(box, text);
    const snapshot = m.getTrialSnapshot();
    const report = m.endTrial();
    const session = m.getSessionReport();
    m.destroy();
    return { report, snapshot, session };
  }
  it('a field typed with 25 distinct keys: one summary, and nothing of the accumulator anywhere', () => {
    const { report, snapshot, session } = run({}, ALPHABET.slice(0, 25));
    assert.equal(report.typingRhythm.length, 1);
    assert.deepEqual(report.typingRhythm[0].field, { tag: 'textarea' });
    assert.equal(report.typingRhythm[0].gaps, 24);
    for (const v of [snapshot, report, session]) assert.ok(!/"lastChar"|"lastT"|"el"|"answer"/.test(JSON.stringify(v)));
    assert.equal(report.typingEdits, 25);
    assert.deepEqual(report.editTimestamps, []);
  });
  it('nothing long enough: an empty list', () => {
    assert.deepEqual(run({}, 'abc').report.typingRhythm, []);
  });
  it('switched off: no key', () => {
    assert.ok(!('typingRhythm' in run({ signals: { typingRhythm: false } }, ALPHABET).report));
  });
  it('a value other than true turns it off, with a warning', () => {
    const warn = console.warn; const seen = [];
    console.warn = (w) => seen.push(String(w));
    try {
      assert.ok(!('typingRhythm' in run({ signals: { typingRhythm: 'false' } }, ALPHABET).report));
    } finally { console.warn = warn; }
    assert.ok(seen.some((w) => w.includes('signals.typingRhythm must be true or false')));
  });
});
