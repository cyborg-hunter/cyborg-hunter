// src/cli/renderers/score-weights.js
// Writes score-weights.json — the weights this report's triage score was built
// with. Always written, so two reports can be checked for comparability
// without their config files. Thin fs wrapper around score-weights-core.js.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildScoreWeightsJson } from './score-weights-core.js';

export function renderScoreWeights(config) {
  const { text, isDefault } = buildScoreWeightsJson(config);
  writeFileSync(join(config.outputDir, 'score-weights.json'), text);
  console.log(`  score-weights.json — ${isDefault ? 'default' : 'custom'} weights`);
}
