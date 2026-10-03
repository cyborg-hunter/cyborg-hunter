// tests/oneliner/qualtrics-payload.test.js
// The Qualtrics payload builder: trims the vanilla blob to a summary and
// walks the degradation ladder until the serialized string fits the cap.
// A payload over Qualtrics' per-submit limit blocks the participant, so the
// over-cap case is pinned for several caps.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildQualtricsPayload, trimTrialReport, KEEP_SESSION_ENTRIES, KEEP_PAGES } from '../../src/oneliner/qualtrics-payload.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';

// A vanilla blob with `pages` rows; each row has `events` paste events, a 300-sample mouse trace,
// and its segment carries `tabAways` tab-away deltas and 40 windowPositions samples.
function blob({ pages = 3, events = 2, tabAways = 3, mouse = 300, text = false } = {}) {
  const trials = [];
  for (let i = 0; i < pages; i++) {
    const pasteEvents = Array.from({ length: events }, (_, k) => Object.assign({ t: 1000 * i + k, pastedLength: 40, isKnownInput: true }, text ? { text: 'x'.repeat(400) } : {}));
    trials.push({
      trialId: 'span-' + i,
      integrity: {
        trialId: 'span-' + i, libraryVersion: '0.12.0', participantId: 'P1', startTime: 1000 * i, duration_ms: 900,
        pasteEvents, copyEvents: [], dropEvents: [], tabAwayEvents: [], idleGaps: [], syntheticInsertions: [], foreignInputEvents: [],
        editTimestamps: Array.from({ length: 500 }, (_, k) => k), mouseTrack: Array.from({ length: mouse }, (_, k) => ({ t: k, x: k, y: k })),
        elementTrace: Array.from({ length: 50 }, (_, k) => ({ t: k, id: 'el' + k })), mouseMetrics: { pathEfficiency: 0.8 },
        trialSoftScore: 1, trialSignals: { paste: { count: events } }
      },
      integritySegment: {
        segmentIndex: i, source: 'page', trialId: 'span-' + i, pageOrigin: 1700000000000,
        deltas: {
          tabAwayEvents: Array.from({ length: tabAways }, (_, k) => ({ start: 100 * k, duration: 2000, reason: 'blur' })),
          tabAwaySums: Array.from({ length: tabAways }, () => 2000),
          keyboardShortcuts: [], windowPositions: Array.from({ length: 40 }, (_, k) => ({ t: k, x: 0, y: 0, w: 1200, h: 800 }))
        },
        counters: { pasteCount: events * (i + 1), copyCount: 0, dropCount: 0 },
        score: { hardScore: { paste: { count: events * (i + 1), threshold: 2, triggered: events * (i + 1) >= 2 } }, softScore: i, softScoreThreshold: 5, anyHardTriggered: events * (i + 1) >= 2, trialsCompleted: i + 1 },
        ...(i === 0 ? { config: { preset: 'standard', participantId: 'P1', thresholds: { tabAwayDurationMs: 3000, typingSpeedCps: 10 } }, libraryVersion: '0.12.0' } : {})
      },
      integrityPasteCount: events * (i + 1), integrityCopyCount: 0, integrityDropCount: 0, integritySoftScore: i, integrityAnyHardTriggered: events * (i + 1) >= 2
    });
  }
  return { participantId: 'P1', libraryVersion: '0.12.0', cyborgHunterOneLiner: { version: '0.12.0', host: 'vanilla', pageCount: pages }, trials,
    guard_assistance_violations_session: '[]', guard_assistance_violation_count_session: 0, ai_use_session: false, ai_report_session: 'r'.repeat(2000) };
}

describe('buildQualtricsPayload level 0', () => {
  it('drops the raw traces, keeps events, counters and scores, and the CLI reads it', () => {
    const b = blob({ text: true });
    const out = buildQualtricsPayload({ blob: b, maxChars: 12000 });
    assert.strictEqual(out.level, 0);
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated, false);
    assert.strictEqual(out.payload.cyborgHunterOneLiner.host, 'qualtrics');
    assert.strictEqual(out.chars, out.json.length);
    assert.ok(out.chars <= 12000);
    const t0 = out.payload.trials[0].integrity;
    for (const k of ['mouseTrack', 'mouseEvents', 'elementTrace', 'editTimestamps']) assert.strictEqual(t0[k], undefined);
    assert.strictEqual(t0.pasteEvents.length, 2);
    assert.strictEqual(t0.pasteEvents[0].text, undefined);
    assert.strictEqual(t0.pasteEvents[0].pastedLength, 40);
    assert.strictEqual(out.payload.trials[0].integritySegment.deltas.windowPositions, undefined);
    assert.strictEqual(out.payload.trials[0].integritySegment.deltas.tabAwayEvents.length, 3);
    assert.strictEqual(out.payload.ai_report_session.length, 500);
    assert.strictEqual(b.trials[0].integrity.mouseTrack.length, 300);   // input untouched
    const r = extractIntegrityData(JSON.parse(out.json), {});
    assert.deepStrictEqual(r.warnings, []);
    assert.strictEqual(r.trials.length, 3);
    assert.strictEqual(r.session.tabAwayEvents.length, 9);
    assert.strictEqual(r.session.pasteCount, 6);
    assert.strictEqual(r.score.anyHardTriggered, true);
  });
});

