// tests/e2e/analyze/policy.spec.js
// The policy itself, not the page's code: every other spec asserts that the
// page as written makes no request, which a change that weakened the policy
// would pass as long as it requested nothing new. Here the test makes the
// attempts the page never makes, a fetch and an image from a sentinel server,
// inside every context that runs code: the page, the report frame, the
// replay host, the viewer's reconstruction frame and the analysis worker.
// No route guard (it would refuse the requests itself): only the policy
// stands between those contexts and the sentinel, which must hear nothing.
// With connect-src and img-src opened up, the sentinel hears every attempt
// below, the worker's included, in all three engines. The frames that run
// scripts must also report each refusal as a violation; the worker has no
// document to report one on, and the reconstruction frame no recorder in
// every engine, so for those two the sentinel alone is the check.
import { test, expect, guardNetwork, siteAllowlist, waitReady, buildReport, reportSelected, makeReplayCohort, startSentinel } from './support.mjs';

// Runs inside the context under test. A fetch and, where the context has
// images, an image load from the sentinel, each awaited to its end: refused,
// failed or answered, the sentinel is the judge, not the outcome.
async function attempt(u) {
  await fetch(u + '/fetch').catch(() => null);
  if (typeof Image === 'function') {
    await new Promise((ok) => { const img = new Image(); img.onload = img.onerror = ok; img.src = u + '/image.png'; });
  }
}

test('the policy refuses a fetch and an image from another address in every context', async ({ page, baseURL }) => {
  const sentinel = await startSentinel();
  const cohort = makeReplayCohort(null);
  await guardNetwork(page, siteAllowlist(baseURL), { route: false });
  try {
    // The sentinel does answer a request nothing refuses.
    await fetch(sentinel.url + '/control');
    expect(sentinel.hits).toEqual(['/control']);
    sentinel.hits.length = 0;

    await page.goto('/analyze/');
    await waitReady(page);
    await page.setInputFiles('[data-role="file-input"]', cohort.files);
    await buildReport(page);
    await reportSelected(page);
    await page.selectOption('[data-role="replay-select"]', 'DEMO-FIXT');
    await page.click('[data-action="load-replay"]');
    const mounted = page.frameLocator('iframe.replay-host-frame[data-participant-id="DEMO-FIXT"]').frameLocator('iframe.replay-frame').locator('style[data-ch-sheet="1"]');
    await expect(mounted).toHaveCount(1, { timeout: 30000 });

    const report = await (await page.$('iframe.analyze-report')).contentFrame();
    const host = await (await page.$('iframe.replay-host-frame')).contentFrame();
    const contexts = [['page', page.mainFrame()], ['report frame', report], ['replay host', host]];
    for (const [name, frame] of contexts) {
      await frame.evaluate(attempt, sentinel.url).catch((e) => { throw new Error(name + ': ' + e.message); });
    }
    // The reconstruction frame runs no scripts, so a test cannot run code in
    // it either (an evaluation there never settles). The replay host is its
    // same-origin parent: it adds an image to the frame's document, which
    // that document's policy governs, and waits for the load to settle.
    await host.evaluate((u) => {
      const doc = document.querySelector('iframe.replay-frame').contentDocument;
      const img = doc.createElement('img');
      img.src = u + '/reconstruction.png';
      doc.body.appendChild(img);
      return new Promise((ok) => { (function poll() { if (img.complete) ok(); else setTimeout(poll, 20); })(); });
    }, sentinel.url);
    const workers = page.workers();
    expect(workers.length, 'the analysis worker').toBe(1);
    await workers[0].evaluate(attempt, sentinel.url);

    expect(sentinel.hits, 'requests the sentinel received').toEqual([]);
    // The frames that run scripts also report each refusal as a violation.
    for (const [name, frame] of contexts) {
      const seen = await frame.evaluate(() => window.__cspViolations);
      expect(seen.some((v) => /^connect-src /.test(v) && v.includes(sentinel.url)), name + ': the fetch, refused: ' + seen.join('; ')).toBe(true);
      expect(seen.some((v) => /^img-src /.test(v) && v.includes(sentinel.url)), name + ': the image, refused: ' + seen.join('; ')).toBe(true);
    }
  } finally { cohort.cleanup(); await sentinel.close(); }
});
