// src/cli/renderers/session-timeline-core.js
//
// Pure drawing core for per-participant SESSION timeline images — no Node
// APIs, so the browser /analyze/ page bundles it directly. report-core.js
// calls drawSessionTimeline per participant with an injected canvas factory
// and hands the encoded PNG to its sink.
//
// drawSessionTimeline(p, config, createCanvas) draws every recorded
// integrity signal for one participant along a single shared time axis from
// session start to session end, and returns the drawn canvas (or null if
// there's nothing to draw). createCanvas is injected so this module never
// imports the `canvas` package directly — a browser caller can pass a
// document-canvas-backed factory instead.
//
// Why this replaces tab-timeline.js:
//   The old tab-timeline.js used per-trial rows on the chart. That layout
//   only made sense when every integrity event landed in a per-trial bucket.
//   For studies whose sessions are punctuated by long study phases (galleries,
//   typing prompts, comprehension gates, demographics, etc.) where most off-
//   task behavior actually happens, per-trial-row charts hide most of what
//   matters and produce blank charts for participants whose tab-aways landed
//   between trials.
//
// Layout:
//   Title strip, legend rows at the right
//   ─────────────────────────────────────────────
//   Phases strip     [gallery / typing / classification bands; only when
//                     derivePhases finds the gallery bands]
//   Trials strip     one band per trial, coloured by its `phase` when the
//                     experiment sets phases; only when the trials align
//   Text input       copy / cut ▼, paste ▲, drop ◆, synthetic insertions |
//   Tab-aways lane   |  vertical markers, colored by duration bin
//   Sidebars lane    |  horizontal spans, opened → closed
//   Layout shifts    |  thin vertical ticks
//   Guard-friction   |  vertical markers, dark red
//   Guides           light dashed line at each trial start, dark at each
//                     phase change (also drawn on the typing chart above)
//   ─────────────────────────────────────────────
//   X-axis ticks      0, M:SS labels
//   Footer            session-level counts + "off-trial tab-aways" note
//
// The image shares its width and left margin with the typing chart
// (timeline-layout.js TIMELINE_GEOMETRY), and sessionLayout below is the
// layout both draw from and the report page reads.
//
// X-axis unit: seconds elapsed since session start. Events recorded in
// performance.now() ms ("perfNow") are converted to session-relative seconds
// using a participant-specific sessionOffset estimator (see deriveSessionOffset
// below). For participants where the offset can't be estimated, the fallback
// is sessionOffset = 0 (assume page load == session start), which produces a
// small visualization drift (typically 10-60s, equal to the consent rendering
// + first click time). The drift only affects the X position of perfNow-based
// markers (sidebars, layout shifts, guard-friction); wall-clock-derived phase
// bands remain accurate.
//
// Edge cases handled gracefully (no crash, no silent failure):
//   * participant.session missing → render phase strip only, no integrity lanes
//   * trials missing → render integrity lanes only, no phase strip
//   * sidebar opened but never closed → render as unclosed span to session end
//   * malformed event objects → skipped with a debug log, render continues
//   * zero events of all kinds → render an "no integrity events" callout
//
// Backward compatibility:
//   * Works on payloads from any cyborg-hunter library version. Older payloads
//     without session-level event data simply lose those lanes (rendered empty).

import { countSidebarOpenings } from '../analyzers/summary.js';
import {
  TIMELINE_GEOMETRY, TIMELINE_ROW, NO_PHASE, trialSpans, inputMarks, guides, coverDomain,
  typingThreshold, typingBars, timelineRows,
} from './timeline-layout.js';

// ── Layout constants ─────────────────────────────────────────────────────
// The geometry and the rows are timeline-layout.js's, shared with the typing
// chart and the page.
const CANVAS_W = TIMELINE_GEOMETRY.width;
const LEFT_PAD = TIMELINE_GEOMETRY.left;
const RIGHT_PAD = TIMELINE_GEOMETRY.right;
const BOTTOM_PAD = TIMELINE_ROW.bottom;
const LANE_HEIGHT = TIMELINE_ROW.lane;
const PHASE_STRIP_H = TIMELINE_ROW.strip;

// ── Colors ───────────────────────────────────────────────────────────────
const C = {
  bg: '#ffffff',
  title: '#222',
  subtitle: '#666',
  border: '#999',
  laneBg: '#fafafa',
  laneBorder: '#e0e0e0',
  laneLabel: '#444',
  xAxis: '#666',
  xTick: '#aaa',

  // Phase bands
  phasePre: '#eceff1',         // bluish grey — framing (consent/tut/comp/transitions/post)
  phaseGallery: '#ffe0b2',     // peach — gallery viewing
  phaseTyping: '#e1bee7',      // light purple — typing prompt (explain only)
  phaseClass: '#bbdefb',       // light blue — classification trials
  phasePost: '#eceff1',        // same as phasePre — same logical class

  // Tab-away bins (match analyzer)
  tabFlicker: '#bdbdbd',       // < 3s — grey
  tabMedium: '#fb8c00',        // 3–10s — orange
  tabLong: '#e53935',          // ≥ 10s — red

  sidebarSpan: '#8e24aa',      // purple
  layoutShift: '#00897b',      // teal
  guardViolation: '#c62828',   // dark red

  // Text input marks, in the replay viewer's colours
  copy: '#f57c00',             // orange ▼ (copy or cut)
  paste: '#d32f2f',            // red ▲
  drop: '#7b1fa2',             // purple ◆
  synthetic: '#3949ab',        // indigo tick
  // Trials strip: alternating greys when the study sets no phases
  trialA: '#cfd8dc',
  trialB: '#e3e7ea',
  trialText: '#37474f',
  phaseLabel: '#263238',
  // Hatch over a trial whose events a trimmed Qualtrics payload did not keep
  trimmedHatch: '#78909c',
};

// Trials strip fills by phase. A phase the report knows keeps the colour it
// has everywhere else in the report (the Phases strip's bands, the
// trajectories panels' PHASE_TINTS in trajectories-core.js), so one phase
// has one colour. Any other phase takes the next of PHASE_FILL, in order of
// first appearance: colours no phase band uses. A Map, so a phase called
// `constructor` or `__proto__` is a name like any other.
const KNOWN_PHASE_FILL = new Map([
  ['gallery', C.phaseGallery],
  ['post_gallery_query', C.phaseTyping],
  ['typing', C.phaseTyping],
  ['classification', C.phaseClass],
  ['end_requery', C.phasePre],
]);
const PHASE_FILL = ['#c8e6c9', '#fff59d', '#d7ccc8', '#b2dfdb', '#f8bbd0'];

// The dashed guides (drawGuideLines), the same on both images.
const GUIDE = {
  trial: { color: 'rgba(55, 71, 79, 0.45)', width: 1, dash: [3, 3] },
  phase: { color: 'rgba(38, 50, 56, 0.85)', width: 1.3, dash: [6, 3] },
};

