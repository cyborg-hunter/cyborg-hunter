#!/usr/bin/env node
// Sync the conformance package's validator into CH's shipped tree.
//
// Why this exists: `src/shared/schema-v2-validator.js` is imported by shipped
// code (`src/cli/ingest.js`, `tools/convert/jspsych-v1-to-v2.mjs`), so it must
// resolve from the published `cyborg-hunter` tarball. A `file:` workspace
// import cannot: npm's `files` list cannot pull a sibling workspace in, and the
// package is not on the registry yet. So the package stays the single source of
// truth and CH ships a *generated* verbatim copy, kept honest by
// `tests/cli/conformance-sync.test.js` (byte comparison, fails on drift).
//
// Usage: node scripts/sync-conformance.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Each entry: the package source of truth, and the shipped copy generated from it.
export const SYNCED = [
  {
    source: join(ROOT, 'packages', 'sessionrecording-conformance', 'src', 'validator.js'),
    target: join(ROOT, 'src', 'shared', 'schema-v2-validator.js'),
    sourceLabel: 'packages/sessionrecording-conformance/src/validator.js',
  },
];

// The header is prepended verbatim; everything after it must equal the source
// byte for byte, which is what the sync test asserts.
export function header(sourceLabel) {
  return `// GENERATED from ${sourceLabel} — do not edit; run npm run sync:conformance\n`
    + '//\n'
    + '// The conformance package is the source of truth. CH ships this copy so the\n'
    + '// published tarball can validate without resolving a workspace package.\n\n';
}

export function render(entry) {
  return header(entry.sourceLabel) + readFileSync(entry.source, 'utf8');
}

export function currentTarget(entry) {
  try {
    return readFileSync(entry.target, 'utf8');
  } catch {
    return null;
  }
}

function main() {
  const check = process.argv.includes('--check');
  let drift = 0;
  for (const entry of SYNCED) {
    const want = render(entry);
    const have = currentTarget(entry);
    if (have === want) continue;
    drift += 1;
    if (check) {
      console.error(`out of sync: ${entry.target} (edit ${entry.sourceLabel}, then run npm run sync:conformance)`);
    } else {
      writeFileSync(entry.target, want);
      console.log(`synced ${entry.target} from ${entry.sourceLabel}`);
    }
  }
  if (check && drift) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
