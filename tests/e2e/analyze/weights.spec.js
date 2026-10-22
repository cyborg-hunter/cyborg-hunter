// tests/e2e/analyze/weights.spec.js
// The shared weights panel in the analyzer's settings, over the sample
// (default weights: 9mop 45, bsq6 21, 681w 13, a3f3 11): a slider's drag
// moves its number box, and its release re-ranks the report (a sidebar
// weight of 20 gives 681w 30 and a3f3 28; 9mop and bsq6 have no sidebar
// event); Hard at moves participants into HARD* in the report frame, which
// has no Weights… dialog of its own; the frame's search finds participants
// by a signal word; at 375px each slider ends where its boxes do. Every
// test runs under the request guard of engines.spec.js.
import { test, expect, guardNetwork, assertOnlyAllowed, siteAllowlist, waitReady, loadSample, buildReport, railOrder, reportFrame,
  panelRows } from './support.mjs';

async function ready(page, baseURL) {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await buildReport(page);
  return { allow, seen };
}

// A drag with the mouse: the box follows while the button is down (input
// events), and the report is built again on release (change).
test('a slider\'s drag moves its number box, and its release re-ranks the report', async ({ page, baseURL }) => {
  const { allow, seen } = await ready(page, baseURL);
  expect(await railOrder(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6', 'DEMO-681w', 'DEMO-a3f3']);
  const slider = page.locator('[data-slider="sidebar"]');
  await expect(slider).toHaveValue('3');
  await slider.scrollIntoViewIfNeeded();
  const b = await slider.boundingBox();
  const y = b.y + b.height / 2;
  // From about the thumb (3 of 0 to 20) to past the track's right end.
  await page.mouse.move(b.x + (b.width * 3) / 20, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 20, y, { steps: 8 });
  await expect(page.locator('[data-weight="sidebar"]')).toHaveValue('20');
  await page.mouse.up();
  await expect.poll(() => railOrder(page), { timeout: 60000 }).toEqual(['DEMO-9mop', 'DEMO-681w', 'DEMO-a3f3', 'DEMO-bsq6']);
  await expect(reportFrame(page).locator('.cohort-row[data-pid="DEMO-681w"] .score')).toHaveText('30');
  await assertOnlyAllowed(page, seen, allow);
});

// A number box commits (change) when it loses the focus.
test('Hard at in the settings moves participants into HARD* in the report frame, which has no Weights… dialog', async ({ page, baseURL }) => {
  const { allow, seen } = await ready(page, baseURL);
  const box = page.locator('[data-hard="sidebar"]');
  await box.fill('1');
  await box.press('Tab');
  const frame = reportFrame(page);
  await expect(frame.locator('.cohort-row[data-pid="DEMO-681w"] .tier-badge')).toHaveText('HARD*', { timeout: 60000 });
  await expect(frame.locator('.cohort-row[data-pid="DEMO-a3f3"] .tier-badge')).toHaveText('HARD*');
  await expect(frame.locator('.cohort-row[data-pid="DEMO-9mop"] .tier-badge')).toHaveText('HARD');
  await expect(frame.locator('.filter-chip[data-filter="hard"] .chip-n')).toHaveText('4');
  await expect(frame.locator('.weights-btn')).toHaveCount(0);
  await expect(frame.locator('#weights-dialog')).toHaveCount(0);
  await assertOnlyAllowed(page, seen, allow);
});

// "cut" (a copy) and "pan", the start of "panel" (a sidebar event), are
// found only through the signals' words, matched by their start: no
// participant's triage reason or id holds them.
test('the report frame\'s search finds participants by the start of a signal word', async ({ page, baseURL }) => {
  const { allow, seen } = await ready(page, baseURL);
  const frame = reportFrame(page);
  const rows = frame.locator('.cohort-row');
  expect(await rows.evaluateAll((rs) => rs.filter((r) => /cut|pan/.test(r.dataset.reason + ' ' + r.dataset.pid.toLowerCase())).length)).toBe(0);
  await frame.locator('.search-wrap input').fill('cut pan');
  await expect.poll(() => rows.evaluateAll((rs) => rs.filter((r) => getComputedStyle(r).display !== 'none').map((r) => r.dataset.pid)))
    .toEqual(['DEMO-681w']);
  await assertOnlyAllowed(page, seen, allow);
});

// The settings show from the first check on. At 375px each panel row
// stacks (the name, the slider, then the three boxes under their captions):
// the slider's track ends where the boxes do (neither past their right edge
// nor short of it), nothing in a row overlaps, no name is cut, and the page
// does not scroll sideways.
test('the settings at 375px: each slider ends where its boxes do; nothing overlaps or is cut', async ({ page, baseURL }) => {
  const allow = siteAllowlist(baseURL);
  const seen = await guardNetwork(page, allow);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/analyze/');
  await waitReady(page);
  await loadSample(page);
  await page.evaluate(() => document.fonts.ready);
  const rows = await panelRows(page.locator('[data-role="settings-form"] .wp-row'));
  expect(rows.length).toBe(20);
  expect(rows.filter((r) => Math.abs(r.pastBoxes) > 0.5 || r.pastLeft > 0.5 || r.overlaps || r.cut)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await assertOnlyAllowed(page, seen, allow);
});
