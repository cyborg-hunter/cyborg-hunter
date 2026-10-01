// The checkpoint executor: reconstruct a recording to a named session-relative
// moment through a player adapter, and read state off it by recorded node id.
//
// `expectations/*.json` has carried `checkpoints` arrays since the corpus was
// cut, and they are the strongest claim it makes — "at t, this node holds this"
// is a statement about a RECONSTRUCTION, which no amount of wire-level checking
// reaches. Extracted from CH's `tests/replay/schema-v2/checkpoints.test.js`
// so that the arithmetic, the bounds and the refusals are one
// implementation shared by every player instead of one per player.
//
// THE CONTRACT (`adapter.js` holds the player half):
//   - four props: `text`, `exists`, `value`, `attr:<name>`; anything else
//     THROWS rather than falling through to `getAttribute("")` and reading a
//     quiet null;
//   - every prop but `exists` fails loudly on an id the span did not bind;
//   - `t` is SESSION-relative and is bounds-checked against BOTH the keyframe
//     span and the named segment's own window, because a player that clamps a
//     seek reconstructs a neighbouring moment in silence;
//   - `equals` is compared with `Object.is`: every authored value is a scalar.
//
// ONE CONVERSION, COMPUTED ONCE. Checkpoint `t` is session-relative and a
// player seeks in segment-relative ms, so the executor rebases with
// `round1(t − origin)` over the player's own §3 origin — the wire's 0.1 ms grid
// (spec §7). Computing it here, from the origin the PLAYER reports, is what
// makes the comparison exact by construction. The reverse direction
// (`origin + tRel`) is inexact by up to 5e-7 ms and is never used for equality;
// the one place a reconstructed absolute appears is a segment's END when the
// recording states no `t_end`, and that is a BOUND.

import { assertAdapter, assertPlayer } from './adapter.js';

/** The wire's own 0.1 ms grid (spec §7), and the model's rebasing rule. */
export const round1 = (v) => Math.round(v * 10) / 10;

/** How every refusal names the checkpoint that caused it. */
export const where = (cp) => `checkpoint t=${cp.t} segment=${cp.segment}`;

/**
 * Place a checkpoint: session-relative `t` → the player's segment-relative
 * playhead, with both bounds checked before anything is reconstructed.
 *
 * @param {{segments: object[]}} player  a booted player, or any object carrying
 *   the same `segments` shape (CH's viewer model qualifies as-is)
 * @returns {{seg: object, tRel: number, segEnd: number}}
 * @throws when the checkpoint cannot be placed — a refusal, never a silent seek
 *         to a neighbouring moment.
 */
