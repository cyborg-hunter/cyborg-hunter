// The analyze page's state machine over its worker, in happy-dom on the real
// demo/analyze/index.html markup. The worker is a stand-in that records what
// the page sends; each test plays the worker's side of the protocol
// (demo/analyze/worker-entry.js's header) by hand.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const PAGE_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; " +
  "img-src blob: data:; font-src data:; frame-src blob:; worker-src blob:; connect-src 'none'; " +
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
  sampled: 3,
  files: [{ path: 'a.csv', kind: 'data' }, { path: 'b.csv', kind: 'data' }, { path: 'c.json', kind: 'data' }, { path: 'cyborg-hunter.config.json', kind: 'config' }],
  configPath: 'cyborg-hunter.config.json' };
// CHECKED.config with the settings panel's keys at their defaults: what a run sends.
const PANEL_DEFAULTS = { participantIdField: 'participantId', scoreWeights: null, scoring: null, phaseScope: null,
  integrityField: 'integrity', sessionIntegrityPath: null, platformIdField: null, showPlatformId: false, trajectoryDisplayOrder: 'rule' };
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
  assert.deepEqual(visibleStep(), ['files']);
  assert.equal(role('files-panel').hidden, false);
  // Counted by what the check read each file as.
  assert.equal(role('counts').textContent, '3 data files0 replay recordings0 experiment assets1 config file');
  assert.equal(role('config-source').textContent, 'Settings from cyborg-hunter.config.json, over the defaults.');
  assert.deepEqual([...role('id-field').options].map((o) => o.value), ['subject_ID', 'run_id']);
  assert.equal(role('id-field').value, 'subject_ID');
  assert.equal(role('check-warnings').textContent, 'unknown key "dataDri"');
  assert.equal(role('id-files').textContent, '3 data files inspected');
  assert.equal(action('run').disabled, false);
});

test('check: the files the id field was looked for in are data files; the replay recordings it skipped are counted apart', async () => {
  const t = boot();
  action('sample').click();
  await tick();
  t.emit({ ...CHECKED, sampled: 1, recordings: 2 });
  await tick();
  assert.equal(role('id-files').textContent, '1 data file inspected; 2 replay recordings skipped');
});

const dropped = () => [{ path: 'study/a.csv', file: new File(['subject_ID,x\n1,2\n'], 'a.csv') },
  { path: 'study/cyborg-hunter.config.json', file: new File(['{"participantIdField":"subject_ID"}'], 'cyborg-hunter.config.json') }];
const asText = (buf) => new TextDecoder().decode(buf);
async function until(cond) { for (let i = 0; i < 50 && !cond(); i++) await tick(); assert.ok(cond(), 'condition reached'); }

test('over http the page hands the worker File handles, not bytes', async () => {
  const t = boot();
  const entries = dropped();
  t.page.addFiles(entries);
  await until(() => t.sent.length === 1);
  assert.deepEqual(t.sent[0], { type: 'check', sample: false, files: entries.map((e) => ({ path: e.path, file: e.file })) });
  assert.deepEqual(t.transfers[0], []);
});

// Opened from the demo with nothing left to hand over (main.js): the files
// step says so, until a drop, the sample or Start over.
test('an empty hand-off shows its line in the files step; a drop, the sample or Start over hides it', async () => {
  const t = boot();
  assert.equal(role('handoff-empty').hidden, true);
  t.page.handoffEmpty();
  assert.equal(role('handoff-empty').hidden, false);
  assert.equal(role('handoff-empty').textContent, 'Nothing was handed off from the demo: its files are kept for ten minutes. Drop files here instead.');
  assert.ok(document.querySelector('section[data-step="files"]').contains(role('handoff-empty')));
  assert.deepEqual(visibleStep(), ['files']);
  t.page.addFiles(dropped());
  assert.equal(role('handoff-empty').hidden, true);

  const s = boot();
  s.page.handoffEmpty();
  action('sample').click();
  assert.equal(role('handoff-empty').hidden, true, 'the sample');

  const r = boot();
  r.page.handoffEmpty();
  r.page.reset();
  assert.equal(role('handoff-empty').hidden, true, 'Start over');
});

// A drop or the sample can land before the hand-off has been read: the line
// would then sit beside a list.
test('an empty hand-off read after a drop or the sample shows no line', async () => {
  const t = boot();
  t.page.addFiles(dropped());
  t.page.handoffEmpty();
  assert.equal(role('handoff-empty').hidden, true, 'after a drop');
  const s = boot();
  action('sample').click();
  s.page.handoffEmpty();
  assert.equal(role('handoff-empty').hidden, true, 'after the sample');
});

test('from file:, the page reads each dropped file and transfers its bytes, for the check and again for the run', async () => {
  const t = boot({ transferBytes: true });
  t.page.addFiles(dropped());
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
  await t.page.addFiles([bad]).catch(() => {});
  await tick();
  assert.deepEqual(visibleStep(), ['files']);
  assert.equal(role('files-panel').hidden, true);
  assert.deepEqual(t.page.state.entries, [], 'the list is emptied, so the next drop starts clean');
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
  // The check's config with the settings panel's keys on top, here at their defaults.
  assert.deepEqual(t.sent[1], { type: 'run', files: [], sample: true, participantIdField: 'subject_ID', config: PANEL_DEFAULTS });
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
  assert.deepEqual(visibleStep(), ['files']);
  assert.equal(role('files-panel').hidden, false, 'back on the file list, ready for a retry');
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

test('a check error returns to the files step with no list', async () => {
  const t = boot();
  action('sample').click();
  await tick();
  t.emit({ type: 'error', phase: 'check', message: 'boom' });
  await tick();
  assert.deepEqual(visibleStep(), ['files']);
  assert.equal(role('files-panel').hidden, true);
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

test('start over returns to the files step and clears the run', async () => {
  const t = boot();
  await toResults(t);
  document.querySelectorAll('[data-action="reset"]')[1].click();
  assert.deepEqual(visibleStep(), ['files']);
  assert.equal(role('files-panel').hidden, true);
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
    assert.deepEqual(visibleStep(), ['files'], kind);
    assert.equal(action('run').disabled, false, kind);
    assert.ok([...document.querySelectorAll('[data-action="reset"]')].every((b) => !b.disabled), kind);
    assert.equal(role('error').hidden, false, kind);
    assert.match(role('error').textContent, /worker/i, kind);
  }
});

test('a worker failure mid-check returns to the files step with Start over usable', async () => {
  const t = boot();
  action('sample').click();
  await tick();
  t.worker.onerror({ message: 'SyntaxError' });
  await tick();
  assert.deepEqual(visibleStep(), ['files']);
  assert.equal(role('files-panel').hidden, true);
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

test('the report\'s load-time selection of a participant without a replay leaves the card on the first one with a replay; a later click moves it', async () => {
  const t = boot();
  await toResults(t);          // triage order A, B: A has no recording, B has one
  const frame = document.querySelector('iframe.analyze-report');
  const post = (pid) => window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: pid }, source: frame.contentWindow }));
  assert.equal(replaySelect().value, 'B');
  post('A');                   // the report's first message: its own pick of row 1
  assert.equal(t.page.state.selected, 'A', 'the page still knows what the report shows');
  assert.equal(replaySelect().value, 'B', 'the card keeps the first participant with a replay');
  assert.equal(action('load-replay').disabled, false);
  post('A');                   // a row click afterwards moves the card
  assert.equal(replaySelect().value, 'A');
  assert.equal(role('asset-note').textContent, 'Participant A has no replay recording.');
});

test('a Load click counts as a choice the load-time selection leaves alone', async () => {
  const t = boot();
  const post = await toResultsWithReplays(t);
  action('load-replay').click();
  post('B');
  assert.equal(replaySelect().value, 'A');
  assert.equal(t.sent.filter((m) => m.type === 'replay').length, 1);
});

// The report can select a participant who has no recording: the card must not
// keep showing the previous participant's replay beside that selection.
test('a report selection without a recording clears the replay card and says so; Load cannot bring the old replay back', async () => {
  const t = boot();
  await toResults(t);          // A has no recording, B has one
  const frame = document.querySelector('iframe.analyze-report');
  const post = (pid) => window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: pid }, source: frame.contentWindow }));
  post('B');                   // the report's load-time pick
  const loading = t.page.loadReplay();
  await tick();
  t.emit({ type: 'replay-model', participantId: 'B', model: { segments: [] } });
  await loading;
  assert.equal(document.querySelectorAll('iframe.replay-host-frame').length, 1);

  post('A');                   // a row click on a participant without a recording
  assert.equal(document.querySelectorAll('iframe.replay-host-frame').length, 0, 'B\'s replay is gone');
  assert.equal(role('asset-note').textContent, 'Participant A has no replay recording.');
  assert.equal(action('load-replay').disabled, true);
  assert.equal(replaySelect().value, 'A', 'the dropdown shows A\'s own (disabled) entry');
  const requests = t.sent.filter((m) => m.type === 'replay').length;
  action('load-replay').click();
  await t.page.loadReplay();
  await tick();
  assert.equal(t.sent.filter((m) => m.type === 'replay').length, requests, 'nothing is requested for A, and B is not loaded again');
  assert.equal(document.querySelectorAll('iframe.replay-host-frame').length, 0);

  post('B');                   // back to a participant with a recording
  assert.equal(replaySelect().value, 'B');
  assert.equal(role('asset-note').textContent, '1 of 2 stylesheets matched');
  assert.equal(action('load-replay').disabled, false);
});

