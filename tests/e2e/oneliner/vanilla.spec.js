// tests/e2e/oneliner/vanilla.spec.js
// The one-line setup (dist/ch.js) on pages without jsPsych, in Chromium. Each
// spec drives a fixture page (fixtures/vanilla-*.html), takes what the page
// sends (the form POST's cyborgHunterData field, or the page's own fetch of
// CyborgHunter.data()), runs the CLI on it and asserts the counts.
//
// Expected spans come from the fixtures' header comments: a span is named
// after a data-ch-trial mark, or span-<index> without one, and is closed by
// the next mark, a POST submit or CyborgHunter.data(). Paste verdicts use the
// standard preset's hard paste threshold, 2 (src/shared/constants.js): one
// paste is soft, two are a hard trigger.

import { test, expect, collectConsole, pasteInto, newTmpDir, cleanupTmpDirs, saveAndReport, rewriteFixture } from './support.mjs';
import { MESSAGES } from '../../../src/oneliner/errors.js';

const FIX = '/tests/e2e/oneliner/fixtures/';
const FIELD = 'cyborgHunterData';

test.afterAll(() => cleanupTmpDirs());

function chErrors(log) { return log.error.filter((t) => t.startsWith('[cyborg-hunter]')); }

// A urlencoded POST body → the parsed cyborgHunterData blob, or null.
function blobOf(body) {
  const v = new URLSearchParams(body || '').get(FIELD);
  return v === null ? null : JSON.parse(v);
}

// vanilla-form-page1.html → (POST /submit, answered with a redirect) →
// vanilla-form-page2.html → (form.submit() → POST /submit, answered 200).
// `pastes` paste into page 1's textarea before any mark; page 2 is typed only.
// Also returns whether a FormData the page builds from page 2's POST form
// (before that form is submitted) carries the field.
// `metaRedirect`: answer page 1's POST with a page that meta-refreshes to
// page 2 instead of an HTTP redirect. Playwright does not route the request
// an intercepted redirect leads to, so a rewritten page 2 needs a navigation
// of its own.
async function driveMultiPage(page, { pastes, metaRedirect = false }) {
  const bodies = [];
  await page.route('**/submit', async (route) => {
    bodies.push(route.request().postData());
    if (bodies.length === 1 && metaRedirect) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
        body: '<meta http-equiv="refresh" content="0;url=' + FIX + 'vanilla-form-page2.html">' });
    } else if (bodies.length === 1) {
      await route.fulfill({ status: 302, headers: { location: FIX + 'vanilla-form-page2.html' } });
    } else {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Thank you</p>' });
    }
  });

  await page.goto(FIX + 'vanilla-form-page1.html');
  for (let i = 0; i < pastes; i++) await pasteInto(page, '#answer1', 'pasted text ');
  await page.locator('#answer1').pressSequentially('typed on page 1', { delay: 120 });
  await page.click('#next');
  await page.waitForURL('**/vanilla-form-page2.html');

  const formData = await page.evaluate((field) => {
    const f = document.getElementById('form2');
    return {
      formData: new FormData(f).has(field),
      urlSearchParams: new URLSearchParams(new FormData(f)).has(field)
    };
  }, FIELD);

  await page.click('[data-ch-trial="page2-q1"]');
  await page.locator('#answer2').pressSequentially('typed on page 2', { delay: 120 });
  await page.click('#finish');   // form.submit(): no submit event
  await expect.poll(() => bodies.length).toBe(2);
  await page.getByText('Thank you').waitFor();
  return { bodies, formData };
}

// The second POST's blob: 3 trials (page 1's span-0; page 2's boot span
// span-1, closed by the mark; page2-q1, closed by the submit), 2 pages.
function expectTwoPageBlob(blob) {
  expect(blob.cyborgHunterOneLiner.pageCount).toBe(2);
  expect(blob.trials.map((t) => t.trialId)).toEqual(['span-0', 'span-1', 'page2-q1']);
  expect(blob.trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1, 2]);
  const origins = blob.trials.map((t) => t.integritySegment.pageOrigin);
  expect(new Set(origins).size).toBe(2);
  expect(origins[1]).toBe(origins[2]);   // both page-2 segments
}