// ── Per-participant renderer ─────────────────────────────────────────────
// Returns the drawn canvas, or null if there's no data anywhere to draw
// (caller decides what "no data" means — report-core.js writes no PNG).
async function renderOne(p, config, createCanvas) {
  const L = sessionLayout(p, config);
  const xDomainSec = L.domainSec;

  if (xDomainSec <= 0) {
    // No data anywhere. Skip silently.
    return null;
  }

  const rows = timelineRows({ phasesStrip: L.galleryPhases, trialsStrip: L.aligned });
  const canvasH = rows.height;
  const canvas = createCanvas(CANVAS_W, canvasH);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CANVAS_W, canvasH);

  // The legend's rows are placed first: the title is cut to end clear of
  // the two rows beside its line.
  const legend = placeLegend(ctx, L);
  drawHeader(ctx, p, L.events, Math.min(...legend.slice(0, 2).map((row) => row.left)));

  const chartW = CANVAS_W - LEFT_PAD - RIGHT_PAD;
  const xScale = chartW / xDomainSec;

  if (rows.phasesY !== null) drawPhaseStrip(ctx, L.phases, xScale, xDomainSec, chartW, rows.phasesY);
  // With the Phases strip right above, the Trials strip has no room over it
  // for the phase names: they go inside it, drawn after the guides.
  const stripNames = rows.trialsY !== null
    ? drawTrialsStrip(ctx, L, xScale, xDomainSec, chartW, rows.trialsY, rows.phasesY !== null) : [];
  const counts = drawLanes(ctx, L, rows, xScale, xDomainSec, chartW);
  // Guides go on after the lanes so they sit on top of the event marks:
  // follow a line down to see which trial or phase an event fell in.
  drawGuideLines(ctx, L.guides, (sec) => LEFT_PAD + sec * xScale, xDomainSec, rows.guidesTop, rows.lanesBottom);
  drawPhaseGuides(ctx, L.phases, xScale, xDomainSec, rows.guidesTop, rows.lanesBottom, rows.phasesY);
  drawTrialsStripNames(ctx, stripNames, rows.trialsY);
  drawInsertionCounts(ctx, counts);
  drawXAxis(ctx, xDomainSec, chartW, canvasH);
  drawLegendAndFooter(ctx, p, L, canvasH, legend);

  return canvas;
}
export { renderOne as drawSessionTimeline };

// ── The shared layout ────────────────────────────────────────────────────
// What both images of the report's "Session timeline" block and the page
// use (typing-profile-core.js, html-index-core.js): the events on the
// session time axis, the phase bands, the session offset, the x-domain
// (widened to every trial and Text input mark), the trial spans and whether
// the charts align, the Text input marks, the guides, the typing threshold
// and the typing bars. typingAnalysis is the summary's (report-core.js);
// without one the bars come from the library's rates.
export function sessionLayout(p, config, typingAnalysis = null) {
  const events = collectEvents(p, config);
  const phases = derivePhases(p);
  // Sets events.sessionOffsetMs and every event's t_sec (computeXDomain).
  const baseDomain = computeXDomain(p, events, phases);
  const offsetMs = events.sessionOffsetMs;
  const trials = Array.isArray(p.trials) ? p.trials : [];
  const timed = trialSpans(trials, offsetMs);
  const marks = inputMarks(trials, offsetMs);
  const threshold = typingThreshold(p, config);
  // The domain first: the guides measure the trial starts' spacing on it,
  // and the typing bars their widths.
  const domainSec = coverDomain(baseDomain, timed.spans, marks);
  // A domain of no length (unreadable session times, every trial at the
  // session's start) is no time axis: the timeline draws nothing (renderOne),
  // so the trials do not align and the typing chart is one bar per trial.
  const aligned = timed.aligned && domainSec > 0;
  const spans = aligned ? timed.spans : [];
  // A sidebar still open at the end runs to the end of the final domain
  // (computeXDomain closed it at the session's duration, before the trials
  // and the Text input marks widened the domain), as the page draws it.
  for (const s of events.sidebarSpans) if (!s.closed) s.end_sec = domainSec;
  return {
    events, phases, offsetMs, domainSec, aligned, spans, marks, threshold,
    // The strip shows the gallery / typing / classification bands only:
    // derivePhases also returns framing bands for any session with a start
    // time, which say nothing on their own.
    galleryPhases: phases.some((ph) => ph.type === 'gallery' && ph.endSec > ph.startSec),
    guides: guides(spans, domainSec),
    bars: typingBars(trials, typingAnalysis, threshold, aligned ? { spans, domainSec } : null),
  };
}

// ── Event collection ─────────────────────────────────────────────────────
// All events are normalized to a `t_sec` field (session-relative seconds)
// using the participant's sessionOffset (see computeXDomain).
export function collectEvents(p, config) {
  const session = p.session || {};

  // 1. Tab-away events. Libraries ≥0.6.1 record session-level
  //    session.tabAwayEvents — full {start, duration_ms, type} for EVERY
  //    tab-away, including off-trial ones (consent, tutorial, comprehension,
  //    gallery study) — so those are preferred and everything plots. Older
  //    payloads fall back to per-trial events; their off-trial tab-aways
  //    exist only as durations in tabAwaySums and can't be placed on the
  //    axis (the footer says so).
  const tabAways = [];
  const sessionTabEvents = Array.isArray(session.tabAwayEvents) ? session.tabAwayEvents : null;
  const tabAwaySource = (sessionTabEvents && sessionTabEvents.length > 0) ? 'session' : 'per-trial';
  if (tabAwaySource === 'session') {
    for (const e of sessionTabEvents) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.start !== 'number') continue;
      if (typeof e.duration_ms !== 'number') continue;
      tabAways.push({
        t_perfNow_ms: e.start,
        duration_ms: e.duration_ms,
        type: e.type || 'tab-away',
      });
    }
  } else {
    for (const t of (p.trials || [])) {
      // After ingest, events live at t.tabAwayEvents (top-level on the
      // post-ingest trial). The raw payload nests them under integrityTrial,
      // but Shape-1 ingest spreads that sub-object out so the field surfaces
      // at the top. Fall back to the nested path for any callers that bypass
      // the ingest layer.
      const ev = (Array.isArray(t?.tabAwayEvents) && t.tabAwayEvents)
        || (Array.isArray(t?.integrityTrial?.tabAwayEvents) && t.integrityTrial.tabAwayEvents)
        || [];
      for (const e of ev) {
        if (!e || typeof e !== 'object') continue;
        if (typeof e.start !== 'number') continue;
        if (typeof e.duration_ms !== 'number') continue;
        tabAways.push({
          t_perfNow_ms: e.start,
          duration_ms: e.duration_ms,
          type: e.type || 'tab-away',
        });
      }
    }
  }

  // 2. Session-level tab-away durations (no individual timestamps).
  //    Used only for the off-trial-count annotation in the footer.
  const sessionTabDurations = Array.isArray(session.tabAwaySums) ? session.tabAwaySums : [];
  const offTrialTabAwayCount = Math.max(0, sessionTabDurations.length - tabAways.length);
  const offTrialTabAwayDurMs = sessionTabDurations.reduce((s, d) => s + (Number(d) || 0), 0)
                              - tabAways.reduce((s, e) => s + e.duration_ms, 0);

  // 3. Sidebar spans (paired opened → closed entries; library records each as
  //    a separate array entry, both stamped with `t` perfNow ms).
  const sidebarSpans = pairSidebarEvents(session.sidebarEvents || []);

  // 4. Viewport-width shifts — each has `t` perfNow ms. Canonical key since
  //    0.6.1 is viewportWidthShifts; layoutShifts is the deprecated alias
  //    older payloads carry.
  const layoutShifts = (session.viewportWidthShifts || session.layoutShifts || [])
    .filter(e => e && typeof e.t === 'number')
    .map(e => ({ t_perfNow_ms: e.t, delta: e.delta }));

  // 5. Guard-friction violations. The ingest surfaces these as p.guardFriction;
  //    fall back to metadata/session mirrors for legacy payloads.
  const gfRoot = p.guardFriction ?? p.metadata?.guardFriction ?? p.session?.guardFriction ?? null;
  const guardViolations = (gfRoot?.violations || [])
    .filter(v => v && typeof v.t === 'number')
    .map(v => ({
      t_perfNow_ms: v.t,
      phase: v.phase || 'unknown',
      reason: v.reason || 'unknown',
    }));

  return {
    tabAways,
    tabAwaySource,
    sessionTabDurations,
    offTrialTabAwayCount,
    offTrialTabAwayDurMs,
    sidebarSpans,
    layoutShifts,
    guardViolations,
    // Per-participant tab-away "flicker vs meaningful" cutoff — the threshold the
    // library screened this participant with (e.g. 5s for strict), saved in
    // session.config. Keeps the timeline's bins and footer consistent with
    // summary.csv instead of a hardcoded 3s. Three-tier precedence mirrors
    // summary.js / typing-profile-core.js: the participant's saved threshold first,
    // then an analyst-side CLI override (for re-screening legacy cohorts that
    // predate persisted thresholds), then the default.
    tabFlickerCutoffMs: p.session?.config?.thresholds?.tabAwayDurationMs
      ?? config?.thresholds?.tabAwayDurationMs ?? 3000,
  };
}

