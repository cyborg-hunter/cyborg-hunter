// tests/e2e/analyze/typing.spec.js
// The typing section on the analyze page, over the sample: the AI agent's
// session (DEMO-bsq6) reads highly suspicious from its recording, with both
// tells and its first text box in the open details, above its cursor
// section; Mira's DEMO-681w reads not assessed (its recording holds no typed
// characters in a text field of the judged trials); the settings table holds
// the labelled typingRhythm weight. Every test runs under the request guard
// of engines.spec.js.
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, loadSample, buildReport, reportFrame } from './support.mjs';

test('the sample shows the typing verdict, its tells and the field, above the cursor section', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  const frame = reportFrame(page);
  await frame.locator('.cohort-row[data-pid="DEMO-bsq6"]').click();
  const section = frame.locator('#p-DEMO-bsq6 .typing-section');
  await expect(section.locator('.verdict-badge')).toHaveText('highly suspicious');
  await expect(section.locator('.typing-tells li')).toHaveText([
    'keys pressed faster than a person types: median gap 58 ms, 70% of gaps under 60 ms (baseline)',
    'keys pressed too evenly: gap variation 0.07, where people vary by 0.3 or more (baseline)']);
  await expect(section.locator('details.typing-details')).toHaveAttribute('open', '');
  await expect(section.locator('tr', { hasText: 'baseline · text box' }).locator('td')).toHaveText('23 · 58 ms · 70% · 0.07');
  const order = await frame.locator('#p-DEMO-bsq6 .typing-section, #p-DEMO-bsq6 .cursor-section').evaluateAll((els) => els.map((e) => e.className));
  expect(order).toEqual(['typing-section', 'cursor-section']);
  await frame.locator('.cohort-row[data-pid="DEMO-681w"]').click();
  await expect(frame.locator('#p-DEMO-681w .typing-verdict .muted')).toHaveText('the session recording holds no typed characters in a text field of the judged trials.');
  await expect(page.locator('[data-role="settings-form"] table.weights')).toContainText('typing verdict (typingRhythm)');
  await assertOnlyAllowed(page, seen, allow);
});
