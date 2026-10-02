// tests/e2e/analyze/engines.spec.js
// The guarantee the page makes, on every engine: no request beyond its own
// boot files, through sample load, report build and the zip download; and
// the same for the offline single file opened from disk, through dropped
// files, which requests nothing but itself.
import { pathToFileURL } from 'node:url';
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, loadSample, buildReport, railOrder, reportSelected, downloadZip, pilotFiles, makeReplayCohort, PILOT_ORDER, OFFLINE_FILE } from './support.mjs';

test('the page makes no request beyond its own files, sample → report → zip', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  expect(await railOrder(page)).toEqual(PILOT_ORDER);
  const zip = await downloadZip(page);
  expect(zip.names).toContain('triage.md');
  await assertOnlyAllowed(page, seen, allow);
});

test('the offline single file works from file:// and makes no request at all', async ({ page }) => {
  // Dropped files, not the sample: from file:// the page reads each file on
  // the main thread and hands the worker the bytes (WebKit's workers cannot
  // read a Blob there), and the report's images take the encoder that needs
  // no Blob either.
  const url = pathToFileURL(OFFLINE_FILE).href;
  const allow = [url];
  const seen = await guardNetwork(page, allow, { route: false });
  await page.goto(url);
  await waitReady(page);
  await page.setInputFiles('[data-role="file-input"]', pilotFiles());
  await expect(page.locator('[data-role="counts"]')).toContainText('3 data files (3 CSV, 0 JSON');
  await expect(page.locator('[data-role="id-field"]')).toHaveValue('subject_ID');
  await buildReport(page);
  expect(await railOrder(page)).toEqual(PILOT_ORDER);
  const zip = await downloadZip(page);
  expect(zip.names).toContain('summary.csv');
  expect(zip.names.filter((n) => n.endsWith('.png')).length).toBeGreaterThanOrEqual(3);
  await assertOnlyAllowed(page, seen, allow);
});

test('the offline single file reads a gzipped recording and plays it', async ({ page }) => {
  // No recorded external image here: the styled-replay spec covers that
  // policy; this one is about the recording's way in, gunzip included: the
  // check step peeks every JSON file, the gzipped recordings too (4 files),
  // and the recordings are two gzip members each.
  const cohort = makeReplayCohort(null, { gzip: true });
  const url = pathToFileURL(OFFLINE_FILE).href;
  const allow = [url];
  const seen = await guardNetwork(page, allow, { route: false });
  try {
    await page.goto(url);
    await waitReady(page);
    await page.setInputFiles('[data-role="file-input"]', cohort.files);
    await expect(page.locator('[data-role="counts"]')).toContainText('1 experiment assets');
    await expect(page.locator('[data-role="id-reason"]')).toHaveText('4 file(s) inspected');
    await expect(page.locator('[data-role="id-field"]')).toHaveValue('participantId');
    await buildReport(page);
    const zip = await downloadZip(page);
    expect(zip.names).toContain('replay/DEMO-FIXT.replay.js');
    await reportSelected(page);
    await page.selectOption('[data-role="replay-select"]', 'DEMO-FIXT');
    // Scrolled into view first: Chromium on a file:// page delivered the
    // click at the button's position from before click()'s own scroll, below
    // the viewport, where nothing receives it (the zip is downloaded above,
    // before anything scrolls, for the same reason).
    const load = page.locator('[data-action="load-replay"]');
    await load.scrollIntoViewIfNeeded();
    await load.click();
    const host = page.frameLocator('iframe.replay-host-frame[data-participant-id="DEMO-FIXT"]');
    const sheet = host.frameLocator('iframe.replay-frame').locator('style[data-ch-sheet="1"]');
    await expect(sheet).toHaveCount(1, { timeout: 30000 });
    expect(await sheet.evaluate((el) => el.textContent)).toContain('outline:3px solid lime');
    await assertOnlyAllowed(page, seen, allow);
  } finally { cohort.cleanup(); }
});
