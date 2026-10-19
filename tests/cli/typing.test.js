// tests/cli/typing.test.js
// The typing section's analysis: the rhythm rules per text field (speed:
// median gap under 60 ms or more than half the gaps under 60 ms; evenness:
// gap variation under 0.2), the verdict (one kind of rule: suspicious; both
// kinds in one field: highly suspicious), its sources (the library's
// summaries, else the recording, else not recorded) and the typing rate per
// trial (library, saved edit times, recording, old formula).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeTyping, fastTypingTrials, TYPING_LIMITS } from '../../src/cli/analyzers/typing.js';
import { applyPhaseScope } from '../../src/cli/analyzers/phase-scope.js';
import { summarizeGaps } from '../../src/shared/typing-metrics.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { keyRecording, participantFromRecording, traceTier, botGaps, humanGaps } from './typing-fixtures.js';

// A library summary for a field with these gaps, and a 0.17 trial carrying it.
const summary = (gaps, tag = 'textarea') => ({ field: { tag }, ...summarizeGaps(gaps) });
const lib = (id, rhythm, extra = {}) => ({ trialId: id, typingRhythm: rhythm, typingEdits: 0, ...extra });
const person = (n = 40) => Array.from({ length: n }, (_, i) => [140, 260, 180, 95, 420, 210, 160][i % 7]);   // median 180, CV 0.49
const even = (n = 40) => Array.from({ length: n }, (_, i) => 150 + (i % 2 ? 4 : -4));                       // median 150, CV 0.03
const fastUneven = () => [...Array(15).fill(40), ...Array(6).fill(400)];                                      // median 40, CV 1.17
const bot = (n = 40) => Array.from({ length: n }, (_, i) => 40 + (i % 3));                                    // median 41, CV 0.02
// The reason when the judged trials' segments hold no typed character in a text field.
const NO_TYPING = 'the session recording holds no typed characters in a text field of the judged trials';
// Edit times n of them, 100 ms apart.
const editTimes = (n, start = 5000) => Array.from({ length: n }, (_, i) => start + 100 * i);

describe('TYPING_LIMITS', () => {
  it('holds the calibrated values, each with its meaning', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(TYPING_LIMITS).map(([k, v]) => [k, v.value])),
      { minGaps: 20, fastGapMs: 60, fastShare: 0.5, evenCv: 0.2, minEdits: 20 });
    for (const v of Object.values(TYPING_LIMITS)) assert.ok(v.meaning.length > 40);
  });
});

