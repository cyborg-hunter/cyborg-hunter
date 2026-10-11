// src/cli/report.js
// CLI report pipeline orchestrator.
// Runs: config → ingest → analyze → render → output
//
// This is the main pipeline that ties all CLI modules together.
// Each stage is imported lazily where possible so partial runs
// (e.g., missing canvas) degrade gracefully.

import { join } from 'path';
import { loadConfig } from './config.js';
import { ingest, nodeDeps } from './ingest.js';
import { buildReport } from './report-core.js';
import { VERSION } from '../shared/constants.js';
import { checkForUpdate, formatUpdateNotice, formatCollectedVersionNotice } from './update-check.js';

// The ingest warnings as stderr lines: one per warning, file-level entries
// before per-response ones (a Qualtrics export's empty-rows count must survive
// the cap), at most `max` of them, then a count of the rest. Entries that are
// not per-response keep their order.
export function ingestWarningLines(warnings, max = 20) {
  const ordered = [...warnings.filter((w) => !('response' in w)), ...warnings.filter((w) => 'response' in w)];
  const all = ordered.flatMap((w) => w.warnings.map((t) => `    - ${w.file}: ${t}`));
  if (all.length === 0) return [];
  const lines = [`  Per-file warnings (${all.length}):`, ...all.slice(0, max)];
  if (all.length > max) lines.push(`    ... and ${all.length - max} more`);
  return lines;
}

export async function run(args) {
  console.log(`cyborg-hunter report v${VERSION}\n`);

  // Kick the update check off first so the registry request overlaps the
  // whole pipeline; awaited (bounded by its own short timeout) at the end.
  const updateCheck = checkForUpdate({ currentVersion: VERSION }).catch(() => null);

  // 1. Load and merge config (defaults ← file ← CLI flags)
  const config = loadConfig(args);

  // 2. Ingest participant data files
  const { participants, warnings } = await ingest(config);
  console.log(`Found ${participants.length} participants` +
    (warnings.length ? ` (${warnings.length} files had warnings)` : ''));

  if (participants.length === 0) {
    console.error(
      `[cyborg-hunter] no valid participant data found in ${config.dataDir} (pattern: ${config.filePattern}).`
    );
    console.error(`  Common causes:`);
    console.error(`    - dataDir points to the wrong directory`);
    console.error(`    - filePattern doesn't match your file extensions (try "*.csv" or "*.{json,csv}")`);
    console.error(`    - participantIdField doesn't match the actual field in your data`);
    console.error(`      (jsPsych output usually uses "subject_ID", not "participantId")`);
    if (warnings.length > 0) {
      console.error(`  Per-file warnings (${warnings.length}):`);
      for (const w of warnings.slice(0, 3)) {
        console.error(`    - ${w.file}: ${w.warnings[0]}`);
      }
      if (warnings.length > 3) console.error(`    ... and ${warnings.length - 3} more`);
    }
    process.exit(1);
  }
  // On a successful run the warnings go to stderr, so stdout and every output
  // file are what they were. A Qualtrics export's diagnosis (how many
  // responses carry no data) is only visible here on the CLI.
  ingestWarningLines(warnings).forEach((line) => console.error(line));

  // Offline staleness note: payloads stamp the library version that collected
  // them, so an experiment still serving an old bundle is visible without any
  // network. (The registry check above covers the CLI side.)
  const collectedNotice = formatCollectedVersionNotice(
    participants.map(p => p.libraryVersion), VERSION);
  if (collectedNotice) console.log(collectedNotice);

  // assetsDir: the experiment's own stylesheets/images, matched to the URLs
  // the recordings reference (asset-match.js) and inlined into the replays —
  // for archives whose experiment server is gone. Same matcher as the
  // browser page; a missing directory is a config error, not a silent skip.
  let assetMap = null;
  if (config.assetsDir) {
    const { readdirSync } = await import('fs');
    const { relative } = await import('path');
    const { buildAssetMap, ASSET_EXTENSIONS } = await import('./asset-match.js');
    const { fsReader } = await import('./ingest.js');
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
    let paths;
    try { paths = walk(config.assetsDir); } catch (e) {
      console.error(`[cyborg-hunter] assetsDir not readable: ${e.message}`);
      process.exit(1);
    }
    const files = paths.filter((p) => ASSET_EXTENSIONS.includes(p.slice(p.lastIndexOf('.')).toLowerCase()))
      .map((p) => ({ path: relative(config.assetsDir, p), read: fsReader(p).read }));
    const recordings = participants.filter((p) => p.replay && p.replay.recording).map((p) => p.replay.recording);
    const built = await buildAssetMap(recordings, files);
    assetMap = built.assetMap;
    console.log(`\nExperiment assets (${config.assetsDir}): ${built.report.matched.length} matched, ` +
      `${built.report.missing.length} missing, ${built.report.ambiguous.length} ambiguous`);
    for (const a of built.report.ambiguous) console.warn(`[cyborg-hunter] ${a.url} matches several files: ${a.candidates.join(', ')} — not inlined`);
    for (const w of built.report.warnings) console.warn(`[cyborg-hunter] ${w}`);
  }

  // 3+4. Analyze and render, through the pure core (report-core.js) with a
  // disk sink. The console lines are the core's; the shell only prints them.
  const { mkdirSync, writeFileSync } = await import('fs');
  const { dirname } = await import('path');
  mkdirSync(config.outputDir, { recursive: true });
  // replay/ is created by its first write (dirname below), so a cohort whose
  // every artifact is unloadable still gets no replay/ directory.
  const sink = (path, data) => {
    const full = join(config.outputDir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  };

  // Visual renderers require node-canvas (optional dependency).
  // If canvas is unavailable, skip with a helpful install message.
  let createCanvas = null;
  let encodePng = null;
  if (!config.noVisuals) {
    let canvas;
    try {
      canvas = await import('canvas');
    } catch {
      console.log(`\n  Trajectory images require the 'canvas' package, which needs Cairo.\n`);
      console.log(`    macOS:    brew install pkg-config cairo pango libpng jpeg giflib librsvg`);
      console.log(`    Ubuntu:   sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev`);
      console.log(`    Windows:  https://github.com/nicktacik/node-canvas#compiling\n`);
      console.log(`  Then run: npm install canvas`);
      console.log(`  Continuing without visuals.\n`);
    }
    if (canvas) {
      createCanvas = canvas.createCanvas;
      encodePng = async (c) => new Uint8Array(c.toBuffer('image/png'));
      // Created up front, as before: images/ exists whenever node-canvas
      // loaded, even if no participant produced a plot.
      mkdirSync(join(config.outputDir, 'images'), { recursive: true });
    }
  }

  const { readReplayClientSrc } = await import('./renderers/replay-client-source.js');
  const { buildFontFaceCss } = await import('./renderers/report-fonts.js');
  await buildReport(participants, config, {
    sink, log: console.log, warn: console.warn, createCanvas, encodePng,
    replayClientSrc: readReplayClientSrc(), fontFaceCss: buildFontFaceCss(), assetMap,
    sha256: nodeDeps.sha256,
  });

  console.log(`\nReport written to ${config.outputDir}/`);
  console.log(`  Open ${config.outputDir}/index.html to review`);

  const update = await updateCheck;
  if (update && update.updateAvailable) {
    console.log(`\n${formatUpdateNotice(VERSION, update.latest)}`);
  }
}
