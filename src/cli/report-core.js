// src/cli/report-core.js
// The report pipeline after ingest, with no Node APIs: analyze, then render
// every output file through deps.sink in the order the CLI writes them.
// report.js (the Node shell) gives it a disk sink and node-canvas; the browser
// page gives it a zip sink and OffscreenCanvas. Console lines the CLI prints
// go through deps.log / deps.warn so the shell's output is unchanged.
//
// deps = {
//   sink(path, data)       REQUIRED, synchronous; called once per output file
//                          (data is a string or a Uint8Array), in CLI order
//   log(line), warn(line)  the CLI's console lines (default: dropped); every
//                          warn line is also collected in the result's warnings
//   createCanvas(w, h)     absent/null ⇒ no images (visualsRendered false)
//   encodePng(canvas)      → Promise<Uint8Array>; required with createCanvas
//   replayClientSrc, fontFaceCss   the assembled viewer client and the font
//                          CSS (report.js reads both from disk)
//   assetMap               styled-replay assets, or null
//   keepImages             true ⇒ result.images[pid][kind] holds the PNG bytes
//                          (for renderInPageHtml)
//   sha256(text)           → hex string, or a Promise of one (ingest's own
//                          injected hash): the run id (runIdOf). Absent ⇒ the
//                          report carries no run id, no run time and no
//                          annotation controls
//   now()                  → the run's time as an ISO string (default: the clock)
// }
import { computeSummary } from './analyzers/summary.js';
import { detectEdgeExits } from './analyzers/edge-exit.js';
import { analyzeCursor } from './analyzers/cursor.js';
import { rankTriage } from './analyzers/triage.js';
import { resolveScoreWeights, formulaText } from './analyzers/score-weights.js';
import { applyPhaseScope, describePhaseScope, findUnmatchedPhaseScopePhases } from './analyzers/phase-scope.js';
import { buildSummaryCsv } from './renderers/summary-csv-core.js';
import { buildScoreWeightsJson } from './renderers/score-weights-core.js';
import { buildCursorLimitsJson } from './renderers/cursor-limits-core.js';
import { buildTriageMd } from './renderers/triage-md-core.js';
import { buildEventLogCsv } from './renderers/event-log-core.js';
import { buildExtensionsCsv } from './renderers/extensions-core.js';
import { drawTrajectoryGrid, sanitize as sanitizeTrajectory } from './renderers/trajectories-core.js';
import { drawSessionTimeline, sanitize as sanitizeTimeline, shortId } from './renderers/session-timeline-core.js';
import { drawTypingProfile, sanitize as sanitizeTyping } from './renderers/typing-profile-core.js';
import { buildReplayAssets } from './renderers/replay-assets-core.js';
import { renderIndexHtml } from './renderers/html-index-core.js';
import { bytesToBase64 } from '../shared/base64.js';

// The text files every report contains, in write order (images/ and replay/
// files, when there are any, come between extensions.csv and index.html).
export const REPORT_FILES = ['summary.csv', 'score-weights.json', 'cursor-limits.json', 'triage.md', 'event-log.csv', 'extensions.csv', 'index.html'];

// The run id names the cohort and its data: each participant's id with a
// config-free fingerprint (trial count, first and last trial timestamps), the
// list sorted by id, then by the rest of the row, as JSON, hashed with the
// injected sha256; its first 16 hex digits. A rebuild of the same files keeps
// it whatever the analysis settings (a change to the ID or integrity field
// reads the files again and can give another id), so the annotations stored
// under it (ch-annot:<runId>) stay with the report; two studies that share
// ids 1…N do not (when their trials carry stamps). Ingest keeps two records
// with one id (a repeat upload, a lab.js slice stored next to its final
// body), and the CLI reads files in path order while the analyze page takes
// them in drop order, so equal ids are ordered by the rest of their rows: the
// order is total, and both get the same id.
// A trial's stamp is its integrity report's timestamp. Legacy `responses`
// data and an integrityField other than `integrity` carry no such object;
// ingest leaves the stamp on the trial itself there, so that is read next.
// Data from before 0.6.1 has none unless the experiment stamped its own
// trials; without one, the trial count alone remains.
export async function runIdOf(participants, sha256) {
  const isStamp = (v) => typeof v === 'string';
  const stamp = (t) => {
    if (t && t.integrity && isStamp(t.integrity.timestamp)) return t.integrity.timestamp;
    return (t && isStamp(t.timestamp)) ? t.timestamp : null;
  };
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const rows = participants.map((p) => {
    const trials = Array.isArray(p.trials) ? p.trials : [];
    return [String(p.participantId), trials.length, stamp(trials[0]), stamp(trials[trials.length - 1])];
  });
  rows.sort((a, b) => cmp(a[0], b[0]) || cmp(JSON.stringify(a), JSON.stringify(b)));
  return String(await sha256(JSON.stringify(rows))).slice(0, 16);
}

