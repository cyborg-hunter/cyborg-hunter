// tests/cli/cursor.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CURSOR_LIMITS, segmentMovements, analyzeCursorForParticipant, analyzeCursor, verdictWord } from '../../src/cli/analyzers/cursor.js';

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
  const zero = { count: 0, of: 0, trialIds: [], trials: 0, fired: false };
  const states = [
    ['not collected', [trial('q1', undefined, { mouseEvents: undefined })]],
    ['no cursor stream (no pointer events)', [trial('q1', [])]]
  ];
  for (const [state, trials] of states) {
    it(`${state}, with a device object: every check is an object, and only the automation flag is recorded`, () => {
      const r = analyzeCursorForParticipant(participant(trials));
      assert.equal(r.state, state);
      assert.equal(r.checksRecorded, 1);
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
  it('no cursor stream (touch device): every check is an object, and only the automation flag is recorded', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [mv(5, 5, 0), ck(5, 5, 10)])], { maxTouchPoints: 5, coarsePointer: true, webdriver: false }));
    assert.equal(r.state, 'no cursor stream (touch device)');
    assert.equal(r.checksRecorded, 1);
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
    assert.deepEqual(r.checks.untrustedClicks, { count: 1, of: 2, trialIds: ['q1'], trials: 1, fired: true });
    assert.equal(r.factCount, 1);
  });
  it('a keyboard-activated click is counted as such and never fires', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [...path(100, 100, 400, 300, 0), ck(400, 300, 900, { detail: 0, pointerType: undefined })])]));
    assert.equal(r.cursor.features.keyboardClicks, 1);
    assert.equal(r.factCount, 0);
  });
  it('a trial clicked with no movement fires, with its id', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0)), trial('q2', [ck(50, 700, 20)], { startTime: 7000 })]));
    assert.deepEqual(r.checks.zeroMoveTrials, { count: 1, of: 2, trialIds: ['q2'], trials: 1, fired: true });
  });
  it('counts the trials involved before the ten-id cap, and clicks apart from trials', () => {
    // Eleven trials, each one click with no move 150 px from the last: every
    // trial is clicked without pointer movement, and every click after the
    // first follows a pointer jump.
    const eleven = Array.from({ length: 11 }, (_, i) => trial('q' + (i + 1), [ck(100 + i * 150, 300, 20)], { startTime: 1000 + i * 6000 }));
    const r = analyzeCursorForParticipant(participant(eleven));
    assert.equal(r.checks.zeroMoveTrials.count, 11);
    assert.equal(r.checks.zeroMoveTrials.trials, 11);
    assert.equal(r.checks.zeroMoveTrials.trialIds.length, 10);
    assert.deepEqual({ ...r.cursor.rules.jumpClicks, trialIds: r.cursor.rules.jumpClicks.trialIds.length }, { count: 10, of: 11, trialIds: 10, trials: 10 });
    assert.deepEqual({ ...r.cursor.rules.noPathClicks, trialIds: r.cursor.rules.noPathClicks.trialIds.length }, { count: 10, of: 11, trialIds: 10, trials: 10 });
    assert.equal(r.level, 2);
    assert.equal(r.cursor.trials, 11);
    // Two clicks the page dispatched in one trial: two clicks, one trial.
    const two = analyzeCursorForParticipant(participant([trial('q1', [...path(100, 100, 400, 300, 0), ck(400, 300, 900, { trusted: false }), ck(400, 300, 950, { trusted: false })])]));
    assert.deepEqual(two.checks.untrustedClicks, { count: 2, of: 3, trialIds: ['q1'], trials: 1, fired: true });
  });
  it('a click at the last known position does not count as a zero-move trial', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0)), trial('q2', [ck(405, 302, 20)], { startTime: 6100 })]));
    assert.equal(r.checks.zeroMoveTrials.count, 0);
  });
  it('a touch tap is its own kind: counted, never a pointer click, so a trial tapped with no moves does not fire', () => {
    // A touchscreen laptop: touch points, but a fine primary pointer, so the
    // session is judged as a desktop. Its one click is a tap with no move.
    const laptop = { maxTouchPoints: 10, coarsePointer: false, webdriver: false };
    const r = analyzeCursorForParticipant(participant([trial('q1', [ck(300, 200, 40, { pointerType: 'touch' })])], laptop));
    assert.equal(r.state, 'ok');
    assert.deepEqual(r.checks.zeroMoveTrials, { count: 0, of: 1, trialIds: [], trials: 0, fired: false });
    assert.equal(r.factCount, 0);
    assert.equal(r.cursor.features.touchClicks, 1);
    assert.equal(r.cursor.features.keyboardClicks, 0);
    assert.equal(r.cursor.rules.jumpClicks.of, 0);          // not in the jump rule's denominator
    assert.equal(r.checks.untrustedClicks.of, 1);           // still one of the session's clicks
    assert.equal(r.cursor.clicks, 1);
    // The same click from a mouse fires.
    const mouse = analyzeCursorForParticipant(participant([trial('q1', [ck(300, 200, 40)])], laptop));
    assert.equal(mouse.checks.zeroMoveTrials.count, 1);
    assert.equal(mouse.cursor.features.touchClicks, 0);
  });
  it('an untrusted or keyboard click stays so whatever its pointerType', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [...path(100, 100, 400, 300, 0), ck(400, 300, 900, { trusted: false, pointerType: 'touch' }), ck(400, 300, 950, { detail: 0, pointerType: 'touch' })])]));
    assert.equal(r.checks.untrustedClicks.count, 1);
    assert.equal(r.cursor.features.keyboardClicks, 1);
    assert.equal(r.cursor.features.touchClicks, 0);
  });
  it('a desktop agent that moves once per click is not a touch device', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [mv(50, 60, 5), ck(50, 60, 6)]), trial('q2', [mv(500, 600, 5), ck(500, 600, 6)], { startTime: 7000 })]));
    assert.equal(r.state, 'ok');
    assert.equal(r.cursor.rules.jumpClicks.count, 1);     // q2's movement starts 700 px from q1's click
    assert.equal(r.cursor.rules.noPathClicks.count, 1);
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
    const out = analyzeCursor([participant([trial('q1', path(0, 0, 100, 100, 0))], desktop, { participantId: 'A' }), participant([trial('q1', [])], desktop, { participantId: 'B' })]);
    assert.deepEqual(out.map(r => [r.participantId, r.state]), [['A', 'ok'], ['B', 'no cursor stream (no pointer events)']]);
  });
  it('judges with the limits object it is given, and each result carries the values it judged with', () => {
    // A movement that starts 70 px from the last click: no jump at the
    // default 100 px, a jump at 50 px.
    const trials = [trial('q1', [...path(100, 100, 300, 100, 0), mv(370, 100, 1200), mv(375, 100, 1250), ck(375, 100, 1290)])];
    const custom = { ...CURSOR_LIMITS, discontinuityPx: { value: 50, meaning: CURSOR_LIMITS.discontinuityPx.meaning } };
    const [byDefault] = analyzeCursor([participant(trials)]);
    const [byCustom] = analyzeCursor([participant(trials)], custom);
    assert.equal(byDefault.cursor.rules.jumpClicks.count, 0);
    assert.equal(byCustom.cursor.rules.jumpClicks.count, 1);
    assert.equal(byDefault.limits.discontinuityPx, 100);
    assert.equal(byCustom.limits.discontinuityPx, 50);
    assert.deepEqual(Object.keys(byCustom.limits), Object.keys(CURSOR_LIMITS));
    // A session with no cursor stream carries them too.
    assert.equal(analyzeCursorForParticipant(participant([trial('q1', [])]), custom).limits.discontinuityPx, 50);
  });
  it('every limit has a value and a meaning', () => {
    for (const [k, v] of Object.entries(CURSOR_LIMITS)) {
      assert.equal(typeof v.value, 'number', k);
      assert.ok(typeof v.meaning === 'string' && v.meaning.length > 20, k);
    }
  });
});

