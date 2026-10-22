// tests/e2e/report/rail.spec.js
// The CLI report's rail in each engine, opened from file://: it opens sorted
// by score; a participant a Hard at rule moved (hard*) is badged HARD*, and
// the Hard filter, the counts and the Tier sort keep it with hard; the
// search finds signals by word; the label filter follows the annotations;
// the arrow keys follow the rail as it is shown; and the annotations CSV
// keeps triage order and writes hard*. The report is built by
// bin/cyborg-hunter.js from the bundled sessions (examples/demo-sessions)
// with hardAt { tabawayMedium: 3 }: DEMO-a3f3's three medium tab-aways move
// it from clean to hard*. Scores: 9mop 45, bsq6 21, 681w 13, a3f3 11.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, ROOT, SAMPLE_DIR } from '../analyze/support.mjs';

let dir;
test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ch-e2e-rail-'));
  const config = { ...JSON.parse(readFileSync(join(SAMPLE_DIR, 'cyborg-hunter.config.json'), 'utf8')),
    dataDir: join(SAMPLE_DIR, 'data'), hardAt: { tabawayMedium: 3 } };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  execFileSync(process.execPath, [join(ROOT, 'bin', 'cyborg-hunter.js'), 'report', '--config', join(dir, 'config.json'),
    '--output', join(dir, 'report'), '--no-visuals'], { cwd: SAMPLE_DIR, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, stdio: 'pipe' });
});
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

const openReport = (page) => page.goto(pathToFileURL(join(dir, 'report', 'index.html')).href);
// The rows as the rail shows them, top to bottom: all of them, or the ones
// no filter or search hides.
const order = (page) => page.locator('.cohort-row').evaluateAll((rs) => rs.map((r) => r.dataset.pid));
const shown = (page) => page.locator('.cohort-row').evaluateAll((rs) =>
  rs.filter((r) => getComputedStyle(r).display !== 'none').map((r) => r.dataset.pid));
const selected = (page) => page.locator('.cohort-row.selected').getAttribute('data-pid');

