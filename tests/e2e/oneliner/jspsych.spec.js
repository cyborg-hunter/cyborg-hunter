// tests/e2e/oneliner/jspsych.spec.js
// The one-line setup (dist/ch.js) on real jsPsych 7.3.1 in Chromium. Each
// spec drives a fixture experiment (fixtures/*.html), takes the file the
// experiment itself saves (jsPsych.data.get().csv(), or a DataPipe-style save
// trial's data_string), runs the CLI on it and asserts the counts.
//
// Expected counts come from the fixtures (their header comments list every
// trial object and row), not from the implementation:
//   - the console summary (data-debug) counts PLANNED trial objects: the walk
//     of the timeline, once, before any row exists;
//   - the badge and the rows count what was written (a loop or
//     timeline_variables repeat one trial object).
// Paste verdicts use the standard preset's hard paste threshold, 2
// (src/shared/constants.js): one paste is soft, two are a hard trigger.

import { test, expect, collectConsole, installFullscreenMock, pasteInto, parseCsv, newTmpDir, cleanupTmpDirs, saveAndReport } from './support.mjs';

const FIX = '/tests/e2e/oneliner/fixtures/';

test.afterAll(() => cleanupTmpDirs());
const SUMMARY_RE = /Cyborg Hunter active · jsPsych detected · (\d+) trials instrumented · ID from data-participant-id · honeypot on · friction off$/;

// jsPsych's CSV writes object cells as JSON.
function json(cell) { return cell ? JSON.parse(cell) : null; }
function rowsWithSegment(rows) { return rows.filter((r) => r.integritySegment && r.integritySegment !== ''); }
function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
async function rowCount(page) { return page.evaluate(() => window.jsPsych.data.get().count()); }
async function waitRows(page, n) {
  await page.waitForFunction((k) => window.jsPsych.data.get().count() >= k, n);
}

// jspsych-full.html: start, 60 timed keyboard rows, q-cond, two loop rows,
// q-final, then the experiment's on_finish saves window.__csv.
// `pasteCond` / `pasteFinal`: paste "pasted text" into that survey trial.
async function driveFull(page, opts = {}) {
  await page.goto(FIX + 'jspsych-full.html');
  await page.locator('button.jspsych-btn', { hasText: 'Start' }).click();
  await waitRows(page, 1);
  // Mid-run (a timed keyboard trial is on screen): the injected honeypot
  // extension has run its initialize(), so the bait is in the page.
  const guardsMidRun = await page.evaluate(() => ({
    bait: !!document.getElementById('fg-honeypot'),
    meta: !!document.querySelector('meta[name="ai-honeypot"]'),
    frictionActive: window.GuardFriction.getCurrentState().active,
  }));

  await page.getByText('Conditional question').waitFor();
  if (opts.pasteCond) await pasteInto(page, '#input-0', 'pasted text');
  await page.locator('#input-0').pressSequentially('typed answer', { delay: 120 });
  await page.click('#jspsych-survey-text-next');
  await waitRows(page, 62);

  for (const n of [63, 64]) {
    await page.locator('button.jspsych-btn', { hasText: 'Next' }).click();
    await waitRows(page, n);
  }

  await page.getByText('Final question').waitFor();
  if (opts.pasteFinal) await pasteInto(page, '#input-0', 'pasted text');
  await page.locator('#input-0').pressSequentially(' and more', { delay: 120 });
  await page.click('#jspsych-survey-text-next');
  await page.waitForFunction(() => typeof window.__csv === 'string');

  const csv = await page.evaluate(() => window.__csv);
  // null when the badge is not in the document.
  const badge = await page.evaluate(() => {
    const el = document.getElementById('ch-debug-badge');
    return el ? el.textContent : null;
  });
  return { csv, badge, guardsMidRun };
}

