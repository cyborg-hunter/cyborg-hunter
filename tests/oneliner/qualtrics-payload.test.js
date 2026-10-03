// tests/oneliner/qualtrics-payload.test.js
// The Qualtrics payload builder: trims the vanilla blob to a summary built
// from allowlists and walks the degradation ladder until the serialized
// string fits the cap. A payload over Qualtrics' per-submit limit blocks the
// participant, so the over-cap case is pinned for several caps, and a payload
// must never carry what the participant typed, pasted or wrote.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { buildQualtricsPayload, trimTrialReport, KEEP_SESSION_ENTRIES, KEEP_PAGES, LABEL_MAX } from '../../src/oneliner/qualtrics-payload.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const ORIGIN = 1700000000000;
const STAMP = '2026-10-02T12:00:00.000Z';

// One row of a vanilla blob, in the monitor's own shapes (src/core/monitor.js
// endTrial and getSessionReport, src/core/signals/*.js, segment-diff.js).
// One page origin by default (the New Survey Taking Experience); `legacy`
// starts a new page, with its own origin and its own monitor (counters and
// score from zero), every `rowsPerPage` rows.
function row(i, o) {
  const tid = o.tid + i;
  const page = o.legacy ? Math.floor(i / o.rowsPerPage) : 0;
  const first = o.legacy ? page * o.rowsPerPage : 0;          // the page's first row
  const pastesOn = (j) => (o.pasteRows ? (o.pasteRows.includes(j) ? o.events : 0) : o.events);
  let pastes = 0;
  for (let j = first; j <= i; j++) pastes += pastesOn(j);       // cumulative within the monitor
  const done = i - first + 1;
  const hard = (count, threshold) => ({ count, threshold, triggered: count >= threshold });
  return {
    trialId: tid,
    integrity: {
      trialId: tid, phase: 'default', startTime: 1000 * i,
      pasteEvents: Array.from({ length: pastesOn(i) }, (_, k) => Object.assign(
        { type: 'paste', t: 1000 * i + k, pastedLength: 40, isKnownInput: true }, o.text ? { text: o.text } : {})),
      copyEvents: [], dropEvents: [], editTimestamps: Array.from({ length: 500 }, (_, k) => k),
      tabAwayEvents: [], idleGaps: [], foreignInputEvents: [], syntheticInsertions: [],
      mouseTrackingCapped: false, mouseTrackingCappedAtMs: null,
      duration_ms: 900, libraryVersion: '0.12.0', participantId: o.pid, timestamp: STAMP,
      mouseMetrics: { pathEfficiency: 0.8, directionChanges: 12, speedVariance: 0.5, moveCount: o.mouse },
      mouseTrack: Array.from({ length: o.mouse }, (_, k) => ({ x: k, y: k, t: k, type: 'move' })),
      trialSoftScore: 1,
      trialSignals: {
        hard: { paste: { trialHits: pastesOn(i), sessionTotal: pastes, countThreshold: 2 } },
        soft: { tabAway: { hits: 0, capped: 0, score: 0 } }
      }
    },
    integritySegment: {
      segmentIndex: i, source: 'page', trialId: tid, pageOrigin: ORIGIN + page * 60000,
      deltas: {
        tabAwaySums: Array.from({ length: o.tabAways }, () => 2000),
        tabAwayEvents: Array.from({ length: o.tabAways }, (_, k) => ({ start: 1000 * i + 100 * k, duration_ms: 2000, type: 'windowBlur', timestamp: STAMP })),
        charsPerSec: [], sidebarEvents: [], devToolsEvents: [], aiExtensionsFound: [], keyboardShortcuts: [],
        windowPositions: Array.from({ length: 40 }, (_, k) => ({ x: 0, y: 0, w: 1200, h: 800, iw: 1200, ih: 700, sw: 1920, sh: 1080, dpr: 2, vvScale: 1, t: k })),
        idleGaps: [], extensionInjections: [], viewportWidthShifts: [], zoomChanges: []
      },
      counters: { pasteCount: pastes, copyCount: 0, dropCount: 0 },
      score: {
        hardScore: { paste: hard(pastes, 2), copy: hard(0, 5), drop: hard(0, 2) },
        softScore: done, softScoreThreshold: 5, anyHardTriggered: pastes >= 2, trialsCompleted: done
      },
      ...(i === 0 ? { config: { preset: 'standard', participantId: o.pid, thresholds: { tabAwayDurationMs: 3000, typingSpeedCps: 10 } }, libraryVersion: '0.12.0' } : {})
    },
    integrityPasteCount: pastes, integrityCopyCount: 0, integrityDropCount: 0, integritySoftScore: done, integrityAnyHardTriggered: pastes >= 2
  };
}