describe('the rules and the verdict, from the library\'s summaries', () => {
  it('a person\'s fields: clean', () => {
    const a = analyzeTyping({ trials: [lib('q1', [summary(person())]), lib('q2', [summary(person(60), 'input')])] });
    assert.deepEqual([a.state, a.level, a.verdict, a.source], ['ok', 0, 'clean', 'library']);
    assert.equal(a.fields.length, 2);
    assert.deepEqual(a.tells, []);
    assert.equal(a.shortFields, null);   // the library keeps no record of short fields
  });
  it('fast but uneven: the speed rule alone, suspicious', () => {
    const a = analyzeTyping({ trials: [lib('q1', [summary(fastUneven())])] });
    assert.deepEqual([a.level, a.verdict], [1, 'suspicious']);
    assert.deepEqual(a.tells.map((t) => [t.id, t.level]), [['typingSpeed', 'low']]);
    assert.equal(a.tells[0].text, 'keys pressed faster than a person types: median gap 40 ms, 71% of gaps under 60 ms');
    assert.equal(a.tells[0].short, 'median gap 40 ms');
    assert.deepEqual(a.tells[0].trialIds, ['q1']);
  });
  it('even but at a human pace: the evenness rule alone, suspicious', () => {
    const a = analyzeTyping({ trials: [lib('q1', [summary(even())])] });
    assert.deepEqual(a.tells.map((t) => [t.id, t.level]), [['typingEvenness', 'low']]);
    assert.equal(a.tells[0].text, 'keys pressed too evenly: gap variation 0.03, where people vary by 0.3 or more');
    assert.equal(a.tells[0].short, 'gap variation 0.03');
  });
  it('both kinds in one field: highly suspicious, both tells high', () => {
    const a = analyzeTyping({ trials: [lib('q1', [summary(bot())]), lib('q2', [summary(person())])] });
    assert.deepEqual([a.level, a.verdict], [2, 'highly suspicious']);
    assert.deepEqual(a.tells.map((t) => [t.id, t.level]), [['typingSpeed', 'high'], ['typingEvenness', 'high']]);
    assert.deepEqual(a.fields.map((f) => [f.trialId, f.trialIndex, f.speed, f.evenness]), [['q1', 0, true, true], ['q2', 1, false, false]]);
  });
  it('the two kinds in two different fields: suspicious', () => {
    const a = analyzeTyping({ trials: [lib('q1', [summary(fastUneven())]), lib('q2', [summary(even())])] });
    assert.equal(a.level, 1);
    assert.deepEqual(a.tells.map((t) => [t.id, t.level]), [['typingSpeed', 'low'], ['typingEvenness', 'low']]);
  });
  it('the limits are strict: a 60 ms median, half the gaps under 60 ms and a variation of 0.2 fire nothing', () => {
    const f = { field: { tag: 'input' }, gaps: 30, medianMs: 60, under60Share: 0.5, cv: 0.2 };
    const a = analyzeTyping({ trials: [lib('q1', [f])] });
    assert.deepEqual([a.level, a.fields[0].speed, a.fields[0].evenness], [0, false, false]);
  });
  it('a summary under 20 gaps, or not a summary, is not judged', () => {
    const a = analyzeTyping({ trials: [lib('q1', [summary(bot(19)), null, 'x', { field: {}, gaps: 30, medianMs: 'x' }])] });
    assert.deepEqual([a.state, a.level, a.verdict, a.verdictReason], ['not assessed', -1, 'not assessed', 'no text field reached 20 key gaps']);
  });
  it('no summaries and no recording: not recorded', () => {
    const a = analyzeTyping({ trials: [{ trialId: 'q1', charsPerSec: 4 }] });
    assert.deepEqual([a.state, a.level, a.source], ['not recorded', -1, null]);
    assert.equal(a.verdictReason, 'typing rhythm not recorded (library before 0.17 or signals.typingRhythm off) and no session recording');
  });
});

describe('a field is named by its tag alone', () => {
  it('an id in a library summary is not carried into the analysis', () => {
    const a = analyzeTyping({ trials: [lib('q1', [{ ...summary(person()), field: { tag: 'textarea', id: 'answer' } }])] });
    assert.deepEqual(a.fields[0].field, { tag: 'textarea' });
  });
  it('nor an id on the recording\'s anchor', () => {
    const rec = keyRecording([['q1', 10, botGaps(30)]]);
    for (const e of rec.segments[0].events) if (e.anchor) e.anchor.id = 'answer';
    const a = analyzeTyping(participantFromRecording('ID', rec));
    assert.deepEqual(a.fields[0].field, { tag: 'textarea' });
  });
  it('the library\'s tag passes through as it is (an editable area\'s too), in lower case and at most 32 characters', () => {
    const a = analyzeTyping({ trials: [lib('q1', [summary(person(), 'div'), summary(person(), 'TEXTAREA'), summary(person(), 'x'.repeat(40))])] });
    assert.deepEqual(a.fields.map((f) => f.field), [{ tag: 'div' }, { tag: 'textarea' }, { tag: 'x'.repeat(32) }]);
  });
});

