// tests/e2e/report/root-attrs.spec.js
// A page that keeps its layout on <html> (custom properties on
// document.documentElement.style, as some experiment pages do) replays at its
// recorded size. The page (fixtures/html-vars.html) is recorded with the built
// recorder, the recording goes through bin/cyborg-hunter.js, and the card in
// the replay frame is measured where the participant clicked it: 120 px in the
// first segment, 60 px after the page narrowed it. Before <html>'s attributes
// were recorded, the card replayed at its auto width.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, ROOT } from '../analyze/support.mjs';

test.beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, 'build.js')], { cwd: ROOT, stdio: 'pipe' });
});

test('a card sized by --card-w on <html> replays at its recorded width, before and after the page changes it', async ({ page, browser }) => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-e2e-html-vars-'));
  try {
    await page.goto(pathToFileURL(join(ROOT, 'tests', 'e2e', 'report', 'fixtures', 'html-vars.html')).href);
    await page.click('#card');
    expect(await page.locator('#card').evaluate((el) => el.getBoundingClientRect().width)).toBe(120);
    await page.click('#next');
    await page.click('#card');
    expect(await page.locator('#card').evaluate((el) => el.getBoundingClientRect().width)).toBe(60);
    const recording = JSON.parse(await page.evaluate(() => window.__finish()));
    const epoch = Date.parse(recording.recording_started_at);
    writeFileSync(join(dir, 'HTMLVARS-1-replay-' + epoch + '.json'), JSON.stringify(recording));
    const data = readFileSync(join(ROOT, 'tests', 'fixtures', 'demo', 'DEMO-FIXT.json'), 'utf8');
    writeFileSync(join(dir, 'HTMLVARS-1.json'), data.split('DEMO-FIXT').join('HTMLVARS-1'));
    execFileSync(process.execPath, [join(ROOT, 'bin', 'cyborg-hunter.js'), 'report', '--data', dir,
      '--output', join(dir, 'report'), '--no-visuals'],
    { cwd: dir, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, stdio: 'pipe' });

    const report = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await report.goto(pathToFileURL(join(dir, 'report', 'index.html')).href);
    await report.locator('.replay-load-btn:visible').first().click();
    const mount = report.locator('.replay-mount').first();
    await expect.poll(() => mount.evaluate((m) => !!(m._chReplayDebug && m._chReplayDebug.frameReady())), { timeout: 20000 }).toBe(true);
    const frame = report.frameLocator('.replay-mount iframe.replay-frame').first();
    // The end of each segment: the walk has applied everything recorded in it.
    const widthAtEnd = async (seg) => {
      await mount.evaluate((m, s) => {
        const d = m._chReplayDebug;
        d.selectSegment(s);
        d.seek(Number(m.querySelector('input[type=range]').max));
      }, seg);
      return frame.locator('#card').evaluate((el) => el.getBoundingClientRect().width);
    };
    expect(await widthAtEnd(0)).toBe(120);
    expect(await widthAtEnd(1)).toBe(60);
    // The viewer's own alignment self-check agrees on each recorded click.
    const checks = await mount.evaluate((m) => m._chReplayDebug.getChecks().map((c) => c.type + ':' + c.status));
    expect(checks.filter((c) => c.startsWith('mouse.click'))).toEqual(['mouse.click:ok']);
    await report.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
