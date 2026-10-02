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
const results = await import('../../demo/results.js');

test('escapeScriptClose mirrors inlineSafeSrc and is what replay-host uses', () => {
  const s = 'a</script>b</SCRIPT>c';
  assert.equal(escapeScriptClose(s), inlineSafeSrc(s));
  assert.ok(host.buildReplayHostHtml({ segments: [] }, s, {}).includes(inlineSafeSrc(s)));
});

test('results.js re-exports the shared swapIframe', () => {
  assert.equal(results.swapIframe, swapIframe);
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
