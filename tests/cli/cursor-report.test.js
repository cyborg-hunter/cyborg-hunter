// tests/cli/cursor-report.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCORE_SIGNALS, resolveScoreWeights, formulaText, SIGNAL_LABELS } from '../../src/cli/analyzers/score-weights.js';
import { generateTriageReason, rankTriage } from '../../src/cli/analyzers/triage.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { analyzeCursor, CURSOR_LIMITS } from '../../src/cli/analyzers/cursor.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { buildSummaryCsv } from '../../src/cli/renderers/summary-csv-core.js';
import { buildCursorLimitsJson } from '../../src/cli/renderers/cursor-limits-core.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import { buildReport, REPORT_FILES } from '../../src/cli/report-core.js';
import { VERSION } from '../../src/shared/constants.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
// Four trials, 100 ms apart, each one move sample then a click at it, 300 px
// from the last: three first clicks arrive without a path (the first has no
// position before it); the automation flag is not set.
const scripted = base('SCRIPTED', Array.from({ length: 4 }, (_, i) => [mv(100 + i * 300, 200, 5), ck(100 + i * 300, 200, 6)]), desktop);
scripted.trials.forEach((t, i) => { t.startTime = 1000 + i * 5100; });
const old = base('OLD', [[{ x: 1, y: 1, t: 0, type: 'move' }, { x: 2, y: 1, t: 50, type: 'move' }, { x: 2, y: 1, t: 60, type: 'click' }]], undefined);
const config = { outputDir: '.', participantIdField: 'participantId' };
// Sessions with no cursor stream: a touch device, and one whose browser set
// its automation flag.
const touch = base('TOUCH', [[mv(5, 5, 0), ck(5, 5, 10)]], { maxTouchPoints: 5, coarsePointer: true, webdriver: false });
const touchFlag = base('TOUCHFLAG', [[mv(5, 5, 0), ck(5, 5, 10)]], { maxTouchPoints: 5, coarsePointer: true, webdriver: true });

function analyze(participants, cfg = config) {
  const summaries = computeSummary(participants, cfg);
  const cursors = analyzeCursor(participants);
  summaries.forEach((s, i) => { s.cursorAnalysis = cursors[i]; });
  const edgeExits = detectEdgeExits(participants, cfg);
  const triage = rankTriage(summaries, edgeExits, cfg);
  return { summaries, cursors, edgeExits, triage };
}

describe('the cursor weight', () => {
  it('is a registered key, default 0, labelled "pointer verdict (cursor)", counting the level', () => {
    const sig = SCORE_SIGNALS.find(s => s.key === 'cursor');
    assert.ok(sig); assert.equal(sig.weight, 0);
    assert.equal(SIGNAL_LABELS.cursor, 'pointer verdict (cursor)');
    assert.equal(sig.hint, 'ranking weight × verdict level: suspicious 1, highly suspicious 2; the tier is unchanged.');
    assert.equal(sig.count({ cursorAnalysis: { level: 2 } }), 2);
    assert.equal(sig.count({ cursorAnalysis: { level: 1 } }), 1);
    assert.equal(sig.count({ cursorAnalysis: { level: -1 } }), 0);
    assert.equal(sig.count({}), 0);
  });
  it('at 0 leaves the ranking identical; at 1 ranks by level within the tier', () => {
    const { triage: t0 } = analyze([human, scripted, driver]);
    assert.deepEqual(t0.map(t => [t.participantId, t.score]), [['HUMAN', 0], ['SCRIPTED', 0], ['DRIVER', 0]]);
    const { triage: t1 } = analyze([human, scripted, driver], { ...config, scoreWeights: { cursor: 1 } });
    assert.deepEqual(t1.map(t => [t.participantId, t.score]), [['SCRIPTED', 2], ['DRIVER', 2], ['HUMAN', 0]]);
    assert.deepEqual(t1[0].terms.filter(([, n]) => n > 0), [['cursor', 2]]);
  });
  it('formulaText labels the key', () => {
    const { weights } = resolveScoreWeights({ cursor: 1 });
    assert.ok(formulaText(weights).endsWith('1×pointer verdict (cursor)'));
  });
});

describe('the triage reason', () => {
  it('names the verdict and its tells, unscored', () => {
    const { triage } = analyze([driver, scripted]);
    assert.equal(triage.find(t => t.participantId === 'DRIVER').reason, 'pointer verdict: highly suspicious (automation flag)');
    assert.equal(triage.find(t => t.participantId === 'SCRIPTED').reason, 'pointer verdict: highly suspicious (clicks without a path 3/4)');
  });
  it('says nothing for a clean, a not-assessed and a not-recorded session', () => {
    const { triage } = analyze([human, old]);
    for (const t of triage) assert.equal(t.reason, 'clean');
  });
});