// Each ladder test's cap sits between the fixture's measured sizes at the
// level under test and the level before it, so the test lands on that level.
describe('the ladder', () => {
  it('level 1 keeps the newest session entries per key and counts the dropped ones', () => {
    const b = blob({ pages: 4, tabAways: 20 });   // 80 tab-aways; level 0 is about 8,900 characters, level 1 about 6,200
    const out = buildQualtricsPayload({ blob: b, maxChars: 7000 });
    assert.strictEqual(out.level, 1);
    const kept = out.payload.trials.reduce((n, t) => n + t.integritySegment.deltas.tabAwayEvents.length, 0);
    assert.strictEqual(kept, KEEP_SESSION_ENTRIES);
    assert.strictEqual(out.payload.trials[3].integritySegment.deltas.tabAwayEvents.length, 20);   // newest first
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated.droppedSessionEntries.tabAwayEvents, 55);
    assert.ok(out.chars <= 7000);
  });
  it('level 2 empties older rows\' event arrays but keeps every count', () => {
    const b = blob({ pages: 6, events: 12, tabAways: 0 });   // level 1 about 9,600 characters, level 2 about 6,900
    const out = buildQualtricsPayload({ blob: b, maxChars: 7500 });
    assert.ok(out.level >= 2 && out.level <= 3, 'level ' + out.level);
    const newest = out.payload.trials[out.payload.trials.length - 1];
    assert.strictEqual(newest.integrity.pasteEvents.length, 12);
    assert.strictEqual(newest.integritySegment.counters.pasteCount, 72);
    for (const t of out.payload.trials.slice(0, -1)) {
      assert.deepStrictEqual(t.integrity.pasteEvents, []);
      assert.strictEqual(t.integrityTruncated, true);
      assert.ok(t.integrityPasteCount > 0);
    }
    assert.ok(out.chars <= 7500);
  });
  it('level 3 keeps only the newest pages', () => {
    const b = blob({ pages: 40, events: 1, tabAways: 1 });   // level 2 about 38,400 characters, level 3 about 5,800
    const out = buildQualtricsPayload({ blob: b, maxChars: 6000 });
    assert.strictEqual(out.level, 3);
    assert.strictEqual(out.payload.trials.length, KEEP_PAGES);
    assert.strictEqual(out.payload.cyborgHunterOneLiner.truncated.pagesDropped, 35);
    assert.strictEqual(out.payload.trials[KEEP_PAGES - 1].integritySegment.segmentIndex, 39);
    assert.strictEqual(out.payload.trials[0].integritySegment.config.preset, 'standard');   // the first segment's config moves forward
    assert.ok(out.chars <= 6000);
    const r = extractIntegrityData(JSON.parse(out.json), {});
    assert.strictEqual(r.session.pasteCount, 40);
    assert.strictEqual(r.session.config.preset, 'standard');
  });
  it('level 4 always fits and the CLI still scores it', () => {
    const b = blob({ pages: 40, events: 20, tabAways: 20 });
    const out = buildQualtricsPayload({ blob: b, maxChars: 1500 });
    assert.strictEqual(out.level, 4);
    assert.ok(out.chars <= 1500, out.chars + ' chars');
    assert.strictEqual(out.payload.trials.length, 1);
    assert.deepStrictEqual(out.payload.trials[0].integritySegment.deltas, {});
    const r = extractIntegrityData(JSON.parse(out.json), {});
    assert.strictEqual(r.score.anyHardTriggered, true);
    assert.strictEqual(r.session.pasteCount, 800);
    assert.ok(r.warnings.some((w) => /reduced to fit the embedded-data cap \(level 4/.test(w)));
  });
  it('OVER-CAP GUARANTEE: a session of 400 events and 40 pages never serializes above the cap, stays valid JSON, is flagged, and keeps the score', () => {
    const b = blob({ pages: 40, events: 10, tabAways: 10, text: true });
    const before = JSON.stringify(b);
    const full = before.length;
    assert.ok(full > 12000, 'the fixture must be over the cap on its own: ' + full);
    for (const cap of [12000, 8000, 4000, 2000]) {
      const out = buildQualtricsPayload({ blob: b, maxChars: cap });
      assert.ok(out.chars <= cap, 'cap ' + cap + ': ' + out.chars);
      assert.ok(out.chars < full);
      const parsed = JSON.parse(out.json);
      assert.ok(out.level === 0 ? parsed.cyborgHunterOneLiner.truncated === false : parsed.cyborgHunterOneLiner.truncated.level === out.level);
      assert.strictEqual(extractIntegrityData(parsed, {}).score.anyHardTriggered, true);
    }
    assert.strictEqual(JSON.stringify(b), before);   // no level changes the input
  });
  it('trimTrialReport keeps the schema\'s required fields', () => {
    const t = trimTrialReport(blob().trials[0].integrity);
    for (const k of ['trialId', 'libraryVersion', 'participantId', 'startTime', 'duration_ms', 'pasteEvents', 'copyEvents', 'dropEvents', 'tabAwayEvents', 'trialSoftScore', 'trialSignals']) assert.ok(k in t, k);
    assert.ok(!('mouseTrack' in t));
  });
});