describe('from the session recording', () => {
  it('software typing (keys 40 to 42 ms apart): highly suspicious, from the recording', () => {
    const a = analyzeTyping(participantFromRecording('BOT', keyRecording([['q1', 10, botGaps(30)]])));
    assert.deepEqual([a.source, a.level], ['recording', 2]);
    assert.deepEqual([a.fields[0].gaps, a.fields[0].medianMs, a.fields[0].cv], [30, 41, 0.02]);
  });
  it('a seeded person (log-normal gaps around a 170 ms median, with pauses): clean in every field', () => {
    const a = analyzeTyping(participantFromRecording('HUMAN', keyRecording([
      ['q1', 10, humanGaps(120, 1)], ['q2', 60010, humanGaps(80, 2)], ['q3', 120010, humanGaps(40, 3)]])));
    assert.deepEqual([a.source, a.state, a.level, a.verdict], ['recording', 'ok', 0, 'clean']);
    assert.equal(a.fields.length, 3);
    for (const f of a.fields) assert.ok(f.medianMs > 150 && f.cv > 1 && f.under60Share < 0.1, JSON.stringify(f));
  });
  it('the library\'s summaries win over the recording', () => {
    const p = participantFromRecording('BOTH', keyRecording([['q1', 10, botGaps(30)]]));
    p.trials[0].typingRhythm = [summary(person())];
    const a = analyzeTyping(p);
    assert.deepEqual([a.source, a.level], ['library', 0]);
  });
  it('a field under 20 gaps in the recording counts as too short', () => {
    const a = analyzeTyping(participantFromRecording('SHORT', keyRecording([['q1', 10, botGaps(5)]])));
    assert.deepEqual([a.state, a.shortFields, a.verdictReason], ['not assessed', 1, 'no text field reached 20 key gaps']);
  });
  it('a recording that matches no trial: not recorded, and the reason says so', () => {
    const p = participantFromRecording('X', keyRecording([['q1', 10, botGaps(30)]]));
    p.trials[0].trialId = 'other';
    const a = analyzeTyping(p);
    assert.deepEqual([a.state, a.verdictReason], ['not recorded', 'typing rhythm not recorded and the session recording matches no trial']);
  });
  it('a trace-tier recording (key presses keep their field\'s tag but no target, and no input event): not recorded, and the reason says so', () => {
    const p = participantFromRecording('TRACE', traceTier(keyRecording([['q1', 10, botGaps(30)]])));
    p.trials[0].charsPerSec = 24.4;
    const a = analyzeTyping(p);
    assert.deepEqual([a.state, a.level, a.fields], ['not recorded', -1, []]);
    assert.equal(a.verdictReason, 'the session recording does not say which field each key went to (recorded without the page)');
    // Its segment holds no edit, so it is no rate source: the trial keeps
    // its saved rate, as if no segment had matched.
    assert.deepEqual(a.rate.trials.map((r) => [r.source, r.cps, r.edits, r.judged, r.fast, r.oldCps]), [['old formula', 24.4, null, true, true, null]]);
    assert.deepEqual([a.rate.source, fastTypingTrials(a)], ['old formula', 1]);
  });
  it('typing into an editable area alone: not assessed, no typed characters in a text field', () => {
    const rec = keyRecording([['q1', 10, botGaps(30)]]);
    for (const e of rec.segments[0].events) if (e.type === 'key.down') e.anchor.tag = 'div';
    const a = analyzeTyping(participantFromRecording('EDITABLE', rec));
    assert.deepEqual([a.source, a.state, a.level, a.shortFields, a.fields], ['recording', 'not assessed', -1, 0, []]);
    assert.equal(a.verdictReason, NO_TYPING);
  });
  it('key times whose gaps overflow: those gaps are left out, and no measure is NaN', () => {
    // Two keys at -1e308 and 1e308 in a row: a gap of Infinity.
    const adjacent = keyRecording([['q1', 10, botGaps(30)]]);
    const a1 = adjacent.segments[0].events.filter((e) => e.type === 'key.down');
    a1[0].t = -1e308;
    a1[1].t = 1e308;
    for (const k of a1.slice(2)) k.t = 1e308;   // the rest after it, so no gap goes backwards
    // The first and the last key that far apart: finite gaps whose sum overflows.
    const spread = keyRecording([['q1', 10, botGaps(30)]]);
    const a2 = spread.segments[0].events.filter((e) => e.type === 'key.down');
    a2[0].t = -1e308;
    a2[a2.length - 1].t = 1e308;
    const a = analyzeTyping(participantFromRecording('INF', spread));
    assert.deepEqual([a.fields[0].gaps, a.level], [28, 2]);
    for (const p of [participantFromRecording('INF', adjacent), participantFromRecording('INF', spread)]) {
      for (const f of analyzeTyping(p).fields) for (const k of ['gaps', 'medianMs', 'under60Share', 'cv']) assert.ok(Number.isFinite(f[k]), JSON.stringify(f));
    }
  });
});