test('a report selection the card does not know also clears it', async () => {
  const t = boot();
  await toResults(t);
  const loading = t.page.loadReplay();
  await tick();
  t.emit({ type: 'replay-model', participantId: 'B', model: { segments: [] } });
  await loading;
  t.page.selectParticipant('Z');
  assert.equal(document.querySelectorAll('iframe.replay-host-frame').length, 0);
  assert.equal(role('asset-note').textContent, 'Participant Z has no replay recording.');
  assert.equal(replaySelect().selectedIndex, -1);
  assert.equal(action('load-replay').disabled, true);
});

test('in a run without any recording, a report selection keeps the run-level note', async () => {
  const t = boot();
  await toCheck(t);
  action('run').click();
  await tick();
  t.emit({ ...DONE, participants: [{ participantId: 'A', hasReplay: false }] });
  await tick();
  const frame = document.querySelector('iframe.analyze-report');
  frame.dispatchEvent(new win.Event('load'));
  window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: 'A' }, source: frame.contentWindow }));
  assert.equal(role('asset-note').textContent, 'No replay recordings in this run.');
  assert.equal(action('load-replay').disabled, true);
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
  assert.deepEqual(visibleStep(), ['files']);
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
const checkedWith = (n) => ({ ...CHECKED, counts: { participant: n, replay: 0, assets: 0, ignored: 0 },
  files: Array.from({ length: n }, (_, i) => ({ path: 'p' + i + '.csv', kind: 'data' })) });

