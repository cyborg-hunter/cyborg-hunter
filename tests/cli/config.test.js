import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateConfig } from '../../src/shared/validation.js';
import { cliConfigWarnings } from '../../src/cli/config.js';

describe('config validation', () => {
  it('passes with valid keys', () => {
    const warnings = validateConfig({ dataDir: './data', filePattern: '*.json' });
    assert.equal(warnings.length, 0);
  });

  it('suggests correction for misspelled key', () => {
    const warnings = validateConfig({ datDir: './data' });
    assert.ok(warnings[0].includes('did you mean'));
  });

  it('flags completely unknown keys', () => {
    const warnings = validateConfig({ completelyFakeKey: true });
    assert.ok(warnings[0].includes('Unknown'));
  });

  it('scoreWeights is a known config key', () => {
    assert.deepEqual(validateConfig({ scoreWeights: { synthetic: 1 } }), []);
  });
});

describe('cliConfigWarnings: scoreWeights and browser-only scoring keys', () => {
  it('passes scoreWeights warnings through, once each', () => {
    const warnings = cliConfigWarnings({ scoreWeights: { synthetc: 1 } });
    assert.equal(warnings.filter(w => /did you mean "synthetic"/.test(w)).length, 1);
  });

  it('warns that browser-style scoring.soft / scoring.hard are not read by the CLI', () => {
    for (const scoring of [{ soft: { syntheticInsertion: { weight: 1 } } }, { hard: { paste: { countThreshold: 2 } } }]) {
      const warnings = cliConfigWarnings({ scoring });
      assert.equal(warnings.length, 1, JSON.stringify(scoring));
      assert.match(warnings[0], /scoreWeights/);
    }
  });

  it('pin: the silent cases stay silent', () => {
    for (const config of [{}, { scoring: null }, { scoring: { softScoreThreshold: 6 } }, { scoreWeights: null }, { scoreWeights: { synthetic: 1 } }]) {
      assert.deepEqual(cliConfigWarnings(config), [], JSON.stringify(config));
    }
  });
});