test('full timeline: every trial instrumented, segments on every row, final segment, CLI counts match', async ({ page }) => {
  const log = collectConsole(page);
  const { csv, badge, guardsMidRun } = await driveFull(page, { pasteFinal: true });

  // Console summary: one line per page, the PLANNED count = 5 unique trial
  // objects (instructions, the keyboard trial, q-cond, loop-trial, q-final).
  const summaries = log.info.filter((t) => t.startsWith('Cyborg Hunter active'));
  expect(summaries).toHaveLength(1);
  const m = summaries[0].match(SUMMARY_RE);
  expect(m, summaries[0]).not.toBeNull();
  expect(Number(m[1])).toBe(5);

  // Rows: 1 + 60 + 1 + 2 + 1 = 65, every one with a segment.
  const rows = parseCsv(csv);
  expect(rows).toHaveLength(65);
  const withSeg = rowsWithSegment(rows);
  expect(withSeg).toHaveLength(65);
  for (const r of rows) {
    expect(json(r.integritySegment)).not.toBeNull();
    expect(r).toHaveProperty('integrityPasteCount');
    expect(r.cyborgHunterError || '').toBe('');
  }
  expect(json(rows[rows.length - 1].integritySegmentFinal)).not.toBeNull();
  // Running totals never decrease.
  for (let k = 0; k + 1 < rows.length; k++) {
    expect(Number(rows[k].integritySoftScore)).toBeLessThanOrEqual(Number(rows[k + 1].integritySoftScore));
  }
  // The paste landed on q-final's own row.
  const qFinal = rows.find((r) => r.name === 'q-final');
  expect(json(qFinal.integrity).pasteEvents).toHaveLength(1);
  expect(qFinal.integrityPasteCount).toBe('1');
  expect(qFinal.integrityPasteCountFinal).toBe('1');
  expect(qFinal.integrityAnyHardTriggeredFinal).toBe('false');

  // Badge: rows written vs planned, the same 65 the CSV has. (Soft, so the
  // CLI half below still runs and reports when the badge alone is wrong.)
  expect.soft(badge).toBe('Cyborg Hunter active · jsPsych detected · ' + withSeg.length +
    ' trials (5 planned) · ID from data-participant-id · honeypot on · friction off');

  // Guards once the timeline runs: honeypot on (default), friction off.
  expect(guardsMidRun).toEqual({ bait: true, meta: true, frictionActive: false });

  // The saved file through the CLI.
  const out = saveAndReport(newTmpDir('full'), 'E2E-JS-1.csv', csv);
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv).toHaveLength(1);
  const s = out.summaryCsv[0];
  expect(s.participantId).toBe('E2E-JS-1');
  expect(s.totalPasteEvents).toBe('1');
  expect(s.hardTriggered).toBe('no');          // 1 paste < standard threshold 2
  expect(s.honeypot_ai_use).toBe('no');        // honeypot ran, box unticked
  expect(out.triage).toContain('E2E-JS-1');
  expect(out.triage).not.toContain('**HARD**');
});

test('two pastes cross the standard hard threshold (2): in-page final verdict and CLI tier agree', async ({ page }) => {
  const { csv } = await driveFull(page, { pasteCond: true, pasteFinal: true });
  const rows = parseCsv(csv);
  const last = rows[rows.length - 1];
  expect(last.integrityPasteCountFinal).toBe('2');
  expect(last.integrityAnyHardTriggeredFinal).toBe('true');

  const out = saveAndReport(newTmpDir('hard'), 'E2E-JS-1.csv', csv);
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].totalPasteEvents).toBe('2');
  expect(out.summaryCsv[0].hardTriggered).toBe('YES');
  expect(out.triage).toMatch(/\| E2E-JS-1 \| \*\*HARD\*\* \|/);
});

