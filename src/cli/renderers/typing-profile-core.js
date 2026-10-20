// src/cli/renderers/typing-profile-core.js
//
// Pure drawing core for per-participant typing-speed images — no Node APIs,
// so the browser /analyze/ page bundles it directly. report-core.js calls
// drawTypingProfile per participant with an injected canvas factory and hands
// the encoded PNG to its sink. Mirrors the session-timeline-core.js /
// trajectories-core.js split.
//
// drawTypingProfile(p, config, createCanvas, typingAnalysis) returns the drawn
// canvas, or null when no trial has a judged rate or a paste. Two layouts,
// decided by timeline-layout.js trialSpans:
//   aligned   — every trial carries startTime and duration_ms: one bar per
//               trial from its start to its end on the session timeline's
//               time axis (the same width and left margin), so the report
//               stacks the two images and one vertical line crosses both;
//   per trial — older data: one 30 px bar per trial, as before 0.17; the
//               report says that alignment needs trial start times.
// Bars: a judged trial's rate (the report's typing analysis, else the
// library's charsPerSec), red above the participant's threshold; a hatched
// bar for a trial with a paste and no judged rate; C, P and a red R over the
// bars (copy or cut, paste, typing rhythm; placed by timeline-layout.js
// glyphPlaces, drawn after every bar). Both layouts share the y-axis
// rule (timeline-layout.js typingAxis): round steps, capped for rates no
// person types, so a bar faster than the axis top is cut at the chart's top.
// createCanvas is injected so this module never imports the `canvas`
// package directly.

import { sessionLayout, drawGuideLines, phaseNamePlaces, hatch } from './session-timeline-core.js';
import {
  TIMELINE_GEOMETRY, CHART_W, TYPING_ROW, xOf, barRect, typingAxis, trialLabel, glyphPlaces,
} from './timeline-layout.js';

// The per-trial layout's geometry (before 0.17 the only one).
const PER_TRIAL = { barWidth: 30, barGap: 8, chartHeight: 200, top: 50, bottom: 50, left: 60 };
// At most this many bars in the per-trial layout, the first trials: that
// canvas grows by a bar per trial, and node-canvas and browsers refuse a side
// longer than 32767 pixels (861 bars). The title says when trials are left
// out. The aligned layout is 1000 px wide whatever the count.
const MAX_BARS = 800;

const COLOR = {
  typed: '#2196F3', fast: '#f44336', threshold: '#ff0000',
  // A faint column for every trial on the time axis, so a trial without
  // typing still shows where it was.
  column: 'rgba(207, 216, 220, 0.35)',
  phaseLabel: '#263238',
};
const GLYPH_COLOR = { C: '#f57c00', P: '#555', R: '#b71c1c' };

export function drawTypingProfile(p, config, createCanvas, typingAnalysis = null) {
  const trials = Array.isArray(p.trials) ? p.trials : [];
  if (trials.length === 0) return null;
  const L = sessionLayout(p, config, typingAnalysis);
  if (L.bars.every((b) => b.kind === 'none')) return null;
  return L.aligned ? drawAligned(p, L, createCanvas) : drawPerTrial(p, L, createCanvas);
}

