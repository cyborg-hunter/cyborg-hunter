// demo/tests/handoff.spec.js
// The tour's last step hands the visitor's five files to the analyzer
// (demo/handoff.js, demo/analyze/main.js): one click, the same tab, nothing
// uploaded. Then the visitor's own replay in the analyzer's replay card: the
// viewer checks the tour used to run on its embedded report's replay.
// Chromium only, like tour.spec.js (helpers.mjs's mocks).

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect, fastForwardToFiles, pid } from './helpers.mjs';
import { guardNetwork, assertOnlyAllowed, siteAllowlist, buildReport, railOrder, reportSelected, waitReady } from '../../tests/e2e/analyze/support.mjs';
import { buildViewerModel } from '../../src/replay/viewer-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Synthetic replays for the viewer checks below are the repo's own
// SessionRecording v2 conformance fixtures, turned into viewer models by the
// real buildViewerModel (the conversion the analyzer's worker runs). The
// viewer has been v2-only since 0.8.0.
const V2_FIXTURES = resolve(__dirname, '..', '..', 'packages', 'sessionrecording-conformance', 'fixtures');
const viewerModelFromFixture = (name) =>
  buildViewerModel(JSON.parse(readFileSync(join(V2_FIXTURES, name + '.json'), 'utf8')));

// From the files step: "Open in the analyzer", until the analyze page lists
// the five files (the hash dropped once read). Returns the visitor's id,
// read on the tour before it is left.
async function openInAnalyzer(page) {
  const participantId = await pid(page);
  await page.locator('[data-action="open-analyzer"]').click();
  await expect(page).toHaveURL(/\/analyze\/$/, { timeout: 30000 });
  await expect(page.locator('[data-role="file-rows"] tr')).toHaveCount(5, { timeout: 30000 });
  return participantId;
}

// From a fresh tour to the visitor's replay mounted in the analyzer's replay
// card: the files step, the hand-off, the build, the visitor's replay loaded.
// Returns the replay host's frame.
async function visitorReplay(page, answer) {
  await fastForwardToFiles(page, answer);
  const participantId = await openInAnalyzer(page);
  await buildReport(page);
  // The report selects its first row on load and moves the replay dropdown
  // there; wait for that before choosing the visitor's replay.
  await reportSelected(page);
  await page.selectOption('[data-role="replay-select"]', participantId);
  await page.click('[data-action="load-replay"]');
  const host = page.frameLocator('iframe.replay-host-frame[data-participant-id="' + participantId + '"]');
  await host.locator('#ch-replay-mount .replay-stage').waitFor({ timeout: 30000 });
  return host;
}

// ---------------------------------------------------------------------------
// The hand-off: the five files arrive as one drop, under the analyze page's
// own guard: after the tour, the only requests are the two example files the
// tour fetches for the hand-off and the analyze page's own files.
// ---------------------------------------------------------------------------
test('"Open in the analyzer" hands over the five files: listed as dropped, built, nothing requested beyond the site', async ({ page, baseURL }) => {
  test.setTimeout(120000);
  await fastForwardToFiles(page);
  const allow = siteAllowlist(baseURL).concat([baseURL + '/assets/example-1.json', baseURL + '/assets/example-2.json']);
  const seen = await guardNetwork(page, allow);
  const participantId = await openInAnalyzer(page);
  const listed = await page.locator('[data-role="file-rows"] tr td:first-child').allTextContents();
  expect(listed.filter((p) => p !== participantId + '.json' && !p.startsWith(participantId + '-replay-')).sort())
    .toEqual(['cyborg-hunter.config.json', 'example-1.json', 'example-2.json']);
  await expect(page.locator('[data-role="counts"]')).toContainText('3 data files');
  await expect(page.locator('[data-role="counts"]')).toContainText('1 replay recording');
  await expect(page.locator('[data-role="config-source"]')).toContainText('cyborg-hunter.config.json');
  await expect(page.locator('[data-role="id-field"]')).toHaveValue('participantId');
  await buildReport(page);
  expect((await railOrder(page)).sort()).toEqual([participantId, 'example-1', 'example-2'].sort());
  await assertOnlyAllowed(page, seen, allow);
});