test('multi-page form: hidden input on each submit, segments continue across pages, CLI reads the final blob', async ({ page }) => {
  const log = collectConsole(page);
  const { bodies, formData } = await driveMultiPage(page, { pastes: 1 });

  // A FormData the page builds itself does not get the field.
  expect(formData).toEqual({ formData: false, urlSearchParams: false });

  // Page 1's submit-button POST: page 1's one span.
  const first = blobOf(bodies[0]);
  expect(first, 'first POST carries ' + FIELD).not.toBeNull();
  expect(first.participantId).toBe('E2E-VAN-1');
  expect(first.cyborgHunterOneLiner.pageCount).toBe(1);
  expect(first.trials.map((t) => t.trialId)).toEqual(['span-0']);
  expect(first.trials[0].integrity.pasteEvents).toHaveLength(1);

  // Page 2's programmatic form.submit() POST: the whole session.
  const second = blobOf(bodies[1]);
  expect(second, 'form.submit() POST carries ' + FIELD).not.toBeNull();
  expect(second.participantId).toBe('E2E-VAN-1');
  expectTwoPageBlob(second);
  // A paste before the first boundary is counted, and only once.
  expect(second.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 0, 0]);
  expect(new URLSearchParams(bodies[1]).get('answer2')).toBe('typed on page 2');
  expect(chErrors(log)).toEqual([]);

  const out = saveAndReport(newTmpDir('van-multi'), 'E2E-VAN-1.json', JSON.stringify(second));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv).toHaveLength(1);
  expect(out.summaryCsv[0].participantId).toBe('E2E-VAN-1');
  expect(out.summaryCsv[0].totalPasteEvents).toBe('1');
  expect(out.summaryCsv[0].hardTriggered).toBe('no');   // 1 paste < standard threshold 2
});

test('multi-page form: two pastes on page 1 and a clean page 2 flag the participant HARD', async ({ page }) => {
  const { bodies } = await driveMultiPage(page, { pastes: 2 });
  const second = blobOf(bodies[1]);
  expectTwoPageBlob(second);
  expect(second.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([2, 0, 0]);

  const out = saveAndReport(newTmpDir('van-hard'), 'E2E-VAN-1.json', JSON.stringify(second));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].totalPasteEvents).toBe('2');
  expect(out.summaryCsv[0].hardTriggered).toBe('YES');
  expect(out.triage).toMatch(/\| E2E-VAN-1 \| \*\*HARD\*\* \|/);
});

test('multi-page form without a participant id: one random id across both pages, warned once', async ({ page }) => {
  // The same two pages, their ch.js tags without data-participant-id (and no
  // id in the URL).
  await rewriteFixture(page, '**/vanilla-form-page*.html', (html) => html.replace(' data-participant-id="E2E-VAN-1"', ''));
  const log = collectConsole(page);
  const { bodies } = await driveMultiPage(page, { pastes: 1, metaRedirect: true });

  const first = blobOf(bodies[0]);
  const second = blobOf(bodies[1]);
  expect(typeof first.participantId).toBe('string');
  expect(first.participantId).not.toBe('E2E-VAN-1');
  expect(second.participantId).toBe(first.participantId);
  // Warned on page 1 only: page 2 reuses the tab's id.
  expect(log.warn.filter((t) => t.startsWith('[cyborg-hunter] Participant rows cannot be linked')))
    .toEqual([MESSAGES.randomId(first.participantId)]);
  // Page 2 continued page 1's session rather than starting a new one.
  expectTwoPageBlob(second);

  const out = saveAndReport(newTmpDir('van-random'), 'random.json', JSON.stringify(second));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].participantId).toBe(first.participantId);
  expect(out.summaryCsv[0].totalPasteEvents).toBe('1');
});

