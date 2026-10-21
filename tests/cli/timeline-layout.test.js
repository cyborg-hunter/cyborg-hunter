// tests/cli/timeline-layout.test.js
// The Session timeline block's layout (src/cli/renderers/timeline-layout.js):
// where trials, Text input marks and guides go on the shared time axis, when
// the charts fall back to one bar per trial, the typing bars, and the numbers
// the page's hover script reads.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TIMELINE_GEOMETRY, CHART_W, NO_PHASE, xOf, barRect, trialLabel, phaseOf, trialSpans, inputMarks,
  phaseRuns, guides, coverDomain, typingThreshold, typingBars, typingAxis, timelineRows, hoverData,
  GLYPH, glyphPlaces, COUNT_LABEL, countLabelPlaces,
} from '../../src/cli/renderers/timeline-layout.js';
import { parseQualtricsExport } from '../../src/cli/qualtrics-csv.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';

const trial = (id, startTime, duration_ms, extra = {}) => ({ trialId: id, startTime, duration_ms, ...extra });

describe('the time axis', () => {
  it('both images share one geometry: 1000 px wide, a 90 px left margin, 880 px of chart', () => {
    assert.deepEqual({ ...TIMELINE_GEOMETRY }, { width: 1000, left: 90, right: 30 });
    assert.equal(CHART_W, 880);
  });

  it('xOf maps 0 to the left margin and the domain to the right edge, clamping times outside it', () => {
    assert.equal(xOf(0, 100), 90);
    assert.equal(xOf(50, 100), 530);
    assert.equal(xOf(100, 100), 970);
    assert.equal(xOf(-5, 100), 90);
    assert.equal(xOf(500, 100), 970);
  });

  it('a bar is at least 2 px wide and leaves a 1 px gap before the next', () => {
    assert.deepEqual(barRect({ startSec: 10, endSec: 10.01 }, 100), { x: 178, w: 2 });
    assert.deepEqual(barRect({ startSec: 0, endSec: 50 }, 100), { x: 90, w: 439 });
  });
});

describe('trial spans', () => {
  it('applies the session offset to every trial: seconds since the session started', () => {
    const { aligned, spans } = trialSpans([trial('a', 5000, 2000), trial('b', 7000, 1500, { phase: 'main' })], 2000);
    assert.equal(aligned, true);
    assert.deepEqual(spans, [
      { index: 0, id: 'a', phase: null, startSec: 3, endSec: 5, truncated: false },
      { index: 1, id: 'b', phase: 'main', startSec: 5, endSec: 6.5, truncated: false },
    ]);
  });

  it('one trial without a numeric startTime or duration_ms makes the whole session fall back', () => {
    const none = { aligned: false, spans: [] };
    assert.deepEqual(trialSpans([trial('a', 5000, 2000), { trialId: 'b', duration_ms: 100 }], 0), none);
    assert.deepEqual(trialSpans([trial('a', 5000, 2000), { trialId: 'b', startTime: 7000 }], 0), none);
    assert.deepEqual(trialSpans([trial('a', 'x', 2000)], 0), none);
    assert.deepEqual(trialSpans([trial('a', 0, -1)], 0), none);
    assert.deepEqual(trialSpans([null], 0), none);
    assert.deepEqual(trialSpans([], 0), none);
    assert.deepEqual(trialSpans(undefined, 0), none);
  });

  it('"default" and an empty string are no phase; a name falls back to the rule id, then the position', () => {
    assert.equal(phaseOf({ phase: 'default' }), null);
    assert.equal(phaseOf({ phase: '' }), null);
    assert.equal(phaseOf({ phase: 3 }), null);
    assert.equal(phaseOf({ phase: 'tutorial' }), 'tutorial');
    assert.equal(trialLabel({ trialId: 'q-7' }, 0), 'q-7');
    assert.equal(trialLabel({ ruleId: 'r2' }, 0), 'r2');
    assert.equal(trialLabel({}, 4), 'T5');
  });
});

