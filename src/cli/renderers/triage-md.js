// src/cli/renderers/triage-md.js
// Writes triage.md — a ranked markdown table of participants by suspiciousness.
// This is the "start here" document for manual review.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { resolveScoreWeights, formulaText, formatScore } from '../analyzers/score-weights.js';

export async function renderTriage(triage, config) {
  // Default weights keep the 0.8.0 sentence verbatim; custom ones state the
  // formula that was actually applied (config.scoreWeights).
  const { weights, isDefault } = resolveScoreWeights(config?.scoreWeights);
  const formula = isDefault
    ? 'heuristic (5×paste + 5×copy + 3×sidebar + 1×tab-away) — it orders rows'
    : `heuristic (${formulaText(weights)}, set by scoreWeights) — it orders rows`;
  const lines = [
    '# Participant Triage — Ranked by Suspiciousness',
    '',
    `_${triage.length} participants analyzed_`,
    '',
    '**Tier** is the library\'s two-tier screening verdict: `HARD` = a hard signal',
    '(paste/drop/copy) crossed its count threshold; `soft` = library soft score ≥',
    'its threshold; `clean` = neither. **Score** is the CLI\'s separate ranking',
    formula,
    '*within* a tier and is not the library soft score.',
    '',
    '| Rank | Participant | Tier | Score | Reason |',
    '|------|-------------|------|-------|--------|',
  ];

  triage.forEach((t, i) => {
    const tier = t.hardTriggered ? '**HARD**' : t.softFlagged ? 'soft' : 'clean';
    // Escape pipe characters in reason text to avoid breaking the table
    const reason = t.reason.replace(/\|/g, '\\|');
    lines.push(`| ${i + 1} | ${t.participantId} | ${tier} | ${formatScore(t.score)} | ${reason} |`);
  });

  lines.push('');
  const outPath = join(config.outputDir, 'triage.md');
  writeFileSync(outPath, lines.join('\n'));
  console.log(`  triage.md — ranked list`);
}
