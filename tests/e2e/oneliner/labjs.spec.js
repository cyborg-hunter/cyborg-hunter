// tests/e2e/oneliner/labjs.spec.js
// The one-line setup (dist/ch.js) on real lab.js in Chromium: a study in the
// shape the builder exports (lib/lab.js, the tag, a deferred study script).
// Each spec drives the fixture, takes what the study itself saves
// (datastore.exportCsv() and exportJson(), kept on window, or the Transmit
// plugin's uploads), runs the CLI on it and asserts the counts. Expected rows
// and trial ids come from the fixtures' header comments. Paste verdicts use
// the standard preset's hard paste threshold, 2 (src/shared/constants.js).
//
// Rows: ch.js writes its id into every trial row as cyborgHunterParticipantId
// and never writes participantId there; row 0 alone gets participantId, and
// only when the study sets none (the CLI keys lab.js data by it).
import { test, expect, collectConsole, pasteInto, parseCsv, newTmpDir, cleanupTmpDirs, saveAndReport, rewriteFixture } from './support.mjs';
import { MESSAGES } from '../../../src/oneliner/errors.js';
import { ingest } from '../../../src/cli/ingest.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIX = '/tests/e2e/oneliner/fixtures/';
test.afterAll(() => cleanupTmpDirs());

function chErrors(log) { return log.error.filter((t) => t.startsWith('[cyborg-hunter]')); }
function chWarnings(log) { return log.warn.filter((t) => t.startsWith('[cyborg-hunter]')); }
function json(cell) { return cell ? JSON.parse(cell) : null; }
function trialRows(rows) { return rows.filter((r) => r.integritySegment && r.integritySegment !== ''); }
function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// labjs-full.html: Start, three forms (paste into the first `pastes` times),
// the timed canvas and frame, the final form, then on('end') saves and the
// root row commits (on('epilogue') keeps all rows).
async function driveFull(page, { pastes = 0 } = {}) {
  await page.goto(FIX + 'labjs-full.html');
  await page.click('#start');
  for (let i = 0; i < 3; i++) {
    await page.getByText('Q' + (i + 1)).waitFor();
    if (i === 0) for (let k = 0; k < pastes; k++) await pasteInto(page, '#answer', 'pasted text ');
    await page.locator('#answer').pressSequentially('typed ' + i, { delay: 60 });
    await page.click('#next');
  }
  await page.getByText('Final').waitFor();
  await page.locator('#final').pressSequentially('done', { delay: 60 });
  await page.click('#finish');
  await page.waitForFunction(() => typeof window.__csvAll === 'string');
  return page.evaluate(() => ({
    csv: window.__csv,
    jsonText: window.__json,
    rowsAtEnd: window.__rowsAtEnd,
    csvAll: window.__csvAll,
    rowsAll: window.__rowsAll
  }));
}

