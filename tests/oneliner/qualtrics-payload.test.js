// tests/oneliner/qualtrics-payload.test.js
// The Qualtrics payload builder: trims the vanilla blob to a summary built
// from allowlists and walks the degradation ladder until the serialized
// string fits the cap. A payload over Qualtrics' per-submit limit blocks the
// participant, so the over-cap case is pinned for several caps, and a payload
// must never carry what the participant typed, pasted or wrote.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { buildQualtricsPayload, trimTrialReport, KEEP_SESSION_ENTRIES, KEEP_PAGES, LABEL_MAX, DEFAULT_MAX_CHARS } from '../../src/oneliner/qualtrics-payload.js';
import { MAX_CHARS } from '../../src/oneliner/adapters/qualtrics.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeParticipantSummary } from '../../src/cli/analyzers/summary.js';

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
    let nothing = 0;
    for (let cap = 20; cap < 400000; cap = Math.ceil(cap * 1.04)) {
      const out = build(b, cap);
      levels.add(out.level);
      if (out.json === null) { nothing++; continue; }
      assert.ok(out.chars <= cap);
      assert.ok(!out.json.includes(SECRET), 'level ' + out.level + ' at cap ' + cap + ': ' + out.json.slice(out.json.indexOf(SECRET) - 80, out.json.indexOf(SECRET) + 40));
      const r = extractIntegrityData(JSON.parse(out.json), {});
      assert.ok(!JSON.stringify(r).includes(SECRET));
    }
    for (const level of [0, 1, 2, 3, 4, 5]) assert.ok(levels.has(level), 'the sweep reaches level ' + level + ': ' + [...levels]);
    assert.ok(nothing > 0, 'the smallest caps get no payload at all');
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
    assert.strictEqual(build(blob({ pid: 'a\ud800b' }), 12000).payload.participantId, 'a\ufffdb');
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

// Every string the payload can carry, by path ('[]' marks an array entry).
// A string is the one kind of value that can hold what a participant typed,
// so this list pins the allowlists: a string field added to the builder has
// to be added here on purpose, after checking that no page can put a
// participant's text in it. Left out on purpose: a foreign-input event's
// targetId and targetClass (a widget can mirror its value into them).
const STRING_PATHS = [
  'participantId', 'libraryVersion', 'cyborgHunterOneLiner.version', 'cyborgHunterError',
  'guard_assistance_violations_session[].reason',
  'trials[].trialId', 'trials[].cyborgHunterError',
  'trials[].integrity.trialId', 'trials[].integrity.phase', 'trials[].integrity.libraryVersion',
  'trials[].integrity.participantId', 'trials[].integrity.timestamp',
  'trials[].integrity.pasteEvents[].type', 'trials[].integrity.copyEvents[].type', 'trials[].integrity.dropEvents[].type',
  'trials[].integrity.tabAwayEvents[].type', 'trials[].integrity.tabAwayEvents[].timestamp',
  'trials[].integrity.syntheticInsertions[].type',
  'trials[].integrity.foreignInputEvents[].targetTag', 'trials[].integrity.foreignInputEvents[].inputType',
  'trials[].integritySegment.source', 'trials[].integritySegment.trialId', 'trials[].integritySegment.libraryVersion',
  'trials[].integritySegment.deltas.tabAwayEvents[].type', 'trials[].integritySegment.deltas.tabAwayEvents[].timestamp',
  'trials[].integritySegment.deltas.sidebarEvents[].type', 'trials[].integritySegment.deltas.sidebarEvents[].method',
  'trials[].integritySegment.deltas.aiExtensionsFound[].name', 'trials[].integritySegment.deltas.keyboardShortcuts[].combo',
  'trials[].integritySegment.deltas.extensionInjections[].tag',
  'trials[].integritySegment.gap[].pasteEvents[].type', 'trials[].integritySegment.gap[].copyEvents[].type',
  'trials[].integritySegment.gap[].dropEvents[].type', 'trials[].integritySegment.gap[].syntheticInsertions[].type',
  'trials[].integritySegment.config.preset', 'trials[].integritySegment.config.participantId'
];
// Strings the builder writes itself, the same whatever the blob holds.
const BUILDER_STRINGS = { 'cyborgHunterOneLiner.host': 'qualtrics', 'integritySegments[].source': 'rollup' };

