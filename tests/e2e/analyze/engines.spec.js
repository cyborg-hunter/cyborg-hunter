// tests/e2e/analyze/engines.spec.js
// The guarantee the page makes, on every engine: no request beyond its own
// boot files, through sample load, report build and the zip download; and
// the same for the offline single file opened from disk, through dropped
// files, which requests nothing but itself.
import { pathToFileURL } from 'node:url';
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, loadSample, buildReport, railOrder, reportFrame, reportSelected, downloadZip, pilotFiles, makeReplayCohort, startSentinel, requested, settleRequests, PILOT_ORDER, OFFLINE_FILE } from './support.mjs';

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
  await expect(page.locator('[data-role="counts"]')).toContainText('3 data files');
  await expect(page.locator('[data-role="id-field"]')).toHaveValue('subject_ID');
  await buildReport(page);
  expect(await railOrder(page)).toEqual(PILOT_ORDER);
  const zip = await downloadZip(page);
  expect(zip.names).toContain('summary.csv');
  expect(zip.names.filter((n) => n.endsWith('.png')).length).toBeGreaterThanOrEqual(3);
  await assertOnlyAllowed(page, seen, allow);
});

test('the offline single file reads a gzipped recording and plays it; the recorded external image is never requested', async ({ page }) => {
  // The recording's way in, gunzip included: the check step reads every JSON
  // file, the gzipped recordings too, and suggests the id field from the two
  // data files only (the recordings are two gzip members each). The recording
  // also holds an image from a sentinel server. The viewer's own policy allows
  // any image; what refuses it is the page's policy, inherited from the page
  // into the blob: replay host and from there into the viewer's srcdoc frame.
  // The sentinel is the ground truth that every engine does inherit it.
  const sentinel = await startSentinel();
  const cohort = makeReplayCohort(sentinel.url, { gzip: true });
  const url = pathToFileURL(OFFLINE_FILE).href;
  const allow = [url];
  const seen = await guardNetwork(page, allow, { route: false });
  try {
    await page.goto(url);
    await waitReady(page);
    await page.setInputFiles('[data-role="file-input"]', cohort.files);
    await expect(page.locator('[data-role="counts"]')).toContainText('1 experiment asset');
    await expect(page.locator('[data-role="id-files"]')).toHaveText('2 data files inspected; 2 replay recordings skipped');
    await expect(page.locator('[data-role="id-field"] option')).toHaveText(['participantId — known name']);
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
    const img = host.frameLocator('iframe.replay-frame').locator('img[src="' + sentinel.url + '/blocked.png"]');
    await expect(img).toHaveCount(1);
    await expect.poll(() => img.evaluate((el) => el.complete)).toBe(true);   // settled: refused, or loaded
    expect(sentinel.hits).toEqual([]);
    await settleRequests(seen, allow);
    expect(requested(seen).filter((u) => u.startsWith(sentinel.url))).toEqual([]);
    await assertOnlyAllowed(page, seen, allow);
  } finally { cohort.cleanup(); await sentinel.close(); }
});

// The report frame's document has an opaque origin (sandbox="allow-scripts").
// Fullscreen inside it needs the frame's permission, and Firefox and WebKit
// refuse the default allowlist for an opaque origin (Chromium does not), so
// this is checked on every engine.
test('a figure in the report frame goes fullscreen, and closing it leaves fullscreen', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  const frame = reportFrame(page);
  await frame.locator('a.zoomable:visible').first().click();
  const box = frame.locator('#lightbox');
  await expect(box).toHaveClass(/open/);
  // Shown only where the frame's document may go fullscreen.
  await expect(frame.locator('.lightbox-fullscreen')).toBeVisible();
  await frame.locator('.lightbox-fullscreen').click();
  await expect.poll(() => box.evaluate((el) => el.ownerDocument.fullscreenElement === el)).toBe(true);
  await frame.locator('.lightbox-close').click();
  await expect.poll(() => box.evaluate((el) => !!el.ownerDocument.fullscreenElement)).toBe(false);
  await assertOnlyAllowed(page, seen, allow);
});
