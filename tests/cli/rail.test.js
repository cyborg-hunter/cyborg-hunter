// tests/cli/rail.test.js
// The report's rail: the search and sort functions the page inlines
// (rail-client.js), the rail's markup (hard* badges, the rows' data, the tier
// and label blocks, the sorts), and the annotation script pairing rows with
// panes when the rail is sorted.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { transformSync } from 'esbuild';
import { chSearchTokens, chRowMatches, chCompareRows, railFunctionsSrc } from '../../src/cli/renderers/rail-client.js';
import { inlineSrcHazards, inlineSafeSrc } from '../../src/shared/inline-safe.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { ANNOTATION_BUILDERS_JS, ANNOTATION_UI_JS } from '../../src/cli/renderers/annotation-client.js';
import { inlineSources } from '../../tools/build-analyze.mjs';

describe('search', () => {
  const row = (id, reason, words) => ({ id, reason, words });
  const ROWS = [
    row('demo-9mop', '4 paste events; 4 copy events', ['paste', 'copy', 'cut', 'tab', 'tab-away', 'tabaway', 'away']),
    row('demo-681w', '1 paste events; 1 sidebar event', ['paste', 'copy', 'cut', 'sidebar', 'side', 'panel']),
    row('demo-a3f3', 'merlin detected; 1 zoom changes', ['zoom', 'sidebar', 'side', 'panel']),
  ];
  const hits = (q) => ROWS.filter((r) => chRowMatches(chSearchTokens(q), r)).map((r) => r.id);

  it('every word must match; a word matches the start of a word of a signal the participant has', () => {
    assert.deepEqual(hits('copy sidebar'), ['demo-681w']);
    assert.deepEqual(hits('side'), ['demo-681w', 'demo-a3f3']);
    assert.deepEqual(hits('drop'), []);
  });

  it('an id matches anywhere in it; case and extra spaces do not matter; an empty search matches all', () => {
    assert.deepEqual(hits('  A3F  '), ['demo-a3f3']);
    assert.deepEqual(hits(''), ['demo-9mop', 'demo-681w', 'demo-a3f3']);
  });

  it('the triage reason still matches, for what has no signal word (an extension\'s name)', () => {
    assert.deepEqual(hits('merlin'), ['demo-a3f3']);
  });
});

describe('sort', () => {
  const R = [
    { index: 0, id: 'H', tier: 'hard', score: 10, cursor: -1, typing: 2 },
    { index: 1, id: 'S', tier: 'soft', score: 30, cursor: 1, typing: -1 },
    { index: 2, id: 'C', tier: 'clean', score: 30, cursor: 2, typing: 0 },
    { index: 3, id: 'A', tier: 'hard', score: 5, cursor: 0, typing: 1 },
  ];
  const order = (key) => R.slice().sort(chCompareRows(key)).map((r) => r.id);
  it('score (the default): high to low, ties in triage order', () => assert.deepEqual(order('score'), ['S', 'C', 'H', 'A']));
  it('tier, then score', () => assert.deepEqual(order('tier'), ['H', 'A', 'S', 'C']));
  it('the pointer and typing verdicts: level high to low, not assessed last, then score', () => {
    assert.deepEqual(order('cursor'), ['C', 'S', 'A', 'H']);
    assert.deepEqual(order('typing'), ['H', 'A', 'C', 'S']);
  });
  it('id', () => assert.deepEqual(order('id'), ['A', 'C', 'H', 'S']));
  it('the inlined source holds no hazard and runs alone', () => {
    const src = railFunctionsSrc();
    assert.deepEqual(inlineSrcHazards(src), []);
    const copy = runInNewContext(src + '\n;({ chSearchTokens, chRowMatches, chCompareRows })');
    // Spread: the array comes from the other context, with its prototypes.
    assert.deepEqual([...copy.chSearchTokens(' Copy  Side ')], ['copy', 'side']);
  });
});

