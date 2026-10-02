// The analyze page's state machine over its worker, in happy-dom on the real
// demo/analyze/index.html markup. The worker is a stand-in that records what
// the page sends; each test plays the worker's side of the protocol
// (demo/analyze/worker-entry.js's header) by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const PAGE_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; " +
  "img-src 'self' blob: data:; font-src data:; frame-src blob:; worker-src blob:; connect-src 'none'; " +
  "form-action 'none'; base-uri 'none'";
const html = readFileSync(new URL('../../demo/analyze/index.html', import.meta.url), 'utf8');

const win = new Window({ settings: { disableIframePageLoading: true } });
globalThis.window = win; globalThis.document = win.document;
globalThis.Blob = win.Blob; globalThis.URL = win.URL;
const { createPage } = await import('../../demo/analyze/page.js');

function boot() {
  document.head.innerHTML = '';
  // The body without its <script>: the bundle is what this test imports.
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
  const sent = [];
  const worker = { postMessage: (m) => sent.push(m), onmessage: null };
  const page = createPage(document.body, worker, {});
  const emit = (data) => worker.onmessage({ data });
  emit({ type: 'ready', assets: { replayClientSrc: '', replayCss: '', fontFaceCss: '@font-face{}' }, limits: { testedParticipants: 150, testedFixture: 'x' } });
  return { page, sent, emit };
}
const visibleStep = () => [...document.querySelectorAll('section.step')].filter((s) => !s.hidden).map((s) => s.dataset.step);
const role = (r) => document.querySelector('[data-role="' + r + '"]');
const action = (a) => document.querySelector('[data-action="' + a + '"]');
const tick = () => new Promise((r) => setTimeout(r, 0));
// A promise's outcome, or 'pending' if it has not settled within a few ticks
// (so a regression fails the test instead of hanging it).
const outcome = (p) => Promise.race([p.then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r('pending'), 50))]);
const CHECKED = { type: 'checked', counts: { participant: 3, replay: 1, assets: 0, ignored: 0 }, configFound: true,
  config: { participantIdField: 'participantId' }, configWarnings: ['unknown key "dataDri"'],
  idSuggestion: { suggested: 'subject_ID', candidates: [{ field: 'subject_ID', reason: 'from cyborg-hunter.config.json' }, { field: 'subject_ID', reason: 'known name' }, { field: 'run_id', reason: 'constant within each file, unique across files' }] },
  sampled: 3 };
const DONE = { type: 'done', html: '<p>report</p>', triageOrder: ['A', 'B'], counts: { flaggedHard: 1, flaggedSoft: 0, clean: 1 },
  participants: [{ participantId: 'A', hasReplay: false, assetNote: null }, { participantId: 'B', hasReplay: true, assetNote: '1 of 2 stylesheets matched' }],
  warnings: [], reportWarnings: [], files: { 'summary.csv': 'a', 'triage.md': 'b', 'event-log.csv': 'c' }, configUsed: {}, zipBytes: 2048 };

async function toCheck(t) {
  action('sample').click();
  await tick();
  t.emit(CHECKED);
  await tick();
}
async function toResults(t) {
  await toCheck(t);
  action('run').click();
  await tick();
  t.emit({ type: 'zip', chunk: new Uint8Array([1, 2]) });
  t.emit(DONE);
  await tick();
  document.querySelector('iframe.analyze-report').dispatchEvent(new win.Event('load'));
}

