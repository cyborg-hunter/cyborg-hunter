// tests/e2e/oneliner/replay.spec.js
// data-replay in Chromium: cyborg-hunter-replay.js loaded lazily from next to
// dist/ch.js on the jsPsych host (the vanilla host's recording is checked in
// vanilla.spec.js), and a data-replay-src that 404s on both hosts. A failed
// load is a catalogue error (MESSAGES.replayUnavailable) and the experiment
// carries on without replay. The 404 variants serve the same fixtures with
// data-replay-src added to the ch.js tag (rewriteFixture).

import { test, expect, collectConsole, pasteInto, parseCsv, newTmpDir, cleanupTmpDirs, saveAndReport, rewriteFixture } from './support.mjs';
import { MESSAGES } from '../../../src/oneliner/errors.js';

const FIX = '/tests/e2e/oneliner/fixtures/';
const MISSING = '/tests/e2e/oneliner/fixtures/missing/cyborg-hunter-replay.js';

test.afterAll(() => cleanupTmpDirs());

function chErrors(log) { return log.error.filter((t) => t.startsWith('[cyborg-hunter]')); }
function json(cell) { return cell ? JSON.parse(cell) : null; }

// The catalogue message around its cause: the cause names the missing URL.
function expectReplayUnavailable(text, src) {
  const [head, tail] = MESSAGES.replayUnavailable('\u0000').split('\u0000');
  expect(text.startsWith(head), text).toBe(true);
  expect(text.endsWith(tail), text).toBe(true);
  expect(text).toContain(src);
}

// On the ch.js tag itself (the header comments mention data-replay too).
function addReplaySrc(html) {
  return html.replace('<script src="/dist/ch.js"', '<script src="/dist/ch.js" data-replay-src="' + MISSING + '"');
}

async function driveJsPsychReplay(page) {
  await page.goto(FIX + 'jspsych-replay.html');
  await page.locator('button.jspsych-btn', { hasText: 'Start' }).click();
  await page.getByText('Replay question').waitFor();
  await pasteInto(page, '#input-0', 'pasted text');
  await page.locator('#input-0').pressSequentially(' typed', { delay: 120 });
  await page.click('#jspsych-survey-text-next');
  await page.locator('button.jspsych-btn', { hasText: 'Finish' }).click();
  await page.waitForFunction(() => typeof window.__csv === 'string');
  return {
    rows: parseCsv(await page.evaluate(() => window.__csv)),
    csv: await page.evaluate(() => window.__csv),
    replay: await page.evaluate(() => window.__replay)
  };
}

test('jsPsych + data-replay: the recorder loads from next to ch.js and CyborgHunter.replay() returns a recording with events', async ({ page }) => {
  const log = collectConsole(page);
  const replayRequests = [];
  page.on('request', (r) => { if (r.url().endsWith('/cyborg-hunter-replay.js')) replayRequests.push(new URL(r.url()).pathname); });
  const { rows, csv, replay } = await driveJsPsychReplay(page);

  expect(replayRequests).toEqual(['/dist/cyborg-hunter-replay.js']);
  expect(replay).not.toBeNull();
  expect(replay.schema_version).toBe(2);
  expect(replay.participant_id).toBe('E2E-RP-1');
  // The one-liner's own save reminder (no data-debug here), once; the
  // recorder's autoSave warning, which names getRecording(), is silenced.
  expect(log.info.filter((t) => t === MESSAGES.replaySaveReminder())).toHaveLength(1);
  expect(log.warn.filter((t) => t.includes('autoSave.mode is "none"'))).toEqual([]);
  expect(replay.segments).toHaveLength(3);   // one per trial
  expect(replay.segments.reduce((n, s) => n + s.events.length, 0)).toBeGreaterThan(0);
  expect(chErrors(log)).toEqual([]);

  expect(rows).toHaveLength(3);
  for (const r of rows) expect(json(r.integritySegment)).not.toBeNull();
  const out = saveAndReport(newTmpDir('replay-js'), 'E2E-RP-1.csv', csv);
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].totalPasteEvents).toBe('1');
});

test('jsPsych + data-replay-src that 404s: catalogue error, the experiment still completes with its segments', async ({ page }) => {
  await rewriteFixture(page, '**/jspsych-replay.html', addReplaySrc);
  const log = collectConsole(page);
  const { rows, csv, replay } = await driveJsPsychReplay(page);

  const errors = chErrors(log);
  expect(errors).toHaveLength(1);
  expectReplayUnavailable(errors[0], MISSING);
  expect(replay).toBeNull();

  expect(rows).toHaveLength(3);
  for (const r of rows) {
    expect(json(r.integritySegment)).not.toBeNull();
    expect(r.cyborgHunterError || '').toBe('');
  }
  const out = saveAndReport(newTmpDir('replay-js-404'), 'E2E-RP-1.csv', csv);
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].totalPasteEvents).toBe('1');
});

test('vanilla + data-replay-src that 404s: catalogue error, marks and the custom save still work', async ({ page }) => {
  await rewriteFixture(page, '**/vanilla-marks-fetch.html', addReplaySrc);
  const log = collectConsole(page);
  let saved = null;
  await page.route('**/save', async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  await page.goto(FIX + 'vanilla-marks-fetch.html');
  await expect.poll(() => chErrors(log).length).toBe(1);
  expectReplayUnavailable(chErrors(log)[0], MISSING);

  for (const id of ['q1', 'q2', 'q3']) await page.click('[data-ch-trial="' + id + '"]');
  await page.click('#finish');
  await page.waitForFunction(() => window.__saved === true);

  expect(saved.replay).toBeNull();
  expect(saved.data.trials.map((t) => t.trialId)).toEqual(['span-0', 'q1', 'q2', 'q3']);
  expect(chErrors(log)).toHaveLength(1);
  const out = saveAndReport(newTmpDir('replay-van-404'), 'E2E-VAN-2.json', JSON.stringify(saved.data));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
});
