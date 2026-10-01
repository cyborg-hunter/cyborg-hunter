import { describe, it } from 'node:test';
import assert from 'node:assert';
import { collectSegments, reassembleSegments, rebaseTimes } from '../../src/cli/segment-reassembly.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';

const seg = (i, deltas, extra = {}) => ({ segmentIndex: i, source: 'host', trialId: 't' + i, pageOrigin: 1000,
  deltas: { tabAwaySums: [], tabAwayEvents: [], sidebarEvents: [], viewportWidthShifts: [], ...deltas },
  counters: { pasteCount: i, copyCount: 0, dropCount: 0 },
  score: { hardScore: {}, softScore: i, softScoreThreshold: 6, anyHardTriggered: false, trialsCompleted: i + 1 }, ...extra });

describe('reassembleSegments', () => {
  it('concatenates in segmentIndex order, restores the layoutShifts alias, takes score from the last segment', () => {
    const s0 = seg(0, { sidebarEvents: [{ t: 1 }], viewportWidthShifts: [{ t: 2 }] }, { config: { preset: 'strict' }, libraryVersion: '0.10.0' });
    const s1 = seg(1, { sidebarEvents: [{ t: 5 }] });
    const { session, score } = reassembleSegments([s1, s0]);
    assert.deepStrictEqual(session.sidebarEvents, [{ t: 1 }, { t: 5 }]);
    assert.deepStrictEqual(session.layoutShifts, session.viewportWidthShifts);
    assert.equal(session.pasteCount, 1); assert.equal(session.config.preset, 'strict');
    assert.ok(!('softScore' in session) && !('libraryVersion' in session), 'dump shape: score fields and version are not in session');
    assert.deepStrictEqual(score, s1.score);
  });
  it('re-bases t/start of later pages to the first page origin', () => {
    const s0 = seg(0, { tabAwayEvents: [{ start: 100, duration_ms: 5 }] });
    const s1 = { ...seg(1, { tabAwayEvents: [{ start: 50, duration_ms: 5 }], sidebarEvents: [{ t: 60 }] }), pageOrigin: 1000 + 30000 };
    const { session, pageOrigins } = reassembleSegments([s0, s1]);
    assert.deepStrictEqual(pageOrigins, [1000, 31000]);
    assert.equal(session.tabAwayEvents[1].start, 30050);
    assert.equal(session.sidebarEvents[0].t, 30060);
    assert.equal(session.tabAwayEvents[0].start, 100);
  });
  it('rebaseTimes shifts only the named numeric keys and returns the same reference at offset 0', () => {
    const v = { t: 1, start: 2, startTime: 3, trialStart_perfNow: 4, duration_ms: 9, timestamp: 'x', nested: [{ t: 5 }] };
    assert.strictEqual(rebaseTimes(v, 0), v);
    assert.deepStrictEqual(rebaseTimes(v, 10), { t: 11, start: 12, startTime: 13, trialStart_perfNow: 14, duration_ms: 9, timestamp: 'x', nested: [{ t: 15 }] });
  });
});

describe('5th convention in extractIntegrityData', () => {
  const trial = (i, segment) => ({ trialId: 't' + i, integrity: { trialId: 't' + i, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], startTime: 10 }, integritySegment: segment });
  it('builds session + score from per-row segments when no integritySession exists', () => {
    const raw = { participantId: 'P1', trials: [trial(0, seg(0, { sidebarEvents: [{ t: 1 }] }, { config: { preset: 'standard', thresholds: { tabAwayDurationMs: 3000 } } })), trial(1, seg(1, {}))] };
    raw.trials[1].integritySegmentFinal = seg(2, { sidebarEvents: [{ t: 9 }] });
    const r = extractIntegrityData(raw, {});
    assert.equal(r.session.sidebarEvents.length, 2);
    assert.equal(r.score.trialsCompleted, 3);
    assert.equal(r.session.config.thresholds.tabAwayDurationMs, 3000);
    assert.ok(!r.warnings.some(w => w.includes('No session-level integrity data')));
  });
  it('a dumped integritySession wins over segments and the CLI warns', () => {
    const raw = { participantId: 'P1', trials: [trial(0, seg(0, { sidebarEvents: [{ t: 1 }] }))] };
    raw.trials[0].integritySession = { tabAwaySums: [], sidebarEvents: [{ t: 7 }, { t: 8 }], softScore: 1, hardScore: {} };
    const r = extractIntegrityData(raw, {});
    assert.equal(r.session.sidebarEvents.length, 2);
    assert.ok(r.warnings.some(w => /both a dumped integritySession and rolling segments/i.test(w)));
  });
  it('re-bases multi-page trial reports with their segment pageOrigin', () => {
    const t0 = trial(0, seg(0, {})); const t1 = trial(1, { ...seg(1, {}), pageOrigin: 6000 });
    t1.integrity.startTime = 20; t1.integrity.tabAwayEvents = [{ start: 25, duration_ms: 1 }];
    const r = extractIntegrityData({ participantId: 'P1', trials: [t0, t1] }, {});
    assert.equal(r.trials[1].startTime, 5020);
    assert.equal(r.trials[1].tabAwayEvents[0].start, 5025);
    assert.equal(r.trials[1].tabAwayEvents[0].startRel_ms, 5, 'normalizeTabAwayTimestamps still sees consistent anchors');
  });
  it('surfaces a cyborgHunterError marker as a warning', () => {
    const r = extractIntegrityData({ participantId: 'P1', trials: [{ ...trial(0, seg(0, {})), cyborgHunterError: 'boom' }] }, {});
    assert.ok(r.warnings.some(w => w.includes('cyborgHunterError') && w.includes('boom')));
  });
});
