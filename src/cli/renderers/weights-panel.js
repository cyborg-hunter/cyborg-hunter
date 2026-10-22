// src/cli/renderers/weights-panel.js
// The score-weights panel, one component in two places: the analyzer's
// settings (demo/analyze/settings-panel.js, in place of the table of numbers
// it had) and the CLI report's "Weights…" dialog (html-index-core.js). Rows
// are grouped (clipboard and text; leaving the page; typing; pointer;
// browser and device), each with a slider from 0 to 20, a number box (any
// value ≥ 0; the slider stops at 20), a cap, and a "Hard at" count. Under
// them, Reset to defaults and Copy config (the scoreWeights and hardAt
// entries for cyborg-hunter.config.json). The CLI report's dialog shows both
// buttons; the analyzer's settings show Reset to defaults only: they remove
// Copy config once the panel is wired, beside their own Export config.
//
// The score stays additive: points × events up to the cap, summed over the
// signals with no ceiling (score-weights.js). Hard at moves a participant
// whose count reaches it into the hard tier, shown as hard* beside the
// library's own hard (score-weights.js resolveHardAt).
//
// HTML and CSS are strings both pages insert. The behaviour is real
// functions: the analyzer imports them; the CLI report, one HTML file that
// cannot import, inlines them by their source text (weightsPanelScript). So
// each is self-contained (its arguments, its locals, browser globals and the
// other functions weightsPanelScript lists) and in ES5, and the tests run
// them from that source.

import {
  SCORE_SIGNALS, SIGNAL_LABELS, DEFAULT_RESOLVED_WEIGHTS, resolveScoreWeights, resolveHardAt,
  scoreFromCounts, reportTierFromCounts,
} from '../analyzers/score-weights.js';
import { inlineSrcHazards } from '../../shared/inline-safe.js';

// The panel's groups and rows, keyed by SCORE_SIGNALS key: the name and hint
// the panel shows, and the words the rail's search finds the signal by
// (lower case, matched by prefix: "synth" finds synthetic insertions).
export const WEIGHT_GROUPS = [
  { name: 'Clipboard and text', rows: [
    { key: 'paste', name: 'Paste', hint: 'Each paste into a text field', words: ['paste'] },
    { key: 'copy', name: 'Copy or cut', hint: 'Each copy or cut of the page’s text', words: ['copy', 'cut'] },
    { key: 'drop', name: 'Drop', hint: 'Text dragged and dropped into a field', words: ['drop', 'drag'] },
    { key: 'synthetic', name: 'Synthetic insertion', hint: 'Text that appeared with no key press', words: ['synthetic', 'insertion', 'autofill'] },
    { key: 'foreignInput', name: 'Foreign input', hint: 'Typing that landed outside the experiment', words: ['foreign', 'input'] },
  ] },
  { name: 'Leaving the page', rows: [
    { key: 'tabaway', name: 'Tab-away over threshold', hint: 'Longer than the participant’s tab-away threshold (3 s by default)', words: ['tab', 'tab-away', 'tabaway', 'away'] },
    { key: 'tabawayLong', name: 'Long tab-away (10 s or more)', hint: 'Counted again on top of Tab-away over threshold', words: ['long', 'tab', 'tab-away', 'tabaway', 'away'] },
    { key: 'tabawayMedium', name: 'Medium tab-away', hint: 'From the threshold to 10 s; counted again on top of Tab-away over threshold', words: ['medium', 'tab', 'tab-away', 'tabaway', 'away'] },
    { key: 'flicker', name: 'Flicker', hint: 'Tab-aways at or under the threshold', words: ['flicker'] },
    { key: 'sidebar', name: 'Sidebar opened', hint: 'The page narrowed as a side panel opened', words: ['sidebar', 'side', 'panel'] },
  ] },
  { name: 'Typing', rows: [
    { key: 'fastTyping', name: 'Fast typing (trials)', hint: 'Trials typed faster than the threshold', words: ['fast', 'typing', 'speed'] },
    { key: 'typingRhythm', name: 'Typing verdict', hint: 'Points × level: suspicious\u00a01, highly suspicious\u00a02', words: ['typing', 'rhythm', 'regular', 'verdict'] },
  ] },
  { name: 'Pointer', rows: [
    { key: 'cursor', name: 'Pointer verdict', hint: 'Points × level: suspicious\u00a01, highly suspicious\u00a02', words: ['pointer', 'cursor', 'mouse', 'verdict'] },
    { key: 'edgeExits', name: 'Edge exits', hint: 'The pointer left the window through a screen edge', words: ['edge', 'exits', 'pointer'] },
  ] },
  { name: 'Browser and device', rows: [
    { key: 'aiExtensions', name: 'AI extensions', hint: 'A known AI extension found in the page', words: ['ai', 'extension', 'extensions'] },
    { key: 'kbShortcuts', name: 'DevTools shortcuts', hint: 'Ctrl/Cmd+Shift+I/J/C, F12', words: ['devtools', 'shortcut', 'shortcuts', 'keyboard'] },
    { key: 'viewportShifts', name: 'Viewport shifts', hint: 'The page’s width changed', words: ['viewport', 'shift', 'shifts', 'width'] },
    { key: 'zoom', name: 'Zoom changes', hint: 'The browser’s zoom changed', words: ['zoom'] },
    { key: 'softwareRenderer', name: 'Software renderer', hint: 'The browser drew without a graphics card (a device fact)', words: ['software', 'renderer', 'device'] },
    { key: 'deviceMasking', name: 'Device masking', hint: 'Screen facts that contradict each other (a device fact)', words: ['device', 'masking', 'screen'] },
  ] },
];
// Where a SCORE_SIGNALS key without a row above goes, under its own name.
export const OTHER_GROUP = 'Other signals';

