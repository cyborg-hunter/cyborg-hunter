// tests/e2e/analyze/cursor.spec.js
// The pointer verdict on the analyze page, over the sample: the AI agent's
// session (DEMO-bsq6, every first click arriving without a path, no
// automation flag, no trial clicked without movement) reads highly
// suspicious, with its tell, the checks, rules and shape in a closed details
// block, the tile, the rail cell and the run sentence; DEMO-681w reads clean,
// with the counts its sentence gives; the two sessions recorded without
// device facts read "not assessed", with the reason; sorting the rail by the
// verdict puts the agent first and those two last; the settings row holds the
// labelled weight; a weight of 13 moves the agent's session up within its
// tier and 0 puts it back. Every test runs under the request guard of
// engines.spec.js.
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
  await expect(frame.locator('.cohort-row[data-pid="DEMO-bsq6"] .cursor-cell')).toHaveText('pointer: highly suspicious');
  await expect(frame.locator('.cohort-row[data-pid="DEMO-681w"] .cursor-cell')).toHaveText('pointer: clean');
  await expect(frame.locator('#p-DEMO-681w .cursor-verdict .muted')).toHaveText('0 of 22 first clicks with a known position arrived without a path and 0 of 17 trials were clicked without pointer movement, both under 20%; no click the page’s own scripts dispatched; automation flag not set.');
  for (const pid of ['DEMO-9mop', 'DEMO-a3f3']) {
    await expect(frame.locator('.cohort-row[data-pid="' + pid + '"] .cursor-cell')).toHaveText('pointer: not assessed');
    await expect(frame.locator('#p-' + pid + ' .cursor-verdict .muted')).toHaveText('device facts and click provenance not recorded (library before 0.14).');
  }
  await expect(frame.locator('#p-DEMO-a3f3 .signal-tile', { hasText: 'Pointer verdict' }).locator('.signal-value')).toHaveText('—');
  await frame.locator('.cohort-row[data-pid="DEMO-bsq6"]').click();
  const section = frame.locator('#p-DEMO-bsq6 .cursor-section');
  await expect(section.locator('.verdict-badge')).toHaveText('highly suspicious');
  await expect(section.locator('.cursor-tells li')).toHaveText(['clicks that arrived without a path: 12 of 12 first clicks with a known position (100%) (paste, tabaway, autotype, guard-entry, guard)']);
  const details = section.locator('details.cursor-details');
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  await expect(details.locator('tr', { hasText: 'automation flag set by the browser' }).locator('td')).toHaveText('no');
  await expect(details.locator('tr', { hasText: 'trials clicked without pointer movement' })).toContainText('0 of 6');
  await expect(details.locator('tr', { hasText: 'clicks that arrived without a path' })).toContainText('12 of 12 first clicks with a known position');
  await expect(details.locator('tr', { hasText: 'efficiency (per movement)' })).toContainText('0.967 (n = 1)');
  await expect(frame.locator('#p-DEMO-bsq6 .signal-tile', { hasText: 'Pointer verdict' }).locator('.signal-value')).toHaveText('2');
  await expect(section).not.toContainText('replay card');
  await expect(page.locator('[data-role="settings-form"] table.weights')).toContainText('pointer verdict (cursor)');
  await expect(page.locator('[data-role="settings-form"] table.weights')).toContainText('the tier is unchanged');
  await expect(page.locator('[data-role="cursor-line"]')).toContainText('Pointer verdicts: 1 highly suspicious, 0 suspicious, 1 clean, 2 not assessed (4 sessions; 2 recorded without device facts)');
  // By the verdict: highly suspicious, clean, then the two not assessed.
  await frame.locator('.sort-wrap select').selectOption('cursor');
  await expect.poll(() => railOrder(page)).toEqual(['DEMO-bsq6', 'DEMO-681w', 'DEMO-9mop', 'DEMO-a3f3']);
  await assertOnlyAllowed(page, seen, allow);
});

// The agent's session is hard-flagged, as DEMO-9mop is, and its score of 21
// is under DEMO-9mop's 45, so at weight 0 it comes after it; at weight 13
// its verdict level, 2, adds 26 and puts it first within Hard. A
// re-analysis keeps the summary line ("2 hard, 1 soft, 1 clean"), so the
// wait is on the order itself.
test('the weight re-ranks within the tier and 0 restores the order', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  const order = () => railOrder(page);
  const before = await order();
  await page.locator('[data-weight="cursor"]').fill('13');
  await page.locator('[data-weight="cursor"]').dispatchEvent('change');
  await expect.poll(async () => (await order()).indexOf('DEMO-bsq6'), { timeout: 60000 })
    .toBeLessThan(before.indexOf('DEMO-bsq6'));
  await page.locator('[data-weight="cursor"]').fill('0');
  await page.locator('[data-weight="cursor"]').dispatchEvent('change');
  await expect.poll(order, { timeout: 60000 }).toEqual(before);
  await assertOnlyAllowed(page, seen, allow);
});
