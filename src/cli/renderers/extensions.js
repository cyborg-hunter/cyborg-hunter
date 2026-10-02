// src/cli/renderers/extensions.js
// Writes extensions.csv — lists which AI extensions/tools were detected
// for which participants. Thin fs wrapper around extensions-core.js, which
// builds the text.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildExtensionsCsv } from './extensions-core.js';

export async function renderExtensions(participants, config) {
  const { csv, rows } = buildExtensionsCsv(participants);
  const outPath = join(config.outputDir, 'extensions.csv');
  writeFileSync(outPath, csv);
  console.log(`  extensions.csv — ${rows} detections`);
}
