// tests/cli/cursor.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CURSOR_LIMITS, segmentMovements, analyzeCursorForParticipant, analyzeCursor } from '../../src/cli/analyzers/cursor.js';

// Builders. Times are trial-relative ms; trials carry startTime (ms since
// page load) and duration_ms so inter-trial gaps can be measured.
const mv = (x, y, t, extra = {}) => ({ x, y, cx: x, cy: y, t, type: 'move', ...extra });
const ck = (x, y, t, extra = {}) => ({ x, y, cx: x, cy: y, t, type: 'click', trusted: true, detail: 1, pointerType: 'mouse', ...extra });
const trial = (id, events, over = {}) => ({ trialId: id, startTime: 1000, duration_ms: 5000, tabAwayEvents: [], mouseEvents: events, libraryVersion: '0.14.0', ...over });
const desktop = { maxTouchPoints: 0, coarsePointer: false, webdriver: false };
const participant = (trials, device = desktop, over = {}) => ({ participantId: 'P', trials, session: device === null ? {} : { device }, ...over });

// A human-like path: curved, variable spacing, ending on a click.
function path(x0, y0, x1, y1, t0, n = 12) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    pts.push(mv(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f + 30 * Math.sin(Math.PI * f)), t0 + i * 50 + (i % 3) * 7));
  }
  pts.push(ck(x1, y1, t0 + n * 50 + 40));
  return pts;
}

describe('segmentMovements', () => {
  it('splits at gaps over movementGapMs and a click closes a movement', () => {
    const events = [mv(0, 0, 0), mv(10, 0, 50), mv(20, 0, 100), ck(20, 0, 130), mv(30, 0, 600), mv(40, 0, 650)];
    const m = segmentMovements(events, CURSOR_LIMITS);
    assert.equal(m.length, 2);
    assert.equal(m[0].samples.length, 3);
    assert.equal(m[0].click.t, 130);
    assert.equal(m[1].samples.length, 2);
    assert.equal(m[1].click, null);
  });
  it('gaps of 399, 400 and 401 ms', () => {
    const at = (gap) => segmentMovements([mv(0, 0, 0), mv(5, 0, gap)], CURSOR_LIMITS).length;
    assert.equal(at(399), 1); assert.equal(at(400), 1); assert.equal(at(401), 2);
  });
  it('a one-sample movement is a movement', () => {
    assert.equal(segmentMovements([mv(0, 0, 0)], CURSOR_LIMITS).length, 1);
  });
  it('a click with no moves before it is a movement of its own with no samples', () => {
    const m = segmentMovements([ck(50, 50, 10)], CURSOR_LIMITS);
    assert.equal(m.length, 1);
    assert.equal(m[0].samples.length, 0);
    assert.equal(m[0].click.x, 50);
  });
});

describe('states', () => {
  it('not collected when no trial has a mouse track', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', undefined, { mouseEvents: undefined, libraryVersion: '0.7.3' })]));
    assert.equal(r.state, 'not collected');
    assert.equal(r.cursorReason, 'not collected (recorded with 0.7.3)');
    assert.equal(r.cursor, null);
    assert.equal(r.checks.webdriver.fired, false);
  });
  it('a touch device is no cursor stream and never fires the pointer checks', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [mv(5, 5, 0), ck(5, 5, 10)])], { maxTouchPoints: 5, coarsePointer: true, webdriver: false }));
    assert.equal(r.state, 'no cursor stream (touch device)');
    assert.equal(r.cursor, null);
    assert.equal(r.checks.zeroMoveTrials.fired, false);
  });
  it('trials with no pointer events at all', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [])]));
    assert.equal(r.state, 'no cursor stream (no pointer events)');
  });
  it('trials with only button presses and releases have no pointer events', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [{ x: 5, y: 5, cx: 5, cy: 5, t: 0, type: 'down' }, { x: 5, y: 5, cx: 5, cy: 5, t: 8, type: 'up' }])]));
    assert.equal(r.state, 'no cursor stream (no pointer events)');
    assert.equal(r.cursor, null);
  });
  it('the automation flag fires on a null session too', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [])], { ...desktop, webdriver: true }));
    assert.equal(r.checks.webdriver.fired, true);
    assert.equal(r.factCount, 1);
  });
  it('data without device facts has its checks not recorded and its rules reported', () => {
    const old = trial('q1', [{ x: 0, y: 0, t: 0, type: 'move' }, { x: 300, y: 0, t: 50, type: 'move' }, { x: 300, y: 0, t: 60, type: 'click' }], { libraryVersion: '0.11.0' });
    const r = analyzeCursorForParticipant(participant([old], null));
    assert.equal(r.state, 'ok');
    assert.equal(r.checksRecorded, 0);
    assert.equal(r.checks.webdriver, 'not recorded');
    assert.equal(r.checks.untrustedClicks, 'not recorded');
    assert.equal(r.checks.zeroMoveTrials, 'not recorded');
    assert.equal(r.factCount, null);
    assert.equal(r.cursor.coordinates, 'page');
    assert.equal(r.cursor.rules.jumpClicks.of, 1);
  });
});

