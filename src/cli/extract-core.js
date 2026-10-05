// src/cli/extract-core.js
// Pure core of the participant-file extraction step — no Node APIs, so a
// browser demo can bundle it directly (0.7.2 extraction from cli/ingest.js,
// which re-exports these below for existing callers/tests). ingest.js keeps
// everything that touches fs/zlib/papaparse (file discovery, CSV parsing,
// replay-artifact attachment); this module keeps the raw-JSON-object →
// { participantId, trials, ... } transform, which never touches the
// filesystem — extractIntegrityData(raw, config) has always taken an
// already-parsed `raw` object, not a file path.
//
// Moved verbatim from ingest.js: extractIntegrityData, findSessionData,
// looksLikeSessionData, scoreFromSession, findGuardViolations,
// findHoneypotDisclosure, normalizeTabAwayTimestamps, mapLegacyFields (+ its
// LEGACY_FIELD_MAP), ruleChronologicalCompare.

import { TRIAL_REPORT_FIELDS } from '../shared/schema.js';
import { getByPath } from '../shared/paths.js';
import { collectSegments, reassembleSegments, rebaseTrialReport } from './segment-reassembly.js';

// A value that names a participant. 0 and false do (a CSV's dynamic typing
// turns a numeric subject id into a number); undefined, null and an empty
// string do not, as the `||` chain this replaced treated them.
const present = v => v !== undefined && v !== null && v !== '';

// lab.js's Transmit plugin and datastore.transmit() POST
// { metadata: { slice, id, payload }, url, data: [rows] }; a server that
// stores the body as it is yields this envelope. Its rows are the same as a
// top-level array (exportJson): Shape 3. Only an object whose `data` is a
// non-empty array of plain objects and that carries no other known shape
// counts (a `{ data: [1, 2] }` is nobody's data file).
function transmitRows(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Array.isArray(raw.trials) || Array.isArray(raw.responses) || Array.isArray(raw.phaseTrials)) return null;
  if (!Array.isArray(raw.data) || raw.data.length === 0) return null;
  return raw.data.every(r => r && typeof r === 'object' && !Array.isArray(r)) ? raw.data : null;
}

// A value that names a participant. 0 and false do (a CSV's dynamic typing
// turns a numeric subject id into a number); undefined, null and an empty
// string do not, as the `||` chains this replaced treated them.
const present = v => v !== undefined && v !== null && v !== '';

// Rows written by the one-line setup on lab.js: they carry ch.js's id as
// cyborgHunterParticipantId. Shared with parseCsvToRaw, which leaves such a
// CSV's id to the rows (below) instead of hoisting row 0's.
export function rowsCarryChId(rows) {
  return rows.some(r => r && typeof r === 'object' && present(r.cyborgHunterParticipantId));
}

// The participant ids a file's rows carry. The one-line setup on lab.js
// writes its own id onto every trial row as cyborgHunterParticipantId (and
// into the integrity report as participantId), and onto row 0 as
// participantId only when the study has set none at that point. So a
// participantId that is none of ch.js's ids is the study's own, even when it
// first appears on a later row (a form on the second screen): it keys the
// participant, so the file is not split from the rest of the study's data.
// Without one, ch.js's id keys it. Returns, as strings, { id, chId, chIds,
// ownIds }: chIds and ownIds are the distinct ch.js ids and study ids in row
// order, chId is the first ch.js id, and id is undefined when no row carries
// one. One session's rows carry one ch.js id and at most one study id.
function participantFromRows(rows, pidField, intField) {
  const objects = rows.filter(r => r && typeof r === 'object');
  const distinct = values => [...new Set(values.filter(present).map(String))];
  const chIds = distinct(objects.map(r => r.cyborgHunterParticipantId));
  const ownIds = distinct(objects.map(r => getByPath(r, pidField))).filter(v => !chIds.includes(v));
  const inReport = objects
    .map(r => (r[intField] && typeof r[intField] === 'object') ? getByPath(r[intField], pidField) : undefined)
    .find(present);
  const id = ownIds[0] ?? chIds[0] ?? (present(inReport) ? String(inReport) : undefined);
  return { id, chId: chIds[0], chIds, ownIds };
}

// Extracts integrity trial data from a single participant's raw JSON.
// Returns { participantId, trials, warnings, metadata }.
// The non-zero counts of a reduced payload's `truncated` record, e.g.
// "55 tabAwayEvents entries dropped, 4 pages trimmed, 35 pages dropped".
function describeTruncation(t) {
  const parts = [];
  for (const [key, n] of Object.entries(t.droppedSessionEntries || {})) {
    if (n > 0) parts.push(`${n} ${key} entries dropped`);
  }
  if (t.pagesTrimmed > 0) parts.push(`${t.pagesTrimmed} pages trimmed`);
  if (t.pagesDropped > 0) parts.push(`${t.pagesDropped} pages dropped`);
  return parts.length ? parts.join(', ') : 'nothing listed';
}