test('a cohort above the tested size shows a warning with its size; the run stays allowed', async () => {
  const t = boot();
  action('sample').click(); await tick();
  t.emit(checkedWith(151)); await tick();
  const warning = role('size-warning');
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /151/);
  assert.match(warning.textContent, /150/);
  assert.match(warning.textContent, /slow or fail/);
  // Only what is known: the CLI runs outside the browser, nothing is promised about size.
  assert.match(warning.textContent, /the CLI, which is not limited by browser memory\./);
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

// A clock the tests advance by hand: nothing here depends on real time.
// delays() lists the delay asked for by each timer still live.
function fakeTimers() {
  const live = new Map();
  let next = 1;
  return { set: (fn, ms) => { live.set(next, { fn, ms }); return next++; }, clear: (id) => { live.delete(id); },
    count: () => live.size, delays: () => [...live.values()].map((x) => x.ms),
    fire: () => { const xs = [...live.values()]; live.clear(); xs.forEach((x) => x.fn()); } };
}

// The report posts a selection when its script runs. Without one, a while
// after the frame loads, the page says the report did not render.
// happy-dom (page loading disabled) fires `error` on a frame the moment its
// src is set, which would settle every swap as a failure before a test could
// fire `load`. Inside this block frames ignore src, so each test decides;
// the hooks put createElement back for any test after it.
describe('the report render watchdog', () => {
  let createElement;
  before(() => {
    createElement = document.createElement;
    const bound = createElement.bind(document);
    document.createElement = (tag, o) => {
      const el = bound(tag, o);
      if (String(tag).toLowerCase() === 'iframe') Object.defineProperty(el, 'src', { set() {}, get() { return ''; }, configurable: true });
      return el;
    };
  });
  after(() => { document.createElement = createElement; });

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
    // to the file list, so drive run() directly.
    t.page.run();                                        // waits on the worker, which this test never answers
    assert.deepEqual(clock.delays(), [60000], 'a new run: the watchdog is gone, only the run\'s stall hint timer is live');
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
});

// A run that goes quiet for a minute gets a hint that it is still going;
// nothing is cancelled or restarted.
describe('the still-working hint', () => {
  const HINT = 'Still working — this is taking longer than usual. If nothing changes in a few minutes, reload the page.';
  const hint = () => role('stall-hint');
  const shown = () => !hint().hidden;
  function bootWatched() {
    const clock = fakeTimers();
    const t = boot({ timers: clock });
    t.terminated = 0;
    t.worker.terminate = () => { t.terminated++; };
    return { t, clock };
  }
  // Fires only the stall timer (the other clock in play is the render watchdog).
  const fireStall = (clock) => { assert.deepEqual(clock.delays(), [60000]); clock.fire(); };

  test('the hint is in the markup, hidden, with its text, inside a status live region', () => {
    boot();
    assert.equal(hint().hidden, true);
    assert.equal(hint().textContent, HINT);
    assert.ok(hint().closest('[role="status"]'), 'announced when it appears');
  });

  test('a run with no progress for a minute shows the hint; the next progress hides it and restarts the wait', async () => {
    const { t, clock } = bootWatched();
    await toCheck(t);
    assert.equal(clock.count(), 0, 'nothing is armed between the check and the run');
    action('run').click(); await tick();
    assert.deepEqual(clock.delays(), [60000]);
    assert.equal(shown(), false, 'not before the minute is up');
    t.emit({ type: 'progress', phase: 'ingest', done: 1, total: 3 });
    assert.deepEqual(clock.delays(), [60000], 'progress restarts the wait');
    fireStall(clock);
    assert.equal(shown(), true);
    assert.equal(hint().textContent, HINT);
    t.emit({ type: 'progress', phase: 'report', done: 0, total: 0, label: 'index.html' });
    assert.equal(shown(), false);
    fireStall(clock);
    assert.equal(shown(), true, 'a later stall shows it again');
  });

  test('a stalled check shows the hint too, and its result hides it', async () => {
    const { t, clock } = bootWatched();
    action('sample').click(); await tick();
    fireStall(clock);
    assert.equal(shown(), true);
    t.emit(CHECKED); await tick();
    assert.equal(shown(), false);
    assert.equal(clock.count(), 0);
  });

  test('the hint never cancels anything: the run goes on and finishes normally', async () => {
    const { t, clock } = bootWatched();
    await toCheck(t);
    action('run').click(); await tick();
    const sent = t.sent.length;
    fireStall(clock);
    assert.equal(shown(), true);
    assert.equal(t.terminated, 0, 'the worker is not terminated');
    assert.equal(t.sent.length, sent, 'nothing is sent to the worker');
    assert.deepEqual(visibleStep(), ['run']);
    assert.equal(action('run').disabled, true, 'the run is still in flight');
    t.emit({ type: 'zip', chunk: new Uint8Array([1]) });
    t.emit(DONE); await tick();
    assert.deepEqual(visibleStep(), ['results']);
    assert.equal(shown(), false, 'the result hides it');
    assert.equal(clock.count(), 0);
  });

  test('an error hides the hint; a new run starts with it hidden', async () => {
    const { t, clock } = bootWatched();
    await toCheck(t);
    action('run').click(); await tick();
    fireStall(clock);
    t.emit({ type: 'error', phase: 'ingest', message: 'No participant data found in the dropped files.' });
    await tick();
    assert.equal(shown(), false);
    assert.equal(clock.count(), 0);
    action('run').click(); await tick();
    assert.equal(shown(), false);
    assert.deepEqual(clock.delays(), [60000], 'the new run waits afresh');
  });

  test('a worker failure hides the hint', async () => {
    const { t, clock } = bootWatched();
    await toCheck(t);
    action('run').click(); await tick();
    fireStall(clock);
    t.worker.onerror({ message: 'out of memory' });
    await tick();
    assert.equal(shown(), false);
    assert.equal(clock.count(), 0);
  });

  test('start over hides the hint', async () => {
    const { t, clock } = bootWatched();
    await toResults(t);
    hint().hidden = false;           // as if a late timer had shown it
    document.querySelectorAll('[data-action="reset"]')[1].click();
    assert.equal(shown(), false);
    assert.equal(clock.count(), 0);
  });

  test('the wait is configurable', async () => {
    const clock = fakeTimers();
    const t = boot({ timers: clock, stallHintMs: 5 });
    await toCheck(t);
    action('run').click(); await tick();
    assert.deepEqual(clock.delays(), [5]);
  });
});

// One "Files & settings" step: every drop or file choice adds to the list
// (demo/analyze/files-panel.js) and checks the whole list again.
test('each addition adds to the list and checks it again; the same file is sent once, a colliding path moves to its own folder', async () => {
  const t = boot();
  const a = { path: 'data/a.csv', file: new File(['x'], 'a.csv', { lastModified: 1 }) };
  t.page.addFiles([a]);
  await until(() => t.sent.length === 1);
  t.emit({ ...CHECKED, files: [{ path: 'data/a.csv', kind: 'data' }] });
  await tick();
  const other = { path: 'data/a.csv', file: new File(['different'], 'a.csv', { lastModified: 2 }) };
  const replay = { path: 'r/A-replay-1.json', file: new File(['{}'], 'A-replay-1.json', { lastModified: 3 }) };
  t.page.addFiles([a, other, replay]);
  await until(() => t.sent.length === 2);
  assert.deepEqual(t.sent[1].files.map((f) => f.path), ['data/a.csv', 'drop2/data/a.csv', 'r/A-replay-1.json']);
});

test('a drop on the files step after a check adds to the list', async () => {
  const t = boot();
  t.page.addFiles(dropped());
  await until(() => t.sent.length === 1);
  t.emit(CHECKED);
  await tick();
  const ev = new win.Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = { items: [], files: [new File(['y'], 'more.csv', { lastModified: 5 })] };
  role('dropzone').dispatchEvent(ev);
  await until(() => t.sent.length === 2);
  assert.deepEqual(t.sent[1].files.map((f) => f.path), ['study/a.csv', 'study/cyborg-hunter.config.json', 'more.csv']);
});

test('the table lists what each file was read as, with Remove; removing the last file empties the step', async () => {
  const t = boot();
  t.page.addFiles(dropped());
  await until(() => t.sent.length === 1);
  t.emit({ ...CHECKED, files: [{ path: 'study/a.csv', kind: 'data' }, { path: 'study/cyborg-hunter.config.json', kind: 'config' }], configPath: 'study/cyborg-hunter.config.json' });
  await tick();
  const rows = () => [...role('file-rows').querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 2).map((td) => td.textContent));
  assert.deepEqual(rows(), [['study/a.csv', 'participant data'], ['study/cyborg-hunter.config.json', 'settings']]);
  assert.equal(role('config-source').textContent, 'Settings from study/cyborg-hunter.config.json, over the defaults.');
  assert.equal(role('file-rows').querySelector('[data-path="study/a.csv"]').getAttribute('aria-label'), 'Remove study/a.csv');
  role('file-rows').querySelector('[data-path="study/cyborg-hunter.config.json"]').click();
  await until(() => t.sent.length === 2);
  assert.deepEqual(t.sent[1].files.map((f) => f.path), ['study/a.csv']);
  t.emit({ ...CHECKED, configFound: false, configPath: null, files: [{ path: 'study/a.csv', kind: 'data' }] });
  await tick();
  assert.equal(role('config-source').textContent, 'Settings: the defaults (no cyborg-hunter.config.json among the files).');
  role('file-rows').querySelector('[data-path="study/a.csv"]').click();
  await tick();
  assert.deepEqual(t.sent.at(-1), { type: 'reset' }, 'nothing left to check: the page starts over');
  assert.equal(role('files-panel').hidden, true);
  assert.deepEqual(t.page.state.entries, []);
});

test('the sample lists its files without Remove controls', async () => {
  const t = boot();
  await toCheck(t);
  assert.equal(role('file-rows').querySelectorAll('tr').length, 4);
  assert.equal(role('file-rows').querySelectorAll('[data-action="remove-file"]').length, 0);
});

// The classifier lists every JSON file as participant data; the check's peek
// tells a recording apart. Run waits for a file the peek read as data.
test('a list of replay recordings only shows 0 data files, and Run stays disabled', async () => {
  const t = boot();
  action('sample').click();
  await tick();
  t.emit({ ...CHECKED, files: [{ path: 'A-replay-1.json', kind: 'recording' }, { path: 'B-replay-1.json', kind: 'recording' }] });
  await tick();
  assert.match(role('counts').textContent, /^0 data files2 replay recordings/);
  assert.equal(action('run').disabled, true);
});

