// tests/e2e/oneliner/bfcache.spec.js
// data-replay on a page without jsPsych, shown again from the back/forward
// cache. pagehide stops the recorder; the persisted pageshow resumes it, so
// what the participant does after pressing Back is in the same recording, in
// a keyframe segment whose extensions say { restoredFrom: "bfcache" }.
//
// Whether the engine really restored the page from the cache is checked, not
// assumed: the pageshow listener in the fixture saw persisted === true, and
// an in-memory value drawn at load survived. (A restore creates no new
// navigation entry; a fresh load after Back would have type back_forward.)
// Chromium needs two changes from Playwright's defaults to restore at all:
// the --disable-back-forward-cache launch flag dropped, and the full browser
// in new headless mode (channel 'chromium'), since the default headless shell
// reports BackForwardCacheDisabledForDelegate. A restore fires no load
// event, so goBack waits for the commit only. The oneliner project runs
// Chromium only, where the restore is required; run ad hoc in another
// engine, a page that engine loaded afresh skips the test with a note.

import { test, expect, collectConsole } from './support.mjs';
import { validateStrict } from '../../../src/shared/schema-v2-validator.js';

const FIX = '/tests/e2e/oneliner/fixtures/';

test.use({
  channel: async ({ browserName }, use) => use(browserName === 'chromium' ? 'chromium' : undefined),
  launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] }
});

function chErrors(log) { return log.error.filter((t) => t.startsWith('[cyborg-hunter]')); }

test('back/forward cache: the replay records on after Back, in a keyframe segment marked as a restore', async ({ page, browserName }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'vanilla-bfcache.html');
  await page.waitForFunction(() => typeof window.CyborgHunterReplay !== 'undefined');
  await page.waitForLoadState('load');
  const visit = await page.evaluate(() => window.__visit);

  await page.click('[data-ch-trial="q1"]');
  await page.locator('#answer').pressSequentially('before', { delay: 50 });
  await page.click('#away');
  await page.locator('p#away').waitFor();
  await page.goBack({ waitUntil: 'commit' });
  await page.locator('#answer').waitFor();
  // Shown: a restore's pageshow (the second entry), or a fresh load's first.
  await page.waitForFunction(() => Array.isArray(window.__shows) && window.__shows.length > 0 &&
    (window.__shows.length > 1 || document.readyState === 'complete'));

  const nav = await page.evaluate(() => ({
    visit: window.__visit,
    shows: window.__shows,
    type: performance.getEntriesByType('navigation')[0].type
  }));
  const restored = nav.visit === visit && nav.shows[nav.shows.length - 1] === true;
  test.info().annotations.push({ type: 'bfcache', description: browserName + ': ' + JSON.stringify({ restored, shows: nav.shows, navigationType: nav.type }) });
  if (browserName === 'chromium') expect(restored, JSON.stringify(nav)).toBe(true);
  else test.skip(!restored, browserName + ' loaded the page afresh after Back under Playwright (no back/forward-cache restore)');
  expect(nav.type).toBe('navigate');

  // The page the participant came back to: the textarea still holds "before".
  await expect(page.locator('#answer')).toHaveValue('before');
  await page.locator('#answer').pressSequentially(' after', { delay: 50 });
  await page.click('[data-ch-trial="q1"]');
  const rec = await page.evaluate(() => CyborgHunter.replay());

  expect(validateStrict(rec).errors).toEqual([]);
  expect(rec.participant_id).toBe('E2E-BFC-1');
  expect(rec.end_reason).toBe('finished');
  const marked = rec.segments.filter((s) => s.extensions && s.extensions['cyborg-hunter'] &&
    s.extensions['cyborg-hunter'].restoredFrom === 'bfcache');
  expect(marked).toHaveLength(1);
  const at = marked[0].index;
  expect(marked[0].initial_dom).not.toBeNull();
  expect(marked[0].initial_dom.id).toBe(1);
  // Before the restore: the typing before leaving. From it on: the typing after Back.
  const values = (segs) => segs.flatMap((s) => s.events).filter((e) => e.type === 'input.value').map((e) => e.value);
  expect(values(rec.segments.slice(0, at)).some((v) => v === 'before')).toBe(true);
  expect(values(rec.segments.slice(at)).some((v) => v === 'before after')).toBe(true);
  expect(values(rec.segments.slice(0, at)).some((v) => v.includes('after'))).toBe(false);
  expect(chErrors(log)).toEqual([]);
});
