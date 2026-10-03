// tests/e2e/oneliner/qualtrics.spec.js
// The one-line setup (dist/ch.js) inside a Qualtrics survey, in Chromium.
// fixtures/qualtrics-harness.html stands in for the New Survey Taking
// Experience (one window for the whole survey, the header re-rendered and its
// script run again on every page, each page posted to /jfe/next) and, with
// ?layout=legacy, for the older layout of full page loads. Its header comment
// lists the query parameters.
//
// The spec answers /jfe/next as the Qualtrics server does: a submit whose
// embedded data is above LIMIT bytes is refused with a 400, which on a live
// survey stops the participant on the page. Every test except the harness's
// own negative control asserts (afterEach) that no submit was refused.

import { test, expect, collectConsole, pasteInto, newTmpDir, cleanupTmpDirs, saveAndReport } from './support.mjs';
import { MESSAGES } from '../../../src/oneliner/errors.js';

const FIX = '/tests/e2e/oneliner/fixtures/qualtrics-harness.html';
const FIELD = '__js_cyborg_hunter';
const LEGACY_FIELD = 'cyborg_hunter';
const CAP = 12000;     // MAX_CHARS in src/oneliner/adapters/qualtrics.js
const LIMIT = 20000;   // about where a live survey refused a submit
const SURVEY_A = 'SV_E2EsurveyA';
const SURVEY_B = 'SV_E2EsurveyB';

test.afterAll(() => cleanupTmpDirs());
const chErrors = (log) => log.error.filter((t) => t.startsWith('[cyborg-hunter]'));
const isReduced = (t) => t.startsWith('[cyborg-hunter] The Qualtrics payload was reduced');

// The harness URL with the survey id in its query (an older survey link's
// ?SID=SV_…), which ch.js keys its saved session by.
const at = (query = '', survey = SURVEY_A) => FIX + '?SID=' + survey + (query ? '&' + query : '');

// Serves /jfe/next like Qualtrics: 400 when the embedded data of one submit
// is above `limit` bytes (UTF-8, at least the character count whichever way
// the server counts), 200 otherwise. Records every submit. `limit` can be
// changed mid-test (server.limit).
const servers = [];
test.beforeEach(() => { servers.length = 0; });
test.afterEach(() => {
  for (const s of servers) {
    if (s.refusalExpected) continue;
    expect(s.posts.filter((p) => p.status !== 200), 'the Qualtrics server refused a submit').toEqual([]);
  }
});
async function qualtricsServer(page, { limit = LIMIT, refusalExpected = false } = {}) {
  const server = { limit, refusalExpected, posts: [] };
  await page.route('**/jfe/next', async (route) => {
    const body = route.request().postDataJSON();
    const values = body.embeddedData || {};
    const bytes = Object.values(values).reduce((n, v) => n + Buffer.byteLength(String(v), 'utf8'), 0);
    const status = bytes > server.limit ? 400 : 200;
    server.posts.push({ page: body.page, bytes, values, status });
    await route.fulfill({ status, contentType: 'application/json', body: '{}' });
  });
  servers.push(server);
  return server;
}

// The page is ready once its header script has run (the harness sets
// __qxPage then).
async function ready(page, n) {
  await page.waitForFunction((k) => window.__qxPage === k, n);
}
async function nextPage(page, n) {
  await page.click('#next');
  await ready(page, n + 1);
}
const payloadsOf = (server, field = FIELD) => server.posts.map((p) => JSON.parse(p.values[field]));
const badgeText = (page) => page.evaluate(() => document.getElementById('ch-debug-badge').textContent);

