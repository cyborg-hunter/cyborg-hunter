// tests/cli/cursor-report.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCORE_SIGNALS, resolveScoreWeights, formulaText, SIGNAL_LABELS } from '../../src/cli/analyzers/score-weights.js';
import { generateTriageReason, rankTriage } from '../../src/cli/analyzers/triage.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { analyzeCursor } from '../../src/cli/analyzers/cursor.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { buildSummaryCsv } from '../../src/cli/renderers/summary-csv-core.js';
import { buildCursorLimitsJson } from '../../src/cli/renderers/cursor-limits-core.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import { buildReport, REPORT_FILES } from '../../src/cli/report-core.js';

const mv = (x, y, t) => ({ x, y, cx: x, cy: y, t, type: 'move' });
const ck = (x, y, t, extra = {}) => ({ x, y, cx: x, cy: y, t, type: 'click', trusted: true, detail: 1, pointerType: 'mouse', ...extra });
const path = (t0) => [mv(100, 100, t0), mv(150, 130, t0 + 50), mv(210, 150, t0 + 105), mv(260, 160, t0 + 160), ck(260, 160, t0 + 200)];
const base = (id, trials, device) => ({
  participantId: id,
  trials: trials.map((events, i) => ({ trialId: 'q' + (i + 1), startTime: 1000 + i * 6000, duration_ms: 5000, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0, mouseEvents: events, libraryVersion: '0.14.0' })),
  session: device === undefined ? {} : { device }
});
const desktop = { maxTouchPoints: 0, coarsePointer: false, webdriver: false };
const human = base('HUMAN', [path(0), path(0)], desktop);
// q2 is a click with no move sample, 700 px from q1's click: a trial clicked
// without pointer movement (and a click after a pointer jump).
const driver = base('DRIVER', [[mv(50, 50, 5), ck(50, 50, 6)], [ck(600, 600, 6)]], { ...desktop, webdriver: true });
const old = base('OLD', [[{ x: 1, y: 1, t: 0, type: 'move' }, { x: 2, y: 1, t: 50, type: 'move' }, { x: 2, y: 1, t: 60, type: 'click' }]], undefined);
const config = { outputDir: '.', participantIdField: 'participantId' };

function analyze(participants, cfg = config) {
  const summaries = computeSummary(participants, cfg);
  const cursors = analyzeCursor(participants, cfg);
  summaries.forEach((s, i) => { s.cursorAnalysis = cursors[i]; });
  const edgeExits = detectEdgeExits(participants, cfg);
  const triage = rankTriage(summaries, edgeExits, cfg);
  return { summaries, cursors, edgeExits, triage };
}

describe('the cursor weight', () => {
  it('is a registered key, default 0, labelled "pointer checks (cursor)"', () => {
    const sig = SCORE_SIGNALS.find(s => s.key === 'cursor');
    assert.ok(sig); assert.equal(sig.weight, 0);
    assert.equal(SIGNAL_LABELS.cursor, 'pointer checks (cursor)');
    assert.equal(sig.count({ cursorAnalysis: { factCount: 2 } }), 2);
    assert.equal(sig.count({ cursorAnalysis: { factCount: null } }), 0);
    assert.equal(sig.count({}), 0);
  });
  it('at 0 leaves the ranking identical; at 1 ranks the fired session first within its tier', () => {
    const { triage: t0 } = analyze([human, driver]);
    assert.deepEqual(t0.map(t => [t.participantId, t.score]), [['HUMAN', 0], ['DRIVER', 0]]);
    const { triage: t1 } = analyze([human, driver], { ...config, scoreWeights: { cursor: 1 } });
    assert.equal(t1[0].participantId, 'DRIVER');
    // The default weights stay on beside it, as [key, 0] terms.
    assert.deepEqual(t1[0].terms.filter(([, n]) => n > 0), [['cursor', 2]]);
  });
  it('formulaText labels the key', () => {
    const { weights } = resolveScoreWeights({ cursor: 1 });
    assert.ok(formulaText(weights).endsWith('1×pointer checks (cursor)'));
  });
});

describe('the triage reason', () => {
  it('names fired checks, unscored', () => {
    const { triage } = analyze([driver]);
    assert.match(triage[0].reason, /pointer checks: automation flag; trials clicked without pointer movement 1\/2/);
  });
  it('says nothing for a clean session and for not-recorded data', () => {
    const { triage } = analyze([human, old]);
    for (const t of triage) assert.equal(t.reason, 'clean');
  });
});

describe('summary.csv', () => {
  it('keeps every existing header and appends the sixteen cursor columns in order', () => {
    const { summaries, triage } = analyze([human, driver, old]);
    const [header, ...rows] = buildSummaryCsv(summaries, triage).trim().split('\n');
    const cols = header.split(',');
    assert.equal(cols.indexOf('meanPathEfficiency') > 0, true);
    assert.deepEqual(cols.slice(-16), ['cursorReason', 'cursorChecksRecorded', 'cursorFactCount', 'cursorWebdriver', 'cursorUntrustedClicks', 'cursorZeroMoveTrials', 'cursorJumpClicks', 'cursorCoordinates', 'cursorStream', 'cursorSampleIntervalMs', 'cursorClicks', 'cursorMovements', 'cursorMovesPerTrialMedian', 'cursorEfficiencyMedian', 'cursorMaxDeviationPxMedian', 'cursorCenteredClicks']);
    const byId = Object.fromEntries(rows.map(r => [r.split(',')[0], r.split(',')]));
    const tail = (id) => byId[id].slice(-16);
    assert.deepEqual(tail('DRIVER').slice(0, 7), ['', '3', '2', 'YES', '0', '1/2', '1/2']);
    assert.deepEqual(tail('OLD').slice(0, 7), ['', '0', '', '', '', '', '0/1']);
    assert.equal(tail('HUMAN')[3], 'no');
    assert.equal(tail('HUMAN')[15], '');
  });
  it('a null session has its reason and empty values', () => {
    const touch = base('TOUCH', [[mv(5, 5, 0), ck(5, 5, 10)]], { maxTouchPoints: 5, coarsePointer: true, webdriver: false });
    const { summaries, triage } = analyze([touch]);
    const row = buildSummaryCsv(summaries, triage).trim().split('\n')[1].split(',');
    assert.equal(row.slice(-16)[0], 'no cursor stream (touch device)');
    assert.equal(row.slice(-16)[10], '');
  });
});