// v with every string replaced by 'S:' + its path.
function sentinels(v, path) {
  if (typeof v === 'string') return 'S:' + path;
  if (Array.isArray(v)) return v.map((x) => sentinels(x, path + '[]'));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sentinels(x, path ? path + '.' + k : k)]));
  return v;
}
// Every string in a payload: path → the set of values found there. The
// honeypot's violation log is a JSON string, read as the list it holds.
function strings(v, path = '', out = new Map()) {
  if (path === 'guard_assistance_violations_session' && typeof v === 'string') return strings(JSON.parse(v), path, out);
  if (typeof v === 'string') { if (!out.has(path)) out.set(path, new Set()); out.get(path).add(v); }
  else if (Array.isArray(v)) v.forEach((x) => strings(x, path + '[]', out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, path ? path + '.' + k : k, out);
  return out;
}

// A blob holding every kind of entry the monitor writes, with free text and
// ids in the fields the allowlists leave out, every string then replaced by
// its sentinel. 8 rows, 30 tab-aways and 6 pastes a row: every level 0-5 is
// reachable.
function sentinelBlob() {
  const b = blob({ pages: 8, events: 6, tabAways: 30 });
  b.cyborgHunterError = 'note';
  for (const r of b.trials) {
    r.cyborgHunterError = 'note';
    const t = r.integrity;
    t.pasteEvents.forEach((e) => { e.text = 'typed'; });
    t.copyEvents = [{ type: 'copy', t: 1, selectedLength: 3, selection: 'typed' }];
    t.dropEvents = [{ type: 'drop', t: 2, droppedLength: 3, isKnownInput: true, text: 'typed' }];
    t.tabAwayEvents = [{ start: 3, duration_ms: 4000, type: 'windowBlur', timestamp: STAMP }];
    t.syntheticInsertions = [{ type: 'synthetic_insertion', t: 4, dataLength: 3, data: 'typed' }];
    t.foreignInputEvents = [{ t: 5, targetTag: 'TEXTAREA', targetId: 'mirror-of-the-answer', targetClass: 'mirror', inputType: 'insertText', data: 'typed' }];
    t.decoy = { level: 1, injectedText: 'page text', survivedTrial: true };
    t.responseText = 'typed';
    const d = r.integritySegment.deltas;
    d.sidebarEvents = [{ type: 'opened', method: 'innerWidth_delta', deltaIW: -300, innerWidth: 900, baselineIW: 1200, gap: 300, duration_ms: 0, t: 6 }];
    d.aiExtensionsFound = [{ name: 'Merlin', t: 7 }];
    d.keyboardShortcuts = [{ combo: 'F12', t: 8 }];
    d.extensionInjections = [{ tag: 'merlin-root', hasShadow: true, t: 9 }];
    r.integritySegment.gap = [{ duration_ms: 5,
      pasteEvents: [{ type: 'paste', t: 1, pastedLength: 3, isKnownInput: true, text: 'typed' }],
      copyEvents: [{ type: 'copy', t: 1, selectedLength: 3 }],
      dropEvents: [{ type: 'drop', t: 1, droppedLength: 3, isKnownInput: true, text: 'typed' }],
      syntheticInsertions: [{ type: 'synthetic_insertion', t: 1, dataLength: 3, data: 'typed' }] }];
  }
  const filled = sentinels(b, '');
  filled.guard_assistance_violations_session = JSON.stringify(sentinels(Array.from({ length: 30 }, (_, k) =>
    ({ reason: 'window_blurred', start: k, end: k + 1, duration: 1, in_progress: false, pageOrigin: ORIGIN, note: 'typed' })),
  'guard_assistance_violations_session'));
  return filled;
}

describe('every string field the payload allows, at every level', () => {
  it('each holds only its own field\'s value, and the fields per level are exactly the pinned ones', () => {
    const b = sentinelBlob();
    // Levels 0-2 keep every kind of string; level 3 drops the first page,
    // and with it the segment libraryVersion only the first segment carries
    // (its config moves forward); level 4 keeps the newest row's required
    // fields; level 5 the participant id.
    const all = STRING_PATHS.slice().sort();
    const level4 = ['participantId', 'libraryVersion', 'cyborgHunterOneLiner.version', 'cyborgHunterError', 'trials[].trialId',
      'trials[].integrity.trialId', 'trials[].integrity.libraryVersion', 'trials[].integrity.participantId',
      'trials[].integritySegment.source', 'trials[].integritySegment.trialId'].sort();
    const expected = [all, all, all, all.filter((p) => p !== 'trials[].integritySegment.libraryVersion'), level4, ['participantId']];
    const results = [0, 1, 2, 3, 4].map((level) => atLevel(b, level));
    results.push(build(b, results[4].chars - 1));
    for (const [level, out] of results.entries()) {
      assert.strictEqual(out.level, level);
      const found = strings(out.payload);
      for (const [path, values] of found) {
        assert.deepStrictEqual([...values], [BUILDER_STRINGS[path] || 'S:' + path], 'level ' + level + ': ' + path);
      }
      const paths = [...found.keys()].filter((p) => !(p in BUILDER_STRINGS)).sort();
      assert.deepStrictEqual(paths, expected[level], 'level ' + level);
    }
  });
});

// The writer writes `json` only when it is a string, and Qualtrics blocks
// the participant when a submit is too long, so no result may be longer
// than its cap, whatever the cap and whatever the blob holds.
describe('the cap', () => {
  it('a missing cap, or one that is not a positive integer, means DEFAULT_MAX_CHARS, the adapter\'s MAX_CHARS', () => {
    assert.strictEqual(DEFAULT_MAX_CHARS, MAX_CHARS);
    const b = blob({ pages: 30, events: 4, tabAways: 4 });
    const ref = build(b, MAX_CHARS);
    assert.ok(ref.level >= 1 && ref.chars <= MAX_CHARS, 'the fixture is over the cap at level 0');
    for (const maxChars of [null, NaN, -1, 0, 0.5, 1.5, Infinity, -Infinity, '9000', {}]) {
      assert.strictEqual(build(b, maxChars).json, ref.json, String(maxChars));
    }
    assert.strictEqual(buildQualtricsPayload({ blob: b }).json, ref.json, 'omitted');
    assert.strictEqual(buildQualtricsPayload({ blob: blob() }).level, 0);
  });

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    const b = blob({ pages: 6, pid: '参加者'.repeat(40), tid: '頁'.repeat(100) + '\u{1F600}'.repeat(10) + '-' });
    const level0 = build(b, 10000000);
    assert.strictEqual(level0.level, 0);
    assert.strictEqual(level0.chars, bytes(level0.json));
    assert.ok(level0.chars > level0.json.length);
    const out = build(b, level0.json.length);   // a payload measured in code units would fit here
    assert.ok(out.level >= 1, 'level ' + out.level);
    assert.strictEqual(out.chars, bytes(out.json));
    assert.ok(out.chars <= level0.json.length);
  });

  it('reports the unreduced summary\'s size as fullChars at every level', () => {
    const b = blob({ pages: 40, events: 10, tabAways: 10 });
    const level0 = build(b, 10000000);
    assert.strictEqual(level0.fullChars, level0.chars);
    for (const cap of [12000, 3000, 300, 10]) assert.strictEqual(build(b, cap).fullChars, level0.chars, String(cap));
  });

  it('a cap too small for level 4 gets a fixed minimal payload, and a cap too small for that gets no payload', () => {
    const b = blob({ pages: 40, events: 20, tabAways: 20 });
    const small = build(b, 300);
    assert.strictEqual(small.level, 5);
    assert.ok(small.chars <= 300);
    assert.deepStrictEqual(JSON.parse(small.json),
      { participantId: 'P1', cyborgHunterOneLiner: { host: 'qualtrics', truncated: { level: 5 } }, trials: [] });
    assert.ok(/level 4 \(\d+ bytes\) does not fit the cap \(300 bytes\)/.test(small.reason), small.reason);
    const r = extractIntegrityData(JSON.parse(small.json), {});
    assert.strictEqual(r.participantId, 'P1');
    assert.ok(r.warnings.some((w) => /reduced to fit the embedded-data cap \(level 5/.test(w)));
    assert.strictEqual(build(b, small.chars).level, 5);
    const none = build(b, small.chars - 1);
    assert.deepStrictEqual([none.payload, none.json, none.chars, none.level], [null, null, 0, 5]);
    assert.ok(/nor does the minimal payload/.test(none.reason), none.reason);
  });

  it('never throws, whatever the options and the blob hold', () => {
    const cyclic = blob();
    cyclic.trials[0].integrity.self = cyclic;
    cyclic.trials[0].integritySegment.score.loop = cyclic.trials[0];
    const big = blob();
    big.trials[0].integrity.startTime = 10n;
    big.trials[0].integritySegment.counters.pasteCount = 3n;
    big.extra = 1n;
    const odd = blob();
    odd.trials.splice(1, 0, null, undefined, 42, 'row', []);
    const thrower = blob();
    Object.defineProperty(thrower.trials[0], 'integrity', { enumerable: true, get() { throw new Error('getter failed'); } });
    const cases = [undefined, null, {}, { blob: null }, { blob: 'x' }, { blob: [] }, { blob: cyclic }, { blob: big }, { blob: odd }, { blob: thrower }];
    for (const opts of cases) {
      let out;
      assert.doesNotThrow(() => { out = buildQualtricsPayload(opts); });
      assert.ok(out.json === null || (out.chars === bytes(out.json) && out.chars <= MAX_CHARS));
      if (out.json !== null) JSON.parse(out.json);
    }
    // What the summary cannot hold is left out and the rest is summarized.
    assert.strictEqual(build(cyclic, 12000).level, 0);
    const first = build(big, 12000).payload.trials[0];
    assert.strictEqual(first.integrity.startTime, undefined);
    assert.strictEqual(first.integritySegment.counters.pasteCount, undefined);
    assert.strictEqual(build(odd, 12000).payload.trials.length, 3);
    // A blob that cannot be read gives the minimal payload, which says so.
    for (const opts of [undefined, {}, { blob: null }, { blob: thrower }]) {
      const out = buildQualtricsPayload(opts);
      assert.strictEqual(out.level, 5);
      assert.strictEqual(JSON.parse(out.json).cyborgHunterError, 'the Qualtrics payload could not be built');
    }
    assert.ok(buildQualtricsPayload({ blob: thrower }).reason.includes('getter failed'));
  });

  it('never throws when the page makes every JSON.stringify throw: no payload, and a reason', () => {
    const b = blob();
    Object.defineProperty(Object.prototype, 'toJSON', { value() { throw new Error('toJSON boom'); }, configurable: true, writable: true });
    let out;
    try {
      assert.doesNotThrow(() => { out = build(b, 12000); });
    } finally {
      delete Object.prototype.toJSON;
    }
    assert.deepStrictEqual([out.payload, out.json, out.chars, out.level], [null, null, 0, 5]);
    assert.ok(/toJSON boom/.test(out.reason), out.reason);
  });

  it('random blobs and caps: never over the cap, always valid JSON, never the input changed', () => {
    let seed = 20261002;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const PIECES = ['a', '日本語', '\u{1F600}', 'é', '\u0000', '\u001f', '"', '\\', '\ud800', '\udc00', '\u2028'];
    const str = (n) => { let s = ''; while (s.length < n) s += PIECES[ri(0, PIECES.length - 1)]; return s; };
    for (let n = 0; n < 150; n++) {
      const b = blob({ pages: ri(0, 30), events: ri(0, 15), tabAways: ri(0, 30), mouse: ri(0, 20), legacy: rnd() < 0.3,
        rowsPerPage: ri(1, 3), pid: rnd() < 0.3 ? str(ri(1, 3000)) : 'P' + n, tid: rnd() < 0.3 ? str(ri(1, 400)) : 'span-',
        violations: ri(0, 60), text: rnd() < 0.5 ? SECRET + str(20) : null, aiReport: SECRET + str(ri(0, 900)) });
      if (rnd() < 0.3) b.cyborgHunterError = str(ri(1, 4000));
      for (const r of b.trials) if (rnd() < 0.2) r.integritySegment.deltas['x' + str(ri(1, 60))] = [{ note: SECRET }];
      const before = JSON.stringify(b);
      for (const cap of [ri(0, 400), ri(400, 3000), ri(3000, 15000), 12000, ri(15000, 200000)]) {
        const out = build(b, cap);
        if (out.json === null) { assert.strictEqual(out.level, 5); continue; }
        assert.strictEqual(out.chars, bytes(out.json));
        assert.ok(out.chars <= (cap > 0 ? cap : MAX_CHARS), cap + ': ' + out.chars);
        const parsed = JSON.parse(out.json);
        assert.strictEqual(JSON.stringify(out.payload), out.json);
        assert.ok(!out.json.includes(SECRET));
        const t = parsed.cyborgHunterOneLiner.truncated;
        assert.ok(out.level === 0 ? t === false : t.level === out.level);
      }
      assert.strictEqual(JSON.stringify(b), before);
    }
  });
});

