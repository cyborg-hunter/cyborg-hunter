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

// opts go to createPage. With opts.transferBytes the stand-in puts each
// message through structuredClone with its transfer list, as the worker
// boundary does: a transferred buffer is detached on the page's side.
function boot(opts) {
  document.head.innerHTML = '';
  // The body without its <script>: the bundle is what this test imports.
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
  const sent = [];
  const transfers = [];
  const worker = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: (m, transfer) => {
      transfers.push(transfer || []);
      sent.push(opts && opts.transferBytes ? structuredClone(m, { transfer: transfer || [] }) : m);
    } };
  const page = createPage(document.body, worker, opts || {});
  const emit = (data) => worker.onmessage({ data });
  emit({ type: 'ready', assets: { replayClientSrc: '', replayCss: '', fontFaceCss: '@font-face{}' }, limits: { testedParticipants: 150, testedFixture: 'x' } });
  return { page, sent, transfers, emit, worker };
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

const dropped = () => [{ path: 'study/a.csv', file: new File(['subject_ID,x\n1,2\n'], 'a.csv') },
  { path: 'study/cyborg-hunter.config.json', file: new File(['{"participantIdField":"subject_ID"}'], 'cyborg-hunter.config.json') }];
const asText = (buf) => new TextDecoder().decode(buf);
async function until(cond) { for (let i = 0; i < 50 && !cond(); i++) await tick(); assert.ok(cond(), 'condition reached'); }

test('over http the page hands the worker File handles, not bytes', async () => {
  const t = boot();
  const entries = dropped();
  t.page.setFiles(entries);
  await until(() => t.sent.length === 1);
  assert.deepEqual(t.sent[0], { type: 'check', sample: false, files: entries.map((e) => ({ path: e.path, file: e.file })) });
  assert.deepEqual(t.transfers[0], []);
});

test('from file:, the page reads each dropped file and transfers its bytes, for the check and again for the run', async () => {
  const t = boot({ transferBytes: true });
  t.page.setFiles(dropped());
  await until(() => t.sent.length === 1);
  const check = t.sent[0];
  assert.equal(check.type, 'check');
  assert.deepEqual(check.files.map((f) => f.path), ['study/a.csv', 'study/cyborg-hunter.config.json']);
  assert.ok(check.files.every((f) => f.bytes instanceof ArrayBuffer && !('file' in f)));
  assert.deepEqual(check.files.map((f) => asText(f.bytes)), ['subject_ID,x\n1,2\n', '{"participantIdField":"subject_ID"}']);
  // Transferred, not copied: the page's buffers are detached now.
  assert.equal(t.transfers[0].length, 2);
  assert.ok(t.transfers[0].every((b) => b instanceof ArrayBuffer && b.byteLength === 0));
  t.emit(CHECKED);
  await tick();
  action('run').click();
  await until(() => t.sent.length === 2);
  assert.equal(t.sent[1].type, 'run');
  assert.deepEqual(t.sent[1].files.map((f) => asText(f.bytes)), ['subject_ID,x\n1,2\n', '{"participantIdField":"subject_ID"}'], 'read afresh for the run');
});

test('from file:, a file that cannot be read fails the check like any check error', async () => {
  const t = boot({ transferBytes: true });
  const bad = { path: 'gone.csv', file: { size: 1, arrayBuffer: () => Promise.reject(new Error('NotFoundError: the file is gone')) } };
  await t.page.setFiles([bad]).catch(() => {});
  await tick();
  assert.deepEqual(visibleStep(), ['drop']);
  assert.match(role('error').textContent, /the file is gone/);
  assert.equal(t.sent.length, 0);
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
  // The run's file warnings go under the check's config warnings.
  assert.deepEqual([...role('check-warnings').children].map((li) => li.textContent), ['unknown key "dataDri"', 'a.csv: Failed to parse: x']);
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

test('start over tells the worker to let go of the last run', async () => {
  const t = boot();
  await toResults(t);
  document.querySelectorAll('[data-action="reset"]')[1].click();
  assert.deepEqual(t.sent.at(-1), { type: 'reset' });
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

// The report selects its first row on load and posts it; that message can
// arrive after the analyst has already picked a replay.
async function toResultsWithReplays(t) {
  await toCheck(t);
  action('run').click();
  await tick();
  t.emit({ ...DONE, participants: [{ participantId: 'A', hasReplay: true, assetNote: null }, { participantId: 'B', hasReplay: true, assetNote: null }] });
  await tick();
  const frame = document.querySelector('iframe.analyze-report');
  return (pid) => window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: pid }, source: frame.contentWindow }));
}
const replaySelect = () => document.querySelector('[data-role="replay-select"]');