for (const scripts of ['element', 'eval']) {
  test(`4 pages, header re-executed by ${scripts}: silent re-runs, one write per submit, counts right, CLI reads the last value`, async ({ page }) => {
    const log = collectConsole(page);
    const server = await qualtricsServer(page);
    await page.goto(at('scripts=' + scripts));
    await ready(page, 1);
    await pasteInto(page, '#q1', 'pasted on page 1');
    await nextPage(page, 1);
    await page.locator('#q2').pressSequentially('typed', { delay: 60 });
    await nextPage(page, 2);
    await pasteInto(page, '#q3', 'pasted on page 3');        // after two re-runs: counted once, not three times
    await nextPage(page, 3);
    await nextPage(page, 4);
    await page.getByText('Thank you').waitFor();

    expect(await page.evaluate(() => window.__qxHeaderRuns)).toBe(4);
    expect(chErrors(log)).toEqual([]);
    expect(log.error.filter((t) => t.includes('Not redefining'))).toEqual([]);
    expect(await page.evaluate(() => document.querySelectorAll('#ch-debug-badge').length)).toBe(1);
    expect(await page.evaluate(() => document.querySelectorAll('#fg-honeypot').length)).toBe(1);
    expect(server.posts.map((p) => p.page)).toEqual([1, 2, 3, 4]);
    for (const p of server.posts) expect(Object.keys(p.values)).toEqual([FIELD]);
    const payloads = payloadsOf(server);
    expect(payloads.map((p) => p.trials.length)).toEqual([1, 2, 3, 4]);                 // one cut per submit
    expect(payloads[3].trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1, 2, 3]);
    expect(payloads[3].trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 0, 1, 0]);
    expect(payloads[3].trials[3].integritySegment.counters.pasteCount).toBe(2);
    expect(payloads[3].cyborgHunterOneLiner.truncated).toBe(false);
    expect(payloads[3].cyborgHunterOneLiner.pageCount).toBe(1);                         // one page load
    for (const p of server.posts) expect(p.bytes).toBeLessThanOrEqual(CAP);
    expect(await badgeText(page)).toMatch(new RegExp('^Cyborg Hunter active · Qualtrics detected · page 4 · field ' + FIELD +
      ' declared · ID from data-participant-id · honeypot on · friction off · header re-run ×3 · last write \\d+/' + CAP + ' chars$'));
    expect(log.info.filter((t) => t.startsWith('Cyborg Hunter active'))).toHaveLength(1);   // one summary, not four

    const out = saveAndReport(newTmpDir('qx-' + scripts), 'E2E-QX-1.json', server.posts[3].values[FIELD]);
    expect(out.stdout).toContain('Found 1 participants');
    expect(out.stdout).not.toContain('files had warnings');
    expect(out.summaryCsv[0].totalPasteEvents).toBe('2');
    expect(out.summaryCsv[0].hardTriggered).toBe('YES');
  });
}

test('over the cap: the payload is reduced before the write, the participant is never blocked', async ({ page }) => {
  const log = collectConsole(page);
  const server = await qualtricsServer(page);
  await page.goto(at());
  await ready(page, 1);
  // 400 tab-aways of 3.5 s each (above the standard preset's 3 s cutoff), with a stubbed clock: blur,
  // advance, focus (src/core/signals/focus.js pushes a session entry on every return).
  await page.evaluate(() => {
    let now = performance.now(); const real = performance.now.bind(performance);
    performance.now = () => now;
    for (let i = 0; i < 400; i++) { window.dispatchEvent(new Event('blur')); now += 3500; window.dispatchEvent(new Event('focus')); now += 100; }
    performance.now = real;
  });
  await nextPage(page, 1);
  expect(server.posts).toHaveLength(1);
  expect(await page.locator('#qx-error').count()).toBe(0);
  expect(server.posts[0].bytes).toBeLessThanOrEqual(CAP);
  const p = JSON.parse(server.posts[0].values[FIELD]);
  expect(p.cyborgHunterOneLiner.truncated.level).toBeGreaterThanOrEqual(1);
  expect(p.trials[0].integritySegment.counters).toBeTruthy();
  const reduced = log.warn.filter(isReduced);
  expect(reduced).toHaveLength(1);
  // The full summary the warning names would have been refused: the submit
  // went through because the payload was reduced.
  const full = Number(/the full summary was (\d+) bytes/.exec(reduced[0])[1]);
  expect(full).toBeGreaterThan(LIMIT);
  expect(chErrors(log)).toEqual([]);
});