describe('first clicks', () => {
  it('the later clicks of a double- or triple-click are not clicks of their own for the rules', () => {
    // A path to (400, 300), then a triple-click there: three clicks, one first click.
    const events = [...path(100, 100, 400, 300, 0), ck(400, 300, 950, { detail: 2 }), ck(400, 300, 1000, { detail: 3 })];
    const r = analyzeCursorForParticipant(participant([trial('q1', events)]));
    assert.equal(r.cursor.clicks, 3);
    assert.equal(r.cursor.rules.jumpClicks.of, 1);
    assert.equal(r.cursor.rules.noPathClicks.of, 1);
    assert.equal(r.checks.untrustedClicks.of, 3);     // still three of the session's clicks
  });
  it('a click with no detail (older data) is a first click', () => {
    const old = trial('q1', [{ x: 0, y: 0, t: 0, type: 'move' }, { x: 300, y: 0, t: 50, type: 'move' }, { x: 300, y: 0, t: 60, type: 'click' }], { libraryVersion: '0.11.0' });
    assert.equal(analyzeCursorForParticipant(participant([old], null)).cursor.rules.noPathClicks.of, 1);
  });
});

describe('clicks that arrived without a path', () => {
  // q1 ends on a click at (400, 300). q2 starts 100 ms later (the position
  // is still known) with a movement of `n` samples at (400 + d, 300), then
  // a click there.
  const after = (n, d, over = {}) => {
    const q2 = [...Array.from({ length: n }, (_, i) => mv(400 + d, 300, 20 + i * 50)), ck(400 + d, 300, 20 + n * 50)];
    return analyzeCursorForParticipant(participant([trial('q1', path(100, 100, 400, 300, 0)), trial('q2', q2, { startTime: 6100, ...over })]));
  };
  it('counts a first click whose movement has at most one sample and starts 20 px or more from the last position', () => {
    assert.deepEqual(after(1, 20).cursor.rules.noPathClicks, { count: 1, of: 2, trialIds: ['q2'], trials: 1 });
    assert.deepEqual(after(0, 20).cursor.rules.noPathClicks, { count: 1, of: 2, trialIds: ['q2'], trials: 1 });
  });
  it('does not count 19 px, two samples, or an unknown position', () => {
    assert.equal(after(1, 19).cursor.rules.noPathClicks.count, 0);
    assert.equal(after(2, 300).cursor.rules.noPathClicks.count, 0);
    assert.equal(after(1, 300, { startTime: 9000 }).cursor.rules.noPathClicks.count, 0);   // 3 s unrecorded: forgotten
  });
  it('is not a jump below 100 px, and is both at 100 px and over', () => {
    assert.deepEqual([after(1, 60).cursor.rules.jumpClicks.count, after(1, 60).cursor.rules.noPathClicks.count], [0, 1]);
    assert.deepEqual([after(1, 100).cursor.rules.jumpClicks.count, after(1, 100).cursor.rules.noPathClicks.count], [1, 1]);
  });
  it('a touch tap and a keyboard activation are not in its denominator', () => {
    const r = analyzeCursorForParticipant(participant([trial('q1', [...path(100, 100, 400, 300, 0), ck(700, 300, 950, { detail: 0, pointerType: undefined }), ck(700, 500, 1000, { pointerType: 'touch' })])], { maxTouchPoints: 10, coarsePointer: false, webdriver: false }));
    assert.equal(r.cursor.rules.noPathClicks.of, 1);
  });
});