test('the report\'s load-time selection does not undo a replay the analyst already chose', async () => {
  const t = boot();
  const post = await toResultsWithReplays(t);
  replaySelect().value = 'B';
  replaySelect().dispatchEvent(new win.Event('change'));
  post('A');                                   // the report's first message: its own pick of row 1
  assert.equal(t.page.state.selected, 'A', 'the page still knows what the report shows');
  assert.equal(replaySelect().value, 'B', 'the analyst\'s choice stands');
  post('A');                                   // a row click afterwards syncs as before
  assert.equal(replaySelect().value, 'A');
});

test('the report\'s load-time selection moves the replay dropdown when the analyst has not chosen', async () => {
  const t = boot();
  const post = await toResultsWithReplays(t);
  assert.equal(replaySelect().value, 'A');
  post('B');
  assert.equal(replaySelect().value, 'B');
});

test('a Load click counts as a choice the load-time selection leaves alone', async () => {
  const t = boot();
  const post = await toResultsWithReplays(t);
  action('load-replay').click();
  post('B');
  assert.equal(replaySelect().value, 'A');
  assert.equal(t.sent.filter((m) => m.type === 'replay').length, 1);
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

// A cohort above the size the page was tested with is allowed, with a warning.
const checkedWith = (n) => ({ ...CHECKED, counts: { participant: n, replay: 0, assets: 0, ignored: 0 } });

test('a cohort above the tested size shows a warning with its size; the run stays allowed', async () => {
  const t = boot();
  action('sample').click(); await tick();
  t.emit(checkedWith(151)); await tick();
  const warning = role('size-warning');
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /151/);
  assert.match(warning.textContent, /150/);
  assert.match(warning.textContent, /slow or fail/);
  assert.match(warning.textContent, /CLI/);
  assert.equal(action('run').disabled, false);
});

test('a cohort at the tested size shows no warning, and a new check clears an earlier one', async () => {
  const t = boot();
  action('sample').click(); await tick();
  t.emit(checkedWith(150)); await tick();
  assert.equal(role('size-warning').hidden, true);
  document.querySelectorAll('[data-action="reset"]')[0].click();
  action('sample').click(); await tick();
  t.emit(checkedWith(400)); await tick();
  assert.equal(role('size-warning').hidden, false);
  document.querySelectorAll('[data-action="reset"]')[0].click();
  action('sample').click(); await tick();
  assert.equal(role('size-warning').hidden, true, 'hidden again while the next check is read');
});

// The report posts a selection when its script runs. Without one, a while
// after the frame loads, the page says the report did not render.
// happy-dom (page loading disabled) fires `error` on a frame the moment its
// src is set, which would settle every swap as a failure before a test could
// fire `load`. From here on frames ignore src, so each test decides.
// These are the last tests in the file.
test('report frames take no src in the tests that follow', () => {
  const createElement = document.createElement.bind(document);
  document.createElement = (tag, o) => {
    const el = createElement(tag, o);
    if (String(tag).toLowerCase() === 'iframe') Object.defineProperty(el, 'src', { set() {}, get() { return ''; }, configurable: true });
    return el;
  };
});
// A clock the tests advance by hand: nothing here depends on real time.
function fakeTimers() {
  const live = new Map();
  let next = 1;
  return { set: (fn) => { live.set(next, fn); return next++; }, clear: (id) => { live.delete(id); },
    count: () => live.size, fire: () => { const fns = [...live.values()]; live.clear(); fns.forEach((f) => f()); } };
}
async function toLoadedReport(t, done) {
  await toCheck(t);
  action('run').click(); await tick();
  t.emit(done || DONE);
  // happy-dom fires `error` on a blob: frame within a macrotask: load first.
  for (let i = 0; i < 20 && !document.querySelector('iframe.analyze-report'); i++) await Promise.resolve();
  const frame = document.querySelector('iframe.analyze-report');
  frame.dispatchEvent(new win.Event('load'));
  return frame;
}
const selectFrom = (frame) => window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: 'A' }, source: frame.contentWindow }));

