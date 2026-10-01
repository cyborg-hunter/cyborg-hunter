// tests/cli/report-css-helpers.js
// Shared by the report typography/shape tests: render the report with no
// options, collect its <style> blocks and read rules the simple way (the last
// rule listing a selector wins, as in the cascade at equal specificity).
// Computed styles are checked in a real browser separately.
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';

export async function reportCss() {
  const s = { participantId: 'P1', trialCount: 0, hardTriggered: false, totalSoftScore: 0, authoritativeSoftScore: null, metadata: {} };
  const html = await renderIndexHtml([s],
    [{ participantId: 'P1', score: 0, terms: [], reason: 'clean', hardTriggered: false, softFlagged: false, summary: s, edgeExitCount: 0 }],
    [{ participantId: 'P1', trials: [], session: {} }], { outputDir: '.' }, false);
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
}

export function parseRules(css) {
  const rules = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
    }
    rules.push({ selectors, decls });
  }
  return rules;
}

export function rootVars(rules) {
  const root = rules.filter(r => r.selectors.includes(':root'));
  return Object.assign({}, ...root.map(r => Object.fromEntries(Object.entries(r.decls).filter(([k]) => k.startsWith('--')))));
}

export const resolveVars = (value, V) => value.replace(/var\((--[\w-]+)\)/g, (_, n) => V[n] ?? `var(${n})`);

// The value `pick(decls)` returns for the last rule that lists exactly `selector`.
export function lastValue(rules, selector, pick) {
  let found = null;
  for (const r of rules) if (r.selectors.includes(selector)) { const v = pick(r.decls); if (v != null) found = v; }
  return found;
}

export const lastProp = (rules, selector, prop) => lastValue(rules, selector, d => d[prop] ?? null);