// Pair {opened, closed} sidebarEvents entries into spans. Library writes both
// halves of a cycle as separate array entries — we reassemble them so the
// renderer can draw each cycle as one horizontal bar.
function pairSidebarEvents(arr) {
  const spans = [];
  let openT = null;
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'opened' && typeof e.t === 'number') {
      // Anchor to the FIRST open in a run of opens with no intervening close.
      // The two runtime detectors (innerWidth_delta + layout_compression) can
      // each emit an "opened" on different poll ticks for one physical sidebar;
      // overwriting here would start the drawn span at the later detector,
      // disagreeing with countSidebarOpenings (which anchors to the first
      // transition) and with the span's own duration_ms label.
      if (openT === null) openT = e.t;
    } else if (e.type === 'closed' && typeof e.t === 'number' && openT !== null) {
      spans.push({
        start_perfNow_ms: openT,
        end_perfNow_ms: e.t,
        duration_ms: e.duration_ms ?? (e.t - openT),
        closed: true,
      });
      openT = null;
    }
  }
  // Trailing unclosed open
  if (openT !== null) {
    spans.push({ start_perfNow_ms: openT, end_perfNow_ms: null, duration_ms: null, closed: false });
  }
  return spans;
}

// ── Phase derivation ─────────────────────────────────────────────────────
// Returns an array of phase bands, each with:
//   { type: 'pre'|'gallery'|'typing'|'class'|'post',
//     ruleIndex: number?, label: string,
//     startSec: number, endSec: number }
// Times are session-relative seconds (anchored to metadata.startTime).
function derivePhases(p) {
  const meta = p.metadata || {};
  const startIso = meta.startTime;
  const endIso = meta.endTime;
  if (!startIso) return [];
  const sessionStartMs = Date.parse(startIso);
  const sessionEndMs = endIso ? Date.parse(endIso) : null;
  if (!Number.isFinite(sessionStartMs)) return [];

  const trials = Array.isArray(p.trials) ? p.trials.slice() : [];
  if (trials.length === 0) {
    // Only the session-bounding "pre" band.
    const endSec = Number.isFinite(sessionEndMs)
      ? (sessionEndMs - sessionStartMs) / 1000
      : ((meta.totalDurationMs || 0) / 1000);
    return [{ type: 'pre', label: 'session', startSec: 0, endSec }];
  }

  // Sort trials by timestamp (defensive — usually already sorted)
  trials.sort((a, b) => {
    const aT = a?.timestamp ? Date.parse(a.timestamp) : 0;
    const bT = b?.timestamp ? Date.parse(b.timestamp) : 0;
    return aT - bT;
  });

  // Group by rule position. Use a fresh sentinel object as the "no current
  // group" marker so that an initial trial with rulePosition === null
  // doesn't accidentally match curPos.
  //
  // Phase trials (gallery, post_gallery_query, end_requery) are merged into
  // the trials array by the ingester but lack wall-clock `timestamp` — only
  // their integrityTrial.startTime (perfNow). Including them here would
  // corrupt the per-rule anchor (a phase trial sorting first within a group
  // makes classEndMs = NaN and the whole group drops). The phase BANDS
  // themselves are still computed below using galleryStudyMs anchoring; we
  // just don't need the phase trials inside the grouping.
  const NO_POS = Symbol('NO_POS');
  const groups = [];
  let cur = null;
  let curPos = NO_POS;
  for (const t of trials) {
    if (!t || typeof t !== 'object') continue;
    if (t.phase && t.phase !== 'classification') continue;
    const pos = t.rulePosition ?? null;
    if (cur === null || pos !== curPos) {
      if (cur) groups.push(cur);
      cur = { rulePosition: pos, ruleId: t.ruleId, trials: [] };
      curPos = pos;
    }
    cur.trials.push(t);
  }
  if (cur) groups.push(cur);

  // Gallery durations (per rule, in ms). May be a flat array.
  const galleryMs = Array.isArray(p.galleryStudyMs) ? p.galleryStudyMs : [];
  const typingMs = inferTypingDurations(p);

  // Build phase bands.
  //
  // Strategy: anchor each rule's gallery / typing windows BACKWARDS from
  // classStartMs (which we have exactly). For rule i:
  //     classification:  [classStartMs, classWindowEnd]
  //     typing:          [classStartMs - typDur, classStartMs]    (explain only)
  //     gallery:         [classStartMs - typDur - galDur, classStartMs - typDur]
  //     pre / transition: [cursorMs, galleryStartMs]
  // The pre band for i=0 is "consent / tutorial / comprehension"; for i≥1
  // it's an inter-rule transition (UI render time, brief pause). Pre band is
  // skipped if it would have zero or negative width (e.g., gallery+typing
  // overlap with the previous classification due to data noise).
  const phases = [];
  let cursorMs = sessionStartMs;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.trials.length === 0) continue;

    // Classification window: from first trial's start to last trial's end
    const firstT = g.trials[0];
    const lastT = g.trials[g.trials.length - 1];
    const classEndMs = Date.parse(firstT.timestamp);
    if (!Number.isFinite(classEndMs)) continue;
    // Legacy Shape-2 trials carry `responseTime_ms` instead of `rt`; without the
    // fallback the classification window collapses to zero width and every
    // backwards-anchored band (gallery, typing) shifts right by the missing rt.
    const classStartMs = classEndMs - (firstT.rt ?? firstT.responseTime_ms ?? 0);
    const classWindowEnd = Date.parse(lastT.timestamp);

    const galDur = galleryMs[i] || 0;
    const typDur = typingMs[i] || 0;

    // Anchor gallery / typing backwards from classStartMs
    const typingEndMs = classStartMs;
    const typingStartMs = typingEndMs - typDur;
    const galleryEndMs = typingStartMs;
    const galleryStartMs = galleryEndMs - galDur;

    // Pre band (consent/tutorial/comprehension on i=0, transition otherwise).
    // Skip if width would be ≤ 0 (gallery/typing don't fit in the interlude —
    // happens with noisy data; better than overlap artefacts).
    if (galleryStartMs > cursorMs) {
      phases.push({
        type: 'pre',
        label: i === 0 ? 'consent / tutorial / comprehension' : 'transition',
        startSec: (cursorMs - sessionStartMs) / 1000,
        endSec: (galleryStartMs - sessionStartMs) / 1000,
      });
    }

    // Gallery band
    phases.push({
      type: 'gallery',
      ruleIndex: i,
      label: `gallery (${g.ruleId || `rule ${i + 1}`})`,
      startSec: (galleryStartMs - sessionStartMs) / 1000,
      endSec: (galleryEndMs - sessionStartMs) / 1000,
    });

    // Typing band (explain only)
    if (typDur > 0) {
      phases.push({
        type: 'typing',
        ruleIndex: i,
        label: 'type-explanation',
        startSec: (typingStartMs - sessionStartMs) / 1000,
        endSec: (typingEndMs - sessionStartMs) / 1000,
      });
    }

    // Classification band
    phases.push({
      type: 'class',
      ruleIndex: i,
      label: `classification ×${g.trials.length}`,
      startSec: (classStartMs - sessionStartMs) / 1000,
      endSec: (classWindowEnd - sessionStartMs) / 1000,
    });

    cursorMs = classWindowEnd;
  }

  // Post-final-rule band (re-query, demographics) up to session end
  const postEndMs = sessionEndMs || (sessionStartMs + (meta.totalDurationMs || 0));
  if (Number.isFinite(postEndMs) && postEndMs > cursorMs) {
    phases.push({
      type: 'post',
      label: 're-query / demographics',
      startSec: (cursorMs - sessionStartMs) / 1000,
      endSec: (postEndMs - sessionStartMs) / 1000,
    });
  }

  return phases;
}