test('perf: segment write stays within budget', async ({ page }) => {
  await driveFull(page);
  const ms = await page.evaluate(() => window.__cyborgHunterDebug.stats().segmentWriteMs.slice());
  expect(ms.length).toBeGreaterThanOrEqual(60);
  const med = median(ms), max = Math.max(...ms);
  test.info().annotations.push({ type: 'segmentWriteMs', description: 'median ' + med.toFixed(2) + ' ms, max ' + max.toFixed(2) + ' ms, n ' + ms.length });
  console.log('segmentWriteMs: median ' + med.toFixed(2) + ' ms, max ' + max.toFixed(2) + ' ms, n ' + ms.length);
  expect(med).toBeLessThanOrEqual(5);
  expect(max).toBeLessThanOrEqual(20);
});

async function clickButton(page, text) {
  await page.locator('button.jspsych-btn', { hasText: text }).click();
}
function namesOf(trial) { return (trial.extensions || []).map((e) => e.type.info.name); }

test('shared trial object + own extensions: injected once, both rows carry segments, the mouse-tracking row keeps its data', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'jspsych-shared-and-own-extensions.html');
  await clickButton(page, 'Shared');
  await waitRows(page, 1);
  await clickButton(page, 'Shared');
  await waitRows(page, 2);
  await page.getByText('Mouse-tracked trial').waitFor();
  const box = await page.locator('#tracked-target').boundingBox();
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, { steps: 10 });
  await clickButton(page, 'Tracked');
  await waitRows(page, 3);
  await clickButton(page, 'Finish');
  await page.waitForFunction(() => typeof window.__csv === 'string');

  // The walk: the shared object got our entries once; the tracked trial
  // keeps its own extension first.
  const ext = await page.evaluate(() => {
    const out = {};
    for (const [k, t] of Object.entries(window.__trials)) out[k] = (t.extensions || []).map((e) => e.type.info.name);
    return out;
  });
  expect(ext.shared).toEqual(['cyborg-hunter', 'guard-honeypot']);
  expect(ext.tracked).toEqual(['mouse-tracking', 'cyborg-hunter', 'guard-honeypot']);
  expect(ext.after).toEqual(['cyborg-hunter', 'guard-honeypot']);

  // Planned: 3 unique trial objects; written: 4 rows.
  const summaries = log.info.filter((t) => t.startsWith('Cyborg Hunter active'));
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toContain(' · 3 trials instrumented · ');

  const rows = parseCsv(await page.evaluate(() => window.__csv));
  expect(rows).toHaveLength(4);
  const sharedRows = rows.filter((r) => r.name === 'shared');
  expect(sharedRows).toHaveLength(2);
  const idx = sharedRows.map((r) => json(r.integritySegment).segmentIndex);
  expect(idx[0]).not.toBe(idx[1]);
  const tracked = rows.find((r) => r.name === 'tracked');
  expect(json(tracked.mouse_tracking_data).length).toBeGreaterThan(0);
  expect(json(tracked.integritySegment)).not.toBeNull();
  for (const r of rows) {
    expect(json(r.integritySegment)).not.toBeNull();
    expect(r.cyborgHunterError || '').toBe('');
  }

  const out = saveAndReport(newTmpDir('shared'), 'E2E-JS-2.csv', await page.evaluate(() => window.__csv));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].participantId).toBe('E2E-JS-2');
});

test('researcher-named trials after a synchronous call-function trial keep their trialId and phase, with one cyborg-hunter entry', async ({ page }) => {
  await page.goto(FIX + 'jspsych-named-trials.html');
  // The documented per-trial parameters ({ type: jsPsychCyborgHunter, params })
  // need the class on window with ch.js as the only Cyborg Hunter script.
  expect(await page.evaluate(() => typeof window.jsPsychCyborgHunter), 'window.jsPsychCyborgHunter with ch.js alone').toBe('function');
  await clickButton(page, 'Start');
  await clickButton(page, 'Named');
  await page.getByText('Named after a gap').waitFor();
  await clickButton(page, 'Named again');
  await page.waitForFunction(() => typeof window.__csv === 'string');

  const chEntries = await page.evaluate(() => Object.fromEntries(Object.entries(window.__trials)
    .map(([k, t]) => [k, t.extensions.filter((e) => e.type.info.name === 'cyborg-hunter').length])));
  expect(chEntries).toEqual({ named1: 1, named2: 1 });

  const rows = parseCsv(await page.evaluate(() => window.__csv));
  expect(rows).toHaveLength(5);
  for (const r of rows) {
    expect(json(r.integritySegment)).not.toBeNull();
    expect(r.cyborgHunterError || '').toBe('');
  }
  for (const [name, trialId] of [['named1', 'named-by-researcher'], ['named2', 'named-after-gap']]) {
    const row = rows.find((r) => r.name === name);
    expect(json(row.integrity).trialId).toBe(trialId);
    expect(json(row.integrity).phase).toBe('test');
    expect(json(row.integritySegment).trialId).toBe(trialId);
  }

  const out = saveAndReport(newTmpDir('named'), 'E2E-JS-3.csv', await page.evaluate(() => window.__csv));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
});

