// tests/cli/score-display.test.js
// Every place the report shows the triage score follows config.scoreWeights:
// the HTML breakdown draws the applied terms, the header notes custom
// weights, fractional scores are formatted once, and triage.md / the
// trajectories PNG header / summary.csv agree. Default output is unchanged
// (the byte-level guard is html-index-snapshot.test.js).
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import { renderTriage } from '../../src/cli/renderers/triage-md.js';
import { renderSummaryCSV } from '../../src/cli/renderers/summary-csv.js';
import { drawTrajectoryGrid } from '../../src/cli/renderers/trajectories-core.js';

const outputDir = mkdtempSync(join(tmpdir(), 'ch-score-display-'));
after(() => rmSync(outputDir, { recursive: true, force: true }));

const summary = (pid, overrides = {}) => ({
  participantId: pid, trialCount: 1,
  totalPasteEvents: 0, totalCopyEvents: 0, totalDropEvents: 0,
  totalTabAways: 0, tabAwayFlickerCount: 0, tabAwayMediumCount: 0, tabAwayLongCount: 0,
  totalTabAwayDuration_ms: 0, trialsWithTabAway: 0,
  meanTypingSpeed: 0, trialsWithFastTyping: 0, meanMouseEvents: 0, meanPathEfficiency: 0,
  extensionsDetected: [], sidebarDetected: false,
  totalIdleGaps: 0, totalSyntheticInsertions: 0, totalForeignInputEvents: 0,
  totalSoftScore: 0, authoritativeSoftScore: null,
  sidebarEventCount: 0, aiExtensionsFound: [],
  keyboardShortcutCount: 0, layoutShiftCount: 0, zoomChangeCount: 0,
  extensionInjectionCount: 0, devToolsEventCount: 0,
  hardTriggered: false, metadata: {},
  ...overrides,
});
const participant = pid => ({ participantId: pid, trials: [{ trialId: 't1', pasteEvents: [] }], session: {} });
const noEdges = n => Array.from({ length: n }, () => ({ edgeExits: [] }));

function html(summaries, config, triageOverride) {
  const triage = triageOverride || rankTriage(summaries, noEdges(summaries.length), config);
  return renderIndexHtml(summaries, triage, summaries.map(s => participant(s.participantId)), config, false);
}
const breakdownOf = (page, pid) => {
  const start = page.indexOf(`id="p-${pid}"`);
  const from = page.indexOf('<div class="score-breakdown">', start);
  return page.slice(from, page.indexOf('score-total', from) + 60);
};

