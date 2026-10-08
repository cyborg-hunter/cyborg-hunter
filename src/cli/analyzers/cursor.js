// src/cli/analyzers/cursor.js
// The report's cursor section: three browser-reported checks, one reported
// rule and the shape of each movement, from the core's per-trial mouse
// samples. Pure: no DOM, no I/O. Imported by the lab's calibration bench by
// this path (cyborg-hunter/src/cli/analyzers/cursor.js); keep the exports
// stable or update the bench with the change.
//
// Checks (flagged): the automation flag the browser sets (navigator.webdriver),
// clicks the page's own scripts dispatched (isTrusted false), and trials
// clicked without pointer movement. Reported without a verdict: clicks after a
// pointer jump (a movement that starts far from where the pointer was last
// seen) and the per-movement features. Every constant lives in CURSOR_LIMITS
// with its meaning, and the report writes them beside the results.

import { pathLength, displacement, maxDeviation } from '../../shared/cursor-geometry.js';

export const CURSOR_LIMITS = {
  movementGapMs:     { value: 400,  meaning: 'Two move samples more than this many milliseconds apart belong to different movements; a click ends the movement it follows.' },
  staleGapMs:        { value: 2000, meaning: 'When nothing is recorded for longer than this (between trials, or during a tab-away), the last known pointer position is forgotten.' },
  samePositionPx:    { value: 20,   meaning: 'A click within this many pixels of the last known position was made without moving, and is not a trial clicked without pointer movement.' },
  discontinuityPx:   { value: 100,  meaning: 'A movement ending in a click that starts at least this many pixels from the last known position is a click after a pointer jump.' },
  minSamplesForShape:{ value: 2,    meaning: 'A movement needs at least this many move samples to contribute to the shape features.' }
};

const NOT_RECORDED = 'not recorded';
const MAX_IDS = 10;

