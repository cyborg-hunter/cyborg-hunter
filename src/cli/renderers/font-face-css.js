// src/cli/renderers/font-face-css.js
// The one @font-face formatter for the report's embedded typefaces. Pure (no
// fs), so both callers share it: the CLI (report-fonts.js reads the WOFF2
// files from disk) and the browser demo (demo/results.js fetches the same
// files and gets this through the preview-core bundle). Each manifest entry
// ({ family, weight, path }) becomes one rule with a base64 data URI.
//
// display: 'block' for the CLI report — everything is inline, so a face is
// never late and must never swap in after a fallback flash.

export function fontFaceCss(files, base64Of, display = 'block') {
  return files.map(f =>
    `@font-face { font-family: "${f.family}"; font-style: normal; font-weight: ${f.weight}; ` +
    `font-display: ${display}; src: url(data:font/woff2;base64,${base64Of(f.path)}) format("woff2"); }`
  ).join('\n');
}
