// src/cli/analyzers/score-weights.js
// The report score's signal table and its weights (config.scoreWeights).
//
// The report score orders participants WITHIN a tier (see triage.js). Each
// signal below contributes min(count, max) × weight. The default weights
// reproduce the fixed 0.8.0 score: 5×paste + 5×copy + 3×sidebar + 1×tab-away
// (tab-aways longer than the participant's threshold). Every other signal
// defaults to 0 and can be switched on from cyborg-hunter.config.json:
//
//   "scoreWeights": { "synthetic": 1, "copy": { "weight": 5, "max": 3 } }
//
// A user's scoreWeights is merged PER KEY onto the defaults (the config loader
// merges top-level keys only), so writing one key never zeroes the others.
// The hard/soft/clean tier does not depend on these weights.

import { findClosestKey } from '../../shared/validation.js';

// Order matters: the first four are the 0.8.0 terms in their 0.8.0 order, so
// default output (breakdown, totals) is unchanged. Counts copy the 0.8.0
// expressions, including the sidebar fallback for pre-count data.
export const SCORE_SIGNALS = [
  { key: 'paste',          weight: 5, count: s => s.totalPasteEvents || 0 },
  { key: 'copy',           weight: 5, count: s => s.totalCopyEvents || 0 },
  { key: 'sidebar',        weight: 3, count: s => s.sidebarEventCount ?? (s.sidebarDetected ? 1 : 0) },
  { key: 'tabaway',        weight: 1, count: s => (s.tabAwayLongCount || 0) + (s.tabAwayMediumCount || 0) },
  { key: 'tabawayLong',    weight: 0, count: s => s.tabAwayLongCount || 0 },
  { key: 'tabawayMedium',  weight: 0, count: s => s.tabAwayMediumCount || 0 },
  { key: 'flicker',        weight: 0, count: s => s.tabAwayFlickerCount || 0 },
  { key: 'drop',           weight: 0, count: s => s.totalDropEvents || 0 },
  { key: 'fastTyping',     weight: 0, count: s => s.trialsWithFastTyping || 0 },
  { key: 'synthetic',      weight: 0, count: s => s.totalSyntheticInsertions || 0 },
  { key: 'foreignInput',   weight: 0, count: s => s.totalForeignInputEvents || 0 },
  { key: 'aiExtensions',   weight: 0, count: s => (s.aiExtensionsFound || s.extensionsDetected || []).length },
  { key: 'kbShortcuts',    weight: 0, count: s => s.keyboardShortcutCount || 0 },
  { key: 'viewportShifts', weight: 0, count: s => s.layoutShiftCount || 0 },
  { key: 'zoom',           weight: 0, count: s => s.zoomChangeCount || 0 },
  // Edge exits are computed per trial by edge-exit.js and summed on the
  // triage row; they are not a summary field.
  { key: 'edgeExits',      weight: 0, count: (s, edgeExitCount) => edgeExitCount || 0 },
];

const KEYS = SCORE_SIGNALS.map(s => s.key);

export const DEFAULT_SCORE_WEIGHTS = Object.fromEntries(SCORE_SIGNALS.map(s => [s.key, s.weight]));

const show = v => {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || v == null || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch (e) { return typeof v; }
};
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const validWeight = w => typeof w === 'number' && Number.isFinite(w) && w >= 0;
const validMax = m => Number.isInteger(m) && m >= 0;

// Returns { weights: { key: { weight, max|null } }, isDefault, warnings }.
// Invalid entries warn and keep that key's default; nothing here throws.
export function resolveScoreWeights(user) {
  const weights = Object.fromEntries(SCORE_SIGNALS.map(s => [s.key, { weight: s.weight, max: null }]));
  const warnings = [];

  if (user != null && !isPlainObject(user)) {
    warnings.push(`scoreWeights must be an object of signal weights (got ${show(user)}); using the default weights.`);
  } else if (user != null) {
    for (const [key, value] of Object.entries(user)) {
      if (key === 'devTools') {
        warnings.push('scoreWeights.devTools is ignored: the DevTools count is always 0. DevTools hotkeys are counted under "kbShortcuts".');
        continue;
      }
      if (!KEYS.includes(key)) {
        const guess = findClosestKey(key, KEYS);
        warnings.push(`scoreWeights: unknown signal "${key}"${guess ? ` (did you mean "${guess}"?)` : ''}; it is ignored. Keys are case-sensitive.`);
        continue;
      }
      const slot = weights[key];
      const def = DEFAULT_SCORE_WEIGHTS[key];
      const obj = isPlainObject(value) ? value : null;
      const hasWeight = obj ? obj.weight !== undefined : true;
      const w = obj ? obj.weight : value;

      if (obj && !hasWeight && obj.max !== undefined) {
        warnings.push(`scoreWeights.${key} has a max but no weight; the default weight ${def} applies.`);
      } else if (!validWeight(w)) {
        warnings.push(`scoreWeights.${key}: the weight must be a finite number ≥ 0 (got ${show(obj ? (hasWeight ? w : obj) : value)}); using the default ${def}.`);
      } else {
        slot.weight = w;
      }

      if (obj && obj.max !== undefined) {
        if (validMax(obj.max)) slot.max = obj.max;
        else warnings.push(`scoreWeights.${key}.max must be a whole number ≥ 0 (got ${show(obj.max)}); no cap is applied.`);
      }
    }
  }

  if (weights.tabaway.weight !== 0 && (weights.tabawayLong.weight !== 0 || weights.tabawayMedium.weight !== 0)) {
    warnings.push('scoreWeights: "tabaway" already counts long + medium tab-aways, so weighting "tabawayLong" or "tabawayMedium" as well double counts them. Set "tabaway": 0 to use the split keys.');
  }
  if (KEYS.every(k => weights[k].weight === 0)) {
    warnings.push('scoreWeights: every weight is 0, so every report score will be 0.');
  }

  const isDefault = KEYS.every(k => weights[k].weight === DEFAULT_SCORE_WEIGHTS[k] && weights[k].max === null);
  return { weights, isDefault, warnings };
}

export const DEFAULT_RESOLVED_WEIGHTS = resolveScoreWeights(null).weights;

// The one formatter for displayed scores. Integers (every score under integer
// weights, i.e. all default output) pass through unchanged, type included;
// fractional scores print to one decimal; non-numbers pass through.
export function formatScore(n) {
  return typeof n === 'number' && !Number.isInteger(n) ? n.toFixed(1) : n;
}
