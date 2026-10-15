// src/cli/pseudonymize-core.js
// The opt-in pseudonymized export (config.pseudonymize). Each participant ID
// becomes a stable code, 'P-' + the first 10 hex digits of
// HMAC-SHA256(secret, id), and the participants are copied with the code in
// place of every identifier field, BEFORE anything renders: every output
// (the CSVs, triage.md, index.html, image and replay filenames, the
// annotations keyed by id) is then written from the codes alone. No Node APIs:
// the CLI (report.js) and the analyze page's worker both call it, each
// injecting its own HMAC (node:crypto, crypto.subtle), as ingest-core.js
// takes its sha256.
//
// The limit, which the docs must state too: pseudonymization replaces IDs,
// not content. Whatever a participant typed or pasted (event-log.csv's text
// column, the replays' typed text), what a honeypot reported, and what a
// dom-tier replay recorded of the page (visible text, hidden form values,
// URLs carrying ?PROLIFIC_PID=...) can still identify them; those are left
// as recorded.
//
// The key file maps the codes back. It is CSV: a banner line, the secret on a
// comment line, a header, one row per participant. Its rows are written with
// csv-cell.js, so an id a spreadsheet would run as a formula is stored with
// its leading apostrophe; the codes, which are what the file is read back
// for, never need quoting, so each row's first cell is read without a CSV
// parser (the analyze page imports this module and stays free of one).
import { csvCell } from '../shared/csv-cell.js';

export const KEY_FILE_NAME = 'cyborg-hunter-pseudonyms.csv';
export const KEY_FILE_BANNER = '# cyborg-hunter pseudonym key — keep private; do not share with the report';
const SECRET_PREFIX = '# secret,';
const KEY_HEADER = 'code,participantId';

// The code of one id. hmac(secretHex, text) → hex digest, or a Promise of one.
export async function pseudonymCode(secret, id, hmac) {
  return 'P-' + String(await hmac(secret, String(id))).slice(0, 10);
}

// id → code for each distinct id, in first-seen order. 40 bits make two ids
// sharing a code very unlikely in a cohort, but not impossible, and a shared
// code would silently merge two participants in every output: refused.
export async function assignCodes(ids, secret, hmac) {
  const codes = new Map();
  const owner = new Map();
  for (const raw of ids) {
    const id = String(raw);
    if (codes.has(id)) continue;
    const code = await pseudonymCode(secret, id, hmac);
    if (owner.has(code)) {
      throw new Error(`participants "${owner.get(code)}" and "${id}" got the same code ${code}; ` +
        'start a new key file (a new secret) to pseudonymize this cohort');
    }
    owner.set(code, id);
    codes.set(id, code);
  }
  return codes;
}

// A key file's secret and the codes it already lists. A spreadsheet that
// saved the file back may have added a BOM and CRLF line ends; both are
// read. A file with no readable secret is refused: minting a new one would
// silently give every participant a new code, and reports already shared
// under the old codes could no longer be matched to them.
export function parseKeyFile(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;
  let secret = null;
  for (; i < lines.length && lines[i].startsWith('#'); i++) {
    if (lines[i].startsWith(SECRET_PREFIX)) secret = lines[i].slice(SECRET_PREFIX.length).trim();
  }
  if (secret === null) throw new Error('it has no "# secret,<hex>" line');
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('its secret is not 64 lowercase hex digits');
  const codes = new Set();
  for (const line of lines.slice(i)) {
    const m = /^(P-[0-9a-f]{10}),/.exec(line);
    if (m) codes.add(m[1]);
  }
  return { secret, codes };
}

// The key file after this run: `existing` (the file's text, or null for a new
// file) with one row appended per code it does not list yet. The codes come
// from the secret, so a reused file needs no lookup of its rows: the same
// secret gives each id its old code again.
// → { text, added } (added: the number of rows appended)
export function keyFileUpdate(existing, secret, codes) {
  const listed = existing == null ? new Set() : parseKeyFile(existing).codes;
  const rows = [];
  for (const [id, code] of codes) {
    if (listed.has(code)) continue;
    listed.add(code);
    rows.push(csvCell(code) + ',' + csvCell(id));
  }
  const head = existing == null
    ? [KEY_FILE_BANNER, SECRET_PREFIX + secret, KEY_HEADER, ''].join('\n')
    : existing + (rows.length && existing !== '' && !existing.endsWith('\n') ? '\n' : '');
  return { text: head + rows.map((r) => r + '\n').join(''), added: rows.length };
}