describe('the inlined source', () => {
  // railFunctionsSrc checks its own text, as timelineScript does, so a hazard
  // typed into an inlined function fails the report's build, not only this
  // test. A function's text is what String gives it: the test gives one
  // function its own toString, then takes it away.
  it('refuses to build when an inlined function holds a hazard', () => {
    for (const hazard of ['/* <!-- */', 'var s = "<script>";']) {
      chRowMatches.toString = () => 'function chRowMatches(tokens, row) { ' + hazard + ' return true; }';
      try {
        assert.throws(() => railFunctionsSrc(), /cannot be inlined/, hazard);
      } finally {
        delete chRowMatches.toString;
      }
    }
    assert.deepEqual(inlineSrcHazards(railFunctionsSrc()), [], 'the functions\' own text again');
  });

  // Lowering ES5 code to ES5 changes nothing: an arrow, a template literal,
  // a spread, `?.` or `??` would be rewritten, and let, const, class or a
  // default argument refused. A trailing comma before a closing parenthesis
  // (ES2017) prints the same either way, so it is looked for in the text.
  it('is ES5', () => {
    const src = railFunctionsSrc();
    assert.equal(transformSync(src, { target: 'es5' }).code,
      transformSync(src, { target: 'esnext', supported: { 'object-extensions': false } }).code);
    assert.doesNotMatch(src, /,\s*\)/, 'a trailing comma in a call or a parameter list');
  });

  // The page's script calls the inlined functions by the names written in
  // their text: the analyzer bakes node's text (tools/build-analyze.mjs) and
  // its bundle may rename the functions, so a name taken from the bundle's
  // function would call nothing. Every ch… name the page's main script calls
  // is defined in node's text and in the analyzer's baked one.
  it('every function the page calls into it is defined in node\'s text and in the analyzer\'s', async () => {
    const triage = rankTriage([{ participantId: 'P-1', trialCount: 1, hardTriggered: false, totalSoftScore: 0, softScoreThreshold: 6 }],
      [{ edgeExits: [] }], {});
    const html = await renderIndexHtml(triage.map((t) => t.summary), triage, [], {}, false, {});
    const main = html.slice(html.indexOf('// Wires interactivity'));
    const body = main.slice(0, main.indexOf('</script>'));
    assert.ok(body.includes(inlineSafeSrc(railFunctionsSrc())), 'the main script inlines the rail functions');
    const script = body.replace(inlineSafeSrc(railFunctionsSrc()), '');
    const called = [...new Set([...script.matchAll(/\b(ch[A-Z]\w*)\s*\(/g)].map((m) => m[1]))].sort();
    assert.deepEqual(called, ['chCompareRows', 'chRowMatches', 'chSearchTokens']);
    const baked = inlineSources().rail;
    for (const name of called) {
      const defined = new RegExp('^function ' + name + '\\(', 'm');
      assert.match(railFunctionsSrc(), defined, name + ': node\'s text');
      assert.match(baked, defined, name + ': the analyzer\'s baked text');
    }
    // And the template names them itself, never by a function's .name.
    const template = readFileSync(new URL('../../src/cli/renderers/html-index-core.js', import.meta.url), 'utf8');
    assert.doesNotMatch(template, /\$\{ch[A-Z]\w*\.name\}/);
  });
});