function limitsOf(config) {
  const out = {};
  for (const [k, v] of Object.entries(CURSOR_LIMITS)) out[k] = (config && config.cursorLimits && typeof config.cursorLimits[k] === 'number') ? config.cursorLimits[k] : v.value;
  return out;
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const stat = (values) => ({ median: median(values), n: values.length });

// Splits a trial's events into movements: runs of move samples whose gaps
// stay within movementGapMs; a click closes the run it follows (and a click
// with no run before it is a movement with no samples). Returns
// [{ samples, click }] in time order.
export function segmentMovements(events, limits) {
  const gap = typeof limits.movementGapMs === 'object' ? limits.movementGapMs.value : limits.movementGapMs;
  const out = [];
  let cur = null;
  const sorted = events.slice().sort((a, b) => a.t - b.t);
  for (const e of sorted) {
    if (e.type === 'move') {
      if (!cur || cur.click || (cur.samples.length && e.t - cur.samples[cur.samples.length - 1].t > gap)) {
        cur = { samples: [], click: null };
        out.push(cur);
      }
      cur.samples.push(e);
    } else if (e.type === 'click') {
      if (!cur || cur.click) { cur = { samples: [], click: null }; out.push(cur); }
      cur.click = e;
    }
  }
  return out;
}

// Which coordinates a session can be judged in: viewport ones when every
// sample has them, page ones otherwise (older data; scrolling then looks
// like motion, so the position is forgotten at each trial boundary).
function coordinateMode(trials) {
  for (const t of trials) for (const e of t.mouseEvents || []) {
    if (typeof e.cx !== 'number' || typeof e.cy !== 'number') return 'page';
  }
  return 'viewport';
}
const pos = (e, mode) => mode === 'viewport' ? { x: e.cx, y: e.cy } : { x: e.x, y: e.y };

// A click's kind from what the browser recorded about it. Older data has no
// provenance: every click is then a pointer click for the rules, and the
// checks are not recorded.
function clickKind(e) {
  if (e.trusted === false) return 'untrusted';
  if (e.detail === 0) return 'keyboard';
  return 'pointer';
}

function versionNote(trials) {
  const v = trials.map(t => t && t.libraryVersion).find(Boolean);
  return v ? ` (recorded with ${v})` : '';
}

export function analyzeCursorForParticipant(participant, config) {
  const L = limitsOf(config);
  const trials = participant.trials || [];
  const device = participant.session && participant.session.device && typeof participant.session.device === 'object' ? participant.session.device : null;
  const recorded = !!device;
  const webdriver = recorded ? { fired: device.webdriver === true } : NOT_RECORDED;
  // With a device object every check is an object, in every state; without
  // one all three are not recorded. `trials` counts the trials involved
  // before the ten-id cap (a count of clicks can exceed it).
  const zeroCount = () => ({ count: 0, of: 0, trialIds: [], trials: 0, fired: false });

  // checksRecorded: 3 when the stream is there and a device object exists;
  // 1 in a state with no cursor stream (only the automation flag can run);
  // 0 without a device object.
  const base = {
    participantId: participant.participantId,
    checksRecorded: recorded ? 1 : 0,
    checks: recorded
      ? { webdriver, untrustedClicks: zeroCount(), zeroMoveTrials: zeroCount() }
      : { webdriver, untrustedClicks: NOT_RECORDED, zeroMoveTrials: NOT_RECORDED },
    factCount: recorded ? (device.webdriver === true ? 1 : 0) : null,
    cursor: null,
    cursorReason: null
  };

  const hasTrack = trials.some(t => Array.isArray(t.mouseEvents));
  if (!hasTrack) return { ...base, state: 'not collected', cursorReason: 'not collected' + versionNote(trials) };
  if (device && device.maxTouchPoints > 0 && device.coarsePointer === true) {
    return { ...base, state: 'no cursor stream (touch device)', cursorReason: 'no cursor stream (touch device)' };
  }
  // Presses and releases alone (down, up) are not a cursor stream.
  const anyPointerEvents = trials.some(t => (t.mouseEvents || []).some(e => e.type === 'move' || e.type === 'click'));
  if (!anyPointerEvents) return { ...base, state: 'no cursor stream (no pointer events)', cursorReason: 'no cursor stream (no pointer events)' };

  const mode = coordinateMode(trials);
  const last = { x: 0, y: 0, valid: false };
  const forget = () => { last.valid = false; };
  const see = (p) => { last.x = p.x; last.y = p.y; last.valid = true; };

  const untrusted = { count: 0, of: 0, trialIds: [], trials: 0 };
  const zeroMove = { count: 0, of: 0, trialIds: [], trials: 0 };
  const jump = { count: 0, of: 0, trialIds: [], trials: 0 };
  let keyboardClicks = 0, movementsTotal = 0, clicksTotal = 0, cappedTrials = 0;
  const f = { durationMs: [], pathPx: [], displacementPx: [], speedPxS: [], efficiency: [], maxDeviationPx: [] };
  const movesPerTrial = [], movementsPerTrial = [], gaps = [];
  let prevEnd = null;

  for (const t of trials) {
    const events = t.mouseEvents || [];
    // Between trials nothing is recorded: a long gap forgets the position.
    if (prevEnd != null && typeof t.startTime === 'number' && t.startTime - prevEnd > L.staleGapMs) forget();
    if (mode === 'page') forget();
    if (typeof t.startTime === 'number' && typeof t.duration_ms === 'number') prevEnd = t.startTime + t.duration_ms; else prevEnd = null;
    if (t.mouseTrackingCapped === true) cappedTrials++;
    zeroMove.of++;

    const tabAways = (t.tabAwayEvents || []).map(a => a.startRel_ms ?? a.start).filter(v => typeof v === 'number').sort((a, b) => a - b);
    let tabIdx = 0;
    const movements = segmentMovements(events, L);
    const moves = events.filter(e => e.type === 'move');
    movesPerTrial.push(moves.length);
    movementsPerTrial.push(movements.length);
    movementsTotal += movements.length;
    for (let i = 1; i < moves.length; i++) { const d = moves[i].t - moves[i - 1].t; if (d > 0) gaps.push(d); }

    let pointerClicksHere = 0, unexplainedPointerClick = false, untrustedHere = false, jumpHere = false;
    let cp;
    for (const m of movements) {
      const first = m.samples[0] || m.click;
      // A tab-away before this movement forgets the position.
      while (tabIdx < tabAways.length && tabAways[tabIdx] <= first.t) { forget(); tabIdx++; }

      if (m.samples.length >= L.minSamplesForShape) {
        const pts = m.samples.map(e => pos(e, mode));
        const duration = m.samples[m.samples.length - 1].t - m.samples[0].t;
        const path = pathLength(pts);
        f.durationMs.push(duration);
        f.pathPx.push(path);
        f.displacementPx.push(displacement(pts));
        if (duration > 0) f.speedPxS.push(path / duration * 1000);
        if (path > 0) f.efficiency.push(displacement(pts) / path);
        f.maxDeviationPx.push(maxDeviation(pts));
      }

      if (m.click) {
        clicksTotal++;
        const kind = clickKind(m.click);
        cp = pos(m.click, mode);
        if (kind === 'untrusted') { untrusted.count++; untrustedHere = true; if (!untrusted.trialIds.includes(t.trialId)) untrusted.trialIds.push(t.trialId); }
        else if (kind === 'keyboard') keyboardClicks++;
        else {
          pointerClicksHere++;
          const startP = pos(first, mode);
          jump.of++;
          if (last.valid && dist(startP, last) >= L.discontinuityPx) { jump.count++; jumpHere = true; if (!jump.trialIds.includes(t.trialId)) jump.trialIds.push(t.trialId); }
          if (moves.length === 0 && !(last.valid && dist(cp, last) <= L.samePositionPx)) unexplainedPointerClick = true;
        }
        untrusted.of++;
      }
      for (const s of m.samples) see(pos(s, mode));
      if (m.click) see(cp);
    }
    // A tab-away after the trial's last movement (or in a trial with none)
    // forgets the position too.
    if (tabIdx < tabAways.length) forget();
    if (moves.length === 0 && pointerClicksHere > 0 && unexplainedPointerClick) { zeroMove.count++; zeroMove.trials++; zeroMove.trialIds.push(t.trialId); }
    if (untrustedHere) untrusted.trials++;
    if (jumpHere) jump.trials++;
  }

  const cap = (ids) => ids.slice(0, MAX_IDS);
  const checks = recorded ? {
    webdriver,
    untrustedClicks: { count: untrusted.count, of: untrusted.of, trialIds: cap(untrusted.trialIds), trials: untrusted.trials, fired: untrusted.count > 0 },
    zeroMoveTrials: { count: zeroMove.count, of: zeroMove.of, trialIds: cap(zeroMove.trialIds), trials: zeroMove.trials, fired: zeroMove.count > 0 }
  } : base.checks;
  const factCount = recorded ? [checks.webdriver.fired, checks.untrustedClicks.fired, checks.zeroMoveTrials.fired].filter(Boolean).length : null;

  return {
    ...base, state: 'ok', checksRecorded: recorded ? 3 : 0, checks, factCount,
    cursor: {
      stream: 'core', sampleIntervalMs: median(gaps), coordinates: mode,
      rules: { jumpClicks: { count: jump.count, of: jump.of, trialIds: cap(jump.trialIds), trials: jump.trials }, centeredClicks: null },
      features: {
        durationMs: stat(f.durationMs), pathPx: stat(f.pathPx), displacementPx: stat(f.displacementPx),
        speedPxS: stat(f.speedPxS), efficiency: stat(f.efficiency), maxDeviationPx: stat(f.maxDeviationPx),
        movesPerTrial: stat(movesPerTrial), movementsPerTrial: stat(movementsPerTrial), keyboardClicks
      },
      movements: movementsTotal, clicks: clicksTotal, cappedTrials, trials: trials.length
    }
  };
}

// One result per participant, in order (the shape report-core attaches to
// each summary). `config.cursorLimits` may override a constant by name.
export function analyzeCursor(participants, config) {
  return participants.map(p => analyzeCursorForParticipant(p, config));
}