// ── On the session time axis ─────────────────────────────────────────────
function drawAligned(p, L, createCanvas) {
  const { width, left, right } = TIMELINE_GEOMETRY;
  const T = TYPING_ROW.top;
  const CH = TYPING_ROW.chart;
  const height = T + CH + TYPING_ROW.bottom;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // The legend at the right of the title's line, then the title, cut to the
  // room left of it (a long participant id would run under the legend).
  // Under the legend, the subtitle's line ends with the note a crowded
  // session gets (timeline-layout.js guides), as on the timeline's legend.
  const legendLeft = drawLegend(ctx, width - right, 22, false);
  ctx.fillStyle = '#333';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(fitWidth(ctx, `Typing Speed Profile — ${p.participantId}`, legendLeft - 16 - left), left, 22);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText(`same time axis as the session timeline below · threshold ${rateLabel(L.threshold)} chars/sec`, left, 38);
  const hidden = L.guides.trialLinesHidden;
  if (hidden > 0) {
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`trial lines hidden (${hidden} trials)`, width - right, 38);
    ctx.textAlign = 'left';
  }

  // Y-axis: round steps, labelled at the left margin, with a light grid.
  const axis = typingAxis(L.threshold, L.bars);
  const yOf = (v) => T + CH - (v / axis.max) * CH;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  for (let v = 0; v <= axis.max; v += axis.step) {
    ctx.fillStyle = '#666';
    ctx.fillText(rateLabel(v), left - 6, yOf(v) + 3);
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(left, yOf(v));
    ctx.lineTo(left + CHART_W, yOf(v));
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(left - 34, T + CH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#444';
  ctx.font = '10px sans-serif';
  ctx.fillText('chars/sec', 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';

  // Threshold line; not drawn off the chart (a threshold over the capped
  // axis top, or below 0: participant data).
  if (L.threshold >= 0 && L.threshold <= axis.max) drawThreshold(ctx, yOf(L.threshold), left, left + CHART_W);

  // One column per trial, its bar from its start to its end. A rate over the
  // axis top is cut at the chart's top (barTop). The glyphs are placed here
  // and drawn last, so no later column or bar paints over them.
  const glyphs = [];
  for (const s of L.spans) {
    const b = L.bars[s.index];
    const { x, w } = barRect(s, L.domainSec);
    ctx.fillStyle = COLOR.column;
    ctx.fillRect(x, T, w, CH);
    let top = T + CH;
    if (b.kind === 'typed') {
      top = barTop(yOf(b.cps), T, T + CH);
      ctx.fillStyle = b.fast ? COLOR.fast : COLOR.typed;
      ctx.fillRect(x, top, w, T + CH - top);
    } else if (b.kind === 'paste-only') {
      top = T + CH - 22;
      drawHatchedRect(ctx, x, top, w, 22);
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, top, w, 22);
    }
    glyphs.push(...glyphPlaces(b.glyphs, { x, w, top }, T));
  }

  // Baseline
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, T + CH);
  ctx.lineTo(left + CHART_W, T + CH);
  ctx.stroke();

  // The timeline's guides, over the chart, and each phase's name under the
  // baseline where the phase begins (inside the chart a name would run into
  // a tall bar and its glyphs), placed by the Trials strip's rule
  // (phaseNamePlaces), so the stacked images' names line up.
  const X = (sec) => xOf(sec, L.domainSec);
  drawGuideLines(ctx, L.guides, X, L.domainSec, T, T + CH);
  ctx.font = 'bold 9px sans-serif';
  ctx.fillStyle = COLOR.phaseLabel;
  for (const n of phaseNamePlaces(L.guides.runs, X)) ctx.fillText(n.text, n.x, T + CH + 13);

  drawGlyphs(ctx, glyphs);
  return canvas;
}

