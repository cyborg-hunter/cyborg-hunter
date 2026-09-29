// tests/cli/score-weights.test.js
// The report-score weight table and its resolver (config.scoreWeights), plus
// the one score formatter every display site uses.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SCORE_SIGNALS, DEFAULT_SCORE_WEIGHTS, resolveScoreWeights, formatScore, formulaText, customWeightsText,
} from '../../src/cli/analyzers/score-weights.js';

const weightOf = (res, key) => res.weights[key].weight;

describe('score-weights: defaults', () => {
  it('absent or null scoreWeights resolve to the 0.8.0 defaults, silently', () => {
    for (const input of [undefined, null]) {
      const res = resolveScoreWeights(input);
      assert.equal(res.isDefault, true);
      assert.deepEqual(res.warnings, []);
      assert.equal(weightOf(res, 'paste'), 5);
      assert.equal(weightOf(res, 'copy'), 5);
      assert.equal(weightOf(res, 'sidebar'), 3);
      assert.equal(weightOf(res, 'tabaway'), 1);
    }
  });

  it('every other signal defaults to 0, and the first four keep 0.8.0 order', () => {
    assert.deepEqual(SCORE_SIGNALS.slice(0, 4).map(s => s.key), ['paste', 'copy', 'sidebar', 'tabaway']);
    for (const s of SCORE_SIGNALS.slice(4)) assert.equal(DEFAULT_SCORE_WEIGHTS[s.key], 0, s.key);
    assert.deepEqual(SCORE_SIGNALS.map(s => s.key), [
      'paste', 'copy', 'sidebar', 'tabaway', 'tabawayLong', 'tabawayMedium', 'flicker',
      'drop', 'fastTyping', 'synthetic', 'foreignInput', 'aiExtensions', 'kbShortcuts',
      'viewportShifts', 'zoom', 'edgeExits',
    ]);
  });
});

describe('score-weights: user values', () => {
  it('merges per key: {synthetic: 1} keeps the four defaults', () => {
    const res = resolveScoreWeights({ synthetic: 1 });
    assert.equal(res.isDefault, false);
    assert.deepEqual(res.warnings, []);
    assert.equal(weightOf(res, 'synthetic'), 1);
    assert.equal(weightOf(res, 'paste'), 5);
    assert.equal(weightOf(res, 'tabaway'), 1);
  });

  it('accepts the object form with a cap, including a cap of 0', () => {
    assert.deepEqual(resolveScoreWeights({ synthetic: { weight: 1, max: 5 } }).weights.synthetic, { weight: 1, max: 5 });
    const zero = resolveScoreWeights({ synthetic: { weight: 1, max: 0 } });
    assert.deepEqual(zero.weights.synthetic, { weight: 1, max: 0 });
    assert.deepEqual(zero.warnings, []);
  });

  it('a default term can be zeroed', () => {
    const res = resolveScoreWeights({ paste: 0 });
    assert.equal(weightOf(res, 'paste'), 0);
    assert.equal(res.isDefault, false);
  });

  it('setting a key to its default value still counts as default', () => {
    assert.equal(resolveScoreWeights({ paste: 5 }).isDefault, true);
  });

  it('rejects non-finite, negative and non-numeric weights: one warning, key keeps its default', () => {
    for (const bad of [-1, 'one', NaN, Infinity, -Infinity, null, true, [], {}]) {
      const res = resolveScoreWeights({ synthetic: bad });
      assert.equal(res.warnings.length, 1, `input ${String(bad)}: ${res.warnings}`);
      assert.match(res.warnings[0], /synthetic/);
      assert.equal(weightOf(res, 'synthetic'), 0, `input ${String(bad)}`);
    }
    const paste = resolveScoreWeights({ paste: -2 });
    assert.equal(weightOf(paste, 'paste'), 5);
  });

  it('a bad cap is dropped with a warning; the weight is kept', () => {
    for (const max of [2.5, -1, 'three']) {
      const res = resolveScoreWeights({ synthetic: { weight: 1, max } });
      assert.equal(res.warnings.length, 1, `max ${max}`);
      assert.match(res.warnings[0], /max/);
      assert.deepEqual(res.weights.synthetic, { weight: 1, max: null });
    }
  });

  it('a cap without a weight warns and applies the cap to the default weight', () => {
    const res = resolveScoreWeights({ copy: { max: 2 } });
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /copy/);
    assert.deepEqual(res.weights.copy, { weight: 5, max: 2 });
  });
});

describe('score-weights: review fixes', () => {
  it('the "weights" object of score-weights.json round-trips as scoreWeights, silently', () => {
    const res = resolveScoreWeights(resolveScoreWeights(null).weights);
    assert.deepEqual(res.warnings, []);
    assert.equal(res.isDefault, true);
    const custom = resolveScoreWeights({ synthetic: 2, copy: { weight: 5, max: 3 } }).weights;
    const again = resolveScoreWeights(JSON.parse(JSON.stringify(custom)));
    assert.deepEqual(again.warnings, []);
    assert.deepEqual(again.weights, custom);
  });

  it('max: null means no cap and does not warn', () => {
    assert.deepEqual(resolveScoreWeights({ copy: { weight: 5, max: null } }).warnings, []);
    assert.deepEqual(resolveScoreWeights({ copy: { max: null } }).warnings, []);
  });

  it('devTools is recognised whatever its case', () => {
    const res = resolveScoreWeights({ devtools: 1 });
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /kbShortcuts/);
  });

  it('unknown fields inside the object form warn (a typo like "cap" must not silently do nothing)', () => {
    const res = resolveScoreWeights({ synthetic: { weight: 1, cap: 3 } });
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /cap/);
    assert.deepEqual(res.weights.synthetic, { weight: 1, max: null });
  });

  it('a cap on a zero-weight signal changes nothing, so it is still default', () => {
    const res = resolveScoreWeights({ synthetic: { weight: 0, max: 3 } });
    assert.equal(res.isDefault, true);
    assert.equal(customWeightsText(res.weights), '');
  });

  it('formulaText includes caps', () => {
    const { weights } = resolveScoreWeights({ paste: 0, copy: 0, sidebar: 0, tabaway: 0, synthetic: { weight: 0.5, max: 2 } });
    assert.equal(formulaText(weights), '0.5×synthetic (max 2)');
  });
});

