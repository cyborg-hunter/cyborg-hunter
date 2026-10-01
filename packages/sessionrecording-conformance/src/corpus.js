// The corpus: fixtures + their expectations twins, and where they live on disk.
//
// Enrollment is BY EXISTENCE — a fixture joins the corpus by being written to
// `fixtures/`, with no registry to update — so the only thing that can be said
// about the set of fixtures has to be computed from the directory. That is what
// this module does, and it is deliberately the whole of it: the pipeline
// (`pipeline.js`) says what happens to one fixture's bytes, this says which
// bytes there are.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** Absolute path of the fixtures directory. */
export const FIXTURES_DIR = join(ROOT, 'fixtures');
/** Absolute path of the expectations directory. */
export const EXPECTATIONS_DIR = join(ROOT, 'expectations');

/** The same two, as directory URLs (trailing slash), for `new URL(name, …)`. */
export const FIXTURES_URL = new URL('../fixtures/', import.meta.url);
export const EXPECTATIONS_URL = new URL('../expectations/', import.meta.url);

/**
 * A `.json.gz` fixture is the §10 detection path exercised as a FILE rather
 * than as a round-trip in memory, and its expectations twin drops the `.gz`:
 * `negative-corrupt-gzip.json.gz` is answered by
 * `expectations/negative-corrupt-gzip.json`.
 */
export const expNameFor = (file) => (file.endsWith('.gz') ? file.slice(0, -'.gz'.length) : file);

/** Every fixture file name, compressed or not, in readdir order. */
export function fixtureNames() {
  return readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json') || f.endsWith('.json.gz'));
}

/** Every expectations file name. */
export function expectationNames() {
  return readdirSync(EXPECTATIONS_DIR).filter((f) => f.endsWith('.json'));
}

/** One fixture's raw bytes. */
export function readFixture(file) {
  return readFileSync(join(FIXTURES_DIR, file));
}

/** One expectations file, parsed. */
export function readExpectations(file) {
  return JSON.parse(readFileSync(join(EXPECTATIONS_DIR, file), 'utf8'));
}

/**
 * The whole corpus, paired up: every fixture with the expectations twin that
 * answers for it.
 * @returns {{file: string, expFile: string, bytes: Buffer, expectations: object}[]}
 */
export function loadCorpus() {
  return fixtureNames().map((file) => {
    const expFile = expNameFor(file);
    return { file, expFile, bytes: readFixture(file), expectations: readExpectations(expFile) };
  });
}

/**
 * Every expectations file, parsed, INCLUDING ones whose fixture twin is
 * missing. `loadCorpus` walks from the fixtures; the corpus-level checks walk
 * from the expectations, and the difference between the two walks is exactly
 * what `enrollmentProblems` reports.
 */
export function loadExpectations() {
  return expectationNames().map((file) => ({ file, exp: readExpectations(file) }));
}

/**
 * Enrollment sanity, as a list of findings.
 *
 * Enrolling by existence is what makes a new fixture free, and it is also the
 * failure mode with no symptom: an empty `fixtures/` leaves a green suite that
 * asserts nothing, and an expectations file whose twin was renamed or deleted
 * simply stops being read. Neither shows up as a failing test anywhere else.
 *
 * @returns {string[]} empty when the corpus is well-formed
 */
export function enrollmentProblems() {
  const problems = [];
  const fixtures = fixtureNames();
  if (fixtures.length === 0) {
    problems.push('fixtures/ holds no *.json — the conformance suite would pass vacuously');
  }
  // The one collision enrollment-by-existence admits is a `.json` and a
  // `.json.gz` fixture sharing a stem: both would answer to one expectations
  // file, and readdir order would decide which. Reported rather than resolved.
  const claimed = new Map();
  for (const f of fixtures) {
    const name = expNameFor(f);
    if (claimed.has(name)) {
      problems.push(`fixtures/${f} and fixtures/${claimed.get(name)} both map to expectations/${name} — ` +
        `one of them would be checked against the other's expectations`);
    }
    claimed.set(name, f);
  }
  for (const e of expectationNames()) {
    if (!claimed.has(e)) {
      problems.push(`expectations/${e} has no fixture twin — it is being silently skipped`);
    }
  }
  return problems;
}

/**
 * The invariants no fixture makes FAIL. An invariant only ever run against
 * conforming files is an assertion nobody has watched fail; the `negative-*`
 * set exists so each one has a witness, and this is what notices when a new
 * invariant lands without one.
 */
export function unwitnessedInvariants(invariantNames) {
  const witnessed = new Set();
  for (const { exp } of loadExpectations()) {
    for (const name of Object.keys(exp.expected_failures ?? {})) witnessed.add(name);
  }
  return invariantNames.filter((n) => !witnessed.has(n));
}

/** Every `perf_frame` the corpus declares, one per expectations file. */
export function declaredPerfFrames() {
  return loadExpectations().map(({ exp }) => exp.perf_frame);
}
