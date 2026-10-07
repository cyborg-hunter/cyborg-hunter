// tests/e2e/report/expanders.spec.js
// The CLI report's expand controls, clicked in each engine: the paste-evidence
// toggle shows a long paste's full text and hides it again, and a
// session-signal cell's "… +N more" opens the rest of its list. The report is
// built by bin/cyborg-hunter.js from tests/fixtures/cli/expanders-participant.json
// (its markup: tests/cli/report-expanders.test.js) and opened from file://.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, ROOT } from '../analyze/support.mjs';

let dir;
test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ch-e2e-expanders-'));
  copyFileSync(join(ROOT, 'tests', 'fixtures', 'cli', 'expanders-participant.json'), join(dir, 'EXP-1.json'));
  execFileSync(process.execPath, [join(ROOT, 'bin', 'cyborg-hunter.js'), 'report', '--data', dir,
    '--output', join(dir, 'report'), '--no-visuals'],
  { cwd: dir, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, stdio: 'pipe' });
});
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

const openReport = (page) => page.goto(pathToFileURL(join(dir, 'report', 'index.html')).href);

test('the paste toggle shows a long paste\'s full text, and hides it again', async ({ page }) => {
  await openReport(page);
  const entry = page.locator('#p-EXP-1 .paste-entry').first();
  await expect(entry.locator('.paste-preview')).toBeVisible();
  await expect(entry.locator('.paste-full')).toBeHidden();
  await entry.locator('.paste-toggle').click();
  await expect(entry.locator('.paste-full')).toBeVisible();
  await expect(entry.locator('.paste-full')).toContainText('END');
  await expect(entry.locator('.paste-preview')).toBeHidden();
  await expect(entry.locator('.paste-toggle')).toHaveAttribute('aria-expanded', 'true');
  await entry.locator('.paste-toggle').click();
  await expect(entry.locator('.paste-full')).toBeHidden();
  await expect(entry.locator('.paste-preview')).toBeVisible();
});

test('a session-signal cell\'s "… +3 more" opens the rest of its list', async ({ page }) => {
  await openReport(page);
  const cell = page.locator('#p-EXP-1 .sig-cell').filter({ hasText: 'Kb shortcuts' });
  await expect(cell.getByText('Ctrl+C', { exact: true })).toBeVisible();
  await expect(cell.getByText('Alt+Tab', { exact: true })).toBeHidden();
  await cell.getByText('… +3 more').click();
  await expect(cell.getByText('Alt+Tab', { exact: true })).toBeVisible();
  await expect(cell.getByText('Ctrl+T', { exact: true })).toBeVisible();
});