// The result at a ladder level: built with the smallest cap that level
// fits (the level a cap gets never rises as the cap grows).
function atLevel(b, level) {
  let lo = 1, hi = 10000000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (build(b, mid).level <= level) hi = mid; else lo = mid + 1;
  }
  const out = build(b, lo);
  assert.strictEqual(out.level, level);
  return out;
}

// What the CLI makes of a payload: session counters, score, hard trigger.
function totals(raw) {
  const r = extractIntegrityData(raw, {});
  return { paste: r.session.pasteCount, copy: r.session.copyCount, drop: r.session.dropCount,
    hard: r.score.anyHardTriggered, hardPaste: r.score.hardScore.paste.count, soft: r.score.softScore, trials: r.score.trialsCompleted };
}

// A session with every kind of count the report shows, spread over the
// pages so that each ladder level drops some of it: tab-aways in every bin
// of a 5 s threshold, a sidebar incident per page whose opening both checks
// detected, shortcuts, zoom and viewport changes, an injection and an AI
// extension on the first page, idle gaps, synthetic and foreign input, fast
// typing on some pages (8 cps threshold).
function countsBlob(opts = {}) {
  const b = blob({ pages: 8, events: 3, tabAways: 0, ...opts });
  const durations = [1000, 3000, 5000, 5001, 9999, 10000, 15000];
  b.trials.forEach((r, i) => {
    const t0 = 1000 * i + 500;
    const d = r.integritySegment.deltas;
    d.tabAwaySums = durations.slice();
    d.tabAwayEvents = durations.map((ms, k) => ({ start: t0 + 10 * k, duration_ms: ms, type: 'windowBlur', timestamp: STAMP }));
    d.sidebarEvents = [{ type: 'opened', method: 'innerWidth_delta', deltaIW: -300, t: t0 }, { type: 'opened', method: 'layout_compression', gap: 300, t: t0 },
      { type: 'closed', method: 'innerWidth_delta', duration_ms: 1, t: t0 + 1 }, { type: 'closed', method: 'layout_compression', duration_ms: 1, t: t0 + 1 }];
    d.keyboardShortcuts = [{ combo: 'F12', t: t0 }];
    d.zoomChanges = i % 2 ? [{ from: 1, to: 1.1, t: t0 }] : [];
    d.viewportWidthShifts = [{ oldWidth: 1200, newWidth: 900, delta: -300, t: t0 }];
    d.extensionInjections = i === 0 ? [{ tag: 'merlin-root', hasShadow: true, t: 1 }] : [];
    d.aiExtensionsFound = i === 0 ? [{ name: 'Merlin', t: 1 }] : [];
    const t = r.integrity;
    t.tabAwayEvents = i % 3 ? d.tabAwayEvents.slice(0, 2) : [];
    t.idleGaps = [{ duration_ms: 31000, t: t0 }];
    t.syntheticInsertions = [{ type: 'synthetic_insertion', t: t0, dataLength: 12 }];
    t.foreignInputEvents = i % 2 ? [{ t: t0, targetTag: 'TEXTAREA', inputType: 'insertText' }] : [];
    t.charsPerSec = i % 4 === 0 ? 12 : 6;
  });
  b.trials[0].integritySegment.config.thresholds = { tabAwayDurationMs: 5000, typingSpeedCps: 8 };
  return b;
}