describe('the rail markup', () => {
  // Summaries with what the page reads (the rail and an empty pane): one the
  // library hard-flagged, one soft with a sidebar and a typing verdict, one
  // clean with two sidebars. (If a section added later throws on these, give
  // the summary the field it reads.)
  const summary = (id, over) => ({ participantId: id, trialCount: 1, hardTriggered: false, totalSoftScore: 0, softScoreThreshold: 6,
    meanTypingSpeed: 0, meanMouseEvents: 0, meanPathEfficiency: 0, ...over });
  const SUMMARIES = [
    summary('H-1', { hardTriggered: true, totalPasteEvents: 2 }),
    summary('S-1', { totalSoftScore: 7, sidebarEventCount: 1, typingAnalysis: { level: 2, verdict: 'highly suspicious', tells: [] } }),
    summary('C-1', { sidebarEventCount: 2 }),
  ];
  const EDGE = SUMMARIES.map(() => ({ edgeExits: [] }));
  const page = async (config, opts = {}) => {
    const triage = rankTriage(SUMMARIES, EDGE, config);
    return { triage, html: await renderIndexHtml(SUMMARIES, triage, [], config, false, opts) };
  };
  const rowAttrs = (html, pid) => {
    const m = html.match(new RegExp(`<div class="cohort-row" data-pid="${pid}"([^>]*)>`));
    return Object.fromEntries([...m[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
  };

  it('each row carries its triage index, its report tier and its typing level', async () => {
    const { triage, html } = await page({});
    triage.forEach((t, i) => assert.equal(rowAttrs(html, t.participantId).index, String(i)));
    assert.equal(rowAttrs(html, 'S-1').typing, '2');
    assert.equal(rowAttrs(html, 'C-1').typing, '-1');
    assert.equal(rowAttrs(html, 'C-1')['report-tier'], 'clean');
  });

  it('hard* rows: in the hard tier for the filter and the counts, badged HARD*, named in the top bar', async () => {
    const { html } = await page({ hardAt: { sidebar: 2 } });
    assert.deepEqual([rowAttrs(html, 'C-1').tier, rowAttrs(html, 'C-1')['report-tier']], ['hard', 'hard*']);
    assert.match(html, /data-pid="C-1"[\s\S]*?<span class="tier-badge" data-tier="hard">HARD\*<\/span>/);
    assert.match(html, /data-filter="hard">Hard <span class="chip-n">2<\/span>/);
    assert.match(html, /<span class="tier-pill" data-tier="hard">HARD\*<\/span>/);
    assert.match(html, /hard at: sidebar 2/);
  });

  it('the cohort totals count hard* with hard', async () => {
    const counts = (html) => ['hard', 'soft', 'clean'].map((tier) =>
      html.match(new RegExp(`<div class="totals-row" data-tier="${tier}">.*?<span class="mono count">(\\d+)</span>`))[1]);
    assert.deepEqual(counts((await page({})).html), ['1', '1', '1']);
    assert.deepEqual(counts((await page({ hardAt: { sidebar: 2 } })).html), ['2', '1', '0']);
  });

  it('without a Hard at rule: no hard*, and nothing about it in the top bar', async () => {
    const { html } = await page({});
    assert.doesNotMatch(html, /HARD\*|hard at:/);
  });

  it('the sort opens on Score, with Tier, Pointer, Typing and ID', async () => {
    const { html } = await page({});
    const sel = html.match(/<select name="sort">([\s\S]*?)<\/select>/)[1];
    assert.deepEqual([...sel.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]), ['score', 'tier', 'cursor', 'typing', 'id']);
    assert.match(sel, /<option value="score" selected>/);
  });

  it('the label block only in a report with annotation controls', async () => {
    // The buttons, not the page script's own selector for them.
    const chip = /<button class="filter-chip[^"]*" data-label-filter="([a-z]+)"/g;
    assert.deepEqual([...(await page({})).html.matchAll(chip)], []);
    const { html } = await page({}, { runId: '0123456789abcdef' });
    assert.deepEqual([...html.matchAll(chip)].map((m) => m[1]), ['all', 'none', 'include', 'exclude', 'flag']);
  });

  it('the rail data: one row per triage row, in triage order', async () => {
    const { triage, html } = await page({});
    const data = JSON.parse(html.match(/<script type="application\/json" id="ch-rail-data">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.rows.length, triage.length);
    assert.deepEqual(data.rows.map((r) => r.lib), ['hard', 'soft', 'clean']);
  });

  it('an id and a reason that hold markup reach the rail escaped', async () => {
    const id = 'x"><img src=x onerror=alert(1)>';
    const sums = [summary(id, { totalSoftScore: 7, sidebarEventCount: 1 })];
    const triage = rankTriage(sums, [{ edgeExits: [] }], {}).map((t) => ({ ...t, reason: '</script><b>pasted</b>' }));
    const html = await renderIndexHtml(sums, triage, [], {}, false, {});
    const rail = html.slice(html.indexOf('<aside class="rail">'), html.indexOf('</aside>'));
    assert.ok(rail.includes('data-pid="x&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
    assert.ok(rail.includes('data-reason="&lt;/script&gt;&lt;b&gt;pasted&lt;/b&gt;"'));
    assert.doesNotMatch(rail, /<img|<b>|<\/script/);
  });
});

describe('annotations on a sorted rail', () => {
  it('the annotation script pairs each pane with its row by data-index, whatever order the rail shows', async () => {
    const config = { outputDir: '.', participantIdField: 'participantId' };
    const raw = JSON.parse(readFileSync(new URL('../fixtures/demo/DEMO-FIXT.json', import.meta.url), 'utf8'));
    const ps = [extractIntegrityData(raw, config), extractIntegrityData({ ...raw, participantId: 'DEMO-FIXT-2' }, config)];
    const summaries = computeSummary(ps, config);
    const triage = rankTriage(summaries, detectEdgeExits(ps, config), config);
    const html = await renderIndexHtml(summaries, triage, ps, config, false, { runId: 'run-1' });
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    const doc = win.document;
    doc.write(html);
    const list = doc.querySelector('.rail-list');
    [...list.querySelectorAll('.cohort-row')].reverse().forEach((r) => list.appendChild(r));
    const items = new Map();
    const storage = { getItem: (k) => (items.has(k) ? items.get(k) : null), setItem: (k, v) => items.set(k, v) };
    let changed = 0;
    doc.addEventListener('ch:annotations', () => { changed++; });
    runInNewContext('(function (cfg) {' + ANNOTATION_BUILDERS_JS + ANNOTATION_UI_JS + '})(cfg);',
      { cfg: { runId: 'run-1', parent: false }, window: win, document: doc, localStorage: storage, setTimeout, clearTimeout, URL, Blob });
    doc.querySelectorAll('.participant')[0].querySelector('.annot-btn[data-label="exclude"]').click();
    const first = triage[0].participantId;
    assert.equal(doc.querySelector(`.cohort-row[data-pid="${first}"] .annot-mark`).dataset.label, 'exclude');
    assert.ok(changed >= 2, 'one event on load, one on the change');
  });

  // The CSV export, with the rail shown in another order: triage order, and
  // the report's tier (hard* for the row a Hard at rule moved). The download
  // is caught at its Blob.
  it('the CSV export keeps triage order and writes the report\'s tier, hard* included', async () => {
    const summary = (id, over) => ({ participantId: id, trialCount: 1, hardTriggered: false, totalSoftScore: 0, softScoreThreshold: 6,
      meanTypingSpeed: 0, meanMouseEvents: 0, meanPathEfficiency: 0, ...over });
    const sums = [summary('H-1', { hardTriggered: true, totalPasteEvents: 2 }), summary('S-1', { totalSoftScore: 7, sidebarEventCount: 1 }),
      summary('C-1', { sidebarEventCount: 2 })];
    const config = { hardAt: { sidebar: 2 } };
    const triage = rankTriage(sums, sums.map(() => ({ edgeExits: [] })), config);
    const html = await renderIndexHtml(sums, triage, [], config, false, { runId: 'run-1' });
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    const doc = win.document;
    doc.write(html);
    const list = doc.querySelector('.rail-list');
    [...list.querySelectorAll('.cohort-row')].reverse().forEach((r) => list.appendChild(r));
    const blobs = [];
    class CaughtBlob { constructor(parts) { this.text = parts.join(''); blobs.push(this); } }
    const url = { createObjectURL: () => 'about:blank', revokeObjectURL: () => {} };
    runInNewContext('(function (cfg) {' + ANNOTATION_BUILDERS_JS + ANNOTATION_UI_JS + '})(cfg);',
      { cfg: { runId: 'run-1', parent: false }, window: win, document: doc, localStorage: { getItem: () => null, setItem: () => {} },
        setTimeout: () => 0, clearTimeout, URL: url, Blob: CaughtBlob });
    [...doc.querySelectorAll('.annot-bar button')].find((b) => b.textContent === 'Export CSV').click();
    const lines = blobs[0].text.trim().split('\n').slice(1).map((l) => l.split(',').slice(0, 3));
    assert.deepEqual(lines, [['H-1', 'hard', '10'], ['C-1', 'hard*', '6'], ['S-1', 'soft', '3']]);
  });
});