test('GET form: no hidden input and no cyborgHunterData in the URL', async ({ page }) => {
  const log = collectConsole(page);
  const urls = [];
  await page.route('**/done*', async (route) => {
    urls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Results</p>' });
  });
  await page.goto(FIX + 'vanilla-form-page2.html');
  await pasteInto(page, '#answer2', 'pasted text');
  // The page's own submit listener runs after ch.js's (capture, on document)
  // and notes what the form holds as it is sent; sessionStorage outlives the
  // navigation.
  await page.evaluate((field) => {
    document.getElementById('getform').addEventListener('submit', (ev) => {
      sessionStorage.setItem('e2e:get-had-input', String(!!ev.target.querySelector('input[name="' + field + '"]')));
    });
  }, FIELD);
  await page.click('#get-submit');
  await page.getByText('Results').waitFor();

  expect(urls).toHaveLength(1);
  const params = new URL(urls[0]).searchParams;
  expect(params.get('q')).toBe('search-term');
  expect(params.has(FIELD)).toBe(false);
  expect(await page.evaluate(() => sessionStorage.getItem('e2e:get-had-input'))).toBe('false');
  expect(chErrors(log)).toEqual([]);
});

test('single page: manual marks + custom fetch save via CyborgHunter.data(), replay returned', async ({ page }) => {
  const log = collectConsole(page);
  let saved = null;
  await page.route('**/save', async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  const replayRequests = [];
  page.on('request', (r) => { if (r.url().endsWith('/cyborg-hunter-replay.js')) replayRequests.push(new URL(r.url()).pathname); });
  await page.goto(FIX + 'vanilla-marks-fetch.html');
  // data-replay: the recorder is loaded after DOMContentLoaded.
  await page.waitForFunction(() => typeof window.CyborgHunterReplay !== 'undefined');
  await page.waitForLoadState('load');

  await page.mouse.move(20, 20);
  await page.mouse.move(200, 120, { steps: 8 });
  await page.click('[data-ch-trial="q1"]');
  await page.locator('#answer').pressSequentially('one', { delay: 120 });
  await page.click('[data-ch-trial="q2"]');
  await page.locator('#answer').pressSequentially(' two', { delay: 120 });
  await page.click('[data-ch-trial="q3"]');
  await page.locator('#answer').pressSequentially(' three', { delay: 120 });
  await page.click('#finish');
  await page.waitForFunction(() => window.__saved === true);

  expect(saved).not.toBeNull();
  expect(saved.data.participantId).toBe('E2E-VAN-2');
  expect(saved.data.trials.map((t) => t.trialId)).toEqual(['span-0', 'q1', 'q2', 'q3']);
  for (const t of saved.data.trials) expect(t.cyborgHunterError).toBeUndefined();

  // The replay recording, loaded from next to dist/ch.js.
  expect(replayRequests).toEqual(['/dist/cyborg-hunter-replay.js']);
  const rec = saved.replay;
  expect(rec).not.toBeNull();
  expect(rec.schema_version).toBe(2);
  expect(rec.participant_id).toBe('E2E-VAN-2');
  expect(rec.segments.reduce((n, s) => n + s.events.length, 0)).toBeGreaterThan(0);
  const labels = rec.segments.map((s) => s.label);
  for (const id of ['q1', 'q2', 'q3']) expect(labels).toContain(id);

  // data-debug: one console summary for the page.
  const summaries = log.info.filter((t) => t.startsWith('Cyborg Hunter active'));
  expect(summaries).toEqual(['Cyborg Hunter active · vanilla mode · 3 mark elements · ID from data-participant-id · honeypot on · friction off']);
  expect(chErrors(log)).toEqual([]);

  const out = saveAndReport(newTmpDir('van-marks'), 'E2E-VAN-2.json', JSON.stringify(saved.data));
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.stdout).not.toContain('files had warnings');
  expect(out.summaryCsv[0].participantId).toBe('E2E-VAN-2');
});

test('ch.js in <head>: boots after DOMContentLoaded without errors; a paste before any mark is counted', async ({ page }) => {
  const log = collectConsole(page);
  await page.goto(FIX + 'vanilla-head.html');
  await pasteInto(page, '#answer', 'pasted text');
  await page.click('#get-data');
  const data = await page.evaluate(() => window.__data);

  expect(data.participantId).toBe('E2E-VAN-3');
  expect(data.trials.map((t) => t.trialId)).toEqual(['span-0']);
  expect(data.trials[0].integrity.pasteEvents).toHaveLength(1);
  expect(chErrors(log)).toEqual([]);
});
