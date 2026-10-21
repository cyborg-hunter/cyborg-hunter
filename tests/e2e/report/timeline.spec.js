// tests/e2e/report/timeline.spec.js
// The CLI report's Session timeline block in each engine, opened from
// file://: the hover label in the block's header row names the trial under
// the pointer and never covers a chart, a click pins a dashed line and a
// second click on it removes it, and "enlarge" shows both images in the
// lightbox, which the close control and Escape both clear, leaving the
// lightbox to show the next figure opened. The report is rendered from
// tests/fixtures/demo/DEMO-FIXT.json (its trials carry start times, so the
// charts align); the two images are plain PNGs of the charts' size, since
// the script reads its numbers from the block, not from the pixels, and a
// trajectories PNG is the next figure. A second set of reports, in a
// directory of its own, lacks one or both timeline images: the block keeps
// what loads and hides when nothing does.
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

const png = (w, h) => encodePng(w, h, new Uint8Array(w * h * 4).fill(235));
const TRAJECTORIES_W = 600;
async function render() {
  const config = { outputDir: '.', participantIdField: 'participantId' };
  const raw = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'demo', 'DEMO-FIXT.json'), 'utf8'));
  const p = extractIntegrityData(raw, config);
  const summaries = computeSummary([p], config);
  return renderIndexHtml(summaries, rankTriage(summaries, detectEdgeExits([p], config), config), [p], config, true, {});
}

let dir;
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ch-e2e-timeline-'));
  writeFileSync(join(dir, 'index.html'), await render());
  mkdirSync(join(dir, 'images'));
  writeFileSync(join(dir, 'images', 'typing_profile_DEMO-FIXT.png'), png(1000, 204));
  writeFileSync(join(dir, 'images', 'session_timeline_DEMO-FIXT.png'), png(1000, 395));
  writeFileSync(join(dir, 'images', 'trajectories_DEMO-FIXT.png'), png(TRAJECTORIES_W, 300));
});
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The page x of a time, from the numbers the block carries.
async function xAt(stage, sec) {
  const data = JSON.parse(await stage.getAttribute('data-timeline'));
  const box = await stage.boundingBox();
  return box.x + ((data.left + (sec / data.domain) * data.chart) / data.w) * box.width;
}
async function open(page, width = 1200) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(pathToFileURL(join(dir, 'index.html')).href);
  const stage = page.locator('#p-DEMO-FIXT .tl-stage');
  await expect(stage.locator('img')).toHaveCount(2);
  await expect.poll(() => stage.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(300);
  // The report's faces are inline data: settled before any box is compared.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return stage;
}
// Closed, the lightbox is back to its single figure: the slot is shown and
// the stack hidden again, so the next figure opened is that figure, not a
// blank.
async function expectSingleFigureBack(page) {
  const img = page.locator('#lightbox-img');
  await expect(img).not.toHaveAttribute('hidden');
  await expect(img).not.toHaveCSS('display', 'none');
  await expect(page.locator('#lightbox-stack')).toHaveCSS('display', 'none');
  await page.locator('#p-DEMO-FIXT a.zoomable').filter({ has: page.locator('img[alt="Mouse trajectories"]') }).click();
  await expect(page.locator('#lightbox')).toHaveClass(/open/);
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(TRAJECTORIES_W);
}

test('the hover label names the trial under the pointer, in the header row above the charts', async ({ page }) => {
  const stage = await open(page);
  const readout = page.locator('#p-DEMO-FIXT .tl-head .tl-readout');
  const enlarge = page.locator('#p-DEMO-FIXT .tl-enlarge');
  const enlargeAtRest = await enlarge.boundingBox();
  const box = await stage.boundingBox();
  // act1-tabaway runs from 5.98 s to 17.41 s (the session offset is 0 here).
  await page.mouse.move(await xAt(stage, 11.7), box.y + 40);
  await expect(readout).toBeVisible();
  await expect(readout).toContainText('trial act1-tabaway');
  // The readout never covers a chart: it lies wholly above the stage's top
  // edge, and filling it leaves "enlarge" where it was.
  const shown = await readout.boundingBox();
  expect(shown.y + shown.height).toBeLessThanOrEqual((await stage.boundingBox()).y);
  expect(await enlarge.boundingBox()).toEqual(enlargeAtRest);
  // Over the left margin no time is plotted: the readout empties and the line goes.
  await page.mouse.move(box.x + 5, box.y + 40);
  await expect(readout).toHaveText('');
  await expect(stage.locator('.tl-line')).toBeHidden();
});

// The block is not held to the pane's 800 px reading column: it grows with
// the pane up to the charts' own 1000 px, and no further. The pane's room is
// the participant section's width inside its padding, less any scrollbar.
async function paneRoom(page) {
  return page.locator('#p-DEMO-FIXT').evaluate((el) => {
    const s = getComputedStyle(el);
    return el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
  });
}

// At 1400 px the pane's room is 1000 px less whatever the runner's scrollbar
// takes: the stage fills it. The room is past the 800 px reading column, so
// a block held to that column would fail here.
test('in a 1400 px window the stage fills the pane, up to 1000 px', async ({ page }) => {
  const stage = await open(page, 1400);
  const room = await paneRoom(page);
  expect(room).toBeGreaterThan(900);
  const width = (await stage.boundingBox()).width;
  expect(width).toBeLessThanOrEqual(1000);
  expect(Math.abs(width - Math.min(1000, room))).toBeLessThanOrEqual(1);
});

