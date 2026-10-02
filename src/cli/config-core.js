// src/cli/config-core.js — the pure half of config loading: defaults ← file
// config, key validation and the value checks, with no fs or process access,
// so the browser page merges a dropped cyborg-hunter.config.json exactly as
// the CLI does. config.js adds the file read, CLI flags and path resolution.
import { DEFAULT_CLI_CONFIG } from '../shared/schema.js';
import { validateConfig } from '../shared/validation.js';
import { resolveScoreWeights } from './analyzers/score-weights.js';

// Returns the merged config and every warning loadConfig prints, in its
// order: unknown keys (typos) first, then the value checks.
export function mergeConfig(fileConfig) {
  const file = fileConfig && typeof fileConfig === 'object' ? fileConfig : {};
  const config = { ...DEFAULT_CLI_CONFIG, ...file };
  const warnings = [...validateConfig(file), ...cliConfigWarnings(config)];
  return { config, warnings };
}

// Value-level CLI config checks that catch misconfigurations which would
// otherwise silently zero out a signal or verdict. Returns warning strings.
// Exported for testing.
export function cliConfigWarnings(config) {
  const warnings = [];
  const thr = config?.scoring?.softScoreThreshold;
  if (thr != null && typeof thr !== 'number') {
    warnings.push(
      `scoring.softScoreThreshold is not a number (got ${JSON.stringify(thr)}) — ` +
      `every soft-score comparison coerces to false, so NO participant will be ` +
      `soft-flagged. Set it to a number.`
    );
  }
  // The browser library's scoring rules look like they belong here too, but
  // the CLI reads only scoring.softScoreThreshold; the report score's weights
  // live in scoreWeights. Say so rather than ignore them silently.
  const scoring = config?.scoring;
  if (scoring && typeof scoring === 'object' && (scoring.soft != null || scoring.hard != null)) {
    warnings.push(
      'scoring.soft / scoring.hard configure the browser library, not the report; ' +
      'the CLI ignores them (only scoring.softScoreThreshold is read). To weight ' +
      'signals in the report score, use "scoreWeights".'
    );
  }
  // This is the single place scoreWeights warnings reach the console
  // (rankTriage resolves the same weights silently).
  warnings.push(...resolveScoreWeights(config?.scoreWeights).warnings);
  return warnings;
}
