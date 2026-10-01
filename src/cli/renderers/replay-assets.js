// src/cli/renderers/replay-assets.js
// Writes per-participant replay assets into <outputDir>/replay/. Thin fs
// wrapper around replay-assets-core.js, which builds them (see there for the
// JSONP format and why it is used).
//
// The wire→viewer time conversion (the second of the two allowed conversion
// points) lives in replay/viewer-model.js (0.7.2 extraction, pure/no Node
// APIs so a browser demo can bundle it); this module re-exports it below.

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

import { buildViewerModel } from '../../replay/viewer-model.js';
import { buildReplayAssets } from './replay-assets-core.js';

// Load-bearing re-export: tests/cli/replay-render.test.js +
// tests/replay/alignment-viewer-model.test.js import it from here.
export { buildViewerModel };

// The CLI's form: writes the assets under <outputDir>/replay/.
export function renderReplayAssets(participants, outputDir) {
  // Created on the first successful write, not up front: a cohort whose
  // every artifact is unloadable would otherwise ship an empty replay/ dir
  // beside a report that says there is nothing to load.
  let dirMade = false;
  return buildReplayAssets(participants, { sink: (path, bytes) => {
    if (!dirMade) { mkdirSync(join(outputDir, 'replay'), { recursive: true }); dirMade = true; }
    writeFileSync(join(outputDir, path), bytes);
  } });
}
