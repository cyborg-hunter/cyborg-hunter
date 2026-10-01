// src/cli/renderers/html-index.js
// Thin Node wrapper around the pure render core (html-index-core.js):
// reads the replay viewer client and the embedded fonts from disk, writes
// index.html to outputDir.
// Public API unchanged — report.js and adopters keep calling renderHtmlIndex.
import { writeFileSync } from 'fs';
import { join } from 'path';
import { renderIndexHtml } from './html-index-core.js';
import { readReplayClientSrc } from './replay-client-source.js';
import { buildFontFaceCss } from './report-fonts.js';

// The replay viewer client is developed as real JS files (linted, syntax-
// highlighted) and embedded verbatim at render time — same file://-safe
// output as an inline IIFE, without string-blob development pain. It is a
// CONCATENATION: the client calls into src/replay/dom-instantiate.js, which
// ships ahead of it in the same script (see replay-client-source.js).
const REPLAY_CLIENT_SRC = readReplayClientSrc();
// The report's six typefaces as base64 @font-face rules (report-fonts.js),
// built once per process like the replay client.
const FONT_FACE_CSS = buildFontFaceCss();

export async function renderHtmlIndex(summaries, triage, participants, config, visualsRendered) {
  const html = await renderIndexHtml(summaries, triage, participants, config,
    visualsRendered, { replayClientSrc: REPLAY_CLIENT_SRC, fontFaceCss: FONT_FACE_CSS });
  writeFileSync(join(config.outputDir, 'index.html'), html);
  console.log('  index.html — report page');
}
