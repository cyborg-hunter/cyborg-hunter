// The shared report frame: a blob-URL swap that revokes the previous URL only
// after the new document loads, fails through a watchdog, and the script-end
// escape both the demo's replay host and the analyze page inline with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { inlineSafeSrc } from '../../src/shared/inline-safe.js';

// disableIframePageLoading: happy-dom must not try to navigate the iframe to
// the blob URL; the test dispatches `load` itself.
const win = new Window({ settings: { disableIframePageLoading: true } });
globalThis.window = win; globalThis.document = win.document;
globalThis.Blob = win.Blob; globalThis.URL = win.URL;
const { swapIframe, escapeScriptClose } = await import('../../demo/report-frame.js');
const host = await import('../../demo/replay-host.js');

test('escapeScriptClose mirrors inlineSafeSrc and is what replay-host uses', () => {
  const s = 'a</script>b</SCRIPT>c';
  assert.equal(escapeScriptClose(s), inlineSafeSrc(s));
  assert.ok(host.buildReplayHostHtml({ segments: [] }, s, {}).includes(inlineSafeSrc(s)));
});

test('swapIframe creates a sandboxed iframe with the given class and revokes the previous url on load', async () => {
  const container = document.createElement('div');
  const revoked = [];
  const origRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    const url = await new Promise((resolve, reject) => {
      const u = swapIframe(container, '<p>hi</p>', 'blob:prev', () => resolve(u), reject, { className: 'analyze-report', title: 'Report' });
      container.querySelector('iframe').dispatchEvent(new win.Event('load'));
    });
    const iframe = container.querySelector('iframe.analyze-report');
    assert.equal(iframe.getAttribute('sandbox'), 'allow-scripts');
    // The report's figures may go fullscreen. '*', not the default allowlist:
    // the framed document's origin is opaque, which no named origin matches.
    assert.equal(iframe.getAttribute('allow'), 'fullscreen *');
    assert.equal(iframe.title, 'Report');
    assert.deepEqual(revoked, ['blob:prev']);
    assert.equal(iframe.src, url);
  } finally { URL.revokeObjectURL = origRevoke; }
});

test('swapIframe keeps the demo defaults when no opts are given', () => {
  const container = document.createElement('div');
  const url = swapIframe(container, '<p>hi</p>', null, null, null);
  const iframe = container.querySelector('iframe.results-frame');
  assert.ok(iframe, 'the demo class');
  assert.equal(iframe.title, 'Your cyborg-hunter report');
  iframe.dispatchEvent(new win.Event('load'));   // settles the swap, clearing its watchdog
  URL.revokeObjectURL(url);
});

test('swapIframe revokes the fresh url and calls onFail when the frame errors', () => {
  const container = document.createElement('div');
  const revoked = [];
  const origRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    let failed = null, loaded = false;
    const url = swapIframe(container, '<p>hi</p>', 'blob:prev', () => { loaded = true; }, (e) => { failed = e; });
    container.querySelector('iframe').dispatchEvent(new win.Event('error'));
    assert.ok(failed, 'onFail called');
    assert.equal(loaded, false);
    assert.deepEqual(revoked, [url], 'the fresh url, never the one still showing');
  } finally { URL.revokeObjectURL = origRevoke; }
});

test('buildReplayHostHtml passes viewer opts through when given', () => {
  const html = host.buildReplayHostHtml({ segments: [] }, '', {}, { noExternalCss: true });
  assert.ok(html.includes('initChReplayViewer(document.getElementById(\'ch-replay-mount\'), {"segments":[]}, {"noExternalCss":true})'));
  assert.ok(host.buildReplayHostHtml({ segments: [] }, '', {}).includes('{"segments":[]});'), 'absent ⇒ unchanged');
});

// swapIframe's load watchdog runs on the global setTimeout: record the delays
// it asks for, and the callbacks, instead of waiting for real time.
function recordTimeouts(fn) {
  const calls = [];
  const orig = globalThis.setTimeout;
  globalThis.setTimeout = (cb, ms) => { calls.push({ cb, ms }); return {}; };   // an id no real timer has
  try { fn(); } finally { globalThis.setTimeout = orig; }
  return calls;
}

test('swapIframe gives a frame 5 s to load by default, opts.loadTimeoutMs when given', () => {
  const container = document.createElement('div');
  const urls = [];
  const byDefault = recordTimeouts(() => { urls.push(swapIframe(container, '<p>a</p>', null, null, null)); });
  assert.deepEqual(byDefault.map((c) => c.ms), [5000]);
  const longer = recordTimeouts(() => { urls.push(swapIframe(container, '<p>b</p>', null, null, null, { loadTimeoutMs: 60000 })); });
  assert.deepEqual(longer.map((c) => c.ms), [60000]);
  urls.forEach((u) => URL.revokeObjectURL(u));
});

test('a load that times out revokes the fresh url and calls onFail, not onload', () => {
  const container = document.createElement('div');
  const revoked = [];
  const origRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    let failed = null, loaded = false, url = null;
    const calls = recordTimeouts(() => {
      url = swapIframe(container, '<p>hi</p>', 'blob:prev', () => { loaded = true; }, (e) => { failed = e; }, { loadTimeoutMs: 60000 });
    });
    calls[0].cb();
    assert.match(String(failed && failed.message), /load timed out/);
    assert.equal(loaded, false);
    assert.deepEqual(revoked, [url], 'the fresh url, never the one still showing');
    container.querySelector('iframe').dispatchEvent(new win.Event('load'));   // a late load changes nothing
    assert.equal(loaded, false);
  } finally { URL.revokeObjectURL = origRevoke; }
});
