// src/cli/renderers/triage-md-core.js
// triage.md's text — a ranked markdown table of participants by suspiciousness,
// the "start here" document for manual review. No fs access: report-core.js
// sinks it, triage-md.js writes it.

import { resolveScoreWeights, formulaText, formatScore } from '../analyzers/score-weights.js';

export function buildTriageMd(triage, config) {
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
    ...(config?.pseudonymize
      ? ['_Participant IDs are pseudonymized codes; the key that maps them back is kept apart from this report._', '']
      : []),
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
    lines.push(`| ${i + 1} | ${mdCell(t.participantId)} | ${tier} | ${formatScore(t.score)} | ${reason} |`);
  });

  lines.push('');
  return lines.join('\n');
}

// A participant id in a table cell, as text: the id comes from participant
// data, so a pipe would break the table and markdown or HTML in it would be
// rendered (a link, an image the viewer fetches, a tag). Backslash-escape
// what can do that (the pipe, brackets, angle brackets, emphasis and code
// marks, the backslash itself) and drop line breaks; `_` and `-`, common in
// ids, stay as they are (GitHub-flavoured markdown does not emphasise inside
// a word).
function mdCell(v) {
  return String(v == null ? '' : v)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\`*[\]|<>~]/g, (c) => '\\' + c);
}
