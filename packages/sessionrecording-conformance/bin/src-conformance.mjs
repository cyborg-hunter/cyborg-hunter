#!/usr/bin/env node
// src-conformance — run the SessionRecording v2 conformance corpus, or check
// one recording, from a shell.
//
// The suites this drives are the SAME ones `npm test` runs: both registrars
// take a `test` function, and the collector below is the whole of what makes
// this a CLI rather than a fourth implementation of the corpus. A bin that
// re-checked the fixtures its own way would be one more thing to keep in step.

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { runPipeline } from '../src/pipeline.js';
import { INVARIANT_NAMES } from '../src/invariants.js';
import { registerWireConformanceSuite, registerCheckpointSuite } from '../src/suite.js';

const USAGE = `src-conformance — SessionRecording v2 conformance

  src-conformance check <file> [--expect <expectations.json>]
      Put one recording through the five stages (gunzip, parse, tolerant,
      strict, corpus) and report where it came out. Exits 0 when the file
      loads AND is strict-valid. With --expect, the whole-recording
      invariants run too — several of them read declarations off the
      expectations twin and cannot be checked without one.

  src-conformance corpus
      Run the wire-level battery over the packaged corpus. No player needed.

  src-conformance corpus --adapter <module>
      Also run the reconstruction-level battery — the corpus's \`checkpoints\`
      arrays — through YOUR player. <module> is a path or specifier whose
      default export (or \`adapter\` / \`conformanceAdapter\` export) satisfies
      the contract in src/adapter.js.

Exit codes: 0 all checks passed · 1 a check failed · 2 bad usage.
`;

/** A node:test-shaped registrar that runs each test immediately and collects. */
function collector() {
  const failures = [];
  let passed = 0;
  const test = (name, fn) => {
    try { fn(); passed++; } catch (e) { failures.push({ name, error: e }); }
  };
  return { test, failures, passed: () => passed };
}

function report(c, what) {
  for (const { name, error } of c.failures) {
    console.error(`\n✖ ${name}\n  ${String(error.message).split('\n').join('\n  ')}`);
  }
  const n = c.passed() + c.failures.length;
  console.log(`\n${what}: ${c.passed()}/${n} passed${c.failures.length ? `, ${c.failures.length} FAILED` : ''}`);
  return c.failures.length === 0;
}

async function loadAdapter(spec) {
  // "a path or specifier" has to mean it. `--adapter test/stub.mjs` is what a
  // shell's tab-completion produces, and reading it as a bare specifier ended
  // in an uncaught ERR_MODULE_NOT_FOUND about a package nobody named. Existing
  // on disk decides it first, so `@scope/pkg/adapter.js` — a separator but no
  // file — still resolves as the package specifier it is.
  const isPath = existsSync(spec) || /^[./]|^[a-zA-Z]:[\\/]/.test(spec);
  const url = isPath ? pathToFileURL(resolve(spec)).href : spec;
  const mod = await import(url);
  const adapter = mod.default ?? mod.adapter ?? mod.conformanceAdapter;
  if (!adapter || typeof adapter.boot !== 'function') {
    throw new Error(`${spec} exports no conformance adapter — expected a default (or \`adapter\`) ` +
      `export with a boot(recording) function; see src/adapter.js`);
  }
  return adapter;
}

function cmdCheck(argv) {
  const file = argv[0];
  if (!file) { console.error(USAGE); return 2; }
  const i = argv.indexOf('--expect');
  // `--expect` with nothing after it is a usage error (exit 2), not a stack
  // trace out of readFileSync(undefined).
  if (i !== -1 && !argv[i + 1]) {
    console.error('--expect needs a path to an expectations JSON file\n');
    console.error(USAGE);
    return 2;
  }
  const exp = i === -1 ? null : JSON.parse(readFileSync(argv[i + 1], 'utf8'));

  const res = runPipeline(readFileSync(file), exp ?? {});
  if (res.stage) {
    console.error(`✖ refused at "${res.stage}": ${res.error}`);
    return 1;
  }
  console.log(`✔ loads (tolerant profile)${res.loaded.warnings.length ? '' : ', with no warnings'}`);
  for (const w of res.loaded.warnings) console.log(`  ! ${w}`);

  const segs = res.rec.segments.length;
  const events = res.rec.segments.reduce((n, s) => n + s.events.length, 0);
  console.log(`  ${segs} segment(s), ${events} event(s), ` +
    `${res.rec.segments.filter((s) => s.initial_dom != null).length} keyframe(s)`);

  let ok = true;
  if (res.strict.ok) {
    console.log('✔ strict-valid (conformance profile)');
  } else {
    ok = false;
    console.error(`✖ strict-invalid, ${res.strict.errors.length} error(s):`);
    for (const e of res.strict.errors) console.error(`  - ${e}`);
  }

  // The invariants read declarations off the expectations twin (`perf_frame`,
  // `expect_leak`, the leak scan's own strings), so without one they would
  // report failures that are missing DECLARATIONS rather than defects.
  if (exp) {
    const failed = Object.entries(res.invariantFailures ?? {});
    if (failed.length === 0) {
      console.log(`✔ all ${INVARIANT_NAMES.length} whole-recording invariants hold`);
    } else {
      ok = false;
      console.error(`✖ ${failed.length} invariant(s) failed:`);
      for (const [name, msg] of failed) console.error(`  - ${name}: ${msg}`);
    }
  } else {
    console.log('· whole-recording invariants skipped (pass --expect <expectations.json> to run them)');
  }
  return ok ? 0 : 1;
}

async function cmdCorpus(argv) {
  const i = argv.indexOf('--adapter');
  if (i !== -1 && !argv[i + 1]) { console.error(USAGE); return 2; }

  const wire = collector();
  registerWireConformanceSuite({ test: wire.test });
  let ok = report(wire, 'wire-level corpus');

  if (i !== -1) {
    const adapter = await loadAdapter(argv[i + 1]);
    const cp = collector();
    registerCheckpointSuite({ adapter, test: cp.test });
    ok = report(cp, 'reconstruction-level corpus') && ok;
  }
  return ok ? 0 : 1;
}

const [cmd, ...rest] = process.argv.slice(2);
let code = 2;
if (cmd === 'check') code = cmdCheck(rest);
else if (cmd === 'corpus') code = await cmdCorpus(rest);
else console.error(USAGE);
process.exit(code);
