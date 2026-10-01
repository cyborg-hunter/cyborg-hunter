// The JSON Schema and the strict validator, held to the same verdict on every
// corpus fixture that reaches the strict stage.
//
// WHY BOTH EXIST. `src/validator.js` is the reference: it is what CH's CI runs,
// what the corpus's `strict_valid` claims were authored against, and the only
// one of the two that can express an order or cross-element rule. The JSON
// Schema exists because a validator written in JavaScript is unusable to a
// producer in another language and unreadable as a contract — a schema file is
// what someone implementing v2 from scratch actually reads. Two statements of
// one format drift unless something compares them, and that is this file.
//
// THE DIRECTION OF AUTHORITY, and its limit. For ACCEPTANCE the validator is
// the reference: it is what CH's CI runs and what the corpus's `strict_valid`
// claims were authored against, so a schema that REFUSES a fixture the
// validator accepts is a schema bug, fixed here and never by loosening the
// validator. The rule does not run backwards. Where the schema is STRICTER on a
// shape the validator does not inspect, the finding is validator laxity to
// record and tighten, not a schema to relax. Two such shapes are known: a
// `key.*` `mods` given as an array and a `dom.add` `node` given as an array —
// the schema refuses both, `validator.js` (lines 437 and 327) admits both, and
// the spec (`docs/session-recording-v2.md:136`) sides with the schema. A
// single-point mutation probe over the strict-valid fixtures found exactly
// those two, which is also the measure of how far this file reaches: 24
// fixtures agreeing cannot tell a right schema from a wrong one on event types
// the corpus never mutates.
//
// THE FOUR RULES A JSON SCHEMA CANNOT STATE. Some of §11's strict profile is
// not about the shape of a value — it is about a value's relationship to its
// neighbours or its position. JSON Schema has no vocabulary for "this integer
// equals this element's index in its parent array" or "these timestamps
// ascend". Rather than pretend, each such rule is listed below with the fixture
// that witnesses it, and the assertion is EXHAUSTIVE IN BOTH DIRECTIONS: a new
// disagreement fails, and so does an entry whose fixture stopped disagreeing.
// A hand-maintained allowlist that only grew would eventually excuse a real
// schema bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateStrict } from '../src/validator.js';
import { runPipeline } from '../src/pipeline.js';
import { fixtureNames, expNameFor, readFixture, readExpectations } from '../src/corpus.js';
import { validateAgainstSchema } from './json-schema-subset.js';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'session-recording-v2.schema.json');
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

// The strict rules that live outside a field walk. Each names the fixture whose
// verdict the schema therefore cannot reproduce, and what the schema would need
// to be able to say.
const BEYOND_JSON_SCHEMA = {
  'negative-index-mismatch.json':
    '§7: a segment\'s `index` MUST equal its array position. JSON Schema cannot ' +
    'compare a value against its own position in the parent array.',
  'negative-segments-overlap.json':
    '§3: segments are non-overlapping (`t_end[n]` ≤ the next segment\'s origin). ' +
    'JSON Schema cannot compare one array element against the next.',
  'negative-unsorted-events.json':
    '§7: every event array is time-sorted. JSON Schema has no ordering vocabulary.',
  'negative-continuation-before-keyframe.json':
    '§3: a continuation carrying dom.* events before any keyframe. The rule is a ' +
    'property of the segments walked in order, not of any one segment.',
};

// The fixtures the pipeline actually carries as far as `strict`. A file refused
// at gunzip, parse or tolerant never becomes a recording, and asking a schema
// about it would be a claim about an object that was never built.
function strictReachingFixtures() {
  const out = [];
  for (const file of fixtureNames()) {
    const exp = readExpectations(expNameFor(file));
    const res = runPipeline(readFixture(file), exp);
    if (res.stage === null) out.push({ file, rec: res.rec, exp });
  }
  return out;
}

const REACHING = strictReachingFixtures();

test('the corpus reaches the strict stage with enough fixtures to be worth comparing', () => {
  // Guards the shape of every test below: if the pipeline started refusing
  // everything, each per-fixture assertion would vanish and this file would go
  // green while checking nothing.
  assert.ok(REACHING.length >= 20,
    `only ${REACHING.length} fixture(s) reach the strict stage — the equivalence check is nearly empty`);
  // And the corpus must still carry both verdicts, or "the two agree" is a
  // statement about accept alone.
  const verdicts = new Set(REACHING.map(({ exp }) => exp.strict_valid));
  assert.deepEqual([...verdicts].sort(), [false, true],
    'the strict-reaching corpus no longer carries both a valid and an invalid fixture');
});

