import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCanvas } from 'canvas';
import { drawTypingProfile } from '../../src/cli/renderers/typing-profile-core.js';

// Smoke test for the typing-profile renderer. The P8 change introduced a
// third bar state (paste-only, hatched) distinct from "typed" and "no-data".
// We can't easily diff pixels, so the test just verifies the renderer runs
// end-to-end on a mixed participant and produces a non-trivial PNG.
// drawTypingProfile returns the drawn canvas, or null when the report writes
// no typing_profile PNG for the participant.
const CONFIG = { typingSpeedThreshold_cps: 10 };
const pngBytes = (participant) => {
  const canvas = drawTypingProfile(participant, CONFIG, createCanvas);
  return canvas ? canvas.toBuffer('image/png').length : null;
};

describe('drawTypingProfile (P8 paste-only markers)', () => {
  it('renders a mixed typed + paste-only + no-data participant without crashing', () => {
    const participant = {
      participantId: 'P-MIXED',
      trials: [
        // typed, below threshold
        { trialId: 'r1', charsPerSec: 4.2, pasteEvents: [] },
        // typed, above threshold
        { trialId: 'r2', charsPerSec: 15.0, pasteEvents: [] },
        // paste-only: single paste, no editTimestamps ≥ 2, so charsPerSec is null
        { trialId: 'r3', charsPerSec: null, pasteEvents: [{ t: 100, length: 63 }] },
        // no-data: neither typing nor paste (e.g., empty response)
        { trialId: 'r4', charsPerSec: null, pasteEvents: [] }
      ]
    };

    const size = pngBytes(participant);

    // PNG should exist and be non-trivially sized. A blank 0-byte file would
    // indicate the renderer bailed; a few hundred bytes means it drew stuff.
    assert.notStrictEqual(size, null, 'expected a typing_profile PNG');
    assert.ok(size > 1000, 'PNG should be larger than a blank canvas');
  });

  it('skips rendering when every trial is no-data (no typed AND no paste)', () => {
    const participant = {
      participantId: 'P-EMPTY',
      trials: [
        { trialId: 'r1', charsPerSec: null, pasteEvents: [] },
        { trialId: 'r2', charsPerSec: null, pasteEvents: [] }
      ]
    };

    const size = pngBytes(participant);

    // No bars to show → renderer should skip this participant entirely.
    assert.strictEqual(size, null, 'renderer should skip participants with only no-data trials');
  });

  it('renders a mixed paste+type trial without crashing (typed bar + P marker)', () => {
    // Participant who typed enough to get a CPS (≥ 2 edit timestamps) AND
    // also pasted. P8 extension: show the colored bar as usual, with a "P"
    // marker above it to flag the paste. Different from paste-only, which
    // has no bar fill (hatched only).
    const participant = {
      participantId: 'P-MIXED-TRIAL',
      trials: [
        { trialId: 'r1', charsPerSec: 5.0, pasteEvents: [{ t: 100, length: 20 }] }
      ]
    };

    const size = pngBytes(participant);

    assert.notStrictEqual(size, null, 'mixed paste+type trial should render');
    assert.ok(size > 1000, 'PNG should include bar + P marker');
  });

  it('renders a paste-only-only participant (no typed trials) — P8 regression case', () => {
    // This is the exact shape of participant 69b594dccc64df571f092147 that
    // originally surfaced the bug: mostly paste-only responses. Pre-P8 this
    // would have been skipped (speeds all 0) or drawn with invisible bars.
    const participant = {
      participantId: 'P-PASTE',
      trials: [
        { trialId: 'r1', charsPerSec: null, pasteEvents: [{ t: 100, length: 40 }] },
        { trialId: 'r2', charsPerSec: null, pasteEvents: [{ t: 200, length: 55 }] },
        { trialId: 'r3', charsPerSec: 3.5, pasteEvents: [] }
      ]
    };

    const size = pngBytes(participant);

    assert.notStrictEqual(size, null, 'paste-only-dominant participant should still render');
    assert.ok(size > 1000, 'PNG should include the hatched markers');
  });
});