function inferTypingDurations(p) {
  // postGalleryGuesses[i] = null for silent, or {rt, ruleId, response} for explain.
  // Use rt (ms) when present.
  const arr = Array.isArray(p.postGalleryGuesses) ? p.postGalleryGuesses : [];
  return arr.map(x => {
    if (x && typeof x.rt === 'number') return x.rt;
    return 0;
  });
}

// ── X-axis domain + perfNow → session-relative conversion ────────────────
// Determines the chart's X-axis maximum (in seconds) and stashes a
// session offset on the events object so all perfNow timestamps can be
// converted consistently.
function computeXDomain(p, events, phases) {
  const meta = p.metadata || {};

  // Session duration (seconds)
  let sessionDurSec = 0;
  if (Number.isFinite(meta.totalDurationMs)) {
    sessionDurSec = meta.totalDurationMs / 1000;
  } else if (meta.startTime && meta.endTime) {
    sessionDurSec = (Date.parse(meta.endTime) - Date.parse(meta.startTime)) / 1000;
  } else if (phases.length > 0) {
    sessionDurSec = phases[phases.length - 1].endSec;
  }

  // Estimate sessionOffset: the perfNow value (in ms) at session start.
  // This is the value to subtract from event.t_perfNow_ms to get session-rel ms.
  events.sessionOffsetMs = deriveSessionOffset(p, events);

  // Convert all event times to session-relative seconds in place
  for (const e of events.tabAways) {
    e.t_sec = (e.t_perfNow_ms - events.sessionOffsetMs) / 1000;
  }
  for (const s of events.sidebarSpans) {
    s.start_sec = (s.start_perfNow_ms - events.sessionOffsetMs) / 1000;
    s.end_sec = s.end_perfNow_ms != null
      ? (s.end_perfNow_ms - events.sessionOffsetMs) / 1000
      : sessionDurSec; // unclosed → extend to session end
  }
  for (const e of events.layoutShifts) {
    e.t_sec = (e.t_perfNow_ms - events.sessionOffsetMs) / 1000;
  }
  for (const v of events.guardViolations) {
    v.t_sec = (v.t_perfNow_ms - events.sessionOffsetMs) / 1000;
  }

  // Extend X-domain if any event lands beyond computed session duration
  // (rare — handles clock skew / late-saved data).
  let maxObserved = sessionDurSec;
  const consider = (sec) => {
    if (Number.isFinite(sec) && sec > maxObserved) maxObserved = sec;
  };
  for (const e of events.tabAways) consider(e.t_sec + e.duration_ms / 1000);
  for (const s of events.sidebarSpans) consider(s.end_sec);
  for (const e of events.layoutShifts) consider(e.t_sec);
  for (const v of events.guardViolations) consider(v.t_sec);

  return Math.max(maxObserved, sessionDurSec, 1);
}

// Derive (perfNow at session start) in ms.
// Strategy:
//   1. If any trial has trialStart_perfNow set, take the first trial's
//      perfNow anchor minus the trial's session-rel start (best — direct).
//   2. Else, if there's at least one per-trial tab-away with a `start`
//      perfNow value, use the same estimator as the ingest.
//   3. Else, fall back to 0 (assume page load == session start). This
//      drifts by ~20-60s for typical setups; flagged in the footer.
export function deriveSessionOffset(p, events) {
  const meta = p.metadata || {};
  const sessionStartMs = meta.startTime ? Date.parse(meta.startTime) : null;
  if (!Number.isFinite(sessionStartMs)) return 0;

  // Strategy 1: explicit per-trial perfNow anchors
  const trials = Array.isArray(p.trials) ? p.trials : [];
  for (const t of trials) {
    const anchor = t?.trialStart_perfNow ?? t?.startTime;
    if (typeof anchor !== 'number') continue;
    // Shape-2 (legacy) trials carry `responseTime_ms`, not `rt`
    // (ingest's LEGACY_FIELD_MAP only renames mouseTrack). Fall back so legacy
    // participants don't skip every candidate and drop to the offset-0 fallback.
    const rt = t?.rt ?? t?.responseTime_ms;
    if (!t?.timestamp || rt == null) continue;
    const trialEndWallMs = Date.parse(t.timestamp);
    const trialStartWallMs = trialEndWallMs - rt;
    if (!Number.isFinite(trialStartWallMs)) continue;
    // sessionOffset + (trialStartWall - sessionStartWall) = anchor
    // → sessionOffset = anchor - (trialStartWall - sessionStartWall)
    return anchor - (trialStartWallMs - sessionStartMs);
  }

  // Strategy 2: median across per-trial tab-aways (same approach as ingest)
  const candidates = [];
  for (let i = 0; i < trials.length; i++) {
    const t = trials[i];
    // After Shape-1 ingest, tab-aways live at the top-level t.tabAwayEvents
    // (the integrity sub-object is spread out). Fall back to the nested
    // integrityTrial path for callers that bypass ingest — same fallback
    // collectEvents() uses. Reading only the nested path made this strategy a
    // dead branch on ingested data, dropping every legacy participant to the
    // offset-0 fallback (Strategy 3) and drifting the timeline.
    const tabs = (Array.isArray(t?.tabAwayEvents) && t.tabAwayEvents)
      || (Array.isArray(t?.integrityTrial?.tabAwayEvents) && t.integrityTrial.tabAwayEvents)
      || [];
    if (tabs.length === 0) continue;
    const firstTabPerfNow = tabs[0]?.start;
    if (typeof firstTabPerfNow !== 'number') continue;
    // Legacy Shape-2 trials use `responseTime_ms`; see Strategy 1 above.
    const rt = t.rt ?? t.responseTime_ms;
    if (!t.timestamp || rt == null) continue;
    const trialEndWallMs = Date.parse(t.timestamp);
    const trialStartWallMs = trialEndWallMs - rt;
    if (!Number.isFinite(trialStartWallMs)) continue;
    const trialStartRelMs = trialStartWallMs - sessionStartMs;
    // Assume tab-away happened near trial midpoint (most conservative single-point estimate)
    candidates.push(firstTabPerfNow - trialStartRelMs - rt / 2);
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => a - b);
    return candidates[Math.floor(candidates.length / 2)];
  }

  // Strategy 3: fallback. Returns 0 so perfNow values plot directly.
  return 0;
}