test('lab.js 20.2.4: every leaf is a trial, the final fields sit on the last trial row and the root row, the CLI reads the CSV and the JSON', async ({ page }) => {
  const log = collectConsole(page);
  const { csv, jsonText, rowsAtEnd, csvAll, rowsAll } = await driveFull(page, { pastes: 2 });
  expect(chErrors(log)).toEqual([]);
  expect(chWarnings(log)).toEqual([]);
  expect(log.info).toContain('Cyborg Hunter active · lab.js 20.2.4 detected · trials counted as they run · ID from data-participant-id · honeypot on · friction off');

  const rows = parseCsv(csv);
  expect(rowsAtEnd).toBe(10);   // the root row commits after on('end')
  expect(rows.map((r) => r.sender)).toEqual(['intro', 'question', 'question', 'question', 'block', 'shapes', 'inner', 'framed', 'final', 'bye']);
  const trials = trialRows(rows);
  expect(trials.map((r) => json(r.integritySegment).trialId)).toEqual(['0', '1_0', '1_1', '1_2', '2', '3_0', 'final-q']);
  expect(trials.map((r) => json(r.integritySegment).segmentIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  for (const r of trials) {
    expect(r.cyborgHunterParticipantId).toBe('E2E-LAB-1');
    expect(r.cyborgHunterError ?? '').toBe('');
    expect(json(r.integrity).trialId).toBe(json(r.integritySegment).trialId);
  }
  // The id on row 0 (the study sets none), no other row.
  expect(rows.map((r) => r.participantId ?? '')).toEqual(['E2E-LAB-1', '', '', '', '', '', '', '', '', '']);
  for (const s of ['block', 'framed', 'bye']) expect(rows.find((r) => r.sender === s).integritySegment ?? '').toBe('');
  expect(json(trials[1].integrity).pasteEvents).toHaveLength(2);
  const last = trials[6];
  expect(json(last.integritySegmentFinal).segmentIndex).toBe(7);
  expect(Number(last.integrityPasteCountFinal)).toBe(2);
  expect(String(last.ai_use_session)).toBe('false');   // the honeypot summary rides on the same row

  // After the root's commit: the same final fields on the root row too.
  const all = parseCsv(csvAll);
  expect(rowsAll).toBe(11);
  expect(all.map((r) => r.sender)).toEqual(rows.map((r) => r.sender).concat('root'));
  const root = all[10];
  expect(json(root.integritySegmentFinal)).toEqual(json(last.integritySegmentFinal));
  expect(Number(root.integrityPasteCountFinal)).toBe(2);
  expect(root.integritySegment ?? '').toBe('');

  const csvOut = saveAndReport(newTmpDir('lab-csv'), 'E2E-LAB-1.csv', csv);
  expect(csvOut.stdout).toContain('Found 1 participants');
  expect(csvOut.stdout).not.toContain('files had warnings');
  expect(csvOut.summaryCsv[0].participantId).toBe('E2E-LAB-1');
  expect(csvOut.summaryCsv[0].totalPasteEvents).toBe('2');
  expect(csvOut.summaryCsv[0].hardTriggered).toBe('YES');

  // exportJson(): a top-level array of the same rows (the JATOS export's payload).
  const jsonOut = saveAndReport(newTmpDir('lab-json'), 'E2E-LAB-1.json', jsonText);
  expect(jsonOut.stdout).toContain('Found 1 participants');
  expect(jsonOut.stdout).not.toContain('files had warnings');
  expect(jsonOut.summaryCsv[0].participantId).toBe('E2E-LAB-1');
  expect(jsonOut.summaryCsv[0].totalPasteEvents).toBe('2');

  // All 11 rows: the final segment appears twice and is read once.
  const allOut = saveAndReport(newTmpDir('lab-csv-all'), 'E2E-LAB-1.csv', csvAll);
  expect(allOut.stdout).toContain('Found 1 participants');
  expect(allOut.stdout).not.toContain('files had warnings');
  expect(allOut.summaryCsv).toEqual(csvOut.summaryCsv);
});

test('lab.js 20.2.4: a clean run is not flagged', async ({ page }) => {
  const { csv } = await driveFull(page);
  const out = saveAndReport(newTmpDir('lab-clean'), 'E2E-LAB-1.csv', csv);
  expect(out.summaryCsv[0].totalPasteEvents).toBe('0');
  expect(out.summaryCsv[0].hardTriggered).toBe('no');
});

test('lab.js Transmit plugin: the incremental slices and the full upload carry the rows; the CLI reads the full upload and warns on a slice', async ({ page }) => {
  const bodies = [];
  await page.route('**/__transmit', async (route) => {
    bodies.push(JSON.parse(route.request().postData()));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await rewriteFixture(page, '**/labjs-full.html', (html) =>
    html.replace('<script defer src="/tests/e2e/oneliner/fixtures/labjs-full.study.js">', '<script defer src="/tests/e2e/oneliner/fixtures/labjs-full.study.js" data-transmit="/__transmit">'));
  const log = collectConsole(page);
  await driveFull(page, { pastes: 2 });
  expect(chErrors(log)).toEqual([]);

  const full = () => bodies.filter((b) => b.metadata.payload === 'full');
  const slices = () => bodies.filter((b) => b.metadata.payload === 'incremental');
  const sliceRows = () => slices().reduce((n, b) => n + b.data.length, 0);
  await expect.poll(() => full().length).toBe(1);
  await expect.poll(sliceRows).toBe(11);

  // The full upload: all 11 rows, the final fields on the last trial row and the root row.
  const rows = full()[0].data;
  expect(rows.map((r) => r.sender)).toEqual(['intro', 'question', 'question', 'question', 'block', 'shapes', 'inner', 'framed', 'final', 'bye', 'root']);
  expect(rows[8].integritySegmentFinal.segmentIndex).toBe(7);
  expect(rows[9].integritySegmentFinal).toBeUndefined();
  expect(rows[10].integritySegmentFinal.segmentIndex).toBe(7);
  // The slices, in order, hold the same rows once each; the root row,
  // with the final fields, arrives in the last slice.
  const ordered = slices().sort((a, b) => a.metadata.slice - b.metadata.slice);
  expect(ordered.flatMap((b) => b.data.map((r) => r.sender))).toEqual(rows.map((r) => r.sender));
  const lastSlice = ordered[ordered.length - 1].data;
  expect(lastSlice[lastSlice.length - 1].sender).toBe('root');
  expect(lastSlice[lastSlice.length - 1].integritySegmentFinal.segmentIndex).toBe(7);

  const fullOut = saveAndReport(newTmpDir('lab-transmit-full'), 'E2E-LAB-1.json', JSON.stringify(full()[0]));
  expect(fullOut.stdout).toContain('Found 1 participants');
  expect(fullOut.stdout).not.toContain('files had warnings');
  expect(fullOut.summaryCsv[0].participantId).toBe('E2E-LAB-1');
  expect(fullOut.summaryCsv[0].totalPasteEvents).toBe('2');
  expect(fullOut.summaryCsv[0].hardTriggered).toBe('YES');

  // A slice saved on its own is read, with the CLI's warning.
  const sliceOut = saveAndReport(newTmpDir('lab-transmit-slice'), 'E2E-LAB-1.json', JSON.stringify(ordered[0]));
  expect(sliceOut.stdout).toContain('Found 1 participants (1 files had warnings)');
});

test('lab.js 23 alpha: not hooked yet, one warning, and the page runs as a page without jsPsych', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'labjs-23.html');
  await page.click('#start');
  for (let i = 0; i < 3; i++) {
    await page.getByText('Q' + (i + 1)).waitFor();
    if (i === 1) await pasteInto(page, '#answer', 'pasted text');
    await page.locator('#answer').pressSequentially('typed', { delay: 60 });
    await page.click('#next');
  }
  await page.getByText('Final').waitFor();
  await page.click('#finish');
  await page.waitForFunction(() => typeof window.__csv === 'string');
  expect(chErrors(log)).toEqual([]);   // no placement error: lab.js is there, just not hooked
  expect(chWarnings(log)).toEqual([MESSAGES.labjsVersionUnsupported('23.0.0-alpha9')]);
  const rows = parseCsv(await page.evaluate(() => window.__csv));
  expect(rows.length).toBeGreaterThan(0);
  expect(trialRows(rows)).toEqual([]);
  expect(rows.some((r) => 'cyborgHunterParticipantId' in r)).toBe(false);
  const data = await page.evaluate(() => window.CyborgHunter.data());
  expect(data.cyborgHunterOneLiner.host).toBe('vanilla');
  expect(data.trials.reduce((n, t) => n + t.integrity.pasteEvents.length, 0)).toBe(1);
});

test('data-replay on lab.js: the recorder follows the trials; the canvas is a sized node in the recording; the study\'s own participantId is kept', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'labjs-replay.html');
  await page.click('#start');
  await page.getByText('Final').waitFor();
  await page.click('#finish');
  await page.waitForFunction(() => typeof window.__csv === 'string');
  expect(chErrors(log)).toEqual([]);
  const replay = await page.evaluate(() => window.__replay);
  expect(replay).not.toBeNull();
  expect(replay.schema_version).toBe(2);
  expect(replay.participant_id).toBe('E2E-LAB-3');
  const labels = replay.segments.map((s) => s.label).filter((l) => l && !/^(span|gap)-/.test(l));
  expect(labels).toEqual(['0', '1', 'final-q']);
  // The recorder records the canvas element and its bitmap size, not its drawing.
  expect(JSON.stringify(replay)).toContain('"canvas_size"');

  const csv = await page.evaluate(() => window.__csv);
  const rows = parseCsv(csv);
  expect(trialRows(rows)).toHaveLength(3);
  // The study's participantId stays on its row and in lab.js's state.
  expect(rows[0].participantId).toBe('RES-3');
  expect(rows.every((r) => (r.participantId ?? '') === '' || r.participantId === 'RES-3')).toBe(true);
  expect(trialRows(rows).map((r) => r.cyborgHunterParticipantId)).toEqual(['E2E-LAB-3', 'E2E-LAB-3', 'E2E-LAB-3']);
  expect(await page.evaluate(() => window.study.options.datastore.state.participantId)).toBe('RES-3');
  // The recording, saved under the study's id, carries ch.js's: the CLI
  // attaches it through the participant's cyborgHunterParticipantId.
  const tmp = newTmpDir('lab-replay');
  mkdirSync(join(tmp, 'data'), { recursive: true });
  writeFileSync(join(tmp, 'data', 'RES-3-replay-1751600000000.json'), JSON.stringify(replay));
  const out = saveAndReport(tmp, 'RES-3.csv', csv);
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('had warnings');
  expect(out.summaryCsv[0].participantId).toBe('RES-3');
  const { participants, warnings } = await ingest({ dataDir: join(tmp, 'data'), filePattern: '*.{json,csv}', participantIdField: 'participantId', integrityField: 'integrity' });
  expect(warnings).toEqual([]);
  expect(participants.map((p) => p.participantId)).toEqual(['RES-3']);
  expect(participants[0].metadata.cyborgHunterParticipantId).toBe('E2E-LAB-3');
  expect(participants[0].replay.recording.participant_id).toBe('E2E-LAB-3');
});