// Every number the report shows for a participant, from a payload.
const REPORTED = ['totalTabAways', 'tabAwayFlickerCount', 'tabAwayMediumCount', 'tabAwayLongCount', 'totalTabAwayDuration_ms',
  'tabAwayCutoffMs', 'trialsWithTabAway', 'trialsWithFastTyping', 'totalIdleGaps', 'totalSyntheticInsertions',
  'totalForeignInputEvents', 'sidebarEventCount', 'keyboardShortcutCount', 'layoutShiftCount', 'zoomChangeCount',
  'extensionInjectionCount', 'devToolsEventCount', 'totalPasteEvents', 'totalCopyEvents', 'totalDropEvents',
  'hardTriggered', 'authoritativeSoftScore', 'softScoreThreshold'];
function reported(json) {
  const s = computeParticipantSummary(extractIntegrityData(JSON.parse(json), {}), {});
  const out = Object.fromEntries(REPORTED.map((k) => [k, s[k]]));
  out.aiExtensions = s.aiExtensionCount ?? s.aiExtensionsFound.length;
  return out;
}

describe('a reduced payload carries the whole session\'s counts', () => {
  for (const [name, opts] of [['one page origin', {}], ['the legacy layout, a page origin per two rows', { legacy: true, rowsPerPage: 2 }]]) {
    it(name + ': at every level 1-4 the report\'s numbers equal the unreduced summary\'s', () => {
      const b = countsBlob(opts);
      const full = build(b, 10000000);
      assert.strictEqual(full.level, 0);
      const truth = reported(full.json);
      assert.deepStrictEqual([truth.totalTabAways, truth.tabAwayFlickerCount, truth.tabAwayMediumCount, truth.tabAwayLongCount,
        truth.tabAwayCutoffMs, truth.sidebarEventCount, truth.trialsWithFastTyping, truth.aiExtensions], [56, 24, 16, 16, 5000, 8, 2, 1]);
      for (const level of [1, 2, 3, 4]) {
        const out = atLevel(b, level);
        assert.deepStrictEqual(reported(out.json), truth, 'level ' + level);
        const totals = out.payload.cyborgHunterOneLiner.truncated.totals;
        assert.ok(Object.values(totals).every((v) => typeof v === 'number' && Number.isFinite(v)), JSON.stringify(totals));
      }
    });
  }

  it('level 0 and level 5 carry no totals', () => {
    const b = countsBlob();
    assert.strictEqual(build(b, 10000000).payload.cyborgHunterOneLiner.truncated, false);
    const four = atLevel(b, 4);
    const five = build(b, four.chars - 1);
    assert.strictEqual(five.level, 5);
    assert.deepStrictEqual(five.payload.cyborgHunterOneLiner.truncated, { level: 5 });
  });
});

