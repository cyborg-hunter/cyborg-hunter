// tests/e2e/analyze/engines.spec.js
// The guarantee the page makes, on every engine: no request beyond its own
// boot files, through sample load, report build and the zip download; and
// the same for the offline single file opened from disk, which requests
// nothing but itself.
import { pathToFileURL } from 'node:url';
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, loadSample, buildReport, railOrder, downloadZip, PILOT_ORDER, OFFLINE_FILE } from './support.mjs';

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

test('the offline single file works from file:// and makes no request at all', async ({ page, browserName }) => {
  // Known defect, kept in the matrix so it cannot go unnoticed: in WebKit a
  // worker started from a file:// page cannot read any Blob ("The I/O read
  // operation failed."), and the report's image step reads the PNG the
  // worker's canvas encodes. Playwright fails this test with "expected to
  // fail, but passed" once that is fixed; remove the line then.
  test.fail(browserName === 'webkit', 'WebKit: a worker of a file:// page cannot read Blobs');
  const url = pathToFileURL(OFFLINE_FILE).href;
  const allow = [url];
  const seen = await guardNetwork(page, allow, { route: false });
  await page.goto(url);
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  expect(await railOrder(page)).toEqual(PILOT_ORDER);
  const zip = await downloadZip(page);
  expect(zip.names).toContain('summary.csv');
  await assertOnlyAllowed(page, seen, allow);
});
