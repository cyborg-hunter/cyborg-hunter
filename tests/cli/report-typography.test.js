// tests/cli/report-typography.test.js
// Every text role in the report uses the face Can picked in the report
// palette (docs/plans/2026-09-30-report-reshape.md §8, §8a, §4, §6a), and no
// rule names a face the report does not embed. Rules are read from the
// report's own CSS (the last matching rule wins, as in the cascade for equal
// specificity); computed styles are checked in a real browser in the plan's
// Task 7.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import { buildFontFaceCss } from '../../src/cli/renderers/report-fonts.js';

const EMBEDDED = ['Space Grotesk', 'Tomorrow', 'Sofia Sans', 'Sora', 'Recursive', 'Major Mono Display'];

async function reportCss() {
  const s = { participantId: 'P1', trialCount: 0, hardTriggered: false, totalSoftScore: 0, authoritativeSoftScore: null, metadata: {} };
  const html = await renderIndexHtml([s],
    [{ participantId: 'P1', score: 0, terms: [], reason: 'clean', hardTriggered: false, softFlagged: false, summary: s, edgeExitCount: 0 }],
    [{ participantId: 'P1', trials: [], session: {} }], { outputDir: '.' }, false);
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
}

function parseRules(css) {
  const rules = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    rules.push({ selectors, decls });
  }
  return rules;
}

function vars(rules) {
  const root = rules.filter(r => r.selectors.includes(':root'));
  return Object.assign({}, ...root.map(r => Object.fromEntries(Object.entries(r.decls).filter(([k]) => k.startsWith('--')))));
}

const resolve = (value, V) => value.replace(/var\((--[\w-]+)\)/g, (_, n) => V[n] ?? `var(${n})`);
const firstFamily = stack => stack.split(',')[0].trim().replace(/^["']|["']$/g, '');

// The family a rule's font-family / font shorthand starts with.
function familyOf(decls, V) {
  if (decls['font-family']) return firstFamily(resolve(decls['font-family'], V));
  if (decls.font) {
    const v = resolve(decls.font, V);
    const afterSize = v.replace(/^.*?\d+(\.\d+)?px(\/[\d.]+(px)?)?\s+/, '');
    return firstFamily(afterSize);
  }
  return null;
}

// The last rule listing exactly `selector` that sets `prop` (or the family).
function lastValue(rules, selector, pick) {
  let found = null;
  for (const r of rules) if (r.selectors.includes(selector)) { const v = pick(r.decls); if (v != null) found = v; }
  return found;
}

const ROLES = {
  'Space Grotesk': ['.topbar h1', '.modal-card h3'],
  Tomorrow: ['.topbar .meta', '.detail-header-sub', '.sort-wrap', '.reason', '.paste-preview', '.paste-full',
    '.replay-key-chip', '.replay-media-badge', '.note', '.paste-overflow'],
  'Sofia Sans': ['.section-heading', '.sig-cell-title', '.legend-table th'],
  Sora: ['.detail-header-top .score-big', '.signal-value', '.score-total', '.cohort-row-top .pid',
    '.detail-header-top .pid-full', '.detail-header-sub.mono', '.tier-badge', '.tier-pill', '.replay-badge',
    '.cohort-row-top .score', '.totals-row .count', '.score-term .contrib', '.totals-title', '.totals-row', '.mono'],
  Recursive: ['.signal-label', '.score-term .label', '.reason-excerpt', '.sig-cell li', '.legend-table td',
    '.topbar button', '.filter-chip', '.search-wrap input', '.sort-wrap select',
    '.replay-segment-select', '.replay-play', '.replay-speed', '.replay-note', '.replay-pause-toggle',
    '.replay-load-btn', '.replay-css-btn', '.replay-fetch-css-label', '.replay-unstyled', '.replay-neutral-label'],
  'Major Mono Display': ['.replay-clock', '.replay-ticker', '.paste-trial'],
};

describe('report typography: every role uses its picked face', () => {
  for (const [family, selectors] of Object.entries(ROLES)) {
    for (const sel of selectors) {
      it(`${sel} → ${family}`, async () => {
        const rules = parseRules(await reportCss());
        const V = vars(rules);
        assert.equal(lastValue(rules, sel, d => familyOf(d, V)), family);
      });
    }
  }
});

describe('report typography: sizes, weights and tracking from the picks', () => {
  const EXPECT = [
    ['.topbar h1', 'font-size', '32.4px'], ['.topbar h1', 'font-weight', '550'], ['.topbar h1', 'letter-spacing', '0.01em'],
    ['.topbar button', 'font-size', '19.5px'], ['.search-wrap input', 'font-size', '19.5px'],
    ['.sort-wrap select', 'font-size', '18px'], ['.filter-chip', 'font-size', '15px'],
    ['.topbar button', 'font-weight', '400'], ['.filter-chip', 'font-weight', '400'],
    ['.search-wrap input', 'font-weight', '400'], ['.sort-wrap select', 'font-weight', '400'],
    ['.topbar button', 'letter-spacing', '0'], ['.filter-chip', 'letter-spacing', '0'],
    ['.search-wrap input', 'letter-spacing', '0'], ['.sort-wrap select', 'letter-spacing', '0'],
  ];
  for (const [sel, prop, want] of EXPECT) {
    it(`${sel} ${prop}: ${want}`, async () => {
      const rules = parseRules(await reportCss());
      assert.equal(lastValue(rules, sel, d => d[prop] ?? null), want);
    });
  }

  it('.replay-key-chip is 13px Tomorrow at weight 400', async () => {
    const rules = parseRules(await reportCss());
    const V = vars(rules);
    const font = resolve(lastValue(rules, '.replay-key-chip', d => d.font ?? null), V);
    assert.match(font, /^400 13px\/[\d.]+ "Tomorrow"/);
  });

  it('tabular numerals survive on the numeral roles (after any font shorthand)', async () => {
    const rules = parseRules(await reportCss());
    for (const sel of ['.mono', '.replay-clock', '.replay-ticker']) {
      assert.equal(lastValue(rules, sel, d => d['font-variant-numeric'] ?? null), 'tabular-nums', sel);
    }
  });
});

describe('report typography: guard against silent fallbacks', () => {
  it('the embedded @font-face set is exactly the six picked families', () => {
    const faces = new Set([...buildFontFaceCss().matchAll(/font-family: "([^"]+)"/g)].map(m => m[1]));
    assert.deepEqual([...faces].sort(), [...EMBEDDED].sort());
  });

  it('every face a rule asks for first is embedded (only body keeps the system stack)', async () => {
    const rules = parseRules(await reportCss());
    const V = vars(rules);
    const strays = [];
    for (const r of rules) {
      const fam = familyOf(r.decls, V);
      if (fam == null || r.selectors.includes(':root')) continue;
      if (EMBEDDED.includes(fam)) continue;
      if (fam === 'inherit' || (r.selectors.includes('body') && fam === '-apple-system')) continue;
      strays.push(`${r.selectors.join(', ')} → ${fam}`);
    }
    assert.deepEqual(strays, []);
  });

  it('every embedded face is used by at least one rule', async () => {
    const rules = parseRules(await reportCss());
    const V = vars(rules);
    const used = new Set(rules.map(r => familyOf(r.decls, V)).filter(Boolean));
    for (const f of EMBEDDED) assert.ok(used.has(f), f);
  });
});
