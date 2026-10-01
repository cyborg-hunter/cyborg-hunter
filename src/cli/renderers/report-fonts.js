// src/cli/renderers/report-fonts.js
// The report's typefaces, embedded so the report stays a single offline file.
// Reads the committed WOFF2 files listed in fonts/FONTS_MANIFEST.json and
// returns one @font-face block of base64 data URIs (≈227 KB for the six
// families). html-index.js passes it to renderIndexHtml as opts.fontFaceCss,
// the same way it passes the replay viewer source, so html-index-core.js
// stays pure (no fs) and can be bundled for the browser demo.
//
// Node only: keep this module out of anything src/cli/preview-entry.js
// imports (npm run demo:preview fails the build if it leaks in).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fontFaceCss } from './font-face-css.js';

export const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fonts');

// The rule format lives in font-face-css.js (shared with the browser demo);
// this only supplies the bytes from disk.
export function buildFontFaceCss(dir = FONTS_DIR) {
  const manifest = JSON.parse(readFileSync(join(dir, 'FONTS_MANIFEST.json'), 'utf8'));
  return fontFaceCss(manifest.files, p => readFileSync(join(dir, p)).toString('base64'));
}