export function extractIntegrityData(raw, config) {
  const warnings = [];
  const pidField = config.participantIdField || 'participantId';
  const intField = config.integrityField || 'integrity';

  // Shape 3 (a top-level array of rows: jsPsych's and lab.js's exportJson(),
  // a JATOS result) and the lab.js Transmit envelope hold the same rows a
  // { trials } file (Shape 1) does, so they are read as one: every reader
  // below (session, rolling segments, honeypot, error markers) looks in
  // raw.trials. Their participant id comes from the rows, as parseCsvToRaw
  // hoists it for a CSV. So does the id of a { trials } file whose rows come
  // from the one-line setup on lab.js (a lab.js CSV, or rows a server
  // wrapped), so every lab.js file is keyed the same way.
  const rows = Array.isArray(raw) ? raw : transmitRows(raw);
  if (rows) raw = Array.isArray(raw) ? { trials: rows } : { ...raw, trials: rows };
  const idRows = rows || (Array.isArray(raw.trials) && rowsCarryChId(raw.trials) ? raw.trials : null);
  const fromRows = idRows ? participantFromRows(idRows, pidField, intField) : {};
  // Transmit posts an incremental slice of new rows on every idle and the
  // full data at the end, so a server that stores each body holds several
  // files per session. A slice is read (its rows are real), but it is partial
  // and may be keyed apart from the full body (ch.js's id, when the study's
  // own id sits on an earlier row), so say so.
  if (rows && raw.metadata?.payload === 'incremental') {
    warnings.push(
      `this is one incremental slice of a lab.js upload (rows from ${raw.metadata.slice ?? '?'}, ` +
      `session ${raw.metadata.id ?? '?'}); ingest only the final 'full' body, or the participant ` +
      `appears with partial data`
    );
  }

  // Determine participant ID — check top level, then metadata sub-object,
  // then the rows (above).
  // Since 0.6.1 the field supports dot-paths ("metadata.sessionId"); plain
  // names keep the historical top-level → metadata fallback. An empty string
  // (or null) is missing, as the pre-0.6.1 `||` chain treated it; 0 and false
  // are ids. From here on the id is a string: the report names its files
  // after it and --participant compares strings, and a number stopped the
  // whole report at its first plot.
  const resolved = [getByPath(raw, pidField), getByPath(raw.metadata, pidField), fromRows.id].find(present);
  const participantId = resolved === undefined ? 'unknown' : String(resolved);
  // An id field that resolves to nothing yields 'unknown'. Silently, that both
  // loses the real id AND collides every such file under one 'unknown' bucket
  // downstream (see the duplicate-id check in ingest()). Warn so a mistyped
  // participantIdField is visible instead of producing an all-'unknown' cohort.
  if (participantId === 'unknown') {
    warnings.push(
      `participantId unresolved (field "${pidField}" not found at top level` +
      (idRows ? ', in metadata or on any row' : ' or in metadata') +
      `) — defaulted to "unknown". Check participantIdField.`
    );
  }
  // Rows that carry more than one ch.js id, or more than one id of the
  // study's own, hold more than one session (a concatenated export). ch.js's
  // id then names no single session, so it is not kept as a second name for
  // the participant's replay recording (ingest-core.js attaches by it).
  const severalIds = !!fromRows.chIds && (fromRows.chIds.length > 1 || fromRows.ownIds.length > 1);
  if (severalIds) {
    const list = ids => ids.slice(0, 5).join(', ') + (ids.length > 5 ? ', …' : '');
    const named = [];
    if (fromRows.ownIds.length > 1) named.push(`${pidField}: ${list(fromRows.ownIds)}`);
    if (fromRows.chIds.length > 1) named.push(`cyborgHunterParticipantId: ${list(fromRows.chIds)}`);
    warnings.push(
      `the rows carry more than one participant id (${named.join('; ')}), as if the file held ` +
      `several sessions; keyed by "${participantId}", and ch.js's id is not used to attach a replay recording`
    );
  }

  let trials = [];

  // Shape 1: { trials: [{ integrity: {...} }, ...] } — jsPsych extension data.
  // Each trial has an `integrity` sub-object added by CyborgHunter.endTrial().
  // We merge the trial's own fields (ruleId, timestamp, rt, rulePosition, etc.)
  // with the integrity sub-object's fields (tabAwayEvents, copyEvents, etc.).
  // On a key collision the integrity sub-object wins, since it's the more
  // authoritative source for those fields. This preserves both the renderer-
  // needed experiment metadata AND the cyborg-hunter signal data on the same
  // trial object.
  if (Array.isArray(raw.trials)) {
    trials = raw.trials
      .filter(t => t && t[intField])
      .map(t => ({ ...t, ...t[intField] }));
    // One-line setup (0.10.0) across several pages: each page has its own
    // performance.now() origin, recorded as integritySegment.pageOrigin.
    // Re-base trials from later pages onto the first page's origin so the
    // session timeline and the per-trial anchors below stay on one clock.
    // Only the page-clock fields move (anchors + absolute-time event arrays,
    // listed in segment-reassembly.js); trial-relative mouseTrack/elementTrace
    // times must NOT move, or trajectories misplace every later-page trial.
    // Single-page data, and data without segments, is untouched. A row whose
    // trial was not segmented itself (it carries only the closing
    // integritySegmentFinal) takes that segment's page.
    const rowOrigin = t => t?.integritySegment?.pageOrigin ?? t?.integritySegmentFinal?.pageOrigin;
    if (raw.trials.some(t => typeof rowOrigin(t) === 'number')) {
      const origin0 = collectSegments(raw)[0]?.pageOrigin;
      if (typeof origin0 === 'number') {
        trials = trials.map(trial => {
          const origin = rowOrigin(trial);
          return (typeof origin === 'number' && origin !== origin0)
            ? rebaseTrialReport(trial, origin - origin0) : trial;
        });
      }
    }
    // jsPsych extension data carries trialStart_perfNow per trial (set by the
    // wrapper's on_load), so normalization takes the exact-subtraction fast
    // path. Without it, renderers see only session-absolute `start` values
    // and plot tab-away markers far off the per-trial axis.
    normalizeTabAwayTimestamps(trials, raw);
  }

  // Phase-trial extension: per-phase integrity reports for
  // gallery / post-gallery-query / end-requery phases live on raw.phaseTrials,
  // mirroring the per-classification-trial shape so the renderer can place
  // gallery mouse trajectories and tab-away events on the same axes.
  //
  // After merging, sort by (rulePosition, phase-rank, trialNumber) so the
  // trajectories grid shows trials in the chronological order each rule was
  // actually experienced: gallery → post-gallery query → classification t1..t6.
  // End-requery trials carry rulePosition=null and sort to the very end of
  // the array, matching their session-end timing.
  if (Array.isArray(raw.phaseTrials) && raw.phaseTrials.length > 0) {
    const phaseTrials = raw.phaseTrials
      .filter(t => t && t[intField])
      .map(t => ({ ...t, ...t[intField] }));
    normalizeTabAwayTimestamps(phaseTrials, raw);
    trials = trials.concat(phaseTrials);
    trials.sort(ruleChronologicalCompare);
  }

  // Shapes 2 and 3 are ALTERNATIVE top-level layouts, tried only when the
  // Shape-1 trials/phaseTrials path produced nothing. Previously the Shape-2
  // branch was chained as `else if` off the phaseTrials `if`, so a payload
  // carrying both `trials` (real integrity) and `responses` — or even a stray
  // empty `responses: []` — had its already-extracted integrity trials clobbered
  // (or the participant silently dropped). Gate on trials.length so Shape-1 wins.
  if (trials.length === 0) {
    // Shape 2: { responses: [{ mouseTrack, tabAwayEvents, ... }] } (legacy).
    // Signal data lives directly on the response — no integrity wrapper. We apply
    // field name mapping (mouseTrack → mouseEvents).
    if (Array.isArray(raw.responses)) {
      trials = raw.responses.map((r, i) => mapLegacyFields({
        ...r,
        _sourceIndex: i
      }));
      // Normalize tab-away timestamps from session-relative performance.now()
      // to trial-relative milliseconds so renderers can plot them on the
      // same x-axis as mouseEvents[].t (which is already trial-relative).
      normalizeTabAwayTimestamps(trials, raw);
    }
    // Shape 3 (a top-level array of trials) and the Transmit envelope were
    // turned into raw.trials above, so the Shape-1 branch read them: the same
    // merge contract (outer trial fields survive, integrity wins on
    // collision, tab-away timestamps normalized), on OUR copies of the rows,
    // never a caller-owned or frozen object. The outer merge keeps replay
    // pointers (integrityReplayMeta / replayFinalizeError ride the outer
    // trial rows) visible to attachReplayArtifacts.
  }

  // Normalize the raw mouseTrack → mouseEvents field name and derive
  // mouseDataAvailable uniformly, regardless of which shape produced
  // `trials`. Historically this only ran inside the Shape-2 branch above,
  // because only Shape-2's legacy `responses[].mouseTrack` field ever used
  // that name. Since monitor.js started persisting the post-hoc raw mouse
  // trace under collectForPostHoc.rawMouseTrack (as report.mouseTrack —
  // src/core/monitor.js endTrial()), Shape-1/3 trials can ALSO carry a
  // `mouseTrack` field via the integrity sub-object. Applying the mapping
  // once here, after every shape is resolved, covers all of them with one
  // mechanism instead of duplicating it per branch. Idempotent for Shape-2
  // trials that already passed through mapLegacyFields above.
  trials = trials.map(mapLegacyFields);

  if (trials.length === 0) {
    warnings.push(`No integrity data found (looked for "${intField}" field)`);
  }

  // Validate each trial has the minimum required fields from the schema.
  // Missing fields get a warning but don't prevent analysis. Array-typed signal
  // fields that arrive as a non-array (e.g. a hand-edited `pasteEvents: {}`) are
  // coerced to [] — otherwise a downstream `for (const e of trial.pasteEvents)`
  // throws "not iterable" and, because report.js has no per-renderer boundary,
  // one malformed file aborts the ENTIRE report. Coercing here keeps the run
  // alive and localizes the damage to a warning on that trial.
  for (const trial of trials) {
    const missing = [];
    for (const [field, spec] of Object.entries(TRIAL_REPORT_FIELDS)) {
      if (spec.required && trial[field] === undefined) {
        missing.push(field);
      }
      if (spec.type === 'array' && trial[field] != null && !Array.isArray(trial[field])) {
        warnings.push(
          `Trial ${trial.trialId ?? '?'}: field "${field}" is not an array ` +
          `(got ${typeof trial[field]}) — coerced to [] to keep analysis running.`
        );
        trial[field] = [];
      }
    }
    if (missing.length > 0) {
      warnings.push(`Trial ${trial.trialId || '?'}: missing fields: ${missing.join(', ')}`);
    }
  }

  const { session, score } = findSessionData(raw, config, warnings);
  if (session === null && trials.length > 0) {
    warnings.push('No session-level integrity data — some signals unavailable (did the experiment call getSessionReport()?)');
  }

  // The jsPsych adapter drops a `cyborgHunterFinalizeError` marker (via
  // addProperties) when finalize() throws, so analysts can tell a missing-session
  // run apart from a genuine finalize() failure. Surface it as a warning instead
  // of leaving it dead in the data behind a generic "no session data" message.
  const finalizeError = raw.cyborgHunterFinalizeError
    ?? raw.metadata?.cyborgHunterFinalizeError
    ?? (Array.isArray(raw.trials)
        ? raw.trials.find(t => t?.cyborgHunterFinalizeError)?.cyborgHunterFinalizeError
        : undefined);
  if (finalizeError) {
    warnings.push(`finalize() failed for this participant (cyborgHunterFinalizeError): ${finalizeError} — session data may be incomplete`);
  }
  // The one-line setup (0.10.0) has no finalize(); when it hits an internal
  // error it drops a `cyborgHunterError` marker instead. Same three locations.
  const oneLinerError = raw.cyborgHunterError
    ?? raw.metadata?.cyborgHunterError
    ?? (Array.isArray(raw.trials)
        ? raw.trials.find(t => t?.cyborgHunterError)?.cyborgHunterError
        : undefined);
  if (oneLinerError) {
    warnings.push(`one-line setup reported an error for this participant (cyborgHunterError): ${oneLinerError} — data after that point may be incomplete`);
  }
  // The Qualtrics writer reduces the payload until it fits the embedded-data
  // cap (src/oneliner/qualtrics-payload.js) and records what it took out,
  // with the whole session's counts (totals); the note says which numbers
  // cover the whole session. A reduced payload without totals (written
  // before the writer carried them) has only its clipboard counters whole,
  // and one with no rows (level 5) is not in the report at all.
  const truncated = raw.cyborgHunterOneLiner?.truncated;
  const reduced = !!truncated && typeof truncated === 'object';
  if (reduced) {
    const whole = trials.length === 0 ? 'no page of the session was kept, so the response is not in the report'
      : truncated.totals && typeof truncated.totals === 'object'
        ? "its counts, scores and tier are the whole session's; the page rows, the means taken over them (typing speed, mouse metrics), the event lists and the names of AI extensions cover only what it kept"
        : "its paste, copy and drop counts, scores and tier are the whole session's; its other counts, per-page rows and event lists cover only what it kept";
    warnings.push(`Qualtrics payload was reduced to fit the embedded-data cap (level ${truncated.level}: ${describeTruncation(truncated)}) — ${whole}`);
  }

  // ch.js's own id, when the study keyed its rows by another, is kept for the
  // reader and the replay attachment (rows of one session only; a copy,
  // never the caller's metadata object).
  let metadata = raw.metadata || {};
  if (fromRows.chId !== undefined && !severalIds && fromRows.chId !== participantId) {
    metadata = { ...(typeof metadata === 'object' ? metadata : {}), cyborgHunterParticipantId: fromRows.chId };
  }

  return {
    participantId,
    trials,
    warnings,
    metadata,
    session,
    score,
    // A payload the Qualtrics writer reduced (levels 1-5), whose older trials
    // and entries were dropped: summary.js then takes the clipboard totals
    // from the session counters and every other count it can from `totals`,
    // the whole session's counts the writer carries (qualtrics-payload.js;
    // summary.js reads only the keys it knows, each only as a finite number
    // >= 0). null for every other payload.
    reducedPayload: reduced ? {
      level: typeof truncated.level === 'number' ? truncated.level : null,
      totals: truncated.totals && typeof truncated.totals === 'object' && !Array.isArray(truncated.totals) ? truncated.totals : null
    } : null,
    // Surface a few top-level payload fields that some renderers need but
    // that aren't part of the session-level integrity object. Keeping the
    // list explicit (rather than exposing `raw` wholesale) avoids future
    // renderers silently coupling to payload internals.
    // Which library version collected this session (monitor.js stamps it on
    // the payload). report.js compares it against the CLI's own VERSION and
    // prints a staleness note on mismatch. CSV-derived data has none → null.
    libraryVersion: typeof raw.libraryVersion === 'string' ? raw.libraryVersion : null,
    galleryStudyMs: Array.isArray(raw.galleryStudyMs) ? raw.galleryStudyMs : null,
    postGalleryGuesses: Array.isArray(raw.postGalleryGuesses) ? raw.postGalleryGuesses : null,
    // App-written top-level guardFriction wins; otherwise synthesize the guard
    // lane from the honeypot's session violation log (which the shipped guard
    // extensions actually emit) so the timeline renders for library-only data.
    guardFriction: raw.guardFriction ?? (() => {
      const v = findGuardViolations(raw);
      return v ? { violations: v } : null;
    })(),
    // Guard-honeypot self-disclosure (visible bait). null when the honeypot
    // extension was not used.
    honeypot: findHoneypotDisclosure(raw),
  };
}