const CAP_TITLE = 'the most events of one kind that count toward the ranking score';
const HARD_TITLE = 'a count at or above which the report moves the participant into the hard tier, shown as HARD*';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The panel's signals in SCORE_SIGNALS order: each one's row (name, hint,
// search words, group), its breakdown label, its default weight, and the
// weight, cap and hard-at count to show (resolved values: resolveScoreWeights
// weights, resolveHardAt hardAt).
export function panelSignals(weights = DEFAULT_RESOLVED_WEIGHTS, hardAt = {}) {
  const rowOf = new Map();
  for (const g of WEIGHT_GROUPS) for (const r of g.rows) rowOf.set(r.key, { ...r, group: g.name });
  return SCORE_SIGNALS.map((sig) => {
    const r = rowOf.get(sig.key) || { name: sig.label || sig.key, hint: sig.hint || '', words: [sig.key.toLowerCase()], group: OTHER_GROUP };
    const w = weights[sig.key] || { weight: sig.weight, max: null };
    return {
      key: sig.key, name: r.name, hint: r.hint, words: r.words, group: r.group,
      label: SIGNAL_LABELS[sig.key] || sig.key, def: sig.weight, weight: w.weight, max: w.max,
      hardAt: Object.prototype.hasOwnProperty.call(hardAt, sig.key) ? hardAt[sig.key] : null,
    };
  });
}

// The panel's markup: column heads, the groups with their rows, the buttons,
// a status line and the copied config (hidden until Copy config). A group's
// rows come in WEIGHT_GROUPS order, not SCORE_SIGNALS order, so the
// tab-away rows read together. Only the markup is reordered; the panel's
// states stay in signals order. Each number box sits under a caption, its
// column head's word (Points, Cap, Hard at), that only the stacked layout
// shows, where the column heads are hidden; screen readers take the box's
// own aria-label.
export function weightsPanelHtml(signals) {
  const place = new Map(WEIGHT_GROUPS.flatMap((g) => g.rows.map((r, i) => [r.key, i])));
  const byGroup = new Map();
  for (const s of signals) {
    if (!byGroup.has(s.group)) byGroup.set(s.group, []);
    byGroup.get(s.group).push(s);
  }
  // Stable: rows with no place (under "Other signals") keep signals order.
  for (const rows of byGroup.values()) rows.sort((a, b) => (place.get(a.key) ?? 0) - (place.get(b.key) ?? 0));
  const order = WEIGHT_GROUPS.map((g) => g.name).concat([OTHER_GROUP]).filter((name) => byGroup.has(name));
  const box = (caption, input) => `<span class="wp-box"><span class="wp-cap" aria-hidden="true">${caption}</span>${input}</span>`;
  const row = (s) => `<div class="wp-row"><span class="wp-name">${esc(s.name)}<small>${esc(s.hint)}</small></span>` +
    `<input type="range" min="0" max="20" step="1" data-slider="${esc(s.key)}" aria-label="${esc(s.name)}: points per event">` +
    box('Points', `<input type="number" min="0" step="any" data-weight="${esc(s.key)}" aria-label="${esc(s.name)}: points per event (number)">`) +
    box('Cap', `<input type="number" min="0" step="1" data-max="${esc(s.key)}" placeholder="none" aria-label="${esc(s.name)}: cap">`) +
    box('Hard at', `<input type="number" min="1" step="1" data-hard="${esc(s.key)}" placeholder="—" aria-label="${esc(s.name)}: hard at">`) + '</div>';
  return '<div class="wp" data-role="weights-panel">' +
    '<div class="wp-colhead"><span>Signal</span><span>Points per event</span><span>Points</span>' +
    `<span title="${CAP_TITLE}">Cap</span><span title="${HARD_TITLE}">Hard at</span></div>` +
    order.map((name) => `<div class="wp-group"><div class="wp-group-name">${esc(name)}</div>${byGroup.get(name).map(row).join('')}</div>`).join('') +
    '<div class="wp-foot"><button type="button" data-action="weights-reset">Reset to defaults</button>' +
    '<button type="button" data-action="weights-copy">Copy config</button>' +
    '<span class="wp-status" role="status"></span></div>' +
    '<pre class="wp-config" hidden></pre></div>';
}

// The panel's styles, scoped to .wp; both pages define the colour variables
// (--ink, --dim, --line, --bg, --surface) and --ff-sora, the report's face
// for data (its typography test allows only the embedded faces). On a narrow screen each row
// stacks: the name, the slider, then the three boxes, each under its caption.
// A hint that runs to two lines is balanced, so no word is left alone on the
// second.
export const WEIGHTS_PANEL_CSS = `
.wp { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.wp-colhead, .wp-row { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.2fr) 64px 64px 64px; gap: 10px; align-items: center; }
.wp-colhead { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 2px; border-bottom: 1px solid var(--line); }
.wp-group-name { margin: 10px 0 2px; font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; }
.wp-row { padding: 3px 0; }
.wp-name small { display: block; color: var(--dim); font-size: 12px; text-wrap: balance; }
.wp-row input[type=range] { width: 100%; margin: 0; accent-color: var(--ink); }
.wp-box { display: block; min-width: 0; }
.wp-cap { display: none; }
.wp-row input[type=number] { width: 100%; box-sizing: border-box; font: inherit; padding: 3px 5px; border: 1px solid var(--line); border-radius: 0; background: var(--bg); color: var(--ink); }
.wp-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
.wp-foot button { font: inherit; padding: 4px 12px; border: 1px solid var(--ink); border-radius: 0; background: var(--surface); color: var(--ink); cursor: pointer; }
.wp-foot button:focus-visible, .wp-row input:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
.wp-status { color: var(--dim); }
.wp-config { margin: 8px 0 0; padding: 8px; border: 1px solid var(--line); background: var(--bg); font: 12px/1.4 var(--ff-sora); white-space: pre; overflow-x: auto; }
@media (max-width: 560px) {
  .wp-colhead { display: none; }
  .wp-row { grid-template-columns: 1fr 1fr 1fr; }
  .wp-row .wp-name, .wp-row input[type=range] { grid-column: 1 / -1; }
  .wp-cap { display: block; margin-bottom: 2px; font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; }
}
`;

// The config entries for a panel state (signals order): scoreWeights holds
// the signals whose weight differs from its default or that have a cap (a
// bare number, or { weight, max }), hardAt the set counts; either is left out
// when empty. The same rule the analyzer's settings always used.
export function weightsConfig(signals, state) {
  var scoreWeights = {};
  var hardAt = {};
  var out = {};
  for (var i = 0; i < signals.length; i++) {
    var s = signals[i];
    var w = state.weights[i];
    if (w.weight !== s.def || w.max != null) scoreWeights[s.key] = w.max == null ? w.weight : { weight: w.weight, max: w.max };
    if (state.hardAt[i] != null) hardAt[s.key] = state.hardAt[i];
  }
  if (Object.keys(scoreWeights).length) out.scoreWeights = scoreWeights;
  if (Object.keys(hardAt).length) out.hardAt = hardAt;
  return out;
}

// Wires a panel (weightsPanelHtml's markup under `root`) and starts it at the
// signals' own weight, cap and hard-at count. cfg = { signals, onInput }:
// onInput (or null) runs on every edit, a slider's every step included (the
// CLI report re-scores then); the analyzer listens for the change events the
// inputs fire on commit instead. Reset fires one bubbling change event too.
// Returns { read, write } over states { weights: [{ weight, max }],
// hardAt: [n | null] } in signals order.
export function wireWeightsPanel(root, cfg) {
  var signals = cfg.signals;
  var status = root.querySelector('.wp-status');
  var pre = root.querySelector('.wp-config');
  function field(attr, key) { return root.querySelector('[' + attr + '="' + key + '"]'); }
  // A box's number, or null when it is empty or under min.
  function number(text, min) {
    if (String(text).trim() === '') return null;
    var n = Number(text);
    return isFinite(n) && n >= min ? n : null;
  }
  function write(state) {
    for (var i = 0; i < signals.length; i++) {
      var key = signals[i].key;
      var w = state.weights[i];
      field('data-weight', key).value = String(w.weight);
      field('data-slider', key).value = String(Math.min(20, w.weight));
      field('data-max', key).value = w.max == null ? '' : String(w.max);
      field('data-hard', key).value = state.hardAt[i] == null ? '' : String(state.hardAt[i]);
    }
  }
  // An empty or invalid weight box is the signal's default; caps and hard-at
  // counts are whole numbers (a cap from 0, a hard-at count from 1).
  function read() {
    return {
      weights: signals.map(function (s) {
        var w = number(field('data-weight', s.key).value, 0);
        var m = number(field('data-max', s.key).value, 0);
        return { weight: w == null ? s.def : w, max: m == null ? null : Math.floor(m) };
      }),
      hardAt: signals.map(function (s) {
        var h = number(field('data-hard', s.key).value, 1);
        return h == null ? null : Math.floor(h);
      }),
    };
  }
  function edited() {
    pre.hidden = true;
    status.textContent = '';
    if (cfg.onInput) cfg.onInput();
  }
  function defaultOf(key) {
    for (var i = 0; i < signals.length; i++) if (signals[i].key === key) return signals[i].def;
    return 0;
  }
  // The slider follows its number box. An empty or invalid box scores at
  // the signal's default (read), so the slider shows that default.
  root.addEventListener('input', function (e) {
    var t = e.target;
    var slider = t.getAttribute('data-slider');
    var weight = t.getAttribute('data-weight');
    if (slider) field('data-weight', slider).value = t.value;
    else if (weight) {
      var v = number(t.value, 0);
      field('data-slider', weight).value = String(Math.min(20, v == null ? defaultOf(weight) : v));
    }
    edited();
  });
  root.querySelector('[data-action="weights-reset"]').addEventListener('click', function () {
    write({
      weights: signals.map(function (s) { return { weight: s.def, max: null }; }),
      hardAt: signals.map(function () { return null; }),
    });
    edited();
    root.dispatchEvent(new root.ownerDocument.defaultView.Event('change', { bubbles: true }));
  });
  root.querySelector('[data-action="weights-copy"]').addEventListener('click', function () {
    var text = JSON.stringify(weightsConfig(signals, read()), null, 2);
    pre.textContent = text;
    pre.hidden = false;
    // Where the clipboard is refused (a sandboxed frame, no permission), the
    // text is selected for the analyst to copy.
    function done(ok) {
      status.textContent = ok ? 'Copied.' : 'Select the text below and copy it.';
      if (ok) return;
      var doc = root.ownerDocument;
      var range = doc.createRange();
      range.selectNodeContents(pre);
      var sel = doc.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    }
    try {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } catch (e) {
      done(false);
    }
  });
  write({
    weights: signals.map(function (s) { return { weight: s.weight, max: s.max }; }),
    hardAt: signals.map(function (s) { return s.hardAt; }),
  });
  return { read: read, write: write };
}

// The CLI report's "Weights…" dialog: the panel at the report's values (the
// rail data, #ch-rail-data), opened by the top bar's button and closed by its
// Close button or Escape, which hands focus back to the button. Every edit
// re-scores and re-tiers each row from its counts with the functions the CLI
// ranked with (scoreFromCounts, reportTierFromCounts) and hands the rows, in
// triage order, to the rail (html-index-core.js listens for ch:rescore). While
// the values differ from the report's, the button reads "Weights… (edited)".
export function chBootWeightsDialog(doc) {
  var dataEl = doc.getElementById('ch-rail-data');
  var dialog = doc.getElementById('weights-dialog');
  var button = doc.querySelector('.weights-btn');
  if (!dataEl || !dialog || !button) return;
  var data = JSON.parse(dataEl.textContent);
  var signals = data.signals;
  // The rail data holds an infinite count (a damaged file's) as the largest
  // finite number of its sign, since JSON has no Infinity (railData). Scored
  // as that, a weight of 1 or less would give a finite score where the files
  // print Infinity, so each such count is infinite again here.
  var counts = data.rows.map(function (r) {
    return r.counts.map(function (n) {
      return n === Number.MAX_VALUE ? Infinity : n === -Number.MAX_VALUE ? -Infinity : n;
    });
  });
  var panel = wireWeightsPanel(dialog.querySelector('.wp'), { signals: signals, onInput: rescore });
  button.addEventListener('click', function () {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  dialog.querySelector('.wd-close').addEventListener('click', function () {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  });
  // WebKit leaves the focus on the closed dialog; the other engines already
  // put it back on the button.
  dialog.addEventListener('close', function () { button.focus(); });
  // Whether a state differs from the report's values as the score reads
  // them: a weight, a cap on a signal that has points, or a Hard at count.
  function edited(st) {
    for (var i = 0; i < signals.length; i++) {
      var s = signals[i];
      var w = st.weights[i];
      if (w.weight !== s.weight || st.hardAt[i] !== s.hardAt) return true;
      if (w.weight !== 0 && w.max !== s.max) return true;
    }
    return false;
  }
  function rescore() {
    var st = panel.read();
    var rows = data.rows.map(function (r, j) {
      var c = counts[j];
      var terms = [];
      for (var i = 0; i < signals.length; i++) {
        var w = st.weights[i];
        if (w.weight === 0) continue;
        var n = (w.max == null ? c[i] : Math.min(c[i], w.max)) * w.weight;
        if (n > 0) terms.push([signals[i].label, n]);
      }
      return { score: scoreFromCounts(c, st.weights), reportTier: reportTierFromCounts(r.lib, c, st.hardAt), terms: terms };
    });
    button.textContent = edited(st) ? 'Weights\u2026 (edited)' : 'Weights\u2026';
    doc.dispatchEvent(new doc.defaultView.CustomEvent('ch:rescore', { detail: { rows: rows } }));
  }
}

// The script the CLI report inlines (html-index-core.js wraps it in an IIFE
// and inlineSafeSrc): the functions, then the boot call. The analyzer does
// not call this in its bundle, where a function's text is esbuild's reprint:
// it inlines this text as node gives it, baked at build time
// (tools/build-analyze.mjs), so its report is the CLI's byte for byte. The
// boot call names the function by its `.name`, so a text built from renamed
// functions would still call the one it defines; in node that is the name
// written above, which the page's own calls use.
// inlineSafeSrc cannot neutralise a sequence that opens the HTML parser's
// escaped state (src/shared/inline-safe.js): the page's own closing tag
// would no longer close the script and the dialog would silently never
// work. So the text is checked here, as timelineScript checks its own.
export function weightsPanelScript() {
  const src = [scoreFromCounts, reportTierFromCounts, weightsConfig, wireWeightsPanel, chBootWeightsDialog].map(String).join('\n') +
    '\n' + chBootWeightsDialog.name + '(document);\n';
  const hazards = inlineSrcHazards(src);
  if (hazards.length) {
    throw new Error('weights-panel: the weights script cannot be inlined into the report: it ' + hazards.join('; and it ') +
      '. Reword the source (a comment that mentions HTML is the usual cause); do not widen the escape.');
  }
  return src;
}

// What the report page embeds for its rail (#ch-rail-data): the signals at
// this report's values (weights, caps, hard-at counts) with their breakdown
// labels and search words, and per triage row the library's tier and the
// counts in SCORE_SIGNALS order. A count that is not a number is 0. An
// infinite one (a damaged file's: a list whose length reads as 1e400) is the
// largest finite number of its sign: JSON would write Infinity as null, and
// the page must put the row in the hard-at tier the files put it in (the
// dialog makes it infinite again before it scores, chBootWeightsDialog).
export function railData(triage, config) {
  const signals = panelSignals(resolveScoreWeights(config?.scoreWeights).weights, resolveHardAt(config?.hardAt).hardAt);
  return {
    signals: signals.map((s) => ({ key: s.key, label: s.label, words: s.words, def: s.def, weight: s.weight, max: s.max, hardAt: s.hardAt })),
    rows: triage.map((t) => ({
      lib: t.hardTriggered ? 'hard' : t.softFlagged ? 'soft' : 'clean',
      counts: SCORE_SIGNALS.map((sig) => {
        const n = Number(sig.count(t.summary || {}, t.edgeExitCount));
        if (n === Infinity) return Number.MAX_VALUE;
        if (n === -Infinity) return -Number.MAX_VALUE;
        return Number.isFinite(n) ? n : 0;
      }),
    })),
  };
}
