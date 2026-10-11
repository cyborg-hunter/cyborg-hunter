// src/cli/analyzers/cursor.js
// The report's cursor section: three browser-reported checks, two rules,
// the shape of each movement and the pointer verdict, from the core's
// per-trial mouse samples. Pure: no DOM, no I/O. Imported by the lab's
// calibration bench by this path (cyborg-hunter/src/cli/analyzers/cursor.js);
// keep the exports stable or update the bench with the change.
//
// Checks (browser-reported): the automation flag the browser sets
// (navigator.webdriver), clicks the page's own scripts dispatched (isTrusted
// false), and trials clicked without pointer movement. Rules: clicks that
// arrived without a path (a first click whose movement has at most one
// sample, starting away from where the pointer was last seen: a scripted
// cursor appears at its target) and clicks after a pointer jump, both judged
// on clicks with a known position before them. Features:
// the shape of each movement. The pointer verdict (assess) reads the checks
// and the rules against the shares in CURSOR_LIMITS; every constant lives
// there with its meaning, and the report writes them beside the results.

import { pathLength, displacement, maxDeviation } from '../../shared/cursor-geometry.js';

export const CURSOR_LIMITS = {
  movementGapMs:         { value: 400,  meaning: 'Two move samples more than this many milliseconds apart belong to different movements; a click ends the movement it follows.' },
  staleGapMs:            { value: 2000, meaning: 'When nothing is recorded for longer than this many milliseconds between trials, the last known pointer position is forgotten; a tab-away forgets it at once.' },
  samePositionPx:        { value: 20,   meaning: 'A click closer than this many pixels to the last known position was made without moving, and is not a trial clicked without pointer movement. A first click whose movement has at most one sample and starts at least this far from the last known position arrived without a path.' },
  discontinuityPx:       { value: 100,  meaning: 'A movement ending in a click that starts at least this many pixels from the last known position is a click after a pointer jump.' },
  minSamplesForShape:    { value: 2,    meaning: 'A movement needs at least this many move samples to contribute to the shape features.' },
  minClicksForVerdict:   { value: 4,    meaning: 'A session needs at least this many first pointer clicks with a known position before them (the later clicks of a double- or triple-click are not counted; a click whose movement is the first since the session began, since more than staleGapMs passed unrecorded between trials, since a tab-away or, in page coordinates, since its trial began has no known position) before clicks that arrived without a path are judged, and this many first pointer clicks of any kind before trials clicked without pointer movement are; with too few of the former, and no tell against it, the session is not assessed.' },
  shareSuspicious:       { value: 0.2,  meaning: 'The share of first pointer clicks with a known position that arrived without a path, or of trials clicked without pointer movement, at or above which that tell makes the session suspicious. Provisional: set from a small number of sessions.' },
  shareHighlySuspicious: { value: 0.5,  meaning: 'The share of first pointer clicks with a known position that arrived without a path, of trials clicked without pointer movement, or of clicks the page’s own scripts dispatched, at or above which that tell makes the session highly suspicious. Provisional, like shareSuspicious.' }
};

const NOT_RECORDED = 'not recorded';
const MAX_IDS = 10;

