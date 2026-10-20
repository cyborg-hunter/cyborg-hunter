// tests/e2e/analyze/timeline.spec.js
// The Session timeline block in the analyzer's report frame (sandboxed, an
// opaque origin): over the sample, the hover label in the block's header row
// names DEMO-bsq6's "paste" trial and a click pins a line. Runs under the
// request guard of engines.spec.js.
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, loadSample, buildReport, reportFrame } from './support.mjs';

test('in the report frame the hover label names the trial and a click pins a line', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  const frame = reportFrame(page);
  await frame.locator('.cohort-row[data-pid="DEMO-bsq6"]').click();
  const stage = frame.locator('#p-DEMO-bsq6 .tl-stage');
  await expect(stage.locator('img')).toHaveCount(2);
  await expect.poll(() => stage.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(300);
  await stage.scrollIntoViewIfNeeded();
  const data = JSON.parse(await stage.getAttribute('data-timeline'));
  const paste = data.trials.find((t) => t[0] === 'paste');
  const box = await stage.boundingBox();
  const x = box.x + ((data.left + (((paste[2] + paste[3]) / 2) / data.domain) * data.chart) / data.w) * box.width;
  await page.mouse.move(x, box.y + 40);
  await expect(frame.locator('#p-DEMO-bsq6 .tl-head .tl-readout')).toContainText('trial paste');
  await page.mouse.click(x, box.y + 40);
  await expect(stage.locator('.tl-pin')).toHaveCount(1);
  await assertOnlyAllowed(page, seen, allow);
});
