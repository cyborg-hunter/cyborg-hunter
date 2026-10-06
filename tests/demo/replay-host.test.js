// tests/demo/replay-host.test.js
// DOM-free unit tests for replay-host.js's pure HTML-building step
// (walkthrough item 12). teardownReplayHost is DOM-dependent and gets its
// coverage from the analyze page's tests (tests/demo/analyze-page.test.js,
// tests/e2e/analyze/site.spec.js) — this file only exercises
// buildReplayHostHtml's escaping, since a broken escape there is a
// script-injection bug, not just a cosmetic one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReplayHostHtml } from '../../demo/replay-host.js';
import { inlineSafeJson, inlineSafeSrc } from '../../src/shared/inline-safe.js';
import { REPLAY_STYLES_CSS } from '../../src/cli/renderers/replay-styles.js';

// The model shape is a v2 VIEWER MODEL (design §9): `segments`, not `trials`.
// The demo host is the demo-regeneration path's
// consumer, and it must not be pinned against a shape buildViewerModel
// no longer produces.
test('buildReplayHostHtml embeds the mount div, the client source, and the initChReplayViewer bootstrap call', () => {
  const html = buildReplayHostHtml({ segments: [] }, 'window.initChReplayViewer = function () {};');
  assert.match(html, /<div id="ch-replay-mount"><\/div>/);
  assert.match(html, /window\.initChReplayViewer = function \(\) \{\};/);
  assert.match(html, /window\.initChReplayViewer\(document\.getElementById\('ch-replay-mount'\), \{"segments":\[\]\}\);/);
});

test('buildReplayHostHtml neutralizes a literal </script> inside the replay client source', () => {
  const html = buildReplayHostHtml({ segments: [] }, '</script><script>alert(1)</script>');
  assert.equal(html.includes('</script><script>alert(1)</script>'), false);
  assert.match(html, /<\\\/script><script>alert\(1\)<\\\/script>/);
});

test('buildReplayHostHtml escapes every < in visitor-controlled model data', () => {
  // A pasted/typed value ending up in the recorded DOM. Under v2 that value is
  // DomNode TEXT, never markup — but it still travels through JSON.stringify
  // into an inline <script>, so an escape is what stands between the visitor's
  // text and the host document's parser. The model takes the DATA rule (every
  // `<`), not the end-tag rule: see the next test for the case that forced it.
  const model = { segments: [{ initialDom: { id: 1, kind: 'text',
    text: '</script><script>alert(1)</script>' } }] };
  const html = buildReplayHostHtml(model, '');
  assert.equal(html.includes('</script><script>alert(1)</script>'), false);
  assert.match(html, /\\u003c\/script>\\u003cscript>alert\(1\)\\u003c\/script>/);
});

test('a model whose text opens script-data-escaped state cannot reach the parser', () => {
  // Reproduced in a real browser: with the
  // end-tag rule the host document below stayed double-escaped to EOF, so its
  // own </script> never closed the element, the replay card silently never
  // appeared, and no error was raised. No `</script` is needed for it.
  const model = { segments: [{ initialDom: { id: 1, kind: 'text',
    text: 'note: <!-- and then a <script> element' } }] };
  const html = buildReplayHostHtml(model, '');
  const bootstrap = html.slice(html.lastIndexOf('<script>'));
  assert.equal(/<!--/.test(bootstrap), false, 'no unpaired comment opener survives');
  assert.equal(/<script[\s/>]/i.test(bootstrap.slice('<script>'.length)), false,
    'no second script-tag opener survives inside the payload');
  assert.match(html, /\\u003c!-- and then a \\u003cscript> element/,
    'and the text is preserved exactly, as escapes');
});

test('both inlining rules mirror src/shared/inline-safe.js exactly', () => {
  // demo/ cannot import from src/ (only demo/* and dist/ reach the deployed
  // site), so the rules are copied here. This is the check that keeps the copy
  // honest: it drives the same adversarial inputs through both and compares.
  const hostileSrc = 'var re = /</g; // </SCRIPT > and a < b';
  const hostileModel = { t: 'x </script> y <!-- z <script> w', n: 1 < 2 };
  const html = buildReplayHostHtml(hostileModel, hostileSrc);
  assert.ok(html.includes(inlineSafeSrc(hostileSrc)),
    'the source rule must match inlineSafeSrc');
  assert.ok(html.includes(inlineSafeJson(hostileModel)),
    'the data rule must match inlineSafeJson');
});

// The .replay-* rules are no longer copied here: they come from the CLI's
// own src/cli/renderers/replay-styles.js, passed down by the analyze page
// (baked into its bundle), together with the report's @font-face block.
test('buildReplayHostHtml uses the replay CSS and font faces it is given', () => {
  const html = buildReplayHostHtml({ segments: [] }, '', { replayCss: REPLAY_STYLES_CSS, fontFaceCss: '@font-face { font-family: "Sora"; }' });
  assert.ok(html.includes(REPLAY_STYLES_CSS), 'the shared replay rules, verbatim');
  assert.ok(html.includes('@font-face { font-family: "Sora"; }'), 'the font faces');
});

test('the host :root declares every token the shared replay CSS uses', () => {
  const html = buildReplayHostHtml({ segments: [] }, '', { replayCss: REPLAY_STYLES_CSS });
  const root = html.match(/:root\{([^}]*)\}/)[1];
  const declared = new Set([...root.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const used = new Set([...REPLAY_STYLES_CSS.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]));
  assert.deepEqual([...used].filter(v => !declared.has(v)), []);
});

test('the host :root matches the report palette (high-contrast lines)', () => {
  const html = buildReplayHostHtml({ segments: [] }, '');
  assert.match(html, /--ink:#0f0f0f/);
  assert.match(html, /--line:#b9b2a2/);
});

// The host tells the page that frames it how tall it is (demo/analyze/
// replay-card.js sizes the frame from it). The script is taken from the
// built document and run over stand-ins for the three globals it reads.
test('the host posts its document height to the framing page, and again whenever it changes', () => {
  const html = buildReplayHostHtml({ segments: [] }, '');
  const reporter = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    .find((s) => s.includes('cyborg-hunter:replay-height'));
  assert.ok(reporter, 'a script of its own');
  const sent = [];
  let height = 300;
  let observed = null;
  const document = { body: {}, documentElement: { getBoundingClientRect: () => ({ height }) } };
  const window = { parent: { postMessage: (msg, target) => sent.push([msg, target]) } };
  function ResizeObserver(cb) { this.observe = (el) => { observed = { el, cb }; }; }
  new Function('window', 'document', 'ResizeObserver', reporter)(window, document, ResizeObserver);
  assert.deepEqual(sent, [[{ type: 'cyborg-hunter:replay-height', height: 300 }, '*']]);
  assert.equal(observed.el, document.body);
  observed.cb();                      // the same height: nothing posted
  height = 512.4;
  observed.cb();
  assert.deepEqual(sent, [[{ type: 'cyborg-hunter:replay-height', height: 300 }, '*'],
    [{ type: 'cyborg-hunter:replay-height', height: 513 }, '*']]);
});