export async function buildReport(participants, config, deps) {
  const sink = deps.sink;
  const log = deps.log || (() => {});
  const warnings = [];
  const warn = (line) => { warnings.push(line); if (deps.warn) deps.warn(line); };

  // Analyze — compute summaries, detect edge exits, rank by triage priority.
  // config.phaseScope (0.6.1) filters which trials feed the analyzers so
  // scores can honor pre-registered phase scoping; renderers below still get
  // the FULL participants, so the visual evidence is never hidden.
  const scoredParticipants = applyPhaseScope(participants, config.phaseScope);
  if (scoredParticipants !== participants) {
    log(`\nPhase scope active (${describePhaseScope(config.phaseScope)}):`);
    log(`  scores count per-trial signals inside the scope only; ambient session`);
    log(`  signals (sidebar, shortcuts, viewport shifts, zoom) stay session-wide.`);
    // A configured phase name that matches no trial is almost always a typo. For
    // an `include`, it silently filters every trial and reports the cohort clean.
    const unmatched = findUnmatchedPhaseScopePhases(participants, config.phaseScope);
    if (unmatched.length > 0) {
      warn(`[cyborg-hunter] phaseScope names match NO trial in the data: ` +
        `${unmatched.join(', ')} — likely a typo; scored trials may be wrongly emptied.`);
    }
  }
  const summaries = computeSummary(scoredParticipants, config);
  // The cursor section (analyzers/cursor.js) rides on each summary so the
  // triage reason, the CSV, the rail and the score term read one object. It
  // judges with the default constants (CURSOR_LIMITS); no config key changes
  // them.
  const cursors = analyzeCursor(scoredParticipants);
  summaries.forEach((s, i) => { s.cursorAnalysis = cursors[i]; });
  const edgeExits = detectEdgeExits(scoredParticipants, config);
  const triage = rankTriage(summaries, edgeExits, config);

  const flaggedHard = triage.filter(t => t.hardTriggered).length;
  const flaggedSoft = triage.filter(t => !t.hardTriggered && t.softFlagged).length;
  const clean = triage.length - flaggedHard - flaggedSoft;

  // Two DIFFERENT numbers live in this report and used to share the word
  // "flagged": the tier counts below come from the LIBRARY's two-tier
  // screening (hard count thresholds / soft score vs its threshold), while
  // triage.md is ORDERED by the CLI's separate composite triage score
  // (by default 5×paste + 5×copy + 3×sidebar + 1×tab-away; config.scoreWeights
  // can change it) within each tier. Label both explicitly so the console
  // summary can't be read as "top N of triage.md".
  const scoreWeights = resolveScoreWeights(config.scoreWeights);
  log(`\nAnalyzing...`);
  log(`  Hard-flagged (hard signal crossed its count threshold): ${flaggedHard}`);
  log(`  Soft-flagged (library soft score >= its threshold):     ${flaggedSoft}`);
  log(`  Clean:                                                  ${clean}`);
  log(`  Triage.md orders tier-first (hard > soft > clean), then by the CLI`);
  log(scoreWeights.isDefault
    ? `  triage score (5xpaste + 5xcopy + 3xsidebar + 1xtab-away) within a tier.`
    : `  triage score (${formulaText(scoreWeights.weights, 'x')}, from scoreWeights) within a tier.`);

  // Render — text files first (no native dependencies).
  log(`\nRendering...`);
  sink('summary.csv', buildSummaryCsv(summaries, triage));
  log(`  summary.csv — ${summaries.length} participants`);
  const sw = buildScoreWeightsJson(config);
  sink('score-weights.json', sw.text);
  log(`  score-weights.json — ${sw.isDefault ? 'default' : 'custom'} weights`);
  // recordedWith: every library version the data names, once each, in
  // version order (0.6.1 before 0.14.0), joined by ", "; null when none.
  const versions = new Set();
  for (const p of participants) for (const t of p.trials || []) if (typeof t.libraryVersion === 'string' && t.libraryVersion) versions.add(t.libraryVersion);
  const recordedWith = versions.size ? [...versions].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(', ') : null;
  sink('cursor-limits.json', buildCursorLimitsJson(recordedWith, cursors));
  log(`  cursor-limits.json — the constants the cursor section used`);
  sink('triage.md', buildTriageMd(triage, config));
  log(`  triage.md — ranked list`);
  const ev = buildEventLogCsv(participants);
  sink('event-log.csv', ev.csv);
  log(`  event-log.csv — ${ev.rows} events`);
  const ex = buildExtensionsCsv(participants);
  sink('extensions.csv', ex.csv);
  log(`  extensions.csv — ${ex.rows} detections`);

  // The pointer checks over the cohort: the run line (returned as cursorLine
  // for the analyze page, whose worker does not wire log) and, when the
  // cursor weight is on but some sessions carry no device facts, the warning.
  // withDevice: sessions with device facts (at least the automation flag is
  // recorded); fired: sessions with any check that fired, in any state;
  // withoutDevice: the rest of the cohort; noStream: sessions with no cursor
  // stream, which overlap the other counts and are stated apart.
  const total = cursors.length;
  const withDevice = cursors.filter(c => c.checksRecorded >= 1).length;
  const fired = cursors.filter(c => c.factCount > 0).length;
  const withoutDevice = total - withDevice;
  const noStream = cursors.filter(c => c.state !== 'ok').length;
  const cursorLine = `Pointer checks: fired in ${fired} of ${withDevice} sessions with device facts (${withoutDevice} recorded without them; ${noStream} without a cursor stream)`;
  log(`  ${cursorLine}`);
  const cursorWeight = scoreWeights.weights.cursor.weight;
  if (cursorWeight > 0 && withDevice < total) {
    warn(`[cyborg-hunter] scoreWeights.cursor is ${cursorWeight}; ${withDevice} of ${total} sessions carry device facts (the rest were recorded before 0.14): the weight ranks only those.`);
  }

  // Plots, through the injected canvas: one PNG per participant from each of
  // trajectories-core.js, session-timeline-core.js and typing-profile-core.js.
  let visualsRendered = false;
  const images = {};
  if (deps.createCanvas && !config.noVisuals) {
    const emit = async (path, canvas, pid, kind) => {
      const bytes = await deps.encodePng(canvas);
      sink(path, bytes);
      if (deps.keepImages) (images[pid] = images[pid] || {})[kind] = bytes;
    };
    const triageMap = new Map(triage.map(t => [t.participantId, t]));
    for (const p of participants) {
      const canvas = drawTrajectoryGrid(p, triageMap.get(p.participantId), config, deps.createCanvas);
      if (!canvas) continue;
      await emit(`images/trajectories_${sanitizeTrajectory(p.participantId)}.png`, canvas, p.participantId, 'trajectories');
    }
    log(`  trajectories — ${participants.length} images`);
    let rendered = 0;
    for (const p of participants) {
      try {
        const canvas = await drawSessionTimeline(p, config, deps.createCanvas);
        if (!canvas) continue;
        await emit(`images/session_timeline_${sanitizeTimeline(p.participantId)}.png`, canvas, p.participantId, 'sessionTimeline');
        rendered++;
      } catch (err) {
        // Defensive: never let one bad payload kill the whole report.
        warn(`  [warn] session timeline failed for ${shortId(p.participantId)}: ${err.message}`);
      }
    }
    log(`  session timelines — rendered (${rendered}/${participants.length})`);
    for (const p of participants) {
      const canvas = drawTypingProfile(p, config, deps.createCanvas);
      if (!canvas) continue;
      await emit(`images/typing_profile_${sanitizeTyping(p.participantId)}.png`, canvas, p.participantId, 'typingProfile');
    }
    log(`  typing profiles — rendered`);
    visualsRendered = true;
  }

  // Replay assets — per-participant JSONP models under replay/, lazy-loaded
  // by the HTML report. Size is printed because dom-tier models dominate
  // the report's disk footprint. This pass stamps `assetPath` (and rewrites
  // unloadable artifacts) on the participants, so it runs before the index.
  const replayAssets = buildReplayAssets(participants, { sink, assetMap: deps.assetMap || null });
  if (replayAssets.count > 0) {
    log(`  replay/ — ${replayAssets.count} session replays (${(replayAssets.totalBytes / 1024 / 1024).toFixed(1)} MB)`);
  }
  // A skipped artifact is already visible in the report (the participant's
  // replay section says why), but an analyst watching the CLI must not have
  // to open the HTML to learn a recording did not make it.
  for (const s of replayAssets.skipped) log(`  replay/ — skipped ${s.participantId}: ${s.reason}`);
  for (const a of replayAssets.assetErrors) {
    warn(`  [warn] experiment assets not applied to the replay of ${shortId(a.participantId)}: ${a.reason}`);
  }

  // The run id and time, shown in the report's top bar. Both stay null
  // without deps.sha256, and the page is then the one it always was.
  const runId = deps.sha256 ? await runIdOf(participants, deps.sha256) : null;
  const generatedAt = runId ? (deps.now ? deps.now() : new Date().toISOString()) : null;

  // HTML index page — references images/ and replay/ by path (not embedded).
  const html = await renderIndexHtml(summaries, triage, participants, config, visualsRendered,
    { replayClientSrc: deps.replayClientSrc, fontFaceCss: deps.fontFaceCss, runId, generatedAt });
  sink('index.html', html);
  log('  index.html — report page');

  return { summaries, triage, triageOrder: triage.map(t => t.participantId),
    counts: { flaggedHard, flaggedSoft, clean }, visualsRendered, replayAssets, warnings, images, runId, generatedAt, cursorLine };
}

