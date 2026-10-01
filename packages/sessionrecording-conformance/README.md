# @cyborg-hunter/sessionrecording-conformance

The conformance corpus for **SessionRecording v2**, packaged so any player or
recorder can run it. Zero runtime dependencies, Node 20+, ESM.

Spec: `docs/session-recording-v2.md` in the cyborg-hunter repository.

What is in here:

| | |
|---|---|
| `fixtures/` + `expectations/` | the corpus: 27 recordings and the claims each one answers |
| `src/validator.js` | the dual profiles of spec §11 — tolerant (runtime) and strict (CI) |
| `src/invariants.js` | nine whole-recording properties a field walk cannot see |
| `src/pipeline.js` | the five stages: gunzip → parse → tolerant → strict → corpus |
| `src/suite.js` | both batteries, as functions you call — not test files you copy |
| `src/checkpoints.js` + `src/adapter.js` | the reconstruction oracles, and the player seam |
| `src/fuzz/` | the differential oracle: a strict test player and a seeded mutation generator |
| `schema/` + `types/` | a hand-authored JSON Schema and its TypeScript twin |
| `bin/src-conformance.mjs` | the CLI |
| `.github/workflows/conformance.yml` | a workflow template to copy into your repo |

## Why a package

Wire-format claims made in prose are wrong within a release. The corpus is the
machine-checkable version: each fixture is a recording, each expectations twin
says exactly what must be true of it, and a fixture enrolls by existing on disk.
Until this package existed the runner lived inside cyborg-hunter's test tree,
which meant a second implementation could answer the corpus only by vendoring
someone else's tests — and meant cyborg-hunter's own viewer was the de facto
definition of what a checkpoint means. Nothing here contains a player or a
recorder, on purpose: a conformance suite that ships a reference implementation
grades everyone against that implementation's reading of the spec.

## Install

```sh
npm install --save-dev @cyborg-hunter/sessionrecording-conformance
```

`happy-dom` is an optional peer dependency, needed only for `src/fuzz/`. The
corpus, the validator, the invariants and the checkpoint executor use no DOM.

## Run it

```sh
# the wire-level battery over the packaged corpus — no player needed
npx src-conformance corpus

# both batteries: the corpus's `checkpoints` arrays go through YOUR player
npx src-conformance corpus --adapter ./test/conformance-adapter.js

# one recording of your own, through the five stages
npx src-conformance check ./out/session-P42.json.gz
npx src-conformance check ./fixture.json --expect ./expectations.json
```

Exit codes: `0` everything passed · `1` a check failed · `2` bad usage.

From a test file, so failures land in your own runner:

```js
import { registerWireConformanceSuite, registerCheckpointSuite }
  from '@cyborg-hunter/sessionrecording-conformance/suite';

registerWireConformanceSuite();                  // uses node:test by default
registerCheckpointSuite({ adapter: myAdapter }); // …or pass { test } for another runner
```

Both registrars accept a `test` option — anything with node:test's
`(name, fn)` shape — so the CLI, `node --test` and a third-party runner all
declare the same tests, with the same names and messages, from one definition.

## The adapter contract

To run the reconstruction half you supply a player. `boot(recording)` returns an
object that lives until `dispose()`:

```js
export default {
  boot(recording) {
    const player = myPlayer.mount(recording);
    return {
      // Your player's own §3 reading, one entry per segment, in wire order.
      segments: player.segments.map((s) => ({
        origin: s.origin,       // session-relative start
        tEnd: s.tEnd,           // stated end, or null
        durMs: s.durMs,
        spanStart: s.spanStart, // index of the keyframe its span opens at, or null
        defect: s.defect,       // why the span is unusable, or null
      })),
      selectSegment: (i) => player.goTo(i),
      seekTo: (ms) => player.seek(ms),          // ms into the SELECTED segment
      getSegment: () => player.segmentIndex,
      getPlayhead: () => player.playhead,
      resolveNode: (id) => player.nodeById(id) ?? null,   // null when unbound
      isConnected: (node) => node.isConnected === true,
      readProp: (node, prop, id) => /* "text" | "value" | "attr:<name>" */,
      dispose: () => player.destroy(),
    };
  },
};
```

Six things are worth saying about that shape — the first five because the second
implementation of this adapter had to discover each of them the hard way.

