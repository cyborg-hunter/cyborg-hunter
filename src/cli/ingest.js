// Node shell of the ingest step: file discovery and fs-backed lazy readers.
// Everything that reads bytes and decides what they are lives in
// ingest-core.js, which the browser page runs unchanged over dropped files.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { gunzipSync } from 'zlib';
import { createHash } from 'crypto';
import { getByPath } from '../shared/paths.js';
import { extractIntegrityData, ruleChronologicalCompare } from './extract-core.js';
import { ingestFiles, migrateArtifact, expandPatternToMatchers } from './ingest-core.js';

// The two platform steps the core takes injected. Node's own gunzip keeps
// its error messages, which reach the analyst inside "could not be read"
// warnings.
export const nodeDeps = {
  gunzip: async (bytes) => new Uint8Array(gunzipSync(bytes)),
  sha256: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
};

// A lazy reader over one path. Nothing is read until read() is called, so a
// directory of dom-tier recordings is still loaded one artifact at a time.
// `size` is lazy too: listing a directory must not touch its entries, or one
// unreadable entry (a dangling symlink) would fail the whole listing instead
// of earning its own warning when the pass that wants it calls read().
export function fsReader(path) {
  return { name: basename(path), path,
    get size() { return statSync(path).size; },
    read: async () => new Uint8Array(readFileSync(path)) };
}

export async function ingest(config) {
  const participantFiles = findFiles(config.dataDir, config.filePattern).map(fsReader);
  const dir = config.replayDir || config.dataDir;
  let replayFiles = [];
  let replayDirError = null;
  try { replayFiles = readdirSync(dir).map((f) => fsReader(join(dir, f))); }
  catch (e) { replayDirError = e.message; }
  return ingestFiles({ participantFiles, replayFiles }, config, { ...nodeDeps, replayDirError });
}

// Load-bearing re-exports:
//   - getByPath: html-index.js (and external adopters) import it from ingest.js.
//   - extractIntegrityData, ruleChronologicalCompare: moved to extract-core.js
//     (0.7.2 extraction — pure/no Node APIs so a browser demo can bundle it);
//     this file re-exports both for existing callers — trajectories.js imports
//     ruleChronologicalCompare from here, and tests/cli/*.test.js import
//     extractIntegrityData from here.
//   - migrateArtifact: moved to ingest-core.js; tests import it from here.
export { getByPath };
export { extractIntegrityData, ruleChronologicalCompare };
export { migrateArtifact };

// Finds files matching a glob pattern in the given directory.
// Supports:
//   - `*.json`         (default, broadened to also match `*.csv`)
//   - `*.csv`          (CSV-only)
//   - `*.{json,csv}`   (explicit brace expansion)
//   - `gallery_*.json` (other simple wildcard patterns)
//
// The default `*.json` is broadened to JSON-or-CSV because jsPsych's `.csv()`
// save is the most common shape we'll see in the wild; users on JSON pipelines
// are unaffected.
function findFiles(dir, pattern) {
  const matchers = expandPatternToMatchers(pattern);
  const files = readdirSync(dir).filter(f => matchers.some(m => m.test(f)));
  return files.map(f => join(dir, f)).sort();
}
