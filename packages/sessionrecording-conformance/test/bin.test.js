// The CLI, driven as a subprocess.
//
// It is checked here rather than by calling its functions because what a CI job
// consumes is the EXIT CODE, and an exit code is the one thing an in-process
// test cannot observe. Every assertion below is on `status` first and on the
// output second.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { FIXTURES_DIR, EXPECTATIONS_DIR } from '../src/corpus.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'src-conformance.mjs');
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
const fixture = (n) => join(FIXTURES_DIR, n);
const expectations = (n) => join(EXPECTATIONS_DIR, n);

test('corpus runs the wire-level battery and exits 0', () => {
  const r = run('corpus');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wire-level corpus: \d+\/\d+ passed/);
  assert.doesNotMatch(r.stdout, /FAILED/);
});

test('corpus --adapter runs the reconstruction battery through a supplied player', () => {
  // A stub player, written out to a temp module: enough to satisfy the contract
  // and reconstruct nothing, so what this checks is the WIRING — that the CLI
  // imports an adapter, hands it to the checkpoint suite, and reports its
  // failures. A real player's agreement with the corpus is what CH's and the
  // fork's own suites answer.
  const dir = mkdtempSync(join(tmpdir(), 'src-conformance-'));
  const mod = join(dir, 'stub-adapter.mjs');
  writeFileSync(mod, `
    export default {
      boot() {
        return {
          segments: [],
          selectSegment() {}, seekTo() {}, getSegment: () => 0, getPlayhead: () => 0,
          resolveNode: () => null, isConnected: () => false,
          readProp() { throw new Error('stub'); }, dispose() {},
        };
      },
    };
  `);
  const r = run('corpus', '--adapter', mod);
  // The stub reconstructs nothing, so every checkpoint must FAIL — and that is
  // the assertion: a CLI that silently ran zero checkpoints would exit 0 here.
  assert.equal(r.status, 1);
  assert.match(r.stdout, /reconstruction-level corpus: \d+\/\d+ passed, \d+ FAILED/);
  assert.match(r.stderr, /names segment 0, but the recording has 0 segment\(s\)/);
});

test('corpus --adapter refuses a module that exports no adapter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'src-conformance-'));
  const mod = join(dir, 'not-an-adapter.mjs');
  writeFileSync(mod, 'export const something = 1;\n');
  const r = run('corpus', '--adapter', mod);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /exports no conformance adapter/);
});

test('--adapter accepts a relative path with no leading "./"', () => {
  // The usage line says "a path or specifier", and a shell's tab-completion
  // writes `test/stub.mjs`. Read as a bare specifier that died with an uncaught
  // ERR_MODULE_NOT_FOUND naming a package the caller never typed.
  const dir = mkdtempSync(join(tmpdir(), 'src-conformance-'));
  const mod = join(dir, 'not-an-adapter.mjs');
  writeFileSync(mod, 'export const something = 1;\n');
  const bare = relative(dir, mod); // "not-an-adapter.mjs" — no ./, no separator
  const r = spawnSync(process.execPath, [BIN, 'corpus', '--adapter', bare],
    { encoding: 'utf8', cwd: dir });
  // Refused for the right reason: found and read first, then judged.
  assert.match(r.stderr, /exports no conformance adapter/);
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND/);
});

test('--expect with no value is a usage error, exit 2', () => {
  const r = run('check', fixture('canonical-core.json'), '--expect');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--expect needs a path/);
  assert.doesNotMatch(r.stderr, /readFileSync/);
});

test('check reports a clean recording and exits 0', () => {
  const r = run('check', fixture('canonical-core.json'), '--expect', expectations('canonical-core.json'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✔ loads \(tolerant profile\), with no warnings/);
  assert.match(r.stdout, /3 segment\(s\), 14 event\(s\), 2 keyframe\(s\)/);
  assert.match(r.stdout, /✔ strict-valid/);
  assert.match(r.stdout, /✔ all 9 whole-recording invariants hold/);
});

test('check names the stage that refused a file, and exits 1', () => {
  const r = run('check', fixture('negative-not-json.json'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refused at "parse": invalid JSON/);
});

test('check exits 1 on a strict-invalid recording and itemises why', () => {
  const r = run('check', fixture('negative-index-mismatch.json'));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✔ loads/);
  assert.match(r.stderr, /strict-invalid/);
  assert.match(r.stderr, /index \(5\) must equal array position 1/);
});

test('check without --expect says the invariants were skipped rather than passing them', () => {
  // Several invariants read declarations off the expectations twin, so running
  // them without one would report missing DECLARATIONS as defects. Saying so is
  // what stops a producer reading a clean run as a full one.
  const r = run('check', fixture('canonical-core.json'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /invariants skipped \(pass --expect/);
});

test('check surfaces a tolerant load\'s warnings', () => {
  const r = run('check', fixture('warn-missing-advisory.json'));
  assert.match(r.stdout, /! missing advisory field: user_agent/);
});

test('no command, and an unknown one, print usage and exit 2', () => {
  for (const args of [[], ['wat'], ['check']]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${JSON.stringify(args)} did not exit 2`);
    assert.match(r.stderr, /src-conformance — SessionRecording v2 conformance/);
  }
});
