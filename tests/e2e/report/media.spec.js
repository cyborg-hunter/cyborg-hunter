// tests/e2e/report/media.spec.js
// The CLI report's replay viewer never requests a recording's video or audio:
// its frame policy has media-src 'none', as the analyze page's has, on every
// engine. The sentinel server is the ground truth: a request the browser sent
// arrives there whatever an observer in the page saw. The recording holds a
// <video src>, an <audio> known only by its media_src and a <video> with a
// <source>, all from the sentinel, and the test first checks they are in the
// reconstruction, so it cannot pass on a replay that never mounted them. The
// recorded image (makeReplayCohort) is allowed in the report and not checked.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, startSentinel, makeReplayCohort, ROOT } from '../analyze/support.mjs';

test('a replay opened in the CLI report requests none of the recorded media', async ({ page }) => {
  const sentinel = await startSentinel();
  const cohort = makeReplayCohort(sentinel.url, { media: true });
  try {
    execFileSync(process.execPath, [join(ROOT, 'bin', 'cyborg-hunter.js'), 'report', '--data', cohort.dir,
      '--output', join(cohort.dir, 'report'), '--no-visuals'],
    { cwd: cohort.dir, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, stdio: 'pipe' });
    await page.goto(pathToFileURL(join(cohort.dir, 'report', 'index.html')).href);
    await page.locator('.replay-load-btn:visible').first().click();
    const frame = page.frameLocator('.replay-mount iframe').first();
    await expect(frame.locator('video')).toHaveCount(2, { timeout: 20000 });
    const srcs = await frame.locator('video[src], audio[src], source[src]').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
    expect(srcs.map((s) => s.slice(sentinel.url.length)).sort()).toEqual(['/recorded.mp3', '/recorded.mp4', '/recorded.webm']);
    await page.waitForTimeout(2000);   // long enough for each engine's metadata preload to have gone out
    expect(sentinel.hits.filter((u) => u.startsWith('/recorded.'))).toEqual([]);
  } finally {
    await sentinel.close();
    cohort.cleanup();
  }
});
