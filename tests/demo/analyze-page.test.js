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
  const worker = { postMessage: (m) => sent.push(m), onmessage: null, onerror: null, onmessageerror: null };
  const page = createPage(document.body, worker, {});
  const emit = (data) => worker.onmessage({ data });
  emit({ type: 'ready', assets: { replayClientSrc: '', replayCss: '', fontFaceCss: '@font-face{}' }, limits: { testedParticipants: 150, testedFixture: 'x' } });
  return { page, sent, emit, worker };
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
  // JSON files sit in both of the classifier's lists; the page counts each file once.
  assert.match(role('counts').textContent, /^3 data files \(2 CSV, 1 JSON: participant data or recordings, told apart when the report is built\)0 experiment assets1 config file$/);
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

test('a worker failure mid-run recovers like a run error: chunks discarded, controls back, retry offered', async () => {
  for (const kind of ['onerror', 'onmessageerror']) {
    const t = boot();
    await toCheck(t);
    action('run').click();
    await tick();
    t.emit({ type: 'zip', chunk: new Uint8Array([1]) });
    t.worker[kind]({ message: 'out of memory' });
    await tick();
    assert.deepEqual(t.page.state.zipParts, [], kind);
    assert.deepEqual(visibleStep(), ['check'], kind);
    assert.equal(action('run').disabled, false, kind);
    assert.ok([...document.querySelectorAll('[data-action="reset"]')].every((b) => !b.disabled), kind);
    assert.equal(role('error').hidden, false, kind);
    assert.match(role('error').textContent, /worker/i, kind);
  }
});

test('a worker failure mid-check returns to the drop step with Start over usable', async () => {
  const t = boot();
  action('sample').click();
  await tick();
  t.worker.onerror({ message: 'SyntaxError' });
  await tick();
  assert.deepEqual(visibleStep(), ['drop']);
  assert.match(role('error').textContent, /SyntaxError/);
  assert.ok([...document.querySelectorAll('[data-action="reset"]')].every((b) => !b.disabled));
  action('sample').click();   // a retry is accepted
  await tick();
  assert.equal(t.sent.filter((m) => m.type === 'check').length, 2);
});

test('start over removes the old report frame and revokes its url', async () => {
  const t = boot();
  const revoked = [];
  const orig = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => { revoked.push(u); };
  try {
    await toResults(t);
    const url = document.querySelector('iframe.analyze-report').src;
    document.querySelectorAll('[data-action="reset"]')[1].click();
    assert.equal(document.querySelector('iframe.analyze-report'), null);
    assert.ok(revoked.includes(url));
    assert.equal(role('run-warnings').children.length, 0);
  } finally { URL.revokeObjectURL = orig; }
});

test('a failed report swap does not keep the dead url as the one to revoke next', async () => {
  const t = boot();
  const revoked = [];
  const orig = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => { revoked.push(u); };
  try {
    await toResults(t);                                   // first report loads
    const first = document.querySelector('iframe.analyze-report').src;
    document.querySelectorAll('[data-action="reset"]')[1].click();
    revoked.length = 0;
    await toCheck(t);
    action('run').click(); await tick();
    t.emit(DONE); await tick();
    const frame = document.querySelector('iframe.analyze-report');
    const failed = frame.src;
    frame.dispatchEvent(new win.Event('error'));         // this swap fails
    assert.deepEqual(revoked, [failed], 'the fresh url only');
    assert.notEqual(failed, first);
    document.querySelectorAll('[data-action="reset"]')[1].click();
    assert.equal(revoked.filter((u) => u === failed).length, 1, 'never revoked twice, never kept');
  } finally { URL.revokeObjectURL = orig; }
});

test('a selection message counts only from the report frame, and only for a known participant id', async () => {
  const t = boot();
  await toResults(t);
  const frame = document.querySelector('iframe.analyze-report');
  const post = (data, source) => window.dispatchEvent(new win.MessageEvent('message', { data, source }));
  post({ type: 'cyborg-hunter:select', participantId: 'A' }, {});   // another window
  assert.equal(t.page.state.selected, null);
  post({ type: 'cyborg-hunter:select', participantId: { toString: () => 'A' } }, frame.contentWindow);
  assert.equal(t.page.state.selected, null);
  post({ type: 'cyborg-hunter:select', participantId: 'nobody' }, frame.contentWindow);
  assert.equal(t.page.state.selected, null);
  post({ type: 'cyborg-hunter:select', participantId: 'A' }, frame.contentWindow);
  assert.equal(t.page.state.selected, 'A');
});

