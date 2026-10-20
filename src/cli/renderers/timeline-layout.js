// src/cli/renderers/timeline-layout.js
//
// The layout of a participant's "Session timeline" block, as plain data: the
// two images it stacks (the typing chart, typing-profile-core.js, above the
// session timeline, session-timeline-core.js) and the numbers the page's
// hover and pin script reads (timeline-client.js, through the block's
// data-timeline attribute). Pure: no canvas, no DOM, no Node APIs. Both
// charts draw from these numbers and the page reads the same ones, so one
// time has one x in both images and on the page.
//
// Times: a trial's startTime and its events' `t` are performance.now()
// milliseconds. The charts plot seconds since the session started, so every
// time goes through the one session offset (session-timeline-core.js
// deriveSessionOffset): sec = (t - offsetMs) / 1000. Trials and their events
// use the same offset, so a paste always lands inside its own trial's span.
//
// Every field read from participant data is type-checked, and no value in it
// makes anything here throw: the analyzer page runs this on files a
// participant could have written.

// Both images are this wide with this left margin: one x is one time in both.
export const TIMELINE_GEOMETRY = Object.freeze({ width: 1000, left: 90, right: 30 });
export const CHART_W = TIMELINE_GEOMETRY.width - TIMELINE_GEOMETRY.left - TIMELINE_GEOMETRY.right;

// The session timeline's rows in pixels: the band above the first row (the
// title, subtitle and legend), a strip's and a lane's height, the gap after
// each row, and the band under the last (the x-axis and the footer lines).
export const TIMELINE_ROW = Object.freeze({ top: 65, strip: 24, lane: 32, gap: 6, bottom: 110 });
export const TIMELINE_LANES = Object.freeze(['Text input', 'Tab-aways', 'Sidebars', 'Viewport shifts', 'Guard-friction']);
// The typing chart's rows: the title band, the chart, the band under it.
export const TYPING_ROW = Object.freeze({ top: 44, chart: 130, bottom: 30 });
// The label of a trial without a phase when other trials have one.
export const NO_PHASE = 'no phase';

// Crowded sessions: a line at every trial start is drawn only when the starts
// average at least this many pixels apart on the chart, and the C, P and R
// glyphs only above a bar at least this wide. Closer lines merge into a grey
// band, and a glyph wider than its bar would sit over its neighbours'.
const TRIAL_LINE_MIN_PX = 6;
const GLYPH_MIN_PX = 8;

const isObj = (v) => v !== null && typeof v === 'object';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// x of a time on either image; a time outside the domain is drawn at its edge.
// An empty or broken domain (or a time that is not a number) puts it at the
// left margin rather than at NaN.
export function xOf(sec, domainSec) {
  if (!isNum(domainSec) || domainSec <= 0 || Number.isNaN(sec)) return TIMELINE_GEOMETRY.left;
  const s = Math.max(0, Math.min(domainSec, sec));
  return TIMELINE_GEOMETRY.left + (s / domainSec) * CHART_W;
}

// A trial's bar: from its start to its end, at least 2 px wide, with a 1 px
// gap before the next trial's.
export function barRect(span, domainSec) {
  const x = xOf(span.startSec, domainSec);
  return { x, w: Math.max(2, xOf(span.endSec, domainSec) - x - 1) };
}

// The name a chart prints for a trial: its id, else the legacy rule id, else
// its position (the letter T and its number from 1), as the typing chart
// has always named trials. An id counts when it is non-empty text or a
// finite number (a numeric id, 0 included, is printed as the typing
// analysis names it); anything else is not a name.
export function trialLabel(t, index) {
  const asId = (v) => (typeof v === 'string' && v !== '' ? v : isNum(v) ? String(v) : null);
  const id = isObj(t) ? asId(t.trialId) ?? asId(t.ruleId) : null;
  return id !== null ? id : 'T' + (index + 1);
}