describe('the checks of a session with no cursor stream', () => {
  const zero = { count: 0, of: 0, trialIds: [], fired: false };
  const states = [
    ['not collected', [trial('q1', undefined, { mouseEvents: undefined })]],
    ['no cursor stream (no pointer events)', [trial('q1', [])]]
  ];
  for (const [state, trials] of states) {
    it(`${state}, with a device object: every check is an object`, () => {
      const r = analyzeCursorForParticipant(participant(trials));
      assert.equal(r.state, state);
      assert.equal(r.checksRecorded, 3);
      assert.deepEqual(r.checks, { webdriver: { fired: false }, untrustedClicks: zero, zeroMoveTrials: zero });
      assert.equal(r.factCount, 0);
    });
    it(`${state}, without a device object: every check is not recorded`, () => {
      const r = analyzeCursorForParticipant(participant(trials, null));
      assert.equal(r.state, state);
      assert.equal(r.checksRecorded, 0);
      assert.deepEqual(r.checks, { webdriver: 'not recorded', untrustedClicks: 'not recorded', zeroMoveTrials: 'not recorded' });
      assert.equal(r.factCount, null);
    });
  }
  // Only the device object can say a session is a touch device, so this state has no case without one.
  it('no cursor stream (touch device): every check is an object', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [mv(5, 5, 0), ck(5, 5, 10)])], { maxTouchPoints: 5, coarsePointer: true, webdriver: false }));
    assert.equal(r.state, 'no cursor stream (touch device)');
    assert.equal(r.checksRecorded, 3);
    assert.deepEqual(r.checks, { webdriver: { fired: false }, untrustedClicks: zero, zeroMoveTrials: zero });
    assert.equal(r.factCount, 0);
  });
});

describe('checks', () => {
  it('a human path fires nothing', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0))]));
    assert.equal(r.factCount, 0);
    assert.equal(r.checks.untrustedClicks.count, 0);
    assert.equal(r.checks.zeroMoveTrials.count, 0);
    assert.equal(r.cursor.rules.jumpClicks.count, 0);
  });
  it('clicks the page dispatched are counted whatever their detail', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [...path(100, 100, 400, 300, 0), ck(400, 300, 900, { trusted: false, detail: 0 })])]));
    assert.deepEqual(r.checks.untrustedClicks, { count: 1, of: 2, trialIds: ['q1'], fired: true });
    assert.equal(r.factCount, 1);
  });
  it('a keyboard-activated click is counted as such and never fires', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [...path(100, 100, 400, 300, 0), ck(400, 300, 900, { detail: 0, pointerType: undefined })])]));
    assert.equal(r.cursor.features.keyboardClicks, 1);
    assert.equal(r.factCount, 0);
  });
  it('a trial clicked with no movement fires, with its id', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0)), trial('q2', [ck(50, 700, 20)], { startTime: 7000 })]));
    assert.deepEqual(r.checks.zeroMoveTrials, { count: 1, of: 2, trialIds: ['q2'], fired: true });
  });
  it('a click at the last known position does not count as a zero-move trial', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0)), trial('q2', [ck(405, 302, 20)], { startTime: 6100 })]));
    assert.equal(r.checks.zeroMoveTrials.count, 0);
  });
  it('a desktop agent that moves once per click is not a touch device', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [mv(50, 60, 5), ck(50, 60, 6)]), trial('q2', [mv(500, 600, 5), ck(500, 600, 6)], { startTime: 7000 })]));
    assert.equal(r.state, 'ok');
    assert.equal(r.cursor.rules.jumpClicks.count, 1);     // q2's movement starts 700 px from q1's click
  });
});