// The settings panel: post-hoc keys only, applied without dropping the files
// again (demo/analyze/settings-panel.js).
const setField = (name, value) => {
  const form = role('settings-form');
  const el = form.elements.namedItem(name);
  if (el.type === 'checkbox') el.checked = value; else el.value = value;
  form.dispatchEvent(new win.Event('change', { bubbles: true }));
};
const downloads = () => [...document.querySelectorAll('[data-action="download"], [data-action="download-zip"]')];

test('the settings show from the first check on, and a run sends their config', async () => {
  const t = boot();
  assert.equal(role('settings').hidden, true, 'nothing to set before a check');
  await toCheck(t);
  assert.equal(role('settings').hidden, false);
  assert.equal(role('settings-form').querySelector('fieldset > legend').textContent, 'Settings');
  assert.ok(role('id-field').closest('label'), 'the id field has its label');
  setField('softScoreThreshold', '4');
  setField('phaseInclude', 'game, practice');
  assert.equal(t.sent.length, 1, 'no run before Build');
  action('run').click();
  await tick();
  assert.deepEqual(t.sent[1].config.scoring, { softScoreThreshold: 4 });
  assert.deepEqual(t.sent[1].config.phaseScope, { include: ['game', 'practice'] });
});

// Every drop checks the whole list again, and each check returns the merged
// config: the panel is written from it only when its values differ from the
// ones it was last written from, so a drop of more data keeps what the
// analyst set. A replacement after the first check says so under the list.
const weightInput = (key) => role('settings-form').querySelector('[data-weight="' + key + '"]');
const thresholdInput = () => role('settings-form').elements.namedItem('softScoreThreshold');
const checkNotes = () => [...role('check-warnings').children].map((li) => li.textContent);

test('a drop keeps the analyst\'s settings unless its config differs, and a replacement says so', async () => {
  const t = boot();
  t.page.addFiles(dropped());
  await until(() => t.sent.length === 1);
  t.emit(CHECKED);
  await tick();
  assert.equal(weightInput('paste').value, '5');
  weightInput('paste').value = '9';
  weightInput('paste').dispatchEvent(new win.Event('input', { bubbles: true }));
  t.page.addFiles([{ path: 'more.csv', file: new File(['y'], 'more.csv', { lastModified: 5 }) }]);
  await until(() => t.sent.length === 2);
  t.emit({ ...CHECKED, files: [...CHECKED.files, { path: 'more.csv', kind: 'data' }] });
  await tick();
  assert.equal(weightInput('paste').value, '9', 'a data-only drop keeps the edit');
  assert.deepEqual(checkNotes(), ['unknown key "dataDri"']);
  // Another config, with a threshold of its own: its values replace the panel's.
  t.page.addFiles([{ path: 'cyborg-hunter.config.json', file: new File(['{"scoring":{"softScoreThreshold":7}}'], 'cyborg-hunter.config.json', { lastModified: 6 }) }]);
  await until(() => t.sent.length === 3);
  t.emit({ ...CHECKED, config: { participantIdField: 'participantId', scoring: { softScoreThreshold: 7 } } });
  await tick();
  assert.equal(thresholdInput().value, '7');
  assert.equal(weightInput('paste').value, '5', 'the edit gives way to the file');
  assert.deepEqual(checkNotes(), ['unknown key "dataDri"', 'Settings replaced from cyborg-hunter.config.json.']);
  // One sentence per check: the next data-only drop does not repeat it.
  t.page.addFiles([{ path: 'later.csv', file: new File(['z'], 'later.csv', { lastModified: 7 }) }]);
  await until(() => t.sent.length === 4);
  t.emit({ ...CHECKED, config: { participantIdField: 'participantId', scoring: { softScoreThreshold: 7 } } });
  await tick();
  assert.deepEqual(checkNotes(), ['unknown key "dataDri"']);
});

test('removing the config puts the defaults back and says so; after Start over the first check writes the panel without a note', async () => {
  const t = boot();
  const withConfig = { ...CHECKED, config: { participantIdField: 'subject_ID', scoring: { softScoreThreshold: 7 } }, configWarnings: [],
    files: [{ path: 'study/a.csv', kind: 'data' }, { path: 'study/cyborg-hunter.config.json', kind: 'config' }], configPath: 'study/cyborg-hunter.config.json' };
  t.page.addFiles(dropped());
  await until(() => t.sent.length === 1);
  t.emit(withConfig);
  await tick();
  assert.equal(thresholdInput().value, '7');
  role('file-rows').querySelector('[data-path="study/cyborg-hunter.config.json"]').click();
  await until(() => t.sent.length === 2);
  t.emit({ ...CHECKED, config: { participantIdField: 'participantId' }, configWarnings: [], configFound: false, configPath: null,
    files: [{ path: 'study/a.csv', kind: 'data' }] });
  await tick();
  assert.equal(thresholdInput().value, '');
  assert.deepEqual(checkNotes(), ['Settings replaced with the defaults.']);
  t.page.reset();
  t.page.addFiles(dropped());
  await until(() => t.sent.length === 4);   // the reset, then the check
  t.emit(withConfig);
  await tick();
  assert.equal(thresholdInput().value, '7');
  assert.deepEqual(checkNotes(), []);
});

// The Participant ID field is listed again from each check's candidates. The
// analyst's own pick (another field than the one the check suggested) stays
// while the new list still offers it and the config is unchanged; a field the
// page itself suggested follows the new suggestion, and so does any field
// once the config changed (as the rest of the settings do).
const pickIdField = (field) => {
  role('id-field').value = field;
  role('id-field').dispatchEvent(new win.Event('change', { bubbles: true }));
};
const dropMore = async (t, name, reply) => {
  const n = t.sent.length;
  t.page.addFiles([{ path: name, file: new File([name], name, { lastModified: n + 10 }) }]);
  await until(() => t.sent.length === n + 1);
  t.emit(reply);
  await tick();
};

test('a drop keeps the analyst\'s participant-id field while the check still offers it, and the suggestion otherwise', async () => {
  const t = boot();
  t.page.addFiles(dropped());
  await until(() => t.sent.length === 1);
  t.emit(CHECKED);
  await tick();
  assert.equal(role('id-field').value, 'subject_ID');
  pickIdField('run_id');
  await dropMore(t, 'more.csv', CHECKED);
  assert.equal(role('id-field').value, 'run_id', 'a data-only drop keeps the pick');
  // run_id is no longer constant within each file: the check stops offering it.
  const withoutRunId = { ...CHECKED, idSuggestion: { suggested: 'subject_ID', candidates: [{ field: 'subject_ID', reason: 'known name' }, { field: 'pid', reason: 'constant within each file, unique across files' }] } };
  await dropMore(t, 'odd.csv', withoutRunId);
  assert.equal(role('id-field').value, 'subject_ID', 'the pick is gone from the list: the suggestion');
  // The pick gave way: a later list that offers run_id again keeps the suggestion.
  await dropMore(t, 'later.csv', CHECKED);
  assert.equal(role('id-field').value, 'subject_ID');
  action('run').click();
  await tick();
  assert.equal(t.sent.at(-1).participantIdField, 'subject_ID');
});

