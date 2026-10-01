// src/cli/renderers/summary-csv.js
// Writes summary.csv — one row per participant with columns for every
// signal aggregate and the triage score/reason. Thin fs wrapper around
// summary-csv-core.js, which builds the text.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildSummaryCsv } from './summary-csv-core.js';

export async function renderSummaryCSV(summaries, triage, config) {
  const outPath = join(config.outputDir, 'summary.csv');
  writeFileSync(outPath, buildSummaryCsv(summaries, triage));
  console.log(`  summary.csv — ${summaries.length} participants`);
}