// The trial's phase when the experiment set one. "default" (what the library
// writes when the experiment sets none) and an empty string count as unset.
export function phaseOf(t) {
  const ph = t && t.phase;
  return typeof ph === 'string' && ph !== '' && ph !== 'default' ? ph : null;
}

// Each trial's span in session seconds, and whether the charts can be
// aligned: only when every trial carries a numeric startTime and duration_ms
// (and the offset puts both ends at a finite number of seconds). One trial
// without them makes the session fall back to one bar per trial: a
// time-axis chart with some trials missing would read as if they had not
// happened. `truncated` marks a page whose events a Qualtrics payload too
// large for its field did not keep (integrityTruncated, set by the one-line
// setup's payload builder): the span is there, its events are not.
export function trialSpans(trials, offsetMs) {
  const list = Array.isArray(trials) ? trials : [];
  const spans = [];
  for (let index = 0; index < list.length; index++) {
    const t = list[index];
    if (!isObj(t) || !isNum(t.startTime) || !isNum(t.duration_ms) || t.duration_ms < 0) {
      return { aligned: false, spans: [] };
    }
    const startSec = (t.startTime - offsetMs) / 1000;
    const endSec = startSec + t.duration_ms / 1000;
    if (!isNum(startSec) || !isNum(endSec)) return { aligned: false, spans: [] };
    spans.push({ index, id: trialLabel(t, index), phase: phaseOf(t), startSec, endSec, truncated: t.integrityTruncated === true });
  }
  return { aligned: spans.length > 0, spans };
}

// The Text input lane's marks: copies and cuts, pastes, drops, and each
// trial's synthetic insertions (text that appeared with no key press) as one
// group with its count. Each mark keeps its trial's index. An event without
// a numeric `t`, one the offset puts at no finite second, and anything that
// is not an object, is left out. The monitor logs these events only inside
// its trials, so a copy on a page that is not a trial never appears here
// (docs: Reading the session timeline).
export function inputMarks(trials, offsetMs) {
  const out = { copies: [], pastes: [], drops: [], synthetic: [] };
  const list = Array.isArray(trials) ? trials : [];
  // Each timed event with its second: [event, sec].
  const timed = (events) => (Array.isArray(events) ? events : [])
    .filter((e) => isObj(e) && isNum(e.t))
    .map((e) => [e, (e.t - offsetMs) / 1000])
    .filter(([, sec]) => isNum(sec));
  list.forEach((t, index) => {
    if (!isObj(t)) return;
    for (const [e, sec] of timed(t.copyEvents)) out.copies.push({ index, sec, kind: e.type === 'cut' ? 'cut' : 'copy' });
    for (const [, sec] of timed(t.pasteEvents)) out.pastes.push({ index, sec });
    for (const [, sec] of timed(t.dropEvents)) out.drops.push({ index, sec });
    const secs = timed(t.syntheticInsertions).map(([, sec]) => sec);
    if (secs.length) out.synthetic.push({ index, secs, count: secs.length });
  });
  return out;
}

// The trials' phases as runs in time order: a run starts where a trial's
// phase differs from the previous trial's. Empty when no trial has a phase,
// so a study that sets none gets no phase labels or lines.
export function phaseRuns(spans) {
  if (!spans.some((s) => s.phase !== null)) return [];
  const sorted = spans.slice().sort((a, b) => a.startSec - b.startSec || a.index - b.index);
  const runs = [];
  for (const s of sorted) {
    const label = s.phase === null ? NO_PHASE : s.phase;
    if (!runs.length || runs[runs.length - 1].label !== label) runs.push({ sec: s.startSec, label });
  }
  return runs;
}