test('negative control for the harness: a server limit below the payload refuses the submit, and the kept callbacks write the retry', async ({ page }) => {
  // Not a property of ch.js. The server's limit is set below the size of a quiet page's payload (about
  // 1.8 KB, under the default cap), so the harness server answers 400: it pins that the harness's limit
  // is real and that a refusal stops the participant on the page, so the afterEach refusal check can fail.
  // (The over-cap test above shows the unreduced payload would have been refused at LIMIT.) Then the limit
  // is lifted and Next is clicked again: Qualtrics kept the callback, so the retry is written too.
  const server = await qualtricsServer(page, { limit: 1000, refusalExpected: true });
  await page.goto(at());
  await ready(page, 1);
  await page.click('#next');
  await expect(page.locator('#qx-error')).toHaveText('Something went wrong');
  expect(server.posts).toHaveLength(1);
  expect(server.posts[0].status).toBe(400);
  expect(server.posts[0].bytes).toBeGreaterThan(1000);
  expect(server.posts[0].bytes).toBeLessThanOrEqual(CAP);
  expect(await page.evaluate(() => [window.__qxPage, window.__qxHeaderRuns])).toEqual([1, 1]);   // stayed on the page

  server.limit = LIMIT;
  await nextPage(page, 1);
  expect(server.posts.map((p) => p.status)).toEqual([400, 200]);
  expect(JSON.parse(server.posts[1].values[FIELD]).trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1]);
});

test('the cap seam only lowers: maxChars=3000 caps the write at 3000, maxChars=50000 leaves it at the default', async ({ page }) => {
  const server = await qualtricsServer(page);
  const tabAways = () => page.evaluate(() => { for (let i = 0; i < 200; i++) { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); } });
  await page.goto(at('maxChars=3000'));
  await ready(page, 1);
  await tabAways();
  await nextPage(page, 1);
  expect(server.posts[0].bytes).toBeLessThanOrEqual(3000);
  expect(await badgeText(page)).toMatch(/last write \d+\/3000 chars$/);

  await page.goto(at('maxChars=50000', SURVEY_B));
  await ready(page, 1);
  await tabAways();
  await nextPage(page, 1);
  expect(server.posts[1].bytes).toBeLessThanOrEqual(CAP);
  expect(await badgeText(page)).toMatch(new RegExp('last write \\d+/' + CAP + ' chars$'));
});

test('undeclared field: the value is dropped, the summary and the console say so', async ({ page }) => {
  const log = collectConsole(page);
  const server = await qualtricsServer(page);
  await page.goto(at('declared='));
  await ready(page, 1);
  await nextPage(page, 1);
  await nextPage(page, 2);
  expect(server.posts.map((p) => Object.keys(p.values))).toEqual([[], []]);
  expect(await badgeText(page)).toMatch(/field __js_cyborg_hunter NOT DECLARED/);
  expect(chErrors(log)).toEqual([MESSAGES.qualtricsFieldUndeclared(FIELD)]);
});

test('callbacks kept across pages: still one write per submit', async ({ page }) => {
  const server = await qualtricsServer(page);
  await page.goto(at('persist=1'));
  await ready(page, 1);
  await nextPage(page, 1); await nextPage(page, 2); await nextPage(page, 3);
  expect(await page.evaluate(() => window.__qxWriteMs.length)).toBe(1 + 2 + 3);   // every kept callback fired
  expect(payloadsOf(server).map((p) => p.trials.length)).toEqual([1, 2, 3]);
});

test('CyborgHunter.data() before the submit: written and returned, and the submit still writes its own cut', async ({ page }) => {
  const server = await qualtricsServer(page);
  await page.goto(at());
  await ready(page, 1);
  await pasteInto(page, '#q1', 'before data()');
  const d = await page.evaluate(() => window.CyborgHunter.data());
  expect(d.cyborgHunterOneLiner.host).toBe('qualtrics');
  expect(d.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1]);
  await pasteInto(page, '#q1', 'after data()');
  await nextPage(page, 1);
  expect(server.posts).toHaveLength(1);
  const p = JSON.parse(server.posts[0].values[FIELD]);
  expect(p.trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1]);
  expect(p.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1]);
});