// Under the legacy layout every page is a full load with its own monitor,
// and the CLI adds up the last segment of each page origin
// (src/cli/segment-reassembly.js): levels 3 and 4 drop whole pages, and
// their counts must not go with them.
describe('the legacy layout: one monitor per page', () => {
  for (const [rows, rowsPerPage] of [[12, 6], [18, 6], [10, 1]]) {
    it(rows / rowsPerPage + ' page origins: the CLI\'s totals and hard trigger at levels 3 and 4 equal the untrimmed session\'s', () => {
      // Pastes on the first page only, so the hard trigger lives on a dropped page.
      const b = blob({ pages: rows, rowsPerPage, legacy: true, events: 1, tabAways: 2, pasteRows: [0, 1] });
      const truth = totals(b);
      assert.deepStrictEqual([truth.paste, truth.hard, truth.trials], [2, true, rows]);
      const truthTrials = extractIntegrityData(b, {}).trials;
      for (const level of [3, 4]) {
        const out = atLevel(b, level);
        const raw = JSON.parse(out.json);
        assert.deepStrictEqual(totals(raw), truth, 'level ' + level);
        const [rollup] = raw.integritySegments;
        assert.deepStrictEqual([rollup.source, rollup.pageOrigin, rollup.deltas], ['rollup', ORIGIN, {}]);
        // The kept trials sit on the untrimmed session's clock.
        const newest = extractIntegrityData(raw, {}).trials.at(-1);
        assert.strictEqual(newest.startTime, truthTrials.at(-1).startTime);
      }
    });
  }

  it('one page origin needs no rollup, and its totals still hold', () => {
    const b = blob({ pages: 12, events: 1, tabAways: 2, pasteRows: [0, 1] });
    const truth = totals(b);
    for (const level of [3, 4]) {
      const out = atLevel(b, level);
      assert.ok(!('integritySegments' in out.payload), 'level ' + level);
      assert.deepStrictEqual(totals(JSON.parse(out.json)), truth);
    }
  });
});

