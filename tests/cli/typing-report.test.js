// tests/cli/typing-report.test.js
// The typing section in the report: it rides on each summary
// (typingAnalysis), recounts fast typing where it recomputed a rate from
// saved edit times or the recording, writes typing-limits.json, adds a
// clause to the triage reason, a weight (typingRhythm) to the score table,
// six columns to summary.csv and a Typing dynamics section to each pane.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, REPORT_FILES } from '../../src/cli/report-core.js';
import { buildSummaryCsv } from '../../src/cli/renderers/summary-csv-core.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
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

describe('summary.csv', () => {
  const TYPING_COLS = ['typingVerdict', 'typingTells', 'typingFieldsJudged', 'typingFastestMedianMs', 'typingLowestCv', 'typingRateSource'];
  // Each session's six typing cells, by participant id.
  const typingCells = (csv) => {
    const [header, ...rows] = csv.trim().split('\n');
    const at = header.split(',').indexOf('typingVerdict');
    return Object.fromEntries(rows.map((r) => r.split(',')).map((r) => [r[0], r.slice(at, at + 6)]));
  };
  it('appends the six typing columns after the cursor block', async () => {
    const { files } = await report([BOT(), HUMAN(), OLD()]);
    const [header, ...rows] = files['summary.csv'].trim().split('\n');
    const cols = header.split(',');
    const at = cols.indexOf('typingVerdict');
    assert.deepEqual(cols.slice(at, at + 6), TYPING_COLS);
    assert.ok(at > cols.indexOf('cursorCenteredClicks'), 'after the cursor block');
    const cells = Object.fromEntries(rows.map((r) => r.split(',')).map((r) => [r[0], r.slice(at, at + 6)]));
    assert.deepEqual(cells.BOT, ['highly suspicious', 'median gap 41 ms; gap variation 0.02', '1', '41', '0.02', 'recording']);
    assert.deepEqual(cells.HUMAN, ['clean', '', '1', '181.5', '1.579', 'recording']);
    assert.deepEqual(cells.OLD, ['not assessed', '', '', '', '', 'old formula']);
  });
  it('the six follow deviceMasking, the column that was last: every earlier column keeps its place', async () => {
    const { files } = await report([OLD()]);
    const cols = files['summary.csv'].split('\n')[0].split(',');
    assert.equal(cols.indexOf('typingVerdict'), cols.indexOf('deviceMasking') + 1);
  });
  it('fields judged: 0 when no field was long enough, empty when the rhythm was not recorded; the rate source names saved edit times', async () => {
    // AGE: one gap in its only field (too short to judge). TRACE: a
    // recording without the page, whose rate still comes from the
    // recording's edits. TIMES: no rhythm, the rate from saved edit times.
    const age = participantFromRecording('AGE', keyRecording([['age', 10, [170]]]));
    const { files } = await report([age, TRACE(), TIMES()]);
    const cells = typingCells(files['summary.csv']);
    assert.deepEqual(cells.AGE, ['not assessed', '', '0', '', '', 'recording']);
    assert.deepEqual(cells.TRACE, ['not assessed', '', '', '', '', 'recording']);
    assert.deepEqual(cells.TIMES, ['not assessed', '', '', '', '', 'edit times']);
  });
  it('the fastest median gap and the lowest variation over many fields, without a stack overflow', () => {
    // More fields than Math.min(...spread) can take as arguments (a file
    // can hold that many library summaries).
    const fields = Array.from({ length: 250000 }, (_, i) => ({ medianMs: 300 - (i % 7), cv: 0.9 - (i % 5) / 10 }));
    const summary = { participantId: 'MANY', trialCount: 1, meanTypingSpeed: 0, meanMouseEvents: 0, meanPathEfficiency: 0,
      typingAnalysis: { state: 'ok', verdict: 'clean', tells: [], fields, rate: { source: 'library' } } };
    const cells = typingCells(buildSummaryCsv([summary], [{ participantId: 'MANY', score: 0, reason: 'clean' }]));
    assert.deepEqual(cells.MANY, ['clean', '', '250000', '294', '0.5', 'library']);
  });
});

