// tests/cli/typing-recording.test.js
// Reading typing from a session recording (SessionRecording v2): which
// segment holds which trial, the gaps between key presses per text field,
// and the edit times the typing rate is computed from.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchTrialSegments, recordingKeyGaps, recordingEditTimes } from '../../src/cli/analyzers/typing.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';

const NO_MODS = { ctrl: false, shift: false, alt: false, meta: false };
const key = (t, k, node = 7, tag = 'textarea', extra = {}) => ({ type: 'key.down', t, key: k, code: 'Key' + k.toUpperCase(), mods: NO_MODS, repeat: false, target: node,
  anchor: { tag, id: null, rect: { x: 0, y: 0, w: 300, h: 80 }, node }, ...extra });
const seg = (label, t_load, events = []) => ({ index: 0, label, t_load, events });
const rec = (segments, base = 1000) => ({ schema_version: 2, recording_started_at_perf: base, segments });
const trial = (trialId, startTime) => ({ trialId, startTime });

describe('matchTrialSegments', () => {
  it('matches a trial to the segment with its id that starts on its clock', () => {
    const s1 = seg('q1', 10), s2 = seg('q2', 5010);
    assert.deepEqual(matchTrialSegments([trial('q1', 1010), trial('q2', 6012)], rec([s1, s2])), [s1, s2]);
  });
  it('a repeated id is told apart by the clock; a trial the recording does not cover gets none', () => {
    const late = seg('baseline', 50000);
    assert.deepEqual(matchTrialSegments([trial('baseline', 2000), trial('baseline', 51000)], rec([late])), [null, late]);
  });
  it('without a clock, only an id unique among the trials and the segments matches', () => {
    const r = rec([seg('q1', 10), seg('q2', 20), seg('q2', 30)]);
    delete r.recording_started_at_perf;
    const out = matchTrialSegments([trial('q1', 5), trial('q2', 6), trial('q2', 7)], r);
    assert.deepEqual(out.map((s) => s && s.t_load), [10, null, null]);
  });
  it('a unique id still matches when the clocks disagree (pages joined onto another clock)', () => {
    const s = seg('q1', 10);
    assert.deepEqual(matchTrialSegments([trial('q1', 999999)], rec([s])), [s]);
  });
  it('of two trials with one id inside the tolerance, the closer one gets the segment', () => {
    // A short first trial and only the second one recorded: the segment
    // starts 900 ms after the first trial and on the second one's clock.
    const s = seg('guard', 900);
    assert.deepEqual(matchTrialSegments([trial('guard', 1000), trial('guard', 1900)], rec([s])), [null, s]);
  });
  it('a segment without t_load starts at t_dom_ready, then t_start, then its first event', () => {
    const a = { label: 'a', t_load: null, t_dom_ready: 20, t_start: 5, events: [] };
    const b = { label: 'b', t_load: null, t_dom_ready: null, t_start: 30, events: [] };
    const c = { label: 'c', events: [{ type: 'mouse.move', t: 'x' }, { type: 'mouse.move', t: 40, x: 0, y: 0 }] };
    const trials = [trial('a', 1020), trial('a', 5000), trial('b', 1030), trial('b', 5000), trial('c', 1040), trial('c', 5000)];
    assert.deepEqual(matchTrialSegments(trials, rec([a, b, c])), [a, null, b, null, c, null]);
  });
  it('the whole-session segment never matches, even a trial with its label', () => {
    assert.deepEqual(matchTrialSegments([trial('__session__', 1010)], rec([seg('__session__', 10)])), [null]);
  });
  it('a trial without a usable id matches nothing, not even a segment named after its place', () => {
    const s = seg('q1', 10);
    const out = matchTrialSegments([trial('q1', 1010), { startTime: 5000 }, { trialId: {}, startTime: 5000 }], rec([s, seg('trial 2', 4000), seg('trial 3', 4000)]));
    assert.deepEqual(out, [s, null, null]);
  });
  it('a trial that is not an object gets none, and the rest still match', () => {
    const s = seg('q1', 10);
    assert.deepEqual(matchTrialSegments([null, trial('q1', 1010), 7, 'q1', ['q1']], rec([s])), [null, s, null, null, null]);
  });
  it('anything else matches nothing and never throws', () => {
    const junk = [null, 7, 'x', {}, { schema_version: 2 }, { schema_version: 2, segments: 'x' }, { schema_version: 1, segments: [seg('q1', 0)] },
      { schema_version: 2, recording_started_at_perf: 'x', segments: [null, { label: 5 }, { label: 'q1', t_load: 'x', events: 'x' }, { label: 'q1', events: [null, { t: 'x' }] }] }];
    for (const r of junk) assert.doesNotThrow(() => matchTrialSegments([trial('q1', 0), { trialId: { toString: null } }], r));
    assert.deepEqual(matchTrialSegments([trial('q1', 0)], null), [null]);
    for (const trials of [null, undefined, 'q1', { length: 2 }]) assert.deepEqual(matchTrialSegments(trials, rec([seg('q1', 0)])), []);
  });
});

