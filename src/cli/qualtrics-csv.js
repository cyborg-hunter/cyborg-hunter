// src/cli/qualtrics-csv.js
// Reads a Qualtrics CSV export: one file, one participant per response row.
// ch-qualtrics.js writes its payload into an embedded-data field
// (`__js_cyborg_hunter` under the New Survey Taking Experience,
// `cyborg_hunter` under the legacy layout), so each row's cell holds a
// vanilla Shape-1 blob that extractIntegrityData reads unchanged. Pure, no Node APIs: the analyze page
// bundles it through ingest-core.js.
//
// The default exporter writes three header rows: the column ids (StartDate,
// …, ResponseId, …), the question labels (`Response ID`, …) and one
// `{"ImportId":…}` JSON object per column. The legacy exporter writes the
// first one only, and spells the id column ResponseID. Both are read.

import Papa from 'papaparse';

export const QUALTRICS_FIELD = '__js_cyborg_hunter';
export const QUALTRICS_LEGACY_FIELD = 'cyborg_hunter';

// The response id column: ResponseId, or ResponseID in a legacy export.
const isResponseIdColumn = (id) => id.toLowerCase() === 'responseid';

// Qualtrics piped text left as written: `${e://Field/…}`, `${m://…}`.
const UNFILLED_PIPE = /^\$\{[A-Za-z]+:\/\//;

// The other system columns a Qualtrics export starts with (the legacy
// exporter shares StartDate, EndDate, Status, IPAddress and Finished).
const SYSTEM_COLUMNS = ['StartDate', 'EndDate', 'Status', 'IPAddress', 'Progress', 'Duration (in seconds)', 'Finished',
  'RecordedDate', 'RecipientLastName', 'RecipientFirstName', 'RecipientEmail', 'ExternalReference',
  'LocationLatitude', 'LocationLongitude', 'DistributionChannel', 'UserLanguage'];

// A Qualtrics export is UTF-8 with a byte-order mark, which ingest-core's
// decoder keeps; without this the first column id would not match.
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// The text Papa reads. Papa mis-reads a trailing newline after a quoted last
// cell (see parseCsvToRaw in ingest-core.js), so trailing whitespace goes;
// trimEnd(), not /\s+$/, whose backtracking is quadratic in a long run of
// spaces anywhere in the file (a free-text answer can hold one).
function csvBody(text) {
  return stripBom(text).trimEnd();
}

// The column ids of the first line, quoted or bare.
function headerIds(text) {
  const body = stripBom(text);
  const end = body.search(/\r?\n/);
  const line = end === -1 ? body : body.slice(0, end);
  const parsed = Papa.parse(line, { header: false });
  return (parsed.data[0] || []).map((c) => String(c).trim());
}

// The payload column: the configured field, else the legacy layout's.
function payloadColumn(ids, field) {
  if (ids.includes(field)) return field;
  return ids.includes(QUALTRICS_LEGACY_FIELD) ? QUALTRICS_LEGACY_FIELD : null;
}

// The label row's ResponseId cell is `Response ID`; the ImportId row's cells
// are `{"ImportId":…}` objects. The ImportId row is recognised by that
// content wherever it is, so a label row in another wording (a localised
// export, a renamed question) is still dropped when the ImportId row follows
// it. Either row may be missing (an export edited by hand).
function isLabelRow(row, rid) {
  return row && row[rid] === 'Response ID';
}
function isImportIdRow(row, column, rid) {
  return !!row && [row[rid], row[column]]
    .some((c) => String(c ?? '').trim().startsWith('{"ImportId"'));
}

// A payload of ch-qualtrics.js's writer: a JSON object whose
// cyborgHunterOneLiner names the host, as every level and the error marker do.
function isQualtricsPayload(cell) {
  if (!cell.startsWith('{')) return false;
  try {
    const p = JSON.parse(cell);
    return !!p && typeof p === 'object' && !!p.cyborgHunterOneLiner && p.cyborgHunterOneLiner.host === 'qualtrics';
  } catch {
    return false;
  }
}

// The first non-empty payload cell below the header rows; the rows are read
// only until it is found.
function firstPayloadCell(body, column, rid) {
  let cell = '';
  Papa.parse(body, {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
    step: ({ data }, parser) => {
      if (isLabelRow(data, rid) || isImportIdRow(data, column, rid)) return;
      const c = String(data[column] ?? '').trim();
      if (c !== '') { cell = c; parser.abort(); }
    }
  });
  return cell;
}

// The first line must have the response id column and the payload column.
// Any CSV can have both, so one positive sign that Qualtrics wrote the file
// is needed too: two of its system columns (the response id counts), the
// ImportId row, or, in an export cut down to a few columns, a first
// non-empty payload cell written by ch-qualtrics.js's writer. A CSV without
// both columns (any jsPsych file) is decided by its first line alone.
export function isQualtricsExport(text, field = QUALTRICS_FIELD) {
  const ids = headerIds(text);
  const rid = ids.find(isResponseIdColumn);
  const column = payloadColumn(ids, field);
  if (!rid || !column) return false;
  if (ids.filter((id) => id === rid || SYSTEM_COLUMNS.includes(id)).length >= 2) return true;
  const body = csvBody(text);
  const head = Papa.parse(body, { header: true, preview: 2, transformHeader: (h) => h.trim() }).data || [];
  if (head.some((row) => isImportIdRow(row, column, rid))) return true;
  return isQualtricsPayload(firstPayloadCell(body, column, rid));
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
  const column = payloadColumn(ids, field) || QUALTRICS_LEGACY_FIELD;
  const rid = ids.find(isResponseIdColumn) || 'ResponseId';
  // No dynamicTyping: a blank cell must stay distinguishable from one that is
  // not JSON, and the cell is parsed here. Header names are trimmed as
  // headerIds trims them, so a column detection found is a column the rows
  // can be read by.
  const parsed = Papa.parse(csvBody(text), {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim()
  });
  const rows = parsed.data || [];

  let skip = 0;
  if (isImportIdRow(rows[1], column, rid)) skip = 2;
  else if (isImportIdRow(rows[0], column, rid) || isLabelRow(rows[0], rid)) skip = 1;

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
    const responseId = String(row[rid] ?? '').trim() || `row ${rowIndex}`;
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
    // ch-qualtrics.js falls back to a random `ch-…` id when the tag carries
    // no participant id, and piped text Qualtrics did not fill in
    // (`${e://Field/ResponseID}` as written) is the same id in every
    // response; the row's ResponseId is the one id that links the payload to
    // the rest of the response.
    const pid = raw.participantId;
    if (pid == null || pid === '' || String(pid).startsWith('ch-') || UNFILLED_PIPE.test(String(pid))) {
      raw.participantId = responseId;
      raw.metadata.participantIdFromResponseId = true;
    }
    out.responses.push({ responseId, rowIndex, raw });
  });
  return out;
}
