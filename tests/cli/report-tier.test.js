// tests/cli/report-tier.test.js
// The report's tier (triage.js reportTier): config.hardAt moves a participant
// into the hard tier as hard*, beside the library's own hard; summary.csv,
// triage.md and score-weights.json agree with it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { buildSummaryCsv } from '../../src/cli/renderers/summary-csv-core.js';
import { buildTriageMd } from '../../src/cli/renderers/triage-md-core.js';
import { buildScoreWeightsJson } from '../../src/cli/renderers/score-weights-core.js';
import { buildReport } from '../../src/cli/report-core.js';
import { keyRecording, participantFromRecording, botGaps, humanGaps } from './typing-fixtures.js';

// Summaries with what triage and summary.csv read: one the library
// hard-flagged, one soft with a sidebar, one clean with two sidebars. (If a
// summary.csv column added later throws on these, give the summary the field
// it reads.)
const summary = (id, over) => ({ participantId: id, trialCount: 1, hardTriggered: false, totalSoftScore: 0, softScoreThreshold: 6,
  meanTypingSpeed: 0, meanMouseEvents: 0, meanPathEfficiency: 0, ...over });
const SUMMARIES = [
  summary('H-1', { hardTriggered: true, totalPasteEvents: 2 }),
  summary('S-1', { totalSoftScore: 7, sidebarEventCount: 1 }),
  summary('C-1', { sidebarEventCount: 2 }),
];
const EDGE = SUMMARIES.map(() => ({ edgeExits: [] }));
const rank = (config) => rankTriage(SUMMARIES, EDGE, config);

describe('reportTier', () => {
  it('without hardAt: the library\'s tiers, in triage order', () => {
    assert.deepEqual(rank({}).map((t) => [t.participantId, t.reportTier]), [['H-1', 'hard'], ['S-1', 'soft'], ['C-1', 'clean']]);
  });

  it('hardAt moves anyone at or over a count into hard*, sorted with hard; hardTriggered keeps the library\'s decision', () => {
    assert.deepEqual(rank({ hardAt: { sidebar: 2 } }).map((t) => [t.participantId, t.reportTier, t.hardTriggered]),
      [['H-1', 'hard', true], ['C-1', 'hard*', false], ['S-1', 'soft', false]]);
  });

  it('the library\'s hard stays hard when it also reaches a hard-at count', () => {
    assert.equal(rank({ hardAt: { paste: 1 } })[0].reportTier, 'hard');
  });
});

describe('the files agree', () => {
  const config = { hardAt: { sidebar: 2 } };
  const rows = rank(config);

  it('summary.csv: reportTier is the last column, and hardTriggered keeps the library\'s decision', () => {
    // No cell in these rows holds a comma, so a plain split reads them.
    const [header, ...lines] = buildSummaryCsv(SUMMARIES, rows).trim().split('\n');
    const H = header.split(',');
    assert.equal(H[H.length - 1], 'reportTier');
    const byId = Object.fromEntries(lines.map((l) => [l.split(',')[0], l.split(',')]));
    assert.deepEqual(['H-1', 'S-1', 'C-1'].map((id) => [byId[id][H.indexOf('hardTriggered')], byId[id][H.indexOf('reportTier')]]),
      [['YES', 'hard'], ['no', 'soft'], ['no', 'hard*']]);
  });

  it('triage.md: HARD* in the Tier column and a line saying what it means; nothing of it without hardAt', () => {
    const md = buildTriageMd(rows, config);
    assert.match(md, /\| 2 \| C-1 \| \*\*HARD\\\*\*\* \|/);
    assert.match(md, /`HARD\*` = moved to the hard tier by this report's `hardAt` rule/);
    assert.doesNotMatch(buildTriageMd(rank({}), {}), /HARD\\\*|hardAt/);
  });

  it('score-weights.json carries hardAt only when it is set', () => {
    const withRule = JSON.parse(buildScoreWeightsJson(config).text);
    assert.deepEqual(Object.keys(withRule).sort(), ['hardAt', 'isDefault', 'weights']);
    assert.deepEqual(withRule.hardAt, { sidebar: 2 });
    assert.deepEqual(Object.keys(JSON.parse(buildScoreWeightsJson({}).text)).sort(), ['isDefault', 'weights']);
  });
});

describe('buildReport', () => {
  // Software typing (a highly suspicious typing verdict, level 2) and a
  // person's: "typingRhythm": 2 moves the first into hard*, the second stays
  // clean. The console names how many hardAt moved; the files agree.
  const BOT = () => participantFromRecording('BOT', keyRecording([['q1', 10, botGaps(30)]]));
  const HUMAN = () => participantFromRecording('HUMAN', keyRecording([['q1', 10, humanGaps(120, 1)]]));
  const build = async (config) => {
    const files = {}; const logs = [];
    const built = await buildReport([HUMAN(), BOT()], { outputDir: '.', participantIdField: 'participantId', ...config },
      { sink: (p, body) => { files[p] = body; }, log: (l) => logs.push(l) });
    return { built, files, logs };
  };

  it('config.hardAt reaches the triage rows, the console and the three files', async () => {
    const { built, files, logs } = await build({ hardAt: { typingRhythm: 2 } });
    assert.deepEqual(built.triage.map((t) => [t.participantId, t.hardTriggered, t.reportTier]), [['BOT', false, 'hard*'], ['HUMAN', false, 'clean']]);
    assert.ok(logs.includes('  Moved to hard by hardAt (hard*):                        1'), logs.join('\n'));
    const tiers = Object.fromEntries(files['summary.csv'].trim().split('\n').slice(1).map((l) => [l.split(',')[0], l.split(',').at(-1)]));
    assert.deepEqual(tiers, { HUMAN: 'clean', BOT: 'hard*' });
    assert.match(files['triage.md'], /\| 1 \| BOT \| \*\*HARD\\\*\*\* \|/);
    assert.deepEqual(JSON.parse(files['score-weights.json']).hardAt, { typingRhythm: 2 });
  });

  it('without hardAt the console has no such line', async () => {
    const { built, logs } = await build({});
    assert.deepEqual(built.triage.map((t) => t.reportTier), ['clean', 'clean']);
    assert.equal(logs.some((l) => /hardAt/.test(l)), false, logs.join('\n'));
  });

  // The counts the analyzer's results line prints: the report's tiers, hard*
  // counted with hard (as the rail counts them), and how many hard* there
  // are, beside the library's tiers, which the console prints.
  it('counts: the report\'s tiers with hard* in hard, and how many hard* there are, beside the library\'s', async () => {
    assert.deepEqual((await build({ hardAt: { typingRhythm: 2 } })).built.counts,
      { flaggedHard: 0, flaggedSoft: 0, clean: 2, reportHard: 1, reportSoft: 0, reportClean: 1, movedHard: 1 });
    assert.deepEqual((await build({})).built.counts,
      { flaggedHard: 0, flaggedSoft: 0, clean: 2, reportHard: 0, reportSoft: 0, reportClean: 2, movedHard: 0 });
  });
});