function blob(opts = {}) {
  const o = { pages: 3, events: 2, tabAways: 3, mouse: 300, text: null, legacy: false, rowsPerPage: 1, pasteRows: null,
    pid: 'P1', tid: 'span-', violations: 0, aiReport: 'r'.repeat(2000), ...opts };
  const violations = Array.from({ length: o.violations }, (_, k) => ({ reason: 'window_blurred', start: 1000 + k, end: 1500 + k, duration: 500, pageOrigin: ORIGIN }));
  return {
    participantId: o.pid, libraryVersion: '0.12.0',
    cyborgHunterOneLiner: { version: '0.12.0', host: 'vanilla', pageCount: o.pages },
    trials: Array.from({ length: o.pages }, (_, i) => row(i, o)),
    guard_assistance_violations_session: JSON.stringify(violations), guard_assistance_violation_count_session: violations.length,
    ai_use_session: false, ai_report_session: o.aiReport
  };
}

const build = (b, maxChars) => buildQualtricsPayload({ blob: b, maxChars });

describe('buildQualtricsPayload level 0', () => {
  it('keeps the summary fields, drops traces and text, and the CLI reads it', () => {
    const b = blob({ text: 'pasted words' });
    const out = build(b, 12000);
    assert.strictEqual(out.level, 0);
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated, false);
    assert.strictEqual(out.payload.cyborgHunterOneLiner.host, 'qualtrics');
    assert.strictEqual(out.json, JSON.stringify(out.payload));
    assert.strictEqual(out.chars, bytes(out.json));
    assert.ok(out.chars <= 12000);
    const t0 = out.payload.trials[0].integrity;
    for (const k of ['mouseTrack', 'mouseEvents', 'elementTrace', 'editTimestamps', 'mouseTrackingCapped', 'mouseTrackingCappedAtMs']) assert.strictEqual(t0[k], undefined, k);
    assert.deepStrictEqual(t0.pasteEvents[0], { type: 'paste', t: 0, pastedLength: 40, isKnownInput: true });
    assert.deepStrictEqual(t0.mouseMetrics, { pathEfficiency: 0.8, directionChanges: 12, speedVariance: 0.5, moveCount: 300 });
    assert.strictEqual(out.payload.trials[0].integritySegment.deltas.windowPositions, undefined);
    assert.strictEqual(out.payload.trials[0].integritySegment.deltas.tabAwayEvents.length, 3);
    assert.ok(!('ai_report_session' in out.payload), 'the self-report text is left out');
    assert.strictEqual(out.payload.ai_report_session_length, 2000);
    assert.strictEqual(b.trials[0].integrity.mouseTrack.length, 300);   // input untouched
    const r = extractIntegrityData(JSON.parse(out.json), {});
    assert.deepStrictEqual(r.warnings, []);
    assert.strictEqual(r.trials.length, 3);
    assert.strictEqual(r.session.tabAwayEvents.length, 9);
    assert.strictEqual(r.session.pasteCount, 6);
    assert.strictEqual(r.session.config.preset, 'standard');
    assert.strictEqual(r.score.anyHardTriggered, true);
    assert.deepStrictEqual(r.honeypot, { aiUse: false, aiReport: '' });
  });
});

