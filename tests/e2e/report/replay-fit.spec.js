// tests/e2e/report/replay-fit.spec.js
// The CLI report's replay viewer, in each engine: the recorded viewport fits
// the report's detail pane on both axes (and is wider than the 800 px reading
// column when the pane has room), 1:1 shows the recorded page at its own
// pixel size, scrolling inside the fitted box, and fullscreen fits the
// screen, centred, while the report's keys stand down behind it. The report is
// built by bin/cyborg-hunter.js from the demo fixture (a 1280×900 recording)
// and opened from file://; a second report adds the same session under a
// second id, so the arrow keys have a participant to move to.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, ROOT } from '../analyze/support.mjs';

let dir;
test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ch-e2e-replay-fit-'));
  for (const f of ['DEMO-FIXT.json', 'DEMO-FIXT-replay-1785352263344.json']) {
    copyFileSync(join(ROOT, 'tests', 'fixtures', 'demo', f), join(dir, f));
  }
  const build = (data) => execFileSync(process.execPath, [join(ROOT, 'bin', 'cyborg-hunter.js'), 'report', '--data', data,
    '--output', join(data, 'report'), '--no-visuals'],
  { cwd: data, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, stdio: 'pipe' });
  build(dir);
  const two = join(dir, 'two');
  mkdirSync(two);
  for (const f of ['DEMO-FIXT.json', 'DEMO-FIXT-replay-1785352263344.json']) copyFileSync(join(dir, f), join(two, f));
  const raw = JSON.parse(readFileSync(join(dir, 'DEMO-FIXT.json'), 'utf8'));
  writeFileSync(join(two, 'DEMO-FIXT-2.json'), JSON.stringify({ ...raw, participantId: 'DEMO-FIXT-2' }));
  build(two);
});
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function loadReplay(page) {
  await page.goto(pathToFileURL(join(dir, 'report', 'index.html')).href);
  await page.locator('.replay-load-btn:visible').first().click();
  const mount = page.locator('.replay-mount').first();
  await expect.poll(() => mount.evaluate((m) => !!(m._chReplayDebug && m._chReplayDebug.frameReady())), { timeout: 20000 }).toBe(true);
  return mount;
}
// The stage box, the whole viewer, the room the report gives it (the pane
// less its padding), and the bottom of the viewer's last line.
const measure = (mount) => mount.evaluate((m) => {
  const stage = m.querySelector('.replay-stage').getBoundingClientRect();
  return {
    stageW: stage.width, stageH: stage.height, k: m._chReplayDebug.getCamera().k,
    viewerH: m.getBoundingClientRect().height,
    room: document.querySelector('.detail').clientHeight - 40,
  };
});

test('the replay fits the pane on both axes and keeps the recorded shape', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  const m = await measure(await loadReplay(page));
  expect(m.viewerH).toBeLessThanOrEqual(m.room + 1);
  expect(Math.abs(m.stageW / m.stageH - 1280 / 900)).toBeLessThan(0.01);
});

test('with room to spare the replay is wider than the 800 px reading column', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const m = await measure(await loadReplay(page));
  expect(m.stageW).toBeGreaterThan(800);
  expect(m.viewerH).toBeLessThanOrEqual(m.room + 1);
});

test('1:1 shows the recorded page at its own pixel size, scrolling inside the fitted box', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  const mount = await loadReplay(page);
  const fitted = await measure(mount);
  await mount.locator('.replay-size').click();
  await expect(mount.locator('.replay-size')).toHaveAttribute('aria-pressed', 'true');
  const actual = await measure(mount);
  expect([actual.stageW, actual.stageH, actual.k]).toEqual([1280, 900, 1]);
  expect(actual.viewerH).toBeLessThanOrEqual(actual.room + 1);
  expect(await mount.locator('.replay-stage-wrap').evaluate((w) => w.scrollHeight > w.clientHeight)).toBe(true);
  await mount.locator('.replay-size').click();
  expect(await measure(mount)).toEqual(fitted);
});

