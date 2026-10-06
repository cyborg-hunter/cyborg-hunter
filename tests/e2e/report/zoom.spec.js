// tests/e2e/report/zoom.spec.js
// The CLI report's enlarged figure, in each engine: fitted to the window when
// it opens, at its own pixel size after "1:1" (scrolling inside the overlay),
// and fullscreen from its control; closing it leaves fullscreen too. The
// report is rendered from tests/fixtures/demo/DEMO-FIXT.json with one figure,
// a 2000×400 PNG (wider than the window), and opened from file://.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, ROOT } from '../analyze/support.mjs';
import { extractIntegrityData } from '../../../src/cli/extract-core.js';
import { computeSummary } from '../../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../../src/cli/renderers/html-index-core.js';
import { encodePng } from '../../../demo/analyze/png-encode.js';

const W = 2000, H = 400;
let dir;
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ch-e2e-zoom-'));
  const config = { outputDir: '.', participantIdField: 'participantId' };
  const raw = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'demo', 'DEMO-FIXT.json'), 'utf8'));
  const p = extractIntegrityData(raw, config);
  const summaries = computeSummary([p], config);
  const triage = rankTriage(summaries, detectEdgeExits([p], config), config);
  writeFileSync(join(dir, 'index.html'), await renderIndexHtml(summaries, triage, [p], config, true, {}));
  // Only the trajectories figure exists; the other two blocks hide themselves.
  mkdirSync(join(dir, 'images'));
  writeFileSync(join(dir, 'images', 'trajectories_DEMO-FIXT.png'), encodePng(W, H, new Uint8Array(W * H * 4).fill(160)));
});
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function openFigure(page) {
  await page.goto(pathToFileURL(join(dir, 'index.html')).href);
  await page.locator('#p-DEMO-FIXT a.zoomable').filter({ has: page.locator('img[alt="Mouse trajectories"]') }).click();
  await expect(page.locator('#lightbox')).toHaveClass(/open/);
}
const shownWidth = (img) => img.evaluate((el) => el.getBoundingClientRect().width);

test('a figure opens fitted to the window, shows its own pixels at 1:1, and fits again', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openFigure(page);
  const overlay = page.locator('#lightbox');
  const img = page.locator('#lightbox-img');
  const fitted = await shownWidth(img);
  expect(fitted).toBeLessThan(1200);
  await page.locator('.lightbox-zoom').click();
  await expect(overlay).toHaveClass(/actual/);
  await expect(page.locator('.lightbox-zoom')).toHaveAttribute('aria-pressed', 'true');
  expect(await shownWidth(img)).toBe(W);
  expect(await overlay.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  // The figure itself toggles too.
  await img.click();
  await expect(overlay).not.toHaveClass(/actual/);
  expect(await shownWidth(img)).toBe(fitted);
  await page.keyboard.press('Escape');
  await expect(overlay).not.toHaveClass(/open/);
});

test('a figure goes fullscreen from its control, and closing it leaves fullscreen', async ({ page }) => {
  await openFigure(page);
  const full = page.locator('.lightbox-fullscreen');
  await expect(full).toBeVisible();
  await full.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement && document.fullscreenElement.id)).toBe('lightbox');
  await expect(full).toHaveText('Exit fullscreen');
  await page.locator('.lightbox-close').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(page.locator('#lightbox')).not.toHaveClass(/open/);
});
