// tests/e2e/analyze/cursor.spec.js
// The pointer checks on the analyze page, over the sample: its generated
// session (SYN-GENERATED-04, automation flag set, clicks with no pointer
// movement) shows the cursor section, the tile, the rail cell and the run
// sentence, and the settings row holds the labelled weight; a weight of 1
// moves that session up within its tier and 0 puts it back. Every test runs
// under the request guard of engines.spec.js.
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, loadSample, buildReport, railOrder, reportFrame } from './support.mjs';

test('the sample shows the cursor section, the tile, the rail cell and the labelled weight', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  const frame = reportFrame(page);
  await expect(frame.locator('option[value="cursor"]')).toHaveText(/Pointer checks/);
  await expect(frame.locator('.cohort-row[data-pid="SYN-GENERATED-04"] .cursor-cell')).toHaveText('pointer checks: 2 of 3');
  await frame.locator('.cohort-row[data-pid="SYN-GENERATED-04"]').click();
  await expect(frame.locator('#p-SYN-GENERATED-04 .cursor-section')).toContainText('automation flag set by the browser');
  await expect(frame.locator('#p-SYN-GENERATED-04 .signal-tile', { hasText: 'Pointer checks' })).toContainText('2');
  await expect(page.locator('[data-role="settings-form"] table.weights')).toContainText('pointer checks (cursor)');
  await expect(page.locator('[data-role="settings-form"] table.weights')).toContainText('the tier is unchanged');
  await expect(page.locator('[data-role="cursor-line"]')).toContainText('Pointer checks: fired in 1 of 4 checkable sessions');
  await assertOnlyAllowed(page, seen, allow);
});

// The generated session is clean (no paste, no long tab-away) and scores 0
// like SYN-CLEAN-01, so at weight 0 it comes after it; at weight 1 its two
// fired checks put it first within Clean. A re-analysis keeps the summary
// line ("1 hard, 1 soft, 2 clean"), so the wait is on the order itself.
test('the weight re-ranks within the tier and 0 restores the order', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  const order = () => railOrder(page);
  const before = await order();
  await page.locator('[data-weight="cursor"]').fill('1');
  await page.locator('[data-weight="cursor"]').dispatchEvent('change');
  await expect.poll(async () => (await order()).indexOf('SYN-GENERATED-04'), { timeout: 60000 })
    .toBeLessThan(before.indexOf('SYN-GENERATED-04'));
  await page.locator('[data-weight="cursor"]').fill('0');
  await page.locator('[data-weight="cursor"]').dispatchEvent('change');
  await expect.poll(order, { timeout: 60000 }).toEqual(before);
  await assertOnlyAllowed(page, seen, allow);
});