// True when obj plausibly IS a getSessionReport() output — i.e. it carries at
// least one of the well-known top-level session-report keys (see
// src/core/monitor.js sessionData / getSessionReport()). Guards the
// analyst-supplied sessionIntegrityPath below: `typeof === 'object'` alone
// accepts any object the path happens to resolve to, including a near-miss
// wrapper one level up the tree (e.g. `metadata` instead of
// `metadata.integritySession`), which would otherwise silently zero out every
// downstream signal instead of falling through.
function looksLikeSessionData(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return ['tabAwaySums', 'hardScore', 'softScore', 'anyHardTriggered', 'trialsCompleted']
    .some(key => Object.prototype.hasOwnProperty.call(obj, key));
}

// Locates session-level integrity data. An analyst-supplied dotted path
// (config.sessionIntegrityPath, 0.6.1) is checked first; then the built-in
// conventions, in priority order:
//   1. raw.metadata.integritySession / integrityScore — the metadata convention.
//   2. Last trial's integritySession / integrityScore — jsPsych addDataToLastTrial (Option A).
//   3. Any trial's integritySession — fallback (Option B).
//   4. raw.cyborgHunter — native top-level location used by raw-DOM
//      adopters before they adopt the
//      metadata.integritySession mirror. Added 2026-05-26.
//   5. Rolling snapshot (0.10.0 one-line setup) — per-row integritySegment
//      deltas, reassembled by src/cli/segment-reassembly.js.
// Returns { session, score }, both null if not found. `warnings` receives a
// note when a dumped session and rolling segments are both present. Not
// exported (ingest.js re-exports only extractIntegrityData and
// ruleChronologicalCompare); its one caller always passes `warnings`, and the
// `= []` default only keeps a warnings-less call from throwing.
function findSessionData(raw, config, warnings = []) {
  let session = null;
  let score = null;
  let usedSegments = false;

  // 0. Analyst-specified location, e.g. "payload.cyborgHunter" for pipelines
  //    that nest the getSessionReport() output somewhere non-standard. Falls
  //    through to the built-in conventions when the path resolves to nothing
  //    OR to something that doesn't look like a session report (looksLikeSessionData,
  //    0.6.1 — a malformed/near-miss path used to be accepted on typeof alone),
  //    so a partially-migrated cohort still ingests. The score is synthesized
  //    from the session object below (getSessionReport() embeds it).
  const customSession = config?.sessionIntegrityPath
    ? getByPath(raw, config.sessionIntegrityPath) : null;
  if (looksLikeSessionData(customSession)) {
    session = customSession;
  }
  // 1. metadata convention
  else if (raw.metadata?.integritySession) {
    session = raw.metadata.integritySession;
    score = raw.metadata.integrityScore || null;
  }
  // 2. jsPsych addDataToLastTrial convention (Option A)
  else if (Array.isArray(raw.trials) && raw.trials.length > 0 &&
           raw.trials[raw.trials.length - 1]?.integritySession) {
    const last = raw.trials[raw.trials.length - 1];
    session = last.integritySession;
    score = last.integrityScore || null;
  }
  // 3. Any-trial fallback
  else if (Array.isArray(raw.trials) && raw.trials.find(x => x?.integritySession)) {
    const t = raw.trials.find(x => x?.integritySession);
    session = t.integritySession;
    score = t.integrityScore || null;
  }
  // 4. Native top-level location. An early raw-DOM adopter app
  //    writes the getSessionReport() output directly to `raw.cyborgHunter`.
  //    Sessions saved before the metadata.integritySession mirror landed
  //    (2026-05-24) have ONLY this top-level field. Without
  //    this fallback, the renderer can't find windowPositions and falls back
  //    to stale top-level metadata.windowWidth — visible as a misaligned
  //    "browser window" dashed rectangle in the trajectory PNGs.
  else if (raw.cyborgHunter && typeof raw.cyborgHunter === 'object') {
    session = raw.cyborgHunter;
    score = null;
  }
  // 5. Rolling snapshot (0.10.0 one-line setup): per-row integritySegment deltas,
  //    concatenated in segmentIndex order into the same shape finalize() dumps.
  else {
    const segs = collectSegments(raw);
    if (segs.length > 0) {
      const rolled = reassembleSegments(segs);
      session = rolled.session;
      score = rolled.score;
      usedSegments = true;
    }
  }

  // A file carrying both is a study that mixed manual finalize() with the
  // one-line setup. The dumped session is complete by construction, so it
  // wins; say so rather than silently ignoring the segments. This also fires
  // when branch 0 (the analyst's sessionIntegrityPath) found the session,
  // since that leaves usedSegments false too.
  if (session && !usedSegments && collectSegments(raw).length > 0) {
    warnings.push('both a dumped integritySession and rolling segments (integritySegment) were found — the dumped integritySession was used; this file mixes manual mode and the one-line setup');
  }

  // When no separate integrityScore blob was saved, synthesize the authoritative
  // score from the session object itself. getSessionReport() embeds the scoring
  // summary (hardScore/softScore/anyHardTriggered/softScoreThreshold/
  // trialsCompleted) directly in the session report, so integritySession-only
  // and raw.cyborgHunter payloads already carry it. Without this, summary.js
  // falls back to a per-trial `trialHits > 0` rule that OVERSTATES hard flags
  // (any single hit flags hard, ignoring the count threshold).
  if (!score && session) score = scoreFromSession(session);

  return { session, score };
}