**`segments` is your reading, not ours.** The executor bounds every checkpoint
against the origins your player reports and never re-derives §3 itself. A guard
carrying its own second copy of the origin chain keeps validating placements
against the old rule the day your player's changes, and green-lights exactly the
placements it misplaces.

**`origin` and `tEnd` must be finite.** For a segment whose §3 origin your
player could not derive, the executor refuses the checkpoint by name. Reporting
`NaN` and expecting the bounds to catch it does not work: every comparison
against NaN is false, so the checkpoint passes both windows. `durMs` is read
only when `tEnd` is null, and `defect` may be omitted.

**`getPlayhead()` must echo `seekTo()`.** When nothing clamped, the value has to
be `===` to the number the executor just passed to `seekTo` — the anti-clamp
witness compares with `!==`, so a float that round-trips through some other
representation and comes back a few ulps off is reported as a clamp. Remember
what you were asked for and return that, not a recomputed position.

**`boot` runs once per checkpoint.** The call order on each booted player is
exactly `selectSegment(i)`, `seekTo(tRel)`, `getSegment()`, `getPlayhead()`, the
`resolveNode` / `isConnected` / `readProp` reads, then `dispose()` — always,
from a `finally`, refusals included. The authoring guard `placementProblems` is
the exception: one boot per fixture, and it touches nothing but `segments`.

**`resolveNode` stays tolerant.** Return null for an id the keyframe span never
bound. Tolerance is right for an analyst tool; the loudness is the executor's
job, and it is the executor that decides an unresolved id fails every prop but
`exists`.

**`readProp` never sees `exists`.** The executor answers that one from
`resolveNode` and `isConnected`, so "the node is present" means the same thing
to every implementation. Your `readProp` handles `text`, `value` and
`attr:<name>` — the three that need your realm, because `instanceof` has to
resolve against the reconstruction's own window — and throws for a node the prop
cannot be read from. Your message is prefixed with the checkpoint that asked.

Everything else is the executor's and no implementation can vary it: the prop
vocabulary and its refusals, the session-relative → segment-relative conversion
(`round1(t − origin)`, on the wire's own 0.1 ms grid), both bounds checks (the
keyframe span's window *and* the named segment's own — without the second, a
checkpoint on a continuation reconstructs an earlier segment's moment and
quietly passes), the anti-clamp witness, and `Object.is` comparison.

## Adding to the corpus

Fixture bytes are the contract; a fixture is enrolled by existing in
`fixtures/`, and answered by the twin of the same name in `expectations/`. Four
rules a new entry must satisfy:

- **Every invariant is accounted for.** `invariants` lists the ones expected to
  hold and `expected_failures` maps the ones expected to fail to a substring of
  their message; the union must equal the whole table. An opt-in list would let
  a new invariant land with nothing enrolled in it.
- **A rejection names its stage.** A fixture written to be refused at `strict`
  but actually refused at `parse` is a test passing for the wrong reason, which
  is worse than no test.
- **Checkpoints carry provenance.** `notes.checkpoints` must say which OTHER
  player agreed with the values first. A checkpoint read off the player under
  test is a fixture defect, not an oracle.
- **Checkpoints avoid sub-quantum gaps.** Between two events closer together
  than the wire's 0.1 ms grid, a player rebasing with `round1` and a player
  comparing raw floats place the same checkpoint on opposite sides. Put it on an
  event's own rounded time; the suite's placement guard fails at authoring time.

## The schema, and what it cannot say

`schema/session-recording-v2.schema.json` (draft 2020-12) and
`types/session-recording-v2.d.ts` are hand-authored from the spec prose, and the
package's own suite holds the schema to the validator's verdict on every fixture
that reaches the strict stage.

Four strict rules have no JSON Schema expression, because they are about a
value's relationship to its neighbours rather than its shape: a segment's
`index` versus its array position, segment non-overlap, event time-sortedness,
and the rule that no continuation carries `dom.*` events before the first
keyframe. Each is listed in `test/schema-equivalence.test.js` with the fixture
that witnesses it, and that list is checked in both directions so it cannot
quietly grow to excuse a real schema bug.

The schema is deliberately open — no `additionalProperties: false` anywhere.
§11's preservation rule makes unknown fields legal at every level, and a closed
schema would reject recordings the spec was written to admit.

## License

MIT.