// ---------------------------------------------------------------------------
// Replay viewer: keycast overlay (walkthrough item 8) + DOM-tier
// reconstruction (walkthrough item 12's regression pin). Types the real
// answer ('Canberra') at baseline so trial 0's recording carries real
// keydown/keyup events (keys:'full' is the recorder default) AND a real
// input value to reconstruct, then presses play over that segment in the
// replay viewer's own mount and checks a keycast chip appears.
//
// History: item 8(b) found that DOM-tier input-value playback did NOT land
// visibly in the demo's own replay — the report iframe is sandbox=
// "allow-scripts" (deliberately opaque-origin), and nesting the replay's
// OWN reconstruction iframe (sandbox="allow-same-origin") inside that forced
// it opaque too (a double-sandbox intersection), so contentDocument access
// failed and the reconstruction froze at the first frame. Item 8 shipped
// keycast as the workaround (drawn in the OUTER document, unaffected).
// Item 12 fixes the root cause: the replay now mounts in its OWN same-origin
// viewer-host iframe (.replay-host-frame), a SIBLING of the report iframe
// rather than nested inside it, so its inner reconstruction frame
// (.replay-frame) is only one sandbox deep and stays same-origin. The
// analyzer's replay card mounts it the same way. This test asserts the
// reconstructed field actually shows 'Canberra' — the exact thing that was
// blank before.
// ---------------------------------------------------------------------------
test('replay: keycast overlay shows a chip during typed playback; DOM-tier reconstruction shows the typed value; a redacted-keystroke recording renders the redacted chip', async ({ page }) => {
  test.setTimeout(120000);
  const host = await visitorReplay(page, 'Canberra');
  const hostMount = host.locator('#ch-replay-mount');

  // Keycast: rewind to the start and press play through the typed segment;
  // a chip must appear at some point during playback.
  await hostMount.evaluate((m) => { m._chReplayDebug.seek(0); });
  await hostMount.locator('.replay-play').click();
  await expect(hostMount.locator('.replay-keycast .replay-key-chip').first()).toBeVisible({ timeout: 5000 });
  await hostMount.locator('.replay-play').click(); // stop

  // Regression pin (item 12): seek past the typed segment (seek() clamps to
  // the trial's own duration, so an overshoot lands exactly at its end) and
  // read the reconstructed field one level deeper, inside the DOM-tier
  // reconstruction iframe itself — this is what came back blank before the
  // host fix, because that inner iframe used to be nested two sandboxes
  // deep (inside the opaque report iframe). The host is same-origin, so
  // this inner frame stays same-origin and the reconstructed value is
  // readable, live, the same way a real analyst would see it.
  await hostMount.evaluate((m) => { m._chReplayDebug.seek(999999); });
  const reconstructedAnswer = host.frameLocator('.replay-frame').locator('textarea');
  await expect(reconstructedAnswer).toHaveValue('Canberra', { timeout: 5000 });

  // Redacted keystroke: the v2 `redacted` fixture (the demo's own recording
  // never touches a redacted field), mounted directly in the host frame's
  // document — the same document the real model above already loaded
  // window.initChReplayViewer into. Seeked to the first redacted key.down.
  const redactedModel = viewerModelFromFixture('redacted');
  const firstRedactedDown = redactedModel.segments[0].events.find((e) => e.type === 'key.down' && e.redacted).t;
  const redactedChipShown = await host.locator('body').evaluate((bodyEl, [model, t]) => {
    const testMount = document.createElement('div');
    bodyEl.appendChild(testMount);
    window.initChReplayViewer(testMount, model);
    testMount._chReplayDebug.seek(t + 1); // just after the redacted key.down, before its key.up
    return !!testMount.querySelector('.replay-key-chip--redacted');
  }, [redactedModel, firstRedactedDown]);
  expect(redactedChipShown).toBe(true);
});

// ---------------------------------------------------------------------------
// Replay viewer: self-explanatory buffer-cap note (walkthrough item 9).
// The demo's own recording never crosses the cap, so this mounts the v2
// `truncated` fixture (a `recording.capture_stopped` event that states its
// own cap, limit_events: 12) through the same direct-mount path as the
// redacted-keystroke check above, in the same-origin viewer host.
// ---------------------------------------------------------------------------
test('replay: buffer-cap note explains itself when captureStopped is set', async ({ page }) => {
  test.setTimeout(120000);
  const host = await visitorReplay(page);

  const result = await host.locator('body').evaluate((bodyEl, model) => {
    const mount = document.createElement('div');
    bodyEl.appendChild(mount);
    window.initChReplayViewer(mount, model);
    const details = mount.querySelector('[data-ch-cap-note]');
    return {
      found: !!details,
      initiallyOpen: details ? details.hasAttribute('open') : null,
      text: details ? details.textContent : null,
    };
  }, viewerModelFromFixture('truncated'));

  expect(result.found).toBe(true);
  expect(result.initiallyOpen).toBe(false); // collapsed by default, expandable on click
  expect(result.text).toContain('12 events'); // the recording's own stated cap, not a hardcoded default
  expect(result.text).toMatch(/buffer/i); // the stated reason, in the summary
  expect(result.text).toMatch(/Absence of evidence after this point is not evidence of absence/); // no "nothing happened" overclaim
});