describe('from the session recording, the reason is about the judged trials\' segments', () => {
  // The judged trial's segment holds no key press; the typing is elsewhere.
  const noKeys = (rec, k) => { rec.segments[k].events = [{ type: 'mouse.click', t: rec.segments[k].t_load + 50 }]; return rec; };
  it('typing only in a segment no trial matches', () => {
    const p = participantFromRecording('U', noKeys(keyRecording([['q1', 10, []], ['zzz', 60010, botGaps(30)]]), 0));
    p.trials.pop();
    assert.deepEqual([analyzeTyping(p).state, analyzeTyping(p).verdictReason], ['not assessed', NO_TYPING]);
  });
  it('typing only in a trial outside the phase scope', () => {
    const full = participantFromRecording('S', noKeys(keyRecording([['w', 10, botGaps(30)], ['m', 60010, []]]), 1));
    full.trials[0].phase = 'warm-up';
    full.trials[1].phase = 'main';
    const [scoped] = applyPhaseScope([full], { include: ['main'] });
    const a = analyzeTyping(scoped, {}, { allTrials: full.trials });
    assert.deepEqual([a.state, a.verdictReason], ['not assessed', NO_TYPING]);
  });
  it('typing only between trials (the whole-session segment)', () => {
    const p = participantFromRecording('G', noKeys(keyRecording([['q1', 10, []], ['__session__', 60010, botGaps(30)]]), 0));
    p.trials.pop();
    assert.deepEqual([analyzeTyping(p).state, analyzeTyping(p).verdictReason], ['not assessed', NO_TYPING]);
  });
});

describe('a phase-scoped participant: segments matched over every trial, only the scoped ones judged', () => {
  // Two trials called "q", a warm-up and the main one, and a recording
  // without a clock that holds only the warm-up's, typed by software.
  const warmupOnly = () => {
    const rec = keyRecording([['q', 10, botGaps(30)]]);
    delete rec.recording_started_at_perf;
    return { participantId: 'P', trials: [{ trialId: 'q', phase: 'warm-up' }, { trialId: 'q', phase: 'main' }], replay: { recording: rec } };
  };
  it('without a clock, two trials called "q" match nothing: the warm-up\'s typing is not judged in the main phase', () => {
    const full = warmupOnly();
    const [scoped] = applyPhaseScope([full], { include: ['main'] });
    const a = analyzeTyping(scoped, {}, { allTrials: full.trials });
    assert.deepEqual([a.state, a.level, a.source, a.fields], ['not recorded', -1, null, []]);
    assert.deepEqual(a.rate.trials.map((r) => [r.trialId, r.source]), [['q', 'old formula']]);
    // Matched against the scoped trials alone, the one "q" would take the warm-up's segment.
    assert.deepEqual([analyzeTyping(scoped).source, analyzeTyping(scoped).level], ['recording', 2]);
  });
  it('on the clock, each scoped trial takes its own segment', () => {
    const full = participantFromRecording('P', keyRecording([['q', 10, botGaps(30)], ['q', 60010, humanGaps(80, 2)]]));
    full.trials[0].phase = 'warm-up';
    full.trials[1].phase = 'main';
    const [scoped] = applyPhaseScope([full], { include: ['main'] });
    const a = analyzeTyping(scoped, {}, { allTrials: full.trials });
    assert.deepEqual([a.source, a.level, a.fields.map((f) => [f.trialId, f.trialIndex])], ['recording', 0, [['q', 0]]]);
    assert.deepEqual([a.byIndex.length, a.rate.trials.length], [1, 1]);
  });
  it('a recording that holds only trials outside the scope: not recorded, and the reason says so', () => {
    const full = participantFromRecording('P', keyRecording([['q', 10, botGaps(30)]]));
    full.trials[0].phase = 'warm-up';
    full.trials.push({ trialId: 'q', phase: 'main', startTime: 1000 + 60010 });
    const [scoped] = applyPhaseScope([full], { include: ['main'] });
    const a = analyzeTyping(scoped, {}, { allTrials: full.trials });
    assert.deepEqual([a.state, a.verdictReason], ['not recorded', 'typing rhythm not recorded and the session recording matches no trial in the phase scope']);
  });
});