// Builds a { hardScore, softScore, anyHardTriggered, softScoreThreshold,
// trialsCompleted } score object from a session report that embeds those
// fields. Returns null if the session carries no scoring fields at all.
function scoreFromSession(session) {
  if (!session || typeof session !== 'object') return null;
  const hasScore = session.softScore !== undefined
    || session.anyHardTriggered !== undefined
    || session.hardScore !== undefined;
  if (!hasScore) return null;
  // Derive anyHardTriggered from hardScore when the boolean is absent (some
  // session payloads carry the per-signal hardScore map but not the rolled-up
  // flag). Without this, summary.js would fall back to its per-trial trialHits>0
  // rule, which overstates hard flags.
  let anyHardTriggered = session.anyHardTriggered;
  if (anyHardTriggered === undefined && session.hardScore && typeof session.hardScore === 'object') {
    anyHardTriggered = Object.values(session.hardScore).some(s => s && s.triggered);
  }
  return {
    hardScore: session.hardScore,
    softScore: session.softScore,
    anyHardTriggered,
    softScoreThreshold: session.softScoreThreshold,
    trialsCompleted: session.trialsCompleted,
  };
}

// Normalizes guard-honeypot violation evidence into the { violations: [...] }
// shape the session-timeline renderer expects under `guardFriction`. The
// honeypot extension writes the friction violation log (it subscribes to
// guard-friction.onViolation) as a STRINGIFIED `guard_assistance_violations_session`
// field via addProperties, so on a saved payload it lands on the trial rows
// (or metadata). Each entry is { reason, start, end, duration, in_progress };
// the renderer keys off `t` (perfNow ms), so map start → t. Apps that hand-write
// a top-level `raw.guardFriction` object still take precedence over this.
// One-line setup across several pages (0.10.0 vanilla host): each page's
// entries carry that page's `pageOrigin`, and `t` is re-based onto the first
// segment's origin like the rest of the session; entries without one keep
// their `start`.
function findGuardViolations(raw) {
  const origin0 = collectSegments(raw)[0]?.pageOrigin;
  const offset = (v) => (typeof v.pageOrigin === 'number' && typeof origin0 === 'number')
    ? v.pageOrigin - origin0 : 0;
  const parseArr = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
    return null;
  };
  // True when a candidate value parses to at least one REAL violation (an entry
  // with a numeric start). Used to scan trials for real data rather than the
  // first trial that merely has a truthy field.
  const hasReal = (v) => {
    const a = parseArr(v);
    return Array.isArray(a) && a.some(x => x && typeof x.start === 'number');
  };
  const candidates = [
    raw.metadata?.guard_assistance_violations_session,
    Array.isArray(raw.trials) && raw.trials.length > 0
      ? raw.trials[raw.trials.length - 1]?.guard_assistance_violations_session : null,
    // Scan ALL trials for one carrying REAL violations — not just the first trial
    // with a truthy field. A truthy-but-empty "[]" on an earlier trial used to
    // make .find() lock on, then the outer loop fell through to candidate 4 and
    // a later trial's real violations were never reached. Not live for the
    // shipped honeypot (it stamps this field identically on every trial), but a
    // latent bug for any non-uniform / merged producer.
    Array.isArray(raw.trials)
      ? raw.trials.map(t => t?.guard_assistance_violations_session).find(hasReal)
      : null,
    raw.guard_assistance_violations_session,
  ];
  for (const c of candidates) {
    const arr = parseArr(c);
    if (Array.isArray(arr)) {
      const violations = arr
        .filter(v => v && typeof v.start === 'number')
        .map(v => ({ t: v.start + offset(v), reason: v.reason || 'unknown', phase: 'unknown', duration_ms: v.duration }));
      // Fall through to the next source on an empty/violation-less candidate
      // instead of locking onto it — otherwise an empty placeholder (e.g. a
      // metadata mirror set to []) would shadow real violations on the trial rows.
      if (violations.length > 0) return violations;
    }
  }
  return null;
}

