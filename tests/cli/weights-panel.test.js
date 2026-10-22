// tests/cli/weights-panel.test.js
// The score-weights panel (weights-panel.js): every report-score signal has a
// row in a group, with search words; the config it copies; the rail data the
// report embeds; and its behaviour, run from the source text the report
// inlines, in happy-dom.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { transformSync } from 'esbuild';
import {
  SCORE_SIGNALS, SIGNAL_LABELS, resolveScoreWeights, resolveHardAt, scoreFromCounts, reportTierFromCounts,
} from '../../src/cli/analyzers/score-weights.js';
import { readFileSync } from 'node:fs';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { buildSummaryCsv } from '../../src/cli/renderers/summary-csv-core.js';
import {
  WEIGHT_GROUPS, OTHER_GROUP, panelSignals, weightsPanelHtml, WEIGHTS_PANEL_CSS, weightsConfig, wireWeightsPanel, chBootWeightsDialog,
  weightsPanelScript, railData,
} from '../../src/cli/renderers/weights-panel.js';
import { inlineSrcHazards } from '../../src/shared/inline-safe.js';
import { parseRules, lastProp } from './report-css-helpers.js';

const dom = (html) => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  win.document.body.innerHTML = html;
  return win;
};

// Script text with every comment blanked and every string literal emptied,
// so what is left is code. (The inlined text holds no regular expression
// literal, which this would misread.)
const blankStringsAndComments = (src) =>
  src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (m) => (m[0] === '/' ? ' ' : '""'));