test('after a worker failure the page retries on a fresh worker from the factory, and the retry completes', async () => {
  document.head.innerHTML = '';
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
  const workers = [];
  const makeWorker = () => {
    const w = { sent: [], terminated: false, onmessage: null, onerror: null, onmessageerror: null,
      postMessage(m) { this.sent.push(m); }, terminate() { this.terminated = true; } };
    workers.push(w);
    return w;
  };
  const page = createPage(document.body, makeWorker(), { createWorker: makeWorker });
  const ready = { type: 'ready', assets: { replayClientSrc: '', replayCss: '', fontFaceCss: '@font-face{}' }, limits: { testedParticipants: 150 } };
  workers[0].onmessage({ data: ready });
  action('sample').click(); await tick();
  workers[0].onmessage({ data: CHECKED }); await tick();
  action('run').click(); await tick();
  workers[0].onmessage({ data: { type: 'zip', chunk: new Uint8Array([9]) } });
  workers[0].onerror({ message: 'killed' });
  await tick();
  assert.equal(workers.length, 2, 'a new worker was created');
  assert.equal(workers[0].terminated, true, 'the failed one is terminated');
  assert.deepEqual(page.state.zipParts, []);
  // A late message from the dead worker is ignored.
  workers[0].onmessage({ data: DONE });
  await tick();
  assert.deepEqual(visibleStep(), ['check']);
  workers[1].onmessage({ data: ready });
  assert.equal([...document.head.querySelectorAll('style')].length, 1, 'fonts installed once');
  action('run').click(); await tick();
  assert.equal(workers[1].sent.filter((m) => m.type === 'run').length, 1, 'the retry goes to the new worker');
  assert.equal(workers[0].sent.filter((m) => m.type === 'run').length, 1);
  workers[1].onmessage({ data: { type: 'zip', chunk: new Uint8Array([1, 2]) } });
  workers[1].onmessage({ data: DONE });
  await tick();
  document.querySelector('iframe.analyze-report').dispatchEvent(new win.Event('load'));
  assert.deepEqual(visibleStep(), ['results']);
  assert.equal(page.state.zipParts.length, 1);
});

test('a worker failure with several replay requests outstanding settles them all; the next replay pairs with its own answer', async () => {
  document.head.innerHTML = '';
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
  const workers = [];
  const makeWorker = () => {
    const w = { sent: [], onmessage: null, onerror: null, onmessageerror: null,
      postMessage(m) { this.sent.push(m); }, terminate() {} };
    workers.push(w);
    return w;
  };
  const page = createPage(document.body, makeWorker(), { createWorker: makeWorker });
  const ready = { type: 'ready', assets: { replayClientSrc: '', replayCss: '', fontFaceCss: '@font-face{}' }, limits: { testedParticipants: 150 } };
  const w0 = (data) => workers[0].onmessage({ data });
  w0(ready);
  action('sample').click(); await tick();
  w0(CHECKED); await tick();
  action('run').click(); await tick();
  w0({ type: 'zip', chunk: new Uint8Array([1]) });
  w0(DONE); await tick();
  document.querySelector('iframe.analyze-report').dispatchEvent(new win.Event('load'));
  const first = page.loadReplay();
  const second = page.loadReplay();
  await tick();
  workers[0].onerror({ message: 'killed' });
  assert.notEqual(await outcome(first), 'pending');
  assert.notEqual(await outcome(second), 'pending');
  // On the new worker, one request gets exactly its own answer.
  workers[1].onmessage({ data: ready });
  const third = page.loadReplay();
  await tick();
  workers[1].onmessage({ data: { type: 'replay-model', participantId: 'B', model: { segments: [] } } });
  assert.equal(await outcome(third), 'resolved');
  assert.equal(document.querySelectorAll('iframe.replay-host-frame').length, 1);
});