// A blob carrying a marker in every field that holds text the participant
// typed, pasted, dropped or wrote, and in fields ch.js does not know about at
// every depth (top, row, trial report, event, segment, deltas, score, config).
const SECRET = 'SECRET-';
function leaky(pages) {
  const b = blob({ pages, events: 3, tabAways: 10, text: SECRET + 'paste', aiReport: SECRET + 'self-report' });
  Object.assign(b, { response: SECRET + 'top', answer: SECRET + 'top', responses: [{ text: SECRET + 'responses' }],
    metadata: { integritySession: { note: SECRET + 'metadata' } } });
  b.cyborgHunterOneLiner.note = SECRET + 'oneliner';
  b.guard_assistance_violations_session = JSON.stringify(Array.from({ length: 30 }, (_, k) =>
    ({ reason: 'window_blurred', start: k, end: k + 1, duration: 1, pageOrigin: ORIGIN, note: SECRET + 'violation' })));
  b.guard_assistance_violation_count_session = 30;
  for (const r of b.trials) {
    Object.assign(r, { response: SECRET + 'row', answer: SECRET + 'row', stimulus: SECRET + 'row' });
    const t = r.integrity;
    Object.assign(t, { response: SECRET + 'report', responseText: SECRET + 'report' });
    t.pasteEvents.forEach((e) => { e.html = SECRET + 'paste-html'; });
    t.copyEvents = [{ type: 'copy', t: 8, selectedLength: 4, selection: SECRET + 'copy' }];
    t.dropEvents = [{ type: 'drop', t: 5, droppedLength: 9, isKnownInput: false, text: SECRET + 'drop' }];
    t.foreignInputEvents = [{ t: 6, targetTag: 'TEXTAREA', targetId: 'chat', targetClass: 'sidebar', inputType: 'insertText', data: SECRET + 'foreign' }];
    t.syntheticInsertions = [{ type: 'synthetic_insertion', t: 7, dataLength: 12, data: SECRET + 'insertion' }];
    t.decoy = { level: 1, injectedText: SECRET + 'decoy', source: 'per-trial-override', framing: 'answer-key', survivedTrial: true };
    t.elementTrace = [{ tag: 'div', id: SECRET + 'element', t: 1 }];
    t.mouseTrack[0].label = SECRET + 'mouse';
    t.trialSignals.hard.custom = { note: SECRET + 'signal' };
    t.trialSignals.soft.tabAway.note = SECRET + 'signal';
    const s = r.integritySegment;
    s.note = SECRET + 'segment';
    s.deltas.custom = [{ text: SECRET + 'delta' }];
    s.deltas.windowPositions[0].note = SECRET + 'window';
    s.deltas.tabAwayEvents.forEach((e) => { e.text = SECRET + 'tab-away'; });
    s.deltas.keyboardShortcuts = [{ combo: 'F12', t: 1, key: SECRET + 'key' }];
    s.score.note = SECRET + 'score';
    s.score.hardScore.custom = { count: 1, threshold: 0, triggered: true, note: SECRET + 'hard' };
    s.counters.note = SECRET + 'counter';
    s.gap = [{ duration_ms: 5, pasteEvents: [{ type: 'paste', t: 1, pastedLength: 9, isKnownInput: true, text: SECRET + 'gap' }], copyEvents: [], dropEvents: [], syntheticInsertions: [] }];
    if (s.config) { s.config.note = SECRET + 'config'; s.config.thresholds.note = SECRET + 'config'; }
  }
  return b;
}