describe('score-weights: key checks', () => {
  it('an unknown key warns with a did-you-mean and is ignored', () => {
    const res = resolveScoreWeights({ synthetc: 1 });
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /synthetc/);
    assert.match(res.warnings[0], /did you mean "synthetic"/);
    assert.equal(weightOf(res, 'synthetic'), 0);
    assert.equal(res.isDefault, true);
  });

  it('keys are case-sensitive: "Synthetic" gets a suggestion, not acceptance', () => {
    const res = resolveScoreWeights({ Synthetic: 1 });
    assert.match(res.warnings[0], /did you mean "synthetic"/);
    assert.equal(weightOf(res, 'synthetic'), 0);
  });

  it('devTools gets its own warning pointing to kbShortcuts, not a did-you-mean', () => {
    const res = resolveScoreWeights({ devTools: 1 });
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /kbShortcuts/);
    assert.doesNotMatch(res.warnings[0], /did you mean/);
  });

  it('warns about double counting when tabaway and a split tab-away key are both weighted', () => {
    assert.ok(resolveScoreWeights({ tabawayLong: 1 }).warnings.some(w => /double/.test(w)));
    assert.deepEqual(resolveScoreWeights({ tabaway: 0, tabawayLong: 1 }).warnings, []);
  });

  it('a non-object scoreWeights warns and falls back to the defaults', () => {
    for (const bad of [5, 'synthetic', [1, 2], true]) {
      const res = resolveScoreWeights(bad);
      assert.equal(res.warnings.length, 1, String(bad));
      assert.equal(res.isDefault, true);
    }
  });

  it('warns when every weight resolves to 0', () => {
    const res = resolveScoreWeights({ paste: 0, copy: 0, sidebar: 0, tabaway: 0 });
    assert.ok(res.warnings.some(w => /every report score will be 0/.test(w)));
  });
});

describe('score-weights: counts', () => {
  const count = (key, summary, edge = 0) => SCORE_SIGNALS.find(s => s.key === key).count(summary, edge);

  it('sidebar keeps the 0.8.0 fallback for data without an event count', () => {
    assert.equal(count('sidebar', { sidebarEventCount: 4 }), 4);
    assert.equal(count('sidebar', { sidebarDetected: true }), 1);
    assert.equal(count('sidebar', {}), 0);
  });

  it('tabaway is long + medium; the split keys and flicker count their own bins', () => {
    const s = { tabAwayLongCount: 2, tabAwayMediumCount: 3, tabAwayFlickerCount: 7 };
    assert.equal(count('tabaway', s), 5);
    assert.equal(count('tabawayLong', s), 2);
    assert.equal(count('tabawayMedium', s), 3);
    assert.equal(count('flicker', s), 7);
  });

  it('aiExtensions counts the list; edgeExits comes from the triage row, not the summary', () => {
    assert.equal(count('aiExtensions', { aiExtensionsFound: [{ name: 'a' }, { name: 'b' }] }), 2);
    assert.equal(count('aiExtensions', { extensionsDetected: ['x'] }), 1);
    assert.equal(count('edgeExits', { edgeExitCount: 99 }, 3), 3);
  });

  it('every count is 0 on an empty summary', () => {
    for (const s of SCORE_SIGNALS) assert.equal(s.count({}, 0), 0, s.key);
  });

  it('simple counts read their summary field', () => {
    assert.equal(count('synthetic', { totalSyntheticInsertions: 3 }), 3);
    assert.equal(count('foreignInput', { totalForeignInputEvents: 2 }), 2);
    assert.equal(count('drop', { totalDropEvents: 1 }), 1);
    assert.equal(count('fastTyping', { trialsWithFastTyping: 4 }), 4);
    assert.equal(count('kbShortcuts', { keyboardShortcutCount: 5 }), 5);
    assert.equal(count('viewportShifts', { layoutShiftCount: 6 }), 6);
    assert.equal(count('zoom', { zoomChangeCount: 7 }), 7);
  });
});

describe('formatScore', () => {
  it('returns integers unchanged, keeping the type', () => {
    assert.strictEqual(formatScore(18), 18);
    assert.strictEqual(formatScore(0), 0);
  });
  it('formats fractional scores to one decimal', () => {
    assert.strictEqual(formatScore(1.5), '1.5');
    assert.strictEqual(formatScore(0.1 * 3), '0.3');
  });
  it('passes non-numbers through', () => {
    assert.strictEqual(formatScore(undefined), undefined);
    assert.strictEqual(formatScore('?'), '?');
  });
});
