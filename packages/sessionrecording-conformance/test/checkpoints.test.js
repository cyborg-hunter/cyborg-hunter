// The checkpoint executor's own logic, on a stub player.
//
// WHY A STUB AND NOT A REAL ONE. This package holds no player on purpose — a
// conformance suite that ships its own reference implementation grades everyone
// against that implementation's reading of the spec. So what can be checked
// here is exactly what the executor OWNS: the placement arithmetic, both
// bounds, the prop vocabulary and its refusals, the anti-clamp witness and the
// `Object.is` comparison. Whether a reconstruction is CORRECT is what the
// corpus's checkpoints ask of a real player, and CH and the fork each answer it
// with their own.
//
// The stub is deliberately dumb: a flat map of ids to fake nodes, and a
// playhead it records. Everything it does is what the contract says a player
// does, and nothing more, so a test that passes here passes because the
// executor is right rather than because the player was helpful.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertAdapter, assertPlayer } from '../src/adapter.js';
import {
  runCheckpoint, runCheckpoints, placeCheckpoint, readCheckpointProp, round1, where,
} from '../src/checkpoints.js';

// Two segments: a keyframe [100, 1100] and a continuation [1100, 2100] whose
// span opens at the keyframe. Enough to exercise both bounds.
const SEGMENTS = [
  { origin: 100, tEnd: 1100, durMs: 1000, spanStart: 0, defect: null },
  { origin: 1100, tEnd: 2100, durMs: 1000, spanStart: 0, defect: null },
];

function stubAdapter(over = {}) {
  const nodes = over.nodes ?? { 1: { tag: 'div', text: 'hello', attrs: { id: 'stage' } } };
  return {
    boot() {
      const player = {
        segments: over.segments ?? SEGMENTS,
        selected: 0,
        playhead: 0,
        disposed: false,
        selectSegment(i) { player.selected = i; },
        seekTo(t) { player.playhead = over.clamp ? Math.min(t, over.clamp) : t; },
        getSegment: () => player.selected,
        getPlayhead: () => player.playhead,
        resolveNode: (id) => nodes[id] ?? null,
        isConnected: (node) => node.connected !== false,
        readProp(node, prop, id) {
          if (prop === 'text') return node.text;
          if (prop === 'value') {
            if (node.tag !== 'input') {
              throw new Error(`node ${id} is a <${node.tag}>, not a form control — ` +
                `prop "value" has nothing to read`);
            }
            return node.value;
          }
          const name = prop.slice('attr:'.length);
          if (node.attrs == null) throw new Error(`node ${id} is not an element`);
          return node.attrs[name] ?? null;
        },
        dispose() { player.disposed = true; },
      };
      return player;
    },
  };
}

const cp = (over) => ({ t: 500, segment: 0, assert: [], ...over });

// ── the adapter's shape ────────────────────────────────────────────────────

test('an adapter with no boot is refused before anything is reconstructed', () => {
  assert.throws(() => assertAdapter(null), /expected an object with a boot\(recording\) function/);
  assert.throws(() => assertAdapter({}), /expected an object with a boot\(recording\) function/);
  assert.throws(() => runCheckpoint({}, cp(), { boot: 1 }), /boot\(recording\) function/);
});

test('a player missing a contract method names it, rather than failing mid-checkpoint', () => {
  // A `TypeError: player.seekTo is not a function` thrown from inside a
  // checkpoint reads like a corpus failure and is not one.
  const partial = { segments: SEGMENTS, selectSegment() {}, getSegment() {}, getPlayhead() {} };
  assert.throws(() => assertPlayer(partial), /missing seekTo, resolveNode, isConnected, readProp, dispose/);
  assert.throws(() => assertPlayer(null), /boot\(recording\) returned no player/);
});

test('a player with no segments array is refused: the executor cannot re-derive §3', () => {
  const noSegments = {
    selectSegment() {}, seekTo() {}, getSegment() {}, getPlayhead() {},
    resolveNode() {}, isConnected() {}, readProp() {}, dispose() {},
  };
  assert.throws(() => assertPlayer(noSegments), /has no `segments` array/);
});

// ── placement ──────────────────────────────────────────────────────────────

