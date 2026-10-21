// src/cli/renderers/score-weights-core.js
// score-weights.json's text — the weights this report's triage score was built
// with (config.scoreWeights merged onto the defaults), and config.hardAt when
// set. Warnings stay on the console (config.js prints them); this file holds
// none. No fs access: report-core.js sinks it, score-weights.js writes it.

import { resolveScoreWeights, resolveHardAt } from '../analyzers/score-weights.js';

// The file's text, plus whether the weights are the defaults (the console
// line says which). hardAt is written only when the config sets a rule, so a
// report without one writes the file it always did.
export function buildScoreWeightsJson(config) {
  const { weights, isDefault } = resolveScoreWeights(config?.scoreWeights);
  const { hardAt } = resolveHardAt(config?.hardAt);
  const body = Object.keys(hardAt).length ? { isDefault, weights, hardAt } : { isDefault, weights };
  return { text: JSON.stringify(body, null, 2) + '\n', isDefault };
}