describe('the typing rate', () => {
  it('0.17 data: the library\'s rate, judged when the library computed one', () => {
    const a = analyzeTyping({ session: { config: { thresholds: { typingSpeedCps: 10 } } }, trials: [
      { trialId: 'q1', typingEdits: 40, charsPerSec: 12.5, typingRhythm: [] },
      { trialId: 'age', typingEdits: 2, typingRhythm: [] }] });
    assert.equal(a.rate.source, 'library');
    assert.deepEqual(a.rate.trials.map((r) => [r.trialId, r.source, r.cps, r.edits, r.judged, r.fast]),
      [['q1', 'library', 12.5, 40, true, true], ['age', 'library', null, 2, false, false]]);
    assert.equal(fastTypingTrials(a), 1);
  });
  it('older data with a recording: (N − 1) over the span from 20 edits, the saved rate kept as oldCps', () => {
    const p = participantFromRecording('OLD', keyRecording([['q1', 10, Array(24).fill(100)], ['age', 60010, [170]]]));
    p.trials[0].charsPerSec = 10.4;
    p.trials[1].charsPerSec = 11.8;
    const a = analyzeTyping(p);
    assert.equal(a.rate.source, 'recording');
    // 25 edits over 2.4 s: exactly 10, which is not over 10. The age
    // trial's segment holds 2 edits: too few to judge, but its rate still
    // comes from the recording.
    assert.deepEqual(a.rate.trials.map((r) => [r.trialId, r.source, r.cps, r.edits, r.judged, r.fast, r.oldCps]),
      [['q1', 'recording', 10, 25, true, false, 10.4], ['age', 'recording', null, 2, false, false, 11.8]]);
  });
  it('a matched segment without an edit is no rate source: the trial keeps its saved rate, as if no segment had matched', () => {
    // Three trials on the recording's clock: q1's segment holds no event
    // at all, q2's a click alone, q3's one edit with no time (not an edit
    // the recording can time). Each falls back to its saved rate.
    const p = participantFromRecording('NOEDIT', keyRecording([['q1', 10, []], ['q2', 60010, []], ['q3', 120010, []]]));
    p.replay.recording.segments[0].events = [];
    p.replay.recording.segments[1].events = [{ type: 'mouse.click', t: 60060 }];
    p.replay.recording.segments[2].events = [{ type: 'input.value', t: 'x', node: 5, value: 'a' }];
    p.trials[0].charsPerSec = 12;
    p.trials[1].charsPerSec = 4;
    const a = analyzeTyping(p);
    assert.deepEqual(a.rate.trials.map((r) => [r.trialId, r.source, r.cps, r.edits, r.judged, r.fast, r.oldCps]),
      [['q1', 'old formula', 12, null, true, true, null], ['q2', 'old formula', 4, null, true, false, null], ['q3', 'old formula', null, null, false, false, null]]);
    assert.deepEqual([a.rate.source, fastTypingTrials(a)], ['old formula', 1]);
    // One timed edit is enough: then the recording is the source, though too few to judge.
    p.replay.recording.segments[1].events.push({ type: 'input.checked', t: 60070, node: 6, checked: true });
    assert.deepEqual(analyzeTyping(p).rate.trials.map((r) => [r.source, r.cps, r.edits, r.oldCps]),
      [['old formula', 12, null, null], ['recording', null, 1, 4], ['old formula', null, null, null]]);
  });
  it('older data without a recording: the saved rate under the old formula', () => {
    const a = analyzeTyping({ trials: [{ trialId: 'age', charsPerSec: 11.8 }, { trialId: 'q2' }] }, { typingSpeedThreshold_cps: 10 });
    assert.equal(a.rate.source, 'old formula');
    assert.deepEqual(a.rate.trials.map((r) => [r.source, r.cps, r.judged, r.fast]), [['old formula', 11.8, true, true], ['old formula', null, false, false]]);
  });
  it('the cutoff is the participant\'s own typingSpeedCps, else the config\'s, else 10', () => {
    const trials = [{ trialId: 'q1', charsPerSec: 9 }];
    assert.equal(analyzeTyping({ trials, session: { config: { thresholds: { typingSpeedCps: 8 } } } }).rate.trials[0].fast, true);
    assert.equal(analyzeTyping({ trials }, { typingSpeedThreshold_cps: 8.5 }).rate.trials[0].fast, true);
    assert.equal(analyzeTyping({ trials }).rate.trials[0].fast, false);
  });
  it('mixed sources: the participant\'s rate source is the weakest a judged trial used', () => {
    const p = participantFromRecording('MIX', keyRecording([['q2', 60010, Array(24).fill(100)]]));
    p.trials.unshift({ trialId: 'q1', startTime: 5, charsPerSec: 3 });   // not in the recording
    const a = analyzeTyping(p);
    assert.deepEqual(a.rate.trials.map((r) => r.source), ['old formula', 'recording']);
    assert.equal(a.rate.source, 'old formula');
  });
  it('byTrial: each trial\'s judged rate and whether a rhythm rule fired in it', () => {
    const a = analyzeTyping({ trials: [lib('q1', [summary(bot())], { typingEdits: 41, charsPerSec: 24.4 }),
      lib('q2', [summary(person())], { typingEdits: 41, charsPerSec: 5.1 }), lib('q3', [], { typingEdits: 3 })] });
    assert.deepEqual({ ...a.byTrial }, { q1: { cps: 24.4, judged: true, rhythm: true }, q2: { cps: 5.1, judged: true, rhythm: false }, q3: { cps: null, judged: false, rhythm: false } });
    assert.deepEqual(a.byIndex, [{ cps: 24.4, judged: true, rhythm: true }, { cps: 5.1, judged: true, rhythm: false }, { cps: null, judged: false, rhythm: false }]);
  });
});