test('the rail opens sorted by score; hard* is badged HARD* and kept with hard by the counts, the Hard filter and the Tier sort', async ({ page }) => {
  await openReport(page);
  await expect(page.locator('.sort-wrap select')).toHaveValue('score');
  expect(await order(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6', 'DEMO-681w', 'DEMO-a3f3']);
  expect(await selected(page)).toBe('DEMO-9mop');
  await expect(page.locator('.topbar .meta')).toContainText('hard at: tabawayMedium 3');
  const a3f3 = page.locator('.cohort-row[data-pid="DEMO-a3f3"]');
  await expect(a3f3.locator('.tier-badge')).toHaveText('HARD*');
  await expect(page.locator('.filter-chip[data-filter="hard"]')).toHaveText('Hard 3');
  await expect(page.locator('.totals-row[data-tier="hard"] .count')).toHaveText('3');
  await expect(page.locator('.totals-row[data-tier="clean"] .count')).toHaveText('0');
  await page.locator('.filter-chip[data-filter="hard"]').click();
  expect(await shown(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6', 'DEMO-a3f3']);
  await page.locator('.sort-wrap select').selectOption('tier');
  expect(await order(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6', 'DEMO-a3f3', 'DEMO-681w']);
  await a3f3.click();
  await expect(page.locator('#p-DEMO-a3f3 .tier-pill')).toHaveText('HARD*');
});

test('the search: every word must match an id, the reason, or a signal the participant has', async ({ page }) => {
  await openReport(page);
  const search = page.locator('.search-wrap input');
  await search.fill('copy side');
  expect(await shown(page)).toEqual(['DEMO-681w']);
  expect(await selected(page)).toBe('DEMO-681w');
  await search.fill('zoom');
  expect(await shown(page)).toEqual(['DEMO-a3f3']);
  await search.fill('  9MOP ');
  expect(await shown(page)).toEqual(['DEMO-9mop']);
  await search.fill('drop');
  expect(await shown(page)).toEqual([]);
  await expect(page.locator('.detail')).toHaveAttribute('data-empty', 'true');
  await search.fill('');
  expect(await shown(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6', 'DEMO-681w', 'DEMO-a3f3']);
});

// Each block is one joined control: its buttons on one line, in the desktop
// rail (360px) and on a phone, the tier block with four three-digit counts
// too (the widest digits; a cohort of hundreds). The two blocks' buttons are
// one size.
for (const [width, height] of [[1280, 900], [375, 812]]) {
  test('each filter block sits on one line at ' + width + 'px, with three-digit counts too', async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openReport(page);
    await page.evaluate(() => document.fonts.ready);
    const lines = () => page.locator('.filter-chips').evaluateAll((blocks) => blocks.map((b) =>
      [b.getAttribute('aria-label'), new Set([...b.children].map((c) => Math.round(c.getBoundingClientRect().top))).size]));
    expect(await lines()).toEqual([['Tier', 1], ['Your label', 1]]);
    const size = (sel) => page.locator(sel).evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.fontFamily, s.fontSize, s.padding, Math.round(el.getBoundingClientRect().height)];
    });
    expect(await size('.filter-chip[data-label-filter="none"]')).toEqual(await size('.filter-chip[data-filter="hard"]'));
    await page.locator('.chip-n').evaluateAll((ns) => ns.forEach((n, i) => { n.textContent = ['888', '388', '308', '192'][i]; }));
    expect(await lines()).toEqual([['Tier', 1], ['Your label', 1]]);
  });
}

// DEMO-a3f3 and DEMO-681w swap places between the rail (by score: 681w,
// then a3f3) and the panes (triage order: a3f3, hard*, then 681w), so a
// label set in a3f3's pane must mark a3f3's row, not the row at a3f3's
// place in the rail.
test('the label filter follows the annotations; the arrow keys follow the rail as shown; the CSV keeps triage order with hard*', async ({ page }) => {
  await openReport(page);
  const runId = await page.locator('.run-id').textContent();
  await page.locator('.cohort-row[data-pid="DEMO-a3f3"]').click();
  await page.locator('#p-DEMO-a3f3').getByRole('button', { name: 'Exclude' }).click();
  await expect(page.locator('.cohort-row[data-pid="DEMO-a3f3"] .annot-mark')).toHaveAttribute('data-label', 'exclude');
  await expect(page.locator('.cohort-row[data-pid="DEMO-681w"] .annot-mark')).toHaveAttribute('data-label', '');
  await page.locator('.filter-chip[data-label-filter="exclude"]').click();
  expect(await shown(page)).toEqual(['DEMO-a3f3']);
  await page.locator('.filter-chip[data-label-filter="none"]').click();
  expect(await shown(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6', 'DEMO-681w']);
  expect(await selected(page)).toBe('DEMO-9mop');
  // A label set while Unmarked is shown takes the row out of it.
  await page.keyboard.press('f');
  expect(await shown(page)).toEqual(['DEMO-bsq6', 'DEMO-681w']);
  expect(await selected(page)).toBe('DEMO-bsq6');
  // All again; the arrow keys move in the rail's order (by score), not the
  // panes' (triage order puts a3f3, hard*, right after bsq6).
  await page.locator('.filter-chip[data-label-filter="all"]').click();
  await page.keyboard.press('ArrowDown');
  expect(await selected(page)).toBe('DEMO-681w');
  await page.keyboard.press('ArrowDown');
  expect(await selected(page)).toBe('DEMO-a3f3');
  await page.keyboard.press('ArrowUp');
  expect(await selected(page)).toBe('DEMO-681w');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const lines = readFileSync(await csv.path(), 'utf8').trim().split('\n');
  // participantId, tier, label and runId of each row (no note holds a comma).
  expect(lines.slice(1).map((l) => { const c = l.split(','); return [c[0], c[1], c[3], c[6]]; })).toEqual([
    ['DEMO-9mop', 'hard', 'flag', runId], ['DEMO-bsq6', 'hard', '', runId], ['DEMO-a3f3', 'hard*', 'exclude', runId],
    ['DEMO-681w', 'soft', '', runId]]);
});
