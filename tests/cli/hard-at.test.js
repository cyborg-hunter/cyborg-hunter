// tests/cli/hard-at.test.js
// hardAt (config): the report's own rule for the hard tier, validated like
// scoreWeights; and the two functions the report page inlines to re-score
// and re-tier (score-weights.js scoreFromCounts, reportTierFromCounts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { SCORE_SIGNALS, resolveHardAt, resolveScoreWeights, scoreFromCounts, reportTierFromCounts } from '../../src/cli/analyzers/score-weights.js';
import { decomposeScore } from '../../src/cli/analyzers/triage.js';
import { mergeConfig } from '../../src/cli/config-core.js';
import { DEFAULT_CLI_CONFIG } from '../../src/shared/schema.js';
import { inlineSrcHazards } from '../../src/shared/inline-safe.js';

describe('resolveHardAt', () => {
  it('keeps whole numbers ≥ 1 for known signals; absent, or null for a key, is no rule', () => {
    assert.deepEqual(resolveHardAt({ paste: 2, sidebar: 1, copy: null }), { hardAt: { paste: 2, sidebar: 1 }, warnings: [] });
    assert.deepEqual(resolveHardAt(undefined), { hardAt: {}, warnings: [] });
    assert.deepEqual(resolveHardAt(null), { hardAt: {}, warnings: [] });
  });

  it('an unknown key warns with the closest name and is ignored', () => {
    const r = resolveHardAt({ sidebr: 1 });
    assert.deepEqual(r.hardAt, {});
    assert.match(r.warnings[0], /hardAt: unknown signal "sidebr" \(did you mean "sidebar"\?\)/);
  });

  it('a value that is not a whole number ≥ 1 warns and is ignored', () => {
    for (const v of [0, -1, 1.5, '2', true, {}]) {
      const r = resolveHardAt({ paste: v });
      assert.deepEqual(r.hardAt, {}, JSON.stringify(v));
      assert.match(r.warnings[0], /hardAt\.paste must be a whole number ≥ 1/);
    }
  });

  it('anything but an object warns once and applies no rule', () => {
    for (const v of [3, 'paste', [1]]) {
      const r = resolveHardAt(v);
      assert.deepEqual(r.hardAt, {});
      assert.equal(r.warnings.length, 1);
      assert.match(r.warnings[0], /hardAt must be an object/);
    }
  });

  it('a key named like an object property is an unknown signal, never the prototype', () => {
    const r = resolveHardAt(JSON.parse('{"__proto__": 1, "constructor": 2}'));
    assert.deepEqual(Object.keys(r.hardAt), []);
    assert.equal(r.warnings.length, 2);
  });
});

describe('hardAt in the config', () => {
  it('is a known key, null by default, and its warnings reach the config warnings', () => {
    assert.equal(DEFAULT_CLI_CONFIG.hardAt, null);
    const { warnings } = mergeConfig({ hardAt: { sidebr: 1, paste: 0 } });
    assert.ok(!warnings.some((w) => /Unknown config key "hardAt"/.test(w)));
    assert.ok(warnings.some((w) => /did you mean "sidebar"/.test(w)));
    assert.ok(warnings.some((w) => /hardAt\.paste must be a whole number/.test(w)));
  });
});

describe('the functions the report page inlines', () => {
  const summary = { totalPasteEvents: 3, totalCopyEvents: 2, sidebarEventCount: 1, tabAwayLongCount: 2, tabAwayMediumCount: 1, totalSyntheticInsertions: 40 };
  const counts = SCORE_SIGNALS.map((sig) => sig.count(summary, 4));

  it('scoreFromCounts sums what decomposeScore sums, caps and zero weights included', () => {
    for (const user of [null, { synthetic: 0.1 }, { copy: { weight: 5, max: 1 }, edgeExits: 2 }, { paste: 0, copy: 0, sidebar: 0, tabaway: 0 }]) {
      const { weights } = resolveScoreWeights(user);
      const want = decomposeScore(summary, 4, false, weights).reduce((a, [, n]) => a + n, 0);
      assert.equal(scoreFromCounts(counts, SCORE_SIGNALS.map((s) => weights[s.key])), want, JSON.stringify(user));
    }
  });

  it('reportTierFromCounts: the library\'s hard stays; a count at or over its hardAt makes hard*; else the library\'s tier', () => {
    const at = (map) => SCORE_SIGNALS.map((s) => map[s.key] ?? null);
    assert.equal(reportTierFromCounts('hard', counts, at({})), 'hard');
    assert.equal(reportTierFromCounts('hard', counts, at({ paste: 1 })), 'hard');
    assert.equal(reportTierFromCounts('soft', counts, at({ sidebar: 1 })), 'hard*');
    assert.equal(reportTierFromCounts('clean', counts, at({ paste: 3 })), 'hard*');
    assert.equal(reportTierFromCounts('clean', counts, at({ paste: 4 })), 'clean');
    assert.equal(reportTierFromCounts('soft', counts, at({})), 'soft');
  });

  it('both run from their source text alone and hold no inline hazard', () => {
    const src = [scoreFromCounts, reportTierFromCounts].map(String).join('\n');
    assert.deepEqual(inlineSrcHazards(src), []);
    const copy = runInNewContext(src + '\n;({ scoreFromCounts, reportTierFromCounts })');
    assert.equal(copy.scoreFromCounts([2, 3], [{ weight: 5, max: null }, { weight: 1, max: 2 }]), 12);
    assert.equal(copy.reportTierFromCounts('soft', [0, 2], [null, 2]), 'hard*');
  });
});