// Surfaces the guard-honeypot self-disclosure fields (the visible bait: an "I used
// AI" checkbox and a free-text box). The honeypot writes ai_use_session /
// ai_report_session via addProperties and per-trial ai_use / ai_report via
// on_finish. The runtime emits them but no analyzer consumed them — this lifts
// them onto the participant so summary.csv / triage can surface them. Returns
// null when the honeypot was not used (fields absent everywhere).
function findHoneypotDisclosure(raw) {
  // Aggregate across every source rather than returning the first that carries a
  // honeypot key. addProperties stamps ai_use_session=false / ai_report_session=''
  // onto ALL trials, so the final trial is usually blank-but-present; returning it
  // first would mask a positive disclosure recorded on an earlier trial. A
  // disclosure anywhere (ticked checkbox OR non-empty report) makes the whole
  // participant positive.
  const sources = [];
  if (raw.metadata && typeof raw.metadata === 'object') sources.push(raw.metadata);
  if (Array.isArray(raw.trials)) sources.push(...raw.trials);
  sources.push(raw);

  // Accept the checkbox as a real boolean OR its CSV string form ("true"/"false"
  // survive Papa's dynamicTyping in some pipelines). Crucially, presence requires
  // an actual checkbox value or non-empty report text — NOT mere key existence:
  // shared-header CSVs give honeypot-less participants blank ('' / null) cells,
  // and counting those as "present" would manufacture a `no` instead of the
  // documented empty (honeypot-absent) state.
  const isBool = (v) => v === true || v === false || v === 'true' || v === 'false';
  const isTrue = (v) => v === true || v === 'true';
  const reportText = (v) => (typeof v === 'string' ? v : '');

  let present = false;
  let ticked = false;
  let sessionReport = '';  // authoritative *_session report text (prefer longest)
  let trialReport = '';    // longest per-trial report snapshot
  for (const obj of sources) {
    if (!obj || typeof obj !== 'object') continue;
    const repS = reportText(obj.ai_report_session);
    const repT = reportText(obj.ai_report);
    const hasDisclosureField = isBool(obj.ai_use_session) || isBool(obj.ai_use)
      || repS.length > 0 || repT.length > 0;
    if (!hasDisclosureField) continue;
    present = true;
    if (isTrue(obj.ai_use_session) || isTrue(obj.ai_use)) ticked = true;
    if (repS.length > sessionReport.length) sessionReport = repS;
    if (repT.length > trialReport.length) trialReport = repT;
  }
  if (!present) return null;
  const aiReport = sessionReport || trialReport;
  // aiUse reflects the explicit "I used AI" checkbox ONLY. The free-text box is
  // surfaced separately (aiReport / honeypot_ai_report) for the reviewer to read
  // and judge — auto-classifying any non-empty text as a positive would
  // false-flag entries like "none" / "didn't use AI" and contradicts the
  // documented "YES = ticked" semantics. The tool produces evidence, not verdicts.
  return { aiUse: ticked, aiReport };
}

