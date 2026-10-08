// The CLI's three CSV files (summary.csv, event-log.csv, extensions.csv)
// put every cell through csvCell (src/shared/csv-cell.js): a formula in a
// cell of its own gains an apostrophe, a number stays a number.
import { test } from 'node:test';
import assert from 'node:assert';
import { buildSummaryCsv } from '../../src/cli/renderers/summary-csv-core.js';
import { buildEventLogCsv } from '../../src/cli/renderers/event-log-core.js';
import { buildExtensionsCsv } from '../../src/cli/renderers/extensions-core.js';

test('summary.csv, event-log.csv and extensions.csv put every cell through csvCell', () => {
  const pid = '=1+1';
  const summary = { participantId: pid, trialCount: 1, meanTypingSpeed: -1, meanMouseEvents: 0, meanPathEfficiency: 0,
    aiExtensionsFound: ['@ext'], honeypotAiUse: true, honeypotAiReport: '+cmd' };
  const summaryRow = buildSummaryCsv([summary], [{ participantId: pid, score: -0.5, reason: '-' }]).split('\n')[1];
  assert.ok(summaryRow.startsWith("'=1+1,1,-0.5,no,'-,"), summaryRow);
  assert.ok(summaryRow.includes(",-1.00,"), 'a negative number as text stays a number: ' + summaryRow);
  // The sixteen cursor columns follow, empty without a cursor analysis.
  assert.ok(summaryRow.endsWith(",'@ext,0,0,0,0,,YES,'+cmd" + ','.repeat(16)), summaryRow);

  const participants = [{ participantId: pid, session: { aiExtensionsFound: ['-x'] },
    trials: [{ trialId: '@t', pasteEvents: [{ t: 10, text: '=HYPERLINK("x")' }] }] }];
  assert.strictEqual(buildEventLogCsv(participants).csv.split('\n')[1], '\'=1+1,\'@t,paste,10,,"\'=HYPERLINK(""x"")"');
  assert.strictEqual(buildExtensionsCsv(participants).csv.split('\n')[1], "'=1+1,extension,'-x,");
});