// The values of a limits object shaped like CURSOR_LIMITS ({ name: { value,
// meaning } }), by name: what the analysis judges with, and what each result
// carries so the section can print the constants that judged it.
function valuesOf(limits) {
  const out = {};
  for (const k of Object.keys(CURSOR_LIMITS)) out[k] = limits[k].value;
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

// A click's kind from what the browser recorded about it, in this order:
// trusted false is a click the page's own scripts dispatched; else detail 0
// is keyboard activation; else pointerType 'touch' is a touch tap (counted,
// never a pointer click, so it neither fires the zero-move check nor counts
// in the jump rule); any other click is a pointer click. Older data has no
// provenance: every click is then a pointer click for the rules, and the
// checks are not recorded.
function clickKind(e) {
  if (e.trusted === false) return 'untrusted';
  if (e.detail === 0) return 'keyboard';
  if (e.pointerType === 'touch') return 'touch';
  return 'pointer';
}

// The later clicks of a double- or triple-click (detail 2, 3, …) start where
// their first click ended: only first clicks count for the rules and the
// verdict. A click with no detail (older data) is a first click.
const isFirstClick = (e) => !(typeof e.detail === 'number' && e.detail >= 2);

const VERDICTS = ['not assessed', 'clean', 'suspicious', 'highly suspicious'];
// The word for a level: -1 not assessed, 0 clean, 1 suspicious, 2 highly suspicious.
export const verdictWord = (level) => VERDICTS[level + 1];

// The pointer verdict over a result: the tells that count against the
// session — each with its level ('high' makes the session highly
// suspicious, 'low' suspicious), its sentence for the page, its short form
// for the triage reason and the CSV, and the trials involved — and the
// level they add up to, with the reason when the session is not assessed.
// The browser facts (the automation flag, clicks the page's own scripts
// dispatched) are judged whatever the number of clicks; clicks that arrived
// without a path need minClicksForVerdict first pointer clicks with a known
// position before them, trials clicked without pointer movement that many
// first pointer clicks of any kind. The order of the tells is the order here.
function assess(result, L) {
  const share = (x) => x.of > 0 ? x.count / x.of : 0;
  // Rounded down, so the printed percent never reaches a threshold the level
  // did not; computed from the counts (100 * count / of), since
  // 100 * (29 / 100) is 28.999… in floating point.
  const pct = (x) => `${x.of > 0 ? Math.floor(100 * x.count / x.of) : 0}%`;
  const tells = [];
  // trialIds: the first ten trials involved; trials: how many there were.
  const tell = (id, level, text, short, trialIds = [], trials = 0) => tells.push({ id, level, text, short, trialIds, trials });
  const done = (level, reason = null) => ({ level, verdict: verdictWord(level), tells, verdictReason: reason });
  const c = result.checks;
  if (c.webdriver && c.webdriver.fired) tell('webdriver', 'high', 'automation flag set by the browser', 'automation flag');
  if (result.state !== 'ok') return tells.length ? done(2) : done(-1, result.cursorReason);
  if (result.checksRecorded === 0) return done(-1, 'device facts and click provenance not recorded (library before 0.14)');
  const u = c.untrustedClicks;
  if (u.count > 0) {
    tell('untrusted', share(u) >= L.shareHighlySuspicious ? 'high' : 'low',
      `clicks the page’s own scripts dispatched: ${u.count} of ${u.of} (${pct(u)})`, `untrusted clicks ${u.count}/${u.of}`, u.trialIds, u.trials);
  }
  // The no-path tell is judged from minClicksForVerdict first clicks with a
  // known position before them (noPathClicks.of); trials clicked without
  // pointer movement from that many first clicks of any kind (a lone click
  // after an unrecorded gap is unexplained whatever the position). A session
  // where the no-path tell cannot be judged, and no tell is against it, is
  // not assessed.
  const n = result.cursor.rules.noPathClicks;
  const total = result.cursor.firstClicks;
  const noPathJudged = n.of >= L.minClicksForVerdict;
  if (noPathJudged && share(n) >= L.shareSuspicious) {
    tell('noPath', share(n) >= L.shareHighlySuspicious ? 'high' : 'low',
      `clicks that arrived without a path: ${n.count} of ${n.of} first clicks with a known position (${pct(n)})`, `clicks without a path ${n.count}/${n.of}`, n.trialIds, n.trials);
  }
  if (total >= L.minClicksForVerdict) {
    const z = c.zeroMoveTrials;
    if (share(z) >= L.shareSuspicious) {
      tell('zeroMove', share(z) >= L.shareHighlySuspicious ? 'high' : 'low',
        `trials clicked without pointer movement: ${z.count} of ${z.of} (${pct(z)})`, `trials clicked without movement ${z.count}/${z.of}`, z.trialIds, z.trials);
    }
  }
  if (tells.some(t => t.level === 'high')) return done(2);
  if (tells.length) return done(1);
  if (noPathJudged) return done(0);
  // No comma in this reason: it is a summary.csv cell.
  return done(-1, `only ${n.of} of ${total} first pointer click${total === 1 ? '' : 's'} had a known position before them (the no-path rule needs ${L.minClicksForVerdict})`);
}

function versionNote(trials) {
  const v = trials.map(t => t && t.libraryVersion).find(Boolean);
  return v ? ` (recorded with ${v})` : '';
}

// limits: an object shaped like CURSOR_LIMITS (the lab's bench passes its
// own; the report passes nothing and gets the defaults).
export function analyzeCursorForParticipant(participant, limits = CURSOR_LIMITS) {
  const L = valuesOf(limits);
  const finish = (r) => ({ ...r, ...assess(r, L) });
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
    cursorReason: null,
    limits: L
  };

  const hasTrack = trials.some(t => Array.isArray(t.mouseEvents));
  if (!hasTrack) return finish({ ...base, state: 'not collected', cursorReason: 'not collected' + versionNote(trials) });
  if (device && device.maxTouchPoints > 0 && device.coarsePointer === true) {
    return finish({ ...base, state: 'no cursor stream (touch device)', cursorReason: 'no cursor stream (touch device)' });
  }
  // Presses and releases alone (down, up) are not a cursor stream.
  const anyPointerEvents = trials.some(t => (t.mouseEvents || []).some(e => e.type === 'move' || e.type === 'click'));
  if (!anyPointerEvents) return finish({ ...base, state: 'no cursor stream (no pointer events)', cursorReason: 'no cursor stream (no pointer events)' });

  const mode = coordinateMode(trials);
  const last = { x: 0, y: 0, valid: false };
  const forget = () => { last.valid = false; };
  const see = (p) => { last.x = p.x; last.y = p.y; last.valid = true; };

  const untrusted = { count: 0, of: 0, trialIds: [], trials: 0 };
  const zeroMove = { count: 0, of: 0, trialIds: [], trials: 0 };
  const jump = { count: 0, of: 0, trialIds: [], trials: 0 };
  const noPath = { count: 0, of: 0, trialIds: [], trials: 0 };
  let keyboardClicks = 0, touchClicks = 0, movementsTotal = 0, clicksTotal = 0, cappedTrials = 0;
  let firstClicks = 0;
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

    let pointerClicksHere = 0, unexplainedPointerClick = false, untrustedHere = false, jumpHere = false, noPathHere = false;
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

      const kind = m.click ? clickKind(m.click) : null;
      if (m.click) {
        clicksTotal++;
        cp = pos(m.click, mode);
        if (kind === 'untrusted') { untrusted.count++; untrustedHere = true; if (!untrusted.trialIds.includes(t.trialId)) untrusted.trialIds.push(t.trialId); }
        else if (kind === 'keyboard') keyboardClicks++;
        else if (kind === 'touch') touchClicks++;
        else {
          pointerClicksHere++;
          const startP = pos(first, mode);
          if (isFirstClick(m.click)) {
            firstClicks++;
            // Both rules compare the movement's start with where the pointer
            // was last seen, so only a click with a known position before it
            // can be judged: a click whose movement is the first since the
            // position was forgotten (at the session's start, after more than
            // staleGapMs unrecorded between trials or a tab-away, and at every
            // trial in page coordinates) has none and leaves the denominators.
            if (last.valid) {
              jump.of++;
              noPath.of++;
              if (dist(startP, last) >= L.discontinuityPx) { jump.count++; jumpHere = true; if (!jump.trialIds.includes(t.trialId)) jump.trialIds.push(t.trialId); }
              // Arrived without a path: at most one sample, starting away
              // from where the pointer was last seen.
              if (m.samples.length <= 1 && dist(startP, last) >= L.samePositionPx) { noPath.count++; noPathHere = true; if (!noPath.trialIds.includes(t.trialId)) noPath.trialIds.push(t.trialId); }
            }
          }
          if (moves.length === 0 && !(last.valid && dist(cp, last) < L.samePositionPx)) unexplainedPointerClick = true;
        }
        untrusted.of++;
      }
      for (const s of m.samples) see(pos(s, mode));
      // Only a click the pointer made moves the last known position: a
      // keyboard activation or a click the page's own scripts dispatched
      // carries no pointer position (its coordinates are often 0, 0).
      if (m.click && (kind === 'pointer' || kind === 'touch')) see(cp);
    }
    // A tab-away after the trial's last movement (or in a trial with none)
    // forgets the position too.
    if (tabIdx < tabAways.length) forget();
    if (moves.length === 0 && pointerClicksHere > 0 && unexplainedPointerClick) { zeroMove.count++; zeroMove.trials++; zeroMove.trialIds.push(t.trialId); }
    if (untrustedHere) untrusted.trials++;
    if (jumpHere) jump.trials++;
    if (noPathHere) noPath.trials++;
  }

  const cap = (ids) => ids.slice(0, MAX_IDS);
  const checks = recorded ? {
    webdriver,
    untrustedClicks: { count: untrusted.count, of: untrusted.of, trialIds: cap(untrusted.trialIds), trials: untrusted.trials, fired: untrusted.count > 0 },
    zeroMoveTrials: { count: zeroMove.count, of: zeroMove.of, trialIds: cap(zeroMove.trialIds), trials: zeroMove.trials, fired: zeroMove.count > 0 }
  } : base.checks;
  const factCount = recorded ? [checks.webdriver.fired, checks.untrustedClicks.fired, checks.zeroMoveTrials.fired].filter(Boolean).length : null;

  return finish({
    ...base, state: 'ok', checksRecorded: recorded ? 3 : 0, checks, factCount,
    cursor: {
      stream: 'core', sampleIntervalMs: median(gaps), coordinates: mode,
      rules: {
        noPathClicks: { count: noPath.count, of: noPath.of, trialIds: cap(noPath.trialIds), trials: noPath.trials },
        jumpClicks: { count: jump.count, of: jump.of, trialIds: cap(jump.trialIds), trials: jump.trials },
        centeredClicks: null
      },
      features: {
        durationMs: stat(f.durationMs), pathPx: stat(f.pathPx), displacementPx: stat(f.displacementPx),
        speedPxS: stat(f.speedPxS), efficiency: stat(f.efficiency), maxDeviationPx: stat(f.maxDeviationPx),
        movesPerTrial: stat(movesPerTrial), movementsPerTrial: stat(movementsPerTrial), keyboardClicks, touchClicks
      },
      firstClicks, movements: movementsTotal, clicks: clicksTotal, cappedTrials, trials: trials.length
    }
  });
}

// One result per participant, in order (the shape report-core attaches to
// each summary), all judged with one limits object shaped like CURSOR_LIMITS.
export function analyzeCursor(participants, limits = CURSOR_LIMITS) {
  return participants.map(p => analyzeCursorForParticipant(p, limits));
}
