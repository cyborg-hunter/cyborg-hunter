// tests/cli/typing-report.test.js
// The typing section in the report: it rides on each summary
// (typingAnalysis), recounts fast typing where it recomputed a rate from
// saved edit times or the recording, writes typing-limits.json, adds a
// clause to the triage reason and a weight (typingRhythm) to the score table.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, REPORT_FILES } from '../../src/cli/report-core.js';
import { SCORE_SIGNALS, SIGNAL_LABELS, resolveScoreWeights, formulaText } from '../../src/cli/analyzers/score-weights.js';
import { TYPING_LIMITS } from '../../src/cli/analyzers/typing.js';
import { VERSION } from '../../src/shared/constants.js';
import { keyRecording, participantFromRecording, botGaps, humanGaps } from './typing-fixtures.js';

const config = { outputDir: '.', participantIdField: 'participantId' };
async function report(participants, cfg = config) {
  const files = {};
  const built = await buildReport(participants, cfg, { sink: (p, body) => { files[p] = body; } });
  return { built, files, byId: Object.fromEntries(built.summaries.map((s) => [s.participantId, s])) };
}
// Software typing in a recording (30 gaps, 40 to 42 ms); a seeded person
// (120 gaps); data from before 0.17 with neither summaries nor a recording.
const BOT = () => participantFromRecording('BOT', keyRecording([['q1', 10, botGaps(30)]]));
const HUMAN = () => participantFromRecording('HUMAN', keyRecording([['q1', 10, humanGaps(120, 1)]]));
const OLD = () => ({ participantId: 'OLD', trials: [{ trialId: 'age', startTime: 0, duration_ms: 1000, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0, charsPerSec: 11.8 }] });
// The old formula's 11.8 cps beside the trial's saved edit times (data saved
// with keystroke dynamics on): 25 edits 100 ms apart, 10 cps, not over the
// cutoff of 10.
const TIMES = () => ({ participantId: 'TIMES', trials: [{ ...OLD().trials[0], editTimestamps: Array.from({ length: 25 }, (_, i) => 5000 + 100 * i) }] });
// A recording without the page (trace tier): its key presses keep their
// field's tag but name no field.
const TRACE = () => {
  const rec = keyRecording([['q1', 10, botGaps(30)]]);
  for (const e of rec.segments[0].events) if (e.type === 'key.down') { e.target = null; e.anchor.node = null; }
  return participantFromRecording('TRACE', rec);
};

describe('typingAnalysis on each summary', () => {
  it('rides on the summary, and fast typing is recounted where the rate came from the recording', async () => {
    const age = participantFromRecording('AGE', keyRecording([['age', 10, [170]]]));
    age.trials[0].charsPerSec = 11.8;           // the old formula: 2 keys 0.17 s apart
    const { byId } = await report([BOT(), age, OLD()]);
    assert.equal(byId.BOT.typingAnalysis.level, 2);
    assert.equal(byId.BOT.trialsWithFastTyping, 1);   // 31 edits, 24.4 cps from the recording
    assert.equal(byId.AGE.trialsWithFastTyping, 0);   // recomputed: 2 edits are not judged
    assert.equal(byId.OLD.trialsWithFastTyping, 1);   // no recording: the saved rate stands
    assert.equal(byId.OLD.typingAnalysis.rate.source, 'old formula');
  });
  it('fast typing is recounted where the rate came from saved edit times', async () => {
    const { byId, files } = await report([TIMES()]);
    assert.deepEqual([byId.TIMES.typingAnalysis.rate.source, byId.TIMES.trialsWithFastTyping], ['edit times', 0]);
    assert.deepEqual(JSON.parse(files['typing-limits.json']).sessions.rateSource, { library: 0, editTimes: 1, recording: 0, oldFormula: 0 });
  });
  it('a reduced payload keeps its carried count, even where the recording gives a kept trial its rate', async () => {
    const p = BOT();
    p.reducedPayload = { level: 3, totals: { fastTypingTrials: 8 } };
    const { byId } = await report([p]);
    assert.deepEqual(byId.BOT.typingAnalysis.rate.trials.map((r) => [r.source, r.fast]), [['recording', true]]);
    assert.equal(byId.BOT.trialsWithFastTyping, 8);
  });
  // A reduced payload whose two kept trials the recording does not judge
  // (2 edits each); the first one's old formula saved 11.8 cps.
  const REDUCED = (totals) => {
    const p = participantFromRecording('R', keyRecording([['a', 10, [170]], ['b', 60010, [200]]]));
    p.trials[0].charsPerSec = 11.8;
    for (const t of p.trials) t.phase = 'main';
    p.reducedPayload = { level: 3, totals };
    return p;
  };
  it('a reduced payload under a phase scope is recounted: its summary counted the kept rows, not the carried count', async () => {
    const { byId } = await report([REDUCED({ fastTypingTrials: 8 })], { ...config, phaseScope: { include: ['main'] } });
    assert.equal(byId.R.trialsWithFastTyping, 0);
  });
  it('a reduced payload that carries no usable count is recounted', async () => {
    for (const totals of [null, {}, { fastTypingTrials: -1 }]) {
      const { byId } = await report([REDUCED(totals)]);
      assert.equal(byId.R.trialsWithFastTyping, 0, JSON.stringify(totals));
    }
  });
  it('writes typing-limits.json right after cursor-limits.json: the constants, the sources and the verdicts', async () => {
    assert.equal(REPORT_FILES.indexOf('typing-limits.json'), REPORT_FILES.indexOf('cursor-limits.json') + 1);
    const { files } = await report([BOT(), HUMAN(), OLD()]);
    const j = JSON.parse(files['typing-limits.json']);
    assert.equal(j.cliVersion, VERSION);
    assert.equal(j.recordedWith, '0.16.0');
    assert.deepEqual(j.limits, TYPING_LIMITS);
    assert.deepEqual(j.sessions, { total: 3,
      rhythmSource: { library: 0, recording: 2, notRecorded: 1 },
      rateSource: { library: 0, editTimes: 0, recording: 2, oldFormula: 1 },
      verdicts: { highlySuspicious: 1, suspicious: 0, clean: 1, notAssessed: 1 } });
  });
  it('typing-limits.json: a recording without the page counts as rhythm not recorded, its rate as from the recording', async () => {
    const { byId, files } = await report([TRACE()]);
    assert.deepEqual([byId.TRACE.typingAnalysis.state, byId.TRACE.typingAnalysis.source], ['not recorded', 'recording']);
    assert.deepEqual(JSON.parse(files['typing-limits.json']).sessions, { total: 1,
      rhythmSource: { library: 0, recording: 0, notRecorded: 1 },
      rateSource: { library: 0, editTimes: 0, recording: 1, oldFormula: 0 },
      verdicts: { highlySuspicious: 0, suspicious: 0, clean: 0, notAssessed: 1 } });
  });
});