describe('Text input marks', () => {
  it('copies, cuts, pastes, drops and synthetic insertions go through the same offset as the trials', () => {
    const m = inputMarks([trial('a', 5000, 2000, {
      copyEvents: [{ type: 'copy', t: 5500 }, { type: 'cut', t: 5600 }],
      pasteEvents: [{ type: 'paste', t: 6000, text: 'x' }],
      dropEvents: [{ t: 6200 }],
      syntheticInsertions: [{ t: 6300 }, { t: 6400 }],
    })], 2000);
    assert.deepEqual(m.copies, [{ index: 0, sec: 3.5, kind: 'copy' }, { index: 0, sec: 3.6, kind: 'cut' }]);
    assert.deepEqual(m.pastes, [{ index: 0, sec: 4 }]);
    assert.deepEqual(m.drops, [{ index: 0, sec: 4.2 }]);
    assert.deepEqual(m.synthetic, [{ index: 0, secs: [4.3, 4.4], count: 2 }]);
  });

  it('events without a numeric time and junk entries are left out; trials without start times still give marks', () => {
    const m = inputMarks([{ trialId: 'a', copyEvents: [{ type: 'copy' }, null, 7, { t: 'x' }, { type: 'copy', t: 1000 }], pasteEvents: 'no' }, null], 0);
    assert.deepEqual(m.copies, [{ index: 0, sec: 1, kind: 'copy' }]);
    assert.deepEqual([m.pastes, m.drops, m.synthetic], [[], [], []]);
  });
});

describe('phases and guides', () => {
  const spans = trialSpans([
    trial('t-1', 0, 1000, { phase: 'tutorial' }), trial('t-2', 1000, 1000, { phase: 'tutorial' }),
    trial('q-1', 2000, 1000, { phase: 'main' }), trial('q-2', 3000, 1000), trial('d', 4000, 1000, { phase: 'debrief' }),
  ], 0).spans;

  it('a run starts where the phase changes, in time order; an unset phase among set ones is "no phase"', () => {
    assert.deepEqual(phaseRuns(spans), [
      { sec: 0, label: 'tutorial' }, { sec: 2, label: 'main' }, { sec: 3, label: NO_PHASE }, { sec: 4, label: 'debrief' }]);
  });

  it('a guide at every trial start; a phase line at every change after the first run', () => {
    const g = guides(spans, 5);
    assert.deepEqual(g.trialStarts, [0, 1, 2, 3, 4]);
    assert.equal(g.trialLinesHidden, 0);
    assert.deepEqual(g.phaseChanges.map((r) => r.label), ['main', NO_PHASE, 'debrief']);
    assert.equal(g.runs.length, 4);
  });

  it('no phase set anywhere ("default" included): no runs, no phase lines', () => {
    const plain = trialSpans([trial('a', 0, 1000, { phase: 'default' }), trial('b', 1000, 1000)], 0).spans;
    assert.deepEqual(phaseRuns(plain), []);
    assert.deepEqual(guides(plain, 2).phaseChanges, []);
  });

  it('the domain grows to the last trial end and the last mark, and never shrinks', () => {
    const sp = trialSpans([trial('a', 0, 30000)], 0).spans;
    const marks = inputMarks([trial('a', 0, 30000, { pasteEvents: [{ t: 45000 }] })], 0);
    assert.equal(coverDomain(10, sp, marks), 45);
    assert.equal(coverDomain(100, sp, marks), 100);
  });
});