describe('recordingKeyGaps', () => {
  it('per text field: the gaps between printable key presses, same-key gaps left out', () => {
    const out = recordingKeyGaps(seg('q1', 0, [key(100, 'a'), key(250, 'b'), key(300, 'b'), key(420, 'c'), key(500, 'x', 8, 'input')]));
    assert.deepEqual(out, [{ field: { tag: 'textarea' }, gaps: [150, 120] }, { field: { tag: 'input' }, gaps: [] }]);
  });
  it('leaves out repeats, Ctrl and Meta chords, named keys, keys outside text fields and keys without a time', () => {
    const out = recordingKeyGaps(seg('q1', 0, [
      key(100, 'a'),
      key(150, 'b', 7, 'textarea', { repeat: true }),
      key(200, 'c', 7, 'textarea', { mods: { ...NO_MODS, ctrl: true } }),
      key(250, 'v', 7, 'textarea', { mods: { ...NO_MODS, meta: true } }),
      { ...key(300, 'a'), key: 'Backspace' },
      key(350, 'd', 9, 'body'),
      { ...key(400, 'e'), t: 'x' },
      key(500, 'f'),
    ]));
    assert.deepEqual(out, [{ field: { tag: 'textarea' }, gaps: [400] }]);
  });
  it('a key the browser gave no code for is compared by its key', () => {
    // The recorder writes code: '' when the browser reports none.
    const noCode = (t, k) => key(t, k, 7, 'textarea', { code: '' });
    const out = recordingKeyGaps(seg('q1', 0, [noCode(100, 'a'), noCode(200, 'b'), noCode(300, 'b'), noCode(450, 'c')]));
    assert.deepEqual(out, [{ field: { tag: 'textarea' }, gaps: [100, 150] }]);
  });
  it('names a field by its tag in lower case, and never by its id', () => {
    const out = recordingKeyGaps(seg('q1', 0, [key(100, 'a', 7, 'TEXTAREA'), { ...key(200, 'b', 8, 'INPUT'), anchor: { tag: 'INPUT', id: 'answer', node: 8 } }]));
    assert.deepEqual(out, [{ field: { tag: 'textarea' }, gaps: [] }, { field: { tag: 'input' }, gaps: [] }]);
  });
  it('never throws on junk', () => {
    const junk = [null, 'x', { type: 'key.down' }, { type: 'key.down', t: 1, key: 'a', anchor: 'x', target: 1 },
      { type: 'key.down', t: 1, key: 'a', anchor: { tag: { toString: null } }, target: 1 }, { type: 'key.down', t: 1, key: 'a', anchor: { tag: 'input', id: 7 }, target: 'n' },
      { type: 'key.down', t: 2, redacted: true }, { type: 'key.down', t: 3, key: 'b', mods: 'x', anchor: { tag: 'input' }, target: 1 }];
    assert.doesNotThrow(() => recordingKeyGaps({ events: junk }));
    for (const s of [null, undefined, 'x', 7, [], { events: 'x' }, { events: null }]) assert.deepEqual(recordingKeyGaps(s), []);
  });
});

describe('recordingEditTimes', () => {
  it('every input.value and input.checked time, in order', () => {
    const s = seg('q1', 0, [{ type: 'input.value', t: 300, node: 1, value: 'ab' }, { type: 'input.checked', t: 100, node: 2, checked: true },
      { type: 'input.select', t: 200 }, { type: 'input.value', t: 'x' }]);
    assert.deepEqual(recordingEditTimes(s), [100, 300]);
  });
  it('counts a redacted field\'s edits too, and never throws on junk', () => {
    assert.deepEqual(recordingEditTimes(seg('q1', 0, [null, 7, { type: 'input.value', t: 50, node: 1, redacted: true, value_len: 3 }])), [50]);
    for (const s of [null, undefined, 'x', 7, [], { events: 'x' }]) assert.deepEqual(recordingEditTimes(s), []);
  });
});

describe('the demo agent\'s recording (DEMO-bsq6)', () => {
  const recording = JSON.parse(readFileSync('examples/demo-sessions/data/DEMO-bsq6.replay.json', 'utf8'));
  it('its first text box: 24 keys, 23 gaps, 24 edits', () => {
    const baseline = recording.segments.find((s) => s.label === 'baseline');
    const [f, ...rest] = recordingKeyGaps(baseline);
    assert.deepEqual(rest, []);
    assert.deepEqual(f.field, { tag: 'textarea' });
    assert.equal(f.gaps.length, 23);
    assert.equal(recordingEditTimes(baseline).length, 24);
  });
});

describe('a recording that covers the end of a session (DEMO-681w)', () => {
  it('its six trial segments match the last six of 17 trials by clock; the earlier trials with the same ids get none', () => {
    const recording = JSON.parse(readFileSync('examples/demo-sessions/data/DEMO-681w.replay.json', 'utf8'));
    const { trials } = extractIntegrityData(JSON.parse(readFileSync('examples/demo-sessions/data/DEMO-681w.json', 'utf8')), {});
    assert.equal(trials.length, 17);
    const out = matchTrialSegments(trials, recording);
    assert.deepEqual(out.slice(0, 11), Array(11).fill(null));
    // The very segment objects, in recording order (the analysis looks a
    // trial's segment up by position).
    out.slice(11).forEach((s, k) => assert.equal(s, recording.segments[k]));
    assert.deepEqual(out.slice(11).map((s) => s.label), ['baseline', 'paste', 'tabaway', 'autotype', 'guard-entry', 'guard']);
  });
});