// The in-page report: the SAME summaries/triage and the SAME PNG bytes the zip
// got (plots drawn once), as data URIs; replays are shown outside the report
// (replayShownExternally), so this must run AFTER buildReport, whose replay
// pass stamps `assetPath` and rewrites unloadable artifacts on the participants.
// The page keeps the report's annotations (annotationPostMessage): the report
// runs in a sandboxed frame there, where storage throws.
// deps = { replayClientSrc, fontFaceCss, bytesToBase64? }
export async function renderInPageHtml(built, participants, config, deps) {
  const toB64 = deps.bytesToBase64 || bytesToBase64;
  const imageSources = {};
  for (const p of participants) {
    const im = built.images[p.participantId] || {};
    imageSources[p.participantId] = {
      typingProfile: im.typingProfile ? 'data:image/png;base64,' + toB64(im.typingProfile) : null,
      sessionTimeline: im.sessionTimeline ? 'data:image/png;base64,' + toB64(im.sessionTimeline) : null,
      trajectories: im.trajectories ? 'data:image/png;base64,' + toB64(im.trajectories) : null,
    };
  }
  return renderIndexHtml(built.summaries, built.triage, participants, config, built.visualsRendered, {
    imageSources, replayShownExternally: true, selectionPostMessage: true, annotationPostMessage: true,
    replayClientSrc: deps.replayClientSrc, fontFaceCss: deps.fontFaceCss,
    runId: built.runId, generatedAt: built.generatedAt,
  });
}