describe('a phase-scoped report judges typing inside the scope only', () => {
  // A tutorial typed by software, then the main trial typed by a person.
  const TUTORED = () => {
    const p = participantFromRecording('TUT', keyRecording([['tutorial', 10, botGaps(30)], ['main', 60010, humanGaps(120, 1)]]));
    p.trials[0].phase = 'tutorial';
    p.trials[1].phase = 'main';
    return p;
  };
  const weighted = { ...config, scoreWeights: { typingRhythm: 1 } };
  const typingTerm = (row) => row.terms.find(([k]) => k === 'typingRhythm');
  it('the tutorial left out: clean, and typingRhythm adds 0', async () => {
    const { built, byId } = await report([TUTORED()], { ...weighted, phaseScope: { exclude: ['tutorial'] } });
    assert.deepEqual([byId.TUT.typingAnalysis.verdict, byId.TUT.typingAnalysis.level], ['clean', 0]);
    assert.deepEqual(typingTerm(built.triage[0]), ['typingRhythm', 0]);
    assert.equal(byId.TUT.trialsWithFastTyping, 0);
  });
  it('without a scope: highly suspicious, from the tutorial', async () => {
    const { built, byId } = await report([TUTORED()], weighted);
    assert.deepEqual([byId.TUT.typingAnalysis.verdict, byId.TUT.typingAnalysis.level], ['highly suspicious', 2]);
    assert.deepEqual(typingTerm(built.triage[0]), ['typingRhythm', 2]);
    assert.equal(byId.TUT.trialsWithFastTyping, 1);
  });
  it('a warm-up trial keeps its own segment: the main trial of the same id is not judged from it', async () => {
    // Two trials called "q", a warm-up and the main one, and a recording
    // without a clock that holds only the warm-up's, typed by software.
    const rec = keyRecording([['q', 10, botGaps(30)]]);
    delete rec.recording_started_at_perf;
    const trial = (phase) => ({ trialId: 'q', phase, duration_ms: 1000, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0 });
    const p = { participantId: 'WARM', trials: [trial('warm-up'), trial('main')], replay: { recording: rec } };
    const { byId } = await report([p], { ...config, phaseScope: { include: ['main'] } });
    const a = byId.WARM.typingAnalysis;
    assert.deepEqual([a.state, a.level, a.source, a.fields], ['not recorded', -1, null, []]);
    assert.deepEqual(a.rate.trials.map((r) => [r.trialId, r.source]), [['q', 'old formula']]);
  });
});

describe('the typingRhythm weight', () => {
  it('is a registered key, default 0, labelled "typing verdict (typingRhythm)", counting the level', () => {
    const sig = SCORE_SIGNALS.find((s) => s.key === 'typingRhythm');
    assert.ok(sig);
    assert.equal(sig.weight, 0);
    assert.equal(SIGNAL_LABELS.typingRhythm, 'typing verdict (typingRhythm)');
    assert.equal(sig.hint, 'ranking weight × verdict level: suspicious 1, highly suspicious 2; the tier is unchanged.');
    assert.equal(sig.count({ typingAnalysis: { level: 2 } }), 2);
    assert.equal(sig.count({ typingAnalysis: { level: -1 } }), 0);
    assert.equal(sig.count({}), 0);
    assert.ok(formulaText(resolveScoreWeights({ typingRhythm: 1 }).weights).endsWith('1×typing verdict (typingRhythm)'));
  });
  it('at 1 ranks by the typing verdict within a tier', async () => {
    const { built } = await report([HUMAN(), BOT()], { ...config, scoreWeights: { typingRhythm: 1 } });
    assert.deepEqual(built.triage.map((t) => [t.participantId, t.score]), [['BOT', 2], ['HUMAN', 0]]);
  });
});

describe('the triage reason', () => {
  it('names the typing verdict and its tells', async () => {
    const { built } = await report([BOT()]);
    assert.equal(built.triage[0].reason, 'fast typing on 1 trials; typing verdict: highly suspicious (median gap 41 ms; gap variation 0.02)');
  });
  it('says nothing of a clean, a not-assessed or a not-recorded verdict', async () => {
    const { built } = await report([HUMAN(), OLD()]);
    assert.deepEqual(built.triage.map((t) => [t.participantId, t.reason]), [['HUMAN', 'clean'], ['OLD', 'fast typing on 1 trials']]);
  });
});
