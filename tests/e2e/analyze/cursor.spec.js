// tests/e2e/analyze/cursor.spec.js
// The pointer verdict on the analyze page, over the sample: its generated
// session (SYN-GENERATED-04, 0.14-shaped, automation flag set, two trials
// moving in straight lines before they click, two clicked with no pointer
// movement) reads highly suspicious, with its tells, the checks, rules and
// shape in a closed details block, the tile, the rail cell and the run
// sentence, while the three 0.6.1 sessions read "not assessed"; the settings
// row holds the labelled weight; a weight of 1 moves the generated session up
// within its tier and 0 puts it back. Every test runs under the request guard
// of engines.spec.js.
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, loadSample, buildReport, railOrder, reportFrame } from './support.mjs';

test('the sample shows the pointer verdict, its tells, the details, the tile, the rail cell and the labelled weight', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  const frame = reportFrame(page);
  await expect(frame.locator('option[value="cursor"]')).toHaveText(/Pointer verdict/);
  await expect(frame.locator('.cohort-row[data-pid="SYN-GENERATED-04"] .cursor-cell')).toHaveText('pointer: highly suspicious');
  await expect(frame.locator('.cohort-row[data-pid="SYN-CLEAN-01"] .cursor-cell')).toHaveText('pointer: not assessed');
  await expect(frame.locator('#p-SYN-CLEAN-01 .signal-tile', { hasText: 'Pointer verdict' }).locator('.signal-value')).toHaveText('—');
  await frame.locator('.cohort-row[data-pid="SYN-GENERATED-04"]').click();
  const section = frame.locator('#p-SYN-GENERATED-04 .cursor-section');
  await expect(section.locator('.verdict-badge')).toHaveText('highly suspicious');
  await expect(section.locator('.cursor-tells li')).toHaveText(['automation flag set by the browser', 'trials clicked without pointer movement: 2 of 4 (50%) (t3, t4)']);
  const details = section.locator('details.cursor-details');
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  await expect(details.locator('tr', { hasText: 'trials clicked without pointer movement' })).toContainText('2 of 4 (t3, t4)');
  await expect(details.locator('tr', { hasText: 'clicks that arrived without a path' })).toContainText('0 of 4 first clicks');
  await expect(details.locator('tr', { hasText: 'efficiency (per movement)' })).toContainText('1.000 (n = 2)');
  await expect(details).toContainText('monitor stream, median 60 ms between samples, viewport coordinates');
  await expect(frame.locator('#p-SYN-GENERATED-04 .signal-tile', { hasText: 'Pointer verdict' }).locator('.signal-value')).toHaveText('2');
  await expect(section).not.toContainText('replay card');
  await expect(page.locator('[data-role="settings-form"] table.weights')).toContainText('pointer verdict (cursor)');
  await expect(page.locator('[data-role="settings-form"] table.weights')).toContainText('the tier is unchanged');
  await expect(page.locator('[data-role="cursor-line"]')).toContainText('Pointer verdicts: 1 highly suspicious, 0 suspicious, 0 clean, 3 not assessed (4 sessions; 3 recorded without device facts)');
  await assertOnlyAllowed(page, seen, allow);
});

// The generated session is clean (no paste, no long tab-away) and scores 0
// like SYN-CLEAN-01, so at weight 0 it comes after it; at weight 1 its
// verdict level, 2, puts it first within Clean. A re-analysis keeps the
// summary line ("1 hard, 1 soft, 2 clean"), so the wait is on the order itself.
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
