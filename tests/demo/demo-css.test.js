// tests/demo/demo-css.test.js
// The demo tour in the report's aesthetic: it loads the
// report's six typefaces from the assembled site, uses the report's tokens,
// and every face a rule asks for is either embedded or deliberately the
// system monospace (code, JSON, the event stream). Read from demo.css
// directly; the look itself is checked in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRules, rootVars, resolveVars, lastProp } from '../cli/report-css-helpers.js';

const css = readFileSync(new URL('../../demo/demo.css', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../../src/cli/renderers/fonts/FONTS_MANIFEST.json', import.meta.url), 'utf8'));
const EMBEDDED = ['Space Grotesk', 'Tomorrow', 'Sofia Sans', 'Sora', 'Recursive', 'Major Mono Display'];
const rules = parseRules(css);
const V = rootVars(rules);
const first = stack => resolveVars(stack, V).split(',')[0].trim().replace(/^["']|["']$/g, '');
function familyOf(decls) {
  if (decls['font-family']) return first(decls['font-family']);
  if (decls.font && decls.font !== 'inherit') return first(resolveVars(decls.font, V).replace(/^.*?\d+(\.\d+)?px(\/[\d.]+(px)?)?\s+/, ''));
  return null;
}
const faceOf = sel => { let f = null; for (const r of rules) if (r.selectors.includes(sel)) { const x = familyOf(r.decls); if (x) f = x; } return f; };

test('demo.css declares one @font-face per committed font file, by site URL and weight range', () => {
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]);
  assert.equal(faces.length, manifest.files.length);
  for (const f of manifest.files) {
    const face = faces.find(b => b.includes(`url('assets/fonts/${f.path}')`));
    assert.ok(face, f.path);
    assert.match(face, new RegExp(`font-family:\\s*"${f.family}"`));
    assert.match(face, new RegExp(`font-weight:\\s*${f.weight}`), `${f.family} weight range`);
    assert.match(face, /font-display:\s*swap/);
  }
});

test('every face a demo rule asks for is embedded, or the system monospace on purpose', () => {
  const strays = [];
  for (const r of rules) {
    const fam = familyOf(r.decls);
    if (!fam || EMBEDDED.includes(fam) || fam === 'ui-monospace' || fam === 'inherit' || r.selectors.includes(':root')) continue;
    strays.push(`${r.selectors.join(', ')} → ${fam}`);
  }
  assert.deepEqual(strays, []);
});

test('tokens follow the report palette; the serif is gone', () => {
  assert.equal(V['--ink'], '#0f0f0f');
  assert.equal(V['--dim'], '#4f4a40');
  assert.equal(V['--line'], '#b9b2a2');
  assert.equal(V['--ground'], '#fafafa');
  assert.equal(V['--hard'], '#d32f2f');
  assert.equal(V['--soft'], '#f57c00');
  assert.equal(V['--clean'], '#388e3c');
  assert.equal(V['--serif'], undefined);
});

test('typefaces mirror the report roles', () => {
  const EXPECT = {
    body: 'Recursive', '.stepcard h1': 'Space Grotesk', '.topbar .brand': 'Space Grotesk', '.yourreport h3': 'Space Grotesk',
    '.eyebrow': 'Sofia Sans', '.card h3': 'Sofia Sans', '.task .label': 'Sofia Sans', '.replicate h3': 'Sofia Sans',
    '.replay-host-card h3': 'Sofia Sans', '.filetext-dialog h3': 'Sofia Sans', '.lp-cols': 'Sofia Sans',
    '.hint': 'Tomorrow', '.rule': 'Tomorrow', '.lp-caption': 'Recursive', '.file small': 'Recursive',
    '.check li .n': 'Sora', '.topbar .pid': 'Sora', '.rec': 'Sora', '.chip': 'Sora',
    '.btn': 'Recursive', '.code-tab': 'Recursive', '.lp-tab': 'Recursive',
    '.lp-t': 'ui-monospace', '.lp-stream': 'ui-monospace', 'pre': 'ui-monospace',
  };
  for (const [sel, want] of Object.entries(EXPECT)) assert.equal(faceOf(sel), want, sel);
});

test('shapes follow the report idioms', () => {
  const EXPECT = [
    ['.stepcard', 'border-radius', '0'], ['.card', 'border-radius', '0'], ['.task', 'border-radius', '0'],
    ['.btn', 'border-radius', '4px'], ['.btn:hover', 'background', '#2b2b2b'],
    ['.chip', 'border-radius', '0'], ['.code-tabs', 'gap', '0'], ['.lp-tabs', 'gap', '0'],
    ['.code-tab.active', 'background', 'var(--ink)'], ['.lp-tab.active', 'background', 'var(--ink)'],
    ['.topbar', 'border-bottom', '3px double var(--ink)'],
    ['.lp-trial-tab[aria-pressed="true"]', 'box-shadow', 'inset 0 0 0 2px var(--ink)'],
  ];
  for (const [sel, prop, want] of EXPECT) assert.equal(lastProp(rules, sel, prop), want, `${sel} ${prop}`);
});

test('active tabs keep their weight (no width jump in a joined control)', () => {
  for (const sel of ['.code-tab.active', '.lp-tab.active', '.lp-trial-tab[aria-pressed="true"]']) {
    assert.equal(lastProp(rules, sel, 'font-weight'), null, sel);
  }
});

test('teal stays only on live cues: no focus ring or link uses it', () => {
  const offenders = rules.filter(r => Object.values(r.decls).some(v => /var\(--live\)/.test(v)))
    .map(r => r.selectors.join(', '))
    .filter(s => !/^\.rec\b|\.rec \.dot|^\.live\b/.test(s));
  assert.deepEqual(offenders, []);
});