test('the viewer goes fullscreen and fits the screen, then fits the pane again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  const mount = await loadReplay(page);
  const before = await measure(mount);
  const full = mount.locator('.replay-fullscreen');
  await full.click();
  await expect.poll(() => mount.evaluate((m) => document.fullscreenElement === m)).toBe(true);
  await expect(full).toHaveText('Exit fullscreen');
  await expect.poll(async () => (await measure(mount)).stageW).toBeGreaterThan(before.stageW);
  // The controls stay on the screen with the stage.
  expect(await mount.evaluate((m) => m.querySelector('.replay-ticker').getBoundingClientRect().bottom <= window.innerHeight + 1)).toBe(true);
  // The height binds on this screen, so the stage (and the lane under it)
  // stands in the middle of the viewer, not at its left edge.
  const offCentre = await mount.evaluate((m) => {
    const mid = (r) => (r.left + r.right) / 2;
    const viewer = mid(m.getBoundingClientRect());
    return ['.replay-stage', '.replay-lane'].map((s) => Math.abs(mid(m.querySelector(s).getBoundingClientRect()) - viewer));
  });
  for (const d of offCentre) expect(d).toBeLessThanOrEqual(1);
  await full.click();
  await expect.poll(() => mount.evaluate((m) => !!document.fullscreenElement)).toBe(false);
  await expect.poll(() => measure(mount)).toEqual(before);
});

test('fullscreen on a narrow screen: the stage fits inside the viewer\'s padding, with no sideways scroll', async ({ page }) => {
  // A tall, narrow window: the width binds, so the room's width decides.
  await page.setViewportSize({ width: 600, height: 1000 });
  const mount = await loadReplay(page);
  const before = await measure(mount);
  await mount.locator('.replay-fullscreen').click();
  await expect.poll(() => mount.evaluate((m) => document.fullscreenElement === m)).toBe(true);
  // The fullscreen refit has landed once the stage takes the screen.
  await expect.poll(async () => (await measure(mount)).stageW).toBeGreaterThan(before.stageW);
  const fit = await mount.evaluate((m) => {
    const stage = m.querySelector('.replay-stage').getBoundingClientRect();
    return { scrollW: m.scrollWidth, clientW: m.clientWidth, stageRight: stage.right,
      contentRight: m.getBoundingClientRect().right - parseFloat(getComputedStyle(m).paddingRight) };
  });
  expect(fit.scrollW).toBeLessThanOrEqual(fit.clientW);
  expect(fit.stageRight).toBeLessThanOrEqual(fit.contentRight + 1);
});

test('in fullscreen the report\'s arrow keys and "/" stand down: the participant behind it stays selected', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(pathToFileURL(join(dir, 'two', 'report', 'index.html')).href + '#p-DEMO-FIXT');
  const selected = () => page.locator('.cohort-row.selected').getAttribute('data-pid');
  expect(await selected()).toBe('DEMO-FIXT');
  // The key that would move the selection to the other participant.
  const away = (await page.locator('.cohort-row').first().getAttribute('data-pid')) === 'DEMO-FIXT' ? 'ArrowDown' : 'ArrowUp';
  await page.locator('#p-DEMO-FIXT .replay-load-btn').click();
  const mount = page.locator('#p-DEMO-FIXT .replay-mount');
  await expect.poll(() => mount.evaluate((m) => !!(m._chReplayDebug && m._chReplayDebug.frameReady())), { timeout: 20000 }).toBe(true);
  const full = mount.locator('.replay-fullscreen');
  await full.click();
  await expect.poll(() => mount.evaluate((m) => document.fullscreenElement === m)).toBe(true);
  await page.keyboard.press(away);
  await page.keyboard.press('/');
  expect(await selected()).toBe('DEMO-FIXT');
  expect(await page.evaluate(() => document.activeElement === document.querySelector('.search-wrap input'))).toBe(false);
  expect(await mount.evaluate((m) => m.getBoundingClientRect().width)).toBeGreaterThan(0);
  await full.click();
  await expect.poll(() => mount.evaluate(() => !!document.fullscreenElement)).toBe(false);
  // Out of fullscreen, the same key moves the selection.
  await page.keyboard.press(away);
  await expect.poll(selected).toBe('DEMO-FIXT-2');
});
