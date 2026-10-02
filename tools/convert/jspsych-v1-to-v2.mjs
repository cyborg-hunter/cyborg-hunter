// tools/convert/jspsych-v1-to-v2.mjs
//
// jsPsych `schema_version: 1` SessionRecording → SessionRecording v2
// (docs/session-recording-v2.md, §14 migration).
// This tool IS the migration path: players stay v2-only, there is no dual-read,
// and there is no v2 → v1 direction.
//
// v1 source of truth: the fork's pre-flip `src/schema/types.ts`
//   git -C <jspsych-replay-fork> show 06dfa08~1:src/schema/types.ts
// itself copied from jspsych/jsPsych packages/jspsych/src/modules/recording.ts.
//
// The mapping, every refusal and the canonical hash text live in
// `convert-core.mjs`, which imports nothing so a browser can run it too. This
// file is the Node shell around it: it supplies the hash (`node:crypto`), keeps
// the sync `convertRecording(input)` the CLI and the golden tests call, and
// owns the CLI below.
//
// Packaging: `convertRecording` has no dependency outside node: builtins and
// its sibling `convert-core.mjs`, and runs from a bare copy of the two files.
// The CLI additionally validates its output against the in-repo schema-v2
// validator, which it imports lazily, so a missing `tests/` directory costs the
// CLI its output gate and costs the pure function nothing. (`validator.js:2`
// says that file lifts into a shared package one day; when it moves, only the
// dynamic specifier below needs updating.)
//
// Usage:
//   node tools/convert/jspsych-v1-to-v2.mjs <v1.json> --stdout
//   node tools/convert/jspsych-v1-to-v2.mjs <v1.json> --out <v2.json>
//   cat v1.json | node tools/convert/jspsych-v1-to-v2.mjs --stdout
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareConversion, CONVERTER_VERSION } from './convert-core.mjs';
export { CONVERTER_VERSION };

const VALIDATOR_SPECIFIER = '../../src/shared/schema-v2-validator.js';

const CONVERTER_TOOL = 'jspsych-v1-to-v2';

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Sync, Node-only form: the CLI below and the golden tests call it directly.
// The browser path uses convert-core.mjs's async form with crypto.subtle.
export function convertRecording(input) {
  const prep = prepareConversion(input);
  return prep.build(sha256(prep.canonicalText));
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `Usage: node tools/convert/jspsych-v1-to-v2.mjs [<v1.json>] [--stdout | --out <v2.json>]

  <v1.json>           input path; "-" or omitted reads stdin
  --stdout            write the converted recording to stdout (the default)
  --out, -o <path>    write it to a file instead
  --help, -h          this message

Converts a jsPsych schema_version:1 SessionRecording to SessionRecording v2.
Refuses anything that is not exactly v1-shaped, and refuses to emit output that
fails schema-v2 strict validation. Absent stylesheets/stylesheet_events are the
one exception: they backfill to [] and say so in the provenance stamp.`;

// writeSync on fd 2 rather than process.stderr.write: on macOS a piped stderr
// is asynchronous, so an immediate process.exit() can truncate the very message
// that explains the refusal.
function die(message) {
  writeSync(2, message + '\n');
  process.exit(1);
}

async function main(argv) {
  let inputPath = null;
  let outPath = null;
  let explicitStdout = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE + '\n');
      return;
    } else if (arg === '--stdout') {
      explicitStdout = true;
    } else if (arg === '--out' || arg === '-o') {
      outPath = argv[++i];
      if (outPath === undefined) die(`${CONVERTER_TOOL}: --out needs a path\n\n${USAGE}`);
    } else if (arg.startsWith('-') && arg !== '-') {
      die(`${CONVERTER_TOOL}: unknown option "${arg}"\n\n${USAGE}`);
    } else if (inputPath === null) {
      inputPath = arg;
    } else {
      die(`${CONVERTER_TOOL}: more than one input path given\n\n${USAGE}`);
    }
  }
  if (explicitStdout && outPath !== null) {
    die(`${CONVERTER_TOOL}: --stdout and --out are mutually exclusive`);
  }

  // fd 0 covers both the piped and the redirected case; "-" is the conventional
  // spelling of "stdin" when a path would otherwise be expected.
  const source = inputPath === null || inputPath === '-' ? 0 : inputPath;
  let raw;
  try {
    raw = readFileSync(source, 'utf8');
  } catch (e) {
    die(`${CONVERTER_TOOL}: cannot read ${inputPath ?? 'stdin'}: ${e.message}`);
  }

  let v1;
  try {
    v1 = JSON.parse(raw);
  } catch (e) {
    die(`${CONVERTER_TOOL}: input is not valid JSON: ${e.message}`);
  }

  let v2;
  try {
    v2 = convertRecording(v1);
  } catch (e) {
    die(e.message);
  }

  // The design's validation duty: a converted file that does not strict-validate
  // is not a v2 recording, so it never reaches disk or a pipe. Imported here
  // rather than at module scope so `convertRecording` never loads it (M1).
  let validateStrict;
  try {
    ({ validateStrict } = await import(VALIDATOR_SPECIFIER));
  } catch (e) {
    die(
      `${CONVERTER_TOOL}: cannot load the schema-v2 validator (${VALIDATOR_SPECIFIER}): ` +
      `${e.message}\nThe CLI strict-validates its ` +
      `own output; the exported convertRecording() has no such dependency.`
    );
  }
  const verdict = validateStrict(v2);
  if (!verdict.ok) {
    die(
      `${CONVERTER_TOOL}: converted output failed schema-v2 strict validation ` +
      `(${verdict.errors.length} error${verdict.errors.length === 1 ? '' : 's'}):\n` +
      verdict.errors.map(e => '  - ' + e).join('\n')
    );
  }

  const text = JSON.stringify(v2, null, 2) + '\n';
  if (outPath !== null) {
    writeFileSync(outPath, text);
    // Progress chatter goes to stderr so stdout carries recordings and nothing
    // else, whichever output mode is in use.
    process.stderr.write(`Wrote ${outPath}\n`);
  } else {
    process.stdout.write(text);
  }
}

// Runs only when this file is the entry point (not on import from the test).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => die(`${CONVERTER_TOOL}: ${e.stack ?? e.message}`));
}
