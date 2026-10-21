// src/cli/analyzers/triage.js
// Ranks participants by suspiciousness and generates one-line reasons.
// This is the "start here" document for manual review — the researcher
// reads the triage list top-to-bottom, inspecting the most suspicious first.
//
// Ranking has two parts (see rankTriage + decomposeScore below):
//   - tier:  hard-triggered (and config.hardAt's hard*) → soft-flagged →
//            clean (primary sort key)
//   - score: by default 5×paste + 5×copy + 3×sidebar-open + 1×tab-away (within
//            a tier), where a "tab-away" is one longer than the participant's
//            tab-away threshold (3s by default, 5s for the strict preset).
//            config.scoreWeights can reweight these and switch on any other
//            signal (see score-weights.js); the tier never depends on it.
// Signals with weight 0 (by default: AI extensions, keyboard shortcuts,
// layout/zoom, edge-exits, synthetic insertions, foreign inputs) and honeypot
// disclosure are surfaced in the reason and detail panes but do not contribute
// to the score.

import { SCORE_SIGNALS, DEFAULT_RESOLVED_WEIGHTS, resolveScoreWeights, resolveHardAt, reportTierFromCounts } from './score-weights.js';

export function rankTriage(summaries, edgeExits, config) {
  // Resolved once per run. Warnings are not printed here: config.js
  // (cliConfigWarnings) is the single place they reach the console.
  const { weights } = resolveScoreWeights(config?.scoreWeights);
  // The report's own hard-tier rule (config.hardAt), one entry per
  // SCORE_SIGNALS key in table order; null where none is set.
  const { hardAt } = resolveHardAt(config?.hardAt);
  const hardAtList = SCORE_SIGNALS.map(sig => (Object.prototype.hasOwnProperty.call(hardAt, sig.key) ? hardAt[sig.key] : null));
  const triageList = summaries.map((s, i) => {
    const ee = edgeExits[i];
    const totalEdgeExits = ee.edgeExits.reduce((sum, t) => sum + t.edgeExitCount, 0);

    const terms = decomposeScore(s, totalEdgeExits, s.hardTriggered, weights);
    const score = sumTerms(terms);
    const reason = generateTriageReason(s, totalEdgeExits);
    // Threshold precedence: an explicit analyst-side CLI override
    // (config.scoring.softScoreThreshold) wins for deliberate re-screening;
    // otherwise use the participant's OWN saved threshold (what the library
    // screened them against — e.g. 4 for the strict preset); else default 6.
    // Using a hardcoded 6 here would mislabel strict-preset participants clean.
    const softFlagged = (s.authoritativeSoftScore ?? s.totalSoftScore) >=
      (config.scoring?.softScoreThreshold ?? s.softScoreThreshold ?? 6);
    // The tier reportTier starts from: 'hard' when the summary is
    // hardTriggered (the library's decision, or its recount over the scoped
    // trials under config.phaseScope); otherwise 'soft' or 'clean' from the
    // soft score against the threshold above, which an analyst's
    // config.scoring.softScoreThreshold re-screens.
    const libTier = s.hardTriggered ? 'hard' : softFlagged ? 'soft' : 'clean';

    return {
      participantId: s.participantId,
      score,
      // The applied [signal, contribution] pairs; renderers draw these so the
      // breakdown always matches the score that was ranked on.
      terms,
      reason,
      hardTriggered: s.hardTriggered,
      softFlagged,
      // The report's tier: the one above, or 'hard*' when a count reached
      // its config.hardAt. summary.csv's reportTier, triage.md's Tier and the
      // page's badges show it; hardTriggered stays the library's decision.
      reportTier: reportTierFromCounts(libTier, SCORE_SIGNALS.map(sig => sig.count(s, totalEdgeExits)), hardAtList),
      summary: s,
      edgeExitCount: totalEdgeExits
    };
  });

  // Sort tier-first (hard — hard* with it — then soft, then clean), and by
  // score descending within a tier. A hard-triggered participant (paste/drop
  // over its count threshold) is categorically more actionable than a high
  // soft-signal count, so they must lead the "start here" triage.md even
  // though the score (by default paste/copy/sidebar/tab-away) includes no
  // hard-trigger term. This matches the HTML index's "Tier" sort (hard:0,
  // soft:1, clean:2; score desc within tier).
  const tierRank = (t) => (t.reportTier === 'hard' || t.reportTier === 'hard*' ? 0 : t.reportTier === 'soft' ? 1 : 2);
  triageList.sort((a, b) => {
    const dt = tierRank(a) - tierRank(b);
    if (dt !== 0) return dt;
    return b.score - a.score;
  });
  return triageList;
}