describe('the typing rate from saved edit times (data saved with keystroke dynamics on)', () => {
  it('25 edit times 100 ms apart and a saved rate of 11.8: 10 cps from the edit times', () => {
    const a = analyzeTyping({ trials: [{ trialId: 'q1', editTimestamps: editTimes(25), charsPerSec: 11.8 }] });
    assert.equal(a.rate.source, 'edit times');
    assert.deepEqual(a.rate.trials.map((r) => [r.source, r.cps, r.edits, r.judged, r.fast, r.oldCps]),
      [['edit times', 10, 25, true, false, 11.8]]);
  });
  it('the edit times come before the recording, the library before the edit times', () => {
    const p = participantFromRecording('ET', keyRecording([['q1', 10, botGaps(30)], ['q2', 60010, botGaps(30)]]));
    p.trials[0].editTimestamps = editTimes(25);
    Object.assign(p.trials[1], { editTimestamps: editTimes(25), typingEdits: 25, charsPerSec: 9.6 });
    const a = analyzeTyping(p);
    assert.deepEqual(a.rate.trials.map((r) => [r.source, r.cps]), [['edit times', 10], ['library', 9.6]]);
  });
  it('an empty list (keystroke dynamics off), or one without a number, is no source', () => {
    const a = analyzeTyping({ trials: [{ trialId: 'q1', editTimestamps: [], charsPerSec: 4 }, { trialId: 'q2', editTimestamps: ['x', null], charsPerSec: 5 }] });
    assert.deepEqual(a.rate.trials.map((r) => [r.source, r.cps]), [['old formula', 4], ['old formula', 5]]);
  });
  it('edit times out of order are read in time order; fewer than 20 are not judged', () => {
    const a = analyzeTyping({ trials: [{ trialId: 'q1', editTimestamps: editTimes(25).reverse() },
      { trialId: 'q2', editTimestamps: [5000, 'x', 5100, 5200, 5300, 5400], charsPerSec: 12 }] });
    assert.deepEqual(a.rate.trials.map((r) => [r.source, r.cps, r.edits, r.judged, r.oldCps]),
      [['edit times', 10, 25, true, null], ['edit times', null, 5, false, 12]]);
  });
  it('the participant\'s rate source: old formula, then recording, then edit times, then library', () => {
    const source = (trials) => analyzeTyping({ trials }).rate.source;
    const judged = { lib: { trialId: 'a', typingEdits: 25, charsPerSec: 5 }, times: { trialId: 'b', editTimestamps: editTimes(25) }, old: { trialId: 'c', charsPerSec: 5 } };
    assert.equal(source([judged.lib, judged.times]), 'edit times');
    assert.equal(source([judged.times, judged.old]), 'old formula');
    const p = participantFromRecording('R', keyRecording([['q1', 10, Array(24).fill(100)]]));
    p.trials.push(judged.times);
    assert.equal(analyzeTyping(p).rate.source, 'recording');
    // No trial judged: the strongest source there is.
    assert.equal(source([{ trialId: 'a', editTimestamps: editTimes(3) }, { trialId: 'b' }]), 'edit times');
  });
});