// Levels 4 and 5 must fit any cap the adapter could use, whatever the
// session wrote and however long the ids are.
describe('the last levels have fixed upper bounds', () => {
  it('level 4 stays under 9,500 bytes with every field at its longest', () => {
    // Every string LABEL_MAX three-byte characters, every error note NOTE_MAX,
    // every number 24 characters long (and finite when summed), every
    // allowlisted key present, three page origins (so a rollup): 8,583 bytes
    // when this was written, 9,030 once level 4 carried the whole session's
    // counts (truncated.totals, a fixed set of numbers). The cap is 12,000.
    const NUM = -1.2345678901234567e-300, LONG = '頁'.repeat(200);
    const fill = (v, k) => (Array.isArray(v) ? v.map((x) => fill(x))
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([key, x]) => [key, fill(x, key)]))
      : typeof v === 'number' ? (k === 'segmentIndex' || k === 'pageOrigin' ? v : NUM)
      : typeof v === 'string' ? LONG : v);
    const b = fill(blob({ pages: 12, legacy: true, rowsPerPage: 4, events: 2 }));
    const nums = (...keys) => Object.fromEntries(keys.map((k) => [k, NUM]));
    const hardSignal = nums('trialHits', 'sessionTotal', 'countThreshold'), softSignal = nums('hits', 'capped', 'score');
    for (const r of b.trials) {
      r.integrity.trialSignals = { hard: { paste: hardSignal, copy: hardSignal, drop: hardSignal },
        soft: { copy: softSignal, tabAway: softSignal, sidebarEvent: softSignal, devTools: softSignal, foreignInput: softSignal,
          typingSpeed: nums('charsPerSec', 'threshold', 'hit', 'score') } };
      const hard = { count: NUM, threshold: NUM, triggered: true };
      r.integritySegment.score.hardScore = { paste: hard, copy: hard, drop: hard };
      for (const k of ['tabAwaySums', 'tabAwayEvents', 'charsPerSec', 'idleGaps', 'sidebarEvents', 'devToolsEvents', 'aiExtensionsFound',
        'keyboardShortcuts', 'extensionInjections', 'viewportWidthShifts', 'zoomChanges']) {
        r.integritySegment.deltas[k] = [k === 'tabAwaySums' || k === 'charsPerSec' ? NUM : { t: NUM }];
      }
      r.cyborgHunterError = '頁'.repeat(1000);
    }
    Object.assign(b, { cyborgHunterError: '頁'.repeat(1000), ai_use_session: true, ai_report_session: 'x'.repeat(100000),
      guard_assistance_violation_count_session: NUM,
      guard_assistance_violations_session: JSON.stringify(Array.from({ length: 100 }, () =>
        ({ reason: LONG, start: NUM, end: NUM, duration: NUM, in_progress: true, pageOrigin: NUM }))) });
    b.cyborgHunterOneLiner.pageCount = NUM;
    const out = atLevel(b, 4);
    assert.ok(out.payload.integritySegments, 'the rollup is there');
    assert.ok(out.chars <= 9500, out.chars + ' bytes');
  });

  it('the minimal payload stays under 600 bytes', () => {
    const unreadable = { participantId: '頁'.repeat(200), trials: [{ get integrity() { throw new Error('unreadable'); } }] };
    const out = buildQualtricsPayload({ blob: unreadable });
    assert.strictEqual(out.level, 5);
    assert.ok(out.chars <= 600, out.chars + ' bytes');
  });
});

