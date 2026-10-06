// demo/replay-host.js
// The replay's host document, for the analyze page's replay card
// (analyze/replay-card.js): a replay renders in a SEPARATE same-origin
// viewer-host iframe, a sibling of the report iframe in the page — not
// nested inside it.
//
// Root cause this works around (Codex-confirmed): the report iframe is
// sandbox="allow-scripts" (opaque origin, deliberately — see the swapIframe
// docblock in report-frame.js). replay-viewer.client.js's inner DOM-reconstruction
// iframe (sandbox="allow-same-origin", no allow-scripts) needs same-origin
// contentDocument access to rebuild the recorded page; nesting it two
// sandboxes deep forced it opaque too, so reconstruction froze at the first
// frame (mouse/keycast overlays, drawn in the OUTER document, still worked).
// This host keeps the report's own sandbox untouched — zero security
// tradeoff there — and gives the replay its own one-level-deep frame
// instead, so ITS inner reconstruction frame stays same-origin.
//
// Safety: this host's sandbox is "allow-scripts allow-same-origin", but the
// ONLY script it ever runs is our own first-party replay-viewer.client.js
// (fetched from this same origin, not visitor-controlled). The visitor's
// recorded DOM never executes here — it's rebuilt one level deeper, inside
// the viewer's OWN reconstruction iframe, which stays allow-same-origin
// WITHOUT allow-scripts plus a script-blocking CSP (see
// replay-viewer.client.js's srcdocCsp/buildSrcdoc) — a pasted <script> still
// never runs, same guarantee the CLI report's own nested replay relies on.

import { escapeScriptClose } from './report-frame.js';

// The host is a separate Blob document with no access to demo.css or the
// report's cascade, so it declares the report's tokens itself: the same
// values the CLI report's :root uses (palette + --ff-* font stacks), which
// the shared .replay-* rules (src/cli/renderers/replay-styles.js, passed in
// by the analyze page) reference. tests/demo/replay-host.test.js checks that every
// var() those rules use is declared here.
var ROOT_CSS = `
:root{ --bg:#fafafa; --surface:#ffffff; --ink:#0f0f0f; --dim:#4f4a40; --line:#b9b2a2; --hard:#d32f2f;
  --ff-space:"Space Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --ff-tomorrow:"Tomorrow",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --ff-sofia:"Sofia Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --ff-sora:"Sora",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --ff-recursive:"Recursive",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --ff-majormono:"Major Mono Display",ui-monospace,SFMono-Regular,monospace; }
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; background:var(--surface); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
body{ padding:16px; }
#ch-replay-mount{ width:100%; }
`;

// The two inlining rules, MIRRORED from src/shared/inline-safe.js — where the
// reasoning for both lives, and which this file cannot import: only demo/* and
// dist/ are copied into the deployed site (tools/assemble-demo-site.mjs), so a
// `../src/...` import would 404 on the real thing. The mirror is not left to
// good intentions: tests/demo/replay-host.test.js drives both rules through
// this file and the shared module and asserts the outputs are identical, so a
// change to one that is not made here fails the suite.
//
// Rule 2 (SOURCE), escapeScriptClose: lives in report-frame.js (imported
// above), which the analyze page shares; its docblock carries the reasoning.

// Rule 1 (DATA): escape EVERY `<`. The model carries visitor-typed and pasted
// text, and rule 2 is incomplete against it: text reading `<!-- … <script`
// puts the parser into script-data-escaped state, where this document's own
// `</script>` stops closing the element, the replay card silently never
// appears, and NOTHING is logged (reproduced in a
// browser). `\u003c` inside a JSON string literal is the same character to
// the JS parser, so the model still round-trips exactly.
function escapeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// The tag name is held apart from its `<` so this SOURCE never contains
// `<script`: the analyze page bundles this file, and its bundle is inlined
// into a <script> element for the offline single file, which
// inlineSrcHazards (src/shared/inline-safe.js) refuses to do over a `<script`.
// esbuild folds '<' + 'script>' back into one literal; a variable it keeps.
var SCRIPT_TAG = 'script';

// Pure: the host document's full HTML. DOM-free — see
// tests/demo/replay-host.test.js. `styles.replayCss` is the CLI's own
// REPLAY_STYLES_CSS and `styles.fontFaceCss` the report's base64 @font-face
// block, both handed down by the analyze page (baked into its bundle);
// without them the viewer renders unstyled in system faces.
// `viewerOpts` (optional) becomes initChReplayViewer's third argument (the
// analyze page passes { noExternalCss: true }); absent, the output is exactly
// what it was before the argument existed.
export function buildReplayHostHtml(replayModel, replayClientSrc, styles, viewerOpts) {
  var clientScript = escapeScriptClose(replayClientSrc || '');
  var modelJson = escapeJsonForScript(replayModel);
  var optsArg = viewerOpts ? ', ' + escapeJsonForScript(viewerOpts) : '';
  var fontFaceCss = (styles && styles.fontFaceCss) || '';
  var replayCss = (styles && styles.replayCss) || '';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>' + fontFaceCss + ROOT_CSS + replayCss + '</style>' +
    '</head><body>' +
    '<div id="ch-replay-mount"></div>' +
    '<' + SCRIPT_TAG + '>' + clientScript + '</' + SCRIPT_TAG + '>' +
    '<' + SCRIPT_TAG + '>window.initChReplayViewer(document.getElementById(\'ch-replay-mount\'), ' + modelJson + optsArg + ');</' + SCRIPT_TAG + '>' +
    '</body></html>'
  );
}

// Revokes the host's Blob URL and removes the whole "Session replay" card.
// The viewer client (replay-viewer.client.js) runs a RAF loop + a
// ResizeObserver and exposes no destroy() — removing the iframe from the
// document discards its browsing context (the browser stops both loops for
// us), but the Blob URL survives that and must be revoked explicitly or it
// leaks for the rest of the tab's lifetime. Safe to call whether or not a
// host is currently mounted (no-op if `.replay-host-card` isn't found), and
// safe to call on an already-detached `root` (a card removed from the live
// document by an unrelated innerHTML replacement still has a live `iframe`
// reference with its `src` intact).
export function teardownReplayHost(root) {
  if (!root) return;
  var card = root.querySelector('.replay-host-card');
  if (!card) return;
  var iframe = card.querySelector('iframe.replay-host-frame');
  if (iframe && iframe.src) URL.revokeObjectURL(iframe.src);
  card.remove();
}
