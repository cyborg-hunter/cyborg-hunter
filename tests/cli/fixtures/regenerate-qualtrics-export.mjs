// Regenerates qualtrics-export.csv, the Qualtrics CSV export the CLI reader's
// tests read (tests/cli/qualtrics-csv.test.js).
//
// The two payload cells are built with the real payload builder
// (src/oneliner/qualtrics-payload.js) from synthetic vanilla blobs; no
// participant data. Re-run it when the builder's output changes, then re-run
// the reader's tests. The script checks what the tests rely on before it
// writes: R_1 stays at level 0 with 2 pages and 1 paste, R_2 lands on level 2
// at the 12,000-character cap.
//
// Run: node tests/cli/fixtures/regenerate-qualtrics-export.mjs
// Output overwrites qualtrics-export.csv.
import assert from 'node:assert';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildQualtricsPayload } from '../../../src/oneliner/qualtrics-payload.js';
import { extractIntegrityData } from '../../../src/cli/extract-core.js';

const V = '0.11.0';   // fixed, so the fixture does not change with each release
const ORIGIN = 1759500000000;
// pastes[i] = paste events on page i (cumulative counters on the segments)
function blob(pid, pastes, tabAways) {
  let total = 0;
  const trials = pastes.map((n, i) => {
    total += n;
    const t0 = 20000 * i;
    const pasteEvents = Array.from({ length: n }, (_, k) => ({ t: t0 + 500 + 40 * k, pastedLength: 40 + k, isKnownInput: true, target: 'QR~QID' + (i + 1) }));
    return {
      trialId: 'page-' + (i + 1),
      integrity: {
        trialId: 'page-' + (i + 1), libraryVersion: V, participantId: pid, startTime: t0, duration_ms: 18000,
        pasteEvents, copyEvents: [], dropEvents: [], tabAwayEvents: [], idleGaps: [], syntheticInsertions: [], foreignInputEvents: [],
        editTimestamps: Array.from({ length: 30 }, (_, k) => t0 + 100 * k),
        mouseTrack: Array.from({ length: 50 }, (_, k) => ({ t: t0 + 20 * k, x: 100 + k, y: 200 + k })),
        mouseMetrics: { pathEfficiency: 0.81 },
        trialSoftScore: n > 0 ? 1 : 0, trialSignals: { paste: { count: n } }
      },
      integritySegment: {
        segmentIndex: i, source: 'page', trialId: 'page-' + (i + 1), pageOrigin: ORIGIN,
        deltas: {
          tabAwayEvents: Array.from({ length: tabAways }, (_, k) => ({ start: t0 + 1000 * k, duration: 3500, reason: 'blur' })),
          tabAwaySums: Array.from({ length: tabAways }, () => 3500),
          keyboardShortcuts: [],
          windowPositions: Array.from({ length: 5 }, (_, k) => ({ t: t0 + 2000 * k, x: 0, y: 0, w: 1280, h: 800 }))
        },
        counters: { pasteCount: total, copyCount: 0, dropCount: 0 },
        score: { hardScore: { paste: { count: total, threshold: 2, triggered: total >= 2 } }, softScore: total > 0 ? 1 : 0, softScoreThreshold: 5, anyHardTriggered: total >= 2, trialsCompleted: i + 1 },
        ...(i === 0 ? { config: { preset: 'standard', participantId: pid, thresholds: { tabAwayDurationMs: 3000, typingSpeedCps: 10 } }, libraryVersion: V } : {})
      },
      integrityPasteCount: total, integrityCopyCount: 0, integrityDropCount: 0, integritySoftScore: total > 0 ? 1 : 0, integrityAnyHardTriggered: total >= 2
    };
  });
  return { participantId: pid, libraryVersion: V, cyborgHunterOneLiner: { version: V, host: 'vanilla', pageCount: pastes.length }, trials,
    guard_assistance_violations_session: '[]', guard_assistance_violation_count_session: 0, ai_use_session: false, ai_report_session: '' };
}

const r1 = buildQualtricsPayload({ blob: blob('P-ONE', [0, 1], 1), maxChars: 12000 });
assert.strictEqual(r1.level, 0);
const e1 = extractIntegrityData(JSON.parse(r1.json), {});
assert.strictEqual(e1.trials.length, 2);
assert.strictEqual(e1.session.pasteCount, 1);
assert.deepStrictEqual(e1.warnings, []);

const r2 = buildQualtricsPayload({ blob: blob('ch-0123456789ab', [30, 30, 30, 30, 30], 0), maxChars: 12000 });
const full = buildQualtricsPayload({ blob: blob('ch-0123456789ab', [30, 30, 30, 30, 30], 0), maxChars: Infinity }).chars;
assert.strictEqual(r2.level, 2, 'level ' + r2.level + ' full ' + full);
const e2 = extractIntegrityData(JSON.parse(r2.json), {});
assert.ok(e2.warnings.some((w) => /level 2/.test(w)));

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const ids = ['StartDate', 'EndDate', 'Status', 'Progress', 'Duration (in seconds)', 'Finished', 'RecordedDate', 'ResponseId', 'DistributionChannel', 'UserLanguage', 'QID1_TEXT', '__js_cyborg_hunter'];
const labels = ['Start Date', 'End Date', 'Response Type', 'Progress', 'Duration (in seconds)', 'Finished', 'Recorded Date', 'Response ID', 'Distribution Channel', 'User Language', 'Describe your answer.', '__js_cyborg_hunter'];
const imports = [{ ImportId: 'startDate', timeZone: 'America/Los_Angeles' }, { ImportId: 'endDate', timeZone: 'America/Los_Angeles' }, { ImportId: 'status' }, { ImportId: 'progress' }, { ImportId: 'duration' }, { ImportId: 'finished' }, { ImportId: 'recordedDate', timeZone: 'America/Los_Angeles' }, { ImportId: '_recordId' }, { ImportId: 'distributionChannel' }, { ImportId: 'userLanguage' }, { ImportId: 'QID1_TEXT' }, { ImportId: '__js_cyborg_hunter' }];
const row = (rid, n, cell) => ['2026-10-03 09:0' + n + ':00', '2026-10-03 09:1' + n + ':00', 'Survey Preview', '100', '600', 'True', '2026-10-03 09:1' + n + ':01', rid, 'preview', 'EN', 'An answer', cell];
const lines = [
  ids.join(','),
  labels.map(q).join(','),
  imports.map((o) => q(JSON.stringify(o))).join(','),
  row('R_1', 1, q(r1.json)).join(','),
  row('R_2', 2, q(r2.json)).join(','),
  row('R_3', 3, '').join(','),
  row('R_4', 4, 'not json').join(',')
];
for (const l of lines) assert.ok(!l.includes('\n') && !l.includes('\r'));
writeFileSync(fileURLToPath(new URL('./qualtrics-export.csv', import.meta.url)), lines.join('\n') + '\n');