describe('typing bars', () => {
  const trials = [
    { trialId: 'slow', charsPerSec: 4.2 },
    { trialId: 'fast', charsPerSec: 15 },
    { trialId: 'short', charsPerSec: 11.8 },
    { trialId: 'pasted', pasteEvents: [{ t: 1 }], copyEvents: [{ type: 'copy', t: 0 }] },
    { trialId: 'empty' },
  ];
  const row = (b) => [b.kind, b.cps, b.fast, b.glyphs.join('')];

  it('the threshold: the participant\'s saved one, then the CLI\'s, then 10', () => {
    assert.equal(typingThreshold({ session: { config: { thresholds: { typingSpeedCps: 8 } } } }, { typingSpeedThreshold_cps: 12 }), 8);
    assert.equal(typingThreshold({}, { typingSpeedThreshold_cps: 12 }), 12);
    assert.equal(typingThreshold({}, {}), 10);
  });

  it('without a typing analysis: the library rate, judged whenever it is a number; C and P above', () => {
    assert.deepEqual(typingBars(trials, null, 10).map(row), [
      ['typed', 4.2, false, ''], ['typed', 15, true, ''], ['typed', 11.8, true, ''],
      ['paste-only', null, false, 'CP'], ['none', null, false, '']]);
  });

  it('with one: its rate and judgement per trial, by position, R where the rhythm rule fired; a missing entry falls back to the library', () => {
    const analysis = { byIndex: [
      { cps: 4.1, judged: true, rhythm: true },
      { cps: 14.9, judged: true, rhythm: false },
      { cps: null, judged: false, rhythm: false },
      null,
      { cps: null, judged: false, rhythm: false },
    ] };
    assert.deepEqual(typingBars(trials, analysis, 10).map(row), [
      ['typed', 4.1, false, 'R'], ['typed', 14.9, true, ''], ['none', null, false, ''],
      ['paste-only', null, false, 'CP'], ['none', null, false, '']]);
  });

  it('two trials with one id get their own entries', () => {
    const twins = [{ trialId: 'baseline', charsPerSec: 3 }, { trialId: 'baseline', charsPerSec: 4 }];
    const analysis = { byIndex: [{ cps: 3, judged: true, rhythm: false }, { cps: 4, judged: true, rhythm: true }] };
    assert.deepEqual(typingBars(twins, analysis, 10).map(row), [['typed', 3, false, ''], ['typed', 4, false, 'R']]);
  });

  it('an analysis with another number of entries (a phase scope analysed fewer trials) is not used: library rates, no R', () => {
    const analysis = { byIndex: [{ cps: 1, judged: true, rhythm: true }] };
    assert.deepEqual(typingBars(trials, analysis, 10).map(row)[0], ['typed', 4.2, false, '']);
  });

  it('the y-axis reaches a round number above the fastest judged trial and 1.5 × the threshold', () => {
    assert.deepEqual(typingAxis(10, typingBars(trials, null, 10)), { max: 15, step: 5 });
    assert.deepEqual(typingAxis(10, [{ kind: 'typed', cps: 31 }]), { max: 40, step: 10 });
    assert.deepEqual(typingAxis(10, [{ kind: 'typed', cps: 157.5 }]), { max: 160, step: 20 });
    assert.deepEqual(typingAxis(10, [{ kind: 'none', cps: null }]), { max: 15, step: 5 });
    assert.deepEqual(typingAxis(0, []), { max: 5, step: 5 });
  });

  it('above 160 cps the step grows (1, 2 or 5 × a power of ten) so the axis keeps at most 8 steps', () => {
    assert.deepEqual(typingAxis(10, [{ kind: 'typed', cps: 161 }]), { max: 200, step: 50 });
    assert.deepEqual(typingAxis(10, [{ kind: 'typed', cps: 500 }]), { max: 500, step: 100 });
    assert.deepEqual(typingAxis(10, [{ kind: 'typed', cps: 2000 }]), { max: 2000, step: 500 });
    for (const a of [typingAxis(10, [{ kind: 'typed', cps: 1e300 }]), typingAxis(Number.MAX_VALUE, [])]) {
      assert.ok(Number.isFinite(a.max) && a.max / a.step <= 8, JSON.stringify(a));
    }
  });
});

describe('glyph places over a bar', () => {
  // Bold 11 px glyphs, each about GLYPH.w wide and GLYPH.h tall above its
  // baseline; GLYPH.step apart in a row, GLYPH.line apart in a column.
  const box = (g) => ({ x0: g.x, x1: g.x + GLYPH.w, y0: g.y - GLYPH.h, y1: g.y });

  it('a row centred over the bar, 3 px above it, when the row fits the bar\'s width', () => {
    assert.deepEqual({ ...GLYPH }, { w: 8, h: 9, step: 10, line: 11 });
    assert.deepEqual(glyphPlaces(['C', 'P'], { x: 100, w: 20, top: 150 }, 44), [
      { glyph: 'C', x: 101, y: 147, outlined: false },
      { glyph: 'P', x: 111, y: 147, outlined: false }]);
  });

  it('a column when the row is wider than the bar, its lowest glyph 3 px above the bar', () => {
    assert.deepEqual(glyphPlaces(['C', 'P', 'R'], { x: 100, w: 12, top: 150 }, 44).map((g) => [g.glyph, g.x, g.y, g.outlined]),
      [['C', 102, 125, false], ['P', 102, 136, false], ['R', 102, 147, false]]);
    // Two glyphs make an 18 px row: a column on a 17 px bar, a row on an 18 px one.
    assert.equal(new Set(glyphPlaces(['C', 'P'], { x: 0, w: 17, top: 150 }, 44).map((g) => g.x)).size, 1);
    assert.equal(new Set(glyphPlaces(['C', 'P'], { x: 0, w: 18, top: 150 }, 44).map((g) => g.y)).size, 1);
  });

  it('inside the bar\'s top, outlined, when above it they would cross the plot\'s top', () => {
    // A column of three needs 3 + 9 + 2 × 11 = 34 px above the bar.
    assert.deepEqual(glyphPlaces(['C', 'P', 'R'], { x: 100, w: 12, top: 77 }, 44).map((g) => [g.y, g.outlined]),
      [[89, true], [100, true], [111, true]]);
    assert.equal(glyphPlaces(['C', 'P', 'R'], { x: 100, w: 12, top: 78 }, 44)[0].outlined, false);
    // A row needs 12 px.
    assert.equal(glyphPlaces(['C'], { x: 100, w: 12, top: 56 }, 44)[0].outlined, false);
    assert.equal(glyphPlaces(['C'], { x: 100, w: 12, top: 55 }, 44)[0].outlined, true);
  });

  it('every glyph stays between its bar\'s sides and under the plot\'s top, for every bar at least 8 px wide', () => {
    for (let w = 8; w <= 40; w += 0.25) {
      for (const glyphs of [['C'], ['P'], ['C', 'P'], ['C', 'R'], ['C', 'P', 'R']]) {
        for (const top of [44, 50, 80, 150, 174]) {
          for (const b of glyphPlaces(glyphs, { x: 100, w, top }, 44).map(box)) {
            assert.ok(b.x0 >= 100 && b.x1 <= 100 + w, `${glyphs} on a ${w} px bar`);
            assert.ok(b.y0 >= 44, `${glyphs} over a bar at ${top}`);
          }
        }
      }
    }
  });

  it('no glyph, no place', () => {
    assert.deepEqual(glyphPlaces([], { x: 0, w: 10, top: 0 }, 0), []);
  });
});