describe('hostile data', () => {
  it('never throws, whatever the participant holds', () => {
    const junk = [null, 7, 'x', {}, { trials: 'x' },
      { trials: [null, 5, { trialId: { toString: null }, typingRhythm: 'x', typingEdits: NaN, charsPerSec: 'fast', editTimestamps: 'x' }] },
      { trials: [{ trialId: 'q1', typingRhythm: [null, { field: null }, { field: { tag: 5 }, gaps: 30, medianMs: 40, under60Share: 1, cv: 0.01 }] }] },
      { trials: [{ trialId: 'q1', startTime: 'x' }], replay: { recording: { schema_version: 2, segments: [{ label: 'q1', events: [null, { type: 'key.down', key: {}, t: 1 }] }] } } },
      { trials: [{ trialId: 'q1' }], session: { config: { thresholds: { typingSpeedCps: 'x' } } }, replay: 'x' },
      { trials: [{ trialId: 'q1', editTimestamps: [null, {}, NaN, Infinity, 'x'] }], session: 'x', replay: { recording: 'x' } }];
    for (const p of junk) assert.doesNotThrow(() => analyzeTyping(p));
    for (const p of junk) for (const c of [null, 'x', 5]) assert.doesNotThrow(() => analyzeTyping(p, c, c));
  });
  it('nothing usable: an empty, well-formed analysis', () => {
    const a = analyzeTyping(null);
    assert.deepEqual({ ...a, byTrial: { ...a.byTrial } }, {
      state: 'not recorded', level: -1, verdict: 'not assessed',
      verdictReason: 'typing rhythm not recorded (library before 0.17 or signals.typingRhythm off) and no session recording',
      source: null, tells: [], fields: [], shortFields: null,
      rate: { source: 'old formula', cutoffCps: 10, trials: [] }, byTrial: {}, byIndex: [],
      limits: { minGaps: 20, fastGapMs: 60, fastShare: 0.5, evenCv: 0.2, minEdits: 20 } });
    // A recording that is not an object is no recording.
    assert.equal(analyzeTyping({ trials: [{ trialId: 'q1' }], replay: { recording: 'x' } }).verdictReason,
      'typing rhythm not recorded (library before 0.17 or signals.typingRhythm off) and no session recording');
  });
  it('a summary whose numbers are out of range is not a summary', () => {
    const ok = { field: { tag: 'input' }, gaps: 30, medianMs: 40, under60Share: 1, cv: 0.01 };
    const a = analyzeTyping({ trials: [lib('q1', [{ ...ok, under60Share: 5 }, { ...ok, under60Share: -0.1 }, { ...ok, medianMs: -1 },
      { ...ok, cv: -0.5 }, { ...ok, gaps: 30.5 }, { ...ok, medianMs: Infinity }, { ...ok, field: 'textarea' }])] });
    assert.deepEqual([a.state, a.fields], ['not assessed', []]);
  });
  it('junk options: allTrials that is not a list matches the scoped trials; a list without them matches nothing', () => {
    const p = participantFromRecording('J', keyRecording([['q1', 10, botGaps(30)]]));
    for (const o of [null, 'x', 5, { allTrials: 'x' }, { allTrials: null }]) assert.equal(analyzeTyping(p, {}, o).level, 2);
    for (const o of [{ allTrials: [] }, { allTrials: [null, 5, 'x', { trialId: 'q1' }] }]) {
      assert.deepEqual([analyzeTyping(p, {}, o).state, analyzeTyping(p, {}, o).level], ['not recorded', -1]);
    }
  });
  it('200,000 summaries that all fire: judged, without overflowing the stack', () => {
    const f = { field: { tag: 'input' }, gaps: 30, medianMs: 40, under60Share: 1, cv: 0.01 };
    const a = analyzeTyping({ trials: [lib('q1', Array(200000).fill(f))] });
    assert.deepEqual([a.level, a.fields.length, a.tells.map((t) => t.short)], [2, 200000, ['median gap 40 ms', 'gap variation 0.01']]);
  });
});

