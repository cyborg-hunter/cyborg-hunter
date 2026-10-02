// src/cli/renderers/triage-md.js
// Writes triage.md — a ranked markdown table of participants by suspiciousness.
// This is the "start here" document for manual review. Thin fs wrapper around
// triage-md-core.js, which builds the text.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildTriageMd } from './triage-md-core.js';

export async function renderTriage(triage, config) {
  const outPath = join(config.outputDir, 'triage.md');
  writeFileSync(outPath, buildTriageMd(triage, config));
  console.log(`  triage.md — ranked list`);
}