test('force response: the stopped submit posts nothing, the real one writes what came between', async ({ page }) => {
  const log = collectConsole(page);
  const server = await qualtricsServer(page);
  await page.goto(at('force=1'));
  await ready(page, 1);
  await page.click('#next');                                  // empty answer: validation stops the submit
  await expect(page.locator('#qx-validation')).toHaveText('Please answer this question.');
  expect(server.posts).toHaveLength(0);
  expect(await page.evaluate(() => window.__qxPage)).toBe(1);
  await pasteInto(page, '#q1', 'the answer');
  await nextPage(page, 1);
  expect(server.posts).toHaveLength(1);
  const p = JSON.parse(server.posts[0].values[FIELD]);
  expect(p.trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1]);   // the stopped submit cut too
  expect(p.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([0, 1]);
  expect(chErrors(log)).toEqual([]);
});

test('a reload mid-survey: the resumed page\'s writes still hold the pages submitted before it', async ({ page }) => {
  const log = collectConsole(page);
  const server = await qualtricsServer(page);
  await page.goto(at());
  await ready(page, 1);
  await pasteInto(page, '#q1', 'page 1');
  await nextPage(page, 1);
  await pasteInto(page, '#q2', 'page 2');
  await nextPage(page, 2);
  await page.reload();                                       // Qualtrics resumes the response on page 3
  await ready(page, 3);
  expect(await page.evaluate(() => window.__qxHeaderRuns)).toBe(1);   // a new document: a first run, not a re-run
  await pasteInto(page, '#q3', 'page 3');
  await nextPage(page, 3);
  await nextPage(page, 4);
  await page.getByText('Thank you').waitFor();

  const last = payloadsOf(server)[3];
  expect(last.trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1, 2, 3]);
  expect(last.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1, 1, 0]);
  expect(last.cyborgHunterOneLiner.pageCount).toBe(2);                                // two page loads
  expect(new Set(last.trials.map((t) => t.integritySegment.pageOrigin)).size).toBe(2);
  expect(chErrors(log)).toEqual([]);
  const out = saveAndReport(newTmpDir('qx-reload'), 'E2E-QX-1.json', server.posts[3].values[FIELD]);
  expect(out.stdout).toContain('Found 1 participants');
  expect(out.summaryCsv[0].totalPasteEvents).toBe('3');
});

test('survey A, then survey B in the same tab: B starts its own session, and A resumes with its own', async ({ page }) => {
  const server = await qualtricsServer(page);
  await page.goto(at('', SURVEY_A));
  await ready(page, 1);
  await pasteInto(page, '#q1', 'survey A');
  await nextPage(page, 1);
  await nextPage(page, 2);

  await page.goto(at('', SURVEY_B));                         // same tab, same participant id
  await ready(page, 1);
  await nextPage(page, 1);
  const b = payloadsOf(server)[2];
  expect(b.participantId).toBe('E2E-QX-1');
  expect(b.trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0]);
  expect(b.trials[0].integrity.pasteEvents).toEqual([]);

  await page.goto(at('', SURVEY_A));                         // back to A, which resumes on page 3
  await ready(page, 3);
  await nextPage(page, 3);
  const a = payloadsOf(server)[3];
  expect(a.trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1, 2]);
  expect(a.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 0, 0]);
});

