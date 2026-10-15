// src/cli/replay-pieces.js
// Session recordings that arrive in pieces inside the participant data
// (src/replay/pieces.js): ch.js and ch-labjs.js write one piece per trial row
// (cyborgHunterReplay, and cyborgHunterReplayFinal at the session end), and on
// a page without a framework every POST carries the page's pieces so far in
// its own field. Found by content, so the field names are the only thing a
// researcher's saving code has to keep.
//
// Where pieces can sit, all handled the same way:
//   - rows: a top-level array of rows, or { trials | data | responses: rows }
//     (jsPsych JSON and CSV, lab.js), each row with a piece under one of
//     PIECE_KEYS; a CSV cell has already been JSON-parsed (parseCsvToRaw);
//   - a saved POST field or CyborgHunter.data() output: an array of pieces,
//     or an object holding one under cyborgHunterReplay;
//   - a value still a JSON string (a server that stored the field as text).

import { isPiece, groupPieces, reassemblePieces } from '../replay/pieces.js';

// lab.js writes cyborgHunter_<name> when the study already uses a name.
export const PIECE_KEYS = ['cyborgHunterReplay', 'cyborgHunterReplayFinal',
  'cyborgHunter_cyborgHunterReplay', 'cyborgHunter_cyborgHunterReplayFinal'];
const ROW_KEYS = ['trials', 'data', 'responses'];

function parsed(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t[0] !== '{' && t[0] !== '[') return v;
  try { return JSON.parse(t); } catch { return v; }
}

// Every piece in a parsed file, in no particular order.
export function collectPieces(raw) {
  const out = [];
  const visit = (v, depth) => {
    if (depth > 4 || v == null) return;
    v = parsed(v);
    if (isPiece(v)) { out.push(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    if (typeof v !== 'object') return;
    for (const k of PIECE_KEYS) if (v[k] !== undefined) visit(v[k], depth + 1);
    for (const k of ROW_KEYS) if (Array.isArray(v[k])) visit(v[k], depth + 1);
  };
  visit(raw, 0);
  return out;
}

// A file that holds nothing but pieces (a saved cyborgHunterReplay field):
// recording data, never participant data.
export function isPieceFile(json) {
  if (isPiece(json)) return true;
  return Array.isArray(json) && json.length > 0 && json.every(isPiece);
}

/**
 * recordingsFromPieces(sources) → { recordings, warnings }
 *   sources: [{ path, pieces }] — the files the pieces were found in
 *   recordings: [{ recording, recordingId, paths }]
 *   warnings: [{ file, warnings: [text] }]
 * A recording whose first piece is missing cannot be rebuilt (no header) and
 * is reported; one with pieces missing in between is rebuilt without them
 * and reported. A missing final piece is not reported: on a page without a
 * framework it is the normal shape, and under jsPsych it means a save trial
 * ran before the session ended, which the integrity data shows the same way.
 */
export function recordingsFromPieces(sources) {
  const all = [];
  const pathsOf = new Map();
  for (const s of sources) {
    for (const p of s.pieces) {
      all.push(p);
      if (!pathsOf.has(p.recording_id)) pathsOf.set(p.recording_id, new Set());
      pathsOf.get(p.recording_id).add(s.path);
    }
  }
  const recordings = [];
  const warnings = [];
  for (const [id, pieces] of groupPieces(all)) {
    const paths = [...pathsOf.get(id)].sort();
    try {
      const recording = reassemblePieces(pieces);
      const note = recording.extensions['cyborg-hunter'].reassembly;
      const gaps = note ? note.missing_seq_ranges : [];
      if (gaps.length) {
        const count = gaps.reduce((n, [from, to]) => n + (to - from + 1), 0);
        warnings.push({ file: paths.join(', '), warnings: [
          `Replay for ${recording.participant_id} rebuilt from the pieces in the saved data, but ` +
          `${count} of them are missing (rows not saved, or a file left out): ` +
          'the replay skips those parts.' +
          (note.skipped_segments
            ? ` ${note.skipped_segments} more segment${note.skipped_segments === 1 ? ' was' : 's were'} left out ` +
              'after a gap, because the page snapshot they build on is in a missing piece.'
            : '')] });
      }
      recordings.push({ recording, recordingId: id, paths });
    } catch (e) {
      warnings.push({ file: paths.join(', '), warnings: [
        `Replay pieces found (recording ${id}) but the first one, which carries the recording's header, ` +
        `is missing, so no replay can be rebuilt from them: ${e.message}`] });
    }
  }
  return { recordings, warnings };
}