// ── Drawing primitives ───────────────────────────────────────────────────
// The title names the whole participant id, cut with an ellipsis to end 16 px
// left of legendLeft (the legend rows beside its line), as the typing chart's
// title is cut before its legend: a long id never runs under the legend.
function drawHeader(ctx, p, events, legendLeft) {
  ctx.fillStyle = C.title;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(fitWidth(ctx, `Session Timeline — ${p.participantId}`, legendLeft - 16 - LEFT_PAD), LEFT_PAD, 22);

  ctx.fillStyle = C.subtitle;
  ctx.font = '11px sans-serif';
  const cond = p.metadata?.condition || '?';
  const dur = p.metadata?.totalDurationMs ? `${(p.metadata.totalDurationMs / 60000).toFixed(1)} min` : '?';
  ctx.fillText(`condition=${cond}  duration=${dur}  trials=${(p.trials || []).length}`, LEFT_PAD, 38);

  // Sessionoffset note. At y 50 it clears the phase names drawn 3 px above
  // a Trials strip in the first row (TIMELINE_ROW.top) by about 3 px, and
  // the subtitle's descenders by about 2.
  ctx.font = '10px sans-serif';
  if (!events.sessionOffsetMs) {
    ctx.fillStyle = '#999';
    ctx.fillText(`(perfNow→session-rel offset not derivable — perfNow events may drift ~20-60s)`, LEFT_PAD, 50);
  }
}

function drawPhaseStrip(ctx, phases, xScale, xDomain, chartW, y) {
  // Background
  ctx.fillStyle = C.laneBg;
  ctx.fillRect(LEFT_PAD, y, chartW, PHASE_STRIP_H);

  for (const ph of phases) {
    const color = phaseColor(ph.type);
    const x0 = LEFT_PAD + Math.max(0, ph.startSec) * xScale;
    const x1 = LEFT_PAD + Math.min(xDomain, ph.endSec) * xScale;
    const w = Math.max(0, x1 - x0);
    if (w <= 0) continue;
    ctx.fillStyle = color;
    ctx.fillRect(x0, y + 1, w, PHASE_STRIP_H - 2);
  }

  // Border
  ctx.strokeStyle = C.laneBorder;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(LEFT_PAD, y, chartW, PHASE_STRIP_H);

  // Label
  ctx.fillStyle = C.laneLabel;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Phases', LEFT_PAD - 6, y + PHASE_STRIP_H / 2 + 3);
  ctx.textAlign = 'left';
}

function phaseColor(type) {
  switch (type) {
    case 'pre': return C.phasePre;
    case 'gallery': return C.phaseGallery;
    case 'typing': return C.phaseTyping;
    case 'class': return C.phaseClass;
    case 'post': return C.phasePost;
    default: return C.laneBg;
  }
}

// The Trials strip: one band per trial from its start to its end, coloured by
// the trial's phase when the experiment sets phases (the jsPsych extension's
// `phase` parameter; "default" counts as unset; KNOWN_PHASE_FILL), else in
// alternating greys so neighbouring trials stay apart. A trial whose events
// a trimmed Qualtrics payload did not keep is hatched. A trial's id is
// written in its band when it fits; each phase's name above the strip where
// the phase begins, or, when the Phases strip sits right above
// (namesInside), in the strip itself, where it takes the place of the ids it
// would cover. Those names are returned, not drawn: drawTrialsStripNames
// draws them after the guides, so no line runs through one.
// Text widths are estimated, about 5.2 px a character at 9 px and 5.8 in
// bold, so the draw log does not depend on the canvas's fonts.
function drawTrialsStrip(ctx, L, xScale, xDomain, chartW, y, namesInside) {
  const X = (sec) => LEFT_PAD + clamp(sec, 0, xDomain) * xScale;
  ctx.fillStyle = C.laneBg;
  ctx.fillRect(LEFT_PAD, y, chartW, PHASE_STRIP_H);
  const runs = L.guides.runs;
  const fillOf = new Map();
  let next = 0;
  for (const run of runs) {
    if (fillOf.has(run.label)) continue;
    fillOf.set(run.label, KNOWN_PHASE_FILL.get(run.label) ?? PHASE_FILL[next++ % PHASE_FILL.length]);
  }
  L.spans.forEach((s, i) => {
    const x0 = X(s.startSec);
    const w = Math.max(1.5, X(s.endSec) - x0 - 0.5);
    ctx.fillStyle = runs.length ? fillOf.get(s.phase === null ? NO_PHASE : s.phase) : (i % 2 ? C.trialB : C.trialA);
    ctx.fillRect(x0, y + 1, w, PHASE_STRIP_H - 2);
    if (s.truncated) hatch(ctx, x0, y + 1, w, PHASE_STRIP_H - 2);
  });
  // Phase names inside the strip (phaseNamesInBands), each with its phase's
  // fill for the patch drawTrialsStripNames puts under it.
  const names = namesInside
    ? phaseNamesInBands(runs, L.spans, X).map((n) => ({ ...n, fill: fillOf.get(n.label) })) : [];
  ctx.font = '9px sans-serif';
  ctx.fillStyle = C.trialText;
  for (const s of L.spans) {
    const x0 = X(s.startSec);
    const x1 = X(s.endSec);
    if (x1 - x0 <= 16 || names.some((n) => x0 < n.x0 + 3 + n.w + 3 && x1 > n.x0)) continue;
    const text = fitText(s.id, x1 - x0 - 6, 5.2);
    if (text) ctx.fillText(text, x0 + 3, y + 15);
  }
  ctx.strokeStyle = C.laneBorder;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(LEFT_PAD, y, chartW, PHASE_STRIP_H);
  ctx.fillStyle = C.laneLabel;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(runs.length ? 'Trials · phase' : 'Trials', LEFT_PAD - 6, y + PHASE_STRIP_H / 2 + 3);
  ctx.textAlign = 'left';
  if (namesInside) return names;
  // Phase names above the strip, placed by phaseNamePlaces.
  ctx.font = 'bold 9px sans-serif';
  ctx.fillStyle = C.phaseLabel;
  for (const n of phaseNamePlaces(runs, X)) ctx.fillText(n.text, n.x, y - 3);
  return names;
}

// Where the phase names go along the chart, each right of its line: cut to
// the room between its line and the chart's right edge (never more than the
// chart), and left out when not even that fits or when it would run into
// the name before it (its line and colour still mark the change). X maps
// seconds to x. The Trials strip writes them above itself and the typing
// chart under its baseline, from this one rule, so the names of the stacked
// images line up. Widths are estimated, 5.8 px a character in bold 9 px.
// With the Phases strip drawn, both charts use phaseNamesInBands instead.
export function phaseNamePlaces(runs, X) {
  const chartW = CANVAS_W - LEFT_PAD - RIGHT_PAD;
  const chartRight = CANVAS_W - RIGHT_PAD;
  const out = [];
  let right = -Infinity;
  for (const run of runs) {
    const x = X(run.sec) + 2;
    const text = fitText(run.label, Math.min(chartW - 2, chartRight - x), 5.8);
    if (!text || x < right + 6) continue;
    out.push({ text, x });
    right = x + text.length * 5.8;
  }
  return out;
}