// At 1800 px the pane has room to spare, and the cap holds the whole block
// at 1000 px, its header row included: "enlarge" ends where the stage ends.
test('in an 1800 px window the block stops at 1000 px, "enlarge" at the stage\'s right edge', async ({ page }) => {
  const stage = await open(page, 1800);
  expect(await paneRoom(page)).toBeGreaterThan(1100);
  expect((await page.locator('#p-DEMO-FIXT .tl-block').boundingBox()).width).toBe(1000);
  const box = await stage.boundingBox();
  expect(box.width).toBe(1000);
  const enlarge = await page.locator('#p-DEMO-FIXT .tl-enlarge').boundingBox();
  expect(Math.abs(enlarge.x + enlarge.width - (box.x + box.width))).toBeLessThanOrEqual(1);
});

test('a click pins a dashed line and a second click on it removes it', async ({ page }) => {
  const stage = await open(page);
  const box = await stage.boundingBox();
  const x = await xAt(stage, 11.7);
  await page.mouse.click(x, box.y + 40);
  await expect(stage.locator('.tl-pin')).toHaveCount(1);
  expect(await stage.locator('.tl-pin').evaluate((el) => getComputedStyle(el).borderLeftStyle)).toBe('dashed');
  await page.mouse.click(x + 2, box.y + 40);
  await expect(stage.locator('.tl-pin')).toHaveCount(0);
});

test('enlarge shows both images in the lightbox, and closing clears them', async ({ page }) => {
  await open(page);
  await page.locator('#p-DEMO-FIXT .tl-enlarge').click();
  await expect(page.locator('#lightbox')).toHaveClass(/open/);
  await expect(page.locator('#lightbox-stack img')).toHaveCount(2);
  await expect(page.locator('#lightbox-img')).toBeHidden();
  // The single figure's slot has no source here (closeLightbox empties it),
  // so it has no box whether or not it is hidden: check its display itself.
  await expect(page.locator('#lightbox-img')).toHaveCSS('display', 'none');
  await page.locator('.lightbox-close').click();
  await expect(page.locator('#lightbox')).not.toHaveClass(/open/);
  await expect(page.locator('#lightbox-stack img')).toHaveCount(0);
  await expectSingleFigureBack(page);
});

test('Escape closes the enlarged pair and clears it', async ({ page }) => {
  await open(page);
  await page.locator('#p-DEMO-FIXT .tl-enlarge').click();
  await expect(page.locator('#lightbox')).toHaveClass(/open/);
  await expect(page.locator('#lightbox-stack img')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox')).not.toHaveClass(/open/);
  await expect(page.locator('#lightbox-stack img')).toHaveCount(0);
  await expectSingleFigureBack(page);
});

// A PNG the CLI did not write (the plot cores skip some participants) fails
// to load: its img removes itself and the other stays; with neither, the
// whole block hides, heading and all. Own directory, so the reports above
// keep both images.
test.describe('a missing image', () => {
  let missing;
  test.beforeAll(async () => {
    missing = mkdtempSync(join(tmpdir(), 'ch-e2e-timeline-missing-'));
    const html = await render();
    // timeline-only/: the typing chart's PNG is missing; none/: both are.
    for (const sub of ['timeline-only', 'none']) {
      mkdirSync(join(missing, sub, 'images'), { recursive: true });
      writeFileSync(join(missing, sub, 'index.html'), html);
    }
    writeFileSync(join(missing, 'timeline-only', 'images', 'session_timeline_DEMO-FIXT.png'), png(1000, 395));
  });
  test.afterAll(() => rmSync(missing, { recursive: true, force: true }));

  test('without the typing chart the block keeps the timeline, and its stage still reads and pins', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(pathToFileURL(join(missing, 'timeline-only', 'index.html')).href);
    const block = page.locator('#p-DEMO-FIXT .tl-block');
    const stage = block.locator('.tl-stage');
    await expect(stage.locator('img')).toHaveCount(1);
    await expect(stage.locator('img')).toHaveAttribute('alt', 'Session timeline');
    await expect.poll(() => stage.locator('img').evaluate((el) => el.complete && el.naturalWidth)).toBe(1000);
    await expect(block).toBeVisible();
    const box = await stage.boundingBox();
    const x = await xAt(stage, 11.7);
    await page.mouse.move(x, box.y + 40);
    await expect(block.locator('.tl-head .tl-readout')).toContainText('trial act1-tabaway');
    await page.mouse.click(x, box.y + 40);
    await expect(stage.locator('.tl-pin')).toHaveCount(1);
  });

  test('without either image the block hides', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(pathToFileURL(join(missing, 'none', 'index.html')).href);
    await expect(page.locator('#p-DEMO-FIXT')).toBeVisible();
    const block = page.locator('#p-DEMO-FIXT .tl-block');
    await expect(block.locator('img')).toHaveCount(0);
    await expect(block).toHaveCSS('display', 'none');
  });
});
