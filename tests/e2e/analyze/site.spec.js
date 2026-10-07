// tests/e2e/analyze/site.spec.js
// The full flow on Chromium: dropped files, the zip tree against the CLI's,
// the report's own scripts and its selection message, styled replays from a
// dropped stylesheet with the recorded external image blocked, and the
// participant switch, and the files the demo hands over. Every test runs
// under the same request guard as engines.spec.js.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, loadSample, buildReport, railOrder, reportFrame, reportSelected, downloadZip,
  pilotFiles, cliPilotTree, withoutRunTime, makeReplayCohort, startSentinel, requested, settleRequests, PILOT_ORDER, ROOT } from './support.mjs';

test('dropped synthetic pilot: same triage order as the sample, zip tree matches the CLI', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await page.setInputFiles('[data-role="file-input"]', pilotFiles());
  await expect(page.locator('[data-role="files-panel"]')).toBeVisible();
  await expect(page.locator('[data-role="counts"]')).toContainText('3 data files');
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
    expect(cli.text('index.html')).toMatch(/<code class="mono run-id">[0-9a-f]{16}<\/code>/);
    if (cliPngs.length) { expect(pngs).toEqual(cliPngs); expect(withoutRunTime(zip.text('index.html'))).toEqual(withoutRunTime(cli.text('index.html'))); }
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
    await expect(page.locator('[data-role="counts"]')).toContainText('1 experiment asset');
    await buildReport(page);
    await reportSelected(page);
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
    await settleRequests(seen, allow);
    expect(requested(seen).filter((u) => u.startsWith(sentinel.url))).toEqual([]);
    await assertOnlyAllowed(page, seen, allow);
  } finally { cohort.cleanup(); await sentinel.close(); }
});

// Without the experiment's stylesheet dropped, the viewer offers no fetch
// and says why the replay is unstyled.
test('switching participant tears down the viewer and mounts the right replay', async ({ page, baseURL }) => {
  const cohort = makeReplayCohort();
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  try {
    await page.goto('/analyze/');
    await waitReady(page);
    await page.setInputFiles('[data-role="file-input"]', cohort.files.filter((f) => !f.endsWith('demo.css')));
    await buildReport(page);
    await reportSelected(page);
    await page.selectOption('[data-role="replay-select"]', 'DEMO-FIXT');
    await page.click('[data-action="load-replay"]');
    await expect(page.locator('iframe.replay-host-frame[data-participant-id="DEMO-FIXT"]')).toHaveCount(1);
    await page.selectOption('[data-role="replay-select"]', 'DEMO-FIXT-B');
    await expect(page.locator('iframe.replay-host-frame')).toHaveCount(0);
    await page.click('[data-action="load-replay"]');
    await expect(page.locator('iframe.replay-host-frame[data-participant-id="DEMO-FIXT-B"]')).toHaveCount(1);
    await expect(page.locator('iframe.replay-host-frame')).toHaveCount(1);
    const host = page.frameLocator('iframe.replay-host-frame[data-participant-id="DEMO-FIXT-B"]');
    await expect(host.locator('.replay-note').filter({ hasText: 'no-network policy' })).toContainText('1 external stylesheet(s) cannot be fetched', { timeout: 30000 });
    await expect(host.locator('.replay-css-btn')).toHaveCount(0);
    // Selecting in the report switches the dropdown too, and tears the viewer down.
    await reportFrame(page).locator('.cohort-row[data-pid="DEMO-FIXT"]').click();
    await expect(page.locator('[data-role="replay-select"]')).toHaveValue('DEMO-FIXT');
    await expect(page.locator('iframe.replay-host-frame')).toHaveCount(0);
    await assertOnlyAllowed(page, seen, allow);
  } finally { cohort.cleanup(); }
});

test('files from two drops are one list: data first, the replays and the config after; Remove takes one out', async ({ page, baseURL }) => {
  const sentinel = await startSentinel();
  const cohort = makeReplayCohort(sentinel.url);
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  try {
    await page.goto('/analyze/');
    await waitReady(page);
    const data = cohort.files.filter((f) => /DEMO-FIXT(-B)?\.json$/.test(f));
    const rest = cohort.files.filter((f) => !data.includes(f));
    await page.setInputFiles('[data-role="file-input"]', data);
    await expect(page.locator('[data-role="counts"]')).toContainText('2 data files');
    await page.setInputFiles('[data-role="file-input"]', rest);
    await expect(page.locator('[data-role="counts"]')).toContainText('2 replay recordings');
    await expect(page.locator('[data-role="counts"]')).toContainText('1 experiment asset');
    await expect(page.locator('[data-role="config-source"]')).toContainText('cyborg-hunter.config.json');
    await expect(page.locator('[data-role="file-rows"] tr')).toHaveCount(6);
    await page.locator('[data-role="file-rows"] [data-path="demo.css"]').click();
    await expect(page.locator('[data-role="file-rows"] tr')).toHaveCount(5);
    await expect(page.locator('[data-role="counts"]')).toContainText('0 experiment assets');
    await buildReport(page);
    expect((await railOrder(page)).sort()).toEqual(['DEMO-FIXT', 'DEMO-FIXT-B']);
    await assertOnlyAllowed(page, seen, allow);
  } finally { cohort.cleanup(); await sentinel.close(); }
});

