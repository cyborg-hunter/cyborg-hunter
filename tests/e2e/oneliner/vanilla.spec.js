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

  // data-debug: one console summary for the page; with data-replay it ends
  // with the save reminder, which is then not logged on its own. The
  // recorder's own autoSave warning (it names getRecording()) is silenced.
  const summaries = log.info.filter((t) => t.startsWith('Cyborg Hunter active'));
  expect(summaries).toEqual(['Cyborg Hunter active · vanilla mode · 3 mark elements · ID from data-participant-id · honeypot on · friction off · data-replay is on: save CyborgHunter.replay() in your save code']);
  expect(log.info).not.toContain(MESSAGES.replaySaveReminder());
  expect(log.warn.filter((t) => t.includes('autoSave.mode is "none"'))).toEqual([]);
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

// vanilla-submit-targets.html: submits that leave the page in place, and two
// that the vanilla host must not misread. The session record is read from
// sessionStorage once the page has been left for a page without ch.js.
const TARGETS_KEY = 'cyborg-hunter:oneliner:session:E2E-VAN-4';

function readSession(page) {
  return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), TARGETS_KEY);
}

async function leaveAndReadSession(page) {
  await page.route('**/left', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Left</p>' }));
  await page.goto('/left');
  return readSession(page);
}

for (const [form, label] of [['popup', 'a new window'], ['framed', 'a frame']]) {
  test(`a POST into ${label} carries the blob, and the data recorded after it is kept`, async ({ page }) => {
    const log = collectConsole(page);
    const bodies = [];
    // On the context: the new window's request is not the page's.
    await page.context().route('**/post-' + form, async (route) => {
      bodies.push(route.request().postData());
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Received</p>' });
    });
    await page.goto(FIX + 'vanilla-submit-targets.html');
    await pasteInto(page, '#answer', 'before ');
    const popup = form === 'popup' ? page.waitForEvent('popup') : null;
    await page.click('#' + form + '-submit');
    await expect.poll(() => bodies.length).toBe(1);
    if (popup) await (await popup).close();

    const posted = blobOf(bodies[0]);
    expect(posted, 'the post carries ' + FIELD).not.toBeNull();
    expect(posted.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1]);

    await pasteInto(page, '#answer', 'after');
    const saved = await leaveAndReadSession(page);
    expect(saved.trials.map((t) => t.trialId)).toEqual(['span-0', 'span-1']);
    expect(saved.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1]);
    expect(chErrors(log)).toEqual([]);
  });
}

test('a submit handler that cancels the event and calls form.submit() saves one segment, not two', async ({ page }) => {
  const log = collectConsole(page);
  const bodies = [];
  await page.route('**/post-handler', async (route) => {
    bodies.push(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Thank you</p>' });
  });
  await page.goto(FIX + 'vanilla-submit-targets.html');
  await pasteInto(page, '#answer', 'answer');
  await page.click('#handler-submit');
  await page.getByText('Thank you').waitFor();

  expect(bodies).toHaveLength(1);
  expect(blobOf(bodies[0]).trials.map((t) => t.trialId)).toEqual(['span-0']);
  expect((await readSession(page)).trials.map((t) => t.trialId)).toEqual(['span-0']);
  expect(chErrors(log)).toEqual([]);
});

// Chromium sends nothing for a dispatched submit event (as WebKit; Firefox
// does send the form, which this Chromium-only suite cannot cover).
test('a submit event the page dispatches itself sends nothing in Chromium, and the data after it is kept', async ({ page }) => {
  const log = collectConsole(page);
  const requested = [];
  page.on('request', (r) => { if (r.url().includes('/post-plain')) requested.push(r.url()); });
  await page.goto(FIX + 'vanilla-submit-targets.html');
  await pasteInto(page, '#answer', 'before ');
  await page.evaluate(() => {
    document.getElementById('plain').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await pasteInto(page, '#answer', 'after');
  const saved = await leaveAndReadSession(page);

  expect(requested).toEqual([]);
  expect(saved.trials.map((t) => t.trialId)).toEqual(['span-0', 'span-1']);
  expect(saved.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1]);
  expect(chErrors(log)).toEqual([]);
});

// A same-window POST answered 204: the navigation never commits and nothing
// on the page says so. What the participant does next is kept: in the
// session when they leave, in the post when the page submits a form later.
for (const exit of ['leave', 'form.submit()']) {
  test(`a POST answered 204 keeps the page: the data after it is kept (${exit})`, async ({ page }) => {
    const log = collectConsole(page);
    let drafts = 0;
    await page.route('**/post-draft', async (route) => { drafts++; await route.fulfill({ status: 204 }); });
    const bodies = [];
    await page.route('**/post-plain', async (route) => {
      bodies.push(route.request().postData());
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Thank you</p>' });
    });
    await page.goto(FIX + 'vanilla-submit-targets.html');
    await pasteInto(page, '#answer', 'before ');
    await page.click('#draft-submit');
    await expect.poll(() => drafts).toBe(1);
    await page.waitForTimeout(300);   // the 204 is in: the page stays
    expect(await page.evaluate(() => document.getElementById('answer').value)).toBe('before ');
    await pasteInto(page, '#answer', 'after');

    let saved;
    if (exit === 'leave') {
      saved = await leaveAndReadSession(page);
    } else {
      await page.evaluate(() => document.getElementById('plain').submit());
      await page.getByText('Thank you').waitFor();
      expect(bodies).toHaveLength(1);
      expect(blobOf(bodies[0]).trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1]);
      saved = await readSession(page);
    }
    expect(saved.trials.map((t) => t.trialId)).toEqual(['span-0', 'span-1']);
    expect(saved.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1]);
    expect(chErrors(log)).toEqual([]);
  });
}