// The participants this module made, so buildReport can refuse raw ones
// under config.pseudonymize (report-core.js) without a field on the
// participant that a renderer might print.
const coded = new WeakSet();
export function isPseudonymized(p) { return coded.has(p); }

// Copies of the ingested participants with the code in place of the id:
//   - participantId, and at any depth outside the recording, every
//     `participantId` / `participant_id` key (ch.js stamps the id on each
//     trial's integrity report and on the session report's config), set to
//     the code; so is the config's participantIdField on the participant, its
//     metadata and each trial (a jsPsych row keeps its own id column);
//   - metadata.qualtricsResponseId and cyborgHunterParticipantId (ch.js's own
//     id, kept on lab.js rows and in metadata), at any depth, and the platform
//     id (config.platformIdField) on the participant, its metadata and each
//     trial, where the report reads it, removed;
//   - the replay: the recording's top-level participant_id (v1:
//     metadata.participant_id) set to the code, its source filename (named
//     after the id) dropped, and the id replaced in the reason an unloadable
//     replay gives.
// Matching is by key, never by value, so content that happens to equal an id
// is left alone (a trial labelled "1" in a cohort with participant "1"). The
// configured field names are matched only where ingest and the report read
// them: a participantIdField such as "id" must not rewrite every nested id.
// The recording is copied shallowly: its segments, the bulk of a dom-tier
// replay, are shared with the original, as the module's limit says.
export function pseudonymizeParticipants(participants, codes, config) {
  const idKeys = new Set(['participantId', 'participant_id']);
  const dropKeys = new Set(['qualtricsResponseId', 'cyborgHunterParticipantId']);
  const named = (f) => (typeof f === 'string' && f ? f : null);
  const idField = named(config && config.participantIdField);
  const platformField = named(config && config.platformIdField);

  return participants.map((p) => {
    const raw = String(p.participantId);
    const code = codes.get(raw);
    if (code === undefined) throw new Error(`no pseudonym code for participant "${raw}"`);
    const scrub = (v) => {
      if (Array.isArray(v)) return v.map(scrub);
      if (!v || typeof v !== 'object') return v;
      const out = {};
      for (const k of Object.keys(v)) {
        if (dropKeys.has(k)) continue;
        const x = v[k];
        out[k] = idKeys.has(k) && (typeof x === 'string' || typeof x === 'number') ? code : scrub(x);
      }
      return out;
    };
    const { replay, ...rest } = p;
    const copy = scrub(rest);
    const roots = [copy, copy.metadata, ...(Array.isArray(copy.trials) ? copy.trials : [])];
    if (idField) roots.forEach((o) => setPath(o, idField, code));
    if (platformField) roots.forEach((o) => deletePath(o, platformField));
    // Last: every renderer keys by it, whatever the field edits above did.
    copy.participantId = code;
    if (replay !== undefined) copy.replay = scrubReplay(replay, raw, code, scrub);
    coded.add(copy);
    return copy;
  });
}

function scrubReplay(replay, raw, code, scrub) {
  if (!replay || typeof replay !== 'object') return replay;
  const { recording, ...rest } = replay;
  const out = scrub(rest);
  if ('file' in out) out.file = null;
  if (typeof out.reason === 'string') out.reason = out.reason.split(raw).join(code);
  if (recording && typeof recording === 'object') {
    const rec = { ...recording };
    if ('participant_id' in rec) rec.participant_id = code;
    if (rec.metadata && typeof rec.metadata === 'object' && 'participant_id' in rec.metadata) {
      rec.metadata = { ...rec.metadata, participant_id: code };
    }
    out.recording = rec;
  } else if (recording !== undefined) {
    out.recording = recording;
  }
  return out;
}

// Dotted-path edits on the copies. A flat key that spells the whole path wins,
// as getByPath (src/shared/paths.js) reads it.
function setPath(obj, path, value) {
  if (!obj || typeof obj !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(obj, path)) { obj[path] = value; return; }
  const segs = path.split('.');
  const parent = segs.slice(0, -1).reduce((o, s) => (o && typeof o === 'object' ? o[s] : undefined), obj);
  const last = segs[segs.length - 1];
  if (parent && typeof parent === 'object' && Object.prototype.hasOwnProperty.call(parent, last)) parent[last] = value;
}
function deletePath(obj, path) {
  if (!obj || typeof obj !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(obj, path)) { delete obj[path]; return; }
  const segs = path.split('.');
  const parent = segs.slice(0, -1).reduce((o, s) => (o && typeof o === 'object' ? o[s] : undefined), obj);
  if (parent && typeof parent === 'object') delete parent[segs[segs.length - 1]];
}