test('the page declares the no-network policy verbatim, before anything else in <head>', () => {
  const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
  const metas = head.match(/<meta[^>]*>/g);
  assert.equal(metas[1], '<meta http-equiv="Content-Security-Policy" content="' + PAGE_CSP + '">');
  assert.equal(/<link[^>]+rel="stylesheet"|<script[^>]+src="http|@import|url\(http/i.test(html), false, 'no external resource');
});

test('ready shows the tested cohort size and installs the baked fonts', () => {
  boot();
  assert.equal(role('tested-size').textContent, '150');
  assert.ok([...document.head.querySelectorAll('style')].some((s) => s.textContent === '@font-face{}'));
});

test('sample → check: counts, id candidates (deduplicated), config warnings', async () => {
  const t = boot();
  await toCheck(t);
  assert.deepEqual(t.sent, [{ type: 'check', files: [], sample: true }]);
  assert.deepEqual(visibleStep(), ['check']);
  assert.match(role('counts').textContent, /3 participant files.*1 replay candidates.*0 experiment assets.*1 config file/);
  assert.deepEqual([...role('id-field').options].map((o) => o.value), ['subject_ID', 'run_id']);
  assert.equal(role('id-field').value, 'subject_ID');
  assert.equal(role('check-warnings').textContent, 'unknown key "dataDri"');
  assert.equal(action('run').disabled, false);
});

test('one run at a time: the run control is disabled while a run is in flight', async () => {
  const t = boot();
  await toCheck(t);
  action('run').click();
  await tick();
  assert.equal(action('run').disabled, true);
  t.page.run();
  await tick();
  assert.equal(t.sent.filter((m) => m.type === 'run').length, 1);
  assert.deepEqual(t.sent[1], { type: 'run', files: [], sample: true, config: CHECKED.config, participantIdField: 'subject_ID' });
});

test('a run error discards the zip chunks already received and offers a retry', async () => {
  const t = boot();
  await toCheck(t);
  action('run').click();
  await tick();
  t.emit({ type: 'zip', chunk: new Uint8Array([1, 2, 3]) });
  t.emit({ type: 'error', phase: 'ingest', message: 'No participant data found in the dropped files.', warnings: [{ file: 'a.csv', warnings: ['Failed to parse: x'] }] });
  await tick();
  assert.deepEqual(t.page.state.zipParts, []);
  assert.equal(t.page.state.zipUrl, null);
  assert.deepEqual(visibleStep(), ['check']);
  assert.equal(role('error').hidden, false);
  assert.match(role('error').textContent, /No participant data/);
  assert.equal(role('check-warnings').textContent, 'a.csv: Failed to parse: x');
  assert.equal(action('run').disabled, false, 'retry offered');
  action('run').click();
  await tick();
  assert.equal(t.sent.filter((m) => m.type === 'run').length, 2);
  assert.equal(role('error').hidden, true, 'a retry clears the old error');
});

test('a check error returns to the drop step', async () => {
  const t = boot();
  action('sample').click();
  await tick();
  t.emit({ type: 'error', phase: 'check', message: 'boom' });
  await tick();
  assert.deepEqual(visibleStep(), ['drop']);
  assert.equal(role('error').textContent, 'boom');
});

test('done → results: summary, sandboxed report frame, zip blob, replay dropdown', async () => {
  const t = boot();
  await toResults(t);
  assert.deepEqual(visibleStep(), ['results']);
  assert.match(role('summary').textContent, /2 participants: 1 hard, 0 soft, 1 clean\. Zip: 2 KB\./);
  const frame = document.querySelector('iframe.analyze-report');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.match(t.page.state.zipUrl, /^blob:/);
  const opts = [...document.querySelectorAll('[data-role="replay-select"] option')];
  assert.deepEqual(opts.map((o) => [o.value, o.disabled]), [['A', true], ['B', false]]);
  assert.equal(document.querySelector('[data-role="replay-select"]').value, 'B');
  assert.equal(role('asset-note').textContent, '1 of 2 stylesheets matched');
});

test('a replay is requested on demand and mounted in a same-origin host frame', async () => {
  const t = boot();
  await toResults(t);
  const loading = t.page.loadReplay();
  await tick();
  assert.deepEqual(t.sent.at(-1), { type: 'replay', participantId: 'B' });
  t.emit({ type: 'replay-model', participantId: 'B', model: { segments: [] } });
  await loading;
  const host = document.querySelectorAll('iframe.replay-host-frame');
  assert.equal(host.length, 1);
  assert.equal(host[0].getAttribute('sandbox'), 'allow-scripts allow-same-origin');
  assert.equal(host[0].dataset.participantId, 'B');
  assert.match(host[0].src, /^blob:/);
  // Loading again replaces it: one viewer alive at a time.
  const again = t.page.loadReplay();
  await tick();
  t.emit({ type: 'replay-model', participantId: 'B', model: { segments: [] } });
  await again;
  assert.equal(document.querySelectorAll('iframe.replay-host-frame').length, 1);
});

test('a replay error keeps the results on screen', async () => {
  const t = boot();
  await toResults(t);
  const loading = t.page.loadReplay();
  await tick();
  t.emit({ type: 'error', phase: 'replay', message: 'No replay for B' });
  assert.equal(await outcome(loading), 'rejected');
  assert.deepEqual(visibleStep(), ['results']);
  assert.equal(role('error').textContent, 'No replay for B');
  assert.equal(document.querySelectorAll('iframe.replay-host-frame').length, 0);
});

test('a model that arrives after the selection moved on is not mounted', async () => {
  const t = boot();
  const done = { ...DONE, participants: [{ participantId: 'A', hasReplay: true }, { participantId: 'B', hasReplay: true }] };
  await toCheck(t);
  action('run').click();
  await tick();
  t.emit(done);
  await tick();
  document.querySelector('iframe.analyze-report').dispatchEvent(new win.Event('load'));
  const first = t.page.loadReplay();          // A
  await tick();
  t.page.selectParticipant('B');              // switching tears the pending load down
  t.emit({ type: 'replay-model', participantId: 'A', model: { segments: [] } });
  await first;
  assert.equal(document.querySelectorAll('iframe.replay-host-frame').length, 0);
});

test('a run without recordings says so in the replay card', async () => {
  const t = boot();
  await toCheck(t);
  action('run').click();
  await tick();
  t.emit({ ...DONE, participants: [{ participantId: 'A', hasReplay: false }] });
  await tick();
  document.querySelector('iframe.analyze-report').dispatchEvent(new win.Event('load'));
  assert.equal(role('asset-note').textContent, 'No replay recordings in this run.');
  assert.equal(action('load-replay').disabled, true);
});

test('start over returns to the drop step and clears the run', async () => {
  const t = boot();
  await toResults(t);
  document.querySelectorAll('[data-action="reset"]')[1].click();
  assert.deepEqual(visibleStep(), ['drop']);
  assert.equal(t.page.state.result, null);
  assert.deepEqual(t.page.state.zipParts, []);
  assert.equal(t.page.state.zipUrl, null);
});