describe('summary.csv', () => {
  const COLS = ['cursorReason', 'cursorVerdict', 'cursorTells', 'cursorChecksRecorded', 'cursorFactCount', 'cursorWebdriver', 'cursorUntrustedClicks', 'cursorZeroMoveTrials', 'cursorJumpClicks', 'cursorNoPathClicks', 'cursorCoordinates', 'cursorStream', 'cursorSampleIntervalMs', 'cursorClicks', 'cursorMovements', 'cursorMovesPerTrialMedian', 'cursorEfficiencyMedian', 'cursorMaxDeviationPxMedian', 'cursorCenteredClicks'];
  it('keeps every existing header and appends the nineteen cursor columns in order', () => {
    const { summaries, triage } = analyze([human, driver, scripted, old]);
    const [header, ...rows] = buildSummaryCsv(summaries, triage).trim().split('\n');
    const cols = header.split(',');
    assert.equal(cols.indexOf('meanPathEfficiency') > 0, true);
    assert.deepEqual(cols.slice(-19), COLS);
    const byId = Object.fromEntries(rows.map(r => [r.split(',')[0], r.split(',')]));
    const tail = (id) => byId[id].slice(-19);
    assert.deepEqual(tail('DRIVER').slice(0, 10), ['', 'highly suspicious', 'automation flag', '3', '2', 'YES', '0', '1/2', '1/2', '1/2']);
    assert.deepEqual(tail('SCRIPTED').slice(0, 10), ['', 'highly suspicious', 'clicks without a path 3/4', '3', '0', 'no', '0', '0/4', '3/4', '3/4']);
    assert.deepEqual(tail('HUMAN').slice(0, 3), ['only 2 first pointer clicks (the pointer-pattern tells need 4)', 'not assessed', '']);
    assert.deepEqual(tail('OLD').slice(0, 10), ['device facts and click provenance not recorded (library before 0.14)', 'not assessed', '', '0', '', '', '', '', '0/1', '0/1']);
    assert.equal(tail('HUMAN')[18], '');
  });
  it('a null session has its reason and empty values', () => {
    const { summaries, triage } = analyze([touch]);
    const row = buildSummaryCsv(summaries, triage).trim().split('\n')[1].split(',');
    assert.deepEqual(row.slice(-19).slice(0, 3), ['no cursor stream (touch device)', 'not assessed', '']);
    assert.equal(row.slice(-19)[13], '');
    // Only the automation flag is recorded; the other checks and the rules have no value.
    assert.deepEqual(row.slice(-19).slice(3, 10), ['1', '0', 'no', '', '', '', '']);
  });
});

describe('cursor-limits.json', () => {
  it('carries the CLI version that judged, the version the data was recorded with, every constant with its meaning, and the realised interval', () => {
    const { cursors } = analyze([human]);
    const j = JSON.parse(buildCursorLimitsJson('0.14.0', cursors));
    assert.equal(j.cliVersion, VERSION);
    assert.equal(j.recordedWith, '0.14.0');
    assert.equal(j.limits.minClicksForVerdict.value, 4);
    assert.equal(j.limits.shareSuspicious.value, 0.2);
    assert.equal(j.limits.shareHighlySuspicious.value, 0.5);
    assert.equal(j.limits.discontinuityPx.value, 100);
    assert.ok(j.limits.discontinuityPx.meaning.length > 20);
    assert.equal(typeof j.sampleIntervalMs.core.median, 'number');
  });
  it('records the limits object the results were judged with', () => {
    const custom = { ...CURSOR_LIMITS, discontinuityPx: { value: 50, meaning: CURSOR_LIMITS.discontinuityPx.meaning } };
    // q2's movement starts 70 px from q1's click, 1 s later: a click after
    // a pointer jump at 50 px, not at the default 100 px.
    const near = base('NEAR', [[mv(100, 100, 0), mv(140, 100, 50), ck(140, 100, 60)], [mv(210, 100, 5), mv(215, 100, 50), ck(215, 100, 60)]], desktop);
    const byDefault = analyzeCursor([near]);
    const byCustom = analyzeCursor([near], custom);
    assert.equal(byDefault[0].cursor.rules.jumpClicks.count, 0);
    assert.equal(byCustom[0].cursor.rules.jumpClicks.count, 1);
    assert.deepEqual(JSON.parse(buildCursorLimitsJson('0.14.0', byCustom, custom)).limits, custom);
    assert.deepEqual(JSON.parse(buildCursorLimitsJson('0.14.0', byDefault)).limits, CURSOR_LIMITS);
  });
  it('counts the verdicts', () => {
    const { cursors } = analyze([human, driver, scripted, old, touch]);
    assert.deepEqual(JSON.parse(buildCursorLimitsJson('0.14.0', cursors)).sessions, { total: 5, withDeviceFacts: 4, verdicts: { highlySuspicious: 2, suspicious: 0, clean: 0, notAssessed: 3 } });
  });
});

