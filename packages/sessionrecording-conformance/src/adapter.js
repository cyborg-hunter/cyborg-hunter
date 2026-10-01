// The player adapter: what an implementation supplies so the corpus's
// reconstruction-level oracles can be run against it.
//
// WHY AN ADAPTER AND NOT A PLAYER. `expectations/*.json` carries `checkpoints`
// arrays — "at session-relative t, in segment i, node 7 reads 'saved'" — and
// checking one means reconstructing a moment and reading state off it. That
// needs a player, and a player is precisely the thing this package must not
// contain: a conformance suite that ships its own reference implementation
// grades everyone against that implementation's reading of the spec. So the
// executor is here, the player is yours, and the seam between them is this
// file.
//
// THE CONTRACT. `boot(recording)` returns a player object that lives until
// `dispose()`:
//
//   segments      [{ origin, tEnd, durMs, spanStart, defect }]
//                 The §3 reading YOUR player makes, one entry per segment, in
//                 wire order. `origin` is the segment's session-relative start;
//                 `tEnd` its stated end or null; `durMs` its duration;
//                 `spanStart` the index of the keyframe segment its span opens
//                 at, or null when there is none; `defect` a string naming why
//                 the span is unusable, or null/absent. The executor bounds
//                 every checkpoint against these before it seeks — it does NOT
//                 re-derive §3 itself, because a guard carrying its own second
//                 reading of the origin chain green-lights the placements the
//                 player misplaces. `origin` — and `tEnd` where it is stated —
//                 must be FINITE. A segment your player derived no §3 origin
//                 for is refused by name; do not paper over it with NaN and
//                 expect the bounds to notice, because every comparison against
//                 NaN is false. `durMs` is read only when `tEnd` is null, and
//                 `defect` may be omitted.
//   selectSegment(i)     move to segment i
//   seekTo(tRel)         seek to `tRel` ms into the SELECTED segment
//   getSegment()         → the selected index
//   getPlayhead()        → the playhead, in the same segment-relative ms.
//                          When nothing clamped it must be `===` to the
//                          argument of the preceding `seekTo`: the anti-clamp
//                          witness compares with `!==`, so a float that makes a
//                          round trip through some other representation and
//                          comes back a few ulps off reads as a clamp. Store
//                          what you were asked for and return that.
//   resolveNode(id)      → the node the recording calls `id`, or null/undefined
//                          if the span never bound it. Tolerant on purpose; the
//                          executor supplies the loudness.
//   isConnected(node)    → whether the node is in the reconstructed document
//   readProp(node, prop, id)
//                        → `"text"`, `"value"` or `"attr:<name>"` off a
//                          RESOLVED node; `id` is the recorded id it came from,
//                          so a refusal can name it. Throw for a node the prop
//                          cannot be read from; the executor prefixes your
//                          message with the checkpoint that asked. `"exists"`
//                          never reaches here — the executor answers it from
//                          `resolveNode` and `isConnected`, so absence means the
//                          same thing to every implementation. Throw an
//                          UNPREFIXED message: the executor prepends
//                          `checkpoint t=… segment=…: ` itself, and an adapter
//                          that adds its own prefix doubles it.
//   dispose()            release the reconstruction
//
// THE LIFECYCLE. `boot` is called once PER CHECKPOINT, not once per recording,
// and each booted player sees exactly this call order: `selectSegment(i)`,
// `seekTo(tRel)`, `getSegment()`, `getPlayhead()`, then the `resolveNode` /
// `isConnected` / `readProp` reads, then `dispose()` — the last always, from a
// `finally`, including on a refusal. `placementProblems` is the exception: it
// boots once per fixture and calls none of the seek methods, only `segments`.
//
// WHAT THE EXECUTOR OWNS, and therefore what no implementation can vary: the
// prop vocabulary and its refusals, the rule that every prop but `exists` fails
// loudly on an unbound id, the session-relative → segment-relative conversion,
// both bounds checks, the anti-clamp witness, and `Object.is` comparison.

const REQUIRED = [
  'selectSegment', 'seekTo', 'getSegment', 'getPlayhead',
  'resolveNode', 'isConnected', 'readProp', 'dispose',
];

/**
 * Runtime shape check for an adapter's `boot`.
 * @param {{boot: Function}} adapter
 */
export function assertAdapter(adapter) {
  if (adapter == null || typeof adapter.boot !== 'function') {
    throw new TypeError('conformance adapter: expected an object with a boot(recording) function');
  }
  return adapter;
}

/**
 * Runtime shape check for one booted player. Called once per boot rather than
 * trusted, because a missing method surfaces otherwise as a `TypeError` from
 * inside a checkpoint — which reads like a corpus failure and is not one.
 */
export function assertPlayer(player) {
  if (player == null || typeof player !== 'object') {
    throw new TypeError('conformance adapter: boot(recording) returned no player');
  }
  const missing = REQUIRED.filter((k) => typeof player[k] !== 'function');
  if (missing.length) {
    throw new TypeError(`conformance adapter: the booted player is missing ${missing.join(', ')}`);
  }
  if (!Array.isArray(player.segments)) {
    throw new TypeError('conformance adapter: the booted player has no `segments` array — ' +
      'the executor bounds checkpoints against the player\'s own §3 reading and cannot re-derive it');
  }
  return player;
}