describe('insertion counts in the Text input lane', () => {
  const LANE = { left: 90, right: 970, top: 100, height: 32 };
  const textBox = (c) => ({ left: c.x, right: c.x + (c.text.length) * COUNT_LABEL.charW, top: c.y - 7, bottom: c.y });
  const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const patchBox = (c) => ({ left: c.patch.x, right: c.patch.x + c.patch.w, top: c.patch.y, bottom: c.patch.y + c.patch.h });

  it('two rows fit a 32 px lane: patches at y + 3 and y + 13, baselines at y + 12 and y + 22', () => {
    const places = countLabelPlaces([{ count: 44, x: 300 }, { count: 3, x: 310 }], [], LANE);
    assert.deepEqual(places.map((c) => [c.text, c.x, c.y, c.patch.y, c.patch.h]),
      [['×44', 303, 112, 103, 10], ['×3', 313, 122, 113, 10]]);
  });

  it('a count is pushed right past a mark in its row, and kept inside the lane', () => {
    const copy = { left: 300, right: 310, top: 106.5, bottom: 115 };
    assert.equal(countLabelPlaces([{ count: 3, x: 297 }], [copy], LANE)[0].x, 312);
    // A count at the end of the lane ends 1 px inside it, patch and all.
    const [end] = countLabelPlaces([{ count: 10000, x: 969 }], [], LANE);
    assert.ok(end.patch.x + end.patch.w <= LANE.right, `patch ends at ${end.patch.x + end.patch.w}`);
  });

  it('a crowd merges into one count of its total, at its first burst, however many bursts reach it', () => {
    // Bursts 1 px apart: each later one reaches the merged count.
    for (const n of [3, 5, 12]) {
      const bursts = Array.from({ length: n }, (_, k) => ({ count: k + 1, x: 400 + k }));
      const places = countLabelPlaces(bursts, [], LANE);
      assert.deepEqual(places.map((c) => [c.text, c.x]), [['×' + (n * (n + 1)) / 2, 403]], `${n} bursts`);
    }
    // A burst past the merged count's end keeps a count of its own.
    const spread = countLabelPlaces([1, 2, 3, 4].map((count, k) => ({ count, x: k < 3 ? 400 + k : 440 })), [], LANE);
    assert.deepEqual(spread.map((c) => c.text), ['×6', '×4']);
  });

  it('a count slides at most its patch\'s width to clear marks, else sits at its ticks in the row with fewer marks', () => {
    const copy = (cx) => ({ left: cx - 5, right: cx + 5, top: 106.5, bottom: 115 });
    const paste = (cx) => ({ left: cx - 5, right: cx + 5, top: 117, bottom: 125.5 });
    // Twenty copies 9 px apart after the burst: no clear spot within 13.6 px.
    const run = Array.from({ length: 20 }, (_, i) => copy(306 + 9 * i));
    const [sits] = countLabelPlaces([{ count: 5, x: 300 }], run, LANE);
    assert.equal(sits.x, 303, 'at its ticks');
    // A copy and a paste under it: row 0 has one mark, row 1 two.
    const [row0] = countLabelPlaces([{ count: 5, x: 300 }], [...run, ...Array.from({ length: 20 }, (_, i) => paste(306 + 9 * i))], LANE);
    assert.deepEqual([row0.x, row0.y], [303, 112]);
    // A copy reaches both rows and a paste only the second, so with the
    // lane's marks the first row never has more. With boxes in each row
    // alone, no clear spot in either, and three under the count's place in
    // the first row against two in the second, it sits in the second.
    const high = Array.from({ length: 16 }, (_, i) => ({ left: 281 + 5 * i, right: 285 + 5 * i, top: 104, bottom: 111 }));
    const low = Array.from({ length: 9 }, (_, i) => ({ left: 283 + 10 * i, right: 292 + 10 * i, top: 117, bottom: 121 }));
    const [row1] = countLabelPlaces([{ count: 5, x: 300 }], [...high, ...low], LANE);
    assert.deepEqual([row1.x, row1.y], [303, 122]);
    // One copy right after the burst: cleared within the limit, to its right.
    const [clears] = countLabelPlaces([{ count: 3, x: 297 }], [copy(305)], LANE);
    assert.equal(clears.x, 312);
    // A run of copies to the right, room to the left: the left side, within
    // the limit (13.6 px for ×3).
    const [left] = countLabelPlaces([{ count: 3, x: 300 }], [copy(308), copy(318), copy(328), copy(278)], LANE);
    assert.equal(left.x, 289.4);
  });

  it('countLabelPlaces stays fast with many marks at one x', () => {
    // 20,000 bursts at one x, each with a paste there.
    const n = 20000;
    const marks = Array.from({ length: n }, () => ({ left: 495, right: 505, top: 117, bottom: 125.5 }));
    const bursts = Array.from({ length: n }, () => ({ count: 1, x: 500 }));
    const started = performance.now();
    const places = countLabelPlaces(bursts, marks, LANE);
    const ms = performance.now() - started;
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
    assert.equal(places.reduce((t, c) => t + Number(c.text.slice(1)), 0), n);
  });

  it('no count meets another, every insertion is counted once, and every count stays inside the lane', () => {
    // Pseudo-random bursts and marks, the same on every run.
    let seed = 7;
    const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    for (let run = 0; run < 50; run++) {
      const bursts = Array.from({ length: 2 + Math.floor(rand() * 30) }, () => ({ count: 1 + Math.floor(rand() * 200), x: 90 + rand() * 880 }));
      const marks = Array.from({ length: Math.floor(rand() * 40) }, () => {
        const cx = 95 + rand() * 870;
        return rand() < 0.5 ? { left: cx - 5, right: cx + 5, top: 106.5, bottom: 115 } : { left: cx - 5, right: cx + 5, top: 117, bottom: 125.5 };
      });
      const places = countLabelPlaces(bursts, marks, LANE);
      // Bursts 60 px apart never meet: each keeps its own count, within its
      // patch's width of its ticks (or of the lane's end).
      const apart = Array.from({ length: 14 }, (_, k) => ({ count: 1 + Math.floor(rand() * 200), x: 100 + 60 * k + rand() * 10 }));
      const own = countLabelPlaces(apart, marks, LANE);
      assert.equal(own.length, apart.length, `run ${run}: a count for each burst`);
      own.forEach((c, k) => {
        const w = c.text.length * COUNT_LABEL.charW;
        const home = Math.min(apart[k].x + 3, LANE.right - w - 1);
        assert.ok(Math.abs(c.x - home) <= w + 2, `run ${run}: ${c.text} at ${c.x}, its ticks at ${apart[k].x}`);
      });
      const total = places.reduce((n, c) => n + Number(c.text.slice(1)), 0);
      assert.equal(total, bursts.reduce((n, b) => n + b.count, 0), `run ${run}: every insertion counted once`);
      for (let i = 0; i < places.length; i++) {
        assert.ok(places[i].patch.x >= LANE.left && places[i].patch.x + places[i].patch.w <= LANE.right, `run ${run}: inside the lane`);
        for (let j = i + 1; j < places.length; j++) {
          assert.ok(!meet(textBox(places[i]), textBox(places[j])), `run ${run}: ${places[i].text} and ${places[j].text} apart`);
          assert.ok(!meet(patchBox(places[i]), textBox(places[j])) && !meet(patchBox(places[j]), textBox(places[i])), `run ${run}: no patch on a count`);
        }
      }
    }
  });
});