test('a setting on the results re-analyses in place: no file is read again, and the zip follows', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  await expect(page.locator('[data-role="summary"]')).toContainText('1 hard, 1 soft, 1 clean');
  // SYN-SOFT-02's saved soft score is 11: a threshold of 12 makes it clean.
  await page.fill('[name="softScoreThreshold"]', '12');
  await page.press('[name="softScoreThreshold"]', 'Tab');
  await expect(page.locator('[data-role="summary"]')).toContainText('1 hard, 0 soft, 2 clean', { timeout: 60000 });
  await expect(page.locator('section[data-step="results"]')).toBeVisible();
  const zip = await downloadZip(page);
  expect(zip.text('triage.md')).toMatch(/SYN-SOFT-02 \| clean/);
  await assertOnlyAllowed(page, seen, allow);
});

// The demo's last step stores the visitor's files in this browser's
// IndexedDB and opens analyze/#from-demo (demo/handoff.js). The record is
// written here with the plain IndexedDB API, so the page is held to the
// stored format and not only to its own writer.
test('files the demo stored open as a drop: listed, built, the hash dropped, the record read once', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  const dir = join(ROOT, 'tests', 'fixtures', 'demo');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((name) => ({ path: name, text: readFileSync(join(dir, name), 'utf8') }));
  await page.evaluate((stored) => new Promise((resolve, reject) => {
    const req = indexedDB.open('cyborg-hunter-handoff', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('files', 'readwrite');
      tx.objectStore('files').put({ createdAt: Date.now(),
        files: stored.map((f) => ({ path: f.path, blob: new Blob([f.text], { type: 'application/json' }) })) }, 'demo');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), files);
  await page.evaluate(() => { location.hash = 'from-demo'; });
  await page.reload();
  await waitReady(page);
  await expect(page.locator('[data-role="file-rows"] tr')).toHaveCount(3);
  await expect(page.locator('[data-role="counts"]')).toContainText('1 data file');
  await expect(page.locator('[data-role="counts"]')).toContainText('1 replay recording');
  await expect(page.locator('[data-role="id-field"]')).toHaveValue('participantId');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await buildReport(page);
  expect(await railOrder(page)).toEqual(['DEMO-FIXT']);
  // Read once: the record is gone, and a reload starts with an empty list.
  const left = await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('cyborg-hunter-handoff', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const get = req.result.transaction('files').objectStore('files').get('demo');
      get.onsuccess = () => { req.result.close(); resolve(get.result === undefined); };
    };
  }));
  expect(left).toBe(true);
  await page.reload();
  await waitReady(page);
  await expect(page.locator('[data-role="files-panel"]')).toBeHidden();
  await assertOnlyAllowed(page, seen, allow);
});

test('annotations made in the report frame are kept by the page through a re-analysis, and exported from the results', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  const frame = reportFrame(page);
  await frame.locator('#p-SYN-HARD-03').getByRole('button', { name: 'Exclude' }).click();
  await expect(frame.locator('.cohort-row[data-pid="SYN-HARD-03"] .annot-badge')).toHaveText('exclude');
  await expect(frame.locator('.annot-count')).toHaveText('1 of 3 reviewed');
  // The frame cannot download: its exports are the page's.
  await expect(frame.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
  await page.fill('[name="softScoreThreshold"]', '12');
  await page.press('[name="softScoreThreshold"]', 'Tab');
  await expect(page.locator('[data-role="summary"]')).toContainText('1 hard, 0 soft, 2 clean', { timeout: 60000 });
  await expect(frame.locator('.cohort-row[data-pid="SYN-HARD-03"] .annot-badge')).toHaveText('exclude');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="annotations-csv"]')]);
  expect(readFileSync(await csv.path(), 'utf8').split('\n')[1]).toMatch(/^SYN-HARD-03,hard,[^,]+,exclude,/);
  await assertOnlyAllowed(page, seen, allow);
});