test('legacy layout (full page loads): sessionStorage carries the pages, setEmbeddedData writes cyborg_hunter', async ({ page }) => {
  const log = collectConsole(page);
  const server = await qualtricsServer(page);
  await page.goto(FIX + '?layout=legacy&page=1');
  await ready(page, 1);
  await pasteInto(page, '#q1', 'pasted');
  await page.click('#next'); await page.waitForURL('**page=2**'); await ready(page, 2);
  await page.click('#next'); await page.waitForURL('**page=3**'); await ready(page, 3);
  for (const p of server.posts) expect(Object.keys(p.values)).toEqual([LEGACY_FIELD]);
  const store = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qx:ed')));
  expect(store[LEGACY_FIELD]).toBe(server.posts[1].values[LEGACY_FIELD]);
  const p = JSON.parse(store[LEGACY_FIELD]);
  expect(p.cyborgHunterOneLiner.pageCount).toBe(2);
  expect(p.trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1]);
  expect(p.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 0]);
  expect(new Set(p.trials.map((t) => t.integritySegment.pageOrigin)).size).toBe(2);
  expect(await badgeText(page)).toMatch(/^Cyborg Hunter active · Qualtrics detected \(legacy layout, field cyborg_hunter\) · page 3 · /);
  expect(log.warn.filter((t) => t.startsWith('[cyborg-hunter] Qualtrics legacy layout'))).toHaveLength(3);   // once per page load
  expect(chErrors(log)).toEqual([]);
});

test('data-replay under Qualtrics: recorded, never written to the field, the recipe script uploads it', async ({ page }) => {
  const log = collectConsole(page);
  const server = await qualtricsServer(page);
  let upload = null;
  await page.route('**/upload', async (route) => { upload = route.request().postDataJSON(); await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'ok' }); });   // the researcher's server, on another origin
  // recipe=1: the final page runs the harness's replay question script; debug=0: the boot reminder is a
  // console line of its own (with data-debug the summary carries it).
  await page.goto(at('replay=1&recipe=1&debug=0'));
  await ready(page, 1);
  await page.waitForFunction(() => typeof window.CyborgHunterReplay !== 'undefined');
  await pasteInto(page, '#q1', 'recorded');
  await nextPage(page, 1); await nextPage(page, 2); await nextPage(page, 3);
  await page.click('#next');                                 // waits for the recipe to show Next again
  await page.getByText('Thank you').waitFor();
  expect(upload).not.toBeNull();
  expect(upload.participantId).toBe('E2E-QX-1');
  expect(upload.data.schema_version).toBe(2);
  expect(upload.data.participant_id).toBe('E2E-QX-1');
  expect(server.posts).toHaveLength(4);
  for (const p of server.posts) expect(p.values[FIELD]).not.toContain('schema_version');
  expect(payloadsOf(server)[3].trials).toHaveLength(4);
  expect(log.info.filter((t) => t === MESSAGES.replayQualtrics())).toHaveLength(1);
  expect(chErrors(log)).toEqual([]);
});

test('perf: the write at submit stays under the capture budget on a 40-page, 400-event session', async ({ page }) => {
  const server = await qualtricsServer(page);
  await page.goto(at('pages=40'));
  await ready(page, 1);
  for (let i = 1; i <= 40; i++) {
    await page.evaluate(() => { for (let k = 0; k < 10; k++) { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); } });
    await nextPage(page, i);
  }
  expect(server.posts).toHaveLength(40);
  expect(payloadsOf(server)[39].trials.length).toBeGreaterThan(0);
  const ms = await page.evaluate(() => window.__qxWriteMs);   // each addOnPageSubmit callback, timed by the harness
  expect(ms).toHaveLength(40);
  expect(Math.max(...ms)).toBeLessThan(20);
  expect(ms.sort((a, b) => a - b)[Math.floor(ms.length / 2)]).toBeLessThan(5);
});

// A submit before the header ran again. With ?blockNext=0 the harness enables
// Next as soon as the next page shows, and with ?headerDelay the header's
// script runs late on every page after the first (as a slow network or a
// cache miss on its re-fetch would make it), so a participant can submit a
// page before its header re-run lands. Whether Qualtrics allows that, and
// whether it keeps addOnPageSubmit callbacks across pages (?persist=1), is to
// be checked on a live survey; both answers are covered here.
const EARLY = 'blockNext=0&headerDelay=1500';
const headerRuns = (page) => page.evaluate(() => window.__qxHeaderRuns);
async function settled(page, runs) {
  await page.waitForFunction((k) => window.__qxHeaderRuns === k, runs);
}
// Next, clicked at once; resolves when the next page (or the end) shows.
async function nextEarly(page, n) {
  await page.click('#next');
  await page.waitForFunction((k) => window.__qxPage === k, n + 1);
}

