// src/cli/config.js
// Loads and merges config from: defaults → config file → CLI args.
//
// Resolution order (later wins):
//   1. DEFAULT_CLI_CONFIG from schema.js — sensible fallbacks
//   2. cyborg-hunter.config.json (or --config path) — project-specific
//   3. CLI flags (--data, --output, etc.) — ad-hoc overrides

import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { mergeConfig, cliConfigWarnings } from './config-core.js';

// Load-bearing re-export: tests import cliConfigWarnings from this file.
export { cliConfigWarnings };

export function loadConfig(cliArgs) {
  // Parse CLI flags into a simple key-value object
  const flags = parseFlags(cliArgs);

  // Load config file (default: cyborg-hunter.config.json in cwd)
  const configPath = flags.config || join(process.cwd(), 'cyborg-hunter.config.json');
  let fileConfig = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      console.log(`Loaded config from ${configPath}`);
    } catch (e) {
      console.warn(`[cyborg-hunter] failed to parse ${configPath}: ${e.message}`);
    }
  }

  // Merge: defaults ← file config ← CLI flags. The warnings are computed on
  // the file layer (config-core.js); no flag sets a key they check.
  const { config, warnings } = mergeConfig(fileConfig);
  if (flags.data) config.dataDir = flags.data;
  if (flags.output) config.outputDir = flags.output;
  if (flags.participant) config.singleParticipant = flags.participant;
  if (flags.participantIdField) config.participantIdField = flags.participantIdField;
  if (flags.assetsDir) config.assetsDir = flags.assetsDir;
  if (flags.filePattern) config.filePattern = flags.filePattern;
  if (flags.integrityField) config.integrityField = flags.integrityField;
  if (flags.sessionIntegrityPath) config.sessionIntegrityPath = flags.sessionIntegrityPath;
  if (flags.qualtricsField) config.qualtricsField = flags.qualtricsField;
  if (flags['no-visuals']) config.noVisuals = true;

  // Resolve relative paths to absolute (relative to cwd)
  config.dataDir = resolve(config.dataDir);
  config.outputDir = resolve(config.outputDir);
  if (config.assetsDir) config.assetsDir = resolve(config.assetsDir);

  // Config file key typos first, then config VALUES that would otherwise
  // silently mis-score (a non-numeric softScoreThreshold coerces every
  // `score >= threshold` to false, disabling soft flagging with no error).
  warnings.forEach(w => console.warn(`[cyborg-hunter] ${w}`));

  return config;
}

// Parses CLI arguments into a flags object.
//
// Supported flags (kebab-case aliases match the camelCase config keys, so
// you can use whichever form you remember):
//   --config, --config-file <path> # alternate config file path
//   --data,    --data-dir <path>   # config.dataDir
//   --output,  --output-dir <path> # config.outputDir
//   --participant <id>             # filter to single participant
//   --participant-id-field <name>  # config.participantIdField
//   --file-pattern <glob>          # config.filePattern
//   --integrity-field <name>       # config.integrityField
//   --session-integrity-path <p>   # config.sessionIntegrityPath (dotted)
//   --qualtrics-field <name>       # config.qualtricsField
//   --assets-dir <path>            # config.assetsDir
//   --no-visuals                   # skip canvas-rendered images
//
// Throws on unknown flags. Earlier behavior was to print a warning and keep
// going, which silently masked typos and caused the CLI to fall back to a
// completely different config file than the user intended.
export function parseFlags(args) {
  const flags = {};
  // Single-arg flags map alias → flags key. The flags key is the camelCase
  // form so loadConfig can look it up directly.
  const SINGLE_VALUE = {
    '--config': 'config',
    '--config-file': 'config',
    '--data': 'data',
    '--data-dir': 'data',
    '--output': 'output',
    '--output-dir': 'output',
    '--participant': 'participant',
    '--participant-id-field': 'participantIdField',
    '--file-pattern': 'filePattern',
    '--integrity-field': 'integrityField',
    '--session-integrity-path': 'sessionIntegrityPath',
    '--qualtrics-field': 'qualtricsField',
    '--assets-dir': 'assetsDir',
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SINGLE_VALUE[a] && args[i+1] !== undefined) {
      flags[SINGLE_VALUE[a]] = args[++i];
    } else if (a === '--no-visuals') {
      flags['no-visuals'] = true;
    } else if (a === 'report') {
      // Subcommand keyword; the dispatcher in bin/cyborg-hunter.js already
      // routed on this. Skip rather than treating it as unknown.
    } else {
      throw new Error(
        `Unknown argument: ${a}\n` +
        `  Run \`cyborg-hunter --help\` for the full flag list.`
      );
    }
  }
  return flags;
}
