// tests/e2e/oneliner/errors.spec.js
// Script placement and double loads in Chromium: the console text the
// researcher sees (compared with the error catalogue, src/oneliner/errors.js,
// imported here) and what still records. The guard bundles' double-load
// messages are literals in src/jspsych/extension-guard-*.js (plain IIFEs that
// cannot import the catalogue), so they are matched by their problem text.
// The `pageErrors` fixture (support.mjs) fails a spec on any uncaught page
// error, so "does not throw" is checked on every spec.

import { test, expect, collectConsole, pasteInto, parseCsv, newTmpDir, cleanupTmpDirs, saveAndReport } from './support.mjs';
import { MESSAGES } from '../../../src/oneliner/errors.js';

const FIX = '/tests/e2e/oneliner/fixtures/';

test.afterAll(() => cleanupTmpDirs());

function chErrors(log) { return log.error.filter((t) => t.startsWith('[cyborg-hunter]')); }
function json(cell) { return cell ? JSON.parse(cell) : null; }

test('not hookable (ch.js above jspsych.js): loud error with fix + link, vanilla mode still records', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'jspsych-not-hookable.html');
  await page.getByText('Only question').waitFor();
  await pasteInto(page, '#input-0', 'pasted text');
  await page.locator('#input-0').pressSequentially(' typed', { delay: 120 });
  await page.click('#jspsych-survey-text-next');
  await page.waitForFunction(() => typeof window.__csv === 'string');

  expect(chErrors(log)).toEqual([MESSAGES.loadedAboveJsPsych()]);

  // jsPsych ran unhooked: its one row carries no integrity columns.
  const rows = parseCsv(await page.evaluate(() => window.__csv));
  expect(rows).toHaveLength(1);
  expect(rows[0].integritySegment ?? '').toBe('');
  expect(rows[0].integrity ?? '').toBe('');

  // The vanilla host recorded the session, paste included.
  const data = await page.evaluate(() => window.CyborgHunter.data());
  expect(data.participantId).toBe('E2E-NH-1');
  expect(data.cyborgHunterOneLiner.host).toBe('vanilla');
  expect(data.trials.reduce((n, t) => n + t.integrity.pasteEvents.length, 0)).toBe(1);

  const out = saveAndReport(newTmpDir('not-hookable'), 'E2E-NH-1.json', JSON.stringify(data));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].totalPasteEvents).toBe('1');
});

test('double load (ch.js then cyborg-hunter.min.js and the guard bundles): loud errors, first monitor intact', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'jspsych-double-load.html');
  // What window.CyborgHunter is once every script has run (recorded in the
  // report; the brief's checks are below).
  const ns = await page.evaluate(() => ({
    mark: typeof window.CyborgHunter.mark,
    data: typeof window.CyborgHunter.data,
    replay: typeof window.CyborgHunter.replay
  }));
  test.info().annotations.push({ type: 'window.CyborgHunter after min.js', description: JSON.stringify(ns) });

  await page.locator('button.jspsych-btn', { hasText: 'One' }).click();
  await page.getByText('Double-load question').waitFor();
  await pasteInto(page, '#input-0', 'pasted text');
  await page.locator('#input-0').pressSequentially(' typed', { delay: 120 });
  await page.click('#jspsych-survey-text-next');
  await page.waitForFunction(() => typeof window.__csv === 'string');

  // min.js names ch.js as the first load; each guard bundle finds its core
  // already defined by ch.js and says so without claiming a load order.
  const errors = chErrors(log);
  expect(errors).toHaveLength(3);
  expect(errors[0]).toBe(MESSAGES.doubleLoad('ch.js', 'cyborg-hunter.min.js'));
  expect(errors[1]).toMatch(/^\[cyborg-hunter\] Not redefining GuardHoneypot: .+\. Fix: .+\. https:\/\/.+\/advanced-integration\.md#double-load$/);
  expect(errors[2]).toMatch(/^\[cyborg-hunter\] Not redefining GuardFriction: .+\. Fix: .+\. https:\/\/.+\/advanced-integration\.md#double-load$/);
  for (const e of errors.slice(1)) expect(e).not.toContain(' after ');

  // ch.js's monitor kept writing segments on every row.
  const rows = parseCsv(await page.evaluate(() => window.__csv));
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    expect(json(r.integritySegment)).not.toBeNull();
    expect(r.cyborgHunterError || '').toBe('');
  }
  expect(json(rows[1].integrity).pasteEvents).toHaveLength(1);

  const out = saveAndReport(newTmpDir('double-load'), 'E2E-DL-1.csv', await page.evaluate(() => window.__csv));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].participantId).toBe('E2E-DL-1');
  expect(out.summaryCsv[0].totalPasteEvents).toBe('1');
});

test('cyborg-hunter.min.js loaded twice: the neutral loaded-twice error, no load order claimed', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'core-loaded-twice.html');
  const errors = chErrors(log);
  expect(errors).toEqual([MESSAGES.coreLoadedTwice()]);
  expect(errors[0]).not.toContain('loaded after');
  // The bundle still works: a monitor can be created from it.
  expect(await page.evaluate(() => typeof window.CyborgHunter.init)).toBe('function');
});