describe('the session timeline\'s rows', () => {
  it('neither strip: the five lanes from y 65', () => {
    const r = timelineRows({ phasesStrip: false, trialsStrip: false });
    assert.deepEqual([r.phasesY, r.trialsY, r.lanesTop, r.guidesTop], [null, null, 65, 65]);
    assert.deepEqual(r.lanes.map((l) => [l.name, l.y]), [
      ['Text input', 65], ['Tab-aways', 103], ['Sidebars', 141], ['Viewport shifts', 179], ['Guard-friction', 217]]);
    assert.equal(r.lanesBottom, 249);
    assert.equal(r.height, 365);
  });

  it('the phase strip, then the Trials strip, each 24 px and a 6 px gap; guides start at the Trials strip', () => {
    const r = timelineRows({ phasesStrip: true, trialsStrip: true });
    assert.deepEqual([r.phasesY, r.trialsY, r.lanesTop, r.guidesTop, r.lanesBottom, r.height], [65, 95, 125, 95, 309, 425]);
  });
});

describe('the numbers the hover script reads', () => {
  it('geometry, domain, each trial with its phase, judged rate and truncation, tab-aways and sidebar spans', () => {
    const spans = trialSpans([trial('a', 0, 4000, { phase: 'main' }), trial('b', 4000, 6000)], 0).spans;
    const layout = {
      domainSec: 12.3456, spans,
      bars: [{ kind: 'typed', cps: 4.2 }, { kind: 'paste-only', cps: null }],
      events: {
        tabAways: [{ t_sec: 5, duration_ms: 1500 }, { t_sec: NaN, duration_ms: 10 }],
        sidebarSpans: [{ start_sec: 1, end_sec: 2, closed: true }, { start_sec: 9, end_sec: 0, closed: false }],
      },
    };
    assert.deepEqual(hoverData(layout), {
      w: 1000, left: 90, chart: 880, domain: 12.35,
      trials: [['a', 'main', 0, 4, 4.2, false], ['b', null, 4, 10, null, false]],
      tabs: [[5, 6.5]],
      sidebars: [[1, 2], [9, 12.35]],
    });
  });

  it('a judged rate is rounded as the times are, so the label never prints a long fraction', () => {
    // A rate the library saved unrounded (older payloads), drawn without a
    // typing analysis: the bar keeps its value, the hover number is rounded.
    const trials = [trial('a', 0, 4000, { charsPerSec: 10 / 3 }), trial('b', 4000, 2000, { charsPerSec: 2 / 3 })];
    const { spans } = trialSpans(trials, 0);
    const bars = typingBars(trials, null, 10);
    assert.equal(bars[0].cps, 10 / 3);
    const rows = hoverData({ domainSec: 6, spans, bars, events: {} }).trials;
    assert.deepEqual(rows.map((r) => r[4]), [3.33, 0.67]);
  });
});

