// tests/e2e/report/zoom.spec.js
// The CLI report's enlarged figure, in each engine: fitted to the window when
// it opens, at its own pixel size after "1:1" (scrolling inside the overlay),
// and fullscreen from its control; closing it leaves fullscreen too. While it
// is open the report behind it keeps still: the arrow keys and "/" act only
// once it closes. The report is rendered from tests/fixtures/demo/DEMO-FIXT.json
// with one figure, a 2000×400 PNG (wider than the window), and opened from
// file://; a second report holds the same session under two ids, so the arrow
// keys have a participant to move to.
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
  const render = (ps) => {
    const summaries = computeSummary(ps, config);
    return renderIndexHtml(summaries, rankTriage(summaries, detectEdgeExits(ps, config), config), ps, config, true, {});
  };
  const p = extractIntegrityData(raw, config);
  writeFileSync(join(dir, 'index.html'), await render([p]));
  writeFileSync(join(dir, 'two.html'), await render([p, extractIntegrityData({ ...raw, participantId: 'DEMO-FIXT-2' }, config)]));
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
  // The control keeps its name; its pressed styling shows the state.
  await expect(page.locator('.lightbox-zoom')).toHaveText('1:1');
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

test('while a figure is open, the arrow keys and "/" leave the report behind it alone', async ({ page }) => {
  await page.goto(pathToFileURL(join(dir, 'two.html')).href + '#p-DEMO-FIXT');
  const selected = () => page.locator('.cohort-row.selected').getAttribute('data-pid');
  expect(await selected()).toBe('DEMO-FIXT');
  // The key that would move the selection to the other participant.
  const away = (await page.locator('.cohort-row').first().getAttribute('data-pid')) === 'DEMO-FIXT' ? 'ArrowDown' : 'ArrowUp';
  await page.locator('#p-DEMO-FIXT a.zoomable').filter({ has: page.locator('img[alt="Mouse trajectories"]') }).click();
  await expect(page.locator('#lightbox')).toHaveClass(/open/);
  await page.keyboard.press(away);
  await page.keyboard.press('/');
  expect(await selected()).toBe('DEMO-FIXT');
  expect(await page.evaluate(() => document.activeElement === document.querySelector('.search-wrap input'))).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox')).not.toHaveClass(/open/);
  // Closed, the same key moves the selection.
  await page.keyboard.press(away);
  await expect.poll(selected).toBe('DEMO-FIXT-2');
});