// Chronological-by-rule trial ordering: (rulePosition, phase-rank,
// trialNumber). Shows trials in the order each rule was actually
// experienced — gallery → post-gallery query → classification t1..t6 — with
// end-requery trials (rulePosition=null → Infinity) sorting to the very end,
// matching their session-end timing. Used by the phaseTrials merge above and
// by the trajectories renderer's default displayOrder. Stable-sort friendly:
// trials without any of these fields compare equal and keep their input order.
export function ruleChronologicalCompare(a, b) {
  const phaseRank = (ph) => {
    if (ph === 'gallery') return 0;
    if (ph === 'post_gallery_query') return 1;
    if (ph === 'end_requery') return 99;
    return 2; // classification or unspecified
  };
  const aPos = a.rulePosition ?? Infinity;
  const bPos = b.rulePosition ?? Infinity;
  if (aPos !== bPos) return aPos - bPos;
  const aP = phaseRank(a.phase);
  const bP = phaseRank(b.phase);
  if (aP !== bP) return aP - bP;
  return (a.trialNumber ?? 0) - (b.trialNumber ?? 0);
}

// Maps legacy/alternate field names to CyborgHunter schema names. Originally
// Shape-2-only (responses[].mouseTrack); now applied to every shape (see the
// call site above) since monitor.js's collectForPostHoc.rawMouseTrack can
// also produce a `mouseTrack` field on Shape-1/3 trials. The CLI can then use
// a single set of field names downstream regardless of source.
const LEGACY_FIELD_MAP = {
  mouseTrack: 'mouseEvents',
};

