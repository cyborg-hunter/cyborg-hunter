// src/cli/renderers/rail-client.js
// The report rail's search and sort, as functions the page inlines into its
// script by their source text (html-index-core.js), so the tests call the
// code the page runs. Each is self-contained (its arguments, its locals, the
// other functions railFunctionsSrc lists) and in ES5.

import { inlineSrcHazards } from '../../shared/inline-safe.js';

// A search's words: lower case, split on white space, empty ones dropped.
export function chSearchTokens(q) {
  return String(q || '').toLowerCase().split(/\s+/).filter(function (w) { return w !== ''; });
}

// Whether a rail row matches every word of a search. A word matches when the
// participant's id (lower case) contains it, when the triage reason (lower
// case) contains it (an extension's name, "honeypot"), or when it begins one
// of the search words of a signal this participant has a count above zero
// for (row.words, from weights-panel.js WEIGHT_GROUPS): "synth" finds
// synthetic insertions, "copy sidebar" those with both.
export function chRowMatches(tokens, row) {
  return tokens.every(function (tok) {
    if (row.id.indexOf(tok) >= 0 || row.reason.indexOf(tok) >= 0) return true;
    return row.words.some(function (w) { return w.indexOf(tok) === 0; });
  });
}

// The rail's sorts as a comparator over each row's keys ({ index, id, tier,
// score, cursor, typing }): 'score' (the default), high to low; 'tier': hard
// (hard* with it), soft, clean, then score; 'cursor' and 'typing': the
// verdict's level high to low, not assessed (-1) last, then score; 'id'.
// Ties keep the triage order (index), so a sort is the same on every load.
export function chCompareRows(key) {
  var rank = { hard: 0, soft: 1, clean: 2 };
  return function (a, b) {
    var d = 0;
    if (key === 'id') d = a.id.localeCompare(b.id);
    else if (key === 'tier') d = rank[a.tier] - rank[b.tier];
    else if (key === 'cursor') d = b.cursor - a.cursor;
    else if (key === 'typing') d = b.typing - a.typing;
    if (d === 0 && key !== 'id') d = b.score - a.score;
    return d || a.index - b.index;
  };
}

// The source the page inlines, the three functions one after another. It
// defines them and calls nothing: the page's own script calls them by the
// names written above (the analyzer inlines this text as node gives it,
// baked at build time by tools/build-analyze.mjs, while its bundle may
// rename the functions themselves). inlineSafeSrc cannot neutralise a
// sequence that opens the HTML parser's escaped state
// (src/shared/inline-safe.js), so the text is checked here, as
// timelineScript checks its own.
export function railFunctionsSrc() {
  const src = [chSearchTokens, chRowMatches, chCompareRows].map(String).join('\n');
  const hazards = inlineSrcHazards(src);
  if (hazards.length) {
    throw new Error('rail-client: the rail script cannot be inlined into the report: it ' + hazards.join('; and it ') +
      '. Reword the source (a comment that mentions HTML is the usual cause); do not widen the escape.');
  }
  return src;
}