test('placement rebases with round1(t − origin) over the player\'s own origin', () => {
  const player = stubAdapter().boot();
  assert.deepEqual(placeCheckpoint(player, cp({ t: 500 })).tRel, 400);
  // The decimal case, which is where a second reading of the rule would drift.
  const decimal = { segments: [{ origin: 7792.599999904633, tEnd: null, durMs: 3000, spanStart: 0 }] };
  assert.equal(placeCheckpoint(stubAdapter(decimal).boot(), cp({ t: 9600 })).tRel,
    round1(9600 - 7792.599999904633));
});

test('a t outside the keyframe span is refused', () => {
  assert.throws(() => placeCheckpoint(stubAdapter().boot(), cp({ t: 5000 })),
    /outside the keyframe span's window \[100, 1100\]/);
});

test('a t inside the span but outside the named segment is refused', () => {
  // t=500 is inside segment 1's span — which reaches back to segment 0's
  // keyframe at origin 100 — and 600 ms before segment 1 opens. Without the
  // second bound this reconstructs a segment-0 moment and quietly passes.
  assert.throws(() => placeCheckpoint(stubAdapter().boot(), cp({ t: 500, segment: 1 })),
    /outside segment 1's own window \[1100, 2100\]/);
});

test('a segment the recording does not have, and a non-finite t, are refused', () => {
  assert.throws(() => placeCheckpoint(stubAdapter().boot(), cp({ segment: 9 })),
    /names segment 9, but the recording has 2 segment\(s\)/);
  assert.throws(() => placeCheckpoint(stubAdapter().boot(), cp({ t: NaN })),
    /t must be a finite number of session-relative ms/);
});

test('a non-finite segment origin is refused by name, not by the anti-clamp witness', () => {
  // A player that derived no §3 origin reports NaN. Every comparison against
  // NaN is false, so both bounds admit the checkpoint; before this guard the
  // refusal came from the anti-clamp witness and read "the viewer clamped the
  // seek … landed at NaN", which blames the player's seek for a placement it
  // never got wrong.
  const noOrigin = {
    segments: [{ origin: NaN, tEnd: null, durMs: 0, spanStart: 0, defect: null }],
  };
  assert.throws(() => placeCheckpoint(stubAdapter(noOrigin).boot(), cp({ t: 50 })),
    /segment 0 reports a non-finite origin \(NaN\)/);
  // Same with a stated t_end: the bound is not what admitted it.
  const stated = {
    segments: [{ origin: NaN, tEnd: 100, durMs: 100, spanStart: 0, defect: null }],
  };
  assert.throws(() => placeCheckpoint(stubAdapter(stated).boot(), cp({ t: 50 })),
    /non-finite origin/);
  // The keyframe the span opens at is checked too: a continuation rebases
  // against an origin chain that starts there.
  const badKeyframe = {
    segments: [
      { origin: NaN, tEnd: 1100, durMs: 1000, spanStart: 0, defect: null },
      { origin: 1100, tEnd: 2100, durMs: 1000, spanStart: 0, defect: null },
    ],
  };
  assert.throws(() => placeCheckpoint(stubAdapter(badKeyframe).boot(), cp({ t: 1500, segment: 1 })),
    /segment 0 reports a non-finite origin/);
  // And an unbounded end, which the reconstructed `origin + durMs` can produce.
  const noEnd = {
    segments: [{ origin: 0, tEnd: null, durMs: NaN, spanStart: 0, defect: null }],
  };
  assert.throws(() => placeCheckpoint(stubAdapter(noEnd).boot(), cp({ t: 50 })),
    /segment 0 has a non-finite end/);
});

test('a continuation with no keyframe before it is refused, not read off a blank stage', () => {
  // Every `exists` over an empty reconstruction reads false, so a checkpoint
  // asserting absence would pass for the worst possible reason.
  const orphan = { segments: [{ origin: 0, tEnd: 100, durMs: 100, spanStart: null, defect: null }] };
  assert.throws(() => placeCheckpoint(stubAdapter(orphan).boot(), cp({ t: 50 })),
    /is a continuation with no keyframe before it \(no span\) — the recording violates spec §3/);
  const defective = { segments: [{ origin: 0, tEnd: 100, durMs: 100, spanStart: 0, defect: 'span broken' }] };
  assert.throws(() => placeCheckpoint(stubAdapter(defective).boot(), cp({ t: 50 })),
    /\(span broken\)/);
});

test('a segment stating no t_end is bounded by its reconstructed end', () => {
  const open = { segments: [{ origin: 100, tEnd: null, durMs: 1000, spanStart: 0 }] };
  const player = stubAdapter(open).boot();
  assert.equal(placeCheckpoint(player, cp({ t: 1100 })).segEnd, 1100);
  assert.throws(() => placeCheckpoint(player, cp({ t: 1101 })), /\[100, 1100\]/);
});

// ── the prop vocabulary ────────────────────────────────────────────────────

test('exists answers for an unresolved id; every other prop fails loudly on one', () => {
  const player = stubAdapter().boot();
  const c = cp();
  assert.equal(readCheckpointProp(player, 99, 'exists', c), false);
  assert.throws(() => readCheckpointProp(player, 99, 'text', c),
    /node 99 does not resolve in the segment's keyframe span/);
});

test('exists is resolution AND connectedness, not resolution alone', () => {
  // A node the span still maps but an event has detached is NOT present. A
  // player answering `exists` from its id map alone would say it is.
  const detached = { nodes: { 1: { tag: 'div', connected: false } } };
  assert.equal(readCheckpointProp(stubAdapter(detached).boot(), 1, 'exists', cp()), false);
  assert.equal(readCheckpointProp(stubAdapter().boot(), 1, 'exists', cp()), true);
});

test('an unrecognised prop throws rather than reading a quiet null', () => {
  const player = stubAdapter().boot();
  assert.throws(() => readCheckpointProp(player, 1, 'colour', cp()),
    /unrecognized prop "colour" — expected "text", "exists", "value" or "attr:<name>"/);
  assert.throws(() => readCheckpointProp(player, 1, 'attr:', cp()), /prop "attr:" names no attribute/);
});

test('the player\'s refusal is prefixed with the checkpoint that asked', () => {
  // A reading failure has to name a moment; a bare "node 1 is a <div>" does not
  // say which of a fixture's checkpoints produced it.
  assert.throws(() => readCheckpointProp(stubAdapter().boot(), 1, 'value', cp({ t: 500, segment: 0 })),
    /^Error: checkpoint t=500 segment=0: node 1 is a <div>, not a form control/);
});

test('attr: reads through to the player, and where() names the checkpoint', () => {
  assert.equal(readCheckpointProp(stubAdapter().boot(), 1, 'attr:id', cp()), 'stage');
  assert.equal(readCheckpointProp(stubAdapter().boot(), 1, 'attr:missing', cp()), null);
  assert.equal(where({ t: 12.5, segment: 3 }), 'checkpoint t=12.5 segment=3');
});

// ── the executor ───────────────────────────────────────────────────────────

test('a wrong expected value fails, naming node, prop, expected and actual', () => {
  assert.throws(() => runCheckpoint({}, cp({
    assert: [{ node: 1, prop: 'text', equals: 'goodbye' }],
  }), stubAdapter()), /node 1 prop "text" — expected "goodbye", got "hello"/);
});

test('a clamped seek is caught, not read as a different moment', () => {
  // The anti-clamp witness. A player that clamps into [0, durMs] reconstructs a
  // neighbouring moment in silence; the playhead identity is what notices.
  assert.throws(() => runCheckpoint({}, cp({ t: 900 }), stubAdapter({ clamp: 300 })),
    /clamped the seek — asked for 800 ms into segment 0 \(origin 100, duration 1000\), landed at 300/);
});

test('the player is disposed even when a checkpoint throws', () => {
  const adapter = stubAdapter();
  let booted = null;
  const spying = { boot(rec) { booted = adapter.boot(rec); return booted; } };
  assert.throws(() => runCheckpoint({}, cp({ assert: [{ node: 1, prop: 'text', equals: 'no' }] }), spying));
  assert.equal(booted.disposed, true);
});

test('runCheckpoints returns one reading set per checkpoint, in order', () => {
  const out = runCheckpoints({}, [
    cp({ t: 500, assert: [{ node: 1, prop: 'text', equals: 'hello' }] }),
    cp({ t: 600, assert: [{ node: 1, prop: 'attr:id', equals: 'stage' }, { node: 9, prop: 'exists', equals: false }] }),
  ], stubAdapter());
  assert.deepEqual(out.map((r) => r.readings), [
    [{ node: 1, prop: 'text', actual: 'hello' }],
    [{ node: 1, prop: 'attr:id', actual: 'stage' }, { node: 9, prop: 'exists', actual: false }],
  ]);
});
