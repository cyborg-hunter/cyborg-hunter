// demo/report-frame.js
// The analyze page's report frame (analyze/page.js): a sandboxed Blob-URL
// iframe swap, and the script-end escape every inline <script> the page and
// its replay host (replay-host.js) build goes through.
//
// Like everything under demo/, this file cannot import from src/: only
// demo/* and dist/ are copied into the deployed site
// (tools/assemble-demo-site.mjs), so a `../src/...` import would 404 there.

// Per swap: the blob iframe actually rendering. Sized for the demo's report
// (a handful of participants); a caller with a larger document passes
// opts.loadTimeoutMs.
var IFRAME_LOAD_TIMEOUT_MS = 5000;

// Swaps the report iframe to freshly-built HTML via a Blob URL. The OLD url
// is revoked only once the NEW document's `load` fires — a visible frame
// never points at a revoked url (spec §7.3). Any failure — the iframe firing
// `error`, or `load` never firing within the load timeout — revokes the
// FRESH url instead (the old one, if any, is left alone and still showing)
// and calls onFail rather than onload.
// opts (optional): { className, title } of the iframe, and loadTimeoutMs
// (default IFRAME_LOAD_TIMEOUT_MS); the defaults are the demo's own.
export function swapIframe(container, html, prevUrl, onload, onFail, opts) {
  var className = (opts && opts.className) || 'results-frame';
  var title = (opts && opts.title) || 'Your cyborg-hunter report';
  var loadTimeoutMs = (opts && opts.loadTimeoutMs) || IFRAME_LOAD_TIMEOUT_MS;
  var iframe = container.querySelector('iframe.' + className);
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.className = className;
    // allow-scripts only (no allow-same-origin): opaque origin. Scripts run,
    // so the report's own row-click/legend/replay JS works now that there
    // are multiple participants (only the first is visible by default) —
    // but the frame can't reach this page, storage, or the network, and the
    // report string embeds arbitrary visitor-triggered text (pasted content
    // etc.), so the most restrictive sandbox that still runs the report is
    // the right default.
    iframe.setAttribute('sandbox', 'allow-scripts');
    // The report's figures may go fullscreen, and nothing else is granted.
    // The allowlist is '*' because the framed document's origin is opaque,
    // which no named origin matches: Firefox and WebKit refuse the default
    // ('src') for it, Chromium does not (measured 2026-10-05).
    iframe.setAttribute('allow', 'fullscreen *');
    iframe.title = title;
    container.appendChild(iframe);
  }
  var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  var settled = false;
  function finish(fn) {
    if (settled) return;
    settled = true;
    iframe.removeEventListener('load', onLoad);
    iframe.removeEventListener('error', onError);
    clearTimeout(watchdogId);
    fn();
  }
  function onLoad() {
    finish(function () {
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      if (onload) onload();
    });
  }
  function onError(err) {
    finish(function () {
      URL.revokeObjectURL(url);
      if (onFail) onFail(err);
    });
  }
  var watchdogId = setTimeout(function () { onError(new Error('report iframe: load timed out')); }, loadTimeoutMs);
  iframe.addEventListener('load', onLoad);
  iframe.addEventListener('error', onError);
  iframe.src = url;
  return url;
}

// Inlining rule 2 (SOURCE), MIRRORED from src/shared/inline-safe.js (where
// the reasoning lives; see the import note above for why it is a copy).
// tests/demo/replay-host.test.js and tests/demo/report-frame.test.js drive
// it and the shared module with the same inputs and assert identical output.
// Neutralize `</script`, the only sequence that closes a <script> element,
// and nothing else. Nothing wider is safe here — replayClientSrc is JS
// SOURCE and contains its own `/</g` regex literal (attrEscape's `<` ->
// `&lt;` rule), so a bare `</` replace strips that regex's closing delimiter
// and throws "Invalid regular expression: missing /" (found by driving this
// live).
export function escapeScriptClose(s) {
  // `$1` rather than a literal `script`: the match is case-insensitive, so a
  // literal replacement would rewrite `</SCRIPT` to `<\/script` and change the
  // VALUE of any string in the source that contains it. (The mirror test
  // caught this divergence between two of the copies — the report's kept the
  // case, this one did not.)
  return String(s).replace(/<\/(script)/gi, '<\\/$1');
}
