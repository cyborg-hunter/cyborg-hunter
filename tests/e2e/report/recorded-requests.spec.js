// tests/e2e/report/recorded-requests.spec.js
// What a recording can make the CLI report's replay viewer request, in each
// engine. The report is opened from file:// and has no page policy, and its
// reconstruction frame allows images from anywhere (the report shows a
// recording's images by design), so the viewer's own handling of the
// recording is all that decides what is fetched. The sentinel server is the
// ground truth: a request the browser sent arrives there whatever an
// observer in the page saw.
//
// Every recording here also carries an ordinary <img> from the sentinel,
// which the report does load: a sentinel that heard nothing at all would mean
// the replay never mounted, not that the viewer refused anything.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, startSentinel, ROOT } from '../analyze/support.mjs';

const FIXT = join(ROOT, 'tests', 'fixtures', 'demo');
const EPOCH = '1785352263344';

// A one-participant report from the committed demo pair, the recording's
// first keyframe given the control image and whatever `mutate` adds.
function buildReport(sentinelUrl, mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'ch-e2e-requests-'));
  const rec = JSON.parse(readFileSync(join(FIXT, 'DEMO-FIXT-replay-' + EPOCH + '.json'), 'utf8'));
  const keyframe = rec.segments.find((s) => s.initial_dom);
  keyframe.initial_dom.children.unshift({ id: 900001, kind: 'element', tag: 'img', attrs: { src: sentinelUrl + '/control.png', alt: '' }, children: [] });
  mutate(rec, keyframe);
  writeFileSync(join(dir, 'DEMO-FIXT-replay-' + EPOCH + '.json'), JSON.stringify(rec));
  writeFileSync(join(dir, 'DEMO-FIXT.json'), readFileSync(join(FIXT, 'DEMO-FIXT.json'), 'utf8'));
  writeFileSync(join(dir, 'cyborg-hunter.config.json'), JSON.stringify({ filePattern: 'DEMO-*.json', participantIdField: 'participantId' }));
  execFileSync(process.execPath, [join(ROOT, 'bin', 'cyborg-hunter.js'), 'report', '--data', dir,
    '--output', join(dir, 'report'), '--no-visuals'],
  { cwd: dir, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, stdio: 'pipe' });
  return { url: pathToFileURL(join(dir, 'report', 'index.html')).href, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Loads the replay and walks it to the end of its first segment, so every
// recorded event there has been applied, then waits for the control image.
async function playThrough(page, sentinel) {
  await page.locator('.replay-load-btn:visible').first().click();
  const mount = page.locator('.replay-mount').first();
  await expect.poll(() => mount.evaluate((m) => !!(m._chReplayDebug && m._chReplayDebug.frameReady())), { timeout: 20000 }).toBe(true);
  await mount.evaluate((m) => m._chReplayDebug.seek(Number(m.querySelector('input[type=range]').max)));
  await expect.poll(() => sentinel.hits.includes('/control.png'), { timeout: 10000 }).toBe(true);
  await page.waitForTimeout(1000);   // room for anything else the walk set off
}

test('the children of a recorded <noscript> load nothing', async ({ page }) => {
  const sentinel = await startSentinel();
  const report = buildReport(sentinel.url, (rec, keyframe) => {
    keyframe.initial_dom.children.unshift({ id: 900002, kind: 'element', tag: 'noscript', attrs: {}, children: [
      { id: 900003, kind: 'element', tag: 'img', attrs: { src: sentinel.url + '/noscript.png', alt: '' }, children: [] }] });
  });
  try {
    await page.goto(report.url);
    await playThrough(page, sentinel);
    expect(sentinel.hits.filter((u) => u !== '/control.png')).toEqual([]);
  } finally {
    await sentinel.close();
    report.cleanup();
  }
});