test('a participant-id field the page suggested follows the next check\'s suggestion; Start over forgets the analyst\'s pick', async () => {
  const t = boot();
  t.page.addFiles(dropped());
  await until(() => t.sent.length === 1);
  t.emit(CHECKED);
  await tick();
  // More data, the same config: the check now suggests run_id, subject_ID still listed.
  await dropMore(t, 'more.csv', { ...CHECKED, idSuggestion: { suggested: 'run_id', candidates: [{ field: 'run_id', reason: 'known name' }, { field: 'subject_ID', reason: 'known name' }] } });
  assert.equal(role('id-field').value, 'run_id');
  pickIdField('subject_ID');
  t.page.reset();
  t.page.addFiles(dropped());
  await until(() => t.sent.at(-1).type === 'check');
  t.emit({ ...CHECKED, idSuggestion: { suggested: 'run_id', candidates: [{ field: 'run_id', reason: 'from cyborg-hunter.config.json' }, { field: 'subject_ID', reason: 'known name' }] } });
  await tick();
  assert.equal(role('id-field').value, 'run_id', 'after Start over the first check takes the suggestion');
});

test('a config that names another participant-id field replaces the analyst\'s pick, even one still offered', async () => {
  const t = boot();
  t.page.addFiles(dropped());
  await until(() => t.sent.length === 1);
  t.emit(CHECKED);
  await tick();
  pickIdField('run_id');
  // Only the id field differs from the config before.
  await dropMore(t, 'cyborg-hunter.config.json', { ...CHECKED, config: { participantIdField: 'subject_ID' },
    idSuggestion: { suggested: 'subject_ID', candidates: [{ field: 'subject_ID', reason: 'from cyborg-hunter.config.json' }, { field: 'run_id', reason: 'constant within each file, unique across files' }] } });
  assert.equal(role('id-field').value, 'subject_ID');
  assert.deepEqual(checkNotes(), ['unknown key "dataDri"', 'Settings replaced from cyborg-hunter.config.json.']);
});

test('on the results, a post-hoc setting re-analyses without reading the files, and the report swaps in place', async () => {
  const t = boot();
  await toResults(t);
  const before = document.querySelector('iframe.analyze-report').src;
  setField('softScoreThreshold', '2');
  await tick();
  assert.deepEqual(t.sent.at(-1), { type: 'reanalyze', participantIdField: 'subject_ID',
    config: { ...PANEL_DEFAULTS, scoring: { softScoreThreshold: 2 } } });
  assert.equal(role('rerun-status').hidden, false);
  // Announced: the live region is always there, its text appears in it.
  const live = role('rerun-status').parentElement;
  assert.equal(live.getAttribute('role'), 'status');
  assert.equal(live.hidden, false);
  assert.deepEqual(visibleStep(), ['results'], 'the page stays on its results');
  t.emit({ type: 'zip', chunk: new Uint8Array([3]) });
  t.emit({ ...DONE, html: '<p>re-analysed</p>' });
  await tick();
  assert.equal(role('rerun-status').hidden, true);
  assert.notEqual(document.querySelector('iframe.analyze-report').src, before, 'a new report document');
  assert.equal(t.page.state.zipParts.length, 1, 'the zip is the new run\'s');
});

test('on the results, a change to the integrity field reads the files again', async () => {
  const t = boot();
  await toResults(t);
  setField('integrityField', 'chIntegrity');
  await tick();
  const last = t.sent.at(-1);
  assert.equal(last.type, 'run');
  assert.equal(last.sample, true);
  assert.equal(last.config.integrityField, 'chIntegrity');
});

test('Export config writes the keys that differ from the defaults and the id field, never this page\'s run paths', async () => {
  const t = boot();
  await toCheck(t);
  const made = [];
  const saved = URL.createObjectURL;
  URL.createObjectURL = (blob) => { made.push(blob); return 'blob:test'; };
  try {
    setField('softScoreThreshold', '4');
    action('export-config').click();
    const text = await made.at(-1).text();
    assert.deepEqual(JSON.parse(text), { scoring: { softScoreThreshold: 4 }, participantIdField: 'subject_ID' });
    assert.equal(text.includes('dropped files'), false);
  } finally { URL.createObjectURL = saved; }
});

// The worker answers one message at a time and its zip chunks carry no run
// id: a re-analysis holds the settings until its answer, like a run.
test('one re-analysis at a time: the settings are disabled and a change sends nothing until the first answers', async () => {
  const t = boot();
  await toResults(t);
  setField('softScoreThreshold', '2');
  await tick();
  const sent = t.sent.length;
  assert.equal(t.page.state.zipUrl, null, 'the last run\'s zip is let go before the re-analysis streams its own');
  assert.equal(role('settings-form').querySelector('fieldset').disabled, true);
  assert.ok(downloads().every((b) => b.disabled), 'the downloads wait: they would hand out the last run\'s files');
  setField('softScoreThreshold', '3');
  await tick();
  assert.equal(t.sent.length, sent, 'nothing sent while the first is in flight');
  t.emit({ type: 'zip', chunk: new Uint8Array([3]) });
  t.emit(DONE);
  await tick();
  assert.equal(role('settings-form').querySelector('fieldset').disabled, false);
  assert.ok(downloads().every((b) => !b.disabled), 'the re-analysis\'s downloads');
  assert.ok(t.page.state.zipUrl, 'the new zip is offered');
});

test('on the results, another Participant ID field reads the files again under it', async () => {
  const t = boot();
  await toResults(t);
  const sel = role('id-field');
  sel.value = 'run_id';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.deepEqual(t.sent.at(-1), { type: 'run', sample: true, files: [], participantIdField: 'run_id', config: PANEL_DEFAULTS });
  assert.equal(role('rerun-status').hidden, false);
  assert.deepEqual(visibleStep(), ['results']);
});

test('a failed re-analysis goes back to the file list with its error, its partial zip discarded', async () => {
  const t = boot();
  await toResults(t);
  setField('softScoreThreshold', '2');
  await tick();
  t.emit({ type: 'zip', chunk: new Uint8Array([9]) });
  t.emit({ type: 'error', phase: 'reanalyze', message: 'The report could not be built.' });
  await tick();
  assert.deepEqual(visibleStep(), ['files']);
  assert.equal(role('error').textContent, 'The report could not be built.');
  assert.equal(role('rerun-status').hidden, true);
  assert.deepEqual(t.page.state.zipParts, []);
  assert.equal(role('settings').hidden, false, 'the settings stay beside the list');
  assert.equal(role('settings-form').querySelector('fieldset').disabled, false);
  assert.equal(action('run').disabled, false, 'Build is offered again');
});

