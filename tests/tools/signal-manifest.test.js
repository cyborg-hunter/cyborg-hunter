// tests/tools/signal-manifest.test.js
// Pins the demo's generated signal-manifest numbers to the library's real
// PRESETS.standard values — steps.js copy quotes these numbers by hand, so
// a preset change here must break this test before it can silently drift
// from what the library actually enforces.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildManifest } from '../../tools/gen-signal-manifest.mjs';
import { PRESETS, DEFAULT_THRESHOLDS } from '../../src/shared/constants.js';

describe('buildManifest', () => {
  const m = buildManifest();

  it('defaults to the standard preset', () => {
    assert.strictEqual(m.preset, 'standard');
  });

  it('carries the real paste hard-screenout threshold', () => {
    assert.strictEqual(
      m.signals.paste.hardCountThreshold,
      PRESETS.standard.scoring.hard.paste.countThreshold
    );
  });

  it('carries the real soft-score screenout threshold', () => {
    assert.strictEqual(
      m.signals.softScoreThreshold,
      PRESETS.standard.scoring.softScoreThreshold
    );
  });

  it('carries the real tab-away duration cutoff', () => {
    // standard's thresholds override is {} — the effective value falls back
    // to DEFAULT_THRESHOLDS, same merge order as src/core/monitor.js.
    const effective = { ...DEFAULT_THRESHOLDS, ...PRESETS.standard.thresholds };
    assert.strictEqual(m.signals.tabAway.durationMs, effective.tabAwayDurationMs);
  });

  it('gives preset thresholds precedence over defaults (order-sensitive case)', () => {
    // standard's thresholds override is {}, so both merge orders coincide
    // there — strict overrides both values, catching a swapped spread order.
    const strict = buildManifest('strict');
    const effective = { ...DEFAULT_THRESHOLDS, ...PRESETS.strict.thresholds };
    assert.strictEqual(strict.signals.tabAway.durationMs, effective.tabAwayDurationMs); // 5000, not 3000
    assert.strictEqual(strict.signals.typingSpeed.cps, effective.typingSpeedCps);       // 8, not 10
  });
});

// Presets block: the standard preset's soft-scoring map, the one value the
// page reads from it (step 9's snippet reads presets.standard.scoring.soft),
// checked here against constants.js so the demo's weights can never drift
// from the library's real preset (there is no hand-mirrored table in demo JS).
describe('buildManifest presets block (the demo\'s scoring source)', () => {
  const m = buildManifest();

  it('carries the standard preset alone, regardless of the top-level preset', () => {
    assert.deepStrictEqual(Object.keys(m.presets), ['standard']);
    assert.deepStrictEqual(Object.keys(buildManifest('strict').presets), ['standard']);
  });

  it('carries only the standard soft-scoring map, verbatim from constants.js', () => {
    assert.deepStrictEqual(m.presets.standard, { scoring: { soft: PRESETS.standard.scoring.soft } });
  });
});