test('no selection message after the report frame loads: an error names the zip and the CLI, and nothing is torn down', async () => {
  const clock = fakeTimers();
  const t = boot({ timers: clock });
  await toLoadedReport(t);
  assert.equal(clock.count(), 1, 'armed by the frame\'s load');
  assert.equal(role('error').hidden, true, 'not before the time is up');
  clock.fire();
  assert.equal(role('error').hidden, false);
  assert.match(role('error').textContent, /did not finish rendering/);
  assert.match(role('error').textContent, /zip/);
  assert.match(role('error').textContent, /index\.html/);
  assert.match(role('error').textContent, /CLI/);
  assert.deepEqual(visibleStep(), ['results']);
  assert.ok(document.querySelector('iframe.analyze-report'));
  assert.equal(action('download-zip').disabled, false);
});

test('the watchdog is cancelled when the report posts its selection, or has posted it before the frame\'s load event', async () => {
  const clock = fakeTimers();
  const t = boot({ timers: clock });
  const frame = await toLoadedReport(t);
  assert.equal(clock.count(), 1);
  selectFrom(frame);
  assert.equal(clock.count(), 0);
  clock.fire();
  assert.equal(role('error').hidden, true);

  const clock2 = fakeTimers();
  const t2 = boot({ timers: clock2 });
  await toCheck(t2);
  action('run').click(); await tick();
  t2.emit(DONE);
  for (let i = 0; i < 20 && !document.querySelector('iframe.analyze-report'); i++) await Promise.resolve();
  const early = document.querySelector('iframe.analyze-report');
  selectFrom(early);                                   // the script ran before `load` fired
  early.dispatchEvent(new win.Event('load'));
  assert.equal(clock2.count(), 0, 'never armed');
  assert.equal(role('error').hidden, true);
});

test('a message from another window does not stop the watchdog', async () => {
  const clock = fakeTimers();
  const t = boot({ timers: clock });
  await toLoadedReport(t);
  window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: 'A' }, source: {} }));
  assert.equal(clock.count(), 1);
  clock.fire();
  assert.equal(role('error').hidden, false);
});

test('start over and a new run cancel the watchdog', async () => {
  const clock = fakeTimers();
  const t = boot({ timers: clock });
  await toLoadedReport(t);
  document.querySelectorAll('[data-action="reset"]')[1].click();
  assert.equal(clock.count(), 0, 'start over');

  await toLoadedReport(t);
  assert.equal(clock.count(), 1);
  // A new run started while the old one is armed: reset is the only way back
  // to the check step, so drive run() directly.
  t.page.run();                                        // waits on the worker, which this test never answers
  assert.equal(clock.count(), 0, 'a new run');
});

test('a report with no participants arms no watchdog: it has nothing to select', async () => {
  const clock = fakeTimers();
  const t = boot({ timers: clock });
  await toLoadedReport(t, { ...DONE, participants: [], triageOrder: [] });
  assert.equal(clock.count(), 0);
});

test('the report frame gets a minute to load, not the demo\'s 5 s: a large cohort\'s report is tens of MB', async () => {
  const clock = fakeTimers();
  const t = boot({ timers: clock });
  // The frame's load watchdog (report-frame.js) runs on the global clock:
  // record the long delays asked for, pass the short ones (tick()) through.
  const delays = [];
  const orig = globalThis.setTimeout;
  globalThis.setTimeout = (cb, ms, ...rest) => { if (ms >= 1000) { delays.push(ms); return {}; } return orig(cb, ms, ...rest); };
  try { await toLoadedReport(t); } finally { globalThis.setTimeout = orig; }
  assert.deepEqual(delays, [60000]);
});

test('a selection that arrives after the render watchdog fired clears its error', async () => {
  const clock = fakeTimers();
  const t = boot({ timers: clock });
  const frame = await toLoadedReport(t);
  clock.fire();
  assert.equal(role('error').hidden, false);
  selectFrom(frame);
  assert.equal(role('error').hidden, true);
  assert.equal(role('error').textContent, '');
});

test('a selection leaves any other error on screen', async () => {
  const clock = fakeTimers();
  const t = boot({ timers: clock });
  const frame = await toLoadedReport(t);
  selectFrom(frame);
  t.emit({ type: 'error', phase: 'replay', message: 'replay failed: bad recording' });
  selectFrom(frame);
  assert.equal(role('error').hidden, false);
  assert.match(role('error').textContent, /bad recording/);
  // The watchdog fired, then another error replaced its message: the late
  // selection does not clear that one either.
  const clock2 = fakeTimers();
  const t2 = boot({ timers: clock2 });
  const frame2 = await toLoadedReport(t2);
  clock2.fire();
  t2.emit({ type: 'error', phase: 'replay', message: 'replay failed: bad recording' });
  selectFrom(frame2);
  assert.equal(role('error').hidden, false);
  assert.match(role('error').textContent, /bad recording/);
});
