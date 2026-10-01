import { describe, it } from 'node:test';
import assert from 'node:assert';
import { collectSegments, reassembleSegments, rebaseTimes, ALIAS_KEYS } from '../../src/cli/segment-reassembly.js';
import { ALIAS_KEYS as DIFFER_ALIAS_KEYS } from '../../src/oneliner/segment-diff.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { ingest } from '../../src/cli/ingest.js';
import Papa from 'papaparse';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

describe('ALIAS_KEYS', () => {
  it('the CLI copy matches the browser differ (segment-reassembly.js must stay import-free, so it is duplicated)', () => {
    assert.deepStrictEqual(ALIAS_KEYS, DIFFER_ALIAS_KEYS);
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
  it('re-bases only page-load times: trial-relative mouseTrack/elementTrace and the segment copy are left alone', () => {
    const t0 = trial(0, seg(0, {}));
    const t1 = trial(1, { ...seg(1, { sidebarEvents: [{ t: 7 }] }), pageOrigin: 1000 + 30000 });
    Object.assign(t1.integrity, {
      startTime: 20, trialStart_perfNow: 21,
      tabAwayEvents: [{ start: 25, duration_ms: 1 }], pasteEvents: [{ type: 'paste', t: 30 }],
      mouseTrack: [{ x: 1, y: 1, t: 100, type: 'move' }], elementTrace: [{ tag: 'div', t: 200 }],
      editTimestamps: [15, 16],
    });
    const r = extractIntegrityData({ participantId: 'P1', trials: [t0, t1] }, {});
    const tr = r.trials[1];
    assert.equal((tr.mouseEvents || tr.mouseTrack)[0].t, 100, 'mouse samples are trial-relative (mouse.js)');
    assert.equal(tr.elementTrace[0].t, 200, 'elementTrace is trial-relative (browser.js)');
    assert.deepStrictEqual(tr.editTimestamps, [15, 16]);
    assert.equal(tr.integritySegment.deltas.sidebarEvents[0].t, 7, 'the copied segment is not shifted');
    assert.equal(tr.startTime, 30020);
    assert.equal(tr.trialStart_perfNow, 30021);
    assert.equal(tr.tabAwayEvents[0].start, 30025);
    assert.equal(tr.tabAwayEvents[0].startRel_ms, 4);
    assert.equal(tr.pasteEvents[0].t, 30030);
  });
  it('re-bases a later-page row that carries only integritySegmentFinal', () => {
    const t0 = trial(0, seg(0, {}));
    const t1 = trial(1, undefined);
    delete t1.integritySegment;
    t1.integritySegmentFinal = { ...seg(1, {}), pageOrigin: 6000 };
    t1.integrity.startTime = 20;
    const r = extractIntegrityData({ participantId: 'P1', trials: [t0, t1] }, {});
    assert.equal(r.trials[0].startTime, 10);
    assert.equal(r.trials[1].startTime, 5020);
  });
  it('re-bases guard violations tagged with a later pageOrigin; untagged ones keep their start', () => {
    const violations = [
      { reason: 'not_fullscreen', start: 100, end: 200, duration: 100, pageOrigin: 1000 },
      { reason: 'tab_hidden', start: 50, end: 60, duration: 10, pageOrigin: 31000 },
      { reason: 'sidebar', start: 70, end: 80, duration: 10 }
    ];
    const raw = { participantId: 'P1', trials: [trial(0, seg(0, {})), trial(1, { ...seg(1, {}), pageOrigin: 31000 })],
      guard_assistance_violations_session: JSON.stringify(violations) };
    const r = extractIntegrityData(raw, {});
    assert.deepStrictEqual(r.guardFriction.violations.map(v => v.t), [100, 30050, 70]);
  });
  it('sums the counters of each page (every page load starts a new monitor)', () => {
    const p1 = [seg(0, {}), seg(1, {})].map(s => ({ ...s, counters: { pasteCount: s.segmentIndex + 1, copyCount: 1, dropCount: 0 } }));
    const p2 = [seg(2, {}), seg(3, {})].map(s => ({ ...s, pageOrigin: 9000, counters: { pasteCount: s.segmentIndex - 1, copyCount: 0, dropCount: 1 } }));
    const { session } = reassembleSegments([...p1, ...p2]);
    assert.equal(session.pasteCount, 2 + 2);
    assert.equal(session.copyCount, 1);
    assert.equal(session.dropCount, 1);
  });
  it('surfaces a cyborgHunterError marker as a warning', () => {
    const r = extractIntegrityData({ participantId: 'P1', trials: [{ ...trial(0, seg(0, {})), cyborgHunterError: 'boom' }] }, {});
    assert.ok(r.warnings.some(w => w.includes('cyborgHunterError') && w.includes('boom')));
  });
});

describe('rolling segments through a jsPsych-style CSV', () => {
  it('JSON-stringified integritySegment cells survive the CSV round trip and are reassembled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ch-seg-csv-'));
    try {
      const s = (i, origin, sidebar) => ({ ...seg(i, { sidebarEvents: sidebar }), pageOrigin: origin });
      const rows = [0, 1].map(i => ({
        participantId: 'P1', trialId: 't' + i, rt: 100,
        integrity: JSON.stringify({ trialId: 't' + i, startTime: 10, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [] }),
        integritySegment: JSON.stringify(s(i, i ? 5000 : 0, [{ t: 1 + i }])),
      }));
      writeFileSync(join(dir, 'p1.csv'), Papa.unparse(rows));
      const { participants } = await ingest({ dataDir: dir, filePattern: '*.csv' });
      assert.equal(participants.length, 1);
      const p = participants[0];
      assert.deepStrictEqual(p.session.sidebarEvents, [{ t: 1 }, { t: 5002 }], 'second page re-based by its pageOrigin');
      assert.equal(p.score.softScore, 1, 'score from the last segment');
      assert.equal(p.score.trialsCompleted, 2);
      assert.equal(p.trials[1].startTime, 5010, "second trial's anchor re-based");
      assert.equal(p.trials[0].startTime, 10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