// A settings change keeps the analyst's place: the new report opens on the
// participant the last one had selected (the report reads #p-<id> on load,
// the id as the renderer writes it: anything but A-Z a-z 0-9 _ - becomes _),
// and the replay of theirs that was on screen loads again once it has.
// Frames here keep the src they are given and load nothing (happy-dom, page
// loading disabled, would settle every swap as a failure), as in the render
// watchdog's block; the hooks put createElement back.
describe('a re-analysis keeps the analyst\'s place', () => {
  let createElement;
  before(() => {
    createElement = document.createElement;
    const bound = createElement.bind(document);
    document.createElement = (tag, o) => {
      const el = bound(tag, o);
      if (String(tag).toLowerCase() === 'iframe') {
        let src = '';
        Object.defineProperty(el, 'src', { set(v) { src = v; }, get() { return src; }, configurable: true });
      }
      return el;
    };
  });
  after(() => { document.createElement = createElement; });

  test('a re-analysis reopens the report on the selected participant and loads their replay again', async () => {
    const t = boot({ timers: fakeTimers() });   // the render watchdog stays on a hand-driven clock
    const done = { ...DONE, triageOrder: ['A', 'p.2/b'],
      participants: [{ participantId: 'A', hasReplay: true, assetNote: null }, { participantId: 'p.2/b', hasReplay: true, assetNote: null }] };
    await toCheck(t);
    action('run').click();
    await tick();
    t.emit(done);
    await tick();
    const frame = document.querySelector('iframe.analyze-report');
    frame.dispatchEvent(new win.Event('load'));
    assert.match(frame.src, /^blob:[^#]*$/, 'nothing selected yet: the report opens on its first row');
    window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: 'p.2/b' }, source: frame.contentWindow }));
    const loading = t.page.loadReplay();
    await tick();
    t.emit({ type: 'replay-model', participantId: 'p.2/b', model: { segments: [] } });
    await loading;
    assert.equal(document.querySelector('iframe.replay-host-frame').dataset.participantId, 'p.2/b');
    setField('softScoreThreshold', '2');
    await tick();
    assert.equal(t.sent.at(-1).type, 'reanalyze');
    t.emit({ type: 'zip', chunk: new Uint8Array([3]) });
    t.emit(done);
    await tick();
    assert.match(frame.src, /^blob:[^#]*#p-p_2_b$/, 'the new report opens on the selected participant');
    assert.equal(document.querySelectorAll('iframe.replay-host-frame').length, 0, 'the old viewer went with the old report');
    frame.dispatchEvent(new win.Event('load'));
    await tick();
    assert.deepEqual(t.sent.filter((m) => m.type === 'replay').map((m) => m.participantId), ['p.2/b', 'p.2/b'], 'the replay is asked for again');
    t.emit({ type: 'replay-model', participantId: 'p.2/b', model: { segments: [] } });
    await tick();
    const host = document.querySelectorAll('iframe.replay-host-frame');
    assert.equal(host.length, 1);
    assert.equal(host[0].dataset.participantId, 'p.2/b');
    assert.equal(replaySelect().value, 'p.2/b');
    assert.equal(role('error').hidden, true, 'every swap loaded');
  });

  // A fresh report's load-time pick of a row without a replay leaves the card
  // on the first participant with one; a report reopened on a participant the
  // card already showed (the analyst's own pick) follows it there, replay or not.
  test('a re-analysis reopened on a participant without a replay shows that participant\'s entry in the card', async () => {
    const t = boot({ timers: fakeTimers() });
    await toCheck(t);
    action('run').click();
    await tick();
    t.emit(DONE);                // triage order A, B: A has no recording, B has one
    await tick();
    const frame = document.querySelector('iframe.analyze-report');
    frame.dispatchEvent(new win.Event('load'));
    const post = (pid) => window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: pid }, source: frame.contentWindow }));
    post('A');                   // the fresh report's load-time pick
    assert.equal(replaySelect().value, 'B');
    post('A');                   // the analyst clicks row A
    assert.equal(replaySelect().value, 'A');
    setField('softScoreThreshold', '2');
    await tick();
    assert.equal(t.sent.at(-1).type, 'reanalyze');
    t.emit({ type: 'zip', chunk: new Uint8Array([3]) });
    t.emit(DONE);
    await tick();
    assert.match(frame.src, /^blob:[^#]*#p-A$/, 'the new report opens on A');
    frame.dispatchEvent(new win.Event('load'));
    post('A');                   // the reopened report's load-time pick
    assert.equal(replaySelect().value, 'A', 'the card follows the analyst\'s pick');
    assert.equal(role('asset-note').textContent, 'Participant A has no replay recording.');
    assert.equal(action('load-replay').disabled, true);
  });

  // The report's own load-time pick also becomes the selection a re-analysis
  // reopens on; the card never showed it, so it is not the analyst's pick.
  test('a re-analysis reopened on the report\'s own pick without a replay leaves the card on the first participant with one', async () => {
    const t = boot({ timers: fakeTimers() });
    await toCheck(t);
    action('run').click();
    await tick();
    t.emit(DONE);                // triage order A, B: A has no recording, B has one
    await tick();
    const frame = document.querySelector('iframe.analyze-report');
    frame.dispatchEvent(new win.Event('load'));
    const post = (pid) => window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: pid }, source: frame.contentWindow }));
    post('A');                   // the fresh report's load-time pick: the card stays on B
    assert.equal(replaySelect().value, 'B');
    setField('softScoreThreshold', '2');
    await tick();
    t.emit({ type: 'zip', chunk: new Uint8Array([3]) });
    t.emit(DONE);
    await tick();
    assert.match(frame.src, /^blob:[^#]*#p-A$/, 'the new report still opens on A');
    frame.dispatchEvent(new win.Event('load'));
    post('A');                   // the new report's load-time pick
    assert.equal(replaySelect().value, 'B');
    assert.equal(action('load-replay').disabled, false);
  });
});

// Phase scope reads a trial without a phase as "default" (the worker lists
// it among the phases): the hint says so.
test('the phase hint lists the phases the run found, and what "default" stands for', async () => {
  const t = boot();
  await toCheck(t);
  assert.equal(role('phase-hint').textContent, '');
  action('run').click();
  await tick();
  t.emit({ ...DONE, phases: ['main', 'warmup'] });
  await tick();
  assert.equal(role('phase-hint').textContent, 'Phases in the data: main, warmup');
  setField('softScoreThreshold', '2');
  await tick();
  t.emit({ ...DONE, phases: ['default', 'main'] });
  await tick();
  assert.equal(role('phase-hint').textContent, 'Phases in the data: default, main (default: the trials with no phase)');
});

test('Export config on the results writes the settings, not the config the run sent the worker', async () => {
  const t = boot();
  await toCheck(t);
  action('run').click();
  await tick();
  t.emit({ ...DONE, configUsed: { participantIdField: 'subject_ID', dataDir: '(dropped files)', replayDir: null, outputDir: 'cyborg-hunter-report' } });
  await tick();
  const made = [];
  const saved = URL.createObjectURL;
  URL.createObjectURL = (blob) => { made.push(blob); return 'blob:test'; };
  try {
    action('export-config').click();
    assert.deepEqual(JSON.parse(await made.at(-1).text()), { participantIdField: 'subject_ID' });
  } finally { URL.createObjectURL = saved; }
});

