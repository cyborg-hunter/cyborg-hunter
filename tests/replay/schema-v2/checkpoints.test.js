// CH's answer to the reconstruction-level half of the corpus: the shipped
// report viewer reconstructing each fixture to a named session-relative moment
// and reading state off it through the recorded node ids.
//
// The executor is not here any more. It lifted into
// `@cyborg-hunter/sessionrecording-conformance` — the placement
// arithmetic, both bounds checks, the prop vocabulary and its refusals, the
// anti-clamp witness — behind the player adapter that package's `src/adapter.js`
// defines. CH supplies the player half in `../support/viewer-harness.js`
// (`asConformanceAdapter`) and calls the suite.
//
// THE INVARIANT THIS FILE IS SUBORDINATE TO. The viewer must never become CH's
// conformance definition. No expected value in the corpus was read off CH's
// viewer: canonical-core's four were authored in the FORK (commit 8be0ef5)
// before CH had an executor at all, and jspsych-full's ten were authored from
// the recording's own payloads and executed by the fork's player first (fork
// commit d49e4b0).
// A value CH's viewer and the fork disagree on is escalated, never adjusted.
// Moving the executor into the package strengthens that: now the fork
// runs the SAME executor over the same corpus and the two players' readings are
// compared directly.
//
// WHAT REMAINS CH-SPECIFIC, and why it did not travel. Two tests below need
// things the package does not hold. The §3 refusal needs a recording no fixture
// contains, built from `baseRecording`/`segment` — a v2 constructor pair whose
// defaults name CH's recorder. The conversion test asserts on the viewer MODEL
// directly, which is the thing the adapter hides. Both are the residue the
// schema-v2 README predicted a package lift would leave.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registerCheckpointSuite } from '@cyborg-hunter/sessionrecording-conformance/suite';
import { runCheckpoint, placeCheckpoint, round1 }
  from '@cyborg-hunter/sessionrecording-conformance/checkpoints';
import { readFixture } from '@cyborg-hunter/sessionrecording-conformance/corpus';

import { boot, baseRecording, segment, asConformanceAdapter } from '../support/viewer-harness.js';

const adapter = asConformanceAdapter(boot);

registerCheckpointSuite({ adapter });

// ---------------------------------------------------------------------------
// The one executor refusal that needs a recording no fixture contains
// ---------------------------------------------------------------------------

test('a continuation with no keyframe before it is refused, not read off a blank stage', () => {
  // The §3 defect. The viewer renders it as a defect chip over an empty body,
  // which is the right analyst behaviour and a catastrophic oracle: every
  // `exists` would read false and every checkpoint asserting absence would pass.
  const rec = baseRecording({
    segments: [segment({
      index: 0,
      events: [{ type: 'dom.attr', t: 5, node: 1, name: 'class', value: 'x' }],
    })],
  });
  assert.throws(() => runCheckpoint(rec, {
    t: 5, segment: 0, assert: [{ node: 1, prop: 'exists', equals: false }],
  }, adapter), /violates spec §3/);
});

// ---------------------------------------------------------------------------
// The conversion, stated once, against the viewer model itself
// ---------------------------------------------------------------------------

test('the executor rebases with the model\'s own forward rule, exactly', () => {
  // The conversion contract: FORWARD is `round1(t − origin)` and any consumer
  // that needs a segment-relative time must compute it the same way.
  // jspsych-full's segment 12 opens at a decimal origin (7792.599999904633),
  // which is precisely where a second reading would drift.
  const jspsych = JSON.parse(readFixture('jspsych-full.json').toString('utf8'));
  const v = boot(jspsych);
  const seg = v.model.segments[12];
  const { tRel } = placeCheckpoint(v.model, { t: 9600, segment: 12, assert: [] });
  assert.equal(tRel, round1(9600 - seg.origin));
  assert.equal(tRel, 1807.4);
  v.dbg.selectSegment(12);
  v.dbg.seek(tRel);
  assert.equal(v.dbg.getPlayhead(), tRel, 'the viewer takes the conversion unclamped');
  // And the fork places the same checkpoint at the same moment: jspsych-full
  // states `t_load: null` on all 14 segments, so §3's origin resolves to
  // `t_dom_ready`, which is exactly what the fork's player rebases by.
  assert.equal(seg.origin, seg.tDomReady);
});