// The shorthand properties in code: an object literal is a brace that opens
// where an expression starts (after ( , = : ? [ or return), and each of its
// own entries must be more than a bare name.
function shorthandProps(code) {
  const found = [];
  const check = (entry) => { if (/^[A-Za-z_$][\w$]*$/.test(entry.trim())) found.push(entry.trim()); };
  const opens = /(?:[(,=:?[]|\breturn)\s*\{/g;
  for (let m; (m = opens.exec(code));) {
    let depth = 0;
    let entry = '';
    for (let i = m.index + m[0].length; i < code.length; i++) {
      const c = code[i];
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      if (depth === 0 && c === ',') { check(entry); entry = ''; } else entry += c;
    }
    check(entry);
  }
  return found;
}

describe('the rows', () => {
  it('every report-score signal has a group row with a name, a hint and lower-case search words', () => {
    const placed = new Set(WEIGHT_GROUPS.flatMap((g) => g.rows.map((r) => r.key)));
    for (const sig of SCORE_SIGNALS) assert.ok(placed.has(sig.key), `${sig.key} has a group row`);
    for (const s of panelSignals()) {
      assert.ok(s.name && s.hint && s.words.length, s.key);
      assert.ok(s.words.every((w) => w === w.toLowerCase() && !/\s/.test(w)), s.key);
      assert.notEqual(s.group, OTHER_GROUP, s.key);
    }
  });

  it('panelSignals: SCORE_SIGNALS order, each default, and the given weights, caps and hard-at counts', () => {
    const s = panelSignals(resolveScoreWeights({ copy: { weight: 2, max: 3 } }).weights, resolveHardAt({ sidebar: 1 }).hardAt);
    assert.deepEqual(s.map((x) => x.key), SCORE_SIGNALS.map((x) => x.key));
    const copy = s.find((x) => x.key === 'copy');
    const sidebar = s.find((x) => x.key === 'sidebar');
    assert.deepEqual([copy.def, copy.weight, copy.max, copy.hardAt], [5, 2, 3, null]);
    assert.deepEqual([sidebar.def, sidebar.weight, sidebar.max, sidebar.hardAt], [3, 3, null, 1]);
    assert.equal(s.find((x) => x.key === 'cursor').label, 'pointer verdict (cursor)');
  });

  it('the HTML: the groups in order, one row per signal with a 0-20 slider, a number box, a cap and Hard at', () => {
    const d = dom(weightsPanelHtml(panelSignals())).document;
    assert.deepEqual([...d.querySelectorAll('.wp-group-name')].map((e) => e.textContent),
      ['Clipboard and text', 'Leaving the page', 'Typing', 'Pointer', 'Browser and device']);
    assert.deepEqual([...d.querySelectorAll('.wp-colhead span')].map((e) => e.textContent), ['Signal', 'Points per event', 'Points', 'Cap', 'Hard at']);
    for (const sig of SCORE_SIGNALS) {
      const slider = d.querySelector(`[data-slider="${sig.key}"]`);
      assert.deepEqual([slider.getAttribute('min'), slider.getAttribute('max'), slider.getAttribute('step')], ['0', '20', '1'], sig.key);
      for (const attr of ['data-weight', 'data-max', 'data-hard']) assert.ok(d.querySelector(`[${attr}="${sig.key}"]`), `${attr} ${sig.key}`);
    }
  });

  // Not SCORE_SIGNALS order (sidebar before tabaway, edgeExits before
  // cursor): the tab-away rows read together, the pointer verdict first.
  it('each group shows its rows in the group\'s own order', () => {
    const d = dom(weightsPanelHtml(panelSignals())).document;
    assert.deepEqual([...d.querySelectorAll('.wp-group')].map((g) => [...g.querySelectorAll('[data-slider]')].map((e) => e.getAttribute('data-slider'))),
      WEIGHT_GROUPS.map((g) => g.rows.map((r) => r.key)));
  });

  // A hint that pointed at a row by place ("the row above") would turn false
  // when the rows move; the two tab-away splits name the row they add to.
  it('the tab-away hints name the row they count on top of; no hint points at a row by place', () => {
    const s = panelSignals();
    const over = s.find((x) => x.key === 'tabaway').name;
    for (const key of ['tabawayLong', 'tabawayMedium']) assert.ok(s.find((x) => x.key === key).hint.endsWith('on top of ' + over), key);
    for (const x of s) assert.doesNotMatch(x.hint, /row above|first row/, x.key);
  });

  // A no-break space keeps each verdict level's number on the line of its
  // word when the hint wraps ("suspicious 1," never ends a line at the word).
  it('the verdict hints keep each level with its number', () => {
    for (const key of ['cursor', 'typingRhythm']) {
      assert.equal(panelSignals().find((x) => x.key === key).hint, 'Points × level: suspicious 1, highly suspicious 2', key);
    }
  });

  // The column heads label the boxes; the stacked layout hides them, so
  // there each box shows a caption of its own, the same word as its column
  // head, so a box has one name at every width. The screen-reader labels are
  // the inputs' own, so the captions are hidden from them.
  it('each box carries its column head\'s word as a caption (Points, Cap, Hard at), beside its own screen-reader label', () => {
    const d = dom(weightsPanelHtml(panelSignals())).document;
    const heads = [...d.querySelectorAll('.wp-colhead span')].slice(-3).map((e) => e.textContent);
    assert.deepEqual(heads, ['Points', 'Cap', 'Hard at']);
    for (const sig of SCORE_SIGNALS) {
      const boxes = [...d.querySelector(`[data-slider="${sig.key}"]`).closest('.wp-row').querySelectorAll('.wp-box')];
      assert.deepEqual(boxes.map((b) => b.querySelector('.wp-cap').textContent), heads, sig.key);
      assert.deepEqual(boxes.map((b) => ['data-weight', 'data-max', 'data-hard'].find((a) => b.querySelector('input').hasAttribute(a))),
        ['data-weight', 'data-max', 'data-hard'], sig.key);
      for (const b of boxes) {
        assert.equal(b.querySelector('.wp-cap').getAttribute('aria-hidden'), 'true', sig.key);
        assert.ok(b.querySelector('input').getAttribute('aria-label'), sig.key);
      }
    }
  });

  it('the captions show only in the stacked layout (560 px or narrower), where the column heads are hidden', () => {
    const [wide, narrow] = WEIGHTS_PANEL_CSS.split('@media (max-width: 560px)');
    assert.ok(narrow, 'the stacked layout\'s media query');
    assert.equal(lastProp(parseRules(wide), '.wp-cap', 'display'), 'none');
    assert.equal(lastProp(parseRules(wide), '.wp-colhead', 'display'), 'grid');
    assert.equal(lastProp(parseRules(narrow), '.wp-cap', 'display'), 'block');
    assert.equal(lastProp(parseRules(narrow), '.wp-colhead', 'display'), 'none');
  });

  it('a signal outside the groups lands under "Other signals" by its own name', () => {
    const html = weightsPanelHtml([{ key: 'later', name: 'later', hint: '', group: OTHER_GROUP, def: 0, weight: 0, max: null, hardAt: null, words: ['later'] }]);
    assert.match(html, />Other signals</);
  });
});

describe('Copy config', () => {
  const signals = panelSignals();
  const state = (over = {}, hard = {}) => ({
    weights: signals.map((s) => over[s.key] || { weight: s.def, max: null }),
    hardAt: signals.map((s) => hard[s.key] ?? null),
  });

  it('writes only what differs from the defaults: a bare weight, or { weight, max } with a cap', () => {
    assert.deepEqual(weightsConfig(signals, state({ sidebar: { weight: 20, max: null }, copy: { weight: 5, max: 2 } }, { sidebar: 1 })),
      { scoreWeights: { copy: { weight: 5, max: 2 }, sidebar: 20 }, hardAt: { sidebar: 1 } });
  });

  it('everything at its default: an empty object', () => {
    assert.deepEqual(weightsConfig(signals, state()), {});
  });

  it('what it writes reads back through the config as the same values', () => {
    const cfg = weightsConfig(signals, state({ synthetic: { weight: 0.5, max: 10 } }, { paste: 3 }));
    assert.deepEqual(resolveScoreWeights(cfg.scoreWeights).weights.synthetic, { weight: 0.5, max: 10 });
    assert.deepEqual(resolveHardAt(cfg.hardAt).hardAt, { paste: 3 });
  });
});

describe('the rail data', () => {
  it('one row per triage row: the library\'s tier and the counts in SCORE_SIGNALS order; the signals at the config\'s values', () => {
    const triage = [{ participantId: 'A-1', hardTriggered: false, softFlagged: true, edgeExitCount: 2, summary: { totalPasteEvents: 1, sidebarEventCount: 2 } }];
    const d = railData(triage, { scoreWeights: { paste: 9 }, hardAt: { sidebar: 2 } });
    assert.equal(d.rows[0].lib, 'soft');
    assert.equal(d.rows[0].counts.length, SCORE_SIGNALS.length);
    assert.equal(d.rows[0].counts[SCORE_SIGNALS.findIndex((s) => s.key === 'edgeExits')], 2);
    assert.equal(d.rows[0].counts[SCORE_SIGNALS.findIndex((s) => s.key === 'sidebar')], 2);
    const paste = d.signals.find((s) => s.key === 'paste');
    assert.deepEqual([paste.def, paste.weight, paste.max, paste.hardAt], [5, 9, null, null]);
    assert.equal(d.signals.find((s) => s.key === 'sidebar').hardAt, 2);
  });

  // JSON has no Infinity (it writes null), and a damaged file can make a
  // count infinite (a keyboardShortcuts list whose length is 1e400): the
  // largest finite number keeps every comparison with a hard-at count.
  it('a count that is not a number is 0; an infinite one is the largest finite number of its sign', () => {
    const d = railData([{ summary: { totalPasteEvents: 'x', keyboardShortcutCount: Infinity, zoomChangeCount: -Infinity }, edgeExitCount: NaN }], {});
    const at = (k) => d.rows[0].counts[SCORE_SIGNALS.findIndex((s) => s.key === k)];
    assert.ok(d.rows[0].counts.every((n) => Number.isFinite(n)));
    assert.deepEqual([at('paste'), at('edgeExits'), at('kbShortcuts'), at('zoom')], [0, 0, Number.MAX_VALUE, -Number.MAX_VALUE]);
    assert.deepEqual(JSON.parse(JSON.stringify(d)).rows[0].counts, d.rows[0].counts);
  });
});

// The page re-scores and re-tiers from the rail data with the two functions
// triage ranks with, so at the run's own weights it must give every row the
// score and tier the files carry (summary.csv, triage.md). The summaries
// cover every tier: the library's hard, soft, clean, and hard* from a verdict
// level, from a tab-away count and from an infinite count (a damaged file's);
// a count of minus infinity stays under its hard-at count. The weights hold
// a cap, a fractional weight and weighted verdicts. The infinite counts are
// unweighted: weighted, the files' score is Infinity and the page's the
// largest finite number times the weight (both rank first in the tier).
const summary = (id, over) => ({ participantId: id, hardTriggered: false, totalSoftScore: 0, softScoreThreshold: 6, ...over });
const SUMMARIES = [
  summary('H-1', { hardTriggered: true, totalPasteEvents: 2, totalCopyEvents: 4 }),
  summary('S-1', { totalSoftScore: 7, sidebarEventCount: 1, totalSyntheticInsertions: 3 }),
  summary('P-1', { cursorAnalysis: { level: 2, verdict: 'highly suspicious', tells: [] }, totalCopyEvents: 1 }),
  summary('T-1', { typingAnalysis: { level: 1, verdict: 'suspicious', tells: [] }, tabAwayMediumCount: 2, tabAwayLongCount: 1 }),
  summary('C-1', { zoomChangeCount: 4 }),
  summary('K-1', { keyboardShortcutCount: Infinity }),
  summary('N-1', { layoutShiftCount: -Infinity }),
];
const EDGE = SUMMARIES.map((s, i) => ({ edgeExits: i === 4 ? [{ edgeExitCount: 2 }] : [] }));
const RUN_CONFIG = {
  scoreWeights: { copy: { weight: 2, max: 3 }, synthetic: 0.5, cursor: 4, typingRhythm: 3, edgeExits: 1 },
  hardAt: { cursor: 2, tabaway: 3, kbShortcuts: 1, viewportShifts: 1 },
};

describe('the rail data agrees with the run', () => {
  it('each row\'s counts give the triage row\'s score and reportTier', () => {
    const triage = rankTriage(SUMMARIES, EDGE, RUN_CONFIG);
    assert.deepEqual(triage.map((t) => [t.participantId, t.reportTier]),
      [['H-1', 'hard'], ['P-1', 'hard*'], ['T-1', 'hard*'], ['K-1', 'hard*'], ['S-1', 'soft'], ['C-1', 'clean'], ['N-1', 'clean']]);
    const d = railData(triage, RUN_CONFIG);
    const weights = d.signals.map((s) => ({ weight: s.weight, max: s.max }));
    const hardAt = d.signals.map((s) => s.hardAt);
    triage.forEach((t, i) => {
      assert.equal(reportTierFromCounts(d.rows[i].lib, d.rows[i].counts, hardAt), t.reportTier, t.participantId);
      assert.equal(scoreFromCounts(d.rows[i].counts, weights), t.score, t.participantId);
    });
  });
});

describe('the panel, run from the source the report inlines', () => {
  it('holds nothing the HTML parser would react to', () => {
    const src = weightsPanelScript();
    assert.deepEqual(inlineSrcHazards(src), []);
    assert.equal(/<\/script/i.test(src), false);
  });

  // weightsPanelScript checks its own text, as timelineScript does, so a
  // hazard typed into an inlined function fails the report's build, not
  // only this test. A function's text is what String gives it: the test
  // gives one function its own toString, then takes it away.
  it('refuses to build when an inlined function holds a hazard', () => {
    for (const hazard of ['/* <!-- */', 'var s = "<script>";']) {
      weightsConfig.toString = () => 'function weightsConfig() { ' + hazard + ' return {}; }';
      try {
        assert.throws(() => weightsPanelScript(), /cannot be inlined/, hazard);
      } finally {
        delete weightsConfig.toString;
      }
    }
    assert.deepEqual(inlineSrcHazards(weightsPanelScript()), [], 'the functions\' own text again');
  });

  // Lowering ES5 code to ES5 changes nothing: an arrow, a template literal,
  // a spread, `?.` or `??` would be rewritten, and let, const, class or a
  // default argument refused. Two forms esbuild prints the same either way
  // (both sides write { a: a } in full and drop a trailing comma), so they
  // are looked for in the text itself, its strings and comments blanked: a
  // shorthand property ({ a } or { a: 1, b }) and a trailing comma before a
  // closing parenthesis (ES2017).
  it('is ES5', () => {
    const src = weightsPanelScript();
    assert.equal(transformSync(src, { target: 'es5' }).code,
      transformSync(src, { target: 'esnext', supported: { 'object-extensions': false } }).code);
    const code = blankStringsAndComments(src);
    assert.deepEqual(shorthandProps(code), [], 'shorthand properties');
    assert.doesNotMatch(code, /,\s*\)/, 'a trailing comma in a call or a parameter list');
  });

  // The page calls into the inlined text by the names written in it (the
  // analyzer bakes node's text, and its bundle may rename the functions), so
  // the boot call is the literal one the text defines.
  it('ends with its own boot call, by the name its text defines', () => {
    const src = weightsPanelScript();
    assert.match(src, /^function chBootWeightsDialog\(doc\) \{/m);
    assert.ok(src.endsWith('\nchBootWeightsDialog(document);\n'), src.slice(-80));
  });

  // The panel's markup in happy-dom, and the inlined script run in a fresh
  // context with only the page's globals: a function that used anything from
  // its module would throw. Its objects carry that context's prototypes, so
  // they are compared as plain data.
  const plain = (v) => JSON.parse(JSON.stringify(v));
  function mount(onInput) {
    const signals = panelSignals(resolveScoreWeights({ copy: { weight: 2, max: 3 } }).weights, {});
    const win = dom(weightsPanelHtml(signals));
    const copied = [];
    const navigator = { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } };
    const wire = runInNewContext(weightsPanelScript() + '\n;' + wireWeightsPanel.name, { document: win.document, navigator });
    const root = win.document.querySelector('.wp');
    const panel = wire(root, { signals, onInput });
    const input = (el, v) => { el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
    return { win, root, panel, copied, input, signals, q: (sel) => root.querySelector(sel) };
  }

  it('starts at the given weights; the slider and the number box follow each other; onInput runs', () => {
    let calls = 0;
    const { q, input, panel, signals } = mount(() => { calls++; });
    assert.equal(q('[data-weight="copy"]').value, '2');
    assert.equal(q('[data-max="copy"]').value, '3');
    input(q('[data-slider="sidebar"]'), '12');
    assert.equal(q('[data-weight="sidebar"]').value, '12');
    input(q('[data-weight="sidebar"]'), '35');
    assert.equal(q('[data-slider="sidebar"]').value, '20');
    assert.equal(calls, 2);
    const i = signals.findIndex((s) => s.key === 'sidebar');
    assert.deepEqual(plain(panel.read().weights[i]), { weight: 35, max: null });
  });

  it('reads caps and hard-at counts as whole numbers; an empty or invalid box is none, a weight box the default', () => {
    const { q, input, panel, signals } = mount(null);
    input(q('[data-max="paste"]'), '2.7');
    input(q('[data-hard="paste"]'), '0');
    input(q('[data-hard="sidebar"]'), '3');
    input(q('[data-weight="zoom"]'), '');
    const st = panel.read();
    const at = (k) => signals.findIndex((s) => s.key === k);
    assert.equal(st.weights[at('paste')].max, 2);
    assert.equal(st.hardAt[at('paste')], null);
    assert.equal(st.hardAt[at('sidebar')], 3);
    assert.equal(st.weights[at('zoom')].weight, 0);
  });

  it('Reset puts every row back at its default, runs onInput and fires one change event', () => {
    let calls = 0;
    const { win, root, q, input } = mount(() => { calls++; });
    let changes = 0;
    win.document.body.addEventListener('change', () => { changes++; });
    input(q('[data-hard="sidebar"]'), '1');
    q('[data-action="weights-reset"]').click();
    assert.equal(q('[data-weight="copy"]').value, '5');
    assert.equal(q('[data-max="copy"]').value, '');
    assert.equal(q('[data-hard="sidebar"]').value, '');
    assert.equal(calls, 2);
    assert.equal(changes, 1);
    assert.ok(root);
  });

  it('Copy config shows the lines and puts them on the clipboard', async () => {
    const { q, input, copied } = mount(null);
    input(q('[data-hard="sidebar"]'), '1');
    q('[data-action="weights-copy"]').click();
    await new Promise((r) => setTimeout(r, 0));
    const text = q('.wp-config').textContent;
    assert.deepEqual(JSON.parse(text), { scoreWeights: { copy: { weight: 2, max: 3 } }, hardAt: { sidebar: 1 } });
    assert.equal(q('.wp-config').hidden, false);
    assert.deepEqual(copied, [text]);
    assert.equal(q('.wp-status').textContent, 'Copied.');
  });

  // The report's dialog over a page's rail data, with the inlined script run
  // as the page runs it (its boot call included); `edit` is called with the
  // window once the script is wired. Returns the rows of the last ch:rescore.
  function dialog(triage, config, edit) {
    const data = railData(triage, config);
    const signals = panelSignals(resolveScoreWeights(config.scoreWeights).weights, resolveHardAt(config.hardAt).hardAt);
    const win = dom(`<button class="weights-btn">Weights…</button><dialog id="weights-dialog">${weightsPanelHtml(signals)}</dialog>` +
      `<script type="application/json" id="ch-rail-data">${JSON.stringify(data)}</script>`);
    const got = [];
    win.document.addEventListener('ch:rescore', (e) => got.push(e.detail.rows));
    runInNewContext(weightsPanelScript(), { document: win.document, navigator: {} });
    edit(win);
    return plain(got.at(-1));
  }
  const edit = (win, sel, value) => {
    const box = win.document.querySelector(sel);
    box.value = value;
    box.dispatchEvent(new win.Event('input', { bubbles: true }));
  };

  it('the report\'s dialog: a change re-scores and re-tiers every row and hands them to the rail', () => {
    const triage = [
      { participantId: 'S-1', hardTriggered: false, softFlagged: true, edgeExitCount: 0, summary: { totalPasteEvents: 1, sidebarEventCount: 1 } },
      { participantId: 'C-1', hardTriggered: false, softFlagged: false, edgeExitCount: 0, summary: { sidebarEventCount: 2 } },
    ];
    const rows = dialog(triage, {}, (win) => edit(win, '[data-hard="sidebar"]', '2'));
    assert.deepEqual(rows.map((r) => [r.score, r.reportTier]), [[8, 'soft'], [6, 'hard*']]);
    assert.deepEqual(rows[0].terms, [['paste', 5], ['sidebar', 3]]);
  });

  it('the report\'s dialog at the run\'s own values hands back the run\'s scores, tiers and breakdowns', () => {
    const triage = rankTriage(SUMMARIES, EDGE, RUN_CONFIG);
    // An input event with the box's value unchanged: the panel reads the
    // values the script wrote from the rail data.
    const rows = dialog(triage, RUN_CONFIG, (win) => {
      const box = win.document.querySelector('[data-hard="cursor"]');
      assert.equal(box.value, '2');
      edit(win, '[data-hard="cursor"]', box.value);
    });
    assert.deepEqual(rows.map((r) => [r.score, r.reportTier]), triage.map((t) => [t.score, t.reportTier]));
    assert.deepEqual(rows.map((r) => r.terms),
      triage.map((t) => t.terms.filter(([, n]) => n > 0).map(([key, n]) => [SIGNAL_LABELS[key] || key, n])));
  });

  // A damaged session file through the real summary path: a keyboardShortcuts
  // list whose length JSON reads as Infinity. The files put the participant
  // in hard* by hardAt.kbShortcuts; the page, after any edit, must too.
  it('a count a damaged file makes infinite: the files say hard*, and so does the page after an edit', () => {
    const config = { outputDir: '.', participantIdField: 'participantId', hardAt: { kbShortcuts: 1 } };
    const p = extractIntegrityData(JSON.parse(readFileSync('examples/demo-sessions/data/DEMO-a3f3.json', 'utf8')), config);
    p.session.keyboardShortcuts = JSON.parse('{ "length": 1e400 }');
    const summaries = computeSummary([p], config);
    const triage = rankTriage(summaries, detectEdgeExits([p], config), config);
    assert.deepEqual([triage[0].hardTriggered, triage[0].softFlagged, triage[0].reportTier], [false, false, 'hard*']);
    assert.ok(buildSummaryCsv(summaries, triage).trim().split('\n')[1].endsWith(',hard*'), 'summary.csv');
    const rows = dialog(triage, config, (win) => edit(win, '[data-weight="paste"]', '6'));
    assert.equal(rows[0].reportTier, 'hard*');
  });

  // An empty or invalid weight box scores at the signal's default, so its
  // slider shows that default (up to the slider's 20), not 0.
  it('a cleared or invalid weight box: the slider shows the default the score uses', () => {
    const triage = [{ participantId: 'S-1', hardTriggered: false, softFlagged: true, edgeExitCount: 0, summary: { totalPasteEvents: 2 } }];
    for (const value of ['', '-3', 'x']) {
      let slider;
      const rows = dialog(triage, {}, (win) => {
        edit(win, '[data-weight="paste"]', value);
        slider = win.document.querySelector('[data-slider="paste"]').value;
      });
      assert.equal(slider, '5', JSON.stringify(value));
      assert.deepEqual(rows[0].terms, [['paste', 2 * Number(slider)]], JSON.stringify(value));
    }
  });

  it('the analyzer imports the same functions: the module\'s own wireWeightsPanel starts at the defaults', () => {
    const signals = panelSignals();
    const win = dom(weightsPanelHtml(signals));
    const panel = wireWeightsPanel(win.document.querySelector('.wp'), { signals, onInput: null });
    assert.deepEqual(weightsConfig(signals, panel.read()), {});
    assert.equal(typeof chBootWeightsDialog, 'function');
  });
});
