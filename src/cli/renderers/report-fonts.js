// src/cli/renderers/report-fonts.js
// The report's typefaces, embedded so the report stays a single offline file.
// Reads the committed WOFF2 files listed in fonts/FONTS_MANIFEST.json and
// returns one @font-face block of base64 data URIs (≈227 KB for the six
// families). report.js passes it to buildReport as fontFaceCss, the same way
// it passes the replay viewer source, so report-core.js and html-index-core.js
// stay pure (no fs) and can be bundled for the browser /analyze/ page.
//
// Node only: keep this module out of anything the analyze page's worker
// imports (npm run demo:analyze fails the build if it leaks in).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fontFaceCss } from './font-face-css.js';

export const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fonts');

// The rule format lives in font-face-css.js; this only supplies the bytes
// from disk.
export function buildFontFaceCss(dir = FONTS_DIR) {
  const manifest = JSON.parse(readFileSync(join(dir, 'FONTS_MANIFEST.json'), 'utf8'));
  return fontFaceCss(manifest.files, p => readFileSync(join(dir, p)).toString('base64'));
}
