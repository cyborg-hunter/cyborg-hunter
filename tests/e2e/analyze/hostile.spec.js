// tests/e2e/analyze/hostile.spec.js
// A hostile dom-tier recording, loaded into the analyzer, makes the browser
// send no request off its own origin, in Chromium, Firefox and WebKit, on
// the hosted page and on the offline single file.
//
// The other analyze specs load benign sample data; this one loads a
// recording that carries every network-bearing construct a participant can
// put in a v2 file (hostile.mjs): SVG use/image/feImage/script/<a>/
// animate/set/foreignObject, MathML mglyph/annotation-xml, object/embed/
// iframe[srcdoc]/frame/portal/fencedframe, every <link rel>, <meta refresh>,
// <base>, <noscript><img>, <style> @import and url() in every property,
// media queries, @font-face, <form action>, <a ping>, <img srcset>,
// <video poster>, <source>, <track>, media_src, javascript: hrefs
// (upper-case, tab-split), XLINK:HREF, xml:base, on* handlers, root <html>
// attributes, crafted stylesheets[] entries, and dom.add/dom.attr/dom.text/
// canvas.snapshot patches carrying the same. It also carries shapes the
// viewer must play past without a page error (support.mjs's `test` fails on
// any): stylesheet ids that are not numbers, a value aimed at a file input,
// and a `children` that is not an array.
//
// The ground truth is a local sentinel server (startSentinel): a request the
// browser actually sent arrives there, whatever any in-page observer saw.
// The test asserts that the sentinel hears nothing, that no request to the
// sentinel completed (as opposed to being refused by the policy), that no
// window was opened, and that the page did not navigate.
import { pathToFileURL } from 'node:url';
import { test, expect, guardNetwork, siteAllowlist, waitReady, buildReport, reportSelected, startSentinel, settleRequests, OFFLINE_FILE } from './support.mjs';
import { makeHostileCohort } from './hostile.mjs';

async function mountHostileReplay(page) {
  await reportSelected(page);
  await page.selectOption('[data-role="replay-select"]', 'DEMO-FIXT');
  const load = page.locator('[data-action="load-replay"]');
  await load.scrollIntoViewIfNeeded();
  await load.click();
  const host = page.frameLocator('iframe.replay-host-frame[data-participant-id="DEMO-FIXT"]');
  const mount = host.locator('#ch-replay-mount');
  const recon = host.frameLocator('iframe.replay-frame');
  await expect.poll(() => mount.evaluate((m) => !!(m._chReplayDebug && m._chReplayDebug.frameReady())).catch(() => false), { timeout: 60000 }).toBe(true);
  // Walk the whole session so every patch (dom.add/attr/canvas.snapshot) is applied.
  await mount.evaluate((m) => m._chReplayDebug.seek(m._chReplayDebug.getPlayhead() + 1e6));
  // The hostile nodes really mounted (so a silent sentinel cannot be a
  // replay that never built), and the known defenses held.
  await expect(recon.locator('#added')).toHaveCount(1);
  await expect(recon.locator('#plain')).toHaveCount(2);   // the keyframe's, and the added copy's
  expect(await recon.locator('body link, body meta, body base, body script, body noscript').count()).toBe(0);
  expect(await recon.locator('body template img').count(), 'an <img> left under an inert element').toBe(0);
  const iframes = await recon.locator('iframe').evaluateAll((els) => els.map((e) => [e.getAttribute('src'), e.getAttribute('srcdoc'), e.getAttribute('data-ch-placeholder')]));
  for (const [src, srcdoc, ph] of iframes) expect([src, srcdoc, ph]).toEqual([null, null, 'iframe']);
  expect(await recon.locator('video[autoplay], [onload], [onclick]').count()).toBe(0);
  expect(await recon.locator('head style[data-ch-shell-rules]').count(), 'the viewer\'s own rules').toBe(1);
  return recon;
}

// A request to the sentinel that COMPLETED (was not refused by the policy):
// the true leak set. A reconstruction-frame load the policy refused
// (r.failure() set) is the policy working.
const completed = (seen, S) => seen.filter((r) => r.url().startsWith(S) && r.failure() === null).map((r) => r.url());

for (const where of ['hosted', 'offline']) {
  test('a hostile dom-tier recording leaks nothing from the ' + where + ' analyzer', async ({ page, baseURL }) => {
    test.setTimeout(240000);
    const sentinel = await startSentinel();
    const cohort = makeHostileCohort(sentinel.url);
    const url = where === 'hosted' ? baseURL + '/analyze/' : pathToFileURL(OFFLINE_FILE).href;
    const allow = where === 'hosted' ? siteAllowlist(baseURL) : [url];
    const popups = [];
    page.on('popup', (p) => popups.push(p.url() || '(window)'));
    // No route guard: the sentinel must be reachable, so that a leak shows.
    const seen = await guardNetwork(page, allow, { route: false });
    try {
      await page.goto(url);
      await waitReady(page);
      await page.setInputFiles('[data-role="file-input"]', cohort.files);
      await expect(page.locator('[data-role="counts"]')).toContainText('1 replay recording');
      await buildReport(page);
      await mountHostileReplay(page);
      await page.waitForTimeout(3000);
      await settleRequests(seen, allow);
      expect(sentinel.hits, 'the sentinel server heard a request').toEqual([]);
      expect(completed(seen, sentinel.url), 'a request to the sentinel completed').toEqual([]);
      expect(popups, 'a window the page opened').toEqual([]);
      expect(page.url(), 'the page navigated').toBe(url);
    } finally { cohort.cleanup(); await sentinel.close(); }
  });
}