// A session of n trials, one every everyMs, each durMs long, with a copy and
// a paste in each; phaseAt(i) names trial i's phase. Built with a loop, as
// every large fixture is.
function crowded(n, everyMs, durMs, phaseAt = () => undefined) {
  const trials = [];
  for (let i = 0; i < n; i++) {
    const start = i * everyMs;
    trials.push(trial('q-' + (i + 1), start, durMs, {
      phase: phaseAt(i),
      copyEvents: [{ type: 'copy', t: start + 100 }],
      pasteEvents: [{ t: start + 200 }],
    }));
  }
  return trials;
}
// The domain those trials give on their own: up to the last trial's end.
const domainOf = (trials) => coverDomain(0, trialSpans(trials, 0).spans, inputMarks(trials, 0));

describe('crowded sessions', () => {
  it('300 trials: no trial-start lines, and the number of trials for the legend; phase lines stay', () => {
    const trials = crowded(300, 2000, 1500, (i) => (i < 150 ? 'practice' : 'main'));
    const g = guides(trialSpans(trials, 0).spans, domainOf(trials));
    assert.deepEqual(g.trialStarts, []);
    assert.equal(g.trialLinesHidden, 300);
    assert.deepEqual(g.phaseChanges, [{ sec: 300, label: 'main' }]);
    assert.equal(g.runs.length, 2);
  });

  it('300 trials: no glyph on a bar under 8 px; the Text input lane and the per-trial chart keep every one', () => {
    const trials = crowded(300, 2000, 1500);
    const { spans } = trialSpans(trials, 0);
    const marks = inputMarks(trials, 0);
    const domainSec = coverDomain(0, spans, marks);
    const byIndex = [];
    for (let i = 0; i < 300; i++) byIndex.push({ cps: 5, judged: true, rhythm: true });
    assert.ok(spans.every((s) => barRect(s, domainSec).w < 8), 'every bar is narrow');
    const onAxis = typingBars(trials, { byIndex }, 10, { spans, domainSec });
    assert.ok(onAxis.every((b) => b.kind === 'typed' && b.cps === 5 && b.glyphs.length === 0));
    // The per-trial chart (30 px bars) and the Text input lane still show them.
    assert.ok(typingBars(trials, { byIndex }, 10).every((b) => b.glyphs.join('') === 'CPR'));
    assert.equal(marks.copies.length, 300);
    assert.equal(marks.pastes.length, 300);
  });

  it('20 trials: a line at every trial start, and the glyphs above their bars', () => {
    const trials = crowded(20, 30000, 25000);
    const { spans } = trialSpans(trials, 0);
    const domainSec = domainOf(trials);
    const g = guides(spans, domainSec);
    assert.equal(g.trialStarts.length, 20);
    assert.equal(g.trialLinesHidden, 0);
    assert.ok(typingBars(trials, null, 10, { spans, domainSec }).every((b) => b.glyphs.join('') === 'CP'));
  });

  it('trial-start lines need starts 6 px apart on average on the chart: 147 trials keep them, 148 do not', () => {
    // Trials 1 s apart, the domain at the last one's end (n − 0.5 s): the
    // starts average 880 / (n − 0.5) px apart, 6.007 for 147 and 5.966 for 148.
    const keepTrials = crowded(147, 1000, 500);
    const keep = guides(trialSpans(keepTrials, 0).spans, domainOf(keepTrials));
    assert.equal(keep.trialStarts.length, 147);
    assert.equal(keep.trialLinesHidden, 0);
    const hideTrials = crowded(148, 1000, 500);
    const hide = guides(trialSpans(hideTrials, 0).spans, domainOf(hideTrials));
    assert.deepEqual(hide.trialStarts, []);
    assert.equal(hide.trialLinesHidden, 148);
  });

  it('the spacing is measured where the trials are: 100 trials squeezed into the last tenth of the domain lose their lines', () => {
    // 100 trials 1 s apart from 900 s on a 1000 s domain: their starts span
    // 87 px, under 1 px apart, though 880 / 100 trials would be 8.8 px.
    const trials = [];
    for (let i = 0; i < 100; i++) trials.push(trial('q-' + (i + 1), 900000 + i * 1000, 500));
    const g = guides(trialSpans(trials, 0).spans, 1000);
    assert.deepEqual(g.trialStarts, []);
    assert.equal(g.trialLinesHidden, 100);
    // One trial has no spacing to measure: its line is drawn.
    assert.deepEqual(guides(trialSpans([trial('a', 900000, 500)], 0).spans, 1000).trialStarts, [900]);
  });

  it('a bar 8 px wide keeps its glyphs, a narrower one has none; a trial with no span keeps them', () => {
    // On an 880 s domain one second is one pixel: bars of 9 − 1 and 8.5 − 1 px.
    const trials = [trial('a', 0, 9000, { pasteEvents: [{ t: 100 }] }), trial('b', 20000, 8500, { pasteEvents: [{ t: 20100 }] })];
    const { spans } = trialSpans(trials, 0);
    assert.deepEqual(spans.map((s) => barRect(s, 880).w), [8, 7.5]);
    assert.deepEqual(typingBars(trials, null, 10, { spans, domainSec: 880 }).map((b) => b.glyphs.join('')), ['P', '']);
    assert.deepEqual(typingBars(trials, null, 10, { spans: [], domainSec: 880 }).map((b) => b.glyphs.join('')), ['P', 'P']);
  });
});