// The phase names written inside the Trials strip when the Phases strip sits
// right above it (no room over the strip): each phase's name in its own band,
// from its line to the next phase's (the last one to the last trial's end),
// cut with an ellipsis to that room, so every band with room for two
// characters is named. Each is { text, x, x0, w, label }: the text's x (3 px
// right of the line at x0), its estimated width (5.8 px a character in bold
// 9 px) and the phase. The timeline writes them in its strip and the typing
// chart under its baseline, so the stacked images name the same phases at
// the same x. X maps seconds to x.
export function phaseNamesInBands(runs, spans, X) {
  let lastEnd = 0;
  for (const s of spans) if (s.endSec > lastEnd) lastEnd = s.endSec;
  const names = [];
  runs.forEach((run, k) => {
    const x0 = X(run.sec);
    const text = fitText(run.label, X(k + 1 < runs.length ? runs[k + 1].sec : lastEnd) - x0 - 6, 5.8);
    if (text) names.push({ text, x: x0 + 3, x0, w: text.length * 5.8, label: run.label });
  });
  return names;
}

// The phase names drawTrialsStrip placed inside the strip at y, each on a
// patch of its phase's fill: drawn after the guides, so the patch hides the
// dashed lines under the name.
function drawTrialsStripNames(ctx, names, y) {
  if (!names.length) return;
  ctx.font = 'bold 9px sans-serif';
  for (const n of names) {
    ctx.fillStyle = n.fill;
    ctx.fillRect(n.x0 + 2, y + 6, n.w + 2, 12);
    ctx.fillStyle = C.phaseLabel;
    ctx.fillText(n.text, n.x, y + 15);
  }
}

// Text cut with an ellipsis to fit `room` px in the current font, as
// measured: the charts' titles, whose participant id can be any length.
// The cut starts from the share of the text that fits at its average width,
// so a very long id costs a few measures, not one per character.
export function fitWidth(ctx, text, room) {
  const full = ctx.measureText(text).width;
  if (full <= room) return text;
  let n = Math.min(text.length - 1, Math.floor((text.length * room) / full));
  while (n > 0 && ctx.measureText(text.slice(0, n) + '…').width > room) n--;
  return text.slice(0, n) + '…';
}

// Text cut with an ellipsis to fit `room` px at `perChar` px a character
// ('' when not even one character and the ellipsis fit).
function fitText(text, room, perChar) {
  const fit = Math.floor(room / perChar);
  if (text.length <= fit) return text;
  return fit >= 2 ? text.slice(0, fit - 1) + '…' : '';
}

// Diagonal lines over a rectangle, clipped to it: a trimmed page's band.
// Exported for typing-profile-core.js, whose one-bar-per-trial chart marks
// a trimmed page the same way.
export function hatch(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = C.trimmedHatch;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -h; d < w; d += 6) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

// Returns the Text input lane's "×N" counts (drawTextInput), which go on
// after the guides.
function drawLanes(ctx, L, rows, xScale, xDomain, chartW) {
  const events = L.events;
  let counts = [];
  for (const lane of rows.lanes) {
    drawLaneBackground(ctx, lane.y, chartW);
    drawLaneLabel(ctx, lane.y, lane.name);
    switch (lane.name) {
      case 'Text input':      counts = drawTextInput(ctx, lane.y, L.marks, xScale, xDomain); break;
      case 'Tab-aways':       drawTabAways(ctx, lane.y, events.tabAways, xScale, xDomain, events.tabFlickerCutoffMs); break;
      case 'Sidebars':        drawSidebars(ctx, lane.y, events.sidebarSpans, xScale, xDomain); break;
      case 'Viewport shifts': drawLayoutShifts(ctx, lane.y, events.layoutShifts, xScale, xDomain); break;
      case 'Guard-friction':  drawGuardViolations(ctx, lane.y, events.guardViolations, xScale, xDomain); break;
    }
  }
  return counts;
}

function drawLaneBackground(ctx, y, chartW) {
  ctx.fillStyle = C.laneBg;
  ctx.fillRect(LEFT_PAD, y, chartW, LANE_HEIGHT);
  ctx.strokeStyle = C.laneBorder;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(LEFT_PAD, y, chartW, LANE_HEIGHT);
}

function drawLaneLabel(ctx, y, text) {
  ctx.fillStyle = C.laneLabel;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(text, LEFT_PAD - 6, y + LANE_HEIGHT / 2 + 3);
  ctx.textAlign = 'left';
}

function tabColor(durationMs, flickerCutoffMs = 3000) {
  // Strict `<=` flicker boundary matches the runtime soft-scoring rule
  // (duration > cutoff counts) and summary.js's bins: a tab-away exactly at the
  // cutoff is a flicker, not a scored "meaningful" absence.
  if (durationMs <= flickerCutoffMs) return C.tabFlicker;
  if (durationMs < 10000) return C.tabMedium;
  return C.tabLong;
}

function drawTabAways(ctx, y, list, xScale, xDomain, flickerCutoffMs = 3000) {
  if (!Array.isArray(list)) return;
  for (const e of list) {
    if (!Number.isFinite(e.t_sec)) continue;
    // Allow events whose start is slightly negative if their end falls in-domain
    const endSec = e.t_sec + (e.duration_ms || 0) / 1000;
    if (endSec < 0 || e.t_sec > xDomain) continue;
    const clampedStart = Math.max(0, e.t_sec);
    const clampedEnd = Math.min(xDomain, endSec);
    const x = LEFT_PAD + clampedStart * xScale;
    // Bar width = duration clipped to domain (min 2px for visibility)
    const w = Math.max(2, (clampedEnd - clampedStart) * xScale);
    ctx.fillStyle = tabColor(e.duration_ms, flickerCutoffMs);
    ctx.fillRect(x, y + 4, w, LANE_HEIGHT - 8);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.4;
    ctx.strokeRect(x, y + 4, w, LANE_HEIGHT - 8);
  }
}

// A span is at least 3 px wide, so a short one stays visible; one that
// starts in the last 3 px of the chart is moved left to end at the lane's
// right border, never past it.
function drawSidebars(ctx, y, spans, xScale, xDomain) {
  if (!Array.isArray(spans)) return;
  const right = LEFT_PAD + xDomain * xScale;
  for (const s of spans) {
    if (!Number.isFinite(s.start_sec)) continue;
    const startSec = clamp(s.start_sec, 0, xDomain);
    const endSec = clamp(s.end_sec, startSec, xDomain);
    const w = Math.max(3, (endSec - startSec) * xScale);
    const x = Math.min(LEFT_PAD + startSec * xScale, right - w);
    ctx.fillStyle = C.sidebarSpan;
    ctx.fillRect(x, y + 6, w, LANE_HEIGHT - 12);
    if (!s.closed) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 0.5, y + 6.5, w - 1, LANE_HEIGHT - 13);
      ctx.setLineDash([]);
    }
  }
}

function drawLayoutShifts(ctx, y, list, xScale, xDomain) {
  if (!Array.isArray(list)) return;
  ctx.strokeStyle = C.layoutShift;
  ctx.lineWidth = 1.2;
  for (const e of list) {
    if (!Number.isFinite(e.t_sec)) continue;
    if (e.t_sec < 0 || e.t_sec > xDomain) continue;
    const x = LEFT_PAD + e.t_sec * xScale;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y + 4);
    ctx.lineTo(x + 0.5, y + LANE_HEIGHT - 4);
    ctx.stroke();
  }
}