// Decomposes the composite triage score into [label, contribution] pairs.
// Used by both rankTriage (sums them, and keeps them on the row as `terms`) and the
// HTML renderer (displays them
// with bars). Keeping the formula here means the score breakdown in the report can
// never silently disagree with the ranked score it explains.
//
// Each signal in SCORE_SIGNALS (score-weights.js) contributes
// min(count, max) × weight; signals whose weight is 0 are left out of the list
// (a weighted signal with a count of 0 stays in, as `[key, 0]`). The DEFAULT
// weights are the 2026-06-01 policy, so without config.scoreWeights the result
// is the 0.8.0 four-term list:
//   5 × paste events
//   5 × copy events
//   3 × sidebar events (open cycles)
//   1 × tab-aways longer than the participant's tab-away threshold (3s default,
//       5s strict) — excludes at-or-below-cutoff flickers, which are mostly noise
//       from brief URL-bar focus / window edge clicks
// Every other signal (AI extensions, layout shifts, zoom, keyboard shortcuts,
// edge exits, synthetic insertions, foreign inputs, …) defaults to 0 and can be
// weighted through config.scoreWeights. Nothing here affects the hard/soft/clean
// tier, and unweighted signals still render in the per-participant detail panes.
// hardTriggered stays in the signature for the renderer's call site; it is unused.
export function decomposeScore(summary, edgeExitCount, hardTriggered, weights = DEFAULT_RESOLVED_WEIGHTS) {
  const terms = [];
  for (const sig of SCORE_SIGNALS) {
    const { weight, max } = weights[sig.key];
    if (weight === 0) continue;
    const count = sig.count(summary, edgeExitCount);
    terms.push([sig.key, (max == null ? count : Math.min(count, max)) * weight]);
  }
  return terms;
}

// sumTerms stays an internal helper. It sums the decomposition in order,
// starting from the first term rather than a defensive 0, as the pre-refactor
// inline version did. With every weight set to 0 the list is empty and the
// score is 0. (Since 0.9.0 every term is multiplied by its weight, so malformed
// string counts are coerced to numbers rather than string-concatenated as they
// could be for the unmultiplied 0.8.0 tab-away term.)
function sumTerms(terms) {
  let score = terms.length ? terms[0][1] : 0;
  for (let i = 1; i < terms.length; i++) score += terms[i][1];
  // Deliberately unrounded: ordering uses the exact sum, so no configured
  // contribution, however small, can be erased. Binary noise from fractional
  // weights (0.1 × 3 = 0.30000000000000004) is removed only where scores are
  // displayed, by formatScore (score-weights.js).
  return score;
}

