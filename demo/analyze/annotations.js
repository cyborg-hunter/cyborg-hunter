// demo/analyze/annotations.js
// The analyze page keeps the report's annotations. The report runs in a
// sandboxed frame at an opaque origin, where storage throws and downloads are
// refused, so its annotation script (src/cli/renderers/annotation-client.js,
// in parent mode) posts each change here (cyborg-hunter:annotate). The page
// checks it, stores the state in its own localStorage under ch-annot:<runId>,
// and posts the state back into the frame (cyborg-hunter:annotations). The
// exports and the import are the page's (page.js).
import { ANNOTATION_LABELS, NOTE_MAX_LENGTH, checkAnnotations } from '../../src/cli/renderers/annotations-core.js';

export function storageKey(runId) { return 'ch-annot:' + runId; }

// The page's storage, or null where the browser refuses it (a private
// window, a page opened from file: in some browsers): the annotations then
// last as long as the page, and the JSON export keeps them.
export function pageStorage() {
  try { return window.localStorage; } catch (e) { return null; }
}

/**
 * What storage holds for this run, read as an import is (checkAnnotations):
 * any page of this origin can write the key, so only entries with one of the
 * three labels or none and a text note are kept, and with `cohortIds` only
 * those for ids of this report. An unreadable value reads as empty. Throws
 * where storage is refused (or `storage` is null), so that a caller can tell
 * that from "nothing stored".
 */
export function readAnnotations(storage, runId, cohortIds) {
  var text = storage.getItem(storageKey(runId));
  var saved = null;
  try { saved = JSON.parse(text || '{}'); } catch (e) { /* unreadable: start empty */ }
  return checkAnnotations(saved && typeof saved === 'object' ? saved : {}, cohortIds).annotations;
}

/** readAnnotations, or an empty state where storage is refused. */
export function loadAnnotations(storage, runId, cohortIds) {
  try { return readAnnotations(storage, runId, cohortIds); } catch (e) { return Object.create(null); }
}

export function saveAnnotations(storage, runId, annotations) {
  try { if (storage) storage.setItem(storageKey(runId), JSON.stringify(annotations)); } catch (e) { /* see pageStorage */ }
}

/**
 * Applies one change the report posted, if it holds: this run, a participant
 * of this report (cohortIds), one of the three labels or none, a text note
 * no longer than the report's note field allows. No label and no note = not
 * reviewed: the entry goes. `now` is the ISO time stamped on it. Returns
 * whether it applied.
 */
export function applyAnnotate(annotations, msg, runId, cohortIds, now) {
  if (!msg || msg.runId !== runId || typeof msg.participantId !== 'string' || cohortIds.indexOf(msg.participantId) < 0) return false;
  if (msg.label != null && ANNOTATION_LABELS.indexOf(msg.label) < 0) return false;
  if (msg.note != null && (typeof msg.note !== 'string' || msg.note.length > NOTE_MAX_LENGTH)) return false;
  if (!msg.label && !msg.note) delete annotations[msg.participantId];
  else annotations[msg.participantId] = { label: msg.label || null, note: msg.note || '', annotatedAt: now };
  return true;
}