test('with experiment files among the drop, the panel says where they go and the export sets assetsDir', async () => {
  const t = boot();
  action('sample').click();
  await tick();
  t.emit({ ...CHECKED, files: [...CHECKED.files, { path: 'css/style.css', kind: 'asset' }] });
  await tick();
  assert.equal(role('assets-hint').hidden, false);
  const made = [];
  const saved = URL.createObjectURL;
  URL.createObjectURL = (blob) => { made.push(blob); return 'blob:test'; };
  try {
    action('export-config').click();
    assert.deepEqual(JSON.parse(await made.at(-1).text()), { participantIdField: 'subject_ID', assetsDir: './assets' });
  } finally { URL.createObjectURL = saved; }
});

// Annotations: the report frame posts each change (its annotation script in
// parent mode); the page keeps the state under the run id in its own
// storage, posts it into the frame after each load and each change, and has
// the exports and the import (demo/analyze/annotations.js). As in the
// watchdog block, frames here ignore src (happy-dom would fail every swap at
// once) and each test fires `load`; each frame gets a stand-in window that
// records what the page posts into it.
describe('annotations', () => {
  const RUN = '0123456789abcdef';
  const DONE_ANNOTATED = { ...DONE, runId: RUN,
    triageRows: [{ participantId: 'A', tier: 'hard', triageScore: 10 }, { participantId: 'B', tier: 'clean', triageScore: 0 }] };
  let createElement;
  let posted = [];
  before(() => {
    createElement = document.createElement;
    const bound = createElement.bind(document);
    document.createElement = (tag, o) => {
      const el = bound(tag, o);
      if (String(tag).toLowerCase() === 'iframe') {
        Object.defineProperty(el, 'src', { set() {}, get() { return ''; }, configurable: true });
        Object.defineProperty(el, 'contentWindow', { configurable: true, value: { postMessage: (m) => posted.push(structuredClone(m)) } });
      }
      return el;
    };
  });
  after(() => { document.createElement = createElement; });

  async function loaded() {
    for (let i = 0; i < 20 && !document.querySelector('iframe.analyze-report'); i++) await Promise.resolve();
    await tick();
    document.querySelector('iframe.analyze-report').dispatchEvent(new win.Event('load'));
  }
  async function toAnnotatedResults() {
    posted = [];
    window.localStorage.clear();
    const t = boot({ timers: fakeTimers() });   // the render watchdog stays on a hand-driven clock
    await toCheck(t);
    action('run').click();
    await tick();
    t.emit({ type: 'zip', chunk: new Uint8Array([1, 2]) });
    t.emit(DONE_ANNOTATED);
    await loaded();
    const frame = document.querySelector('iframe.analyze-report');
    const annotate = (over, source) => window.dispatchEvent(new win.MessageEvent('message', { source: source || frame.contentWindow,
      data: { type: 'cyborg-hunter:annotate', runId: RUN, participantId: 'A', label: 'exclude', note: 'pasted', ...over } }));
    return { t, annotate };
  }
  const stored = () => JSON.parse(window.localStorage.getItem('ch-annot:' + RUN) || '{}');

  test('the page stores what the report frame posts, under the run id, and posts the state back', async () => {
    const r = await toAnnotatedResults();
    assert.deepEqual(posted, [{ type: 'cyborg-hunter:annotations', runId: RUN, annotations: {} }], 'the state goes in on load');
    r.annotate();
    assert.deepEqual([stored().A.label, stored().A.note], ['exclude', 'pasted']);
    assert.equal(posted.at(-1).annotations.A.label, 'exclude');
    // Not applied: another run, an id this report does not have, another
    // label, or a message from another window.
    r.annotate({ runId: 'ffffffffffffffff', participantId: 'B' });
    r.annotate({ participantId: 'Z' });
    r.annotate({ participantId: 'B', label: 'reject' });
    r.annotate({ participantId: 'B', label: 'flag' }, {});
    assert.deepEqual(Object.keys(stored()), ['A']);
    assert.equal(posted.length, 2);
  });

  test('a re-analysis of the same cohort keeps them, and the new report gets them on load', async () => {
    const r = await toAnnotatedResults();
    r.annotate();
    setField('softScoreThreshold', '2');
    await tick();
    assert.equal(r.t.sent.at(-1).type, 'reanalyze');
    const before = posted.length;
    r.t.emit({ type: 'zip', chunk: new Uint8Array([3]) });
    r.t.emit({ ...DONE_ANNOTATED, html: '<p>re-analysed</p>' });
    await loaded();
    assert.equal(posted.length, before + 1, 'posted on the new load');
    assert.equal(posted.at(-1).annotations.A.label, 'exclude');
  });

  test('the exports and the import are the page\'s', async () => {
    const r = await toAnnotatedResults();
    r.annotate();
    const made = [];
    const saved = URL.createObjectURL;
    URL.createObjectURL = (blob) => { made.push(blob); return 'blob:test'; };
    try {
      role('unreviewed-included').checked = true;
      action('annotations-csv').click();
      assert.match(await made.at(-1).text(), new RegExp('^participantId,tier,triageScore,label,note,annotatedAt,runId\\n' +
        'A,hard,10,exclude,pasted,[^,]+,' + RUN + '\\nB,clean,0,include,,,' + RUN + '\\n$'));
      action('annotations-json').click();
      assert.deepEqual(Object.keys(JSON.parse(await made.at(-1).text()).annotations), ['A']);
    } finally { URL.createObjectURL = saved; }
    const input = role('annotations-input');
    const file = new File([JSON.stringify({ format: 'cyborg-hunter-annotations', runId: RUN, annotations: {
      B: { label: 'flag', note: '', annotatedAt: '2026-10-05T09:00:00.000Z' }, Q: { label: 'include', note: '', annotatedAt: '2026-10-05T09:00:00.000Z' } } })], 'a.json');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new win.Event('change'));
    await until(() => role('annotations-status').textContent !== '');
    assert.equal(role('annotations-status').textContent, 'Imported 1 annotation. Not in this report: Q.');
    assert.equal(posted.at(-1).annotations.B.label, 'flag');
    assert.deepEqual(Object.keys(stored()).sort(), ['A', 'B']);
  });

  // The file is read after the change event returns, outside the page's busy
  // states, so Start over can come in between: the import has no report left.
  test('an import whose file is read after Start over is dropped, with a status line', async () => {
    const r = await toAnnotatedResults();
    let release;
    const file = { text: () => new Promise((resolve) => { release = resolve; }) };
    const input = role('annotations-input');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new win.Event('change'));
    document.querySelectorAll('[data-action="reset"]')[1].click();
    assert.deepEqual(r.t.sent.at(-1), { type: 'reset' }, 'the page was reset');
    const before = posted.length;
    release(JSON.stringify({ format: 'cyborg-hunter-annotations', runId: RUN, annotations: {
      B: { label: 'flag', note: '', annotatedAt: '2026-10-05T09:00:00.000Z' } } }));
    await until(() => role('annotations-status').textContent !== '');
    assert.equal(role('annotations-status').textContent, 'Import dropped: Start over was pressed before the file was read.');
    assert.deepEqual(stored(), {}, 'nothing stored under the old run id');
    assert.equal(posted.length, before, 'nothing posted');
  });

  // Two tabs of the page on the same cohort share the key: a change is
  // written over what storage holds at that moment, and the storage event
  // brings another tab's change into this tab's report.
  test('a change keeps what another tab of the page stored, and another tab\'s change reaches the report', async () => {
    const r = await toAnnotatedResults();
    const entry = (label) => ({ label, note: '', annotatedAt: '2026-10-05T09:00:00.000Z' });
    window.localStorage.setItem('ch-annot:' + RUN, JSON.stringify({ B: entry('flag') }));
    r.annotate();
    assert.deepEqual(Object.keys(stored()).sort(), ['A', 'B']);
    assert.deepEqual(Object.keys(posted.at(-1).annotations).sort(), ['A', 'B']);
    window.localStorage.setItem('ch-annot:' + RUN, JSON.stringify({ B: entry('include'), Z: entry('exclude') }));
    window.dispatchEvent(new win.StorageEvent('storage', { key: 'ch-annot:' + RUN }));
    assert.deepEqual(posted.at(-1).annotations, { B: entry('include') }, 'read as an import is: Z is not in this report');
  });

  // Storage that reads but will not take a write (setItem throws, as it does
  // when storage is full): a change made over storage's copy would drop the
  // change before it, which storage never took. The page's own copy is the
  // base from then on, and the status line says so once.
  test('a refused write keeps every change in the page, the report and the export, and the status line says so once', async () => {
    const r = await toAnnotatedResults();
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem() {}, clear() {}, key: () => null, length: 0 };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => full });
    const made = [];
    const saved = URL.createObjectURL;
    URL.createObjectURL = (blob) => { made.push(blob); return 'blob:test'; };
    try {
      r.annotate();
      r.annotate({ participantId: 'B', label: 'flag', note: '' });
      assert.deepEqual(Object.keys(r.t.page.state.annotations).sort(), ['A', 'B'], 'the page holds both changes');
      assert.deepEqual(Object.keys(posted.at(-1).annotations).sort(), ['A', 'B'], 'the report shows both');
      action('annotations-json').click();
      assert.deepEqual(Object.keys(JSON.parse(await made.at(-1).text()).annotations).sort(), ['A', 'B'], 'the export keeps both');
      const note = 'This browser does not let the page store annotations: they last until Start over or until the page is closed. Export JSON keeps them.';
      assert.equal(role('annotations-status').textContent, note);
      // An import's message takes the status line and keeps the note.
      const input = role('annotations-input');
      Object.defineProperty(input, 'files', { configurable: true, value: [new File([JSON.stringify({ format: 'cyborg-hunter-annotations', runId: RUN,
        annotations: { B: { label: 'include', note: '', annotatedAt: '2026-10-05T09:00:00.000Z' } } })], 'a.json')] });
      input.dispatchEvent(new win.Event('change'));
      await until(() => role('annotations-status').textContent !== note);
      assert.equal(role('annotations-status').textContent, 'Imported 1 annotation. ' + note);
      assert.deepEqual(Object.keys(r.t.page.state.annotations).sort(), ['A', 'B'], 'the import is made over the page\'s copy too');
    } finally {
      URL.createObjectURL = saved;
      Object.defineProperty(window, 'localStorage', original);
    }
  });

  test('the annotation exports and the import wait for a re-analysis, as the other downloads do', async () => {
    const r = await toAnnotatedResults();
    const controls = () => [action('annotations-csv'), action('annotations-json'), role('annotations-input')];
    assert.ok(controls().every((c) => !c.disabled));
    setField('softScoreThreshold', '2');
    await tick();
    assert.ok(controls().every((c) => c.disabled), 'the CSV would carry the last run\'s tiers and scores');
    r.t.emit({ type: 'zip', chunk: new Uint8Array([3]) });
    r.t.emit(DONE_ANNOTATED);
    await loaded();
    assert.ok(controls().every((c) => !c.disabled));
  });
});

