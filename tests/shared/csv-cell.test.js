// csvCell, the one CSV cell every writer uses: RFC 4180 quoting, and an
// apostrophe before a text a spreadsheet would run as a formula. The CLI's
// CSV files are checked in tests/cli/csv-writers.test.js.
import { test } from 'node:test';
import assert from 'node:assert';
import { csvCell } from '../../src/shared/csv-cell.js';

test('csvCell quotes, neutralises formulas, leaves numbers alone', () => {
  assert.strictEqual(csvCell(null), '');
  assert.strictEqual(csvCell(undefined), '');
  assert.strictEqual(csvCell(''), '');
  assert.strictEqual(csvCell(true), 'true');
  assert.strictEqual(csvCell(-12.5), '-12.5');
  assert.strictEqual(csvCell('-12.5'), '-12.5');
  assert.strictEqual(csvCell('+1e3'), '+1e3');
  assert.strictEqual(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.strictEqual(csvCell('@cmd'), "'@cmd");
  assert.strictEqual(csvCell('-cmd'), "'-cmd");
  assert.strictEqual(csvCell('\tcmd'), "'\tcmd");
  assert.strictEqual(csvCell('\rcmd'), '"\'\rcmd"');
  assert.strictEqual(csvCell('a,b'), '"a,b"');
  assert.strictEqual(csvCell('a\rb'), '"a\rb"');
  assert.strictEqual(csvCell('=1,2'), '"\'=1,2"');
  assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
});
