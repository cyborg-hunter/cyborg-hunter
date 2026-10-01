import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSegmentDiffer } from '../../src/oneliner/segment-diff.js';

function fakeMonitor() {
  const shifts = [];
  const session = {
    pasteCount: 0, copyCount: 0, dropCount: 0,
    tabAwaySums: [], tabAwayEvents: [], charsPerSec: [], sidebarEvents: [], devToolsEvents: [],
    aiExtensionsFound: [], keyboardShortcuts: [], windowPositions: [], idleGaps: [],
    extensionInjections: [], viewportWidthShifts: shifts, layoutShifts: shifts, zoomChanges: [],
    hardScore: {}, softScore: 0, trialsCompleted: 0,
  };
  const monitor = {
    session,
    getSessionReport: () => ({ ...JSON.parse(JSON.stringify(session)), softScoreThreshold: 6, anyHardTriggered: false,
      config: { preset: 'standard', participantId: 'P1', thresholds: { tabAwayDurationMs: 3000, typingSpeedCps: 10 } },
      libraryVersion: '0.10.0' }),
    getSessionScore: () => ({ hardScore: JSON.parse(JSON.stringify(session.hardScore)), softScore: session.softScore,
      softScoreThreshold: 6, anyHardTriggered: false, trialsCompleted: session.trialsCompleted }),
  };
  return monitor;
}
const meta = (i, extra = {}) => ({ segmentIndex: i, source: 'host', trialId: 't' + i, pageOrigin: 1000, ...extra });

describe('segment differ', () => {
  it('diffs every array key by last-seen length and skips the layoutShifts alias', () => {
    const m = fakeMonitor();
    const d = createSegmentDiffer(m);
    m.session.sidebarEvents.push({ type: 'opened', t: 10 });
    m.session.viewportWidthShifts.push({ t: 11 });
    const s0 = d.cut(meta(0));
    assert.deepStrictEqual(s0.deltas.sidebarEvents, [{ type: 'opened', t: 10 }]);
    assert.deepStrictEqual(s0.deltas.viewportWidthShifts, [{ t: 11 }]);
    assert.ok(!('layoutShifts' in s0.deltas), 'alias is not shipped twice');
    m.session.sidebarEvents.push({ type: 'closed', t: 20 });
    const s1 = d.cut(meta(1));
    assert.deepStrictEqual(s1.deltas.sidebarEvents, [{ type: 'closed', t: 20 }]);
    assert.deepStrictEqual(s1.deltas.viewportWidthShifts, []);
  });
  it('discovers an array key added at runtime', () => {
    const m = fakeMonitor();
    const d = createSegmentDiffer(m);
    d.cut(meta(0));
    m.session.fooEvents = [{ t: 1 }, { t: 2 }];
    const s1 = d.cut(meta(1));
    assert.deepStrictEqual(s1.deltas.fooEvents, [{ t: 1 }, { t: 2 }]);
  });
  it('carries config + libraryVersion on segment 0 only, score and counters on every segment', () => {
    const m = fakeMonitor();
    const d = createSegmentDiffer(m);
    const s0 = d.cut(meta(0));
    m.session.pasteCount = 2; m.session.softScore = 3; m.session.trialsCompleted = 1;
    const s1 = d.cut(meta(1));
    assert.equal(s0.config.preset, 'standard'); assert.equal(s0.libraryVersion, '0.10.0');
    assert.ok(!('config' in s1) && !('libraryVersion' in s1));
    assert.deepStrictEqual(s1.counters, { pasteCount: 2, copyCount: 0, dropCount: 0 });
    assert.deepStrictEqual(s1.score, m.getSessionScore());
  });
  it('folds only non-empty gap reports into the segment', () => {
    const m = fakeMonitor();
    const d = createSegmentDiffer(m);
    const empty = { pasteEvents: [], copyEvents: [], dropEvents: [], syntheticInsertions: [], duration_ms: 5 };
    const hit = { pasteEvents: [{ t: 3, dataLength: 9 }], copyEvents: [], dropEvents: [], syntheticInsertions: [], duration_ms: 7, mouseTrack: [{}, {}] };
    const s = d.cut(meta(0, { gapReports: [empty, hit] }));
    assert.equal(s.gap.length, 1);
    assert.deepStrictEqual(Object.keys(s.gap[0]).sort(), ['copyEvents', 'dropEvents', 'duration_ms', 'pasteEvents', 'syntheticInsertions']);
  });
  it('stays under 20 ms per cut on a 10 000-entry report (perf budget)', () => {
    const m = fakeMonitor();
    for (let i = 0; i < 10000; i++) m.session.windowPositions.push({ screenX: i, screenY: i, innerWidth: 1, innerHeight: 1, t: i });
    const d = createSegmentDiffer(m);
    d.cut(meta(0));
    const t0 = performance.now(); d.cut(meta(1)); const dt = performance.now() - t0;
    assert.ok(dt < 20, `cut took ${dt.toFixed(1)} ms`);
  });
});
