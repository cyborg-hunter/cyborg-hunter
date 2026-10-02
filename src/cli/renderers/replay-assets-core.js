// src/cli/renderers/replay-assets-core.js
// Builds per-participant replay assets (replay/<pid>.replay.js) as
// JSONP-style scripts: window.__chReplay['<pid>'] = <viewer model>.
//
// Why script files instead of JSON + fetch(): the HTML report is opened
// via file:// where fetch() of local files is CORS-blocked, but <script>
// tags load fine. The report injects the script lazily when the analyst
// opens a participant's Replay section.
//
// No fs or Buffer here: report-core.js hands every asset to its sink, and
// replay-assets.js writes them to disk for renderReplayAssets.

import { sanitizeId as sanitize } from '../../shared/constants.js';
import { buildViewerModel } from '../../replay/viewer-model.js';
import { inlineSafeJson } from '../../shared/inline-safe.js';
import { applyAssetMap, assetMatchSummary, assetNoteText } from '../asset-match.js';

/**
 * Builds replay/<sanitizedPid>.replay.js for every participant with an
 * attached recording and hands each to `sink(path, bytes)` (bytes are the
 * script's UTF-8; no fs or Buffer here, so the browser page runs it too).
 * Returns { count, totalBytes, skipped } so the report can
 * print an honest size line (replay assets dominate report size at dom tier)
 * and an honest line about what did not make it.
 *
 * `skipped` is [{participantId, file, reason}] — one entry per artifact that
 * exists, reads fine, and still never reaches the viewer. Two things produce
 * one, and they are the same event seen at different layers:
 *
 *   - the §11 tolerant profile rejecting a recording here. buildViewerModel
 *     THROWS on that set (it is v2-only; a CH-v1 artifact is the common case),
 *     and the alternative to catching is that one unloadable file in a cohort
 *     aborts the whole report — precisely the data-loss trade §11 exists to
 *     refuse. v1 degraded and rendered the rest; v2 skips the participant and
 *     says so.
 *   - a refusal already stamped by INGEST: a jsPsych v1 recording the
 *     converter would not migrate, which never gets as far as a model. Task
 *     10(b) settled that a replay which does not make it is visible on three
 *     surfaces, and the CLI line report-core.js prints from this list is one of
 *     them, so both origins have to be accounted for here or the console is a
 *     partial account.
 *
 * A corrupted file (ingest's `parse_failed`) deliberately stays out: it keeps
 * its own report lead text and its own ingest warning.
 *
 * The say-so is a stamp on `p.replay`, read by renderReplaySection's error
 * branch — the report's existing state for "attached but not viewable".
 * Repeated calls now return the same list (both classes are recognised from
 * the stamp), which retires the non-idempotence noted in review. One caller
 * today (`report-core.js`), which renders the index from the
 * same array; replay-assets.js's renderReplayAssets is its fs form.
 *
 * `assetMap` (asset-match.js's styled-replay assets, or null) is applied to
 * each model, and `p.replay.assetNote` records what matched for the report.
 */
export function buildReplayAssets(participants, { sink, assetMap = null }) {
  let count = 0;
  let totalBytes = 0;
  const skipped = [];
  for (const p of participants) {
    if (p.replay && !p.replay.recording && p.replay.error === 'unloadable') {
      skipped.push({ participantId: p.participantId, file: p.replay.file || null,
        reason: p.replay.reason || p.replay.error });
    }
  }
  const withReplay = participants.filter((p) => p.replay && p.replay.recording);
  if (withReplay.length === 0) return { count, totalBytes, skipped };

  // Sanitization is lossy ('a/b' and 'a_b' both map to a_b) — dedupe with a
  // stable numeric suffix so a later write can never overwrite an earlier
  // participant's asset. The actual path is stamped on the participant
  // (replay.assetPath) and consumed by html-index, which must not recompute.
  const usedNames = new Set();
  for (const p of withReplay) {
    let model;
    try {
      model = buildViewerModel(p.replay.recording);
    } catch (e) {
      // Skip this participant, keep the cohort. The recording is dropped from
      // the participant so the index cannot render a Load button for an asset
      // that was never written; `error: 'unloadable'` distinguishes it from
      // ingest's 'parse_failed' (a file that could not even be read).
      // `e.reasons` is the §11 profile's own list; the message wrapper adds
      // a function name the analyst has no use for.
      const reason = Array.isArray(e.reasons) ? e.reasons.join('; ') : e.message;
      skipped.push({ participantId: p.participantId, file: p.replay.file || null, reason });
      p.replay = { error: 'unloadable', reason, file: p.replay.file || null };
      continue;
    }
    // Summary FIRST: the model aliases the recording's sheets and DOM, so
    // after the apply a matched sheet no longer looks external.
    if (assetMap) {
      p.replay.assetNote = assetNoteText(assetMatchSummary(p.replay.recording, assetMap));
      model = applyAssetMap(model, assetMap);
    }
    // The store is keyed by the RAW participant id (what the report's
    // loader passes); the filename uses the sanitized form.
    // Null-prototype store: participant ids are untrusted, and a pid like
    // "__proto__" on a plain object would mutate the store's prototype
    // instead of creating an entry (prototype pollution).
    const src =
      'window.__chReplay = window.__chReplay || Object.create(null);\n' +
      'window.__chReplay[' + JSON.stringify(String(p.participantId)) + '] = ' +
      inlineSafeJson(model) + ';\n';
    let base = sanitize(p.participantId);
    let name = base + '.replay.js';
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) {
      name = base + '~' + n + '.replay.js';
    }
    usedNames.add(name.toLowerCase());
    const bytes = new TextEncoder().encode(src);
    sink('replay/' + name, bytes);
    p.replay.assetPath = 'replay/' + name;
    count++;
    totalBytes += bytes.byteLength;
  }
  return { count, totalBytes, skipped };
}
