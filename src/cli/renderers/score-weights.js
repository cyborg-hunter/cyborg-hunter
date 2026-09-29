// src/cli/renderers/score-weights.js
// Writes score-weights.json — the weights this report's triage score was built
// with (config.scoreWeights merged onto the defaults). Always written, so two
// reports can be checked for comparability without their config files.
// Warnings stay on the console (config.js); this file holds weights only.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { resolveScoreWeights } from '../analyzers/score-weights.js';

export function renderScoreWeights(config) {
  const { weights, isDefault } = resolveScoreWeights(config?.scoreWeights);
  writeFileSync(join(config.outputDir, 'score-weights.json'),
    JSON.stringify({ isDefault, weights }, null, 2) + '\n');
  console.log(`  score-weights.json — ${isDefault ? 'default' : 'custom'} weights`);
}