// Normalizes tabAwayEvents[*].start from session-relative performance.now()
// (ms since browser navigation) to trial-relative ms (ms since this trial
// began), stored as a new `startRel_ms` field. Renderers plot per-trial
// against trial-relative time; without normalization, tab-away markers
// land tens of thousands of ms off the right edge — invisible.
//
// Two paths:
//   FAST PATH — every trial has a per-trial performance.now() anchor (either
//     trialStart_perfNow set by the jsPsych wrapper, or startTime set by the
//     standalone monitor). Subtract directly; result is exact.
//   ESTIMATOR PATH — Shape-2 / pre-monitor data has neither anchor.
//     We infer the session-start performance.now() value from the
//     relationship between trial-end wall-clocks (`timestamp`),
//     `responseTime_ms`, and the first tab-away's session-relative `start`,
//     then subtract the inferred offset to get a trial-relative value.
//     Less precise than the fast path; used only when nothing better exists.
function normalizeTabAwayTimestamps(trials, raw) {
  // Fast path — every trial has a usable anchor.
  const everyTrialHasAnchor = trials.length > 0 && trials.every(t =>
    typeof (t.trialStart_perfNow ?? t.startTime) === 'number'
  );
  if (everyTrialHasAnchor) {
    for (const trial of trials) {
      const tabs = trial.tabAwayEvents;
      if (!Array.isArray(tabs) || tabs.length === 0) continue;
      const trialStart = trial.trialStart_perfNow ?? trial.startTime;
      trial.tabAwayEvents = tabs.map(ta => ({
        ...ta,
        startRel_ms: typeof ta.start === 'number' ? ta.start - trialStart : null
      }));
    }
    return;
  }

  // Estimator path. Need a session-start wall-clock anchor; if there isn't
  // one, we have no way to relate trial-end timestamps to a 0 reference.
  const sessStartIso = raw.metadata?.startTime;
  if (!sessStartIso) return;
  const sessStartMs = Date.parse(sessStartIso);
  if (!Number.isFinite(sessStartMs)) return;

  // For each trial, compute trial-start in ms-since-session-start (wall-clock).
  // trial-end is response.timestamp; trial-start = trial-end − duration.
  const trialStartRels = trials.map(t => {
    if (!t.timestamp || t.responseTime_ms == null) return null;
    const endMs = Date.parse(t.timestamp);
    if (!Number.isFinite(endMs)) return null;
    return (endMs - sessStartMs) - t.responseTime_ms;
  });

  // For each trial that has ≥1 tab-away, estimate the session offset:
  //   sessionOffset = (performance.now value at session start, in ms)
  // The first tab-away of the trial must fall inside the trial's response
  // window, so:
  //   firstTabStart ∈ [sessionOffset + trialStartRel,
  //                    sessionOffset + trialStartRel + trialDuration]
  // Solving for sessionOffset gives an interval; we use the midpoint as
  // each trial's candidate, then take the median across trials as the
  // robust estimate. This is approximate but converges quickly with even
  // a few tab-away-bearing trials.
  const candidates = [];
  for (let i = 0; i < trials.length; i++) {
    const tabs = trials[i].tabAwayEvents;
    if (!Array.isArray(tabs) || tabs.length === 0) continue;
    const trialStartRel = trialStartRels[i];
    const trialDurationMs = trials[i].responseTime_ms;
    if (trialStartRel == null || trialDurationMs == null) continue;
    const firstTabStart = tabs[0].start;
    if (typeof firstTabStart !== 'number') continue;
    candidates.push(firstTabStart - trialStartRel - trialDurationMs / 2);
  }

  if (candidates.length === 0) return;

  candidates.sort((a, b) => a - b);
  const sessionOffset = candidates[Math.floor(candidates.length / 2)];

  // Apply normalization. Original `start` is preserved alongside `startRel_ms`
  // so consumers can still see the absolute time if they want it.
  for (let i = 0; i < trials.length; i++) {
    const tabs = trials[i].tabAwayEvents;
    if (!Array.isArray(tabs) || tabs.length === 0) continue;
    const trialStartRel = trialStartRels[i];
    if (trialStartRel == null) continue;
    trials[i].tabAwayEvents = tabs.map(ta => ({
      ...ta,
      startRel_ms: typeof ta.start === 'number'
        ? ta.start - sessionOffset - trialStartRel
        : null
    }));
  }
}

function mapLegacyFields(trial) {
  const mapped = { ...trial };
  for (const [oldName, newName] of Object.entries(LEGACY_FIELD_MAP)) {
    if (mapped[oldName] !== undefined && mapped[newName] === undefined) {
      mapped[newName] = mapped[oldName];
      delete mapped[oldName];
    }
  }
  // Flag distinguishes "no tracking hardware" from "tracked, zero events"
  mapped.mouseDataAvailable = Array.isArray(mapped.mouseEvents) && mapped.mouseEvents.length > 0;
  return mapped;
}