// The guides both images draw: a light line at every trial start and a dark
// one where the phase changes. The first run is the session's first phase,
// not a change: it gets its label on the Trials strip and no line.
// A crowded session gets no trial-start lines: when the chart's width
// divided by the number of trials (their starts' average distance on a
// chart they fill) is under TRIAL_LINE_MIN_PX, trialStarts is empty and
// trialLinesHidden holds the number of trials, which both images' legends
// print ("trial lines hidden (N trials)"); otherwise it is 0. Phase lines
// are always drawn.
export function guides(spans) {
  const runs = phaseRuns(spans);
  const crowded = spans.length > 0 && CHART_W / spans.length < TRIAL_LINE_MIN_PX;
  return {
    trialStarts: crowded ? [] : spans.map((s) => s.startSec),
    trialLinesHidden: crowded ? spans.length : 0,
    phaseChanges: runs.slice(1),
    runs,
  };
}

// The x-domain widened to every trial's end and every Text input mark, so
// none is cut at the right edge (the timeline's own domain covers the
// session's duration and its lanes' events only). A domain that is not a
// number (unreadable session start and end times) starts from 0.
export function coverDomain(domainSec, spans, marks) {
  let d = isNum(domainSec) ? domainSec : 0;
  const take = (sec) => { if (isNum(sec) && sec > d) d = sec; };
  for (const s of spans) take(s.endSec);
  for (const m of marks.copies) take(m.sec);
  for (const m of marks.pastes) take(m.sec);
  for (const m of marks.drops) take(m.sec);
  for (const g of marks.synthetic) for (const sec of g.secs) take(sec);
  return d;
}

// The participant's typing-speed threshold: the one the library screened
// them with (saved in session.config.thresholds), else the CLI's, else 10.
// Each is read only when it is a number, as the typing analysis reads it
// (analyzers/typing.js), so a bar is red exactly when the analysis calls the
// trial fast.
export function typingThreshold(p, config) {
  const session = isObj(p) && isObj(p.session) ? p.session : {};
  const saved = isObj(session.config) && isObj(session.config.thresholds) ? session.config.thresholds : {};
  if (isNum(saved.typingSpeedCps)) return saved.typingSpeedCps;
  return isObj(config) && isNum(config.typingSpeedThreshold_cps) ? config.typingSpeedThreshold_cps : 10;
}

// One entry per trial, in trial order: a speed bar for a judged trial
// ('typed'), the hatched paste marker for a trial with a paste and no judged
// speed ('paste-only'), or nothing ('none'); the rate; whether it is over the
// threshold; and the glyphs above the bar: C (a copy or cut), P (a paste),
// R (the typing-rhythm rule fired in the trial's field).
// The rate and "judged" come from the report's typing analysis
// (summary.typingAnalysis.byIndex: one entry per trial, in trial order, so
// two trials that share an id keep their own) when it has one entry per
// trial drawn here; else, and for an entry that is not an object, from the
// library's charsPerSec, judged whenever it is a number. The counts differ
// when a phase scope analysed fewer trials than the charts draw, and there
// is no analysis for a hand-built summary. R comes from the analysis only.
// timeAxis ({ spans, domainSec }, given when the trials are drawn on the
// session time axis) leaves the glyphs off a bar narrower than GLYPH_MIN_PX:
// the Text input lane still marks every copy and paste (inputMarks), and the
// Typing dynamics section names the trials where the rhythm rule fired.
// Without it (one 30 px bar per trial) every bar keeps its glyphs.
export function typingBars(trials, typingAnalysis, threshold, timeAxis = null) {
  const list = Array.isArray(trials) ? trials : [];
  const byIndex = isObj(typingAnalysis) && Array.isArray(typingAnalysis.byIndex) && typingAnalysis.byIndex.length === list.length
    ? typingAnalysis.byIndex : null;
  const spans = isObj(timeAxis) && Array.isArray(timeAxis.spans) ? timeAxis.spans : null;
  return list.map((raw, index) => {
    const t = isObj(raw) ? raw : {};
    const entry = byIndex ? byIndex[index] : null;
    const own = isObj(entry) ? entry : null;
    const rate = own ? own.cps : t.charsPerSec;
    const cps = isNum(rate) ? rate : null;
    const judged = cps !== null && (own ? own.judged === true : true);
    const pastes = Array.isArray(t.pasteEvents) ? t.pasteEvents.length : 0;
    const copies = Array.isArray(t.copyEvents) ? t.copyEvents.length : 0;
    const span = spans ? spans[index] : null;
    const narrow = isObj(span) && barRect(span, timeAxis.domainSec).w < GLYPH_MIN_PX;
    const glyphs = [];
    if (!narrow) {
      if (copies > 0) glyphs.push('C');
      if (pastes > 0) glyphs.push('P');
      if (own && own.rhythm === true) glyphs.push('R');
    }
    return { index, kind: judged ? 'typed' : pastes > 0 ? 'paste-only' : 'none', cps: judged ? cps : null, fast: judged && cps > threshold, glyphs };
  });
}

