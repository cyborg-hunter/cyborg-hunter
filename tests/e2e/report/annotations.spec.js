// tests/e2e/report/annotations.spec.js
// The CLI report's annotations in each engine, opened from file://: a label
// and a note survive a reload (the report's own storage, under its run id),
// the rail mark and the counter follow, i/e/f set the label of the
// selected participant, the exports carry the labels, an import names the
// ids this report does not have, two tabs keep each other's changes, and a
// note is kept while it is still being typed. The report is built by
// bin/cyborg-hunter.js from the synthetic pilot (four participants).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, ROOT, PILOT_DIR } from '../analyze/support.mjs';

let dir;
test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ch-e2e-annotations-'));
  execFileSync(process.execPath, [join(ROOT, 'bin', 'cyborg-hunter.js'), 'report', '--output', join(dir, 'report'), '--no-visuals'],
    { cwd: PILOT_DIR, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, stdio: 'pipe' });
});
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

const openReport = (page) => page.goto(pathToFileURL(join(dir, 'report', 'index.html')).href);
// The glyph at the left of the row is drawn by the CSS from data-label.
const mark = (page, pid) => page.locator('.cohort-row[data-pid="' + pid + '"] .annot-mark');

test('a label and a note stay through a reload; the rail mark and the counter follow', async ({ page }) => {
  await openReport(page);
  const pane = page.locator('#p-SYN-HARD-03');
  const note = pane.getByRole('textbox', { name: 'Note on this participant' });
  await expect(page.locator('.annot-count')).toHaveText('0 of 4 reviewed');
  await expect(pane.locator('.annot-btn')).toHaveText(['✓ Include', '✗ Exclude', '⚑ Flag']);
  await pane.getByRole('button', { name: 'Exclude' }).click();
  await note.fill('answer pasted in trial 2');
  await note.blur();
  await expect(mark(page, 'SYN-HARD-03')).toHaveAttribute('data-label', 'exclude');
  await expect(mark(page, 'SYN-HARD-03')).toHaveAttribute('aria-label', 'Exclude');
  expect(await mark(page, 'SYN-HARD-03').evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"✗"');
  await expect(page.locator('.annot-count')).toHaveText('1 of 4 reviewed');
  await page.reload();
  await expect(pane.getByRole('button', { name: 'Exclude' })).toHaveAttribute('aria-pressed', 'true');
  await expect(note).toHaveValue('answer pasted in trial 2');
  await expect(page.locator('.annot-count')).toHaveText('1 of 4 reviewed');
  // The pressed label pressed again: not reviewed, the note kept.
  await pane.getByRole('button', { name: 'Exclude' }).click();
  await expect(page.locator('.annot-count')).toHaveText('0 of 4 reviewed');
  await expect(mark(page, 'SYN-HARD-03')).toHaveAttribute('data-label', '');
  // No glyph (an engine may report the unset content as either).
  expect(['none', 'normal']).toContain(await mark(page, 'SYN-HARD-03').evaluate((el) => getComputedStyle(el, '::before').content));
  await expect(note).toHaveValue('answer pasted in trial 2');
});

test('i, e and f label the participant on screen; the CSV and the JSON carry the labels', async ({ page }) => {
  await openReport(page);
  const runId = await page.locator('.run-id').textContent();
  await page.locator('.cohort-row[data-pid="SYN-SOFT-02"]').click();
  await page.keyboard.press('f');
  await expect(page.locator('#p-SYN-SOFT-02').getByRole('button', { name: 'Flag' })).toHaveAttribute('aria-pressed', 'true');
  await expect(mark(page, 'SYN-SOFT-02')).toHaveAttribute('data-label', 'flag');
  await page.getByLabel('count unreviewed as included').check();
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(csv.suggestedFilename()).toBe('annotations-' + runId + '.csv');
  const lines = readFileSync(await csv.path(), 'utf8').trim().split('\n');
  expect(lines[0]).toBe('participantId,tier,triageScore,label,note,annotatedAt,runId');
  // participantId, tier, label and runId of each row (no note holds a comma).
  expect(lines.slice(1).map((l) => { const c = l.split(','); return [c[0], c[1], c[3], c[6]]; })).toEqual([
    ['SYN-HARD-03', 'hard', 'include', runId], ['SYN-SOFT-02', 'soft', 'flag', runId], ['SYN-CLEAN-01', 'clean', 'include', runId],
    ['SYN-GENERATED-04', 'clean', 'include', runId]]);
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  const data = JSON.parse(readFileSync(await json.path(), 'utf8'));
  expect([data.format, data.runId, Object.keys(data.annotations)]).toEqual(['cyborg-hunter-annotations', runId, ['SYN-SOFT-02']]);
  expect(data.annotations['SYN-SOFT-02'].label).toBe('flag');
});

test('an import applies what this report has and names what it does not', async ({ page }) => {
  await openReport(page);
  const runId = await page.locator('.run-id').textContent();
  const file = join(dir, 'import.json');
  writeFileSync(file, JSON.stringify({ format: 'cyborg-hunter-annotations', runId, annotations: {
    'SYN-CLEAN-01': { label: 'include', note: 'fine', annotatedAt: '2026-10-05T09:00:00.000Z' },
    'SYN-OTHER-99': { label: 'exclude', note: '', annotatedAt: '2026-10-05T09:00:00.000Z' } } }));
  await page.locator('.annot-bar input[type="file"]').setInputFiles(file);
  await expect(page.locator('.annot-msg')).toHaveText('Imported 1 annotation. Not in this report: SYN-OTHER-99.');
  await expect(mark(page, 'SYN-CLEAN-01')).toHaveAttribute('data-label', 'include');
  await expect(page.locator('.annot-count')).toHaveText('1 of 4 reviewed');
});

test('two tabs of the same report keep each other\'s labels', async ({ page, context }) => {
  const other = await context.newPage();
  const otherErrors = [];
  other.on('pageerror', (err) => otherErrors.push(err.message));
  await openReport(page);
  await openReport(other);
  // Each tab labels a participant after both have loaded: neither has the
  // other's change in memory when it writes.
  await page.locator('#p-SYN-HARD-03').getByRole('button', { name: 'Exclude' }).click();
  await other.locator('.cohort-row[data-pid="SYN-SOFT-02"]').click();
  await other.locator('#p-SYN-SOFT-02').getByRole('button', { name: 'Flag' }).click();
  for (const p of [page, other]) {
    await p.reload();
    await expect(mark(p, 'SYN-HARD-03')).toHaveAttribute('data-label', 'exclude');
    await expect(mark(p, 'SYN-SOFT-02')).toHaveAttribute('data-label', 'flag');
    await expect(p.locator('.annot-count')).toHaveText('2 of 4 reviewed');
  }
  expect(otherErrors).toEqual([]);
});

test('a note still being typed is kept through a reload', async ({ page }) => {
  await openReport(page);
  const note = page.locator('#p-SYN-HARD-03').getByRole('textbox', { name: 'Note on this participant' });
  await note.fill('pasted, then typed over');
  await expect(note).toBeFocused();
  await page.reload();
  await expect(note).toHaveValue('pasted, then typed over');
});