function drawGuardViolations(ctx, y, list, xScale, xDomain) {
  if (!Array.isArray(list)) return;
  // Cluster nearby polls visually — tamper events fire every ~300ms during
  // a violation period. Group consecutive events within 500ms into one tick
  // to keep the lane readable.
  const groups = [];
  let cur = null;
  for (const v of list) {
    if (!Number.isFinite(v.t_sec)) continue;
    if (v.t_sec < 0 || v.t_sec > xDomain) continue;
    if (cur && (v.t_sec - cur.lastSec) < 0.6) {
      cur.lastSec = v.t_sec;
      cur.count++;
    } else {
      if (cur) groups.push(cur);
      cur = { firstSec: v.t_sec, lastSec: v.t_sec, count: 1, reason: v.reason };
    }
  }
  if (cur) groups.push(cur);

  for (const g of groups) {
    const x0 = LEFT_PAD + g.firstSec * xScale;
    const x1 = LEFT_PAD + g.lastSec * xScale;
    const w = Math.max(2, x1 - x0);
    ctx.fillStyle = C.guardViolation;
    ctx.fillRect(x0, y + 6, w, LANE_HEIGHT - 12);
  }
}

// The Text input lane: copies and cuts as orange ▼ near the top, pastes as
// red ▲ and drops as purple ◆ near the bottom, synthetic insertions (text
// that appeared with no key press, usually a script or an autofill) as thin
// indigo ticks with "×N" after a trial's last one. Marks outside the domain
// (an offset that could not be derived) are not drawn.
// The "×N" counts are returned, not drawn: drawInsertionCounts draws them
// after the guides, each on a patch (from y + 3 to y + 15), so no line runs
// through one. Each carries the copies whose ▼ (10 px wide, from y + 6.5 to
// y + 15) its patch would cover, to be drawn again over it; pastes and
// drops sit under the patch.
function drawTextInput(ctx, y, marks, xScale, xDomain) {
  const inDomain = (sec) => Number.isFinite(sec) && sec >= 0 && sec <= xDomain;
  const X = (sec) => LEFT_PAD + sec * xScale;
  const copies = marks.copies.filter((m) => inDomain(m.sec)).map((m) => X(m.sec));
  const counts = [];
  for (const g of marks.synthetic) {
    const secs = g.secs.filter(inDomain);
    if (!secs.length) continue;
    ctx.strokeStyle = C.synthetic;
    ctx.lineWidth = 1;
    for (const sec of secs) {
      ctx.beginPath();
      ctx.moveTo(X(sec) + 0.5, y + 4);
      ctx.lineTo(X(sec) + 0.5, y + LANE_HEIGHT - 4);
      ctx.stroke();
    }
    const text = `×${secs.length}`;
    const x = X(secs[secs.length - 1]) + 3;
    const w = text.length * 5.8;
    counts.push({ text, x, y, w, copies: copies.filter((cx) => cx + 5 > x - 1 && cx - 5 < x + w + 1) });
  }
  for (const cx of copies) triangle(ctx, cx, y + 10, false, C.copy);
  for (const m of marks.pastes) if (inDomain(m.sec)) triangle(ctx, X(m.sec), y + LANE_HEIGHT - 10, true, C.paste);
  for (const m of marks.drops) if (inDomain(m.sec)) diamond(ctx, X(m.sec), y + LANE_HEIGHT - 10, C.drop);
  return counts;
}

// The "×N" counts drawTextInput placed (bold 9 px, about 5.8 px a
// character, at y + 12 in the lane at y), each on a patch of the lane's
// colour drawn after the guides, as the phase names in the Trials strip
// are: a guide that crosses a count stops at its patch. A copy's ▼ the
// patch covers is drawn again on top: a mark is evidence, and stays visible.
function drawInsertionCounts(ctx, counts) {
  for (const c of counts) {
    ctx.fillStyle = C.laneBg;
    ctx.fillRect(c.x - 1, c.y + 3, c.w + 2, 12);
    ctx.fillStyle = C.synthetic;
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(c.text, c.x, c.y + 12);
    for (const cx of c.copies) triangle(ctx, cx, c.y + 10, false, C.copy);
  }
}

// A filled triangle centred on (x, y), pointing up or down.
function triangle(ctx, x, y, up, color, size = 5) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (up) { ctx.moveTo(x, y - size); ctx.lineTo(x - size, y + size * 0.7); ctx.lineTo(x + size, y + size * 0.7); }
  else { ctx.moveTo(x, y + size); ctx.lineTo(x - size, y - size * 0.7); ctx.lineTo(x + size, y - size * 0.7); }
  ctx.closePath();
  ctx.fill();
}

// A filled diamond centred on (x, y).
function diamond(ctx, x, y, color, r = 5) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

// The block's guides (timeline-layout.js guides), on either image: a light
// dashed line at each trial start, a dark dashed one at each phase change,
// from topY to bottomY. X maps seconds to the image's x, the same on both
// images (TIMELINE_GEOMETRY). Exported for typing-profile-core.js.
export function drawGuideLines(ctx, g, X, xDomain, topY, bottomY) {
  const line = (sec, style) => {
    if (!Number.isFinite(sec) || sec < 0 || sec > xDomain) return;
    const x = Math.round(X(sec)) + 0.5;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash);
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, bottomY);
    ctx.stroke();
  };
  ctx.save();
  for (const sec of g.trialStarts) line(sec, GUIDE.trial);
  for (const run of g.phaseChanges) line(run.sec, GUIDE.phase);
  ctx.restore();
}

// Dashed vertical guides at each rule boundary (= start of each gallery phase).
// Numbered so it's easy to see which rule occupies which column: inside the
// top of the gallery band on the Phases strip when it is drawn (stripY: the
// 6 px gap under the strip has no room for a 9 px label), else just above
// the lines.
// Skipped if there are < 2 galleries (e.g., trial-fields-stripped fallback).
function drawPhaseGuides(ctx, phases, xScale, xDomain, topY, bottomY, stripY = null) {
  const galleries = phases.filter(p => p.type === 'gallery'
    && Number.isFinite(p.startSec)
    && p.startSec >= 0
    && p.startSec <= xDomain);
  if (galleries.length < 2) return;

  ctx.save();
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 0.7;
  ctx.setLineDash([3, 3]);
  ctx.fillStyle = '#555';
  ctx.font = '9px sans-serif';
  ctx.textAlign = stripY === null ? 'center' : 'left';

  for (let i = 0; i < galleries.length; i++) {
    const g = galleries[i];
    const x = LEFT_PAD + g.startSec * xScale + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, bottomY);
    ctx.stroke();
    // Rule number label: in the gallery band, or just above the lanes
    if (stripY === null) ctx.fillText(`r${i + 1}`, x, topY - 2);
    else ctx.fillText(`r${i + 1}`, x + 3, stripY + 11);
  }

  ctx.restore();
  ctx.textAlign = 'left';
}

function drawXAxis(ctx, xDomain, chartW, canvasH) {
  const tickCount = 8;
  const yBase = canvasH - BOTTOM_PAD + 6;
  ctx.strokeStyle = C.xAxis;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(LEFT_PAD, yBase);
  ctx.lineTo(LEFT_PAD + chartW, yBase);
  ctx.stroke();

  ctx.fillStyle = C.xAxis;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= tickCount; i++) {
    const sec = (xDomain / tickCount) * i;
    const x = LEFT_PAD + sec * (chartW / xDomain);
    ctx.strokeStyle = C.xTick;
    ctx.beginPath();
    ctx.moveTo(x, yBase);
    ctx.lineTo(x, yBase + 4);
    ctx.stroke();
    ctx.fillText(formatSec(sec), x, yBase + 16);
  }
  ctx.textAlign = 'left';
}

