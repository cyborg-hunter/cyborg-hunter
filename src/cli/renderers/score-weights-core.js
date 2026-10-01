// src/cli/renderers/score-weights-core.js
// score-weights.json's text — the weights this report's triage score was built
// with (config.scoreWeights merged onto the defaults). Warnings stay on the
// console (config.js prints them); this file holds weights only. No fs access:
// report-core.js sinks it, score-weights.js writes it.

import { resolveScoreWeights } from '../analyzers/score-weights.js';

// The file's text, plus whether the weights are the defaults (the console
// line says which).
export function buildScoreWeightsJson(config) {
  const { weights, isDefault } = resolveScoreWeights(config?.scoreWeights);
  return { text: JSON.stringify({ isDefault, weights }, null, 2) + '\n', isDefault };
}
