// src/cli/qualtrics-csv.js
// Reads a Qualtrics CSV export: one file, one participant per response row.
// ch.js writes its payload into an embedded-data field (`__js_cyborg_hunter`
// under the New Survey Taking Experience, `cyborg_hunter` under the legacy
// layout), so each row's cell holds a vanilla Shape-1 blob that
// extractIntegrityData reads unchanged. Pure, no Node APIs: the analyze page
// bundles it through ingest-core.js.
//
// The default exporter writes three header rows: the column ids (StartDate,
// …, ResponseId, …), the question labels (`Response ID`, …) and one
// `{"ImportId":…}` JSON object per column. The legacy exporter writes the
// first one only. Both are read.

import Papa from 'papaparse';

export const QUALTRICS_FIELD = '__js_cyborg_hunter';
export const QUALTRICS_LEGACY_FIELD = 'cyborg_hunter';

const RESPONSE_ID = 'ResponseId';

// A Qualtrics export is UTF-8 with a byte-order mark, which ingest-core's
// decoder keeps; without this the first column id would not match.
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// The column ids of the first line, quoted or bare.
function headerIds(text) {
  const body = stripBom(text);
  const end = body.search(/\r?\n/);
  const line = end === -1 ? body : body.slice(0, end);
  const parsed = Papa.parse(line, { header: false });
  return (parsed.data[0] || []).map((c) => String(c).trim());
}

// Columns jsPsych writes into every CSV and a Qualtrics export never has. A
// jsPsych file that carries a ResponseId and a `cyborg_hunter` column of its
// own stays a jsPsych file (one participant), rather than losing its rows to
// the per-response reader.
const JSPSYCH_COLUMNS = ['trial_index', 'trial_type', 'time_elapsed'];

// Only the first line is looked at, so a jsPsych CSV is never parsed twice.
export function isQualtricsExport(text, field = QUALTRICS_FIELD) {
  const ids = headerIds(text);
  return ids.includes(RESPONSE_ID)
    && (ids.includes(field) || ids.includes(QUALTRICS_LEGACY_FIELD))
    && !JSPSYCH_COLUMNS.some((c) => ids.includes(c));
}

// The label row's ResponseId cell is `Response ID`; the ImportId row's cells
// are `{"ImportId":…}` objects. The ImportId row is recognised by that
// content wherever it is, so a label row in another wording (a localised
// export, a renamed question) is still dropped when the ImportId row follows
// it. Either row may be missing (an export edited by hand).
function isLabelRow(row) {
  return row && row[RESPONSE_ID] === 'Response ID';
}
function isImportIdRow(row, column) {
  return !!row && [row[RESPONSE_ID], row[column]]
    .some((c) => String(c ?? '').trim().startsWith('{"ImportId"'));
}

// A JSON.parse failure, described by position and length only: the engine's
// message can quote the cell (and the cell can hold a participant id), and
// its wording differs between Node and each browser.
function describeJsonError(e, cell) {
  const m = /position (\d+)/.exec(e && e.message);
  return m
    ? `parse error at position ${m[1]} of ${cell.length} characters`
    : `parse error in ${cell.length} characters`;
}

export function parseQualtricsExport(text, { field = QUALTRICS_FIELD } = {}) {
  const ids = headerIds(text);
  const column = ids.includes(field) ? field : QUALTRICS_LEGACY_FIELD;
  // Papa mis-reads a trailing newline after a quoted last cell (see
  // parseCsvToRaw in ingest-core.js). No dynamicTyping: a blank cell must stay
  // distinguishable from one that is not JSON, and the cell is parsed here.
  // Header names are trimmed as headerIds trims them, so a column detection
  // found is a column the rows can be read by.
  const parsed = Papa.parse(stripBom(text).replace(/\s+$/, ''), {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim()
  });
  const rows = parsed.data || [];

  let skip = 0;
  if (isImportIdRow(rows[1], column)) skip = 2;
  else if (isImportIdRow(rows[0], column) || isLabelRow(rows[0])) skip = 1;

  const out = { column, responses: [], empty: [], invalid: [], warnings: [] };
  if (skip === 0) out.warnings.push('the export has one header row (legacy exporter)');
  // A broken quote makes Papa read on into the next records, which then
  // never appear as responses. Record numbers count the header row as 1;
  // no cell text is quoted.
  const bad = [...new Set((parsed.errors || []).map((e) => e.row).filter((r) => typeof r === 'number'))];
  if (bad.length) {
    out.warnings.push(`the CSV has ${bad.length} malformed record${bad.length === 1 ? '' : 's'} (first at record ${Math.min(...bad) + 2}); responses after it may be merged into it or missing`);
  }

  rows.slice(skip).forEach((row, i) => {
    const rowIndex = i + 1;
    const responseId = String(row[RESPONSE_ID] ?? '').trim() || `row ${rowIndex}`;
    const cell = String(row[column] ?? '').trim();
    if (cell === '') { out.empty.push(responseId); return; }
    let raw;
    try {
      raw = JSON.parse(cell);
    } catch (e) {
      out.invalid.push({ responseId, rowIndex, error: describeJsonError(e, cell) });
      return;
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      out.invalid.push({ responseId, rowIndex, error: `it parses to ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : 'a ' + typeof raw}, not an object` });
      return;
    }
    raw.metadata = Object.assign({}, raw.metadata, { qualtricsResponseId: responseId });
    // ch.js falls back to a random `ch-…` id when the tag carries no
    // participant id; the row's ResponseId is the one id that links the
    // payload to the rest of the response.
    const pid = raw.participantId;
    if (pid == null || pid === '' || String(pid).startsWith('ch-')) {
      raw.participantId = responseId;
      raw.metadata.participantIdFromResponseId = true;
    }
    out.responses.push({ responseId, rowIndex, raw });
  });
  return out;
}
