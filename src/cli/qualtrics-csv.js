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

// Only the first line is looked at, so a jsPsych CSV is never parsed twice.
export function isQualtricsExport(text, field = QUALTRICS_FIELD) {
  const ids = headerIds(text);
  return ids.includes(RESPONSE_ID) && (ids.includes(field) || ids.includes(QUALTRICS_LEGACY_FIELD));
}

// The label row's ResponseId cell is `Response ID`; the ImportId row's cell
// is `{"ImportId":"_recordId"}`. Either may be missing (an export edited by
// hand), so each is recognised on its own.
function isLabelRow(row) {
  return row && row[RESPONSE_ID] === 'Response ID';
}
function isImportIdRow(row) {
  return row && String(row[RESPONSE_ID] ?? '').trim().startsWith('{"ImportId"');
}

export function parseQualtricsExport(text, { field = QUALTRICS_FIELD } = {}) {
  const ids = headerIds(text);
  const column = ids.includes(field) ? field : QUALTRICS_LEGACY_FIELD;
  // Papa mis-reads a trailing newline after a quoted last cell (see
  // parseCsvToRaw in ingest-core.js). No dynamicTyping: a blank cell must stay
  // distinguishable from one that is not JSON, and the cell is parsed here.
  const parsed = Papa.parse(stripBom(text).replace(/\s+$/, ''), { header: true, skipEmptyLines: true });
  const rows = parsed.data || [];

  let skip = 0;
  if (isLabelRow(rows[0])) skip = 1;
  if (isImportIdRow(rows[skip])) skip += 1;

  const out = { column, responses: [], empty: [], invalid: [], warnings: [] };
  if (skip === 0) out.warnings.push('the export has one header row (legacy exporter)');

  rows.slice(skip).forEach((row, i) => {
    const rowIndex = i + 1;
    const responseId = String(row[RESPONSE_ID] ?? '').trim() || `row ${rowIndex}`;
    const cell = String(row[column] ?? '').trim();
    if (cell === '') { out.empty.push(responseId); return; }
    let raw;
    try {
      raw = JSON.parse(cell);
    } catch (e) {
      out.invalid.push({ responseId, rowIndex, error: e.message });
      return;
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      out.invalid.push({ responseId, rowIndex, error: `it holds ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : 'a ' + typeof raw}, not an object` });
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