export function placeCheckpoint(player, cp) {
  if (typeof cp.t !== 'number' || !Number.isFinite(cp.t)) {
    throw new Error(`${where(cp)}: t must be a finite number of session-relative ms`);
  }
  const seg = player.segments[cp.segment];
  if (!seg) {
    throw new Error(`${where(cp)}: names segment ${cp.segment}, but the recording has ` +
      `${player.segments.length} segment(s)`);
  }

  // The span half. §3's precondition: a continuation with no keyframe before it
  // reconstructs nothing, and reading `exists: false` off an empty body would be
  // a green test over a blank stage.
  if (seg.spanStart == null || seg.defect) {
    throw new Error(`${where(cp)}: segment ${cp.segment} is a continuation with no keyframe ` +
      `before it (${seg.defect || 'no span'}) — the recording violates spec §3`);
  }
  const keyframe = player.segments[seg.spanStart];

  // The origins must be FINITE before anything is compared against them. Every
  // comparison against NaN is false, so a NaN origin sails through both bounds
  // below and is stopped — by accident — at the anti-clamp witness, which then
  // reports "the viewer clamped the seek … landed at NaN". That is a false
  // diagnosis of a real defect: the player derived no §3 origin for the segment,
  // and the refusal has to say so.
  for (const [label, s] of [[cp.segment, seg], [seg.spanStart, keyframe]]) {
    if (!Number.isFinite(s.origin)) {
      throw new Error(`${where(cp)}: segment ${label} reports a non-finite origin ` +
        `(${s.origin}) — the player derived no spec §3 session-relative start for it, ` +
        `so the checkpoint cannot be placed`);
    }
  }

  // Stated `t_end` where the recording states one; otherwise reconstructed, and
  // inexact by ≤5e-7 ms, which cannot matter for a bound.
  const segEnd = seg.tEnd != null ? seg.tEnd : round1(seg.origin + seg.durMs);
  if (!Number.isFinite(segEnd)) {
    throw new Error(`${where(cp)}: segment ${cp.segment} has a non-finite end ` +
      `(t_end ${seg.tEnd}, duration ${seg.durMs}) — the checkpoint cannot be bounded`);
  }
  if (cp.t < keyframe.origin || cp.t > segEnd) {
    throw new Error(`${where(cp)}: t is outside the keyframe span's window ` +
      `[${keyframe.origin}, ${segEnd}] (span opens at segment ${seg.spanStart})`);
  }

  // The segment half. The span bound only says the reconstruction is
  // well-defined: for a continuation the span reaches back to an earlier
  // keyframe, so "segment 1, t=500" would otherwise reconstruct a segment-0
  // moment and quietly pass.
  if (cp.t < seg.origin || cp.t > segEnd) {
    throw new Error(`${where(cp)}: t is outside segment ${cp.segment}'s own window ` +
      `[${seg.origin}, ${segEnd}]`);
  }

  return { seg, segEnd, tRel: round1(cp.t - seg.origin) };
}

/**
 * Read one prop off one recorded node id, through the player.
 *
 * The vocabulary and its refusals live HERE rather than in the adapter: an
 * implementation that got to decide what `exists` means, or that let an
 * unrecognised prop fall through to a quiet null, would be grading itself.
 */
export function readCheckpointProp(player, id, prop, cp) {
  // `resolveNode` is tolerant by design and returns null/undefined for an id the
  // span never bound. Tolerance is right for an analyst tool and wrong for an
  // oracle, so the loudness is this executor's duty.
  const node = player.resolveNode(id);

  // The one prop whose whole job is to report absence.
  if (prop === 'exists') return node != null && player.isConnected(node) === true;

  if (node == null) {
    throw new Error(`${where(cp)}: node ${id} does not resolve in the segment's keyframe span — ` +
      `the viewer never mounted it, or an event already removed it. ` +
      `Only prop "exists" tolerates an unresolved node.`);
  }

  const isAttr = typeof prop === 'string' && prop.indexOf('attr:') === 0;
  if (isAttr && prop.slice('attr:'.length) === '') {
    throw new Error(`${where(cp)}: prop "attr:" names no attribute`);
  }
  if (prop !== 'text' && prop !== 'value' && !isAttr) {
    throw new Error(`${where(cp)}: unrecognized prop ${JSON.stringify(prop)} — ` +
      `expected "text", "exists", "value" or "attr:<name>"`);
  }

  // The player answers for the three props that need its realm; its refusal
  // message is prefixed with the checkpoint that asked, so a reading failure
  // names a moment rather than a bare node.
  try {
    return player.readProp(node, prop, id);
  } catch (e) {
    throw new Error(`${where(cp)}: ${e.message}`);
  }
}

/**
 * Reconstruct `recording` to one checkpoint's moment and check every assertion.
 *
 * @param {object} recording
 * @param {object} cp        one entry of an expectations file's `checkpoints`
 * @param {{boot: Function}} adapter
 * @returns {{readings: {node: number, prop: string, actual: *}[]}}
 * @throws on the first mismatch, naming node, prop, expected and actual.
 */
