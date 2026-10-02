// src/cli/renderers/event-log.js
// Writes event-log.csv — chronological clipboard/paste events across all participants.
// Thin fs wrapper around event-log-core.js, which builds the text.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildEventLogCsv } from './event-log-core.js';

export async function renderEventLog(participants, config) {
  const { csv, rows } = buildEventLogCsv(participants);
  const outPath = join(config.outputDir, 'event-log.csv');
  writeFileSync(outPath, csv);
  console.log(`  event-log.csv — ${rows} events`);
}
