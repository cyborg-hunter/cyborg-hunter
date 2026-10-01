// The conformance suite as a library: `registerWireConformanceSuite()` declares
// the whole wire-level battery against the corpus on disk.
//
// WHY A LIBRARY AND NOT A TEST FILE. Every fixture is checked against its
// expectations twin, and until this package existed that runner lived in
// CH's test tree — so a
// second implementation could answer the corpus only by vendoring CH's tests.
// Registering the suite from a function means CH and any other consumer run the
// SAME tests, with the same names and the same messages, because there is one
// copy of each. The two callers differ in nothing but which package.json's
// `npm test` invokes them.
//
// THE THREE EXPECTATION MODES (`expect`, describing the TOLERANT LOAD only):
//   "accept" (default) — the file loads clean. Full battery: counts,
//                        spot checks, every corpus invariant, gzip round-trip,
//                        §11 semantic preservation.
//   "warn"             — the file loads, with at least one warning matching
//                        `expect_warning`. Counts optional.
//   "reject"           — the file never becomes a recording. `reject_stage`
//                        (gunzip | parse | tolerant) and `expect_error` are
//                        required; counts, spot checks and invariants are not.
//
// STRICT VALIDITY IS A SEPARATE AXIS. `expect` says whether the file LOADS;
// `strict_valid` says whether it CONFORMS, and the two are independent by
// design (spec §11: recordings are unrepeatable participant data, so the
// runtime profile accepts things CI refuses). A fixture stating
// `strict_valid: false` must also state `strict_errors` — the substrings the
// refusal has to contain — so "strict rejected it" can never be credited to an
// error nobody intended.

import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

import { validateTolerant, detectGzip } from './validator.js';
import { INVARIANT_NAMES, PRIVACY_INVARIANTS } from './invariants.js';
import {
  fixtureNames, expNameFor, readFixture, readExpectations, loadExpectations,
  enrollmentProblems, unwitnessedInvariants, declaredPerfFrames,
} from './corpus.js';
import { assertAdapter } from './adapter.js';
import { runCheckpoint, placementProblems } from './checkpoints.js';
import { runPipeline, gunzipStage, getPath, STAGES, DECOMPRESSED_CEILING } from './pipeline.js';

/**
 * Declare the wire-level conformance battery.
 *
 * @param {object} [opts]
 * @param {Function} [opts.test]  the test registrar; defaults to node:test's,
 *                                and exists so a consumer on another runner can
 *                                bind its own without the suite being copied.
 */