describe('the payload is built from allowlists', () => {
  it('no typed, pasted, dropped or self-reported text, and no unknown field, reaches the payload at any level', () => {
    const b = leaky(8);
    const before = JSON.stringify(b);
    const levels = new Set();
    for (let cap = 100; cap < 400000; cap = Math.ceil(cap * 1.04)) {
      const out = build(b, cap);
      levels.add(out.level);
      if (out.json === null) continue;
      assert.ok(!out.json.includes(SECRET), 'level ' + out.level + ' at cap ' + cap + ': ' + out.json.slice(out.json.indexOf(SECRET) - 80, out.json.indexOf(SECRET) + 40));
      const r = extractIntegrityData(JSON.parse(out.json), {});
      assert.ok(!JSON.stringify(r).includes(SECRET));
    }
    for (const level of [0, 1, 2, 3, 4]) assert.ok(levels.has(level), 'the sweep reaches level ' + level + ': ' + [...levels]);
    assert.strictEqual(JSON.stringify(b), before);   // no level changes the input
  });

  it('every array and trial-report field the monitor writes is either kept or deliberately left out', async () => {
    // A field the core gains later must be added to the builder's lists (or
    // to these left-out lists) on purpose, not dropped from Qualtrics data by
    // accident.
    const LEFT_OUT_TRIAL = ['mouseTrack', 'mouseEvents', 'elementTrace', 'editTimestamps', 'mouseTrackingCapped', 'mouseTrackingCappedAtMs', 'decoy'];
    const LEFT_OUT_SESSION = ['windowPositions'];
    const win = new Window();
    Object.assign(global, { window: win, document: win.document, Node: win.Node, MutationObserver: win.MutationObserver,
      ResizeObserver: class { observe() {} disconnect() {} } });
    let report, session;
    try {
      const { init } = await import('../../src/core/monitor.js');
      const m = init({ participantId: 'P1', collectForPostHoc: { elementTrace: true } });
      m.startSession();
      m.startTrial({ trialId: 'probe' });
      report = m.endTrial();
      session = m.getSessionReport();
      m.destroy();
    } finally {
      win.close();
      for (const k of ['window', 'document', 'Node', 'MutationObserver', 'ResizeObserver']) delete global[k];
    }
    // The fields endTrial() writes only when their signal fired.
    Object.assign(report, { charsPerSec: 4.2, mouseMetrics: { pathEfficiency: 0.5, directionChanges: 3, speedVariance: 0.1, moveCount: 30 },
      decoy: { level: 3, injectedText: 'x', source: 'dom', survivedTrial: true } });
    const arrays = Object.keys(session).filter((k) => Array.isArray(session[k]) && k !== 'layoutShifts');   // the alias segment-diff.js does not ship
    const b = blob({ pages: 1 });
    b.trials[0].integrity = report;
    b.trials[0].integritySegment.deltas = Object.fromEntries(arrays.map((k) => [k, []]));
    const out = build(b, 1000000);
    const kept = out.payload.trials[0].integrity;
    for (const k of Object.keys(report)) assert.ok((k in kept) !== LEFT_OUT_TRIAL.includes(k), 'trial report field ' + k);
    const deltas = out.payload.trials[0].integritySegment.deltas;
    for (const k of arrays) assert.ok((k in deltas) !== LEFT_OUT_SESSION.includes(k), 'session array ' + k);
  });

  it('every string is cut to LABEL_MAX code units, without control characters or a split surrogate pair', () => {
    const pid = '\u0001\u001f' + 'P' + 'x'.repeat(20000);
    const tid = 'y'.repeat(LABEL_MAX - 1) + '\u{1F600}';   // the emoji straddles the cut
    const b = blob({ pages: 40, pid, tid });
    for (const cap of [12000, 3000]) {
      const out = build(b, cap);
      assert.ok(out.chars <= cap, cap + ': ' + out.chars);
      const p = out.payload;
      const ids = [p.participantId];
      for (const r of p.trials) {
        ids.push(r.trialId, r.integrity.trialId, r.integrity.participantId, r.integritySegment.trialId);
        if (r.integritySegment.config) ids.push(r.integritySegment.config.participantId);
      }
      for (const id of ids) {
        assert.ok(id.length <= LABEL_MAX, id.length);
        assert.ok(!/[\u0000-\u001f]/.test(id));
        assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(id), 'no lone high surrogate');
      }
      assert.strictEqual(p.participantId, 'P' + 'x'.repeat(LABEL_MAX - 1));
    }
    assert.strictEqual(build(b, 3000).level, 4);
    assert.ok(build(b, 3000).chars <= 3000, 'level 4 with a 20,000-character participant id');
    const ctl = build(blob({ pid: '\u0001'.repeat(20000) + 'P2' }), 12000);
    assert.strictEqual(ctl.payload.participantId, 'P2');
    assert.strictEqual(build(blob({ pid: 'a\ud800b' }), 12000).payload.participantId, 'a�b');
  });

  it('unknown session keys and outsized values in unknown places never reach the payload', () => {
    const b = blob({ pages: 2 });
    for (let k = 0; k < 500; k++) b.trials[1].integritySegment.deltas['key' + 'k'.repeat(30) + k] = [{ t: k }];
    b.trials[1].integritySegment.score.hardScore.paste.note = 'z'.repeat(30000);
    b.trials[1].integritySegment.score.extra = { deep: 'z'.repeat(30000) };
    for (const cap of [12000, 3000, 1500]) {
      const out = build(b, cap);
      assert.ok(out.chars <= cap, cap + ': ' + out.chars);
      assert.ok(!out.json.includes('kkkk') && !out.json.includes('zzzz'));
    }
  });
});

