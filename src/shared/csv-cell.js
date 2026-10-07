// src/shared/csv-cell.js
// One CSV cell for every writer (summary.csv, event-log.csv, extensions.csv,
// the annotations export, the report's inline client). Quotes as RFC 4180
// does; a text that a spreadsheet would run as a formula (a leading = + - @,
// tab or CR) gets an apostrophe first. Numbers, and strings that are numbers,
// pass untouched.
export function csvCell(value) {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  var s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