describe('the pointer verdict', () => {
  // Builders: `scripted(n)` is n trials, each one move sample then a click
  // at the sample, 300 px apart, 100 ms between trials, so every first
  // click after the first arrives without a path. `humans(n)` is n human
  // paths, each ending 300 px from the last click, spaced the same way.
  const spaced = (i) => ({ startTime: 1000 + i * 5100, duration_ms: 5000 });
  const scripted = (n, extra = {}) => Array.from({ length: n }, (_, i) => trial('q' + (i + 1), [mv(100 + i * 300, 200, 5), ck(100 + i * 300, 200, 6, extra)], spaced(i)));
  const humans = (n) => Array.from({ length: n }, (_, i) => trial('q' + (i + 1), path(100 + i * 300, 200, 400 + i * 300, 200, 0), spaced(i)));
  const verdictOf = (trials, device = desktop, limits) => analyzeCursorForParticipant(participant(trials, device), limits);

  it('exports the words for the levels', () => {
    assert.deepEqual([-1, 0, 1, 2].map(verdictWord), ['not assessed', 'clean', 'suspicious', 'highly suspicious']);
  });
  it('a human session with four or more first clicks is clean, with no tells', () => {
    const r = verdictOf(humans(4));
    assert.deepEqual([r.level, r.verdict, r.tells, r.verdictReason], [0, 'clean', [], null]);
  });
  it('fewer than four first clicks and no browser fact: not assessed, with the count', () => {
    const r = verdictOf(humans(3));
    assert.deepEqual([r.level, r.verdict, r.verdictReason], [-1, 'not assessed', 'only 3 first pointer clicks (the pointer-pattern tells need 4)']);
    assert.equal(verdictOf(humans(1)).verdictReason, 'only 1 first pointer click (the pointer-pattern tells need 4)');
  });
  it('the automation flag makes any session highly suspicious, with the tell', () => {
    for (const trials of [humans(1), humans(4), [trial('q1', [])]]) {
      const r = verdictOf(trials, { ...desktop, webdriver: true });
      assert.equal(r.level, 2);
      assert.deepEqual(r.tells, [{ id: 'webdriver', level: 'high', text: 'automation flag set by the browser', short: 'automation flag', trialIds: [], trials: 0 }]);
    }
    // On a touch device too: the one check it can run.
    assert.equal(verdictOf([trial('q1', [mv(5, 5, 0), ck(5, 5, 10)])], { maxTouchPoints: 5, coarsePointer: true, webdriver: true }).level, 2);
  });
  it('no cursor stream and no fact against it: not assessed, with the state as the reason', () => {
    const r = verdictOf([trial('q1', [])]);
    assert.deepEqual([r.level, r.verdictReason], [-1, 'no cursor stream (no pointer events)']);
    const t = verdictOf([trial('q1', [mv(5, 5, 0), ck(5, 5, 10)])], { maxTouchPoints: 5, coarsePointer: true, webdriver: false });
    assert.deepEqual([t.level, t.verdictReason], [-1, 'no cursor stream (touch device)']);
    const n = verdictOf([trial('q1', undefined, { mouseEvents: undefined, libraryVersion: '0.7.3' })]);
    assert.deepEqual([n.level, n.verdictReason], [-1, 'not collected (recorded with 0.7.3)']);
  });
  it('data without device facts is not assessed, whatever its clicks', () => {
    const old = (i) => trial('q' + (i + 1), [{ x: 100 + i * 300, y: 200, t: 5, type: 'move' }, { x: 100 + i * 300, y: 200, t: 6, type: 'click' }], { ...spaced(i), libraryVersion: '0.11.0' });
    const r = analyzeCursorForParticipant(participant([old(0), old(1), old(2), old(3)], null));
    assert.deepEqual([r.state, r.level, r.verdictReason], ['ok', -1, 'device facts and click provenance not recorded (library before 0.14)']);
    assert.equal(r.cursor.rules.noPathClicks.of, 4);     // the rule is still reported
  });
  it('a scripted cursor: clicks that arrived without a path at 50% or more is highly suspicious', () => {
    const r = verdictOf(scripted(4));   // 3 of 4 first clicks arrive without a path (the first has no position before it)
    assert.equal(r.level, 2);
    assert.deepEqual(r.tells.map(t => [t.id, t.level]), [['noPath', 'high']]);
    assert.equal(r.tells[0].text, 'clicks that arrived without a path: 3 of 4 first clicks (75%)');
    assert.equal(r.tells[0].short, 'clicks without a path 3/4');
    assert.deepEqual(r.tells[0].trialIds, ['q2', 'q3', 'q4']);
  });
  it('the shares: 20% is suspicious, 50% highly, 19% clean', () => {
    // Ten trials: the first k scripted (one sample, 300 px apart), the rest human paths continuing from there.
    const mixed = (k) => [...scripted(k), ...Array.from({ length: 10 - k }, (_, j) => { const i = k + j; return trial('q' + (i + 1), path(100 + (i - 1) * 300, 200, 100 + i * 300, 200, 0), spaced(i)); })];
    // k scripted trials give k - 1 clicks without a path (the first has no position before it) … unless k = 0.
    assert.equal(verdictOf(mixed(2)).cursor.rules.noPathClicks.count, 1);
    assert.equal(verdictOf(mixed(2)).level, 0);                 // 1 of 10 = 10%
    assert.equal(verdictOf(mixed(3)).level, 1);                 // 2 of 10 = 20%
    assert.equal(verdictOf(mixed(6)).level, 2);                 // 5 of 10 = 50%
    assert.deepEqual(verdictOf(mixed(3)).tells.map(t => t.level), ['low']);
  });
  it('trials clicked without pointer movement follow the same shares', () => {
    // Four trials, 3 s apart (the position is forgotten), each a lone click: 4 of 4.
    const lone = Array.from({ length: 4 }, (_, i) => trial('q' + (i + 1), [ck(100 + i * 300, 200, 20)], { startTime: 1000 + i * 8000 }));
    const r = verdictOf(lone);
    assert.equal(r.level, 2);
    assert.deepEqual(r.tells.map(t => t.id), ['zeroMove']);
    assert.equal(r.tells[0].text, 'trials clicked without pointer movement: 4 of 4 (100%)');
    assert.equal(r.tells[0].short, 'trials clicked without movement 4/4');
    // One lone trial among four human ones: 1 of 5 = 20%, suspicious.
    const one = verdictOf([...humans(4), trial('q5', [ck(900, 900, 20)], { startTime: 1000 + 4 * 8000 })]);
    assert.deepEqual([one.level, one.tells[0].id, one.tells[0].level], [1, 'zeroMove', 'low']);
  });
  it('clicks the page’s own scripts dispatched: any makes the session suspicious, half or more highly', () => {
    const one = verdictOf([...humans(4), trial('q5', [...path(1300, 200, 1600, 200, 0), ck(1600, 200, 950, { trusted: false })], spaced(4))]);
    assert.equal(one.level, 1);
    assert.deepEqual(one.tells.map(t => [t.id, t.level, t.text, t.short]), [['untrusted', 'low', 'clicks the page’s own scripts dispatched: 1 of 6 (17%)', 'untrusted clicks 1/6']]);
    const all = verdictOf(humans(4).map(t => ({ ...t, mouseEvents: t.mouseEvents.map(e => e.type === 'click' ? { ...e, trusted: false } : e) })));
    assert.equal(all.level, 2);
    assert.deepEqual(all.tells.map(t => [t.id, t.level]), [['untrusted', 'high']]);
    // Even with too few first clicks for the pattern tells, a fact is judged: three human paths (three first clicks), the last followed by one untrusted click, 1 of 4 (25%).
    const few = verdictOf([...humans(2), trial('q3', [...path(700, 200, 1000, 200, 0), ck(1000, 200, 950, { trusted: false })], spaced(2))]);
    assert.deepEqual([few.level, few.cursor.rules.noPathClicks.of, few.tells.map(t => t.level)], [1, 3, ['low']]);
  });
  it('tells come in order: automation flag, untrusted clicks, clicks without a path, trials without movement', () => {
    // Five lone clicks 300 px apart; the first is untrusted (1 of 5), the four
    // pointer clicks that follow all arrive without a path, and their four
    // trials are clicked without movement (the untrusted click's trial has no
    // pointer click, so it is not one of them).
    const lone = Array.from({ length: 5 }, (_, i) => trial('q' + (i + 1), [ck(100 + i * 300, 200, 20, i === 0 ? { trusted: false } : {})], spaced(i)));
    const r = verdictOf(lone, { ...desktop, webdriver: true });
    assert.deepEqual(r.tells.map(t => [t.id, t.level]), [['webdriver', 'high'], ['untrusted', 'low'], ['noPath', 'high'], ['zeroMove', 'high']]);
    assert.deepEqual(r.tells.map(t => t.trials), [0, 1, 4, 4]);
    assert.equal(r.tells[3].text, 'trials clicked without pointer movement: 4 of 5 (80%)');
  });
  it('judges with the limits it is given', () => {
    const custom = { ...CURSOR_LIMITS, shareSuspicious: { value: 0.05, meaning: CURSOR_LIMITS.shareSuspicious.meaning }, minClicksForVerdict: { value: 2, meaning: CURSOR_LIMITS.minClicksForVerdict.meaning } };
    assert.equal(verdictOf(humans(2), desktop, custom).level, 0);
    const r = analyzeCursorForParticipant(participant([...scripted(2), ...humans(8).map((t, j) => ({ ...t, trialId: 'h' + j, startTime: 1000 + (j + 2) * 5100 }))]), custom);
    assert.equal(r.cursor.rules.noPathClicks.count, 1);
    assert.equal(r.level, 1);                                       // 1 of 10 = 10% ≥ 5%
    assert.deepEqual(Object.keys(r.limits), Object.keys(CURSOR_LIMITS));
  });
});