// ── One bar per trial (trials without start times) ───────────────────────
function drawPerTrial(p, L, createCanvas) {
  const G = PER_TRIAL;
  const bars = L.bars.slice(0, MAX_BARS);
  const shown = bars.length < L.bars.length ? ` (first ${bars.length} of ${L.bars.length} trials)` : '';
  // At least 600 px, so the legend fits beside the threshold's label, and
  // 700 when it also names the trimmed pages' hatch.
  const trimmed = bars.some((b) => b.truncated);
  const canvasW = Math.max(trimmed ? 700 : 600, G.left + bars.length * (G.barWidth + G.barGap) + 20);
  const canvasH = G.top + G.chartHeight + G.bottom;
  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // The title, then the threshold on its line; the legend has the line
  // under them to itself (on 600 px, a threshold beside the legend ran into
  // it). The participant id is cut to the room left, so the count of trials
  // shown and the threshold stay whole.
  ctx.font = '10px sans-serif';
  const note = `threshold ${rateLabel(L.threshold)} chars/sec`;
  const noteW = ctx.measureText(note).width;
  ctx.font = 'bold 14px sans-serif';
  const idRoom = canvasW - 10 - G.left - (shown ? ctx.measureText(shown).width : 0) - 12 - noteW;
  const title = fitWidth(ctx, `Typing Speed Profile — ${p.participantId}`, idRoom) + shown;
  ctx.fillStyle = '#333';
  ctx.fillText(title, G.left, 20);
  const titleW = ctx.measureText(title).width;
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText(note, G.left + titleW + 12, 20);
  drawLegend(ctx, canvasW - 10, 35, trimmed);

  // Y-axis: the time-axis chart's round steps (typingAxis), labelled at the
  // left edge, with a light grid.
  const axis = typingAxis(L.threshold, bars);
  const yOf = (v) => G.top + G.chartHeight - (v / axis.max) * G.chartHeight;
  ctx.font = '9px sans-serif';
  for (let v = 0; v <= axis.max; v += axis.step) {
    ctx.fillStyle = '#666';
    ctx.fillText(rateLabel(v), 5, yOf(v) + 3);
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(G.left, yOf(v));
    ctx.lineTo(canvasW - 10, yOf(v));
    ctx.stroke();
  }

  if (L.threshold >= 0 && L.threshold <= axis.max) drawThreshold(ctx, yOf(L.threshold), G.left, canvasW - 10);

  // Bars. The paste-only marker's height is arbitrary (20 % of the chart):
  // the point is visible presence, not magnitude. A page a trimmed Qualtrics
  // payload kept without its events is hatched behind its bar, faintly (a
  // background, not a bar), with the timeline's Trials-strip hatch: its
  // pastes and copies are not there to show.
  const pasteH = G.chartHeight * 0.2;
  const glyphs = [];
  bars.forEach((b, i) => {
    const x = G.left + i * (G.barWidth + G.barGap);
    if (b.truncated) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      hatch(ctx, x, G.top, G.barWidth, G.chartHeight);
      ctx.restore();
    }
    let top = G.top + G.chartHeight;
    if (b.kind === 'paste-only') {
      top = G.top + G.chartHeight - pasteH;
      drawHatchedRect(ctx, x, top, G.barWidth, pasteH);
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, top, G.barWidth, pasteH);
    } else if (b.kind === 'typed') {
      top = barTop(yOf(b.cps), G.top, G.top + G.chartHeight);
      const barH = G.top + G.chartHeight - top;
      ctx.fillStyle = b.fast ? COLOR.fast : COLOR.typed;
      ctx.fillRect(x, top, G.barWidth, barH);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, top, G.barWidth, barH);
    }
    const places = glyphPlaces(b.glyphs, { x, w: G.barWidth, top }, G.top);
    glyphs.push(...places);
    if (b.kind === 'typed') {
      // The rate inside the bar's top (under the glyphs when they are inside
      // it too), when the bar is tall enough and the number fits its width.
      const rateY = places.length && places[0].outlined ? places[places.length - 1].y + 12 : top + 12;
      ctx.font = 'bold 9px sans-serif';
      const rate = b.cps.toFixed(1);
      if (b.cps > 0 && rateY + 2 <= G.top + G.chartHeight && ctx.measureText(rate).width <= G.barWidth - 4) {
        ctx.fillStyle = '#fff';
        ctx.fillText(rate, x + 3, rateY);
      }
    }

    // Trial label (always drawn, even for blank columns)
    ctx.fillStyle = '#333';
    ctx.font = '8px sans-serif';
    ctx.save();
    ctx.translate(x + G.barWidth / 2, G.top + G.chartHeight + 10);
    ctx.rotate(Math.PI / 4);
    ctx.fillText(trialLabel(p.trials[i], i).substring(0, 12), 0, 0);
    ctx.restore();
  });

  // Baseline
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(G.left, G.top + G.chartHeight);
  ctx.lineTo(canvasW - 10, G.top + G.chartHeight);
  ctx.stroke();

  drawGlyphs(ctx, glyphs);
  return canvas;
}