for (const { file, rec, exp } of REACHING) {
  test(`schema ↔ validateStrict: ${file}`, () => {
    const strict = validateStrict(JSON.stringify(rec));
    const schema = validateAgainstSchema(SCHEMA, rec);

    // The validator is the reference, so its verdict is pinned to the corpus's
    // authored claim first. Without this the two could agree on a wrong answer.
    assert.equal(strict.ok, exp.strict_valid,
      `validateStrict disagrees with expectations/${expNameFor(file)}: ${JSON.stringify(strict.errors)}`);

    const excused = BEYOND_JSON_SCHEMA[file];
    if (excused) {
      // The excuse is only good for the direction it claims: the schema is
      // BLIND to the defect, which means it accepts a file the validator
      // refuses. A schema that rejected here would be rejecting for some other
      // reason, and the excuse would be covering it up.
      assert.equal(strict.ok, false, `${file} is listed as beyond JSON Schema but is strict-VALID`);
      assert.equal(schema.ok, true,
        `${file} is listed as beyond JSON Schema, but the schema refused it: ` +
        `${JSON.stringify(schema.errors)} — either the schema grew a rule that catches it ` +
        `(delete the entry) or it is refusing for the wrong reason`);
      return;
    }

    assert.equal(schema.ok, strict.ok,
      strict.ok
        ? `the schema refuses a strict-VALID fixture: ${JSON.stringify(schema.errors)}`
        : `the schema accepts a strict-INVALID fixture. validateStrict said: ` +
          `${JSON.stringify(strict.errors)}`);
  });
}

test('every BEYOND_JSON_SCHEMA entry names a fixture that reaches the strict stage', () => {
  // The other direction of exhaustiveness. An entry whose fixture was renamed
  // or removed is an excuse nothing exercises, and it would silently start
  // excusing whatever took the name.
  const reaching = new Set(REACHING.map((r) => r.file));
  const orphans = Object.keys(BEYOND_JSON_SCHEMA).filter((f) => !reaching.has(f));
  assert.deepEqual(orphans, [],
    `${orphans.join(', ')} is excused as beyond JSON Schema but no longer reaches the strict stage`);
});

test('the schema interprets only keywords the walker implements', () => {
  // The walker throws on an unrecognised keyword rather than ignoring it, so
  // this passes exactly when every keyword in the schema is actually checked.
  // A schema rule expressed with `oneOf` or `minItems` would otherwise sit in
  // the file looking authoritative and doing nothing.
  assert.doesNotThrow(() => validateAgainstSchema(SCHEMA, REACHING[0].rec));
});

test('the walker refuses a schema keyword it does not implement', () => {
  // The guard above is only meaningful if the walker really does throw.
  assert.throws(() => validateAgainstSchema({ minItems: 3 }, []),
    /keyword "minItems" at  is not in the interpreted subset/);
});

test('the schema is closed under its own $defs', () => {
  // Every $ref resolves. An unresolved one throws mid-walk on whichever fixture
  // happens to reach it, which is a confusing way to learn about a typo.
  const refs = [];
  (function collect(node) {
    if (Array.isArray(node)) return node.forEach(collect);
    if (node == null || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') refs.push(node.$ref);
    Object.values(node).forEach(collect);
  })(SCHEMA);
  assert.ok(refs.length > 0, 'the schema uses no $defs at all — it was probably not loaded');
  for (const ref of refs) {
    const name = ref.replace('#/$defs/', '');
    assert.ok(ref.startsWith('#/$defs/') && SCHEMA.$defs[name],
      `unresolved $ref "${ref}"`);
  }
});

test('every $def the schema declares is reachable from the root', () => {
  // A $def nobody references is a rule that reads as enforced and is not.
  const referenced = new Set();
  (function collect(node) {
    if (Array.isArray(node)) return node.forEach(collect);
    if (node == null || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') referenced.add(node.$ref.replace('#/$defs/', ''));
    Object.values(node).forEach(collect);
  })(SCHEMA);
  const unused = Object.keys(SCHEMA.$defs).filter((k) => !referenced.has(k));
  assert.deepEqual(unused, [], `unreferenced $defs: ${unused.join(', ')}`);
});
