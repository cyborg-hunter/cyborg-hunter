// tests/cli/plot-cores.test.js
// Draw-call-log snapshots for the extracted plot cores. Platform-independent
// (unlike PNG pixel hashes): a fake canvas records every 2d-context method
// call + property set; the log is snapshotted. A verbatim-move regression or
// accidental drawing change shows up as a log diff.
// Regenerate deliberately: SNAPSHOT_UPDATE=1 node --test tests/cli/plot-cores.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { makeRecordingCanvasFactory } from './recording-canvas.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXT = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'demo', 'DEMO-FIXT.json'), 'utf8'));

function snapshotTest(name, file, render, extraChecks) {
  test(name, async () => {
    const log = [];
    const canvas = await render(makeRecordingCanvasFactory(log));
    assert.ok(canvas, 'core returned a canvas');
    // Lane-coverage assertions run on BOTH paths (regenerate + verify) so a
    // fixture regenerated from a broken render can't silently pass.
    if (extraChecks) extraChecks(log);
    const snapPath = join(here, '..', 'fixtures', 'cli', file);
    const out = JSON.stringify({ calls: log.length, log }, null, 1);
    if (process.env.SNAPSHOT_UPDATE === '1' || !existsSync(snapPath)) { writeFileSync(snapPath, out); return; }
    assert.equal(out, readFileSync(snapPath, 'utf8'));
  });
}

// Participant in extracted shape — same pipeline the CLI runs.
import { extractIntegrityData } from '../../src/cli/extract-core.js';
const P = extractIntegrityData(FIXT, { outputDir: '.', participantIdField: 'participantId' });

import { drawSessionTimeline } from '../../src/cli/renderers/session-timeline-core.js';
snapshotTest('session-timeline core draw log', 'drawlog-session-timeline.json',
  (cc) => drawSessionTimeline(P, { outputDir: '.' }, cc),
  (log) => {
    // DEMO-FIXT's six trials carry start times, so the Trials strip and the
    // Text input lane are drawn, with a light guide at each trial start; it
    // has no gallery phase bands, so no Phases strip.
    const texts = log.filter(c => c[0] === 'fillText').map(c => c[1]);
    assert.ok(texts.includes('Trials'), 'Trials strip label');
    assert.ok(texts.includes('Text input'), 'Text input lane label');
    assert.ok(!texts.includes('Phases'), 'no Phases strip without gallery bands');
    assert.equal(log.filter(c => c[0] === 'setLineDash' && c[1].join() === '3,3').length, 6, 'one guide per trial start');
  });

// Enriched variant: DEMO-FIXT records no sidebar / viewport-shift / guard
// events, so the baseline snapshot never enters those lanes' draw loops.
// Inject plain-data events (the exact field shapes collectEvents reads) into
// a deep copy so drawSidebars / drawLayoutShifts / drawGuardViolations draw
// for real. metadata.startTime is absent from the fixture → deriveSessionOffset
// returns 0, so every injected perfNow `t` plots directly at t/1000 seconds
// (x-domain ≈ 17.46s, set by the last trial's end).
//
// NOT injected: a second gallery for drawPhaseGuides' multi-gallery branch.
// DEMO-FIXT trials all carry phase:"default", which derivePhases excludes from
// rule grouping (it groups only 'classification'/unphased trials), and
// metadata lacks startTime/endTime — two galleries would mean overwriting real
// fixture fields rather than adding absent events. That branch waits for a
// fixture with genuine phase data.
const P_ENRICHED = structuredClone(P);
P_ENRICHED.session.sidebarEvents = [
  { type: 'opened', t: 2000 },   // span 2s → 5s, closed (solid bar, no dash)
  { type: 'closed', t: 5000 },
  { type: 'opened', t: 15000 },  // trailing open, never closed → dashed-border
                                 // branch. It runs to the end of the domain,
                                 // which the last trial's end sets (≈17.46s).
];
P_ENRICHED.session.viewportWidthShifts = [
  { t: 3000, delta: -350 },      // tick at 3s
  { t: 9000, delta: 350 },       // tick at 9s
];
P_ENRICHED.guardFriction = { violations: [
  { t: 10000, reason: 'sidebar_open', phase: 'gallery' },  // ┐ 400ms apart →
  { t: 10400, reason: 'sidebar_open', phase: 'gallery' },  // ┘ one clustered tick
  { t: 12000, reason: 'devtools', phase: 'typing' },       // 1.6s later → second group
] };