describe('HTML score display', () => {
  it('draws a configured term in the breakdown', async () => {
    const page = await html([summary('P1', { totalSyntheticInsertions: 3 })], { scoreWeights: { synthetic: 1 } });
    const b = breakdownOf(page, 'P1');
    assert.match(b, /<span class="label">synthetic<\/span>\s*<span class="mono contrib">\+3<\/span>/);
    assert.match(b, /Total: 3/);
  });

  it('pin: a row without terms and no scoreWeights draws the default terms', async () => {
    const s = summary('P1', { totalPasteEvents: 1, sidebarEventCount: 1 });
    const legacyRow = { participantId: 'P1', score: 8, reason: 'x', hardTriggered: false, softFlagged: false, summary: s, edgeExitCount: 0 };
    const b = breakdownOf(await html([s], {}, [legacyRow]), 'P1');
    assert.match(b, /label">paste<[\s\S]*\+5/);
    assert.match(b, /label">sidebar<[\s\S]*\+3/);
  });

  it('a row without terms falls back to the CONFIGURED weights, not the defaults', async () => {
    const s = summary('P1', { totalPasteEvents: 1, sidebarEventCount: 1 });
    const legacyRow = { participantId: 'P1', score: 3, reason: 'x', hardTriggered: false, softFlagged: false, summary: s, edgeExitCount: 0 };
    const b = breakdownOf(await html([s], { scoreWeights: { paste: 0 } }, [legacyRow]), 'P1');
    assert.doesNotMatch(b, /label">paste</);
    assert.match(b, /label">sidebar</);
  });

  it('the top bar names custom weights, and says nothing under the defaults', async () => {
    const custom = await html([summary('P1')], { scoreWeights: { synthetic: 1, copy: { weight: 5, max: 3 } } });
    assert.match(custom, /class="meta">1 participants &middot; v[\d.]+ &middot; custom score weights: copy 5 max 3, synthetic 1</);
    const plain = await html([summary('P1')], {});
    assert.doesNotMatch(plain, /custom score weights/);
  });

  it('fractional scores print to one decimal everywhere; data-score keeps the raw value', async () => {
    const page = await html([summary('P1', { totalSyntheticInsertions: 3 })], { scoreWeights: { synthetic: 0.5 } });
    assert.match(page, /data-score="1.5"/);
    assert.match(page, /<span class="mono score">1.5<\/span>/);
    assert.match(page, /<span class="mono score-big">1.5<\/span>/);
    const b = breakdownOf(page, 'P1');
    assert.match(b, /\+1.5/);
    assert.match(b, /Total: 1.5/);
  });

  it('floating-point noise never reaches visible text; data-score keeps the exact sum for sorting', async () => {
    const page = await html([summary('P1', { totalSyntheticInsertions: 3 })], { scoreWeights: { synthetic: 0.1 } });
    const visible = page.replace(/data-score="[^"]*"/g, '');
    assert.doesNotMatch(visible, /0\.30000000000000004/);
    assert.match(page, /<span class="mono score-big">0.3<\/span>/);
    assert.match(page, /data-score="0.30000000000000004"/);
  });
});

describe('triage.md, summary.csv and the trajectories header', () => {
  const DEFAULT_SENTENCE = "heuristic (5×paste + 5×copy + 3×sidebar + 1×tab-away) — it orders rows";

  it('pin: under default weights the triage.md header keeps its 0.8.0 wording', async () => {
    const triage = rankTriage([summary('P1')], noEdges(1), {});
    await renderTriage(triage, { outputDir });
    const md = readFileSync(join(outputDir, 'triage.md'), 'utf8');
    assert.ok(md.includes(DEFAULT_SENTENCE));
    assert.ok(md.includes('not the library soft score'));
  });

  it('under custom weights the triage.md formula names the configured terms', async () => {
    const config = { outputDir, scoreWeights: { synthetic: 1, paste: 0 } };
    const triage = rankTriage([summary('P1', { totalSyntheticInsertions: 2 })], noEdges(1), config);
    await renderTriage(triage, config);
    const md = readFileSync(join(outputDir, 'triage.md'), 'utf8');
    assert.ok(!md.includes(DEFAULT_SENTENCE));
    assert.ok(md.includes('5×copy + 3×sidebar + 1×tabaway + 1×synthetic'), md);
    assert.ok(md.includes('not the library soft score'));
    assert.match(md, /\| 1 \| P1 \| clean \| 2 \|/);
  });

  it('summary.csv carries exactly the score the ranking used, however small the difference', async () => {
    const config = { outputDir, scoreWeights: { synthetic: 1, foreignInput: 1e-15, paste: 0, copy: 0, sidebar: 0, tabaway: 0 } };
    const summaries = [
      summary('HIGHER', { totalSyntheticInsertions: 1, totalForeignInputEvents: 1 }),
      summary('LOWER', { totalSyntheticInsertions: 1 }),
    ];
    const triage = rankTriage(summaries, noEdges(2), config);
    assert.deepEqual(triage.map(t => t.participantId), ['HIGHER', 'LOWER']);
    await renderSummaryCSV(summaries, triage, config);
    const rows = readFileSync(join(outputDir, 'summary.csv'), 'utf8').trim().split('\n').slice(1);
    const scores = Object.fromEntries(rows.map(r => [r.split(',')[0], r.split(',')[2]]));
    assert.ok(Number(scores.HIGHER) > Number(scores.LOWER), JSON.stringify(scores));
    assert.equal(Number(scores.HIGHER), triage[0].score);
  });

  it('triage.md shows one decimal; summary.csv keeps the raw value', async () => {
    const config = { outputDir, scoreWeights: { synthetic: 0.1 } };
    const summaries = [summary('P1', { totalSyntheticInsertions: 3 })];
    const triage = rankTriage(summaries, noEdges(1), config);
    await renderTriage(triage, config);
    assert.match(readFileSync(join(outputDir, 'triage.md'), 'utf8'), /\| 1 \| P1 \| clean \| 0.3 \|/);
    await renderSummaryCSV(summaries, triage, config);
    const row = readFileSync(join(outputDir, 'summary.csv'), 'utf8').split('\n')[1];
    assert.equal(Number(row.split(',')[2]), triage[0].score);
  });

  it('the trajectories PNG header formats the score and keeps its "?" fallback', () => {
    const texts = [];
    const ctx = new Proxy({}, {
      get: (t, k) => k === 'fillText' ? (s => texts.push(s)) : k === 'measureText' ? () => ({ width: 10 }) : (k in t ? t[k] : () => {}),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    const createCanvas = (w, h) => ({ width: w, height: h, getContext: () => ctx, toBuffer: () => Buffer.from('') });
    const p = { participantId: 'P1', trials: [{ trialId: 't1', mouseMoves: [] }], session: {}, metadata: {} };
    drawTrajectoryGrid(p, { score: 0.1 * 3, reason: 'r' }, {}, createCanvas);
    assert.equal(texts[0], 'P1 — Score: 0.3 — r');
    texts.length = 0;
    drawTrajectoryGrid(p, undefined, {}, createCanvas);
    assert.equal(texts[0], 'P1 — Score: ? — ');
  });
});