describe('trimmed Qualtrics pages', () => {
  // The Qualtrics reader's fixture: response R_2 is a payload reduced to
  // level 2, so every page but the newest lost its events and is marked
  // integrityTruncated.
  const csv = readFileSync(new URL('./fixtures/qualtrics-export.csv', import.meta.url), 'utf8');
  const raw = parseQualtricsExport(csv, {}).responses[1].raw;
  const { trials } = extractIntegrityData(raw, {});

  it('a trimmed page\'s span says so, and so does its entry in the hover numbers', () => {
    const { aligned, spans } = trialSpans(trials, 0);
    assert.equal(aligned, true);
    assert.deepEqual(spans.map((s) => [s.id, s.truncated]), [
      ['page-1', true], ['page-2', true], ['page-3', true], ['page-4', true], ['page-5', false]]);
    const layout = { domainSec: 98, spans, bars: typingBars(trials, null, 10), events: { tabAways: [], sidebarSpans: [] } };
    const rows = hoverData(layout).trials;
    assert.deepEqual(rows.map((r) => r[5]), [true, true, true, true, false]);
    assert.deepEqual(rows[0], ['page-1', null, 0, 18, null, true]);
    // The trimmed pages give no Text input marks; the newest keeps its pastes.
    assert.deepEqual([...new Set(inputMarks(trials, 0).pastes.map((m) => m.index))], [4]);
  });

  it('the typing bars carry the flag too, for the chart drawn one bar per trial', () => {
    assert.deepEqual(typingBars(trials, null, 10).map((b) => b.truncated), [true, true, true, true, false]);
    // Without start times the trials do not align, and only the bars say so.
    const loose = trials.map(({ startTime, ...rest }) => rest);
    assert.deepEqual(trialSpans(loose, 0).spans, []);
    assert.deepEqual(typingBars(loose, null, 10).map((b) => b.truncated), [true, true, true, true, false]);
  });

  it('only true marks a page trimmed', () => {
    const list = [trial('a', 0, 1000, { integrityTruncated: 'true' }), trial('b', 1000, 1000, { integrityTruncated: 1 }), null];
    assert.deepEqual(trialSpans(list.slice(0, 2), 0).spans.map((s) => s.truncated), [false, false]);
    assert.deepEqual(typingBars(list, null, 10).map((b) => b.truncated), [false, false, false]);
  });
});