// ── Shared pieces ────────────────────────────────────────────────────────
// A rate as a label: the axis ticks and the threshold. Short from a
// thousand up (1.5k, 200k, 1M): at 9 px a tick label as long as 100000 would
// run into the rotated axis title. Under a thousand, at most two decimals
// (a threshold of 0.1 + 0.2 reads 0.3); from a billion, in exponent form.
// The ticks stop at 1M (typingAxis); a threshold is participant data and
// can be any finite number.
function rateLabel(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return v.toExponential(1);
  if (a >= 1e6) return Number((v / 1e6).toPrecision(3)) + 'M';
  if (a >= 1e3) return Number((v / 1e3).toPrecision(3)) + 'k';
  return String(Number(v.toFixed(2)));
}

// A bar's top: its rate's y, kept between the chart's top (a rate over the
// capped axis) and its baseline (a negative rate: participant data).
function barTop(y, chartTop, baseline) {
  return Math.min(baseline, Math.max(chartTop, y));
}

// The dashed red threshold line at y, from x0 to x1.
function drawThreshold(ctx, y, x0, x1) {
  ctx.strokeStyle = COLOR.threshold;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Text cut with an ellipsis to fit `room` px in the current font. The cut
// starts from the share of the text that fits at its average width, so a
// very long id costs a few measures, not one per character.
function fitWidth(ctx, text, room) {
  const full = ctx.measureText(text).width;
  if (full <= room) return text;
  let n = Math.min(text.length - 1, Math.floor((text.length * room) / full));
  while (n > 0 && ctx.measureText(text.slice(0, n) + '…').width > room) n--;
  return text.slice(0, n) + '…';
}

// The C, P and R glyphs at their places (glyphPlaces), each in its colour;
// one inside a bar has a white outline under it, to read over the bar.
function drawGlyphs(ctx, places) {
  ctx.font = 'bold 11px sans-serif';
  for (const g of places) {
    if (g.outlined) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.strokeText(g.glyph, g.x, g.y);
    }
    ctx.fillStyle = GLYPH_COLOR[g.glyph];
    ctx.fillText(g.glyph, g.x, g.y);
  }
}

// The legend, right-aligned with its last item ending at `right`: the three
// bar kinds, then the two glyphs that are not bars (P is named with the
// hatched bar), and on the one-bar-per-trial chart, when a page was trimmed,
// the timeline's hatch. Returns the x where its first item begins.
function drawLegend(ctx, right, y, trimmed) {
  const items = [
    { swatch: COLOR.typed, label: 'typed' },
    { swatch: COLOR.fast, label: '> threshold' },
    { hatched: true, label: 'paste, no typing (P)' },
    { glyph: 'C', label: 'copy or cut' },
    { glyph: 'R', label: 'typing rhythm' },
  ];
  if (trimmed) items.push({ trimmed: true, label: 'events not kept' });
  let x = right;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    ctx.font = '10px sans-serif';
    x -= ctx.measureText(it.label).width;
    ctx.fillStyle = '#666';
    ctx.fillText(it.label, x, y);
    x -= 16;
    if (it.swatch) {
      ctx.fillStyle = it.swatch;
      ctx.fillRect(x, y - 8, 12, 10);
    } else if (it.hatched) {
      drawHatchedRect(ctx, x, y - 8, 12, 10);
    } else if (it.trimmed) {
      hatch(ctx, x, y - 8, 12, 10);
    } else {
      ctx.fillStyle = GLYPH_COLOR[it.glyph];
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(it.glyph, x + 2, y);
    }
    x -= 10;
  }
  return x + 10;
}

// Cross-hatched fill for paste-only markers. Uses a light grey background
// with diagonal strokes so the bar reads as "distinct category, not zero".
function drawHatchedRect(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 0.8;
  const step = 5;
  for (let d = -h; d < w + h; d += step) {
    ctx.beginPath();
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + h, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

// report-core.js builds the per-participant PNG filename with this; the
// rule is the report page's own (report-id.js), so the link always matches.
export { sanitize } from './report-id.js';