describe('the Typing dynamics section', () => {
  // The participant's detail pane, from its <section> to the next.
  const pane = (html, pid) => { const at = html.indexOf(`id="p-${pid}"`); return html.slice(at, html.indexOf('</section>', at)); };
  // A trial of 0.17 data (typingEdits) whose library summaries are one per
  // tag, in the order of their first keystroke.
  const libraryTrial = (trialId, tags) => ({ trialId, startTime: 0, duration_ms: 1000, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0,
    typingEdits: 40, charsPerSec: 4, typingRhythm: tags.map((tag) => ({ field: { tag }, gaps: 25, medianMs: 150, under60Share: 0, cv: 0.6 })) });
  it('above the cursor section: the verdict, the tells, the open details with every field, the rules and the rate', async () => {
    const { files } = await report([BOT(), HUMAN(), OLD()]);
    const bot = pane(files['index.html'], 'BOT');
    assert.ok(bot.indexOf('Typing dynamics') > 0 && bot.indexOf('Typing dynamics') < bot.indexOf('Cursor dynamics'), 'typing above cursor');
    assert.match(bot, /<div class="typing-section"><h4 class="section-heading">Typing dynamics<\/h4><p class="typing-verdict"><span class="verdict-badge" data-level="2">highly suspicious<\/span> <span class="muted">because of:<\/span><\/p>/);
    assert.match(bot, /<li class="tell-high">keys pressed faster than a person types: median gap 41 ms, 100% of gaps under 60 ms <span class="muted">\(q1\)<\/span><\/li>/);
    assert.match(bot, /<li class="tell-high">keys pressed too evenly: gap variation 0\.02, where people vary by 0\.3 or more <span class="muted">\(q1\)<\/span><\/li>/);
    assert.match(bot, /<details class="typing-details" open><summary>every field, the rules and the typing rate<\/summary>/);
    assert.match(bot, /<tr><th class="muted">trial · field<\/th><td class="muted">gaps · median gap · gaps under 60 ms · variation<\/td><\/tr>/);
    assert.match(bot, /<tr class="fired"><th>q1 · text box<\/th><td>30 · 41 ms · 100% · 0\.02<\/td><\/tr>/);
    assert.match(bot, /<tr class="fired"><th>median gap under 60 ms<\/th><td>1 of 1 fields \(q1\)<\/td><\/tr>/);
    assert.match(bot, /<tr class="fired"><th>more than half the gaps under 60 ms<\/th><td>1 of 1 fields \(q1\)<\/td><\/tr>/);
    assert.match(bot, /<tr class="fired"><th>gap variation under 0\.2<\/th><td>1 of 1 fields \(q1\)<\/td><\/tr>/);
    assert.match(bot, /<tr class="fired"><th>typing rate over 10 cps, trials with 20\+ keystrokes<\/th><td>1 of 1 trials \(q1 24\.4\)<\/td><\/tr>/);
    assert.match(bot, /<tr class=""><th>too short to judge<\/th><td>none<\/td><\/tr>/);
    // One note: where the numbers came from, and what a rate rebuilt from
    // the recording can miss.
    assert.match(bot, /<p class="muted note">Computed from the session recording: data from libraries before 0\.17 carry no rhythm summaries\. A rate rebuilt from a recording can undercount keys typed faster than the page’s frames\.<\/p>/);
    // Its own classes: the analyzer's tests address the cursor section's by name.
    const section = bot.slice(bot.indexOf('<div class="typing-section">'), bot.indexOf('<div class="cursor-section">'));
    assert.doesNotMatch(section, /class="cursor-/);
  });
  it('a clean session says what it was judged on', async () => {
    const { files } = await report([HUMAN()]);
    assert.match(files['index.html'], /<span class="verdict-badge" data-level="0">clean<\/span> <span class="muted">1 field judged; none under 60 ms \(fastest median gap 182 ms\) and none too even \(lowest variation 1\.58\); typing rate at most 2\.8 cps over trials with 20\+ keystrokes\.<\/span>/);
  });
  it('data with neither summaries nor a recording: not assessed, the reason, and the old formula marked', async () => {
    const html = (await report([OLD()])).files['index.html'];
    assert.match(html, /<span class="verdict-badge" data-level="-1">not assessed<\/span> <span class="muted">typing rhythm not recorded \(library before 0\.17 or signals\.typingRhythm off\) and no session recording\.<\/span>/);
    assert.match(html, /<tr class=""><th>none<\/th><td>not recorded<\/td><\/tr>/);
    assert.match(html, /<td>1 of 1 trials \(age 11\.8 \(old formula\)\)<\/td>/);
    assert.match(html, /<p class="muted note">A rate marked “old formula” is the one a library before 0\.17 saved \(keystrokes over time, from 2 keystrokes\), for a trial with no recording to recompute it from\.<\/p>/);
  });
  it('a rate from saved edit times is not marked: only the old formula is', async () => {
    // 25 edits 50 ms apart: 20 cps from the edit times, beside the old
    // formula's 11.8 the trial also saved.
    const p = { participantId: 'FAST', trials: [{ ...OLD().trials[0], editTimestamps: Array.from({ length: 25 }, (_, i) => 5000 + 50 * i) }] };
    const fast = pane((await report([p])).files['index.html'], 'FAST');
    assert.match(fast, /<td>1 of 1 trials \(age 20\)<\/td>/);
    assert.doesNotMatch(fast, /old formula/);
  });
  it('a recording without the page: the rhythm is not recorded, and no note says it was computed from the recording', async () => {
    const trace = pane((await report([TRACE()])).files['index.html'], 'TRACE');
    assert.match(trace, /<span class="verdict-badge" data-level="-1">not assessed<\/span> <span class="muted">the session recording does not say which field each key went to \(recorded without the page\)\.<\/span>/);
    assert.match(trace, /<tr class=""><th>none<\/th><td>not recorded<\/td><\/tr>/);
    assert.doesNotMatch(trace, /Computed from the session recording/);
  });
  it('0.17 data: short trials are named with their keystrokes, and short fields are said to be unsaved', async () => {
    const p = { participantId: 'LIB', trials: [{ trialId: 'q1', startTime: 0, duration_ms: 1000, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0, typingEdits: 3, typingRhythm: [] }] };
    const html = (await report([p])).files['index.html'];
    assert.match(html, /<span class="muted">no text field reached 20 key gaps\.<\/span>/);
    assert.match(html, /<th>too short to judge<\/th><td>q1 \(3 keystrokes\); fields under 20 key gaps \(the library saves nothing for them\)<\/td>/);
  });
  it('fields are named by tag in the order of their first keystroke, counted within each trial; any other tag is an editable area', async () => {
    // Two trials share the id q1 and are counted apart; a tag is matched
    // in lower case; a contenteditable element's tag, a tag that names
    // something on Object's prototype and a hostile tag are editable areas,
    // and no tag is printed.
    const p = { participantId: 'TAGS', trials: [
      libraryTrial('q1', ['textarea', 'input', 'textarea', 'div', 'constructor', '<b>x</b>']),
      libraryTrial('q1', ['textarea']),
      libraryTrial('q2', ['INPUT'])] };
    const tags = pane((await report([p])).files['index.html'], 'TAGS');
    const names = [...tags.matchAll(/<tr class=""><th>([^<]*)<\/th><td>25 · 150 ms · 0% · 0\.60<\/td><\/tr>/g)].map((m) => m[1]);
    assert.deepEqual(names, ['q1 · text box', 'q1 · text field', 'q1 · text box 2', 'q1 · editable area', 'q1 · editable area 2', 'q1 · editable area 3',
      'q1 · text box', 'q2 · text field']);
    assert.doesNotMatch(tags, /&lt;b&gt;|<b>x|constructor|function/);
  });
  it('the fast-typing tile says which trials count', async () => {
    const html = (await report([OLD()])).files['index.html'];
    assert.match(html, /title="Trials of 20 or more keystrokes typed faster than the cps threshold \(older data without a recording: the saved rate\)"/);
  });
  it('a partial analysis (a hand-built summary) draws no section and does not throw', async () => {
    const partial = [{ level: 2 }, { level: 2, limits: {}, rate: {} }, { level: 2, limits: {}, rate: { trials: [] }, fields: 'x', tells: [] }];
    for (const typingAnalysis of partial) {
      const triage = [{ participantId: 'P', hardTriggered: false, softFlagged: false, score: 0, summary: { typingAnalysis } }];
      const html = await renderIndexHtml([], triage, [{ participantId: 'P' }], config, false, {});
      // The section's markup, not its name: the stylesheet's comment names it.
      assert.doesNotMatch(html, /<div class="typing-section">|<h4 class="section-heading">Typing dynamics/, JSON.stringify(typingAnalysis));
    }
  });
  it('a clean verdict over many fields, without a stack overflow', async () => {
    // More fields than Math.min(...spread) can take as arguments (a file
    // can hold that many library summaries).
    const limits = Object.fromEntries(Object.entries(TYPING_LIMITS).map(([k, v]) => [k, v.value]));
    const fields = Array.from({ length: 250000 }, (_, i) => ({ trialId: 'q', trialIndex: 0, field: { tag: 'textarea' }, gaps: 25, medianMs: 300 - (i % 7), under60Share: 0, cv: 0.9 - (i % 5) / 10 }));
    const typingAnalysis = { state: 'ok', level: 0, verdict: 'clean', verdictReason: null, source: 'library', tells: [], fields, shortFields: null,
      rate: { source: 'library', cutoffCps: 10, trials: [] }, limits };
    const triage = [{ participantId: 'MANY', hardTriggered: false, softFlagged: false, score: 0, summary: { typingAnalysis } }];
    const html = await renderIndexHtml([], triage, [{ participantId: 'MANY' }], config, false, {});
    assert.match(html, /250000 fields judged; none under 60 ms \(fastest median gap 294 ms\) and none too even \(lowest variation 0\.50\)\./);
  });
  it('a hostile analysis draws without throwing: its text escaped, no NaN, undefined or Infinity', async () => {
    const hostile = (level) => ({ state: 'ok', level, verdict: '<i>v</i>', verdictReason: '<u>r</u>', source: 'recording',
      tells: [null, { level: '<q>', text: '<b>t</b>', trialIds: 'q1', trials: 'x' }, { level: 'low', text: 't', trialIds: ['<s>'], trials: {} }],
      fields: [null, { trialId: '<script>x</script>', trialIndex: 0, field: null, gaps: '30', medianMs: 'fast', under60Share: NaN, cv: {}, speed: true }],
      shortFields: 'many',
      rate: { source: 'x', cutoffCps: '10', trials: [null, { trialId: '<s>', judged: true, fast: true, cps: 'x', source: 'old formula' },
        { trialId: 'q2', judged: false, edits: '3', oldCps: 'x' }, { trialId: 'q3', judged: false, edits: 3, oldCps: 99 }] },
      limits: { minGaps: '<em>', minEdits: 20, fastShare: 0.5 } });
    for (const level of [-1, 0, 1, 2, '<x>']) {
      const triage = [{ participantId: 'H', hardTriggered: false, softFlagged: false, score: 0, summary: { typingAnalysis: hostile(level) } }];
      const html = await renderIndexHtml([], triage, [{ participantId: 'H' }], config, false, {});
      const at = html.indexOf('<div class="typing-section">');
      assert.ok(at > 0, `level ${level}: a section`);
      const section = html.slice(at, html.indexOf('</section>', at));
      assert.doesNotMatch(section, /NaN|undefined|Infinity|\[object|<script|<b>|<i>|<u>|<s>|<em>|<x>|<q>/, `level ${level}`);
      assert.match(section, /&lt;script&gt;x&lt;\/script&gt; · text box|&lt;script&gt;x&lt;\/script&gt; · editable area/, `level ${level}`);
    }
  });
});