// Each ladder test's cap sits between the fixture's measured sizes at the
// level under test and the level before it, so the test lands on that level.
describe('the ladder', () => {
  it('level 1 keeps the newest session entries per key and counts the dropped ones', () => {
    const b = blob({ pages: 4, tabAways: 20 });   // 80 tab-aways; level 0 is about 14,100 bytes, level 1 about 9,200
    const out = build(b, 9500);
    assert.strictEqual(out.level, 1);
    const kept = out.payload.trials.reduce((n, t) => n + t.integritySegment.deltas.tabAwayEvents.length, 0);
    assert.strictEqual(kept, KEEP_SESSION_ENTRIES);
    assert.strictEqual(out.payload.trials[3].integritySegment.deltas.tabAwayEvents.length, 20);   // newest first
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated.droppedSessionEntries.tabAwayEvents, 55);
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated.droppedSessionEntries.tabAwaySums, 55);
    assert.ok(out.chars <= 9500);
  });
  it('level 1 keeps the newest honeypot violations too, and level 4 counts the rest as dropped', () => {
    // A participant who alt-tabs to a chatbot dozens of times: 80 entries
    // alone push a 3-page session over the cap.
    const b = blob({ violations: 80 });
    const out = build(b, 12000);
    assert.strictEqual(out.level, 1);
    const kept = JSON.parse(out.payload.guard_assistance_violations_session);
    assert.deepStrictEqual(kept.map((v) => v.start), Array.from({ length: KEEP_SESSION_ENTRIES }, (_, k) => 1055 + k));   // the newest
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated.droppedSessionEntries.guard_assistance_violations_session, 55);
    assert.strictEqual(out.payload.guard_assistance_violation_count_session, 80);   // the full count stays
    assert.strictEqual(out.payload.trials.length, 3);
    assert.strictEqual(extractIntegrityData(JSON.parse(out.json), {}).guardFriction.violations.length, KEEP_SESSION_ENTRIES);
    const last = atLevel(b, 4);
    assert.ok(!('guard_assistance_violations_session' in last.payload));
    assert.strictEqual(last.payload.guard_assistance_violation_count_session, 80);
    assert.strictEqual(last.payload.cyborgHunterOneLiner.truncated.droppedSessionEntries.guard_assistance_violations_session, 80);
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
    const b = blob({ pages: 40, events: 20, tabAways: 20 });   // level 4 about 1,700 bytes, level 3 about 11,600
    const out = build(b, 2000);
    assert.strictEqual(out.level, 4);
    assert.ok(out.chars <= 2000, out.chars + ' bytes');
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