snapshotTest('session-timeline core draw log (enriched)', 'drawlog-session-timeline-enriched.json',
  (cc) => drawSessionTimeline(P_ENRICHED, { outputDir: '.' }, cc),
  (log) => {
    // Strictly more drawing than the baseline render. The per-lane checks
    // are count/shape-based, NOT bare `some(color)`: the legend swatches
    // (drawLegendRow) set every lane color once even when a lane drew
    // nothing, and drawLayoutShifts sets its strokeStyle before an empty
    // loop — so mere presence would pass on the un-enriched baseline too.
    const baseCalls = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'cli', 'drawlog-session-timeline.json'), 'utf8')).calls;
    assert.ok(log.length > baseCalls, `enriched log has ${log.length} calls (baseline: ${baseCalls})`);
    const fills = (color) => log.filter(c => c[0] === 'set:fillStyle' && c[1] === color).length;
    // 2 sidebar spans (closed pair + trailing unclosed span) + 1 legend swatch
    assert.ok(fills('#8e24aa') >= 3, `sidebar fillStyle ×${fills('#8e24aa')}, want ≥3 (2 spans + legend)`);
    // 2 violation groups (clustered 400ms pair, 12s singleton) + 1 legend swatch
    assert.ok(fills('#c62828') >= 3, `guard fillStyle ×${fills('#c62828')}, want ≥3 (2 groups + legend)`);
    // Shifts: the strokeStyle count doesn't move with events (it's set before
    // the loop even when empty), so count the tick draws (moveTo) between the
    // lane's strokeStyle set and the next lane's first fillStyle set instead.
    const lsStart = log.findIndex(c => c[0] === 'set:strokeStyle' && c[1] === '#00897b');
    const lsEnd = log.findIndex((c, i) => i > lsStart && c[0] === 'set:fillStyle');
    assert.equal(log.slice(lsStart, lsEnd).filter(c => c[0] === 'moveTo').length, 2,
      'two viewport-shift ticks drawn');
    // Unclosed trailing sidebar → its dashed white border (strokeStyle
    // '#fff'), which nothing else in the timeline draws.
    assert.ok(log.some(c => c[0] === 'set:strokeStyle' && c[1] === '#fff'), 'unclosed sidebar dashed border drawn');
  });

test('session timeline: phases the experiment sets colour the Trials strip and draw a labelled line where they change', async () => {
  const P_PHASED = structuredClone(P);
  ['tutorial', 'tutorial', 'main', 'main', 'main', 'main'].forEach((ph, i) => { P_PHASED.trials[i].phase = ph; });
  const log = [];
  await drawSessionTimeline(P_PHASED, { outputDir: '.' }, makeRecordingCanvasFactory(log));
  const texts = log.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(texts.includes('Trials · phase'));
  assert.ok(texts.includes('tutorial') && texts.includes('main'), 'each phase named where it begins');
  assert.equal(log.filter(c => c[0] === 'setLineDash' && c[1].join() === '6,3').length, 1, 'one phase change, one dark line');
});

test('session timeline: trials without start times get no Trials strip and no trial guides; the Text input lane stays', async () => {
  const P_OLD = structuredClone(P);
  for (const t of P_OLD.trials) delete t.startTime;
  const log = [];
  await drawSessionTimeline(P_OLD, { outputDir: '.' }, makeRecordingCanvasFactory(log));
  const texts = log.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(!texts.includes('Trials'));
  assert.ok(texts.includes('Text input'));
  assert.equal(log.filter(c => c[0] === 'setLineDash' && c[1].join() === '3,3').length, 0);
});