for (const persist of [true, false]) {
  const kept = persist ? 'kept callbacks' : 'dropped callbacks';
  test(`a middle page submitted before its header ran again, ${kept}: one row per page, nothing lost`, async ({ page }) => {
    const log = collectConsole(page);
    const server = await qualtricsServer(page);
    await page.goto(at(EARLY + (persist ? '&persist=1' : '')));
    await ready(page, 1);
    await pasteInto(page, '#q1', 'page 1');
    await nextEarly(page, 1);
    await pasteInto(page, '#q2', 'page 2');
    await nextEarly(page, 2);                                // page 2's header is still loading
    expect(await headerRuns(page)).toBe(1);
    await settled(page, 3);
    await pasteInto(page, '#q3', 'page 3');
    await nextEarly(page, 3);
    await settled(page, 4);
    await nextEarly(page, 4);
    await page.getByText('Thank you').waitFor();

    const payloads = payloadsOf(server);
    if (persist) {
      expect(payloads[1].trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1]);   // the kept hook wrote page 2
    } else {
      expect(server.posts[1].values[FIELD]).toBe(server.posts[0].values[FIELD]);   // no hook: Qualtrics posted the stale value
    }
    expect(payloads[2].trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1, 2]);
    expect(payloads[2].trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1, 1]);
    const last = payloads[3];
    expect(last.trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1, 2, 3]);
    expect(last.trials[3].integritySegment.counters.pasteCount).toBe(3);
    const badge = await badgeText(page);
    if (persist) {
      expect(last.cyborgHunterError).toBeUndefined();
      expect(badge).not.toContain('missed');
    } else {
      // The gap is visible: in the payload (the CLI reports it) and on the badge.
      expect(last.cyborgHunterError).toMatch(/submitted before Cyborg Hunter's page-submit hook was in place/);
      expect(badge).toContain(' · submits missed ×1 · ');
    }
    expect(chErrors(log)).toEqual([]);
    const out = saveAndReport(newTmpDir('qx-early-' + persist), 'E2E-QX-1.json', server.posts[3].values[FIELD]);
    expect(out.stdout).toContain('Found 1 participants');
    expect(out.summaryCsv[0].totalPasteEvents).toBe('3');
  });
}

const finalPage = [
  { name: 'kept callbacks: the kept hook writes it', query: '&persist=1', saved: true },
  { name: 'dropped callbacks, with the final-page question script: CyborgHunter.data() writes it', query: '&finalLine=1', saved: true },
  { name: 'dropped callbacks, no final-page script: nothing in the page runs at that submit, the final page is lost', query: '', saved: false }
];
for (const c of finalPage) {
  test(`the final page submitted before its header ran again, ${c.name}`, async ({ page }) => {
    const log = collectConsole(page);
    const server = await qualtricsServer(page);
    await page.goto(at(EARLY + c.query));
    await ready(page, 1);
    for (let n = 1; n <= 3; n++) {
      await pasteInto(page, '#q' + n, 'page ' + n);
      await nextEarly(page, n);
      if (n < 3) await settled(page, n + 1);                 // pages 2 and 3 wait for their header
    }
    await pasteInto(page, '#q4', 'page 4');
    await nextEarly(page, 4);                                // page 4's header is still loading
    await page.getByText('Thank you').waitFor();
    expect(await headerRuns(page)).toBe(3);
    await settled(page, 4);                                  // the late re-run lands on the end page: no write, no error

    const last = payloadsOf(server)[3];
    if (c.saved) {
      expect(last.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1, 1, 1]);
      expect(last.trials[3].integritySegment.counters.pasteCount).toBe(4);
    } else {
      // The documented residual: the post carries page 3's value. Only the
      // final-page question script covers this case.
      expect(server.posts[3].values[FIELD]).toBe(server.posts[2].values[FIELD]);
      expect(last.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1, 1]);
    }
    expect(chErrors(log)).toEqual([]);
  });
}

