// tests/e2e/report/rail.spec.js
// The CLI report's rail in each engine, opened from file://: it opens sorted
// by score; a participant a Hard at rule moved (hard*) is badged HARD*, and
// the Hard filter, the counts and the Tier sort keep it with hard; the
// search finds signals by word; the label filter follows the annotations;
// the chip a filter block has on is the one pressed (aria-pressed);
// the arrow keys follow the rail as it is shown; and the annotations CSV
// keeps triage order and writes hard*. The Weights… dialog re-scores,
// re-tiers and re-sorts the rail as its values change, the selection
// following under a tier filter; it is not a form (Enter does nothing,
// Close closes whatever a box holds, Escape closes, and the focus goes back
// to the button); the button says when the values differ from the run's;
// the annotations CSV keeps the run's tier and score; the top bar and the
// dialog lay out cleanly from a phone to a desktop. The report is built by
// bin/cyborg-hunter.js from the bundled sessions (examples/demo-sessions)
// with hardAt { tabawayMedium: 3 }: DEMO-a3f3's three medium tab-aways move
// it from clean to hard*. Scores: 9mop 45, bsq6 21, 681w 13, a3f3 11.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, ROOT, SAMPLE_DIR, panelRows } from '../analyze/support.mjs';

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
// Each chip of a block (by its filter attribute): its filter, its
// aria-pressed, and whether it is the active one.
const chips = (page, attr) => page.locator(`.filter-chip[${attr}]`).evaluateAll((cs, a) =>
  cs.map((c) => [c.getAttribute(a), c.getAttribute('aria-pressed'), c.classList.contains('active')]), attr);

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
  expect(await chips(page, 'data-filter')).toEqual([['all', 'false', false], ['hard', 'true', true], ['soft', 'false', false],
    ['clean', 'false', false]]);
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
  expect(await chips(page, 'data-label-filter')).toEqual([['all', 'false', false], ['none', 'false', false], ['include', 'false', false],
    ['exclude', 'true', true], ['flag', 'false', false]]);
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

// The Typing sort puts the verdict's level first (bsq6's highly suspicious;
// the other three are not assessed, then by score), unlike the Pointer sort
// (681w's clean verdict is level 0, ahead of the two not assessed).
test('the Typing and ID sorts', async ({ page }) => {
  await openReport(page);
  const sort = page.locator('.sort-wrap select');
  await sort.selectOption('typing');
  expect(await order(page)).toEqual(['DEMO-bsq6', 'DEMO-9mop', 'DEMO-681w', 'DEMO-a3f3']);
  await sort.selectOption('id');
  expect(await order(page)).toEqual(['DEMO-681w', 'DEMO-9mop', 'DEMO-a3f3', 'DEMO-bsq6']);
});

// Words only a signal gives, which no triage reason or id holds, matched by
// their start: "mous" begins "mouse", the pointer verdict's (bsq6 is at
// level 2; 681w's clean verdict is level 0), "cut" is a copy's and "pan"
// begins "panel", a sidebar event's. "ouse", inside "mouse" but at the
// start of no word, finds no one. The guard counts the rows it read, so it
// cannot pass on none.
test('the search finds participants by the start of a signal word no triage reason holds', async ({ page }) => {
  await openReport(page);
  const rows = page.locator('.cohort-row');
  await expect(rows).toHaveCount(4);
  expect(await rows.evaluateAll((rs) => [rs.length, rs.filter((r) =>
    /mous|ouse|cut|pan/.test(r.dataset.reason + ' ' + r.dataset.pid.toLowerCase())).length])).toEqual([4, 0]);
  const search = page.locator('.search-wrap input');
  await search.fill('mous');
  expect(await shown(page)).toEqual(['DEMO-bsq6']);
  await search.fill('ouse');
  expect(await shown(page)).toEqual([]);
  await search.fill('cut pan');
  expect(await shown(page)).toEqual(['DEMO-681w']);
});

