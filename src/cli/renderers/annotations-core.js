// src/cli/renderers/annotations-core.js
// Per-participant annotations: the analyst's label (Include, Exclude, Flag)
// and note on each participant of one report; no label = not reviewed. Pure
// functions over plain data, for the exports and the import. The analyze page
// uses them as they are (demo/analyze/page.js); the report's own annotation
// script carries a copy (ANNOTATION_BUILDERS_JS in annotation-client.js),
// because an inline script cannot import, and
// tests/cli/report-annotations.test.js runs both copies on the same inputs.
//
// An annotation is { label, note, annotatedAt }: label 'include' | 'exclude' |
// 'flag' | null, note a string, annotatedAt an ISO time. The state is
// { [participantId]: annotation }, keyed by the RAW participant id (a rail
// row's data-pid): the report's sanitized ids are many-to-one.

import { csvCell } from '../../shared/csv-cell.js';

export var ANNOTATION_LABELS = ['include', 'exclude', 'flag'];
export var ANNOTATIONS_FORMAT = 'cyborg-hunter-annotations';
// The longest note kept: the report's note field stops there, and a longer
// one in an import or in storage is not read.
export var NOTE_MAX_LENGTH = 2000;
// How many ids of each kind the import message names before it counts the rest.
var MESSAGE_IDS = 10;

function own(map, id) {
  return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
}

/**
 * The CSV export: one row per participant in `rows` order (the report's
 * triage order), rows = [{ participantId, tier, triageScore }]. A participant
 * with no label gets an empty one, or 'include' with unreviewedAsIncluded.
 */
export function annotationsCsv(rows, annotations, runId, unreviewedAsIncluded) {
  var lines = ['participantId,tier,triageScore,label,note,annotatedAt,runId'];
  rows.forEach(function (r) {
    var a = own(annotations, r.participantId) || {};
    var label = a.label || (unreviewedAsIncluded ? 'include' : '');
    lines.push([r.participantId, r.tier, r.triageScore, label, a.note, a.annotatedAt, runId].map(csvCell).join(','));
  });
  return lines.join('\n') + '\n';
}

/** The JSON export: the annotations with the run they belong to. */
export function annotationsJson(runId, annotations, exportedAt) {
  return JSON.stringify({ format: ANNOTATIONS_FORMAT, runId: runId, exportedAt: exportedAt, annotations: annotations }, null, 2) + '\n';
}

/**
 * The entries of a state (`map`: an import's annotations, or what storage
 * holds, which any page of the same origin can write) that read as
 * annotations: one of the three labels or none, a text note of at most
 * NOTE_MAX_LENGTH characters. With `cohortIds`, an entry for an id this
 * report does not have is listed in `unknown`; one that does not read is
 * listed in `skipped`. Neither is kept.
 */
export function checkAnnotations(map, cohortIds) {
  var known = null;
  if (cohortIds) {
    known = Object.create(null);
    cohortIds.forEach(function (id) { known[id] = true; });
  }
  var annotations = Object.create(null), unknown = [], skipped = [];
  Object.keys(map).forEach(function (id) {
    var a = map[id];
    if (known && !known[id]) { unknown.push(id); return; }
    if (!a || typeof a !== 'object' || (a.label != null && ANNOTATION_LABELS.indexOf(a.label) < 0) ||
        (a.note != null && (typeof a.note !== 'string' || a.note.length > NOTE_MAX_LENGTH))) { skipped.push(id); return; }
    annotations[id] = { label: a.label || null, note: a.note || '', annotatedAt: typeof a.annotatedAt === 'string' ? a.annotatedAt : '' };
  });
  return { annotations: annotations, unknown: unknown, skipped: skipped };
}

/**
 * A JSON export read back against this report's participant ids
 * (checkAnnotations: `unknown` entries are not applied, `skipped` ones were
 * not read). `otherRun`: the file was exported from another report (another
 * cohort); its entries for ids this report has still apply. Throws on a file
 * that is not an annotations export.
 */
export function readAnnotationsImport(text, cohortIds, runId) {
  var data = JSON.parse(text);
  if (!data || data.format !== ANNOTATIONS_FORMAT || !data.annotations || typeof data.annotations !== 'object') {
    throw new Error('not a cyborg-hunter annotations file');
  }
  var read = checkAnnotations(data.annotations, cohortIds);
  return { annotations: read.annotations, unknown: read.unknown, skipped: read.skipped, otherRun: data.runId !== runId };
}

// Ids for the import message: the first MESSAGE_IDS, then how many more.
function idList(ids) {
  if (ids.length <= MESSAGE_IDS) return ids.join(', ');
  return ids.slice(0, MESSAGE_IDS).join(', ') + ' … and ' + (ids.length - MESSAGE_IDS) + ' more';
}

/** What an import did, in one line for the page. */
export function importMessage(result) {
  var n = Object.keys(result.annotations).length;
  var text = 'Imported ' + n + ' annotation' + (n === 1 ? '' : 's') + '.';
  if (result.unknown.length) text += ' Not in this report: ' + idList(result.unknown) + '.';
  if (result.skipped.length) text += ' Not read: ' + idList(result.skipped) + '.';
  if (result.otherRun) text += ' The file comes from another report.';
  return text;
}