test('perf: the per-trial write stays within budget over 60 lab.js trials, and the rows stay far below the storage quota', async ({ page }) => {
  await page.goto(FIX + 'labjs-perf.html');
  await page.waitForFunction(() => typeof window.__csv === 'string', null, { timeout: 30000 });
  expect(trialRows(parseCsv(await page.evaluate(() => window.__csv)))).toHaveLength(60);
  const ms = await page.evaluate(() => window.__cyborgHunterDebug.stats().segmentWriteMs.slice());
  expect(ms.length).toBeGreaterThanOrEqual(60);
  const med = median(ms), max = Math.max(...ms);
  test.info().annotations.push({ type: 'segmentWriteMs', description: 'median ' + med.toFixed(2) + ' ms, max ' + max.toFixed(2) + ' ms, n ' + ms.length });
  console.log('segmentWriteMs (lab.js): median ' + med.toFixed(2) + ' ms, max ' + max.toFixed(2) + ' ms, n ' + ms.length);
  expect(med).toBeLessThanOrEqual(5);
  expect(max).toBeLessThanOrEqual(20);

  // A Store with persistence writes JSON.stringify(data) to storage on every
  // commit, without a try; a browser allows about 5 MB per origin.
  const bytes = await page.evaluate(() => window.__rowsJsonLength);
  const perTrial = bytes / 60;
  test.info().annotations.push({ type: 'rowsJson', description: bytes + ' chars for 60 trials, ' + Math.round(perTrial) + ' per trial' });
  console.log('rows as JSON (lab.js): ' + bytes + ' chars for 60 trials, ' + Math.round(perTrial) + ' per trial');
  expect(bytes).toBeLessThan(500 * 1024);
});

test('ch.js above lib/lab.js: loud error with fix + link, vanilla mode still records', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'labjs-not-hookable.html');
  await page.click('#start');
  await page.getByText('Q1').waitFor();
  await page.locator('#answer').waitFor();
  await pasteInto(page, '#answer', 'pasted text');
  await expect.poll(() => chErrors(log)).toEqual([MESSAGES.loadedAboveLabJs()]);
  const data = await page.evaluate(() => window.CyborgHunter.data());
  expect(data.cyborgHunterOneLiner.host).toBe('vanilla');
  expect(data.trials.reduce((n, t) => n + t.integrity.pasteEvents.length, 0)).toBe(1);
});

test('a page with data-labjs-section and no window.lab: one labjsNotHookable error', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'labjs-bundled.html');
  await expect.poll(() => chErrors(log)).toEqual([MESSAGES.labjsNotHookable()]);
  expect(await page.evaluate(() => window.CyborgHunter.data().cyborgHunterOneLiner.host)).toBe('vanilla');
});
