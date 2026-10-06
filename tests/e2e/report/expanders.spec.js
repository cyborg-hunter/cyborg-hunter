// tests/e2e/report/expanders.spec.js
// The CLI report's expand controls, clicked in each engine: the paste-evidence
// toggle shows a long paste's full text and hides it again. The report is
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