describe('hostile data', () => {
  it('an offset or a time that is not a finite number of seconds makes the session fall back, and gives no marks', () => {
    assert.deepEqual(trialSpans([trial('a', 0, 1000)], NaN), { aligned: false, spans: [] });
    assert.deepEqual(trialSpans([trial('a', 1e308, 1000)], -1e308), { aligned: false, spans: [] });
    const m = inputMarks([trial('a', 0, 1000, { pasteEvents: [{ t: 10 }], syntheticInsertions: [{ t: 20 }] })], NaN);
    assert.deepEqual([m.pastes, m.synthetic], [[], []]);
  });

  it('a trial id is text or a finite number, else the trial is named by its place', () => {
    assert.equal(trialLabel({ trialId: 0 }, 2), '0');
    assert.equal(trialLabel({ trialId: 7 }, 2), '7');
    assert.equal(trialLabel({ trialId: { x: 1 } }, 2), 'T3');
    assert.equal(trialLabel({ trialId: '', ruleId: 'r9' }, 2), 'r9');
    assert.equal(trialLabel({ trialId: NaN, ruleId: [] }, 2), 'T3');
    assert.equal(trialLabel(null, 0), 'T1');
  });

  it('xOf puts every time at the left margin on an empty or broken domain', () => {
    assert.equal(xOf(5, 0), 90);
    assert.equal(xOf(5, NaN), 90);
    assert.equal(xOf(5, Infinity), 90);
    assert.equal(xOf(NaN, 100), 90);
    assert.equal(xOf(undefined, 100), 90);
    assert.equal(xOf('5', 100), 90);
    assert.equal(xOf(Infinity, 100), 970);
    assert.equal(xOf(-Infinity, 100), 90);
  });

  it('a domain that is not a number puts every trial start at one x: the lines are hidden', () => {
    const spans = trialSpans([trial('a', 0, 1000), trial('b', 1000, 1000)], 0).spans;
    assert.equal(guides(spans, NaN).trialLinesHidden, 2);
  });

  it('a timeline domain that is not a number (unreadable start and end times) is widened from 0', () => {
    const sp = trialSpans([trial('a', 0, 30000)], 0).spans;
    assert.equal(coverDomain(NaN, sp, inputMarks([], 0)), 30);
  });

  it('the threshold is read only when it is a number', () => {
    const p = (v) => ({ session: { config: { thresholds: { typingSpeedCps: v } } } });
    assert.equal(typingThreshold(p('8'), { typingSpeedThreshold_cps: 12 }), 12);
    assert.equal(typingThreshold(p(NaN), { typingSpeedThreshold_cps: '12' }), 10);
    assert.equal(typingThreshold({ session: 'x' }, null), 10);
    assert.equal(typingThreshold(null, undefined), 10);
  });

  it('typing bars read only numbers and objects', () => {
    const analysis = { byIndex: [{ cps: '9', judged: true, rhythm: 'yes' }, 7] };
    assert.deepEqual(typingBars([{ charsPerSec: Infinity }, 'x'], analysis, 10).map((b) => [b.kind, b.cps, b.glyphs.join('')]),
      [['none', null, ''], ['none', null, '']]);
    assert.deepEqual(typingBars('x', null, 10), []);
    assert.deepEqual(typingAxis(NaN, [{ kind: 'typed', cps: NaN }, null]), { max: 5, step: 5 });
  });

  it('rows without arguments, and hover numbers with a tab-away whose duration is not a number', () => {
    assert.equal(timelineRows().lanesTop, 65);
    const layout = { domainSec: 10, spans: [], bars: [], events: { tabAways: [{ t_sec: 2, duration_ms: 'x' }], sidebarSpans: [] } };
    assert.deepEqual(hoverData(layout).tabs, [[2, 2]]);
  });
});