test('session timeline: the Phases strip shows when the gallery bands exist, and only then', async () => {
  const G = { participantId: 'G-1', session: {}, galleryStudyMs: [30000],
    metadata: { startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T00:10:00.000Z' },
    trials: [{ trialId: 'c-1', rulePosition: 0, timestamp: '2026-01-01T00:02:00.000Z', rt: 4000 }] };
  const log = [];
  await drawSessionTimeline(G, { outputDir: '.' }, makeRecordingCanvasFactory(log));
  const texts = log.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(texts.includes('Phases'));
  assert.ok(!texts.includes('Trials'));
});

test('session timeline: copies, pastes, drops and synthetic insertions are drawn in the Text input lane', async () => {
  const P_INPUT = structuredClone(P);
  const t0 = P_INPUT.trials[0].startTime;
  P_INPUT.trials[0].copyEvents = [{ type: 'copy', t: t0 + 100 }, { type: 'cut', t: t0 + 200 }];
  P_INPUT.trials[0].dropEvents = [{ t: t0 + 300 }];
  P_INPUT.trials[0].syntheticInsertions = [{ t: t0 + 400 }, { t: t0 + 420 }, { t: t0 + 440 }];
  const log = [];
  await drawSessionTimeline(P_INPUT, { outputDir: '.' }, makeRecordingCanvasFactory(log));
  const fills = (color) => log.filter(c => c[0] === 'set:fillStyle' && c[1] === color).length;
  assert.ok(fills('#f57c00') >= 3, 'two copy marks + the legend');
  assert.ok(fills('#7b1fa2') >= 2, 'one drop mark + the legend');
  assert.ok(log.some(c => c[0] === 'fillText' && c[1] === '×3'), 'the synthetic count');
});

test('session timeline: a crowded session hides its trial lines and says so in the legend', async () => {
  // 300 trials one second apart: their starts are about 3 px apart on the
  // chart, under the 6 px a line needs. Built with a loop.
  const trials = [];
  for (let i = 0; i < 300; i++) trials.push({ trialId: 'n' + i, startTime: i * 1000, duration_ms: 900 });
  const log = [];
  await drawSessionTimeline({ participantId: 'N-300', session: {}, metadata: {}, trials }, { outputDir: '.' }, makeRecordingCanvasFactory(log));
  const texts = log.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(texts.includes('Trials'), 'the Trials strip is still drawn');
  assert.ok(texts.includes('trial lines hidden (300 trials)'), 'the legend names the hidden lines');
  assert.equal(log.filter(c => c[0] === 'setLineDash' && c[1].join() === '3,3').length, 0, 'no trial line');
});

test('session timeline: pages a Qualtrics payload trimmed are hatched, and the footer counts them', async () => {
  // The Qualtrics reader's fixture: response R_2 is a payload reduced to
  // level 2, so pages 1 to 4 lost their events (integrityTruncated) and only
  // page 5 keeps its pastes.
  const { parseQualtricsExport } = await import('../../src/cli/qualtrics-csv.js');
  const csv = readFileSync(join(here, 'fixtures', 'qualtrics-export.csv'), 'utf8');
  const PQ = extractIntegrityData(parseQualtricsExport(csv, {}).responses[1].raw, {});
  const log = [];
  await drawSessionTimeline(PQ, { outputDir: '.' }, makeRecordingCanvasFactory(log));
  // The hatch's stroke colour is its own: one set per trimmed page.
  assert.equal(log.filter(c => c[0] === 'set:strokeStyle' && c[1] === '#78909c').length, 4, 'four pages hatched');
  const texts = log.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(texts.some(t => typeof t === 'string' && t.includes('events of 4 trials not kept by the Qualtrics payload')),
    'the footer note');
  // A session with no trimmed page has neither.
  const plain = [];
  await drawSessionTimeline(P, { outputDir: '.' }, makeRecordingCanvasFactory(plain));
  assert.equal(plain.filter(c => c[0] === 'set:strokeStyle' && c[1] === '#78909c').length, 0);
  assert.ok(!plain.some(c => c[0] === 'fillText' && String(c[1]).includes('not kept')));
});

// ── The Trials strip's phases ────────────────────────────────────────────
import { TIMELINE_ROW, TIMELINE_GEOMETRY, timelineRows } from '../../src/cli/renderers/timeline-layout.js';

// The rows with both strips, and the y and height of a Trials-strip band.
const BOTH = timelineRows({ phasesStrip: true, trialsStrip: true });
const BAND_Y = BOTH.trialsY + 1;
const BAND_H = TIMELINE_ROW.strip - 2;
const CHART_RIGHT = TIMELINE_GEOMETRY.width - TIMELINE_GEOMETRY.right;

// A session with the gallery phase bands and trials that set phases: two
// rules, each a gallery trial then four classification trials, so both
// strips are drawn. `lead` trials come first.
function gallerySession(lead = []) {
  const start = Date.parse('2026-01-01T00:00:00.000Z');
  const iso = (ms) => new Date(start + ms).toISOString();
  const trials = lead.slice();
  let at = 30000;
  for (let r = 0; r < 2; r++) {
    trials.push({ trialId: `gallery-${r + 1}`, phase: 'gallery', startTime: 5000 + at, duration_ms: 60000 });
    at += 60000;
    for (let k = 0; k < 4; k++) {
      trials.push({ trialId: `r${r + 1}-c${k + 1}`, phase: 'classification', rulePosition: r, ruleId: `rule-${r + 1}`,
        startTime: 5000 + at, duration_ms: 10000, rt: 10000, timestamp: iso(at + 10000) });
      at += 10000;
    }
  }
  return { participantId: 'G-2', session: {}, galleryStudyMs: [60000, 60000],
    metadata: { startTime: iso(0), endTime: iso(at + 30000) }, trials };
}

// The colour the legend gives a phase band: its swatch, drawn right after
// its label in the legend rows above the strips.
function legendColour(log, label) {
  const i = log.findIndex(c => c[0] === 'fillText' && c[1] === label && c[3] < TIMELINE_ROW.top);
  const set = i < 0 ? null : log.slice(i + 1).find(c => c[0] === 'set:fillStyle');
  return set ? set[1] : null;
}

// The fillStyle in effect at each fillRect at (y, h), in drawing order.
function fillsAt(log, y, h) {
  const out = [];
  let fill = null;
  for (const c of log) {
    if (c[0] === 'set:fillStyle') fill = c[1];
    else if (c[0] === 'fillRect' && c[2] === y && c[4] === h) out.push(fill);
  }
  return out;
}

test('session timeline: a trial phase the report knows keeps the Phases strip\'s colour on the Trials strip', async () => {
  // Without and with a tutorial trial first: the colour follows the phase's
  // name, not the order the phases appear in.
  for (const lead of [[], [{ trialId: 'intro', phase: 'tutorial', startTime: 10000, duration_ms: 15000 }]]) {
    const log = [];
    await drawSessionTimeline(gallerySession(lead), { outputDir: '.' }, makeRecordingCanvasFactory(log));
    const gallery = legendColour(log, 'gallery');
    const classification = legendColour(log, 'classification');
    assert.ok(gallery && classification && gallery !== classification, 'the legend colours both phases');
    const rule = [gallery, classification, classification, classification, classification];
    const bands = fillsAt(log, BAND_Y, BAND_H);
    assert.deepEqual(bands.slice(lead.length), [...rule, ...rule], `trial bands after ${lead.length} lead trial(s)`);
    if (lead.length) {
      // A phase the report has no colour for takes one no phase band uses.
      const bandColours = ['framing (pre / transition / post)', 'gallery', 'typing', 'classification'].map(l => legendColour(log, l));
      assert.ok(!bandColours.includes(bands[0]), `tutorial fill ${bands[0]}`);
    }
  }
});

test('session timeline: with both strips, phase names sit inside the Trials strip on a patch of their colour, over the guides', async () => {
  const log = [];
  await drawSessionTimeline(gallerySession(), { outputDir: '.' }, makeRecordingCanvasFactory(log));
  const texts = log.filter(c => c[0] === 'fillText');
  assert.ok(texts.some(c => c[1] === 'Phases') && texts.some(c => c[1] === 'Trials · phase'), 'both strips');
  // The legend names 'gallery' too, above the strips: only the strip's names.
  const nameY = BOTH.trialsY + 15;
  const names = log.map((c, i) => [c, i]).filter(([c]) => c[0] === 'fillText' && c[3] === nameY
    && (c[1] === 'gallery' || c[1] === 'classification'));
  assert.equal(names.length, 4, 'each of the four phases named inside the strip');
  const lastDash = log.map(c => c[0]).lastIndexOf('setLineDash');
  for (const [c, i] of names) {
    assert.ok(i > lastDash, `${c[1]} drawn after the last dashed line`);
    // The drawing call before it (property sets aside) is its patch, in its
    // phase's colour.
    let j = i - 1;
    while (log[j][0].startsWith('set:')) j--;
    assert.equal(log[j][0], 'fillRect', `${c[1]} on a patch`);
    const patchFill = log.slice(0, j).reverse().find(d => d[0] === 'set:fillStyle')[1];
    assert.equal(patchFill, legendColour(log, c[1]), `${c[1]}'s patch in its phase's colour`);
  }
  // The rule numbers sit inside the Phases strip, not in the 6 px gap under it.
  const rules = texts.filter(c => /^r\d$/.test(c[1]));
  assert.deepEqual(rules.map(c => c[1]), ['r1', 'r2']);
  assert.ok(rules.every(c => c[3] > BOTH.phasesY && c[3] < BOTH.phasesY + TIMELINE_ROW.strip), 'inside the Phases strip');
});

test('session timeline: phase names above the Trials strip never run into each other or past the chart', async () => {
  // Without the Phases strip the Trials strip is the first row; names sit
  // 3 px above it.
  const nameY = TIMELINE_ROW.top - 3;
  const PC = structuredClone(P);
  ['practice', 'main', 'practice', 'main', 'debrief', 'end-of-session'].forEach((ph, i) => { PC.trials[i].phase = ph; });
  const crowded = [];
  await drawSessionTimeline(PC, { outputDir: '.' }, makeRecordingCanvasFactory(crowded));
  const above = crowded.filter(c => c[0] === 'fillText' && c[3] === nameY);
  // The second 'practice' would run into 'main'; the last three phases begin
  // at the chart's right edge, where no name fits right of its line.
  assert.deepEqual(above.map(c => c[1]), ['practice', 'main']);
  assert.ok(above.every(c => c[2] >= TIMELINE_GEOMETRY.left && c[2] + c[1].length * 5.8 <= CHART_RIGHT), 'inside the chart');

  // A name longer than the chart is cut to fit, right of its line.
  const PL = structuredClone(P);
  PL.trials.forEach((t, i) => { t.phase = i === 0 ? 'x'.repeat(200) : 'main'; });
  const long = [];
  await drawSessionTimeline(PL, { outputDir: '.' }, makeRecordingCanvasFactory(long));
  const first = long.find(c => c[0] === 'fillText' && c[3] === nameY);
  assert.ok(first[1].endsWith('…'), 'cut with an ellipsis');
  assert.ok(first[2] >= TIMELINE_GEOMETRY.left && first[2] + first[1].length * 5.8 <= CHART_RIGHT, `x ${first[2]}`);
});

// ── Trajectories core ────────────────────────────────────────────────────
import { drawTrajectoryGrid } from '../../src/cli/renderers/trajectories-core.js';

snapshotTest('trajectories core draw log', 'drawlog-trajectories.json',
  (cc) => drawTrajectoryGrid(P, /* triageEntry */ { hardTriggered: false }, { outputDir: '.' }, cc),
  (log) => {
    // Non-tautological checks (per the review warning on templates): several
    // fillStyle/strokeStyle assignments in trajectories-core.js fire
    // UNCONDITIONALLY once per data-bearing trial panel (mousedown color,
    // mouseup color, panel border, window-rect color) regardless of whether
    // any markers actually get drawn — so a bare `some(color)` check would
    // pass even on a render with zero markers. These assertions instead use
    // occurrence counts (checked against real per-trial counts derived from
    // DEMO-FIXT's own data) or window-bound the log between a style-set and
    // the next one to count the draw calls that landed inside it.
    const fillSets = (color) => log.filter(c => c[0] === 'set:fillStyle' && c[1] === color);
    const strokeSets = (color) => log.filter(c => c[0] === 'set:strokeStyle' && c[1] === color);

    // Red hard-signal panel border: of DEMO-FIXT's 6 trials, only act1-paste
    // (2 pasteEvents === countThreshold) has trialSignals.hard.*.trialHits > 0.
    assert.equal(strokeSets('#ff0000').length, 1,
      'exactly one hard-signal (red) panel border — act1-paste');

    // Tab-away leave/return diamonds: act1-tabaway has exactly one >3s gap
    // (5105ms→11427ms) and it overlaps that trial's one tabAwayEvent — the
    // only such overlap in the fixture, so exactly one diamond pair.
    assert.equal(fillSets('#ffff00').length, 1, 'one tab-away LEAVE diamond drawn');
    assert.equal(fillSets('#00ffff').length, 1, 'one tab-away RETURN diamond drawn');

    // Plain grey pause circle (a >3s gap with NO overlapping tab-away):
    // DEMO-FIXT's only qualifying gap is claimed by the diamond branch above,
    // so the plain-pause branch never fires here. Asserted at zero so the
    // enriched test below (which adds a non-overlapping gap) actually proves
    // the branch fires rather than coincidentally matching a snapshot.
    assert.equal(fillSets('#ccc').length, 0,
      'baseline has no bare pause circle — its only 3s+ gap overlaps a tab-away');

    // Window/screen outline: every windowPositions sample in DEMO-FIXT has
    // y(61) + h(906) = 967 > sh(900) — a genuine window/screen paradox in
    // the recorded data — so chooseScreenFrame's legacy branch always
    // resolves drawOuter=false. The window rect (dashed purple) still draws
    // for each of the 5 trials that reach geometry resolution (moves.length
    // > 0); the screen rect (teal) never does. The enriched test below fixes
    // the paradox to exercise drawOuter=true.
    //
    // Not checked here (deliberately out of scope
    // for this file): the zoom-tag branch (COLORS.zoomTag, '#a06000') —
    // it's unit-tested directly via computeZoomTag in trajectory-frame.test.js
    // and window-geometry.test.js instead.
    assert.equal(strokeSets('#7e57c2').length, 5, 'window outline drawn for all 5 data-bearing trials');
    assert.equal(strokeSets('#26a69a').length, 0, 'screen outline suppressed — window/screen paradox in fixture data');

    // Mousedown/mouseup markers: window-bounded fill() counts, not mere
    // color presence (the mousedown/mouseup fillStyle is set once per
    // data-bearing trial regardless of how many down/up events exist).
    // act1-paste is the 2nd data-bearing trial and has exactly 2 down and
    // 2 up events.
    const downIdxs = log.reduce((acc, c, i) => { if (c[0] === 'set:fillStyle' && c[1] === '#00cc00') acc.push(i); return acc; }, []);
    const upIdxs = log.reduce((acc, c, i) => { if (c[0] === 'set:fillStyle' && c[1] === '#ff00ff') acc.push(i); return acc; }, []);
    assert.equal(downIdxs.length, 5, '5 data-bearing trials reach the mousedown style-set');
    assert.equal(upIdxs.length, 5, '5 data-bearing trials reach the mouseup style-set');
    const pasteDownStart = downIdxs[1];
    const pasteUpStart = upIdxs[1];
    const nextBorder = log.findIndex((c, i) => i > pasteUpStart && c[0] === 'set:strokeStyle');
    assert.equal(log.slice(pasteDownStart, pasteUpStart).filter(c => c[0] === 'fill').length, 2,
      'act1-paste draws exactly 2 mousedown triangles');
    assert.equal(log.slice(pasteUpStart, nextBorder).filter(c => c[0] === 'fill').length, 2,
      'act1-paste draws exactly 2 mouseup triangles');
  });

// Enriched variant: DEMO-FIXT's only 3s+ gap overlaps a tab-away (drawn as a
// diamond pair above), so the plain grey pause-circle branch never fires;
// and every windowPositions sample carries a window/screen paradox
// (y + h > sh), so the drawOuter=true (screen outline) branch never fires
// either. Both fixed here, on a structuredClone so the baseline P above is
// untouched:
//   - act2-fullscreen-entry (previously a single click with no move event —
//     the "No mouse data" panel) gets two move events 4.1s apart with no
//     tabAwayEvents, landing in the plain-pause-circle branch.
//   - session.windowPositions[*].h drops from 906 to 800 (same field the
//     library actually polls; DEMO-FIXT's own value happens to be
//     internally inconsistent) so winY+winH fits inside the recorded screen
//     height and drawOuter=true for every trial that resolves geometry.
const P_TRAJ_ENRICHED = structuredClone(P);
for (const wp of P_TRAJ_ENRICHED.session.windowPositions) wp.h = 800;
const fsIdx = P_TRAJ_ENRICHED.trials.findIndex(t => t.trialId === 'act2-fullscreen-entry');
P_TRAJ_ENRICHED.trials[fsIdx].duration_ms = 4300;
P_TRAJ_ENRICHED.trials[fsIdx].mouseEvents = [
  { x: 265, y: 504, t: 1, type: 'click' },
  { x: 265, y: 504, t: 100, type: 'move' },
  { x: 270, y: 510, t: 4200, type: 'move' },  // gap 4100ms > 3000, tabAwayEvents stays []
];

snapshotTest('trajectories core draw log (enriched)', 'drawlog-trajectories-enriched.json',
  (cc) => drawTrajectoryGrid(P_TRAJ_ENRICHED, /* triageEntry */ { hardTriggered: false }, { outputDir: '.' }, cc),
  (log) => {
    const fillSets = (color) => log.filter(c => c[0] === 'set:fillStyle' && c[1] === color);
    const strokeSets = (color) => log.filter(c => c[0] === 'set:strokeStyle' && c[1] === color);
    assert.ok(log.length > 283, `enriched log has ${log.length} calls (baseline: 283)`);
    assert.equal(fillSets('#ccc').length, 1, 'the injected non-overlapping gap draws exactly one bare pause circle');
    assert.equal(strokeSets('#26a69a').length, 6,
      'screen outline now drawn for all 6 trials once the window/screen paradox is fixed');
  });

// ── Typing-profile core ──────────────────────────────────────────────────
import { drawTypingProfile } from '../../src/cli/renderers/typing-profile-core.js';

// New module-level helper, added for the typing-profile section only (added
// on review, sanctioned). SESSION-TIMELINE and TRAJECTORIES above keep their
// existing inline fillSets/strokeSets arrow functions unchanged — not
// migrated to this helper.
function styleSets(log, prop, color) {
  return log.filter(c => c[0] === `set:${prop}` && c[1] === color).length;
}

// config.typingSpeedThreshold_cps is the real fallback key the renderer
// reads (see the `threshold =` line in typing-profile-core.js) — NOT
// config.thresholds.typingSpeedCps. DEMO-FIXT's participant already carries
// session.config.thresholds.typingSpeedCps = 10 (higher precedence per that
// same three-tier fallback), so this value only matters for participants
// without a saved threshold; set to 10 so both sources agree here.
snapshotTest('typing-profile core draw log', 'drawlog-typing-profile.json',
  (cc) => drawTypingProfile(P, { outputDir: '.', typingSpeedThreshold_cps: 10 }, cc),
  (log) => {
    // Non-tautological checks: the legend swatches (fillStyle '#2196F3' for
    // "typed", '#f44336' for "> threshold") are set once each unconditionally
    // before the bar loop runs, so bare presence checks would pass on an
    // all-blank chart too. These use occurrence counts derived from
    // DEMO-FIXT's own trials: exactly one typed trial (act1-baseline,
    // charsPerSec=9.1) below the 10 cps threshold, one paste-only trial
    // (act1-paste, 2 pasteEvents, no charsPerSec), and none above threshold.
    assert.equal(styleSets(log, 'fillStyle', '#2196F3'), 2,
      'below-threshold typed bar: 1 legend swatch + 1 bar (act1-baseline, 9.1 < 10 cps)');
    assert.equal(styleSets(log, 'fillStyle', '#f44336'), 1,
      'no above-threshold bar in the baseline fixture — legend swatch only (enriched test below adds one)');

    // Threshold line: measured, not merely present — '#ff0000' is unique to
    // this line (no other draw call in the function uses pure red), and the
    // checked coordinates are real computed values: maxSpeed = max(9.1, 0×4,
    // threshold×1.5) = 15, so threshY = 50 + 200 − 10×(200/15) ≈ 116.67, and
    // canvasW − 10 = (60 + 6×38 + 20) − 10 = 298.
    const lineIdx = log.findIndex(c => c[0] === 'set:strokeStyle' && c[1] === '#ff0000');
    assert.ok(lineIdx >= 0, 'threshold line strokeStyle set');
    assert.deepEqual(log[lineIdx + 1], ['set:lineWidth', 1.5]);
    assert.deepEqual(log[lineIdx + 2], ['setLineDash', [5, 3]]);
    assert.deepEqual(log[lineIdx + 3], ['beginPath']);
    assert.deepEqual(log[lineIdx + 4], ['moveTo', 60, 116.67]);
    assert.deepEqual(log[lineIdx + 5], ['lineTo', 298, 116.67]);
  });

// Enriched variant: DEMO-FIXT has only one typed trial (act1-baseline, 9.1
// cps) and it sits below the 10 cps threshold, so the above-threshold red
// bar branch never fires in the baseline snapshot above. Boost a no-data
// trial (act1-tabaway) to a real above-threshold speed on a structuredClone
// so P above stays untouched. 15 cps also keeps maxSpeed (and so threshY)
// identical to the baseline (max(..., 15) still ties threshold×1.5 = 15),
// which keeps this fixture easy to reason about against the one above.
const P_TYPING_ENRICHED = structuredClone(P);
const typingBoostIdx = P_TYPING_ENRICHED.trials.findIndex(t => t.trialId === 'act1-tabaway');
P_TYPING_ENRICHED.trials[typingBoostIdx].charsPerSec = 15; // > 10 cps threshold

snapshotTest('typing-profile core draw log (enriched)', 'drawlog-typing-profile-enriched.json',
  (cc) => drawTypingProfile(P_TYPING_ENRICHED, { outputDir: '.', typingSpeedThreshold_cps: 10 }, cc),
  (log) => {
    assert.ok(log.length > 267, `enriched log has ${log.length} calls (baseline: 267)`);
    assert.equal(styleSets(log, 'fillStyle', '#f44336'), 2,
      'above-threshold red bar now draws: 1 legend swatch + 1 bar (act1-tabaway boosted to 15 cps)');
    assert.equal(styleSets(log, 'fillStyle', '#2196F3'), 2,
      'below-threshold bar count unchanged — act1-baseline (9.1 cps) is still the only one');
  });

// Skip/bail branch: a participant with trials but no typing data at all (no
// charsPerSec, no pasteEvents on any trial) draws nothing and returns null —
// report-core.js's cue to skip the PNG write. Minimal clone: strip the two
// typing-signal fields from every trial. No fixture file — there's no canvas
// or draw log to snapshot on the null path.
test('typing-profile core returns null when no trial has typing data', () => {
  const P_NO_TYPING = structuredClone(P);
  for (const t of P_NO_TYPING.trials) {
    delete t.charsPerSec;
    delete t.pasteEvents;
  }
  const log = [];
  const canvas = drawTypingProfile(
    P_NO_TYPING, { outputDir: '.', typingSpeedThreshold_cps: 10 }, makeRecordingCanvasFactory(log)
  );
  assert.equal(canvas, null);
  assert.equal(log.length, 0, 'no canvas created for a no-typing-data participant');
});

// ── Tour-shape degradation guards ───────────────────────────
// The in-browser demo's own walkthrough ("tour") produces a fundamentally
// different participant shape than the study fixture (P/DEMO-FIXT) above:
// demo act/step trial ids instead of r{N}-classification, no rulePosition
// field, no phase field (so no 'gallery'/'classification' phase tagging
// either), and no metadata.startTime (the tour never stamps a session-start
// wall-clock the way the jsPsych experiment wrapper does). It also carries
// the raw mouseTrack field (the rawMouseTrack passthrough)
// rather than only derived mouseMetrics.
//
// Investigated before writing this test: ran both cores against several
// degraded shapes (this fixture, a 3-trial slice of DEMO-FIXT, a session-
// less payload, an empty-windowPositions session, and a real monitor.js →
// buildPayload() → extractIntegrityData() round trip with the window-
// position poller never firing) — none threw. Both cores already guard the
// relevant reads (`trial.mouseEvents || []`, `Array.isArray(p.trials) ?
// ... : []`, `meta.startTime ? ... : null`, etc.), so no core guard was
// added — this test locks that guarantee in as a regression pin.
const TOUR_RAW = {
  participantId: 'TOUR-1',
  trials: [
    {
      trialId: 'act1-baseline',
      integrity: {
        trialId: 'act1-baseline', libraryVersion: '0.7.2', participantId: 'TOUR-1',
        startTime: 0, duration_ms: 3000,
        pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [],
        trialSoftScore: 0, trialSignals: {},
        mouseTrack: [
          { x: 10, y: 10, t: 0, type: 'move' },
          { x: 20, y: 30, t: 100, type: 'move' },
          { x: 15, y: 25, t: 200, type: 'move' },
        ],
      },
    },
    {
      trialId: 'act1-paste',
      integrity: {
        trialId: 'act1-paste', libraryVersion: '0.7.2', participantId: 'TOUR-1',
        startTime: 3000, duration_ms: 4000,
        pasteEvents: [{ t: 500, chars: 40 }], copyEvents: [], dropEvents: [], tabAwayEvents: [],
        trialSoftScore: 1, trialSignals: { soft: { paste: { weight: 1 } } },
        mouseTrack: [
          { x: 40, y: 40, t: 0, type: 'move' },
          { x: 60, y: 20, t: 1500, type: 'down' },
          { x: 60, y: 20, t: 1600, type: 'up' },
        ],
      },
    },
    {
      trialId: 'act1-tabaway',
      integrity: {
        trialId: 'act1-tabaway', libraryVersion: '0.7.2', participantId: 'TOUR-1',
        startTime: 7000, duration_ms: 5000,
        pasteEvents: [], copyEvents: [], dropEvents: [],
        tabAwayEvents: [{ start: 1000, duration_ms: 3500, type: 'windowBlur' }],
        trialSoftScore: 1, trialSignals: { soft: { tabAway: { weight: 1 } } },
        mouseTrack: [
          { x: 5, y: 5, t: 0, type: 'move' },
          { x: 8, y: 12, t: 4800, type: 'move' },
        ],
      },
    },
  ],
  metadata: {
    // No startTime — the tour doesn't stamp a session-level wall-clock.
    integritySession: {
      pasteCount: 1, copyCount: 0, dropCount: 0,
      tabAwaySums: [3500], tabAwayEvents: [],
      charsPerSec: [], sidebarEvents: [], devToolsEvents: [],
      aiExtensionsFound: [], keyboardShortcuts: [],
      windowPositions: [], idleGaps: [], extensionInjections: [],
      viewportWidthShifts: [], layoutShifts: [], zoomChanges: [],
      hardScore: {}, softScore: 2, trialsCompleted: 3,
      softScoreThreshold: 6, anyHardTriggered: false,
    },
  },
};

const P_TOUR = extractIntegrityData(TOUR_RAW, { outputDir: '.', participantIdField: 'participantId' });

test('tour-shaped participant (no rulePosition/phase, no metadata.startTime, raw mouseTrack) does not throw either draw core', () => {
  // Sanity: this really is the degraded shape under test, and the raw
  // mouseTrack field really did survive extraction as mouseEvents (the
  // FIELD_MAP generalization, verified here on Shape-1 data with a tour
  // trial-id scheme rather than mouse-track-passthrough.test.js's rN- ids).
  assert.ok(P_TOUR.trials.every(t => t.rulePosition === undefined && t.phase === undefined),
    'tour trials carry neither rulePosition nor phase');
  assert.equal(P_TOUR.metadata.startTime, undefined, 'tour metadata carries no session startTime');
  assert.ok(P_TOUR.trials.every(t => t.mouseEvents && t.mouseEvents.length > 0),
    'mouseTrack must have survived extraction as mouseEvents on every trial');

  let c1, c2;
  assert.doesNotThrow(() => {
    c1 = drawSessionTimeline(P_TOUR, { outputDir: '.' }, makeRecordingCanvasFactory([]));
  }, 'drawSessionTimeline must not throw on a tour-shaped participant');
  assert.doesNotThrow(() => {
    c2 = drawTrajectoryGrid(P_TOUR, { hardTriggered: false }, { outputDir: '.' }, makeRecordingCanvasFactory([]));
  }, 'drawTrajectoryGrid must not throw on a tour-shaped participant');
  assert.ok(c1 === null || typeof c1 === 'object', 'drawSessionTimeline returns a canvas or null');
  assert.ok(c2 === null || typeof c2 === 'object', 'drawTrajectoryGrid returns a canvas or null');
});