function formatSec(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

// The legend's rows, right-aligned at y 16, 28 and 40 (9 px): each item's
// label x, and the row's left edge, its first item's swatch (or its label
// when it has no colour). The title, bold 14 px at y 22, shares its line
// with the first two rows.
function placeLegend(ctx, L) {
  const events = L.events;
  // Right-aligned legend rows: the phase bands (only with the Phases strip),
  // the lanes' event types, then the Text input marks. One row per group
  // never truncates (the old single-line version dropped the leftmost
  // entries when they overflowed).
  const phaseItems = [
    { color: C.phasePre, label: 'framing (pre / transition / post)' },
    { color: C.phaseGallery, label: 'gallery' },
    { color: C.phaseTyping, label: 'typing' },
    { color: C.phaseClass, label: 'classification' },
  ];
  // Tab-away legend reflects THIS participant's cutoff (e.g. 5s for strict), not a
  // hardcoded 3s, matching the color bins and summary.csv counts.
  const cutoffS = Math.round((events.tabFlickerCutoffMs ?? 3000) / 1000);
  const eventItems = [
    { color: C.tabFlicker, label: `tab ≤${cutoffS}s` },
    { color: C.tabMedium, label: `tab ${cutoffS}–10s` },
    { color: C.tabLong, label: 'tab ≥10s' },
    { color: C.sidebarSpan, label: 'sidebar (open span)' },
    { color: C.layoutShift, label: 'viewport shift' },
    { color: C.guardViolation, label: 'guard-friction' },
  ];
  const inputItems = [
    { color: C.copy, label: 'copy / cut', shape: 'down' },
    { color: C.paste, label: 'paste', shape: 'up' },
    { color: C.drop, label: 'drop', shape: 'diamond' },
    { color: C.synthetic, label: 'synthetic insertion', shape: 'tick' },
  ];
  // A crowded session draws no trial-start lines (timeline-layout.js
  // guides); the legend says so, in a text-only item at the end of the last
  // row.
  const hidden = L.guides.trialLinesHidden;
  if (hidden > 0) inputItems.push({ label: `trial lines hidden (${hidden} trials)` });
  ctx.font = '9px sans-serif';
  const legendRows = (L.galleryPhases ? [phaseItems] : []).concat([eventItems, inputItems]);
  return legendRows.map((items, i) => placeLegendRow(ctx, items, 16 + 12 * i));
}

function drawLegendAndFooter(ctx, p, L, canvasH, legend) {
  const events = L.events;
  ctx.font = '9px sans-serif';
  for (const row of legend) drawLegendRow(ctx, row);

  // Footer summary
  const fY = canvasH - BOTTOM_PAD + 38;
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#333';
  const tabSessTotal = events.sessionTabDurations.length;
  const flickerCutoffMs = events.tabFlickerCutoffMs ?? 3000;
  // "Meaningful" = scored = strictly longer than the cutoff (matches the runtime).
  const tabSessLong = events.sessionTabDurations.filter(d => d > flickerCutoffMs).length;
  const cutoffSecLabel = `${Math.round(flickerCutoffMs / 1000)}s`;
  const sb = events.sidebarSpans.length;
  const ls = events.layoutShifts.length;
  const gf = events.guardViolations.length;

  // Sidebar counts: the footer reports the OPENING count — the same
  // `countSidebarOpenings()` value summary.csv's `sidebar_event_count` and triage
  // use, so the timeline and the CSV agree. `sb` (sidebarSpans) is the number of
  // open→close spans actually DRAWN, which can exceed openings when one physical
  // sidebar is double-detected (innerWidth_delta + layout_compression).
  const sidebarOpenings = countSidebarOpenings(p.session?.sidebarEvents);
  const spanNote = sb !== sidebarOpenings ? ` (${sb} span${sb === 1 ? '' : 's'} drawn)` : '';
  // Tab-away note depends on what the payload could offer: libraries ≥0.6.1
  // save session-level tabAwayEvents so every tab-away (on-trial or off)
  // plots; older payloads keep off-trial tab-aways as durations only, and
  // the footer flags how many are unplaceable on the axis.
  const tabNote = events.tabAwaySource === 'session'
    ? `All ${events.tabAways.length} plotted from session-level events (incl. off-trial)`
    : `Per-trial events plotted: ${events.tabAways.length}    ` +
      `Off-trial events: ${events.offTrialTabAwayCount} (timing not preserved — pre-0.6.1 payload)`;
  const m = L.marks;
  const synthN = m.synthetic.reduce((n, g) => n + g.count, 0);
  // Pages a Qualtrics payload too large for its field kept without their
  // events (hatched on the Trials strip): their marks are missing from the
  // lanes. Counted from the bars, which carry the flag aligned or not.
  const trimmed = L.bars.filter((b) => b.truncated).length;
  const trimmedNote = trimmed > 0
    ? `    events of ${trimmed} trial${trimmed === 1 ? '' : 's'} not kept by the Qualtrics payload` : '';
  const lines = [
    `Tab-aways  total=${tabSessTotal}  (> ${cutoffSecLabel}: ${tabSessLong})    ` + tabNote,
    `Sidebars  ${sidebarOpenings} opening${sidebarOpenings === 1 ? '' : 's'}${spanNote}    ` +
      `Viewport shifts  ${ls}    Guard-friction violations  ${gf}`,
    `Text input (inside trials)  copies/cuts ${m.copies.length}    pastes ${m.pastes.length}    ` +
      `drops ${m.drops.length}    synthetic insertions ${synthN}` + trimmedNote,
  ];
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], LEFT_PAD, fY + i * 14);
  }
}

// Right-aligned legend row. Never truncates; if items overflow, they extend
// leftward past the chart midpoint rather than being silently dropped. An
// item without a colour is text only; one with a colour has its 9 px swatch
// 5 px left of its label, and 12 px more to the next item.
function placeLegendRow(ctx, items, yText) {
  let lx = CANVAS_W - RIGHT_PAD;
  const places = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    lx -= ctx.measureText(it.label).width;
    places.push({ it, x: lx });
    lx -= it.color ? 17 : 14;
  }
  const first = places[places.length - 1];
  const left = first ? first.x - (first.it.color ? 14 : 0) : CANVAS_W - RIGHT_PAD;
  return { yText, places, left };
}

// A placed row (placeLegendRow), drawn right to left.
function drawLegendRow(ctx, row) {
  for (const { it, x } of row.places) {
    ctx.fillStyle = '#333';
    ctx.fillText(it.label, x, row.yText);
    if (it.color) drawSwatch(ctx, it, x - 14, row.yText - 7);
  }
}

// A 9×8 legend swatch at (x, y): a framed square, or the mark's own shape.
function drawSwatch(ctx, it, x, y) {
  const cx = x + 4.5, cy = y + 4;
  if (it.shape === 'down') triangle(ctx, cx, cy, false, it.color, 4);
  else if (it.shape === 'up') triangle(ctx, cx, cy, true, it.color, 4);
  else if (it.shape === 'diamond') diamond(ctx, cx, cy, it.color, 4);
  else if (it.shape === 'tick') {
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx, y + 8);
    ctx.stroke();
  } else {
    ctx.fillStyle = it.color;
    ctx.fillRect(x, y, 9, 8);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 0.4;
    ctx.strokeRect(x, y, 9, 8);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────
// report-core.js builds the per-participant PNG filename with this; the
// rule is the report page's own (report-id.js), so the link always matches.
export { sanitize } from './report-id.js';
export function shortId(name) {
  return String(name).slice(0, 8);
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