// Generates a human-readable one-line summary of why this participant was flagged.
// Each contributing signal is listed with its count.
export function generateTriageReason(summary, edgeExitCount = 0) {
  const parts = [];
  if (summary.totalPasteEvents > 0) parts.push(`${summary.totalPasteEvents} paste events`);
  if (summary.totalDropEvents > 0) parts.push(`${summary.totalDropEvents} drop events`);
  if (summary.totalCopyEvents > 0) parts.push(`${summary.totalCopyEvents} copy events`);
  // Three-way tab-away split when the analyzer produced it. The ≥3s bins feed the
  // soft score and lead the reason; flickers are surfaced separately so researchers
  // can see the noise floor without it inflating the apparent severity.
  if (summary.tabAwayLongCount != null || summary.tabAwayMediumCount != null ||
      summary.tabAwayFlickerCount != null) {
    const longN = summary.tabAwayLongCount || 0;
    const midN = summary.tabAwayMediumCount || 0;
    const flickN = summary.tabAwayFlickerCount || 0;
    // Bin boundaries follow THIS participant's tab-away cutoff (3s by default, 5s
    // for strict) so the reason matches the counts/score, which are now computed
    // against that same per-participant cutoff. Flicker is at-or-below the cutoff
    // (not scored); medium is above the cutoff and under 10s.
    const cutoffS = Math.round((summary.tabAwayCutoffMs ?? 3000) / 1000);
    if (longN > 0) parts.push(`${longN} tab-away${longN === 1 ? '' : 's'} ≥10s`);
    if (midN > 0) parts.push(`${midN} tab-away${midN === 1 ? '' : 's'} ${cutoffS}–10s`);
    if (flickN > 0) parts.push(`${flickN} flicker${flickN === 1 ? '' : 's'} ≤${cutoffS}s`);
  } else if (summary.totalTabAways > 0) {
    parts.push(`${summary.totalTabAways} tab-aways`);
  }
  if (summary.trialsWithFastTyping > 0) parts.push(`fast typing on ${summary.trialsWithFastTyping} trials`);
  // Prefer canonical aiExtensionsFound; fall back to legacy extensionsDetected for tests.
  // A reduced Qualtrics payload counts every AI extension found
  // (aiExtensionCount) but may have dropped the names found on earlier pages.
  const aiExtensions = summary.aiExtensionsFound || summary.extensionsDetected || [];
  const names = aiExtensions.map(e => typeof e === 'string' ? e : (e.name || 'unknown'));
  const unnamed = (summary.aiExtensionCount ?? names.length) - names.length;
  const plural = unnamed === 1 ? '' : 's';
  if (names.length > 0 && unnamed > 0) parts.push(`${names.join(', ')} and ${unnamed} more AI extension${plural} detected`);
  else if (names.length > 0) parts.push(names.join(', ') + ' detected');
  else if (unnamed > 0) parts.push(`${unnamed} AI extension${plural} detected`);
  const sidebarCount = summary.sidebarEventCount ?? (summary.sidebarDetected ? 1 : 0);
  if (sidebarCount > 0) parts.push(`${sidebarCount} sidebar event${sidebarCount === 1 ? '' : 's'}`);
  if (summary.keyboardShortcutCount > 0) parts.push(`${summary.keyboardShortcutCount} keyboard shortcuts`);
  if (summary.layoutShiftCount > 0) parts.push(`${summary.layoutShiftCount} layout shifts`);
  if (summary.zoomChangeCount > 0) parts.push(`${summary.zoomChangeCount} zoom changes`);
  if (summary.devToolsEventCount > 0) parts.push(`${summary.devToolsEventCount} devtools events`);
  if (edgeExitCount > 0) parts.push(`${edgeExitCount} edge-exit patterns`);
  if (summary.totalSyntheticInsertions > 0) parts.push(`${summary.totalSyntheticInsertions} synthetic insertions`);
  if (summary.totalForeignInputEvents > 0) parts.push(`${summary.totalForeignInputEvents} foreign inputs`);
  // The typing verdict (analyzers/typing.js), when it counts against the
  // session; unscored unless scoreWeights.typingRhythm is set. Before the
  // pointer clause, as the report's sections are ordered.
  const ta = summary.typingAnalysis;
  if (ta && ta.level > 0) parts.push(`typing verdict: ${ta.verdict} (${ta.tells.map(t => t.short).join('; ')})`);
  // The pointer verdict (analyzers/cursor.js), when it counts against the
  // session — unscored unless scoreWeights.cursor is set, like the honeypot
  // clause below.
  const ca = summary.cursorAnalysis;
  if (ca && ca.level > 0) parts.push(`pointer verdict: ${ca.verdict} (${ca.tells.map(t => t.short).join('; ')})`);
  // Guard-honeypot self-disclosure — a strong corroborating signal, surfaced in
  // the reason though it does not feed the score (it has no scoreWeights key).
  if (summary.honeypotAiUse) parts.push('self-reported AI use (honeypot)');
  if (parts.length === 0) parts.push('clean');
  return parts.join('; ');
}