// The page's own submit handler changes the form after ch.js's: the browser
// sends it by the method and into the window the handler left.
test('a submit handler that turns a GET form into a POST: the post carries cyborgHunterData', async ({ page }) => {
  const log = collectConsole(page);
  const bodies = [];
  await page.route('**/post-to-post', async (route) => {
    bodies.push(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Thank you</p>' });
  });
  await page.goto(FIX + 'vanilla-submit-targets.html');
  await pasteInto(page, '#answer', 'pasted');
  await page.click('#to-post-submit');
  await page.getByText('Thank you').waitFor();
  expect(new URLSearchParams(bodies[0]).get('q')).toBe('a');
  expect(blobOf(bodies[0]).trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1]);
  expect(chErrors(log)).toEqual([]);
});

test('a submit handler that turns a POST form into a GET: no cyborgHunterData in the URL', async ({ page }) => {
  const log = collectConsole(page);
  const urls = [];
  await page.route('**/get-to-get*', async (route) => {
    urls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Results</p>' });
  });
  await page.goto(FIX + 'vanilla-submit-targets.html');
  await pasteInto(page, '#answer', 'pasted');
  await page.click('#to-get-submit');
  await page.getByText('Results').waitFor();
  const params = new URL(urls[0]).searchParams;
  expect(params.get('q')).toBe('b');
  expect(params.has(FIELD)).toBe(false);
  expect(chErrors(log)).toEqual([]);
});

test('a submit handler that sends a same-window POST into a new window: the data after it is kept', async ({ page }) => {
  const log = collectConsole(page);
  const bodies = [];
  await page.context().route('**/post-to-blank', async (route) => {
    bodies.push(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Received</p>' });
  });
  await page.goto(FIX + 'vanilla-submit-targets.html');
  await pasteInto(page, '#answer', 'before ');
  const popup = page.waitForEvent('popup');
  await page.click('#to-blank-submit');
  await expect.poll(() => bodies.length).toBe(1);
  await (await popup).close();
  expect(blobOf(bodies[0]).trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1]);

  await pasteInto(page, '#answer', 'after');
  const saved = await leaveAndReadSession(page);
  expect(saved.trials.map((t) => t.trialId)).toEqual(['span-0', 'span-1']);
  expect(saved.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1]);
  expect(chErrors(log)).toEqual([]);
});

test('a POST form with a control named "method" still carries cyborgHunterData', async ({ page }) => {
  const log = collectConsole(page);
  const bodies = [];
  await page.route('**/post-clobbered', async (route) => {
    bodies.push(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Thank you</p>' });
  });
  await page.goto(FIX + 'vanilla-submit-targets.html');
  await page.click('#clobbered-submit');
  await page.getByText('Thank you').waitFor();

  expect(bodies).toHaveLength(1);
  expect(new URLSearchParams(bodies[0]).get('method')).toBe('by-hand');
  expect(blobOf(bodies[0]), 'the post carries ' + FIELD).not.toBeNull();
  expect(chErrors(log)).toEqual([]);
});