describe('cursor-limits.json', () => {
  it('carries the version, every constant with its meaning, and the realised interval', () => {
    const { cursors } = analyze([human]);
    const j = JSON.parse(buildCursorLimitsJson('0.14.0', cursors));
    assert.equal(j.libraryVersion, '0.14.0');
    assert.equal(j.limits.discontinuityPx.value, 100);
    assert.ok(j.limits.discontinuityPx.meaning.length > 20);
    assert.equal(typeof j.sampleIntervalMs.core.median, 'number');
  });
});

describe('the HTML report', () => {
  it('renders the section, the tile, the rail cell with its sort attribute, and the sort option', async () => {
    const { summaries, triage } = analyze([human, driver, old]);
    const html = await renderIndexHtml(summaries, triage, [human, driver, old], config, false);
    assert.match(html, /<option value="cursor">Pointer checks/);
    assert.match(html, /data-cursor="2"[^>]*data-pid="DRIVER"|data-pid="DRIVER"[\s\S]{0,300}data-cursor="2"/);
    assert.match(html, /data-pid="OLD"[\s\S]{0,300}data-cursor="-1"/);
    assert.match(html, /pointer checks: 2 of 3/);
    assert.match(html, /pointer checks: not recorded/);
    assert.match(html, /Cursor dynamics/);
    assert.match(html, /automation flag set by the browser/);
    assert.match(html, /trials clicked without pointer movement[\s\S]{0,80}1 of 2 \(q2\)/);
    assert.match(html, /clicks after a pointer jump/);
    assert.match(html, /median \d+ ms between samples/);
    assert.match(html, /cursor-limits\.json/);
    assert.match(html, /Pointer checks<\/span>/);     // the tile label
  });
  it('a null session says why and shows no numbers', async () => {
    const touch = base('TOUCH', [[mv(5, 5, 0), ck(5, 5, 10)]], { maxTouchPoints: 5, coarsePointer: true, webdriver: false });
    const { summaries, triage } = analyze([touch]);
    const html = await renderIndexHtml(summaries, triage, [touch], config, false);
    assert.match(html, /no cursor stream \(touch device\)/);
    assert.doesNotMatch(html, /clicks after a pointer jump/);
  });
  it('links to the replay section, whose wrapper carries the id, unless the replay is shown outside the report', async () => {
    const withReplay = { ...human, replay: { recording: { segments: [] } } };
    const { summaries, triage } = analyze([withReplay]);
    const html = await renderIndexHtml(summaries, triage, [withReplay], config, false);
    assert.match(html, /<a href="#replay-HUMAN">open the replay<\/a>/);
    assert.match(html, /<div class="image-block replay-block" id="replay-HUMAN"/);
    const outside = await renderIndexHtml(summaries, triage, [withReplay], config, false, { replayShownExternally: true });
    assert.doesNotMatch(outside, /open the replay/);
  });
});

describe('buildReport', () => {
  it('writes cursor-limits.json, prints the run line, and warns on partial coverage', async () => {
    assert.ok(REPORT_FILES.includes('cursor-limits.json'));
    const files = {}; const logs = []; const warns = [];
    await buildReport([human, old], { ...config, scoreWeights: { cursor: 1 } }, {
      sink: (p, body) => { files[p] = body; }, log: (l) => logs.push(l), warn: (w) => warns.push(w)
    });
    assert.ok(files['cursor-limits.json']);
    assert.ok(logs.some(l => /Pointer checks: fired in 0 of 1 checkable sessions \(1 recorded before 0\.14, 0 no cursor stream\)/.test(l)), logs.join('\n'));
    assert.ok(warns.some(w => /scoreWeights\.cursor is 1; 1 of 2 sessions carry pointer checks/.test(w)), warns.join('\n'));
  });
});

describe('extraction', () => {
  it('keeps the device object a jsPsych last trial carries in integritySession', () => {
    const trial = (trialId) => ({ trialId, integrity: { trialId, startTime: 0, duration_ms: 1000, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], mouseEvents: [mv(10, 10, 5), ck(10, 10, 6)], libraryVersion: '0.14.0' } });
    const raw = {
      participantId: 'DEVICE',
      trials: [trial('q1'), {
        ...trial('q2'),
        integritySession: { tabAwaySums: [], pasteCount: 0, copyCount: 0, device: { maxTouchPoints: 0, coarsePointer: false, webdriver: true } }
      }]
    };
    const participant = extractIntegrityData(raw, config);
    assert.equal(participant.session.device.webdriver, true);
  });
});