// The typing chart's y-axis: from 0 to a round number above both the fastest
// judged trial and 1.5 × the threshold, in steps of 5, 10 or 20.
export function typingAxis(threshold, bars) {
  let raw = isNum(threshold) ? threshold * 1.5 : 0;
  for (const b of Array.isArray(bars) ? bars : []) {
    if (isObj(b) && b.kind === 'typed' && isNum(b.cps) && b.cps > raw) raw = b.cps;
  }
  const step = raw > 40 ? 20 : raw > 20 ? 10 : 5;
  return { max: Math.max(step, Math.ceil(raw / step) * step), step };
}

// The session timeline's rows, top to bottom: the gallery phase strip (only
// when the session has those bands), the Trials strip (only when the trials
// align), then the lanes. Where each is, where the guides start and end, and
// the canvas height.
export function timelineRows({ phasesStrip = false, trialsStrip = false } = {}) {
  const R = TIMELINE_ROW;
  let y = R.top;
  const phasesY = phasesStrip ? y : null;
  if (phasesStrip) y += R.strip + R.gap;
  const trialsY = trialsStrip ? y : null;
  if (trialsStrip) y += R.strip + R.gap;
  const lanes = TIMELINE_LANES.map((name, i) => ({ name, y: y + i * (R.lane + R.gap) }));
  const lanesBottom = y + TIMELINE_LANES.length * (R.lane + R.gap) - R.gap;
  return { phasesY, trialsY, lanesTop: y, lanes, lanesBottom, guidesTop: trialsY === null ? y : trialsY, height: lanesBottom + R.gap + R.bottom };
}

// What the hover and pin script needs (timeline-client.js), as small arrays:
// the geometry, the domain, each trial [id, phase, startSec, endSec, cps,
// truncated] (cps for a judged trial only; truncated: the page's events were
// not kept, see trialSpans), each tab-away [startSec, endSec] and each
// sidebar span [startSec, endSec] (one still open at the end runs to the end
// of the domain). Seconds are rounded to 0.01: the attribute stays small, and
// a pixel is never narrower than 0.01 s.
export function hoverData(layout) {
  const r = (v) => Math.round(v * 100) / 100;
  const tabAways = Array.isArray(layout.events?.tabAways) ? layout.events.tabAways : [];
  const sidebarSpans = Array.isArray(layout.events?.sidebarSpans) ? layout.events.sidebarSpans : [];
  return {
    w: TIMELINE_GEOMETRY.width, left: TIMELINE_GEOMETRY.left, chart: CHART_W, domain: r(layout.domainSec),
    trials: layout.spans.map((s) => {
      const b = layout.bars[s.index];
      return [s.id, s.phase, r(s.startSec), r(s.endSec), b && b.kind === 'typed' ? b.cps : null, s.truncated === true];
    }),
    tabs: tabAways.filter((e) => isObj(e) && isNum(e.t_sec))
      .map((e) => [r(e.t_sec), r(e.t_sec + (isNum(e.duration_ms) ? e.duration_ms : 0) / 1000)]),
    sidebars: sidebarSpans.filter((s) => isObj(s) && isNum(s.start_sec))
      .map((s) => [r(s.start_sec), r(s.closed && isNum(s.end_sec) ? s.end_sec : layout.domainSec)]),
  };
}
