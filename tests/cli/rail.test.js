// tests/cli/rail.test.js
// The report's rail: the search and sort functions the page inlines
// (rail-client.js), the rail's markup (hard* badges, the rows' data, the tier
// and label blocks, the sorts), the annotation script pairing rows with
// panes when the rail is sorted, and the CLI report's Weights… dialog, which
// re-scores, re-tiers and re-sorts the rail in the page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { transformSync } from 'esbuild';
import { chSearchTokens, chRowMatches, chCompareRows, railFunctionsSrc } from '../../src/cli/renderers/rail-client.js';
import { inlineSrcHazards, inlineSafeSrc } from '../../src/shared/inline-safe.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { scoreFromCounts, reportTierFromCounts, formatScore } from '../../src/cli/analyzers/score-weights.js';
import { railData, weightsPanelScript, WEIGHTS_PANEL_CSS } from '../../src/cli/renderers/weights-panel.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { ANNOTATION_BUILDERS_JS, ANNOTATION_UI_JS } from '../../src/cli/renderers/annotation-client.js';
import { parseRules, lastProp } from './report-css-helpers.js';
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

  // The Weights… dialog's script (weights-panel.js) boots itself and talks
  // to the page through the 'ch:rescore' event: the block the page wraps it
  // in calls nothing of it, and the text, node's and the one the analyzer
  // bakes, ends with the call to the function it defines.
  it('the Weights… dialog\'s script: the page calls nothing in it; node\'s text and the analyzer\'s baked one boot themselves', async () => {
    const triage = rankTriage([{ participantId: 'P-1', trialCount: 1, hardTriggered: false, totalSoftScore: 0, softScoreThreshold: 6 }],
      [{ edgeExits: [] }], {});
    const html = await renderIndexHtml(triage.map((t) => t.summary), triage, [], {}, false, {});
    const src = inlineSafeSrc(weightsPanelScript());
    const at = html.indexOf(src);
    assert.ok(at > 0, 'the page inlines the dialog script');
    const block = html.slice(html.lastIndexOf('<script>', at), html.indexOf('</script>', at)).replace(src, '');
    assert.deepEqual([...block.matchAll(/\b(ch[A-Z]\w*)\s*\(/g)].map((m) => m[1]), [], 'calls outside the inlined text');
    const baked = inlineSources().weightsPanel;
    assert.equal(baked, weightsPanelScript(), 'the analyzer bakes node\'s text');
    for (const [what, text] of [['node\'s text', weightsPanelScript()], ['the analyzer\'s baked text', baked]]) {
      assert.match(text, /^function chBootWeightsDialog\(doc\) \{/m, what);
      assert.ok(text.endsWith('\nchBootWeightsDialog(document);\n'), what);
    }
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

  // (The Weights… dialog explains HARD* whatever the config: it is left out.)
  it('without a Hard at rule: no hard*, and nothing about it in the top bar', async () => {
    const { html } = await page({});
    const rest = html.replace(/<dialog id="weights-dialog"[\s\S]*?<\/dialog>/, '');
    assert.ok(rest.length < html.length, 'the dialog was cut');
    assert.doesNotMatch(rest, /HARD\*|hard at:/);
  });

  it('the sort opens on Score, with Tier, Pointer, Typing and ID', async () => {
    const { html } = await page({});
    const sel = html.match(/<select name="sort">([\s\S]*?)<\/select>/)[1];
    assert.deepEqual([...sel.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]), ['score', 'tier', 'cursor', 'typing', 'id']);
    assert.match(sel, /<option value="score" selected>/);
  });

  it('the label block only in a report with annotation controls, in the words of the pane\'s buttons', async () => {
    // The buttons, not the page script's own selector for them.
    const chip = /<button class="filter-chip[^"]*" aria-pressed="(?:true|false)" data-label-filter="([a-z]+)">([^<]*)<\/button>/g;
    assert.deepEqual([...(await page({})).html.matchAll(chip)], []);
    const { html } = await page({}, { runId: '0123456789abcdef' });
    assert.deepEqual([...html.matchAll(chip)].map((m) => [m[1], m[2]]),
      [['all', 'All'], ['none', 'Unmarked'], ['include', 'Include'], ['exclude', 'Exclude'], ['flag', 'Flag']]);
  });

  // A screen reader hears which filter is on: the active chip of each block
  // (All, as the page opens) is aria-pressed="true", every other "false".
  it('each block\'s active chip is pressed, and only it', async () => {
    const { html } = await page({}, { runId: '0123456789abcdef' });
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    win.document.write(html);
    const chips = (attr) => [...win.document.querySelectorAll(`.filter-chip[${attr}]`)]
      .map((c) => [c.getAttribute(attr), c.getAttribute('aria-pressed'), c.classList.contains('active')]);
    assert.deepEqual(chips('data-filter'), [['all', 'true', true], ['hard', 'false', false], ['soft', 'false', false], ['clean', 'false', false]]);
    assert.deepEqual(chips('data-label-filter'), [['all', 'true', true], ['none', 'false', false], ['include', 'false', false],
      ['exclude', 'false', false], ['flag', 'false', false]]);
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

  it('the CLI report has the Weights… button, the dialog with the panel at the report\'s values, and its script', async () => {
    const { html } = await page({ scoreWeights: { sidebar: 7 }, hardAt: { paste: 3 } });
    assert.match(html, /<button class="weights-btn" type="button" aria-haspopup="dialog" aria-controls="weights-dialog">Weights&hellip;<\/button>/);
    assert.match(html, /<dialog id="weights-dialog" aria-labelledby="weights-title">[\s\S]*?class="wp"/);
    assert.match(html, /chBootWeightsDialog\(document\);/);
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    win.document.write(html);
    assert.equal(win.document.querySelector('#weights-dialog [data-weight="sidebar"]').getAttribute('data-weight'), 'sidebar');
  });

  it('the in-page report (the analyzer) has none of it: its settings hold the panel', async () => {
    const { triage } = await page({});
    const html = await renderIndexHtml(SUMMARIES, triage, [], {}, false, { imageSources: {} });
    assert.doesNotMatch(html, /weights-btn|weights-dialog|chBootWeightsDialog/);
  });

  // With the Weights… button the CLI report's top bar holds two buttons:
  // one height (the Legend's ⓘ comes from a fallback face with a taller
  // line) and each label on one line. Below 1100 px the run line takes a row
  // of its own: under the title and the buttons on a tablet, between them on
  // a phone (720 px and under), where the buttons' padding and gap shrink so
  // both share a row. From 1100 px a sample run line with a Hard at rule
  // holds two lines beside "Weights… (edited)" in all three engines. The
  // in-page report keeps its one button's top bar as it was.
  it('the CLI report\'s top bar: two buttons of one height, labels on one line, the run line on its own row below 1100 px', async () => {
    const css = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    // The rules inside every block of one media query, in order.
    const media = (text, query) => [...text.matchAll(new RegExp(query.replace(/[()]/g, '\\$&') + ' \\{([\\s\\S]*?\\})\\s*\\}', 'g'))]
      .flatMap((m) => parseRules(m[1]));
    const { triage, html } = await page({});
    const cli = css(html);
    assert.deepEqual(['white-space', 'line-height'].map((p) => lastProp(parseRules(cli), '.topbar button', p)), ['nowrap', '24px']);
    const phone = media(cli, '@media (max-width: 720px)');
    assert.deepEqual([lastProp(phone, '.topbar .meta', 'flex-basis'), lastProp(phone, '.topbar', 'column-gap'),
      lastProp(phone, '.topbar button', 'padding')], ['100%', '8px', '6px 8px']);
    const tablet = media(cli, '@media (min-width: 721px) and (max-width: 1099px)');
    assert.deepEqual([lastProp(tablet, '.topbar', 'flex-wrap'), lastProp(tablet, '.topbar h1', 'flex'),
      lastProp(tablet, '.topbar .meta', 'order'), lastProp(tablet, '.topbar .meta', 'flex-basis')], ['wrap', '1 1 0', '1', '100%']);
    const inPage = css(await renderIndexHtml(SUMMARIES, triage, [], {}, false, { imageSources: {} }));
    assert.deepEqual(['white-space', 'line-height'].map((p) => lastProp(parseRules(inPage), '.topbar button', p)), [null, null]);
    assert.doesNotMatch(inPage, /\.topbar \.meta \{ (flex-basis|order)|max-width: 1099px|column-gap/);
  });

  // The dialog scrolls when its rows pass the window's height; its heading
  // row (the title and Close) sticks to the top of that scrolling area, on
  // the dialog's own background, so the rows scrolled under it do not show
  // through. The analyzer's settings panel has no dialog, and no such rule.
  it('the dialog\'s heading row sticks to the top of the dialog, on its background; the analyzer\'s panel is unchanged', async () => {
    const css = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    const { triage, html } = await page({});
    const rules = parseRules(css(html));
    assert.deepEqual(['position', 'top', 'background'].map((p) => lastProp(rules, '.wd-head', p)), ['sticky', '0', 'var(--surface)']);
    assert.equal(lastProp(rules, '#weights-dialog', 'background'), 'var(--surface)');
    const inPage = css(await renderIndexHtml(SUMMARIES, triage, [], {}, false, { imageSources: {} }));
    assert.doesNotMatch(inPage, /\.wd-head|position: sticky/);
    assert.doesNotMatch(WEIGHTS_PANEL_CSS, /\.wd-head|position: sticky/);
  });

  // The dialog changes the page only: its text says that the report's files
  // (and, with annotation controls, the annotation exports) keep the run's
  // weights, and it keeps Copy config (the analyzer's settings hide theirs:
  // they have Export config).
  it('the dialog says the files and the exports keep the run\'s weights, and offers Reset and Copy config', async () => {
    const lede = (html) => html.match(/<p class="wd-lede">([\s\S]*?)<\/p>/)[1];
    const withRun = (await page({}, { runId: '0123456789abcdef' })).html;
    assert.match(lede(withRun), /This report's files and its annotation exports keep the weights it was built with/);
    assert.match(lede(withRun), /<b>Copy config<\/b> gives the lines for cyborg-hunter\.config\.json/);
    assert.match(lede((await page({})).html), /This report's files keep the weights it was built with/);
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    win.document.write(withRun);
    assert.deepEqual([...win.document.querySelectorAll('#weights-dialog .wp-foot button')].map((b) => b.textContent),
      ['Reset to defaults', 'Copy config']);
  });

  // The dialog shows the panel's own words and nothing from the data: a
  // config key it does not know is dropped (with the CLI's warning), and an
  // id stays in the rail, escaped.
  it('the dialog and the top bar hold no markup from the config or the participants', async () => {
    const id = 'x"><img src=x onerror=alert(1)>';
    const sums = [summary(id, { totalSoftScore: 7, sidebarEventCount: 1 })];
    const config = { scoreWeights: { '<img src=x>': 2 }, hardAt: { '"><b>x</b>': 1, sidebar: 1 } };
    const triage = rankTriage(sums, [{ edgeExits: [] }], config);
    const html = await renderIndexHtml(sums, triage, [], config, false, { runId: 'r' });
    const dialogHtml = html.slice(html.indexOf('<dialog id="weights-dialog"'), html.indexOf('</dialog>'));
    const topbar = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('</header>'));
    assert.ok(dialogHtml.length > 0 && topbar.includes('hard at: sidebar 1'));
    for (const part of [dialogHtml, topbar]) assert.doesNotMatch(part, /<img|<b>x|onerror|x&quot;/);
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

// The Weights… dialog in the CLI report, with the page's own scripts run as
// a browser runs them, in page order: the main script (the rail, the panes
// and the 'ch:rescore' listener), the dialog's, and the annotation controls'
// with a run id. happy-dom applies no stylesheet rule to getComputedStyle,
// so every row reads as shown: these tests are about scores, tiers, order
// and the exports, not the filters.
describe('the Weights… dialog re-scores, re-tiers and re-sorts the rail', () => {
  const summary = (id, over) => ({ participantId: id, trialCount: 1, hardTriggered: false, totalSoftScore: 0, softScoreThreshold: 6,
    meanTypingSpeed: 0, meanMouseEvents: 0, meanPathEfficiency: 0, ...over });
  // Every tier: the library's hard, soft and clean, and hard* from a pointer
  // verdict level and from a tab-away count. The run's weights hold a cap, a
  // fractional weight (S-1 scores 4.5) and a weighted verdict.
  const SUMMARIES = [
    summary('H-1', { hardTriggered: true, totalPasteEvents: 2, totalCopyEvents: 4 }),
    summary('S-1', { totalSoftScore: 7, sidebarEventCount: 1, totalSyntheticInsertions: 3 }),
    summary('P-1', { cursorAnalysis: { level: 2, verdict: 'highly suspicious', tells: [] }, totalCopyEvents: 1 }),
    summary('T-1', { tabAwayMediumCount: 2, tabAwayLongCount: 1, sidebarEventCount: 2 }),
    summary('C-1', { zoomChangeCount: 4 }),
  ];
  const EDGE = SUMMARIES.map((s, i) => ({ edgeExits: i === 4 ? [{ edgeExitCount: 2 }] : [] }));
  const RUN = {
    scoreWeights: { copy: { weight: 2, max: 3 }, synthetic: 0.5, cursor: 4, edgeExits: 1 },
    hardAt: { cursor: 2, tabaway: 3 },
  };

  async function runPage(sums, edge, config, opts = {}) {
    const triage = rankTriage(sums, edge, config);
    const html = await renderIndexHtml(sums, triage, [], config, false, opts);
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    const doc = win.document;
    doc.write(html);
    const scripts = [...doc.querySelectorAll('script:not([type])')].map((s) => s.textContent);
    const blobs = [];
    class CaughtBlob { constructor(parts) { this.text = parts.join(''); blobs.push(this); } }
    const globals = {
      window: win, document: doc, location: win.location, history: win.history, getComputedStyle: (el) => win.getComputedStyle(el),
      navigator: {}, localStorage: { getItem: () => null, setItem: () => {} }, setTimeout: () => 0, clearTimeout,
      URL: { createObjectURL: () => 'about:blank', revokeObjectURL: () => {} }, Blob: CaughtBlob,
    };
    for (const mark of ['// Wires interactivity', 'chBootWeightsDialog(document);', 'ch-annot:']) {
      const src = scripts.find((s) => s.includes(mark));
      if (src) runInNewContext(src, globals);
    }
    let rescores = 0;
    doc.addEventListener('ch:rescore', () => { rescores++; });
    // A box in the dialog given a value, as typing it fires its input event.
    const edit = (sel, value) => {
      const box = doc.querySelector('#weights-dialog ' + sel);
      box.value = value;
      box.dispatchEvent(new win.Event('input', { bubbles: true }));
    };
    return { triage, html, win, doc, edit, blobs, rescores: () => rescores };
  }

  // What the rail and the panes show: each row (in the rail's order) with
  // its data and texts, each pane's score, pill and breakdown, and the tier
  // counts on the chips and in the totals.
  const shown = (doc) => ({
    rail: [...doc.querySelectorAll('.cohort-row')].map((r) => [r.dataset.pid, r.dataset.score, r.dataset.tier, r.dataset.reportTier,
      r.querySelector('.cohort-row-top .score').textContent, r.querySelector('.tier-badge').textContent, r.querySelector('.tier-badge').dataset.tier]),
    panes: [...doc.querySelectorAll('.participant')].map((p) => [p.id, p.querySelector('.score-big').textContent,
      p.querySelector('.tier-pill').textContent, p.querySelector('.tier-pill').dataset.tier,
      [...p.querySelectorAll('.score-term')].map((t) => [t.querySelector('.label').textContent, t.querySelector('.contrib').textContent,
        t.querySelector('.bar').style.width]),
      p.querySelector('.score-total').textContent]),
    counts: [...doc.querySelectorAll('.filter-chip[data-filter] .chip-n, .totals-row .count')].map((el) => el.textContent),
  });

  it('at the run\'s own values the dialog changes nothing on the page', async () => {
    const { doc, edit, rescores } = await runPage(SUMMARIES, EDGE, RUN);
    const before = shown(doc);
    assert.equal(doc.querySelector('#weights-dialog [data-hard="cursor"]').value, '2');
    edit('[data-hard="cursor"]', '2');
    assert.equal(rescores(), 1, 'the dialog re-scored');
    assert.deepEqual(shown(doc), before);
    // Not vacuous: the page holds a fractional score, hard*, a cap and terms.
    assert.ok(before.rail.some((r) => r[4] === '4.5') && before.rail.some((r) => r[5] === 'HARD*'));
  });

  // After an edit, each row's score and report tier are scoreFromCounts and
  // reportTierFromCounts over its counts at the dialog's values, which are
  // what a CLI run ranks (rankTriage) with the lines the dialog's Copy config
  // gives (here the clipboard is refused, so they are read from the box it
  // fills); the rail is sorted by score again and the counts follow.
  it('after an edit the rail\'s scores and tiers are the functions\' at the new values, sorted, and counted', async () => {
    const { triage, doc, edit } = await runPage(SUMMARIES, EDGE, RUN);
    edit('[data-weight="sidebar"]', '20');
    edit('[data-hard="sidebar"]', '1');
    const data = railData(triage, RUN);
    const weights = data.signals.map((s) => (s.key === 'sidebar' ? { weight: 20, max: null } : { weight: s.weight, max: s.max }));
    const hardAt = data.signals.map((s) => (s.key === 'sidebar' ? 1 : s.hardAt));
    doc.querySelector('#weights-dialog [data-action="weights-copy"]').click();
    const copied = JSON.parse(doc.querySelector('#weights-dialog .wp-config').textContent);
    assert.deepEqual(copied.hardAt, { ...RUN.hardAt, sidebar: 1 }, 'the copied lines hold the edit');
    const next = rankTriage(SUMMARIES, EDGE, copied);
    const panes = [...doc.querySelectorAll('.participant')];
    for (const row of doc.querySelectorAll('.cohort-row')) {
      const i = +row.dataset.index;
      const score = scoreFromCounts(data.rows[i].counts, weights);
      const tier = reportTierFromCounts(data.rows[i].lib, data.rows[i].counts, hardAt);
      const cli = next.find((t) => t.participantId === row.dataset.pid);
      assert.deepEqual([score, tier], [cli.score, cli.reportTier], row.dataset.pid + ': the functions and the CLI agree');
      const text = String(formatScore(score));
      const word = tier === 'clean' ? 'clean' : tier.toUpperCase();
      assert.deepEqual([row.dataset.score, row.dataset.reportTier, row.dataset.tier, row.querySelector('.score').textContent,
        row.querySelector('.tier-badge').textContent], [String(score), tier, tier === 'hard*' ? 'hard' : tier, text, word], row.dataset.pid);
      assert.deepEqual([panes[i].querySelector('.score-big').textContent, panes[i].querySelector('.tier-pill').textContent,
        panes[i].querySelector('.score-total').textContent], [text, word, 'Total: ' + text], row.dataset.pid + ': its pane');
    }
    assert.deepEqual(shown(doc).rail.map((r) => [r[0], r[4], r[5]]),
      [['T-1', '43', 'HARD*'], ['S-1', '21.5', 'HARD*'], ['H-1', '16', 'HARD'], ['P-1', '10', 'HARD*'], ['C-1', '2', 'clean']]);
    assert.deepEqual(shown(doc).counts, ['5', '4', '0', '1', '4', '0', '1']);
    assert.deepEqual(shown(doc).panes.find((p) => p[0] === 'p-S-1')[4],
      [['sidebar', '+20', '93px'], ['synthetic', '+1.5', '7px']]);
  });

  // A damaged file can make a count infinite (a keyboardShortcuts list whose
  // length reads as 1e400). Weighted, the files' score is Infinity at any
  // weight, and NaN where an infinite and a minus-infinite count meet:
  // summary.csv writes the number as is and triage.md through formatScore.
  // The page must print the same, at a weight under 1 too.
  it('a score a damaged file makes infinite, or not a number, reads as the files print it', async () => {
    const sums = [summary('K-1', { keyboardShortcutCount: Infinity }),
      summary('N-1', { keyboardShortcutCount: Infinity, layoutShiftCount: -Infinity }), summary('C-1', { totalCopyEvents: 1 })];
    const edge = sums.map(() => ({ edgeExits: [] }));
    const { doc, edit } = await runPage(sums, edge, {});
    edit('[data-weight="kbShortcuts"]', '0.5');
    edit('[data-weight="viewportShifts"]', '0.5');
    const files = rankTriage(sums, edge, { scoreWeights: { kbShortcuts: 0.5, viewportShifts: 0.5 } });
    const text = (pid) => doc.querySelector(`.cohort-row[data-pid="${pid}"] .score`).textContent;
    assert.deepEqual(files.map((t) => [t.participantId, String(t.score), String(formatScore(t.score))]).sort(),
      [['C-1', '5', '5'], ['K-1', 'Infinity', 'Infinity'], ['N-1', 'NaN', 'NaN']]);
    for (const t of files) assert.equal(text(t.participantId), String(formatScore(t.score)), t.participantId);
    const k = shown(doc).panes.find((p) => p[0] === 'p-K-1');
    assert.deepEqual([k[1], k[4].map((t) => t.slice(0, 2)), k[5]], ['Infinity', [['kbShortcuts', '+Infinity']], 'Total: Infinity']);
  });

  // The exports keep the run's values: the dialog changes the page only,
  // like the report's files. The annotations CSV writes each participant's
  // tier and score as the run gave them, in triage order, whatever the rail
  // shows; the JSON export holds no tier or score at all.
  it('after a change in the dialog the annotation exports keep the run\'s tier and score; the rail shows the new ones', async () => {
    const { triage, doc, edit, blobs } = await runPage(SUMMARIES, EDGE, RUN, { runId: 'run-1' });
    edit('[data-weight="sidebar"]', '20');
    edit('[data-hard="sidebar"]', '1');
    const row = doc.querySelector('.cohort-row[data-pid="S-1"]');
    assert.deepEqual([row.querySelector('.score').textContent, row.querySelector('.tier-badge').textContent], ['21.5', 'HARD*']);
    assert.deepEqual([row.dataset.runTier, row.dataset.runScore], ['soft', '4.5'], 'the row keeps the run\'s values beside');
    const button = (text) => [...doc.querySelectorAll('.annot-bar button')].find((b) => b.textContent === text);
    button('Export CSV').click();
    const lines = blobs[0].text.trim().split('\n').slice(1).map((l) => l.split(',').slice(0, 3));
    assert.deepEqual(lines, triage.map((t) => [t.participantId, t.reportTier, String(t.score)]));
    assert.ok(lines.some(([id, tier, score]) => id === 'S-1' && tier === 'soft' && score === '4.5'));
    button('Export JSON').click();
    assert.deepEqual(Object.keys(JSON.parse(blobs[1].text)), ['format', 'runId', 'exportedAt', 'annotations']);
  });

  // Close closes the dialog whatever its boxes hold. The panel reads a box
  // more leniently than the browser's own checks of its min and step (a cap
  // of 2.5 is 2, Hard at 0 is none, points under 0 are the default), and
  // those checks run when a form is submitted: so nothing in the dialog
  // submits. Enter in a box does nothing, and the values it holds stay
  // applied. Focus goes back to the Weights… button (WebKit leaves it on the
  // closed dialog otherwise).
  it('Close closes the dialog whatever a box holds; Enter leaves it open with the values applied; focus returns to the button', async () => {
    const { win, doc, edit } = await runPage(SUMMARIES, EDGE, RUN);
    const dialogEl = doc.getElementById('weights-dialog');
    assert.equal(dialogEl.querySelectorAll('form, button[type="submit"], button:not([type]), input[type="submit"]').length, 0,
      'nothing in the dialog submits');
    const opener = doc.querySelector('.weights-btn');
    opener.click();
    assert.ok(dialogEl.open, 'the button opens it');
    edit('[data-max="copy"]', '2.5');
    edit('[data-hard="sidebar"]', '0');
    edit('[data-weight="paste"]', '-1');
    const box = dialogEl.querySelector('[data-max="copy"]');
    box.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.ok(dialogEl.open, 'Enter leaves it open');
    // H-1: 2 pastes at the default 5, and 4 copies capped at 2, at 2 points.
    assert.equal(doc.querySelector('.cohort-row[data-pid="H-1"] .score').textContent, '14');
    dialogEl.querySelector('.wd-close').click();
    assert.equal(dialogEl.open, false, 'Close closes it');
    // (A boolean: a failing equal on two elements prints both whole.)
    assert.ok(doc.activeElement === opener, 'focus is back on the button');
    assert.equal(doc.querySelector('.cohort-row[data-pid="H-1"] .score').textContent, '14', 'the values stay applied');
  });

  // While the dialog's values differ from the run's, the button says so. The
  // values are compared as the re-score reads them (a box's number, not its
  // text), not by whether a box was touched; a cap counts even on a signal
  // at 0 points, since Copy config writes it.
  it('the Weights… button reads "Weights… (edited)" while the dialog\'s values differ from the run\'s', async () => {
    const { doc, edit } = await runPage(SUMMARIES, EDGE, RUN);
    const label = () => doc.querySelector('.weights-btn').textContent;
    assert.equal(label(), 'Weights…', 'on load');
    edit('[data-weight="sidebar"]', '20');
    assert.equal(label(), 'Weights… (edited)');
    edit('[data-weight="sidebar"]', '3');
    assert.equal(label(), 'Weights…', 'the run\'s value again');
    edit('[data-hard="cursor"]', '');
    assert.equal(label(), 'Weights… (edited)', 'the run\'s Hard at rule cleared');
    edit('[data-hard="cursor"]', '2.0');
    edit('[data-max="copy"]', '3.0');
    assert.equal(label(), 'Weights…', 'the same numbers, written otherwise');
    edit('[data-max="zoom"]', '2');
    assert.equal(label(), 'Weights… (edited)', 'a cap on a signal at 0 points');
    edit('[data-max="zoom"]', '');
    assert.equal(label(), 'Weights…');
    doc.querySelector('#weights-dialog [data-action="weights-reset"]').click();
    assert.equal(label(), 'Weights… (edited)', 'the defaults are not this run\'s values');
  });

  it('after Reset to defaults the mark goes when the run used the defaults', async () => {
    const { doc, edit } = await runPage(SUMMARIES, EDGE, {});
    const label = () => doc.querySelector('.weights-btn').textContent;
    edit('[data-weight="paste"]', '6');
    edit('[data-hard="paste"]', '2');
    assert.equal(label(), 'Weights… (edited)');
    doc.querySelector('#weights-dialog [data-action="weights-reset"]').click();
    assert.equal(label(), 'Weights…');
  });

  // The dialog is modal: while it is open the keys belong to it. With the
  // focus on one of its buttons, the arrows do not walk the rail behind it
  // and i, e and f do not label the selected participant.
  it('while the dialog is open the rail\'s arrow keys and the label keys leave the report alone', async () => {
    const { win, doc } = await runPage(SUMMARIES, EDGE, RUN, { runId: 'run-1' });
    const dialogEl = doc.getElementById('weights-dialog');
    const reset = dialogEl.querySelector('[data-action="weights-reset"]');
    const key = (k) => reset.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
    const selected = () => doc.querySelector('.cohort-row.selected');
    const first = selected().dataset.pid;
    doc.querySelector('.weights-btn').click();
    assert.ok(dialogEl.hasAttribute('open'), 'the button opens the dialog');
    key('ArrowDown');
    key('e');
    assert.equal(selected().dataset.pid, first, 'the selection stays');
    assert.equal(selected().querySelector('.annot-mark').dataset.label, '', 'no label');
    // Closed again, the same keys act on the report.
    dialogEl.removeAttribute('open');
    key('e');
    assert.equal(selected().querySelector('.annot-mark').dataset.label, 'exclude');
    key('ArrowDown');
    assert.notEqual(selected().dataset.pid, first);
  });
});