describe('the last known position', () => {
  it('is forgotten after a gap longer than staleGapMs', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0), { duration_ms: 1000 }), trial('q2', [ck(405, 302, 20)], { startTime: 1000 + 1000 + 2001 })]));
    assert.equal(r.checks.zeroMoveTrials.count, 1);   // the position was stale, so the click is unexplained
  });
  it('is forgotten at a tab-away after the trial\'s last click', () => {
    // q1 ends on a click at (400, 300); q2, 100 ms later, is a lone click 2 px from it.
    const zeroMoves = (tabAwayEvents) => analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0), { tabAwayEvents }), trial('q2', [ck(402, 301, 20)], { startTime: 6100 })])).checks.zeroMoveTrials.count;
    assert.equal(zeroMoves([{ startRel_ms: 1000, duration_ms: 300 }]), 1);   // the position was forgotten, so the click is unexplained
    assert.equal(zeroMoves([]), 0);
  });
  it('is forgotten at a tab-away before a later movement in the same trial', () => {
    // A click at (120, 100), then a movement that starts about 613 px away at 2000 ms.
    const jumps = (tabAwayEvents) => analyzeCursorForParticipant(participant([trial('q1', [ck(120, 100, 140), mv(700, 300, 2000), mv(705, 300, 2050), ck(705, 300, 2090)], { tabAwayEvents })])).cursor.rules.jumpClicks.count;
    assert.equal(jumps([{ startRel_ms: 1500, duration_ms: 300 }]), 0);   // the position was forgotten before the movement
    assert.equal(jumps([]), 1);
  });
  it('is forgotten at every trial boundary when samples have no viewport coordinates', () => {
    const noCx = (e) => { const { cx, cy, ...rest } = e; return rest; };
    const r = analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0).map(noCx)), trial('q2', [noCx(ck(405, 302, 20))], { startTime: 6100 })]));
    assert.equal(r.cursor.coordinates, 'page');
    assert.equal(r.checks.zeroMoveTrials.count, 1);
  });
});

describe('the jump rule', () => {
  it('counts a movement that starts 100 px from the last position, not 99', () => {
    const at = (d) => analyzeCursorForParticipant(participant([trial('q1', [...path(100, 100, 300, 100, 0), mv(300 + d, 100, 1200), mv(300 + d + 5, 100, 1250), ck(300 + d + 5, 100, 1290)])])).cursor.rules.jumpClicks.count;
    assert.equal(at(99), 0);
    assert.equal(at(100), 1);
  });
  it('does not count when the position is invalid', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [mv(500, 500, 0), ck(500, 500, 30)])]));
    assert.equal(r.cursor.rules.jumpClicks.count, 0);
  });
});

describe('features', () => {
  it('medians carry their n; one-sample movements are counted but not measured', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [...path(100, 100, 400, 300, 0), mv(900, 900, 3000), ck(900, 900, 3010)])]));
    assert.equal(r.cursor.movements, 2);
    assert.equal(r.cursor.features.efficiency.n, 1);
    assert.ok(r.cursor.features.efficiency.median < 1 && r.cursor.features.efficiency.median > 0.5);
    assert.ok(r.cursor.features.maxDeviationPx.median > 5);
    assert.equal(r.cursor.features.movesPerTrial.median, 13);
    assert.equal(r.cursor.features.movementsPerTrial.median, 2);
    assert.equal(r.cursor.clicks, 2);
  });
  it('with no two-sample movement the medians are null with n 0', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [mv(5, 5, 0), ck(5, 5, 10)])]));
    assert.deepEqual(r.cursor.features.efficiency, { median: null, n: 0 });
  });
  it('the realised sample interval is the median gap between moves', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0))]));
    assert.ok(r.cursor.sampleIntervalMs >= 50 && r.cursor.sampleIntervalMs <= 60);
  });
  it('a capped trial is counted', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0), { mouseTrackingCapped: true })]));
    assert.equal(r.cursor.cappedTrials, 1);
  });
  it('dt = 0 pairs neither divide nor jump', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [mv(0, 0, 100), mv(0, 0, 100), ck(0, 0, 100)])]));
    assert.equal(r.cursor.rules.jumpClicks.count, 0);
    assert.equal(Number.isFinite(r.cursor.features.speedPxS.median ?? 0), true);
  });
});

describe('analyzeCursor', () => {
  it('returns one result per participant in order', () => {
    const out = analyzeCursor([participant([trial('q1', path(0, 0, 100, 100, 0))], desktop, { participantId: 'A' }), participant([trial('q1', [])], desktop, { participantId: 'B' })], {});
    assert.deepEqual(out.map(r => [r.participantId, r.state]), [['A', 'ok'], ['B', 'no cursor stream (no pointer events)']]);
  });
  it('every limit has a value and a meaning', () => {
    for (const [k, v] of Object.entries(CURSOR_LIMITS)) {
      assert.equal(typeof v.value, 'number', k);
      assert.ok(typeof v.meaning === 'string' && v.meaning.length > 20, k);
    }
  });
});