// The replay frame (demo/analyze/replay-card.js): it may go fullscreen, it
// asks the viewer to fit the page's window, and it takes the height its own
// document posts (demo/replay-host.js), from that frame only, kept between
// 200 and 10000 px.
test('the replay frame may go fullscreen, fits the window, and takes the height its document posts, within bounds', async () => {
  const t = boot();
  await toResults(t);
  const made = [];
  const saved = URL.createObjectURL;
  // Recorded, to read back the host document the blob holds. The frame never
  // loads in this realm (disableIframePageLoading), so host.contentWindow
  // stays null, and the posts below that name it as their source carry null,
  // which is what the card compares e.source with.
  URL.createObjectURL = (blob) => { made.push(blob); return saved.call(URL, blob); };
  let host;
  try {
    const loading = t.page.loadReplay();
    await tick();
    t.emit({ type: 'replay-model', participantId: 'B', model: { segments: [] } });
    await loading;
    host = document.querySelector('iframe.replay-host-frame');
  } finally { URL.createObjectURL = saved; }
  assert.equal(host.getAttribute('allow'), 'fullscreen *');
  assert.match(await made.at(-1).text(), /, \{"noExternalCss":true,"maxStageWidth":null,"fitHeight":\d+\}\);/);
  const post = (data, source) => window.dispatchEvent(new win.MessageEvent('message', { data, source }));
  post({ type: 'cyborg-hunter:replay-height', height: 700 }, host.contentWindow);
  assert.equal(host.style.height, '702px', 'the document\'s height and the frame\'s border');
  post({ type: 'cyborg-hunter:replay-height', height: 900 }, {});                  // another window
  post({ type: 'cyborg-hunter:replay-height', height: 'tall' }, host.contentWindow);
  assert.equal(host.style.height, '702px');
  post({ type: 'cyborg-hunter:replay-height', height: 50 }, host.contentWindow);
  assert.equal(host.style.height, '200px', 'never shorter than 200 px');
  post({ type: 'cyborg-hunter:replay-height', height: 20000 }, host.contentWindow);
  assert.equal(host.style.height, '10000px', 'never taller than 10000 px');
});

// A participant whose replays were found but not attached (two sessions under
// one id) says why, in the replay card's list and in its note.
test('the replay card says why a participant\'s replay is not shown', async () => {
  const t = boot();
  await toCheck(t);
  action('run').click();
  await tick();
  const why = '2 records share the participant id "A" and 2 replays claim it (A-replay-1.json, A-replay-2.json), so which replay belongs to which session cannot be told and none is shown.';
  t.emit({ ...DONE, participants: [{ participantId: 'A', hasReplay: false, assetNote: null, replayError: why }, { participantId: 'B', hasReplay: true, assetNote: null }] });
  await tick();
  const frame = document.querySelector('iframe.analyze-report');
  frame.dispatchEvent(new win.Event('load'));
  assert.deepEqual([...replaySelect().options].map((o) => o.textContent), ['A (replay not shown)', 'B']);
  const post = (pid) => window.dispatchEvent(new win.MessageEvent('message', { data: { type: 'cyborg-hunter:select', participantId: pid }, source: frame.contentWindow }));
  post('A');                   // the report's load-time pick: the card stays on B
  assert.equal(replaySelect().value, 'B');
  post('A');                   // a row click on A
  assert.equal(role('asset-note').textContent, 'Participant A: ' + why);
  assert.equal(action('load-replay').disabled, true);
});
