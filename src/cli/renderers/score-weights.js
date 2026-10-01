// src/cli/renderers/score-weights.js
// Writes score-weights.json — the weights this report's triage score was built
// with (config.scoreWeights merged onto the defaults). Always written, so two
// reports can be checked for comparability without their config files.
// Warnings stay on the console (config.js); this file holds weights only.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { resolveScoreWeights } from '../analyzers/score-weights.js';

// The file's text, with no fs access (report-core.js sinks it), plus whether
// the weights are the defaults (the console line says which).
export function buildScoreWeightsJson(config) {
  const { weights, isDefault } = resolveScoreWeights(config?.scoreWeights);
  return { text: JSON.stringify({ isDefault, weights }, null, 2) + '\n', isDefault };
}

export function renderScoreWeights(config) {
  const { text, isDefault } = buildScoreWeightsJson(config);
  writeFileSync(join(config.outputDir, 'score-weights.json'), text);
  console.log(`  score-weights.json — ${isDefault ? 'default' : 'custom'} weights`);
}