export function runCheckpoint(recording, cp, adapter) {
  assertAdapter(adapter);
  const player = assertPlayer(adapter.boot(recording));
  try {
    const { seg, tRel } = placeCheckpoint(player, cp);

    player.selectSegment(cp.segment);
    player.seekTo(tRel);

    // The reconstruction is synchronous, so state is readable with no polling.
    // Nothing here reads a canvas bitmap, which is the one asynchronous part of
    // a restore — and the one thing this format cannot express: a script-less
    // frame holds correct pixels it never paints, so a pixel prop would need
    // per-player semantics no two repos have agreed.
    if (player.getSegment() !== cp.segment) {
      throw new Error(`${where(cp)}: the viewer is on segment ${player.getSegment()}`);
    }
    // The anti-clamp witness. A player that clamps a seek into [0, durMs]
    // reconstructs a different moment than the checkpoint names; if the bounds
    // above ever let such a t through, the playhead stops matching the
    // conversion and this is what notices.
    if (player.getPlayhead() !== tRel) {
      throw new Error(`${where(cp)}: the viewer clamped the seek — asked for ${tRel} ms into ` +
        `segment ${cp.segment} (origin ${seg.origin}, duration ${seg.durMs}), landed at ` +
        `${player.getPlayhead()}`);
    }

    const readings = cp.assert.map((a) => ({
      node: a.node, prop: a.prop, actual: readCheckpointProp(player, a.node, a.prop, cp),
    }));

    for (let i = 0; i < cp.assert.length; i++) {
      const expected = cp.assert[i].equals;
      const actual = readings[i].actual;
      // Every authored `equals` is a scalar, so identity is the right comparison.
      if (!Object.is(actual, expected)) {
        throw new Error(`${where(cp)}: node ${cp.assert[i].node} prop "${cp.assert[i].prop}" — ` +
          `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }

    return { readings };
  } finally {
    player.dispose();
  }
}

/**
 * Every checkpoint of one recording, in order.
 * @returns {{cp: object, readings: object[]}[]}
 */
export function runCheckpoints(recording, checkpoints, adapter) {
  return checkpoints.map((cp) => ({ cp, readings: runCheckpoint(recording, cp, adapter).readings }));
}

/**
 * The authoring guard: a checkpoint may not sit where the 0.1 ms quantisation
 * decides which events it includes.
 *
 * FOUND THE HARD WAY. A `t` midway between two events closer together than the
 * wire's own 0.1 ms grid survives no rounding: a player that rebases with
 * `round1(t − origin)` puts the checkpoint on one side and a player that
 * compares raw floats puts it on the other. Same recording, same
 * reconstruction, two moments — and neither reading is wrong; the checkpoint
 * is. So what is asserted is that the authored `t` names a moment that exists
 * at BOTH resolutions, and the fix for a failure is to move it onto an event's
 * own rounded time.
 *
 * THE ORIGIN COMES FROM THE PLAYER, never from a second reading of §3 here.
 * This guard has to be right when something else is wrong, so it must not carry
 * its own copy of the rule the player rebases by: a hand-rolled chain keeps
 * validating placements against the old order the day the player's moves.
 *
 * @returns {string[]} one message per unplaceable checkpoint; empty when clean
 */
export function placementProblems(recording, checkpoints, adapter, label = '') {
  assertAdapter(adapter);
  const player = assertPlayer(adapter.boot(recording));
  const problems = [];
  try {
    for (const cp of checkpoints) {
      // Raw wire events, player origin: the player's own event copies may already
      // be rebased, and what this compares is which RAW events fall inside the
      // checkpoint under each reading.
      const s = recording.segments[cp.segment];
      if (!s) continue;   // an out-of-range segment is placeCheckpoint's refusal, not this guard's
      const origin = player.segments[cp.segment].origin;
      const cpRel = round1(cp.t - origin);
      const quantised = s.events.map((e, i) => i).filter((i) => round1(s.events[i].t - origin) <= cpRel);
      const exact = s.events.map((e, i) => i).filter((i) => s.events[i].t <= cp.t);
      if (quantised.length !== exact.length || quantised.some((v, i) => v !== exact[i])) {
        problems.push(`${label}${label ? ' ' : ''}${where(cp)}: rounding moves the checkpoint across an event. ` +
          `Quantised it includes ${quantised.length} of the segment's events, exactly it includes ` +
          `${exact.length}. Place it on an event's own time instead of between two closer than 0.1 ms.`);
      }
    }
  } finally {
    player.dispose();
  }
  return problems;
}