describe('the bundled demo sessions', () => {
  const load = (id) => {
    const p = extractIntegrityData(JSON.parse(readFileSync(`examples/demo-sessions/data/${id}.json`, 'utf8')), { participantIdField: 'participantId' });
    try { p.replay = { recording: JSON.parse(readFileSync(`examples/demo-sessions/data/${id}.replay.json`, 'utf8')) }; } catch { /* DEMO-9mop has none */ }
    return p;
  };
  it('DEMO-bsq6, the GPT agent: all three rules fire on its first text box, read from the recording', () => {
    const a = analyzeTyping(load('DEMO-bsq6'));
    assert.deepEqual([a.source, a.state, a.level, a.verdict], ['recording', 'ok', 2, 'highly suspicious']);
    assert.deepEqual(a.fields, [{ trialId: 'baseline', trialIndex: 0, field: { tag: 'textarea' }, gaps: 23, medianMs: 57.9, under60Share: 0.696, cv: 0.067, speed: true, evenness: true }]);
    assert.deepEqual(a.tells.map((t) => t.text), [
      'keys pressed faster than a person types: median gap 58 ms, 70% of gaps under 60 ms',
      'keys pressed too evenly: gap variation 0.07, where people vary by 0.3 or more']);
    const r = Object.fromEntries(a.rate.trials.map((x) => [x.trialId, x]));
    assert.deepEqual([r.baseline.cps, r.autotype.cps, r.paste.cps, r.paste.edits, r.paste.oldCps], [16.9, 28.6, null, 2, 157.5]);
    assert.deepEqual([a.rate.source, fastTypingTrials(a)], ['recording', 2]);
    // The three trials whose segments hold no edit keep their saved rate (none).
    assert.deepEqual(a.rate.trials.map((x) => [x.trialId, x.source]), [['baseline', 'recording'], ['paste', 'recording'],
      ['tabaway', 'old formula'], ['autotype', 'recording'], ['guard-entry', 'old formula'], ['guard', 'old formula']]);
  });
  it('Mira\'s sessions: nothing judged from their recordings; the old formula where a recording holds no edit', () => {
    const w = analyzeTyping(load('DEMO-681w'));
    assert.deepEqual([w.state, w.verdictReason, w.rate.source, fastTypingTrials(w)], ['not assessed', NO_TYPING, 'old formula', 2]);
    // Its recording covers the last pass through the tour, trials 11 to 16,
    // and holds no edit: those trials keep their saved rates too.
    assert.deepEqual(w.rate.trials.map((x) => x.source), Array(17).fill('old formula'));
    assert.deepEqual(w.rate.trials.slice(11).map((x) => [x.cps, x.edits, x.judged]), Array(6).fill([null, null, false]));
    // Three trials are called "baseline": byTrial merges them.
    assert.deepEqual({ ...w.byTrial.baseline }, { cps: 10.5, judged: true, rhythm: false });
    // byIndex keeps them apart: one entry per trial, in order.
    assert.equal(w.byIndex.length, w.rate.trials.length);
    const a3 = analyzeTyping(load('DEMO-a3f3'));
    // Its text box saw only Cmd+V and Tab: no typed character.
    assert.deepEqual([a3.state, a3.verdictReason, a3.shortFields, a3.rate.source, fastTypingTrials(a3)], ['not assessed', NO_TYPING, 0, 'recording', 1]);
    // Its first and its autotype trial's segments hold edits; the rest none.
    assert.deepEqual(a3.rate.trials.map((x) => [x.source, x.edits]), [['recording', 1], ['old formula', null], ['old formula', null],
      ['old formula', null], ['recording', 44], ['old formula', null], ['old formula', null]]);
    const m = analyzeTyping(load('DEMO-9mop'));
    assert.deepEqual([m.state, m.rate.source, fastTypingTrials(m)], ['not recorded', 'old formula', 0]);
  });
});
