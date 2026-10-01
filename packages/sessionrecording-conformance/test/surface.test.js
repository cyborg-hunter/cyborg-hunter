// The package's public surface, asserted from the OUTSIDE.
//
// Every import here goes through the package NAME, never a relative path, so
// what this suite checks is the thing a consumer actually gets: the `exports`
// map. A subpath that is not listed there resolves for a relative importer and
// throws for everyone else, which is the failure mode a same-directory test
// cannot see — and the one that would greet the fork the first time it installs
// this package.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';

import * as barrel from '@cyborg-hunter/sessionrecording-conformance';
import { detectGzip, validateTolerant, validateStrict, REDACTABLE_TYPES }
  from '@cyborg-hunter/sessionrecording-conformance/validator';
import { INVARIANT_CHECKS, INVARIANT_NAMES, PRIVACY_INVARIANTS, REDACTED_SHAPES }
  from '@cyborg-hunter/sessionrecording-conformance/invariants';
import {
  FIXTURES_DIR, EXPECTATIONS_DIR, FIXTURES_URL, EXPECTATIONS_URL,
  expNameFor, fixtureNames, expectationNames, readFixture, readExpectations,
} from '@cyborg-hunter/sessionrecording-conformance/corpus';
import { createPlayer, readTree, asPlayerTree }
  from '@cyborg-hunter/sessionrecording-conformance/fuzz/dom-player';
import { MIXES, SEEDS, generateSession }
  from '@cyborg-hunter/sessionrecording-conformance/fuzz/mutation-fuzz';

test('the validator subpath exports both profiles and the §8 type table', () => {
  assert.equal(typeof detectGzip, 'function');
  assert.equal(typeof validateTolerant, 'function');
  assert.equal(typeof validateStrict, 'function');
  assert.ok(REDACTABLE_TYPES instanceof Set);
  assert.ok(REDACTABLE_TYPES.size > 0);
});

test('the invariants subpath exports the whole table, named', () => {
  assert.ok(INVARIANT_NAMES.length > 0);
  assert.deepEqual(INVARIANT_NAMES, Object.keys(INVARIANT_CHECKS));
  for (const n of INVARIANT_NAMES) assert.equal(typeof INVARIANT_CHECKS[n], 'function');
  // The privacy subset has to BE a subset, or the conformance runner's
  // deliberate-leak declaration is keyed on names nothing runs.
  for (const n of PRIVACY_INVARIANTS) assert.ok(INVARIANT_NAMES.includes(n), `${n} is not an invariant`);
  assert.ok(Object.keys(REDACTED_SHAPES).length > 0);
});

test('the corpus subpath points at fixtures and expectations that are on disk', () => {
  for (const d of [FIXTURES_DIR, EXPECTATIONS_DIR]) {
    assert.ok(existsSync(d) && statSync(d).isDirectory(), `${d} is not a directory`);
  }
  assert.ok(fixtureNames().length > 0, 'the corpus holds no fixtures');
  assert.ok(expectationNames().length > 0, 'the corpus holds no expectations');
  // The URL forms must name the same directories as the path forms; two ways
  // of saying where the corpus is are two ways of drifting.
  assert.equal(FIXTURES_URL.pathname.replace(/\/$/, ''), encodeURI(FIXTURES_DIR).replace(/\/$/, ''));
  assert.equal(EXPECTATIONS_URL.pathname.replace(/\/$/, ''), encodeURI(EXPECTATIONS_DIR).replace(/\/$/, ''));
});

test('expNameFor drops a .gz and leaves a plain .json alone', () => {
  assert.equal(expNameFor('negative-corrupt-gzip.json.gz'), 'negative-corrupt-gzip.json');
  assert.equal(expNameFor('canonical-core.json'), 'canonical-core.json');
});

test('readFixture and readExpectations reach a real corpus entry', () => {
  const bytes = readFixture('canonical-core.json');
  assert.ok(bytes.length > 0);
  assert.equal(detectGzip(bytes), false);
  assert.equal(validateStrict(bytes.toString('utf8')).ok, true,
    'canonical-core is the corpus\'s minimal strict-valid recording');
  assert.equal(readExpectations('canonical-core.json').fixture, 'canonical-core.json');
});

test('the fuzz subpaths export the differential oracle', () => {
  assert.equal(typeof createPlayer, 'function');
  assert.equal(typeof readTree, 'function');
  assert.equal(typeof asPlayerTree, 'function');
  assert.ok(Object.keys(MIXES).length > 0);
  assert.ok(SEEDS.length > 0);
});

test('generateSession names the producer symbols a caller failed to supply', () => {
  // The capture path is injected precisely so this package holds no
  // producer. A caller who forgets it must be told what to pass, not handed a
  // `mapMutations is not a function` from inside the loop.
  assert.throws(() => generateSession({ mix: 'all ops', seed: 1 }),
    /`capture` is required/);
  assert.throws(() => generateSession({ mix: 'all ops', seed: 1, capture: { mapMutations() {} } }),
    /missing MUTATION_OBSERVER_INIT, serializeTree, createSpan, createDelivery/);
});

test('the barrel re-exports every subpath symbol under one import', () => {
  for (const name of ['detectGzip', 'validateTolerant', 'validateStrict', 'REDACTABLE_TYPES',
    'INVARIANT_CHECKS', 'INVARIANT_NAMES', 'PRIVACY_INVARIANTS', 'REDACTED_SHAPES',
    'FIXTURES_DIR', 'EXPECTATIONS_DIR', 'fixtureNames', 'readFixture']) {
    assert.ok(name in barrel, `the package barrel does not export ${name}`);
  }
});