// The final-page question script and the writer's own hook run in one submit
// task (in either order: the writer's hook first when Qualtrics kept it from
// an earlier page, the question script first otherwise). One row per page.
for (const persist of [false, true]) {
  test(`the final-page line with on-time clicks${persist ? ', kept callbacks' : ''}: 4 pages, 4 rows`, async ({ page }) => {
    const log = collectConsole(page);
    const server = await qualtricsServer(page);
    await page.goto(at('finalLine=1' + (persist ? '&persist=1' : '')));
    await ready(page, 1);
    for (let n = 1; n <= 4; n++) {
      await pasteInto(page, '#q' + n, 'page ' + n);
      await nextPage(page, n);
    }
    await page.getByText('Thank you').waitFor();
    const last = payloadsOf(server)[3];
    expect(last.trials.map((t) => t.integritySegment.segmentIndex)).toEqual([0, 1, 2, 3]);
    expect(last.trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1, 1, 1]);
    expect(last.cyborgHunterError).toBeUndefined();
    expect(chErrors(log)).toEqual([]);
  });
}

// The final-page line and the replay recipe are question scripts: they run
// whether or not ch.js did, inside Qualtrics' own page code. Neither may
// throw or leave Next hidden. The harness stops a submit whose callback
// throws (whether a live survey does is not known), so a throw fails these
// tests.
async function finishWithoutCh(page, server) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page, 1);
  for (let n = 1; n <= 3; n++) await nextPage(page, n);
  await expect(page.locator('#next')).toBeVisible();
  await page.click('#next');
  await page.getByText('Thank you').waitFor();
  expect(server.posts.map((p) => [p.page, p.status])).toEqual([[1, 200], [2, 200], [3, 200], [4, 200]]);
  for (const p of server.posts) expect(p.values[FIELD]).toBeUndefined();
  expect(await headerRuns(page)).toBe(0);
  expect(errors).toEqual([]);
}

test('ch.js fails to load, with the final-page line and the replay recipe: every page submits, Next is never left hidden', async ({ page }) => {
  const server = await qualtricsServer(page);
  const chStatus = [];
  page.on('response', (r) => { if (r.url().endsWith('/ch.js')) chStatus.push(r.status()); });
  await page.goto(at('chjs=missing&finalLine=1&recipe=1&replay=1'));
  await finishWithoutCh(page, server);
  expect(chStatus.length).toBeGreaterThan(0);
  expect(chStatus.every((s) => s === 404)).toBe(true);
  expect(await page.evaluate(() => typeof window.CyborgHunter)).toBe('undefined');
});

test('a CyborgHunter whose calls throw: the final-page line and the replay recipe still let every page submit', async ({ page }) => {
  const server = await qualtricsServer(page);
  await page.addInitScript(() => {
    window.CyborgHunter = {
      data: function () { throw new Error('data failed'); },
      replay: function () { throw new Error('replay failed'); }
    };
  });
  await page.goto(at('chjs=missing&finalLine=1&recipe=1'));
  await finishWithoutCh(page, server);
});

test('the replay upload fails: the recipe shows Next again and the final page is written', async ({ page }) => {
  const log = collectConsole(page);
  const server = await qualtricsServer(page);
  let tried = false;
  await page.route('**/upload', (route) => { tried = true; return route.abort(); });
  await page.goto(at('replay=1&recipe=1&debug=0'));
  await ready(page, 1);
  await page.waitForFunction(() => typeof window.CyborgHunterReplay !== 'undefined');
  for (let n = 1; n <= 3; n++) {
    await pasteInto(page, '#q' + n, 'page ' + n);
    await nextPage(page, n);
  }
  await pasteInto(page, '#q4', 'page 4');
  await page.click('#next');                                 // waits for the recipe to show Next again
  await page.getByText('Thank you').waitFor();
  expect(tried).toBe(true);
  expect(server.posts).toHaveLength(4);
  expect(payloadsOf(server)[3].trials.map((t) => t.integrity.pasteEvents.length)).toEqual([1, 1, 1, 1]);
  expect(chErrors(log)).toEqual([]);
});