// --- The Weights… dialog ---
// On this run a sidebar weight of 20 (3 by default) gives 681w 30 (1 paste,
// 1 copy, 1 sidebar event) and a3f3 28 (1 paste, 1 sidebar event, 3 medium
// tab-aways); 9mop (45) and bsq6 (21) have no sidebar event.
const weightsButton = (page) => page.locator('.weights-btn');
async function openDialog(page) {
  await weightsButton(page).click();
  const dialog = page.locator('#weights-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}
const rowScore = (page, pid) => page.locator(`.cohort-row[data-pid="${pid}"] .score`);
const badge = (page, pid) => page.locator(`.cohort-row[data-pid="${pid}"] .tier-badge`);
// The selected row, the panes shown, and the pane at the row's data-index
// (the panes keep triage order): the one pane shown must be that one.
const selection = (page) => page.evaluate(() => {
  const row = document.querySelector('.cohort-row.selected');
  const panes = [...document.querySelectorAll('.participant')];
  return { row: row ? row.dataset.pid : null, shown: panes.filter((p) => !p.hidden).map((p) => p.id),
    atIndex: row ? panes[+row.dataset.index].id : null };
});

test('a weight in the dialog re-scores and re-sorts the rail at once, and the pane follows; the button says when the values are edited', async ({ page }) => {
  await openReport(page);
  await expect(weightsButton(page)).toHaveText('Weights…');
  const dialog = await openDialog(page);
  const box = dialog.locator('[data-weight="sidebar"]');
  await expect(box).toHaveValue('3');
  // The slider, moved from the keyboard (End: its top, 20), moves its box.
  await dialog.locator('[data-slider="sidebar"]').focus();
  await page.keyboard.press('End');
  await expect(box).toHaveValue('20');
  await expect.poll(() => order(page)).toEqual(['DEMO-9mop', 'DEMO-681w', 'DEMO-a3f3', 'DEMO-bsq6']);
  await expect(rowScore(page, 'DEMO-681w')).toHaveText('30');
  await expect(rowScore(page, 'DEMO-a3f3')).toHaveText('28');
  await expect(weightsButton(page)).toHaveText('Weights… (edited)');
  // The run's value again: the run's order, and no mark.
  await box.fill('3');
  await expect(dialog.locator('[data-slider="sidebar"]')).toHaveValue('3');
  await expect.poll(() => order(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6', 'DEMO-681w', 'DEMO-a3f3']);
  await expect(weightsButton(page)).toHaveText('Weights…');
  await box.fill('20');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await page.locator('.cohort-row[data-pid="DEMO-681w"]').click();
  const pane = page.locator('#p-DEMO-681w');
  await expect(pane.locator('.score-big')).toHaveText('30');
  await expect(pane.locator('.score-term', { hasText: 'sidebar' }).locator('.contrib')).toHaveText('+20');
  await expect(pane.locator('.score-total')).toHaveText('Total: 30');
});

// Hard at adds HARD* to participants the library left soft or clean, and
// HARD* counts and filters with hard. Reset to defaults also takes away
// this run's own rule (tabawayMedium 3), so a3f3 goes back to clean and
// the button keeps its mark until that rule is typed back.
test('Hard at in the dialog moves participants into HARD*, which the Hard filter shows; Copy config gives the lines; Reset, then the run\'s rule again', async ({ page }) => {
  await openReport(page);
  await page.locator('.filter-chip[data-filter="hard"]').click();
  expect(await shown(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6', 'DEMO-a3f3']);
  const dialog = await openDialog(page);
  await dialog.locator('[data-weight="sidebar"]').fill('20');
  await dialog.locator('[data-hard="sidebar"]').fill('1');
  await expect(badge(page, 'DEMO-681w')).toHaveText('HARD*');
  await expect(badge(page, 'DEMO-a3f3')).toHaveText('HARD*');
  await expect(badge(page, 'DEMO-9mop')).toHaveText('HARD');
  await expect(page.locator('.filter-chip[data-filter="hard"] .chip-n')).toHaveText('4');
  await expect(page.locator('.totals-row[data-tier="hard"] .count')).toHaveText('4');
  await expect(page.locator('.totals-row[data-tier="soft"] .count')).toHaveText('0');
  // The Hard filter is a style rule on each row's data-tier: it shows them, by score.
  await expect.poll(() => shown(page)).toEqual(['DEMO-9mop', 'DEMO-681w', 'DEMO-a3f3', 'DEMO-bsq6']);
  // The shown text, not the clipboard: an engine may refuse the clipboard
  // from file://, and the panel then selects the text and says so.
  await dialog.getByRole('button', { name: 'Copy config' }).click();
  await expect(dialog.locator('.wp-config')).toBeVisible();
  expect(JSON.parse(await dialog.locator('.wp-config').textContent()))
    .toEqual({ scoreWeights: { sidebar: 20 }, hardAt: { tabawayMedium: 3, sidebar: 1 } });
  await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(badge(page, 'DEMO-681w')).toHaveText('SOFT');
  await expect(badge(page, 'DEMO-a3f3')).toHaveText('clean');
  await expect(page.locator('.filter-chip[data-filter="hard"] .chip-n')).toHaveText('2');
  await expect.poll(() => shown(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6']);
  await expect(weightsButton(page)).toHaveText('Weights… (edited)');
  await dialog.locator('[data-hard="tabawayMedium"]').fill('3');
  await expect(badge(page, 'DEMO-a3f3')).toHaveText('HARD*');
  await expect(weightsButton(page)).toHaveText('Weights…');
});

// Under a tier filter, a re-score keeps the selected row selected while the
// filter still shows it, wherever the sort moves it; when the row leaves
// the filter, the top row shown is selected; when the filter is left
// empty, no pane shows. The pane shown is always the selected row's.
test('after a re-score under a tier filter the selection stays, moves to the top row shown, or empties, with the selected row\'s pane', async ({ page }) => {
  await openReport(page);
  await page.locator('.filter-chip[data-filter="hard"]').click();
  await page.locator('.cohort-row[data-pid="DEMO-a3f3"]').click();
  let dialog = await openDialog(page);
  // a3f3 (hard*) moves above bsq6 and stays selected.
  await dialog.locator('[data-weight="sidebar"]').fill('20');
  await expect.poll(() => shown(page)).toEqual(['DEMO-9mop', 'DEMO-a3f3', 'DEMO-bsq6']);
  expect(await selection(page)).toEqual({ row: 'DEMO-a3f3', shown: ['p-DEMO-a3f3'], atIndex: 'p-DEMO-a3f3' });
  // Without the run's Hard at rule a3f3 is clean, and leaves the filter.
  await dialog.locator('[data-hard="tabawayMedium"]').fill('');
  await expect.poll(() => shown(page)).toEqual(['DEMO-9mop', 'DEMO-bsq6']);
  expect(await selection(page)).toEqual({ row: 'DEMO-9mop', shown: ['p-DEMO-9mop'], atIndex: 'p-DEMO-9mop' });
  await dialog.getByRole('button', { name: 'Close' }).click();
  // Soft holds 681w alone; Hard at sidebar 1 takes it out.
  await page.locator('.filter-chip[data-filter="soft"]').click();
  expect(await selection(page)).toEqual({ row: 'DEMO-681w', shown: ['p-DEMO-681w'], atIndex: 'p-DEMO-681w' });
  dialog = await openDialog(page);
  await dialog.locator('[data-hard="sidebar"]').fill('1');
  await expect.poll(() => shown(page)).toEqual([]);
  await expect(page.locator('.detail')).toHaveAttribute('data-empty', 'true');
  expect(await selection(page)).toEqual({ row: null, shown: [], atIndex: null });
});

test('Enter in a box of the dialog leaves it open, with the value applied', async ({ page }) => {
  await openReport(page);
  const dialog = await openDialog(page);
  const box = dialog.locator('[data-weight="sidebar"]');
  await box.fill('20');
  await box.press('Enter');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog).toBeVisible();
  await expect(rowScore(page, 'DEMO-681w')).toHaveText('30');
});

// The panel reads a box more leniently than the browser's own checks of its
// min and step would (a cap of 2.5 is 2, Hard at 0 is none, points under 0
// are the default), and nothing in the dialog submits, so those checks never
// run. 9mop: 4 pastes at the default 5, 4 copies capped at 2 at 5, and 5
// tab-aways at 1: 35.
test('Close closes the dialog whatever its boxes hold, and the rail keeps the score they give', async ({ page }) => {
  await openReport(page);
  const dialog = await openDialog(page);
  await dialog.locator('[data-max="copy"]').fill('2.5');
  await dialog.locator('[data-hard="sidebar"]').fill('0');
  await dialog.locator('[data-weight="paste"]').fill('-1');
  await expect(rowScore(page, 'DEMO-9mop')).toHaveText('35');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(rowScore(page, 'DEMO-9mop')).toHaveText('35');
});

// Closed by Close or by Escape, the dialog hands the focus back to the
// button that opened it (WebKit leaves it on the closed dialog unless the
// page moves it), and keeps its values.
test('after Close and after Escape the focus is back on the Weights… button', async ({ page }) => {
  await openReport(page);
  let dialog = await openDialog(page);
  await dialog.locator('[data-weight="sidebar"]').fill('20');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(weightsButton(page)).toBeFocused();
  dialog = await openDialog(page);
  await dialog.locator('[data-weight="sidebar"]').focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(weightsButton(page)).toBeFocused();
  await expect(dialog.locator('[data-weight="sidebar"]')).toHaveValue('20');
});

// The dialog changes the page only: each row keeps the run's tier and score
// beside the ones it shows (data-run-tier, data-run-score), and the
// annotations CSV writes the run's, in triage order.
test('after a slider change the annotations CSV keeps the run\'s tier and score; the rail shows the new ones', async ({ page }) => {
  await openReport(page);
  const dialog = await openDialog(page);
  await dialog.locator('[data-slider="sidebar"]').focus();
  await page.keyboard.press('End');
  await dialog.locator('[data-hard="sidebar"]').fill('1');
  const row = page.locator('.cohort-row[data-pid="DEMO-681w"]');
  await expect(row.locator('.score')).toHaveText('30');
  await expect(row.locator('.tier-badge')).toHaveText('HARD*');
  expect(await row.evaluate((r) => [r.dataset.score, r.dataset.reportTier, r.dataset.runScore, r.dataset.runTier]))
    .toEqual(['30', 'hard*', '13', 'soft']);
  await dialog.getByRole('button', { name: 'Close' }).click();
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const lines = readFileSync(await csv.path(), 'utf8').trim().split('\n').map((l) => l.split(',').slice(0, 3));
  expect(lines).toEqual([['participantId', 'tier', 'triageScore'],
    ['DEMO-9mop', 'hard', '45'], ['DEMO-bsq6', 'hard', '21'], ['DEMO-a3f3', 'hard*', '11'], ['DEMO-681w', 'soft', '13']]);
});

// The top bar with the edited label, its longest (beside this run's Hard at
// note): from 1100px the run line sits beside the title; from 721 to 1099px
// it takes its own row under the title and the buttons; at 720px and under
// it sits between the title and the buttons, which share a row. At every
// width nothing overlaps, nothing passes the bar or the window, no text is
// cut, and the two buttons are one height, each label on one line.
for (const width of [1280, 1100, 1099, 721, 720, 375]) {
  test('the top bar at ' + width + 'px with the edited label: laid out for its width, nothing clipped or overlapping', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openReport(page);
    const dialog = await openDialog(page);
    await dialog.locator('[data-weight="sidebar"]').fill('20');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(weightsButton(page)).toHaveText('Weights… (edited)');
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => {
      const bar = document.querySelector('.topbar');
      const els = { title: bar.querySelector('h1'), meta: bar.querySelector('.meta'), weights: bar.querySelector('.weights-btn'),
        legend: bar.querySelector('.legend-btn') };
      // A label on one line: every box of its text sits on the same line.
      const oneLine = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()];
        return Math.max(...rects.map((r) => r.top)) - Math.min(...rects.map((r) => r.top)) < Math.min(...rects.map((r) => r.height)) / 2;
      };
      const parts = {};
      for (const [k, el] of Object.entries(els)) {
        const r = el.getBoundingClientRect();
        parts[k] = { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height,
          cut: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight, oneLine: oneLine(el) };
      }
      const b = bar.getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth - window.innerWidth, innerWidth: window.innerWidth,
        bar: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }, parts };
    });
    const { bar, parts } = m;
    const names = Object.keys(parts);
    expect(m.scroll, 'no sideways scroll').toBeLessThanOrEqual(0);
    expect(names.filter((k) => parts[k].left < bar.left - 0.5 || parts[k].right > Math.min(bar.right, m.innerWidth) + 0.5 ||
      parts[k].top < bar.top - 0.5 || parts[k].bottom > bar.bottom + 0.5), 'outside the bar').toEqual([]);
    expect(names.filter((k) => parts[k].cut), 'text cut').toEqual([]);
    const overlapping = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = parts[names[i]];
        const c = parts[names[j]];
        if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) overlapping.push(names[i] + '/' + names[j]);
      }
    }
    expect(overlapping, 'overlapping').toEqual([]);
    expect([parts.weights.oneLine, parts.legend.oneLine], 'each label on one line').toEqual([true, true]);
    expect(Math.abs(parts.weights.height - parts.legend.height), 'the buttons\' heights').toBeLessThan(0.5);
    const sameRow = (a, c) => a.top < c.bottom && c.top < a.bottom;
    const { title, meta, weights, legend } = parts;
    if (width >= 1100) {
      expect([sameRow(meta, title), sameRow(weights, title), sameRow(legend, title)], 'one row').toEqual([true, true, true]);
    } else if (width >= 721) {
      expect([sameRow(weights, title), sameRow(legend, title)], 'the buttons beside the title').toEqual([true, true]);
      expect(meta.top, 'the run line on a row of its own below').toBeGreaterThanOrEqual(Math.max(title.bottom, weights.bottom, legend.bottom) - 0.5);
    } else {
      expect(meta.top, 'the run line under the title').toBeGreaterThanOrEqual(title.bottom - 0.5);
      expect(weights.top, 'the buttons under the run line').toBeGreaterThanOrEqual(meta.bottom - 0.5);
      expect(sameRow(weights, legend), 'the two buttons on one row').toBe(true);
    }
  });
}

// At 375px each panel row stacks (the name, the slider, then the three
// boxes under their captions): the slider's track ends where the boxes do
// (neither past their right edge nor short of it), nothing in a row
// overlaps, no name is cut, and the dialog does not scroll sideways or pass
// the window.
test('the dialog at 375px: each slider ends where its boxes do; nothing overlaps, is cut or passes the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openReport(page);
  const dialog = await openDialog(page);
  await page.evaluate(() => document.fonts.ready);
  const rows = await panelRows(dialog.locator('.wp-row'));
  expect(rows.length).toBe(20);
  expect(rows.filter((r) => Math.abs(r.pastBoxes) > 0.5 || r.pastLeft > 0.5 || r.overlaps || r.cut)).toEqual([]);
  expect(await dialog.evaluate((d) => {
    const r = d.getBoundingClientRect();
    return [d.scrollWidth <= d.clientWidth, r.left >= 0 && r.right <= window.innerWidth];
  })).toEqual([true, true]);
});