test('pipe-style save trial: the snapshot taken at the save trial\'s start still carries every earlier segment', async ({ page }) => {
  await page.goto(FIX + 'jspsych-pipe-trap.html');
  await clickButton(page, 'Start');
  await page.getByText('Question').waitFor();
  await pasteInto(page, '#input-0', 'pasted text');
  await page.locator('#input-0').pressSequentially(' typed', { delay: 120 });
  await page.click('#jspsych-survey-text-next');
  await page.waitForFunction(() => typeof window.__csv === 'string');
  const saved = await page.evaluate(() => window.__pipeSaved);
  expect(typeof saved).toBe('string');

  // The snapshot: the five rows before the save trial, every one with its
  // segment. The save trial's own row (its segment) and the final segment
  // come later, so the snapshot cannot hold them: the documented loss bound.
  const snap = parseCsv(saved);
  expect(snap).toHaveLength(5);
  expect(snap.some((r) => r.name === 'save')).toBe(false);
  for (const r of snap) {
    expect(json(r.integritySegment)).not.toBeNull();
    expect(r.integritySegmentFinal || '').toBe('');
  }
  // The full data (on_finish) has what the snapshot misses.
  const full = parseCsv(await page.evaluate(() => window.__csv));
  expect(full).toHaveLength(6);
  expect(json(full[5].integritySegment)).not.toBeNull();
  expect(json(full[5].integritySegmentFinal)).not.toBeNull();

  // The CLI reassembles the session from the snapshot's segments alone (a
  // "No session-level integrity data" warning would count as a file with
  // warnings).
  const out = saveAndReport(newTmpDir('pipe'), 'E2E-JS-4.csv', saved);
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].participantId).toBe('E2E-JS-4');
  expect(out.summaryCsv[0].totalPasteEvents).toBe('1');
});

test('guards: honeypot on by default, friction enforcing from its entry trial', async ({ page }) => {
  await installFullscreenMock(page);
  const log = collectConsole(page);
  await page.goto(FIX + 'jspsych-guards.html?entry=1');
  await clickButton(page, 'Enter fullscreen and continue');
  // The entry trial starts friction 100 ms after its on_finish.
  await page.waitForFunction(() => window.GuardFriction.getCurrentState().active === true);
  const state = await page.evaluate(() => window.GuardFriction.getCurrentState());
  expect(state.observe_only).toBe(false);
  expect(state.in_violation).toBe(false);
  expect(await page.evaluate(() => !!document.getElementById('fg-honeypot'))).toBe(true);
  const summaries = log.info.filter((t) => t.startsWith('Cyborg Hunter active'));
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatch(/ · 3 trials instrumented · ID from data-participant-id · honeypot on · friction enforce$/);

  // Leaving fullscreen raises the curtain (enforcement), resume lowers it.
  await page.evaluate(() => window.__chExitFullscreen());
  await expect(page.locator('#guard-friction-overlay')).toBeVisible();
  expect(await page.evaluate(() => window.GuardFriction.getCurrentState().current_reason)).toBe('not_fullscreen');
  await page.click('#guard-friction-resume');
  await expect(page.locator('#guard-friction-overlay')).toBeHidden();

  await clickButton(page, 'Continue');
  await clickButton(page, 'Finish');
  await page.waitForFunction(() => typeof window.__csv === 'string');
  // The final hook stopped friction.
  expect(await page.evaluate(() => window.GuardFriction.getCurrentState().active)).toBe(false);

  const rows = parseCsv(await page.evaluate(() => window.__csv));
  expect(rows).toHaveLength(3);
  for (const r of rows) expect(json(r.integritySegment)).not.toBeNull();
  const last = rows[rows.length - 1];
  expect(Number(last.guard_assistance_violation_count_session)).toBeGreaterThanOrEqual(1);
  expect(last.guard_assistance_violations_session).toContain('not_fullscreen');

  const out = saveAndReport(newTmpDir('guards'), 'E2E-JS-5.csv', await page.evaluate(() => window.__csv));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].honeypot_ai_use).toBe('no');
});