// Each ladder test's cap sits between the fixture's measured sizes at the
// level under test and the level before it, so the test lands on that level.
describe('the ladder', () => {
  it('level 1 keeps the newest session entries per key and counts the dropped ones', () => {
    const b = blob({ pages: 4, tabAways: 20 });   // 80 tab-aways; level 0 is about 14,100 bytes, level 1 about 8,900
    const out = build(b, 9000);
    assert.strictEqual(out.level, 1);
    const kept = out.payload.trials.reduce((n, t) => n + t.integritySegment.deltas.tabAwayEvents.length, 0);
    assert.strictEqual(kept, KEEP_SESSION_ENTRIES);
    assert.strictEqual(out.payload.trials[3].integritySegment.deltas.tabAwayEvents.length, 20);   // newest first
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated.droppedSessionEntries.tabAwayEvents, 55);
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated.droppedSessionEntries.tabAwaySums, 55);
    assert.ok(out.chars <= 9000);
  });
  it('level 2 empties older rows\' event arrays but keeps every count', () => {
    const b = blob({ pages: 6, events: 12, tabAways: 0 });   // levels 0-1 about 13,100 bytes, level 2 about 9,500
    const out = build(b, 10000);
    assert.strictEqual(out.level, 2);
    const newest = out.payload.trials[out.payload.trials.length - 1];
    assert.strictEqual(newest.integrity.pasteEvents.length, 12);
    assert.strictEqual(newest.integritySegment.counters.pasteCount, 72);
    for (const t of out.payload.trials.slice(0, -1)) {
      assert.deepStrictEqual(t.integrity.pasteEvents, []);
      assert.strictEqual(t.integrityTruncated, true);
      assert.ok(t.integrityPasteCount > 0);
    }
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated.pagesTrimmed, 5);
    assert.ok(out.chars <= 10000);
  });
  it('level 3 keeps only the newest pages', () => {
    const b = blob({ pages: 40, events: 1, tabAways: 1 });   // level 2 about 58,200 bytes, level 3 about 8,000
    const out = build(b, 9000);
    assert.strictEqual(out.level, 3);
    assert.strictEqual(out.payload.trials.length, KEEP_PAGES);
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated.pagesDropped, 35);
    assert.strictEqual(out.payload.trials[KEEP_PAGES - 1].integritySegment.segmentIndex, 39);
    assert.strictEqual(out.payload.trials[0].integritySegment.config.preset, 'standard');   // the first segment's config moves forward
    assert.ok(out.chars <= 9000);
    const r = extractIntegrityData(JSON.parse(out.json), {});
    assert.strictEqual(r.session.pasteCount, 40);
    assert.strictEqual(r.session.config.preset, 'standard');
  });
  it('level 4 fits and the CLI still scores it', () => {
    const b = blob({ pages: 40, events: 20, tabAways: 20 });
    const out = build(b, 1500);
    assert.strictEqual(out.level, 4);
    assert.ok(out.chars <= 1500, out.chars + ' bytes');
    assert.strictEqual(out.payload.trials.length, 1);
    assert.deepStrictEqual(out.payload.trials[0].integritySegment.deltas, {});
    const r = extractIntegrityData(JSON.parse(out.json), {});
    assert.strictEqual(r.score.anyHardTriggered, true);
    assert.strictEqual(r.session.pasteCount, 800);
    assert.ok(r.warnings.some((w) => /reduced to fit the embedded-data cap \(level 4/.test(w)));
  });
  it('OVER-CAP GUARANTEE: a session of 400 events and 40 pages never serializes above the cap, stays valid JSON, is flagged, and keeps the score', () => {
    const b = blob({ pages: 40, events: 10, tabAways: 10, text: 'x'.repeat(400) });
    const before = JSON.stringify(b);
    const full = bytes(before);
    assert.ok(full > 12000, 'the fixture must be over the cap on its own: ' + full);
    for (const cap of [12000, 8000, 4000, 2000]) {
      const out = build(b, cap);
      assert.ok(out.chars <= cap, 'cap ' + cap + ': ' + out.chars);
      assert.strictEqual(out.chars, bytes(out.json));
      assert.ok(out.chars < full);
      const parsed = JSON.parse(out.json);
      assert.ok(out.level === 0 ? parsed.cyborgHunterOneLiner.truncated === false : parsed.cyborgHunterOneLiner.truncated.level === out.level);
      assert.strictEqual(extractIntegrityData(parsed, {}).score.anyHardTriggered, true);
    }
    assert.strictEqual(JSON.stringify(b), before);   // no level changes the input
  });
  it('trimTrialReport keeps the schema\'s required fields and nothing it does not know', () => {
    const report = Object.assign(blob().trials[0].integrity, { response: 'typed answer' });
    const t = trimTrialReport(report);
    for (const k of ['trialId', 'libraryVersion', 'participantId', 'startTime', 'duration_ms', 'pasteEvents', 'copyEvents', 'dropEvents', 'tabAwayEvents', 'trialSoftScore', 'trialSignals']) assert.ok(k in t, k);
    assert.ok(!('mouseTrack' in t));
    assert.ok(!('response' in t));
  });
});
