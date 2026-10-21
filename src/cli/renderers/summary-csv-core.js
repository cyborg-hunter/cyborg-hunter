// src/cli/renderers/summary-csv-core.js
// summary.csv's text — one row per participant with columns for every
// signal aggregate and the triage score/reason. No fs access: report-core.js
// sinks it, summary-csv.js writes it.

import { csvCell } from '../../shared/csv-cell.js';

// The smallest of one measure over a typing analysis's judged fields, or ''
// with none. A loop, not Math.min(...): a file can hold more fields than a
// spread can pass as arguments (as analyzers/typing.js notes).
const leastOfFields = (s, k) => {
  const f = s.typingAnalysis?.fields;
  return f && f.length ? f.reduce((m, x) => Math.min(m, x[k]), Infinity) : '';
};

// CSV columns in output order. Each entry: [header, accessor function].
const COLUMNS = [
  ['participantId', (s, t) => s.participantId],
  ['trialCount', (s, t) => s.trialCount],
  // The exact score rankTriage sorted on (not the one-decimal display form),
  // so the analysis file never disagrees with the ranking.
  ['triageScore', (s, t) => t.score],
  ['hardTriggered', (s, t) => t.hardTriggered ? 'YES' : 'no'],
  ['triageReason', (s, t) => t.reason],
  ['totalPasteEvents', (s, t) => s.totalPasteEvents],
  ['totalCopyEvents', (s, t) => s.totalCopyEvents],
  ['totalDropEvents', (s, t) => s.totalDropEvents],
  ['totalTabAways', (s, t) => s.totalTabAways],
  ['tabAwayLongCount', (s, t) => s.tabAwayLongCount ?? 0],       // ≥10s
  ['tabAwayMediumCount', (s, t) => s.tabAwayMediumCount ?? 0],   // 3–10s
  ['tabAwayFlickerCount', (s, t) => s.tabAwayFlickerCount ?? 0], // <3s
  ['totalTabAwayDuration_ms', (s, t) => s.totalTabAwayDuration_ms],
  ['trialsWithTabAway', (s, t) => s.trialsWithTabAway],
  ['meanTypingSpeed', (s, t) => s.meanTypingSpeed.toFixed(2)],
  ['trialsWithFastTyping', (s, t) => s.trialsWithFastTyping],
  ['meanMouseEvents', (s, t) => s.meanMouseEvents.toFixed(1)],
  ['meanPathEfficiency', (s, t) => s.meanPathEfficiency.toFixed(3)],
  ['totalIdleGaps', (s, t) => s.totalIdleGaps],
  ['totalSyntheticInsertions', (s, t) => s.totalSyntheticInsertions],
  ['totalForeignInputEvents', (s, t) => s.totalForeignInputEvents],
  ['totalSoftScore', (s, t) => s.totalSoftScore],
  ['edgeExitCount', (s, t) => t.edgeExitCount],
  // Session-level signals — drop legacy sidebarDetected/extensionsDetected
  // columns in favour of richer session-authoritative counts.
  ['sidebar_event_count', (s, t) => s.sidebarEventCount ?? 0],
  ['ai_extensions', (s, t) => {
    const ext = s.aiExtensionsFound || [];
    return ext.map(e => typeof e === 'string' ? e : (e.name || 'unknown')).join('; ');
  }],
  ['keyboard_shortcut_count', (s, t) => s.keyboardShortcutCount || 0],
  ['layout_shift_count', (s, t) => s.layoutShiftCount || 0],
  ['zoom_change_count', (s, t) => s.zoomChangeCount || 0],
  ['dev_tools_event_count', (s, t) => s.devToolsEventCount || 0],
  ['authoritative_soft_score', (s, t) => s.authoritativeSoftScore ?? ''],
  // Guard-honeypot self-disclosure. Three states: 'YES' = box ticked,
  // 'no' = honeypot present but unticked (negative evidence), '' = honeypot
  // extension not used for this participant (honeypotAiUse is null).
  ['honeypot_ai_use', (s, t) => s.honeypotAiUse == null ? '' : (s.honeypotAiUse ? 'YES' : 'no')],
  ['honeypot_ai_report', (s, t) => s.honeypotAiReport || ''],
  // The cursor section (analyzers/cursor.js). Headers are fixed here once;
  // twenty-one columns: the reason a session has no verdict, the verdict and
  // its tells, then the checks, the rules and the shape (medians only, no n).
  // '' means "no value" (a null session, a check not recorded, a value with
  // no n). The two centered columns (exact centre, then near it) are filled
  // from the recording; '' without one, 'touch' for a touch recording (not
  // judged). The last, the software-renderer device fact (0.17), reads
  // 'YES (<family>)', 'no', 'no WebGL', or '' when not recorded.
  // A session with no cursor stream records only the automation flag and,
  // from 0.17, the software renderer, so its two click checks are '' like
  // the cursor block.
  ['cursorReason', (s) => s.cursorAnalysis?.verdictReason ?? ''],
  ['cursorVerdict', (s) => s.cursorAnalysis?.verdict ?? ''],
  ['cursorTells', (s) => s.cursorAnalysis ? s.cursorAnalysis.tells.map(t => t.short).join('; ') : ''],
  ['cursorChecksRecorded', (s) => s.cursorAnalysis ? s.cursorAnalysis.checksRecorded : ''],
  ['cursorFactCount', (s) => typeof s.cursorAnalysis?.factCount === 'number' ? s.cursorAnalysis.factCount : ''],
  ['cursorWebdriver', (s) => { const c = s.cursorAnalysis?.checks?.webdriver; return c && typeof c === 'object' ? (c.fired ? 'YES' : 'no') : ''; }],
  ['cursorUntrustedClicks', (s) => { const c = s.cursorAnalysis?.checks?.untrustedClicks; return c && typeof c === 'object' && s.cursorAnalysis.state === 'ok' ? c.count : ''; }],
  ['cursorZeroMoveTrials', (s) => { const c = s.cursorAnalysis?.checks?.zeroMoveTrials; return c && typeof c === 'object' && s.cursorAnalysis.state === 'ok' ? `${c.count}/${c.of}` : ''; }],
  ['cursorJumpClicks', (s) => { const r = s.cursorAnalysis?.cursor?.rules?.jumpClicks; return r ? `${r.count}/${r.of}` : ''; }],
  ['cursorNoPathClicks', (s) => { const r = s.cursorAnalysis?.cursor?.rules?.noPathClicks; return r ? `${r.count}/${r.of}` : ''; }],
  ['cursorCoordinates', (s) => s.cursorAnalysis?.cursor?.coordinates ?? ''],
  ['cursorStream', (s) => s.cursorAnalysis?.cursor?.stream ?? ''],
  ['cursorSampleIntervalMs', (s) => s.cursorAnalysis?.cursor?.sampleIntervalMs ?? ''],
  ['cursorClicks', (s) => s.cursorAnalysis?.cursor?.clicks ?? ''],
  ['cursorMovements', (s) => s.cursorAnalysis?.cursor?.movements ?? ''],
  ['cursorMovesPerTrialMedian', (s) => s.cursorAnalysis?.cursor?.features?.movesPerTrial?.median ?? ''],
  ['cursorEfficiencyMedian', (s) => { const m = s.cursorAnalysis?.cursor?.features?.efficiency?.median; return m == null ? '' : m.toFixed(3); }],
  ['cursorMaxDeviationPxMedian', (s) => { const m = s.cursorAnalysis?.cursor?.features?.maxDeviationPx?.median; return m == null ? '' : m.toFixed(1); }],
  ['cursorCenteredClicks', (s) => { const r = s.cursorAnalysis?.cursor?.rules?.centeredClicks; return !r ? '' : r.state === 'touch' ? 'touch' : `${r.count}/${r.of}`; }],
  ['cursorCenteredNear', (s) => { const r = s.cursorAnalysis?.cursor?.rules?.centeredClicks; return !r ? '' : r.state === 'touch' ? 'touch' : r.near ? `${r.near.count}/${r.near.of}` : ''; }],
  ['cursorSoftwareRenderer', (s) => { const c = s.cursorAnalysis?.checks?.softwareRenderer; return c && typeof c === 'object' ? (c.fired ? `YES (${c.family})` : c.noWebgl ? 'no WebGL' : 'no') : ''; }],
  // Device masking (analyzers/device-masking.js): the rules that fired,
  // space-separated (R1, R2, R3a); empty when none fired or the session has
  // no window log. After the cursor block, so its columns keep their places.
  ['deviceMasking', (s) => (s.deviceMasking && Array.isArray(s.deviceMasking.rules) ? s.deviceMasking.rules.join(' ') : '')],
  // The typing section (analyzers/typing.js): six columns appended after
  // every other block, so that no earlier column moves. '' means no value:
  // no analysis, a session whose typing rhythm was not recorded (fields
  // judged), or no judged field (the fastest median gap, the lowest
  // variation). typingRateSource says where the typing rates came from:
  // 'library', 'edit times' (the trial's saved edit times), 'recording' or
  // 'old formula'; with several, the weakest any judged trial used (old
  // formula < recording < edit times < library). It names the rate's
  // source, not the rhythm's. No cell holds a comma.
  ['typingVerdict', (s) => s.typingAnalysis?.verdict ?? ''],
  ['typingTells', (s) => s.typingAnalysis ? s.typingAnalysis.tells.map(t => t.short).join('; ') : ''],
  ['typingFieldsJudged', (s) => s.typingAnalysis && s.typingAnalysis.state !== 'not recorded' ? s.typingAnalysis.fields.length : ''],
  ['typingFastestMedianMs', (s) => leastOfFields(s, 'medianMs')],
  ['typingLowestCv', (s) => leastOfFields(s, 'cv')],
  ['typingRateSource', (s) => s.typingAnalysis?.rate?.source ?? ''],
  // The report's tier (triage.js reportTier): hardTriggered's decision, or
  // hard* when a count reached config.hardAt. Appended after every other
  // block, so that no earlier column moves. A row built without it gets the
  // library's tier.
  ['reportTier', (s, t) => t.reportTier ?? (t.hardTriggered ? 'hard' : t.softFlagged ? 'soft' : 'clean')],
];

export function buildSummaryCsv(summaries, triage) {
  // Build a lookup from participantId → triage entry
  const triageMap = new Map(triage.map(t => [t.participantId, t]));

  const header = COLUMNS.map(c => c[0]).join(',');
  const rows = summaries.map(s => {
    const t = triageMap.get(s.participantId) || {};
    return COLUMNS.map(c => csvCell(c[1](s, t))).join(',');
  });

  return [header, ...rows].join('\n') + '\n';
}