test('guards: friction without its entry trial only observes (violations logged, no curtain)', async ({ page }) => {
  await installFullscreenMock(page);
  const log = collectConsole(page);
  await page.goto(FIX + 'jspsych-guards.html');
  await page.locator('button.jspsych-btn', { hasText: 'Continue' }).waitFor();
  await page.waitForFunction(() => window.GuardFriction.getCurrentState().active === true);
  const state = await page.evaluate(() => window.GuardFriction.getCurrentState());
  expect(state.observe_only).toBe(true);
  expect(await page.evaluate(() => !!document.getElementById('fg-honeypot'))).toBe(true);
  const summaries = log.info.filter((t) => t.startsWith('Cyborg Hunter active'));
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatch(/ · 2 trials instrumented · ID from data-participant-id · honeypot on · friction observe$/);
  // Never in fullscreen: observed as a violation, but no curtain, and the
  // buttons stay clickable.
  await expect(page.locator('#guard-friction-overlay')).toBeHidden();
  await clickButton(page, 'Continue');
  await clickButton(page, 'Finish');
  await page.waitForFunction(() => typeof window.__csv === 'string');

  const rows = parseCsv(await page.evaluate(() => window.__csv));
  expect(rows).toHaveLength(2);
  const last = rows[rows.length - 1];
  expect(Number(last.guard_assistance_violation_count_session)).toBeGreaterThanOrEqual(1);
  const out = saveAndReport(newTmpDir('observe'), 'E2E-JS-5.csv', await page.evaluate(() => window.__csv));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].honeypot_ai_use).toBe('no');
});

test('manual mode with ch.js alone: the researcher\'s extension monitors, ch.js injects nothing, the CLI reads it', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'jspsych-manual.html');
  await clickButton(page, 'One');
  await page.getByText('Manual question').waitFor();
  await page.locator('#input-0').pressSequentially('typed', { delay: 120 });
  await page.click('#jspsych-survey-text-next');
  await clickButton(page, 'Three');
  await page.waitForFunction(() => typeof window.__csv === 'string');

  expect(log.info.some((t) => t.startsWith('[cyborg-hunter] manual mode: initJsPsych lists a cyborg-hunter extension'))).toBe(true);
  expect(log.error.filter((t) => t.includes('[cyborg-hunter]'))).toEqual([]);

  const rows = parseCsv(await page.evaluate(() => window.__csv));
  expect(rows).toHaveLength(3);
  for (const r of rows) {
    expect(json(r.integrity)).not.toBeNull();
    expect(r.integritySegment || '').toBe('');   // ch.js injected nothing
  }
  const last = rows[rows.length - 1];
  expect(json(last.integritySession)).not.toBeNull();
  expect(json(last.integrityScore)).not.toBeNull();

  const out = saveAndReport(newTmpDir('manual'), 'E2E-MANUAL-1.csv', await page.evaluate(() => window.__csv));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].participantId).toBe('E2E-MANUAL-1');
});
