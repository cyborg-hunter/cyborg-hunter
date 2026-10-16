// tests/e2e/oneliner/bfcache.spec.js
// data-replay on a page without jsPsych, shown again from the back/forward
// cache. pagehide stops the recorder; the persisted pageshow starts a new
// recording (ch.js saves the pieces itself, and a resumed recording would
// overlap the pages in between, which the CLI cannot join), whose first
// segment is a keyframe whose extensions say { restored_from: "bfcache" }.
// The page's saved data carries both recordings, and they join in time order.
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
import { groupPieces, reassemblePieces } from '../../../src/replay/pieces.js';
import { mergeRecordings } from '../../../src/replay/merge.js';

const FIX = '/tests/e2e/oneliner/fixtures/';

test.use({
  channel: async ({ browserName }, use) => use(browserName === 'chromium' ? 'chromium' : undefined),
  launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] }
});

function chErrors(log) { return log.error.filter((t) => t.startsWith('[cyborg-hunter]')); }

test('back/forward cache: after Back the restored visit is a new recording, marked as a restore, saved beside the first', async ({ page, browserName }) => {
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
  const pieces = await page.evaluate(() => CyborgHunter.data().cyborgHunterReplay);
  const rec = await page.evaluate(() => CyborgHunter.replay());

  // replay(): the restored visit, from its keyframe on.
  expect(validateStrict(rec).errors).toEqual([]);
  expect(rec.participant_id).toBe('E2E-BFC-1');
  expect(rec.end_reason).toBe('finished');
  const first = rec.segments[0];
  expect(first.extensions && first.extensions['cyborg-hunter'] && first.extensions['cyborg-hunter'].restored_from).toBe('bfcache');
  expect(first.initial_dom).not.toBeNull();
  const values = (segs) => segs.flatMap((s) => s.events).filter((e) => e.type === 'input.value').map((e) => e.value);
  expect(values(rec.segments).some((v) => v === 'before after')).toBe(true);
  expect(values(rec.segments).some((v) => v === 'before')).toBe(false);

  // The saved data: both visits, as two recordings that join in time order.
  const groups = groupPieces(pieces);
  expect(groups.size).toBe(2);
  const recs = [...groups.values()].map((g) => reassemblePieces(g))
    .sort((a, b) => Date.parse(a.recording_started_at) - Date.parse(b.recording_started_at));
  for (const r of recs) expect(validateStrict(r).errors).toEqual([]);
  expect(values(recs[0].segments).some((v) => v === 'before')).toBe(true);
  expect(values(recs[0].segments).some((v) => v.includes('after'))).toBe(false);
  expect(() => mergeRecordings(recs)).not.toThrow();
  expect(chErrors(log)).toEqual([]);
});
