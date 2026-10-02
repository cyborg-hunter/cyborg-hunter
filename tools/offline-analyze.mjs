// tools/offline-analyze.mjs
// The analyze page as ONE file: index.html with its bundle inlined and the
// policy without 'self' (there is no origin to allow). Pure, so the assembler
// and a test share it. Every rewrite asserts its marker exists: an index.html
// that drifted must fail the build, not ship a page that half-works offline.
import { inlineSafeSrc, inlineSrcHazards } from '../src/shared/inline-safe.js';

export const OFFLINE_NAME = 'cyborg-hunter-analyze.html';
const SITE = 'https://cyborg-hunter.github.io/cyborg-hunter/';
const CHARSET = '<meta charset="utf-8">';
const SCRIPT = '<script type="module" src="./analyze.bundle.js"></script>';

function replaceOnce(html, marker, replacement) {
  if (!html.includes(marker)) throw new Error('offline analyzer: marker not found in index.html: ' + marker);
  // A function replacement, so a `$` in the bundle is never read as a pattern.
  return html.replace(marker, () => replacement);
}

export function buildOfflineHtml(indexHtml, bundleSrc) {
  const hazards = inlineSrcHazards(bundleSrc);
  if (hazards.length) throw new Error('offline analyzer: the bundle cannot be inlined safely — it ' + hazards.join('; and it '));
  // Opened from disk there is no HTTP header naming the encoding, and the
  // bundle carries non-ASCII text: the charset tag must precede the script.
  if (!indexHtml.includes(CHARSET)) throw new Error('offline analyzer: marker not found in index.html: ' + CHARSET);
  if (indexHtml.includes(SCRIPT) && indexHtml.indexOf(CHARSET) > indexHtml.indexOf(SCRIPT)) {
    throw new Error('offline analyzer: ' + CHARSET + ' must come before the bundle script in index.html');
  }
  let out = indexHtml;
  out = replaceOnce(out, SCRIPT, '<script type="module">' + inlineSafeSrc(bundleSrc) + '</script>');
  out = replaceOnce(out, "script-src 'self' 'unsafe-inline' blob:;", "script-src 'unsafe-inline' blob:;");
  out = replaceOnce(out, '<a href="./' + OFFLINE_NAME + '" download>Download this page as a single offline file</a>',
    '<span>You are using the offline file.</span>');
  out = replaceOnce(out, '<a href="../">live demo</a>', '<a href="' + SITE + '">live demo</a>');
  return out;
}