describe('the HTML report', () => {
  it('renders the verdict, its tells, the details, the tile, the rail cell with its sort attribute, and the sort option', async () => {
    const { summaries, triage } = analyze([human, driver, scripted, old]);
    const html = await renderIndexHtml(summaries, triage, [human, driver, scripted, old], config, false);
    assert.match(html, /<option value="cursor">Pointer verdict/);
    assert.match(html, /data-pid="DRIVER"[\s\S]{0,300}data-cursor="2"/);
    assert.match(html, /data-pid="HUMAN"[\s\S]{0,300}data-cursor="-1"/);
    assert.match(html, /data-pid="OLD"[\s\S]{0,300}data-cursor="-1"/);
    assert.match(html, /<span class="cursor-cell" data-level="2">pointer: highly suspicious<\/span>/);
    assert.match(html, /<span class="cursor-cell" data-level="-1">pointer: not assessed<\/span>/);
    assert.match(html, /Cursor dynamics/);
    // The verdict line and the tells.
    assert.match(html, /<span class="verdict-badge" data-level="2">highly suspicious<\/span> <span class="muted">because of:<\/span>/);
    assert.match(html, /<li class="tell-high">automation flag set by the browser<\/li>/);
    assert.match(html, /<li class="tell-high">clicks that arrived without a path: 3 of 4 first clicks \(75%\) <span class="muted">\(q2, q3, q4\)<\/span><\/li>/);
    assert.match(html, /<span class="verdict-badge" data-level="-1">not assessed<\/span> <span class="muted">only 2 first pointer clicks \(the pointer-pattern tells need 4\)\.<\/span>/);
    // The details, closed, hold the checks, the rules and the shape.
    assert.match(html, /<details class="cursor-details"><summary>every check, the rules and the movement shape<\/summary>/);
    assert.match(html, /automation flag set by the browser<\/th><td>yes/);
    assert.match(html, /trials clicked without pointer movement<\/th><td>1 of 2 \(q2\)/);
    assert.match(html, /clicks that arrived without a path<\/th><td>3 of 4 first clicks \(q2, q3, q4\)/);
    assert.match(html, /clicks after a pointer jump<\/th><td>3 of 4 first clicks \(q2, q3, q4\)/);
    assert.match(html, /median \d+ ms between samples/);
    assert.match(html, /constants: movementGapMs 400, staleGapMs 2000, samePositionPx 20, discontinuityPx 100, minSamplesForShape 2, minClicksForVerdict 4, shareSuspicious 0\.2, shareHighlySuspicious 0\.5 \(cursor-limits\.json\)/);
    assert.match(html, /Pointer verdict<\/span>/);     // the tile label
    assert.match(html, /title="The pointer verdict: 0 clean, 1 suspicious, 2 highly suspicious; — when the session is not assessed \(no device facts, no cursor stream, or too few clicks\)"/);
    assert.match(html, /<div class="signal-tile tone-critical"[^>]*>\s*<span class="signal-value">2<\/span>\s*<span class="signal-label">Pointer verdict/);
    assert.match(html, /keyboard-activated clicks<\/th><td>0 of 2 clicks</);
    assert.match(html, /capped trials<\/th><td>0 of 2 trials</);
  });
  it('a clean session says what it was judged on', async () => {
    const clean = base('CLEAN', [path(0), path(0), path(0), path(0)], desktop);
    clean.trials.forEach((t, i) => { t.startTime = 1000 + i * 5100; });
    const { summaries, triage } = analyze([clean]);
    const html = await renderIndexHtml(summaries, triage, [clean], config, false);
    assert.match(html, /<span class="verdict-badge" data-level="0">clean<\/span> <span class="muted">4 first clicks, none arrived without a path; 4 trials, none clicked without pointer movement; no click the page’s own scripts dispatched; automation flag not set\.<\/span>/);
    assert.match(html, /<span class="cursor-cell" data-level="0">pointer: clean<\/span>/);
    assert.match(html, /<div class="signal-tile tone-zero"[^>]*>\s*<span class="signal-value">0<\/span>\s*<span class="signal-label">Pointer verdict/);
  });
  it('a null session says why and shows no numbers', async () => {
    const { summaries, triage } = analyze([touch]);
    const html = await renderIndexHtml(summaries, triage, [touch], config, false);
    assert.match(html, /no cursor stream \(touch device\)/);
    assert.doesNotMatch(html, /clicks after a pointer jump/);
    assert.match(html, /<span class="verdict-badge" data-level="-1">not assessed<\/span> <span class="muted">no cursor stream \(touch device\)\.<\/span>/);
    assert.doesNotMatch(html, /<details class="cursor-details"/);
    assert.match(html, /data-cursor="-1"/);
    assert.match(html, /<span class="cursor-cell" data-level="-1">pointer: not assessed<\/span>/);
    assert.match(html, /<span class="signal-value">—<\/span>\s*<span class="signal-label">Pointer verdict/);
  });
  it('a null session whose automation flag fired says so in the cell, the tile and the sort attribute', async () => {
    const { summaries, triage } = analyze([touchFlag]);
    const html = await renderIndexHtml(summaries, triage, [touchFlag], config, false);
    assert.match(html, /data-cursor="2"/);
    assert.match(html, /<span class="cursor-cell" data-level="2">pointer: highly suspicious<\/span>/);
    assert.match(html, /<span class="signal-value">2<\/span>\s*<span class="signal-label">Pointer verdict/);
    assert.match(html, /<li class="tell-high">automation flag set by the browser<\/li>/);
    assert.match(html, /<p class="muted note">no cursor stream \(touch device\): the other checks could not run\.<\/p>/);
  });
  it('lists ten trial ids, then "+n more" counted in trials, never in clicks', async () => {
    const eleven = base('ELEVEN', Array.from({ length: 11 }, (_, i) => [ck(100 + i * 150, 300, 20)]), desktop);
    const twoInOne = base('TWOINONE', [[...path(0), ck(260, 160, 300, { trusted: false }), ck(260, 160, 350, { trusted: false })]], desktop);
    const { summaries, triage } = analyze([eleven, twoInOne]);
    const html = await renderIndexHtml(summaries, triage, [eleven, twoInOne], config, false);
    assert.match(html, /trials clicked without pointer movement<\/th><td>11 of 11 \(q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, \+1 more\)</);
    assert.match(html, /clicks the page’s own scripts dispatched<\/th><td>2 of 3 \(q1\)</);
    assert.match(html, /<li class="tell-high">trials clicked without pointer movement: 11 of 11 \(100%\) <span class="muted">\(q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, \+1 more\)<\/span><\/li>/);
  });
  it('links to the replay section, whose wrapper carries the id, unless the replay is shown outside the report', async () => {
    const withReplay = { ...human, replay: { recording: { segments: [] } } };
    const { summaries, triage } = analyze([withReplay]);
    const html = await renderIndexHtml(summaries, triage, [withReplay], config, false);
    assert.match(html, /<a href="#replay-HUMAN">open the replay<\/a>/);
    assert.match(html, /<div class="image-block replay-block" id="replay-HUMAN"/);
    assert.doesNotMatch(html, /replay card/);
    const outside = await renderIndexHtml(summaries, triage, [withReplay], config, false, { replayShownExternally: true });
    assert.match(outside, /<p class="muted note">The replay card beside this report shows this session\.<\/p><\/div>/);
    assert.doesNotMatch(outside, /open the replay/);
  });
  it('without a recording, points to no replay, in the report or outside it', async () => {
    const { summaries, triage } = analyze([human]);
    const html = await renderIndexHtml(summaries, triage, [human], config, false);
    const outside = await renderIndexHtml(summaries, triage, [human], config, false, { replayShownExternally: true });
    for (const page of [html, outside]) {
      assert.match(page, /Cursor dynamics/);
      assert.doesNotMatch(page, /open the replay|replay card beside/);
    }
  });
  it('prints the constants the analysis judged with, not the defaults', async () => {
    const custom = { ...CURSOR_LIMITS, discontinuityPx: { value: 50, meaning: CURSOR_LIMITS.discontinuityPx.meaning } };
    const summaries = computeSummary([human], config);
    summaries[0].cursorAnalysis = analyzeCursor([human], custom)[0];
    const triage = rankTriage(summaries, detectEdgeExits([human], config), config);
    const html = await renderIndexHtml(summaries, triage, [human], config, false);
    assert.match(html, /constants: movementGapMs 400, staleGapMs 2000, samePositionPx 20, discontinuityPx 50, minSamplesForShape 2, minClicksForVerdict 4, shareSuspicious 0\.2, shareHighlySuspicious 0\.5 \(cursor-limits\.json\)/);
  });
  it('the tile of a session recorded before 0.14 reads "—" in the tone-zero style', async () => {
    // The demo fixture: 0.7.2 data with a mouse track and no device facts.
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'demo', 'DEMO-FIXT.json'), 'utf8'));
    const fixt = extractIntegrityData(raw, config);
    const { summaries, triage } = analyze([fixt]);
    assert.equal(summaries[0].cursorAnalysis.checksRecorded, 0);
    const html = await renderIndexHtml(summaries, triage, [fixt], config, false);
    assert.match(html, /<div class="signal-tile tone-zero"\s*role="listitem"\s*title="The pointer verdict: 0 clean, 1 suspicious, 2 highly suspicious; — when the session is not assessed \(no device facts, no cursor stream, or too few clicks\)">\s*<span class="signal-value">—<\/span>\s*<span class="signal-label">Pointer verdict/);
    // The rest of the grid still reads counts (the fixture pasted twice).
    assert.match(html, /<span class="signal-value">2<\/span>\s*<span class="signal-label">Paste/);
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
    assert.ok(logs.includes('  Pointer verdicts: 0 highly suspicious, 0 suspicious, 0 clean, 2 not assessed (2 sessions; 1 recorded without device facts)'), logs.join('\n'));
    assert.ok(warns.includes('[cyborg-hunter] scoreWeights.cursor is 1; 1 of 2 sessions carry device facts (the rest were recorded before 0.14): the weight ranks only those.'), warns.join('\n'));
  });
  it('the run line counts the verdicts and the sessions recorded without device facts', async () => {
    // HUMAN and DRIVER have a stream and device facts: HUMAN is not assessed
    // (two first clicks), DRIVER highly suspicious (its automation flag); OLD
    // has neither device facts nor provenance (not assessed); TOUCH and
    // TOUCHFLAG have device facts and no cursor stream: TOUCH is not
    // assessed, and TOUCHFLAG's automation flag makes it highly suspicious.
    const logs = []; const warns = []; const files = {};
    const built = await buildReport([human, driver, old, touch, touchFlag], { ...config, scoreWeights: { cursor: 1 } }, {
      sink: (p, body) => { files[p] = body; }, log: (l) => logs.push(l), warn: (w) => warns.push(w)
    });
    const line = 'Pointer verdicts: 2 highly suspicious, 0 suspicious, 0 clean, 3 not assessed (5 sessions; 1 recorded without device facts)';
    assert.equal(built.cursorLine, line);
    assert.ok(logs.includes('  ' + line), logs.join('\n'));
    assert.ok(warns.includes('[cyborg-hunter] scoreWeights.cursor is 1; 4 of 5 sessions carry device facts (the rest were recorded before 0.14): the weight ranks only those.'), warns.join('\n'));
    // The file counts what the line counts.
    assert.deepEqual(JSON.parse(files['cursor-limits.json']).sessions, { total: 5, withDeviceFacts: 4, verdicts: { highlySuspicious: 2, suspicious: 0, clean: 0, notAssessed: 3 } });
  });
  it('no warning when every session carries device facts, or at weight 0', async () => {
    const warnsOf = async (participants, cfg) => {
      const warns = [];
      await buildReport(participants, cfg, { sink: () => {}, warn: (w) => warns.push(w) });
      return warns.filter(w => /scoreWeights\.cursor/.test(w));
    };
    assert.deepEqual(await warnsOf([human, driver, touchFlag], { ...config, scoreWeights: { cursor: 1 } }), []);
    assert.deepEqual(await warnsOf([human, old], config), []);
  });
  it('cursor-limits.json names every library version the data carries, in version order', async () => {
    const at = (p, version) => ({ ...p, trials: p.trials.map(t => ({ ...t, libraryVersion: version })) });
    const recordedWith = async (participants) => {
      const files = {};
      await buildReport(participants, config, { sink: (p, body) => { files[p] = body; } });
      return JSON.parse(files['cursor-limits.json']).recordedWith;
    };
    assert.equal(await recordedWith([human, at(old, '0.6.1'), at(driver, '0.14.0')]), '0.6.1, 0.14.0');
    assert.equal(await recordedWith([human]), '0.14.0');
    assert.equal(await recordedWith([at(human, undefined)]), null);
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