// ---------------------------------------------------------------------------
// Replay viewer: continuous whole-session playback, default ON
// (walkthrough item 10). The v2 `segment-bounds` fixture has two short
// segments (480ms, 400ms), so a play from segment 1 reaches segment 2 well
// inside the timeout. Mounted in the analyzer's same-origin viewer host,
// where DOM-tier reconstruction works (the opaque report iframe would freeze
// it).
// ---------------------------------------------------------------------------
test('replay: continuous playback crosses trial boundaries by default; the pause toggle restores per-trial stopping', async ({ page }) => {
  test.setTimeout(120000);
  const host = await visitorReplay(page);

  await host.locator('body').evaluate((bodyEl, model) => {
    const mount = document.createElement('div');
    mount.setAttribute('data-testid', 'ch-multitrial-mount');
    bodyEl.appendChild(mount);
    window.initChReplayViewer(mount, model);
  }, viewerModelFromFixture('segment-bounds'));
  const mount = host.locator('[data-testid="ch-multitrial-mount"]');

  await expect(mount.locator('.replay-session-pos')).toHaveText('Segment 1 of 2');

  // Default: continuous ON (pause-at-boundaries toggle unchecked).
  await expect(mount.locator('.replay-pause-checkbox')).not.toBeChecked();
  await mount.locator('.replay-play').click();
  await expect(mount.locator('.replay-session-pos')).toHaveText('Segment 2 of 2', { timeout: 3000 });
  await mount.locator('.replay-play').click(); // stop (if still playing) or no-op restart guard below
  await mount.evaluate((m) => { m._chReplayDebug.selectSegment(0); });

  // Pause-at-boundaries ON: restores per-segment stopping (original behavior).
  await mount.locator('.replay-pause-checkbox').check();
  await expect(mount.locator('.replay-play')).toHaveAttribute('aria-label', 'Play');
  await mount.locator('.replay-play').click();
  await expect(mount.locator('.replay-play')).toHaveAttribute('aria-label', 'Play', { timeout: 3000 }); // stopped itself
  await expect(mount.locator('.replay-session-pos')).toHaveText('Segment 1 of 2'); // did not advance
});

// The hand-off record itself. Written and read here with the plain IndexedDB
// API (the format demo/handoff.js stores, as tests/e2e/analyze/site.spec.js
// writes it), on whichever page of the site is open: same origin, same
// database.
function storeRecord(page, createdAt) {
  return page.evaluate((at) => new Promise((resolve, reject) => {
    const req = indexedDB.open('cyborg-hunter-handoff', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('files', 'readwrite');
      tx.objectStore('files').put({ createdAt: at, files: [{ path: 'DEMO-LEFT.json',
        blob: new Blob(['{"participantId":"DEMO-LEFT"}'], { type: 'application/json' }) }] }, 'demo');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), createdAt);
}
function recordStored(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('cyborg-hunter-handoff', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const get = req.result.transaction('files').objectStore('files').get('demo');
      get.onsuccess = () => { req.result.close(); resolve(get.result !== undefined); };
      get.onerror = () => reject(get.error);
    };
  }));
}

// ---------------------------------------------------------------------------
// A record older than the hand-off window (HANDOFF_MAX_AGE_MS, 10 minutes)
// was left by a hand-off whose analyzer page never opened: the analyzer
// lists nothing from it, and deletes it as it reads it.
// ---------------------------------------------------------------------------
test('a stale hand-off record opens nothing in the analyzer and is deleted as it is read', async ({ page }) => {
  await page.goto('/analyze/');
  await waitReady(page);
  await storeRecord(page, Date.now() - 11 * 60 * 1000);
  await page.evaluate(() => { location.hash = 'from-demo'; });
  await page.reload();
  await waitReady(page);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await expect.poll(() => recordStored(page)).toBe(false);
  await expect(page.locator('[data-role="files-panel"]')).toBeHidden();
  await expect(page.locator('[data-role="file-rows"] tr')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// A record whose navigation never happened does not wait for the next visit
// to the analyzer: the tour deletes it when it loads.
// ---------------------------------------------------------------------------
test('the tour deletes a leftover hand-off record when it loads', async ({ page }) => {
  await page.goto('/');
  await page.locator('#card h2').waitFor();
  await storeRecord(page, Date.now());
  expect(await recordStored(page)).toBe(true);
  await page.reload();
  await page.locator('#card h2').waitFor();
  await expect.poll(() => recordStored(page)).toBe(false);
});

// ---------------------------------------------------------------------------
// A browser that will not store the files: the step says so, links the
// analyzer for a manual drop, and the button works again. The tour stays.
// ---------------------------------------------------------------------------
test('a refused hand-off keeps the visitor on the files step, says why, and enables the button again', async ({ page }) => {
  await fastForwardToFiles(page);
  await page.evaluate(() => { indexedDB.open = () => { throw new Error('refused by the test'); }; });
  const button = page.locator('[data-action="open-analyzer"]');
  await button.click();
  const note = page.locator('[data-role="handoff-note"]');
  await expect(note).toBeVisible();
  await expect(note).toContainText('would not keep the files');
  await expect(note.locator('a[href="analyze/"]')).toHaveCount(1);
  await expect(button).toBeEnabled();
  await expect(page.locator('#card h2')).toHaveText('Your files');
});

// ---------------------------------------------------------------------------
// Back from the analyzer can restore the tour from the back/forward cache as
// it was left, with "Open in the analyzer" disabled by the click that left.
// The restore's pageshow (persisted) enables it again. Playwright's Chromium
// runs without that cache, so the test dispatches the event itself.
// ---------------------------------------------------------------------------
test('a tour restored from the back/forward cache can open the analyzer again', async ({ page }) => {
  await fastForwardToFiles(page);
  const button = page.locator('[data-action="open-analyzer"]');
  await button.evaluate((b) => { b.disabled = true; });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(button).toBeEnabled();
});
