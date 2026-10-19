// tests/core/typing-speed.test.js
// The typing-rate rule: (N − 1) edits per second between a trial's first
// edit and its last, judged from thresholds.typingMinEdits edits (20 by
// default). N over the span counted one edit too many (two keys 0.17 s apart
// read 11.8 cps), and short fields fired the 10 cps flag on people.
// Calibrated on recorded human sessions: no trial of 20 or more edits went
// above 9.5 cps by (N − 1) over the span.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { typingRate } from '../../src/shared/typing-metrics.js';
import { computeTypingSpeed } from '../../src/core/signals/typing.js';
import { DEFAULT_THRESHOLDS, PRESETS } from '../../src/shared/constants.js';

const at = (n, stepMs, t0 = 1000) => Array.from({ length: n }, (_, i) => t0 + i * stepMs);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('typingRate and computeTypingSpeed', () => {
  it('is (N − 1) edits per second over the span, rounded to 0.1', () => {
    assert.equal(typingRate(at(21, 100), 20), 10);     // 20 gaps over 2 s
    assert.equal(typingRate(at(20, 50), 20), 20);      // 19 gaps over 0.95 s
    assert.equal(typingRate([0, 100, 250], 2), 8);     // 2 gaps over 0.25 s
    assert.equal(computeTypingSpeed(at(21, 100), 20), 10);
  });
  it('is null below minEdits, and for a span of zero', () => {
    assert.equal(computeTypingSpeed(at(19, 10), 20), null);
    assert.equal(computeTypingSpeed(at(25, 0), 20), null);
    assert.equal(computeTypingSpeed([], 20), null);
  });
  it('two keys 0.17 s apart (an age typed into a short field) are not judged at the default', () => {
    assert.equal(computeTypingSpeed([1000, 1170], DEFAULT_THRESHOLDS.typingMinEdits), null);
  });
  it('without minEdits the formula needs 2 edits', () => {
    assert.equal(computeTypingSpeed([1000, 1500]), 2);
    assert.equal(computeTypingSpeed([1000]), null);
  });
  it('typingMinEdits defaults to 20; the cps thresholds are unchanged', () => {
    assert.equal(DEFAULT_THRESHOLDS.typingMinEdits, 20);
    assert.equal(DEFAULT_THRESHOLDS.typingSpeedCps, 10);
    assert.equal(PRESETS.permissive.thresholds.typingSpeedCps, 15);
    assert.equal(PRESETS.strict.thresholds.typingSpeedCps, 8);
  });
});

// The monitor needs a DOM: each describe below sets one up per test.
let win, init;
async function setUp() {
  win = new Window();
  Object.assign(global, { window: win, document: win.document, Node: win.Node, MutationObserver: win.MutationObserver,
    ResizeObserver: class { observe() {} disconnect() {} } });
  ({ init } = await import('../../src/core/monitor.js'));
}
function tearDown() {
  win.close();
  for (const k of ['window', 'document', 'Node', 'MutationObserver', 'ResizeObserver']) delete global[k];
}

// n input events into one textarea, 2 ms apart (real time: the monitor
// reads performance.now()).
async function trialWithEdits(n, config = {}) {
  const m = init({ participantId: 'R1', ...config });
  m.startSession();
  m.startTrial({ trialId: 'q1' });
  const box = document.createElement('textarea');
  document.body.appendChild(box);
  for (let i = 0; i < n; i++) { box.dispatchEvent(new win.Event('input', { bubbles: true })); await sleep(2); }
  const report = m.endTrial();
  m.destroy();
  return report;
}

describe('endTrial: the rate and the edit count', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it('19 edits: the count is kept, no rate, no typing-speed score', async () => {
    const r = await trialWithEdits(19);
    assert.equal(r.typingEdits, 19);
    assert.equal(r.charsPerSec, undefined);
    assert.equal(r.trialSignals.soft.typingSpeed, undefined);
    assert.deepEqual(r.editTimestamps, []);   // the keystroke privacy gate still holds
  });
  it('20 edits: a rate', async () => {
    const r = await trialWithEdits(20);
    assert.equal(r.typingEdits, 20);
    assert.equal(typeof r.charsPerSec, 'number');
  });
  it('thresholds.typingMinEdits moves the floor', async () => {
    const r = await trialWithEdits(5, { thresholds: { typingMinEdits: 5 } });
    assert.equal(typeof r.charsPerSec, 'number');
  });
  it('a trial with no typing counts 0 edits', async () => {
    assert.equal((await trialWithEdits(0)).typingEdits, 0);
  });
});

// A typingMinEdits that is not a whole number of 2 or more would otherwise
// reach the formula's own floor of 2 edits and judge every short field again.
describe('init: a bad thresholds.typingMinEdits falls back to 20 with one warning', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  function initWarnings(config) {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try { init({ participantId: 'R1', ...config }).destroy(); } finally { console.warn = orig; }
    return warnings;
  }

  // Each bad value, as the warning names it.
  for (const [bad, named] of [['20', '"20"'], [0, '0'], [1.5, '1.5'], [NaN, 'NaN']]) {
    it(named + ': one warning naming the value, and the 20-edit floor', async () => {
      assert.deepEqual(initWarnings({ thresholds: { typingMinEdits: bad } }), [
        '[cyborg-hunter] thresholds.typingMinEdits must be a whole number of 2 or more; got ' + named + ', so it is 20'
      ]);
      const quiet = console.warn;
      console.warn = () => {};
      try {
        assert.equal((await trialWithEdits(19, { thresholds: { typingMinEdits: bad } })).charsPerSec, undefined);
        assert.equal(typeof (await trialWithEdits(20, { thresholds: { typingMinEdits: bad } })).charsPerSec, 'number');
      } finally { console.warn = quiet; }
    });
  }
  it('a whole number of 2 or more is kept, with no warning', () => {
    assert.deepEqual(initWarnings({ thresholds: { typingMinEdits: 2 } }), []);
  });
});
