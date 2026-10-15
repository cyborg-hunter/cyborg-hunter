// tests/replay/merge.test.js
// One participant's recordings from several pages (a study on pages without
// a framework records each page on its own) joined into one replay, in
// wall-clock order (src/replay/merge.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRecorder } from '../../src/replay/recorder.js';
import { serialize } from '../../src/replay/serializer.js';
import { mergeRecordings } from '../../src/replay/merge.js';
import { validateStrict } from '../../src/shared/schema-v2-validator.js';

// A one-page recording whose wall clock starts at `epoch`, with two clicks.
function page(label, epoch, opts = {}) {
  const realNow = Date.now;
  Date.now = () => epoch;
  try {
    const rec = createRecorder({ participantId: opts.pid || 'P-MULTI', autoSave: { mode: 'none' }, _ownerSavesRecording: true });
    rec.startSession();
    rec.startTrial({ trialId: label });
    rec.pushRecord({ type: 'mouse.click', x: 1, y: 1, button: 0, target: null });
    rec.pushViewportChange({ w: 800 + epoch % 7, h: 600, dpr: 1, scale: 1, offset_x: 0, offset_y: 0 });
    rec.pushRecord({ type: 'mouse.click', x: 2, y: 2, button: 0, target: null });
    rec.endTrial();
    rec.stopSession('finished');
    return serialize(rec.getState(), {});
  } finally {
    Date.now = realNow;
  }
}

const strict = (rec) => {
  assert.deepEqual(validateStrict(rec).errors, []);
  return rec;
};

describe('mergeRecordings', () => {
  it('joins pages in wall-clock order, later pages shifted onto the first page clock', () => {
    const p1 = page('page-1', 1_000_000);
    const p2 = page('page-2', 1_060_000);   // a minute later
    const merged = strict(mergeRecordings([p2, p1]));
    assert.deepEqual(merged.segments.map((s) => s.label), ['page-1', 'page-2']);
    assert.deepEqual(merged.segments.map((s) => s.index), [0, 1]);
    assert.equal(merged.recording_started_at, p1.recording_started_at);
    const second = merged.segments[1];
    assert.equal(second.t_load, p2.segments[0].t_load + 60_000);
    assert.deepEqual(second.events.map((e) => e.t), p2.segments[0].events.map((e) => e.t + 60_000));
    // The second page's own starting viewport becomes a viewport change at its start.
    assert.ok(merged.viewport_changes.some((c) => c.t === 60_000 && c.w === p2.viewport.w));
    const ch = merged.extensions['cyborg-hunter'];
    assert.deepEqual(ch.merged_pages.map((m) => m.offset_ms), [0, 60_000]);
    assert.equal(merged.end_reason, 'finished');
    assert.ok(merged.ended_at_perf >= merged.recording_started_at_perf + second.t_end);
  });

  it('one recording comes back as it is', () => {
    const p1 = page('only', 2_000_000);
    assert.deepEqual(mergeRecordings([p1]), p1);
  });

  it('refuses recordings that overlap in time (two sessions, not two pages)', () => {
    const a = page('a', 3_000_000);
    const b = page('b', 3_000_000);
    b.ended_at_perf = b.recording_started_at_perf + 10_000;
    a.ended_at_perf = a.recording_started_at_perf + 10_000;
    assert.throws(() => mergeRecordings([a, b]), /overlap/);
  });

  it('refuses recordings of different participants', () => {
    assert.throws(() => mergeRecordings([page('a', 4_000_000), page('b', 4_100_000, { pid: 'OTHER' })]), /participant/);
  });
});