export function registerWireConformanceSuite(opts = {}) {
  const test = opts.test ?? nodeTest;
  const FIXTURES = fixtureNames();

  // ── enrollment ───────────────────────────────────────────────────────────
  test('enrollment: fixtures exist and every expectation has a fixture twin', () => {
    assert.deepEqual(enrollmentProblems(), []);
  });

  // ── per-fixture ──────────────────────────────────────────────────────────
  for (const file of FIXTURES) {
    const expFile = expNameFor(file);

    test(`conformance: ${file}`, () => {
      const bytes = readFixture(file);
      const exp = readExpectations(expFile);
      // An expectations file that names a different fixture is being applied to
      // the wrong recording; a missing block would make its assertions no-ops.
      assert.equal(exp.fixture, file, `expectations/${expFile} declares fixture "${exp.fixture}"`);
      const mode = exp.expect ?? 'accept';
      assert.ok(['accept', 'warn', 'reject'].includes(mode),
        `expectations/${expFile} declares unknown expect mode "${mode}"`);

      const res = runPipeline(bytes, exp);

      // ── reject mode ──────────────────────────────────────────────────────
      if (mode === 'reject') {
        assert.ok(STAGES.includes(exp.reject_stage) && exp.reject_stage !== 'strict' && exp.reject_stage !== 'corpus',
          `expectations/${expFile} must declare reject_stage as "gunzip" | "parse" | "tolerant" ` +
          `(strict invalidity is carried by strict_valid/strict_errors, and a corpus-invariant ` +
          `violation by expected_failures — neither stops a file from loading)`);
        assert.ok(typeof exp.expect_error === 'string' && exp.expect_error.length > 0,
          `expectations/${expFile} declares expect: "reject" with no expect_error — a refusal ` +
          `for the wrong reason would pass`);
        assert.equal(res.stage, exp.reject_stage,
          res.stage === null
            ? `the fixture was NOT refused; it came through every stage`
            : `refused at "${res.stage}", not the declared "${exp.reject_stage}": ${res.error}`);
        assert.ok(res.error.includes(exp.expect_error),
          `the refusal message does not contain "${exp.expect_error}": ${res.error}`);
        // Counts, spot checks and invariants are not merely optional here — they
        // are unreachable, and stating them would be a claim about a recording
        // that was never built.
        for (const k of ['counts', 'spot_checks', 'invariants', 'checkpoints']) {
          if (k === 'checkpoints') continue;   // the checkpoints runner requires the (empty) array
          assert.ok(!(k in exp) || exp[k] == null,
            `expectations/${expFile} states "${k}" on a fixture that never becomes a recording`);
        }
        return;
      }

      // ── accept / warn ────────────────────────────────────────────────────
      assert.equal(res.stage, null,
        `expectations/${expFile} declares expect: "${mode}", but the fixture was refused at ` +
        `"${res.stage}": ${res.error}`);

      if (mode === 'warn') {
        assert.ok(typeof exp.expect_warning === 'string' && exp.expect_warning.length > 0,
          `expectations/${expFile} declares expect: "warn" with no expect_warning`);
        assert.ok(res.loaded.warnings.some(w => w.includes(exp.expect_warning)),
          `no warning contains "${exp.expect_warning}": ${JSON.stringify(res.loaded.warnings)}`);
      } else {
        assert.deepEqual(res.loaded.warnings, [],
          `expectations/${expFile} declares expect: "accept", but the tolerant load warned`);
      }

      // Strict conformance, stated and — when it fails — itemised.
      assert.equal(typeof exp.strict_valid, 'boolean', `expectations/${expFile} has no strict_valid`);
      assert.equal(res.strict.ok, exp.strict_valid, `strict_valid mismatch: ${JSON.stringify(res.strict.errors)}`);
      if (exp.strict_valid === false) {
        assert.ok(Array.isArray(exp.strict_errors) && exp.strict_errors.length > 0,
          `expectations/${expFile} states strict_valid: false with no strict_errors — "strict ` +
          `rejected it" would be credited to whatever error happened to be there`);
        for (const want of exp.strict_errors) {
          assert.ok(res.strict.errors.some(e => e.includes(want)),
            `no strict error contains "${want}": ${JSON.stringify(res.strict.errors)}`);
        }
      } else {
        assert.ok(!('strict_errors' in exp),
          `expectations/${expFile} states strict_errors on a strict-VALID fixture`);
      }

      // ── corpus invariants ────────────────────────────────────────────────
      // Every invariant runs against every fixture. The expectations file makes
      // an EXHAUSTIVE claim about the outcome: `invariants` lists the ones that
      // hold, `expected_failures` maps the ones that do not to the substring
      // their message must contain, and together they must account for the whole
      // table. An opt-in list would let a new invariant land with nothing
      // enrolled in it — green, and asserting nothing.
      const expectedFailures = exp.expected_failures ?? {};
      assert.ok(Array.isArray(exp.invariants), `expectations/${expFile} has no invariants array`);
      assert.deepEqual(
        [...exp.invariants, ...Object.keys(expectedFailures)].sort(),
        [...INVARIANT_NAMES].sort(),
        `expectations/${expFile} must account for every corpus invariant exactly once, across ` +
        `"invariants" (expected to hold) and "expected_failures" (expected to fail)`);

      // The privacy scans are the ones that may not fail by accident. A fixture
      // whose expected_failures names one of them is declaring a deliberate leak
      // and must say so out loud (`expect_leak`), so the
      // ALWAYS_ON scan inverts — asserting the scan CATCHES it — instead of
      // failing the suite.
      const declaredLeaks = Object.keys(expectedFailures).filter(n => PRIVACY_INVARIANTS.includes(n));
      if (declaredLeaks.length > 0) {
        assert.equal(exp.expect_leak, true,
          `expectations/${expFile} expects ${declaredLeaks.join('/')} to fail without declaring ` +
          `expect_leak: true — a deliberately-leaking fixture has to say so`);
      } else {
        assert.ok(!('expect_leak' in exp),
          `expectations/${expFile} declares expect_leak with no privacy invariant in expected_failures`);
      }

      for (const name of exp.invariants) {
        assert.equal(res.invariantFailures[name] ?? null, null,
          `invariant ${name}: ${res.invariantFailures[name]}`);
      }
      for (const [name, want] of Object.entries(expectedFailures)) {
        const got = res.invariantFailures[name];
        assert.ok(got != null,
          `expectations/${expFile} expects invariant ${name} to FAIL and it passed — the fixture ` +
          `no longer carries the defect it was cut for`);
        assert.ok(got.includes(want), `invariant ${name} failed for the wrong reason: ${got}`);
      }

      // ── counts, spot checks ──────────────────────────────────────────────
      // Required in accept mode and permitted in warn mode. `events_by_type` is
      // required, not optional: segment and event totals say how big a recording
      // is; only the per-type histogram says what is IN it, and that is the whole
      // claim a producer fixture makes — a jsPsych recording losing every
      // canvas.snapshot to a mapping regression keeps its 909-event total.
      // (tools/gen-expectations-counts.mjs computes it.)
      if (mode === 'accept') {
        assert.ok(exp.counts, `expectations/${expFile} has no counts block`);
        assert.ok(Array.isArray(exp.spot_checks), `expectations/${expFile} has no spot_checks array`);
      }
      const rec = res.rec;
      if (exp.counts) {
        assert.ok(exp.counts.events_by_type, `expectations/${expFile} has no counts.events_by_type`);
        const eventsTotal = rec.segments.reduce((n, s) => n + s.events.length, 0);
        assert.equal(rec.segments.length, exp.counts.segments);
        assert.equal(eventsTotal, exp.counts.events_total);
        assert.equal(rec.segments.filter(s => s.initial_dom != null).length, exp.counts.keyframes);
        assert.equal(rec.segments.filter(s => s.initial_dom == null).length, exp.counts.continuations);
        // Recomputed here rather than trusted: the histogram is an authored claim
        // about the fixture, and deepEqual holds it to being exhaustive in both
        // directions — a type the fixture carries but the block omits fails just as
        // loudly as a type the block invents.
        const byType = {};
        for (const s of rec.segments) for (const e of s.events) byType[e.type] = (byType[e.type] ?? 0) + 1;
        assert.deepEqual(byType, exp.counts.events_by_type);
        // No cross-check that the authored histogram sums to the authored
        // events_total: with both sides recomputed from the same fixture, that sum
        // is a theorem, not an assertion. A test that cannot fail is worse than no
        // test, because it gets credited with catching things the deepEqual caught.
      }
      for (const sc of exp.spot_checks ?? []) {
        assert.deepEqual(getPath(rec, sc.path), sc.equals, `spot check ${sc.path}`);
      }

      // ── §8 whole-FILE leak scan ──────────────────────────────────────────
      // "Redaction is a property of the FILE, not of event capture. A redacted
      // subtree's content must not appear anywhere in the serialized recording."
      // Structural checks cannot say that: `password_floor` knows the channels
      // §8 names, and §8's own sentence is about the bytes. So this one reads the
      // raw text and looks for a string.
      //
      // `present` is not decoration. An absence scan over an empty file passes,
      // and a fixture regeneration that silently captured nothing would leave
      // every `absent` entry green — so each scan carries liveness companions,
      // and the pin-8 residuals it deliberately does NOT claim to remove are
      // asserted present rather than left unmentioned.
      if (exp.leak_scan) {
        const { absent = [], absent_patterns = [], present = [] } = exp.leak_scan;
        assert.ok(present.length > 0,
          `expectations/${expFile} declares a leak_scan with no "present" companions — an ` +
          `absence scan over a fixture that captured nothing passes`);
        for (const s of absent) {
          assert.ok(!res.raw.includes(s), `leak scan: "${s}" appears in the serialized recording (spec §8)`);
        }
        for (const p of absent_patterns) {
          const m = new RegExp(p).exec(res.raw);
          assert.equal(m, null, `leak scan: /${p}/ matches "${m?.[0]}" in the serialized recording (spec §8)`);
        }
        for (const s of present) {
          assert.ok(res.raw.includes(s),
            `leak scan: "${s}" is absent — the fixture no longer carries what its scan is scanning around`);
        }
      }
    });

    test(`gzip round-trip: ${file}`, () => {
      const bytes = readFixture(file);
      const exp = readExpectations(expFile);
      if ((exp.expect ?? 'accept') === 'reject') {
        // A fixture that never becomes a recording has no object to round-trip.
        // What IS asserted is the detection half of §10: whatever the bytes are,
        // detectGzip must agree with the filename the corpus stores them under —
        // the corrupt-gzip fixture is only a gzip test if the reader takes the
        // gunzip path to fail on it.
        assert.equal(detectGzip(bytes), file.endsWith('.gz'),
          `fixtures/${file}: magic bytes and file extension disagree about compression`);
        return;
      }
      const raw = gunzipStage(bytes).raw;
      const gz = gzipSync(raw);
      assert.equal(detectGzip(gz), true);
      assert.equal(detectGzip(raw), false);
      assert.deepEqual(JSON.parse(gunzipStage(gz).raw.toString('utf8')), JSON.parse(raw.toString('utf8')));
    });

    test(`semantic preservation: ${file}`, () => {
      // Spec §11 preservation rule: loading a recording must not silently drop
      // fields. This is the seam the forward-compat fixture pushes on.
      const bytes = readFixture(file);
      const exp = readExpectations(expFile);
      if ((exp.expect ?? 'accept') === 'reject') return;
      const raw = gunzipStage(bytes).raw.toString('utf8');
      const parsed = JSON.parse(raw);
      // The bare parse→serialize→parse anchor. Weak on its own — nothing
      // JSON.parse produces can fail it — and kept as the seam the forward-compat
      // fixture extends.
      assert.deepEqual(JSON.parse(JSON.stringify(parsed)), parsed);
      // The half with teeth. The contract asserted here is the strict one: for
      // every key the file carried, the loaded value must come back identical —
      // no removal, no rewrite, and no addition anywhere beneath it. That holds
      // because validateTolerant fills absent defaults at the TOP level only
      // ({...TOP_DEFAULTS, ...obj}) and never reaches inside segments. Unknown
      // forward-compat fields are what a key-whitelisting loader drops, and
      // dropping them silently is the §11 violation this catches.
      // The strictness is deliberate. If the loader ever starts defaulting
      // *within* a segment, this test fails, and that change gets argued for
      // rather than absorbed. A producer's serializer is the other half of §11,
      // and belongs to that producer's own suite — this package holds no
      // recorder.
      const loaded = validateTolerant(raw);
      // Strict-valid implies tolerant-valid: strict runs tolerant first and
      // inherits its errors. So a strict-valid fixture that fails to load is a
      // loader regression, and saying so here is what stops the branch below
      // from absolving one — a tolerant loader that rejected everything would
      // otherwise satisfy the error branch and pass this test.
      if (exp.strict_valid) {
        assert.equal(loaded.ok, true,
          `tolerant load rejected a strict-valid fixture: ${JSON.stringify(loaded.errors)}`);
      }
      if (loaded.ok) {
        for (const k of Object.keys(parsed)) {
          assert.deepEqual(loaded.recording[k], parsed[k], `tolerant load altered top-level "${k}"`);
        }
      } else {
        assert.ok(loaded.errors.length > 0, 'tolerant load failed without reporting an error');
      }
    });
  }

  // ── corpus-level coverage ──────────────────────────────────────────────────

  test('corpus: every invariant is exercised in its FAILING direction by some fixture', () => {
    // An invariant only ever run against conforming files is an assertion nobody
    // has watched fail. The negative-* set exists so each one has a witness, and
    // this is the test that notices when a new invariant lands without one.
    const unwitnessed = unwitnessedInvariants(INVARIANT_NAMES);
    assert.deepEqual(unwitnessed, [],
      `no fixture makes ${unwitnessed.join(', ')} fail — cut a negative-* fixture that does, or the ` +
      `check is only ever observed passing`);
  });

  test('corpus: the §10 gzip detection path is exercised by a fixture on disk', () => {
    // The in-memory round-trip above compresses each fixture and reads it back,
    // which proves detectGzip's arithmetic and nothing about the reader's
    // handling of a file that ARRIVES compressed. That needs bytes on disk.
    assert.ok(FIXTURES.some(f => f.endsWith('.json.gz')),
      'no *.json.gz fixture — the enrollment path that reads compressed bytes off disk is untested');
  });

  test('corpus: at least one fixture pins the absolute perf frame', () => {
    // A review finding, kept from decaying back into a note: canonical-core's
    // zero origin cannot tell the absolute reading of `ended_at_perf` from the
    // relative one, so the corpus needs a fixture with a large non-zero origin or
    // the ambiguity is unpinned again.
    assert.ok(declaredPerfFrames().includes('absolute'),
      'no fixture declares perf_frame: "absolute" — the reading CH\'s serializer states is unpinned');
  });

  // ── self-tests of the runner's own machinery ───────────────────────────────

  // A spot check whose path does not resolve must FAIL, never quietly pass.
  // getPath returns undefined for an absent key, and node:assert/strict's
  // deepEqual separates undefined from null — that pairing is what stops
  // `{"equals": null}` from being satisfied by a key the producer forgot to emit.
  // Keep both halves together.
  test('getPath: an absent key is undefined and cannot satisfy {"equals": null}', () => {
    assert.equal(getPath({ a: {} }, 'a.b'), undefined);
    assert.throws(() => assert.deepEqual(getPath({ a: {} }, 'a.b'), null));
    // The real spot check it protects still resolves to a genuine null.
    assert.deepEqual(getPath({ segments: [{}, { initial_dom: null }] }, 'segments.1.initial_dom'), null);
  });

  test('runPipeline: the decompressed-size ceiling refuses a bomb before parsing', () => {
    // Proven on a synthetic buffer rather than only on the fixture, because the
    // fixture proves the ENROLLMENT path and this proves the ceiling itself: a
    // ceiling raised above the bomb would leave the fixture passing for the wrong
    // reason, and nothing else would notice.
    const bomb = gzipSync(Buffer.alloc(DECOMPRESSED_CEILING + 1, 0x41));
    const res = runPipeline(bomb, {});
    assert.equal(res.stage, 'gunzip');
    assert.match(res.error, /gunzip refused/);
    // …and a payload under the ceiling comes through the gunzip stage, so the
    // ceiling is refusing size rather than refusing compression.
    assert.equal(runPipeline(gzipSync(Buffer.from('not json')), {}).stage, 'parse');
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The reconstruction-level suite
//
// Everything above checks the WIRE. `checkpoints` arrays check what a player
// builds out of it, which needs a player — so this half takes an adapter
// (`adapter.js`) and is otherwise the same deal: one runner, every
// implementation, identical names and messages.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Declare the checkpoint battery against `adapter`.
 *
 * @param {object} opts
 * @param {{boot: Function}} opts.adapter  the player under test
 * @param {Function} [opts.test]           the test registrar
 */
export function registerCheckpointSuite(opts) {
  const test = opts.test ?? nodeTest;
  const adapter = assertAdapter(opts.adapter);

  // ── enrollment ───────────────────────────────────────────────────────────
  //
  // By existence, like the fixtures: a new corpus entry's checkpoints run
  // without a registry edit. The failure mode of enrolling by existence is that
  // it has no symptom — a `checkpoints` key that got renamed, or an
  // expectations file whose fixture twin went away, simply stops being executed
  // and nothing turns red. So the reachability of every authored checkpoint is
  // asserted directly, against a count recomputed from disk rather than from
  // the loop that runs them.
  const FIXTURE_SET = new Set(fixtureNames().filter((f) => f.endsWith('.json')));
  const EXPECTATIONS = loadExpectations();

  // Parsed once per fixture: a player copies what it needs and never writes
  // into the recording, so one parse serves every boot.
  const recordings = new Map();
  const recordingFor = (file) => {
    if (!recordings.has(file)) recordings.set(file, JSON.parse(readFixture(file).toString('utf8')));
    return recordings.get(file);
  };

  const AUTHORED = EXPECTATIONS.reduce(
    (n, { exp }) => n + (Array.isArray(exp.checkpoints) ? exp.checkpoints.length : 0), 0);
  let executed = 0;

  test('enrollment: every expectations file states a checkpoints array', () => {
    for (const { file, exp } of EXPECTATIONS) {
      assert.ok(Array.isArray(exp.checkpoints),
        `expectations/${file} has no checkpoints array — the key is misspelled or was dropped, ` +
        `and this runner would skip it in silence`);
    }
  });

  test('enrollment: an expectations file carrying checkpoints has a fixture to run them against', () => {
    for (const { file, exp } of EXPECTATIONS) {
      if (!Array.isArray(exp.checkpoints) || exp.checkpoints.length === 0) continue;
      assert.ok(FIXTURE_SET.has(file),
        `expectations/${file} authors ${exp.checkpoints.length} checkpoint(s) but has no ` +
        `fixtures/${file} twin — they are unreachable, not passing`);
    }
  });

  test('enrollment: the corpus authors at least one checkpoint', () => {
    // Without this the whole suite passes vacuously the day someone empties the
    // arrays — the same hole the wire suite's enrollment test closes for an
    // empty fixtures/.
    assert.ok(AUTHORED > 0, 'no expectations file authors a checkpoint');
  });

  test('enrollment: a fixture carrying checkpoints records where they were cross-verified', () => {
    // The paper trail for this package's central invariant. It does not (cannot)
    // check another player's agreement from here; what it enforces is that a
    // corpus entry may not grow checkpoints without saying which other player
    // agreed with them first.
    for (const { file, exp } of EXPECTATIONS) {
      if (!Array.isArray(exp.checkpoints) || exp.checkpoints.length === 0) continue;
      const note = exp.notes && exp.notes.checkpoints;
      assert.ok(typeof note === 'string' && note.length > 0,
        `expectations/${file} authors checkpoints with no notes.checkpoints provenance — ` +
        `a checkpoint whose expected value was read off the player under test is a fixture defect`);
    }
  });

  for (const { file, exp } of EXPECTATIONS) {
    if (!Array.isArray(exp.checkpoints) || !FIXTURE_SET.has(file)) continue;
    exp.checkpoints.forEach((cp, i) => {
      test(`checkpoint ${i + 1}/${exp.checkpoints.length} of ${file} (t=${cp.t}, segment ${cp.segment})`, () => {
        executed++;
        runCheckpoint(recordingFor(file), cp, adapter);
      });
    });
  }

  test('enrollment: every authored checkpoint ran', () => {
    // Counted independently of the loop above: `AUTHORED` comes from re-reading
    // the expectations, `executed` from the test bodies. A filter that quietly
    // skipped a file would leave the two apart.
    assert.equal(executed, AUTHORED,
      `${AUTHORED} checkpoint(s) are authored on disk but ${executed} ran`);
  });

  test('no authored checkpoint depends on the 0.1 ms quantisation for its placement', () => {
    const problems = [];
    for (const { file, exp } of EXPECTATIONS) {
      // An entry with no checkpoints has no placement to guard, and the corpus
      // is full of them: eighteen negative fixtures, three of which are not
      // parseable recordings at all (a truncated JSON document, a corrupt gzip,
      // a decompression bomb). Parsing every twin to guard an empty array
      // crashes on the first of those — correctly, in the sense that the
      // fixture IS unparseable, and uselessly, since it authors nothing.
      if (!Array.isArray(exp.checkpoints) || exp.checkpoints.length === 0) continue;
      if (!FIXTURE_SET.has(file)) continue;
      problems.push(...placementProblems(recordingFor(file), exp.checkpoints, adapter, file));
    }
    assert.deepEqual(problems, []);
  });

  test('canonical-core carries the four checkpoints the fork executes, verbatim', () => {
    // Mirrored from jspsych-replay-fork `tests/checkpoints.test.ts` (CHECKPOINTS,
    // landed there in commit 8be0ef5 BEFORE CH had an executor). The pin is
    // one-directional in the same way the fork's fixture checksum is: an edit
    // here fails immediately, an edit there stays green until someone re-reads
    // this file. It is what makes "the same four the fork executes" a machine
    // check rather than a sentence.
    const forkFour = [
      { t: 500, segment: 0, assert: [{ node: 5, prop: 'text', equals: 'Clicked!' }] },
      { t: 2250, segment: 1, assert: [{ node: 6, prop: 'exists', equals: true },
        { node: 7, prop: 'text', equals: 'saved' }] },
      { t: 2350, segment: 1, assert: [{ node: 6, prop: 'exists', equals: false }] },
      { t: 4100, segment: 2, assert: [{ node: 3, prop: 'value', equals: 'abc' }] },
    ];
    const mine = EXPECTATIONS.find((e) => e.file === 'canonical-core.json').exp.checkpoints;
    assert.deepEqual(mine, forkFour);
  });

  // ── the executor's own failure modes ──────────────────────────────────────
  //
  // An oracle that cannot fail proves nothing. Each of these is a way the
  // battery above could be green over a broken reconstruction.

  const canonical = () => recordingFor('canonical-core.json');

  test('a wrong expected value fails, naming node, prop, expected and actual', () => {
    assert.throws(() => runCheckpoint(canonical(), {
      t: 500, segment: 0, assert: [{ node: 5, prop: 'text', equals: 'Not clicked' }],
    }, adapter), /node 5 prop "text" — expected "Not clicked", got "Clicked!"/);
  });

  test('an unresolvable id fails loudly for every prop but exists', () => {
    assert.throws(() => runCheckpoint(canonical(), {
      t: 500, segment: 0, assert: [{ node: 99, prop: 'text', equals: 'anything' }],
    }, adapter), /node 99 does not resolve/);
    // …and `exists` is the one prop that answers for it instead.
    runCheckpoint(canonical(), {
      t: 500, segment: 0, assert: [{ node: 99, prop: 'exists', equals: false }],
    }, adapter);
  });

  test('a t outside the keyframe span is refused', () => {
    assert.throws(() => runCheckpoint(canonical(), {
      t: 9000, segment: 0, assert: [{ node: 5, prop: 'text', equals: 'Clicked!' }],
    }, adapter), /outside the keyframe span's window \[10, 2000\]/);
  });

  test('a t inside the span but outside the named segment is refused', () => {
    // t=500 sits inside segment 1's keyframe span — which reaches back to segment
    // 0's keyframe at origin 10 — but 1500 ms before segment 1 opens. Without the
    // second bound this reconstructs a segment-0 moment and passes.
    assert.throws(() => runCheckpoint(canonical(), {
      t: 500, segment: 1, assert: [{ node: 5, prop: 'text', equals: 'Clicked!' }],
    }, adapter), /outside segment 1's own window \[2000, 3500\]/);
  });

  test('a checkpoint naming a segment the recording does not have is refused', () => {
    assert.throws(() => runCheckpoint(canonical(), {
      t: 500, segment: 7, assert: [{ node: 5, prop: 'exists', equals: true }],
    }, adapter), /names segment 7, but the recording has 3 segment\(s\)/);
  });

  test('an unrecognised prop throws rather than reading a quiet null', () => {
    assert.throws(() => runCheckpoint(canonical(), {
      t: 500, segment: 0, assert: [{ node: 2, prop: 'colour', equals: 'red' }],
    }, adapter), /unrecognized prop "colour"/);
    assert.throws(() => runCheckpoint(canonical(), {
      t: 500, segment: 0, assert: [{ node: 2, prop: 'attr:', equals: null }],
    }, adapter), /names no attribute/);
  });

  test('value refuses a node that is not a form control', () => {
    assert.throws(() => runCheckpoint(canonical(), {
      t: 500, segment: 0, assert: [{ node: 2, prop: 'value', equals: 'x' }],
    }, adapter), /not a form control/);
  });

  test('attr: refuses a text node', () => {
    assert.throws(() => runCheckpoint(canonical(), {
      t: 500, segment: 0, assert: [{ node: 5, prop: 'attr:id', equals: null }],
    }, adapter), /is not an element/);
  });
}
