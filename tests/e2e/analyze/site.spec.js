// tests/e2e/analyze/site.spec.js
// The full flow on Chromium: dropped files, the zip tree against the CLI's,
// the report's own scripts and its selection message, styled replays from a
// dropped stylesheet with the recorded external image blocked, and the
// participant switch. Every test runs under the same request guard as
// engines.spec.js.
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, buildReport, railOrder, reportFrame, downloadZip,
  pilotFiles, cliPilotTree, makeReplayCohort, startSentinel, requested, PILOT_ORDER } from './support.mjs';

test('dropped synthetic pilot: same triage order as the sample, zip tree matches the CLI', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await page.setInputFiles('[data-role="file-input"]', pilotFiles());
  await expect(page.locator('section[data-step="check"]')).toBeVisible();
  await expect(page.locator('[data-role="counts"]')).toContainText('3 data files (3 CSV, 0 JSON');
  await expect(page.locator('[data-role="counts"]')).toContainText('1 config file');
  await expect(page.locator('[data-role="id-field"]')).toHaveValue('subject_ID');
  await buildReport(page);
  expect(await railOrder(page)).toEqual(PILOT_ORDER);
  const zip = await downloadZip(page);
  const cli = cliPilotTree();
  try {
    const isText = (n) => /\.(csv|md|json|html|js)$/.test(n);
    expect(zip.names.filter(isText)).toEqual(cli.names.filter(isText));
    for (const n of ['summary.csv', 'triage.md', 'event-log.csv', 'extensions.csv', 'score-weights.json']) {
      expect(zip.text(n), n).toEqual(cli.text(n));
    }
    const pngs = zip.names.filter((n) => n.endsWith('.png'));
    expect(pngs.length).toBeGreaterThanOrEqual(3);
    expect(pngs.every((n) => /^images\/(trajectories|session_timeline|typing_profile)_SYN-(HARD-03|SOFT-02|CLEAN-01)\.png$/.test(n))).toBe(true);
    const cliPngs = cli.names.filter((n) => n.endsWith('.png'));
    // With node-canvas on the CLI side the zip's index.html is the CLI-identical render: compare it byte for byte.
    if (cliPngs.length) { expect(pngs).toEqual(cliPngs); expect(zip.text('index.html')).toEqual(cli.text('index.html')); }
  } finally { cli.cleanup(); }
  await assertOnlyAllowed(page, seen, allow);
});

test('the report iframe runs its own scripts and tells the page which participant is selected', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await page.click('[data-action="sample"]');
  await buildReport(page);
  const frame = reportFrame(page);
  await frame.locator('.cohort-row[data-pid="SYN-CLEAN-01"]').click();
  await expect(frame.locator('#p-SYN-CLEAN-01')).toBeVisible();
  await expect(frame.locator('#p-SYN-HARD-03')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__chAnalyze.state.selected)).toBe('SYN-CLEAN-01');
  await assertOnlyAllowed(page, seen, allow);
});

test('a dropped stylesheet styles the replay; the recorded external image is never requested', async ({ page, baseURL }) => {
  const sentinel = await startSentinel();
  const cohort = makeReplayCohort(sentinel.url);
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  try {
    await page.goto('/analyze/');
    await waitReady(page);
    await page.setInputFiles('[data-role="file-input"]', cohort.files);
    await expect(page.locator('[data-role="counts"]')).toContainText('1 experiment assets');
    await buildReport(page);
    await page.selectOption('[data-role="replay-select"]', 'DEMO-FIXT');
    await expect(page.locator('[data-role="asset-note"]')).toHaveText('Experiment assets: 1 of 1 stylesheets matched; 0 of 1 images matched (missing: blocked.png).');
    await page.click('[data-action="load-replay"]');
    const host = page.frameLocator('iframe.replay-host-frame[data-participant-id="DEMO-FIXT"]');
    const sheet = host.frameLocator('iframe.replay-frame').locator('style[data-ch-sheet="1"]');
    await expect(sheet).toHaveCount(1, { timeout: 30000 });
    expect(await sheet.evaluate((el) => el.textContent)).toContain('outline:3px solid lime');
    // The reconstruction frame has the image element (the replay really
    // reached it), the sentinel never heard from the browser, and the record
    // holds no request for it that the policy did not refuse.
    const img = host.frameLocator('iframe.replay-frame').locator('img[src="' + sentinel.url + '/blocked.png"]');
    await expect(img).toHaveCount(1);
    await expect.poll(() => img.evaluate((el) => el.complete)).toBe(true);   // settled: refused, or loaded
    expect(sentinel.hits).toEqual([]);
    expect(requested(seen).filter((u) => u.startsWith(sentinel.url))).toEqual([]);
    await assertOnlyAllowed(page, seen, allow);
  } finally { cohort.cleanup(); await sentinel.close(); }
});

test('switching participant tears down the viewer and mounts the right replay', async ({ page, baseURL }) => {
  const cohort = makeReplayCohort();
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  try {
    await page.goto('/analyze/');
    await waitReady(page);
    await page.setInputFiles('[data-role="file-input"]', cohort.files);
    await buildReport(page);
    await page.selectOption('[data-role="replay-select"]', 'DEMO-FIXT');
    await page.click('[data-action="load-replay"]');
    await expect(page.locator('iframe.replay-host-frame[data-participant-id="DEMO-FIXT"]')).toHaveCount(1);
    await page.selectOption('[data-role="replay-select"]', 'DEMO-FIXT-B');
    await expect(page.locator('iframe.replay-host-frame')).toHaveCount(0);
    await page.click('[data-action="load-replay"]');
    await expect(page.locator('iframe.replay-host-frame[data-participant-id="DEMO-FIXT-B"]')).toHaveCount(1);
    await expect(page.locator('iframe.replay-host-frame')).toHaveCount(1);
    // Selecting in the report switches the dropdown too, and tears the viewer down.
    await reportFrame(page).locator('.cohort-row[data-pid="DEMO-FIXT"]').click();
    await expect(page.locator('[data-role="replay-select"]')).toHaveValue('DEMO-FIXT');
    await expect(page.locator('iframe.replay-host-frame')).toHaveCount(0);
    await assertOnlyAllowed(page, seen, allow);
  } finally { cohort.cleanup(); }
});
