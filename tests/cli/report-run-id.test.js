// The report's run id and time (report-core.js runIdOf; the top bar of
// html-index-core.js). The id names the cohort and its data: each participant
// id with its trial count and first and last trial timestamps, sorted and
// hashed, so a rebuild of the same files under other settings keeps it and two
// studies that share ids 1…N do not (when their trials carry timestamps).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ingest, nodeDeps } from '../../src/cli/ingest.js';
import { buildReport, renderInPageHtml, runIdOf } from '../../src/cli/report-core.js';
import { mergeConfig } from '../../src/cli/config-core.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { applyPhaseScope } from '../../src/cli/analyzers/phase-scope.js';
import { webSha256 } from '../../demo/analyze/web-deps.js';

// webSha256 reads the browser's global `crypto`; Node 18 (the engines floor)
// only exposes it from node:crypto.
if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;

const CLI = { dataDir: 'tests/cli/fixtures', filePattern: '*_participant.json', participantIdField: 'participantId', integrityField: 'integrity' };
const NOW = () => '2026-10-05T14:03:12.345Z';
const cohort = (ids) => ids.map((participantId) => ({ participantId }));
const hashOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
// A fixture participant whose trials carry a phase and a stamp each, read by
// ingest's own extractor: the first trial a warmup, the rest the main task.
const stampedFixture = (file, day) => {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.trials = raw.trials.map((t, i) => ({ ...t, integrity: { ...t.integrity,
    phase: i === 0 ? 'warmup' : 'main', timestamp: '2026-04-' + day + 'T00:0' + i + ':00.000Z' } }));
  return extractIntegrityData(raw, { participantIdField: 'participantId', integrityField: 'integrity' });
};

describe('the run id', () => {
  it('is the first 16 hex digits of the sha256 of the sorted [id, trial count, first and last timestamp] rows as JSON, whatever their order', async () => {
    const expected = createHash('sha256').update('[["P1",0,null,null],["P2",0,null,null],["P3",0,null,null]]', 'utf8').digest('hex').slice(0, 16);
    assert.equal(await runIdOf(cohort(['P2', 'P3', 'P1']), nodeDeps.sha256), expected);
    assert.equal(await runIdOf(cohort(['P1', 'P2', 'P3']), webSha256), expected, 'the browser hash agrees');
    assert.notEqual(await runIdOf(cohort(['P1', 'P2']), nodeDeps.sha256), expected, 'another cohort, another id');
    const stamped = [{ participantId: 7, trials: [
      { integrity: { timestamp: '2026-01-01T00:00:00Z' } }, { integrity: {} }, { integrity: { timestamp: '2026-01-01T00:10:00Z' } }] }];
    const row = createHash('sha256').update('[["7",3,"2026-01-01T00:00:00Z","2026-01-01T00:10:00Z"]]', 'utf8').digest('hex').slice(0, 16);
    assert.equal(await runIdOf(stamped, nodeDeps.sha256), row, 'the id as a string, the first and the last trial\'s stamps');
    assert.equal(await runIdOf(stamped, webSha256), row, 'the browser hash agrees');
  });

  it('follows the data, not the config or the file names', async () => {
    const sha = async (s) => createHash('sha256').update(s).digest('hex');
    const p = (id, ts1, ts2) => ({ participantId: id, trials: [
      { trialId: 't1', integrity: { timestamp: ts1 } }, { trialId: 't2', integrity: { timestamp: ts2 } }] });
    const a = [p('1', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z'), p('2', '2026-01-01T01:00:00Z', '2026-01-01T01:10:00Z')];
    const b = [p('2', '2026-02-01T01:00:00Z', '2026-02-01T01:10:00Z'), p('1', '2026-02-01T00:00:00Z', '2026-02-01T00:10:00Z')];
    assert.strictEqual(await runIdOf(a, sha), await runIdOf([...a].reverse(), sha)); // order-free
    assert.notStrictEqual(await runIdOf(a, sha), await runIdOf(b, sha));             // same ids, other data
    assert.match(await runIdOf(a, sha), /^[0-9a-f]{16}$/);
    // A phase scope filters the trials the analyzers see, not the ones the id
    // is taken from: the report keeps its id with and without one.
    const participants = [stampedFixture('tests/cli/fixtures/clean_participant.json', '01'),
      stampedFixture('tests/cli/fixtures/suspicious_participant.json', '02')];
    const runIdUnder = async (phaseScope) => (await buildReport(participants, mergeConfig({ ...CLI, phaseScope }).config,
      { sink: () => {}, replayClientSrc: '', fontFaceCss: '', sha256: nodeDeps.sha256, now: NOW })).runId;
    const unscoped = await runIdUnder(undefined);
    assert.equal(unscoped, await runIdOf(participants, nodeDeps.sha256));
    assert.equal(await runIdUnder({ include: ['main'] }), unscoped, 'include');
    assert.equal(await runIdUnder({ exclude: ['warmup'] }), unscoped, 'exclude');
    assert.notEqual(await runIdOf(applyPhaseScope(participants, { include: ['main'] }), nodeDeps.sha256), unscoped,
      'the scoped trials would give another id');
  });

  it('orders equal ids by the rest of their rows, so input order (sorted paths, drop order) does not matter', async () => {
    const one = { participantId: 'P1', trials: [{ integrity: { timestamp: '2026-01-01T00:00:00Z' } }] };
    const two = { participantId: 'P1', trials: [{ integrity: { timestamp: '2026-01-01T00:05:00Z' } }, { integrity: { timestamp: '2026-01-01T00:10:00Z' } }] };
    const expected = hashOf('[["P1",1,"2026-01-01T00:00:00Z","2026-01-01T00:00:00Z"],["P1",2,"2026-01-01T00:05:00Z","2026-01-01T00:10:00Z"]]');
    assert.equal(await runIdOf([one, two], nodeDeps.sha256), expected);
    assert.equal(await runIdOf([two, one], nodeDeps.sha256), expected);
    assert.equal(await runIdOf([two, one], webSha256), expected, 'the browser hash agrees');
  });

  it('sorts ids by code unit, not by locale or by number', async () => {
    const expected = hashOf('[["10",0,null,null],["9",0,null,null],["B",0,null,null],["b",0,null,null]]');
    assert.equal(await runIdOf(cohort(['b', '9', 'B', '10']), nodeDeps.sha256), expected);
  });

  it('gives participants without timestamps a stable id from the trial count', async () => {
    const sha = async (s) => createHash('sha256').update(s).digest('hex');
    const q = (id, n) => ({ participantId: id, trials: Array.from({ length: n }, () => ({ integrity: {} })) });
    assert.strictEqual(await runIdOf([q('1', 3)], sha), await runIdOf([q('1', 3)], sha));
    assert.notStrictEqual(await runIdOf([q('1', 3)], sha), await runIdOf([q('1', 4)], sha));
  });

  it('reads the stamp ingest leaves on the trial itself when there is no integrity object (legacy responses, another integrityField)', async () => {
    const flat = [{ participantId: 'L', trials: [{ timestamp: '2026-03-01T00:00:00Z' }, { timestamp: '2026-03-01T00:05:00Z' }] }];
    const nested = [{ participantId: 'L', trials: [{ integrity: { timestamp: '2026-03-01T00:00:00Z' } }, { integrity: { timestamp: '2026-03-01T00:05:00Z' } }] }];
    const none = [{ participantId: 'L', trials: [{}, {}] }];
    assert.equal(await runIdOf(flat, nodeDeps.sha256), await runIdOf(nested, nodeDeps.sha256));
    assert.notEqual(await runIdOf(flat, nodeDeps.sha256), await runIdOf(none, nodeDeps.sha256));
    // Through ingest's own extractor: another integrityField leaves the stamp
    // on the trial, and the id is the one the nested form gives.
    const read = extractIntegrityData({ participantId: 'L', trials: [
      { ch: { timestamp: '2026-03-01T00:00:00Z' } }, { ch: { timestamp: '2026-03-01T00:05:00Z' } }] }, { integrityField: 'ch' });
    assert.equal(await runIdOf([read], nodeDeps.sha256), await runIdOf(nested, nodeDeps.sha256));
  });

  it('is in the top bar with the time of the run, in the CLI report and in the in-page one', async () => {
    const { participants } = await ingest(CLI);
    const config = mergeConfig(CLI).config;
    const files = new Map();
    const built = await buildReport(participants, config,
      { sink: (path, data) => files.set(path, data), replayClientSrc: '', fontFaceCss: '', sha256: nodeDeps.sha256, now: NOW });
    assert.equal(built.runId, await runIdOf(participants, nodeDeps.sha256));
    assert.equal(built.generatedAt, NOW());
    const line = ' &middot; run <code class="mono run-id">' + built.runId + '</code>' +
      ' &middot; <time class="run-time" datetime="2026-10-05T14:03:12.345Z">2026-10-05 14:03 UTC</time></span>';
    assert.ok(files.get('index.html').includes(line), 'the CLI report');
    const inPage = await renderInPageHtml(built, participants, config, { replayClientSrc: '', fontFaceCss: '' });
    assert.ok(inPage.includes(line), 'the in-page report');
  });

  it('is absent when no hash is given: the top bar is unchanged, and no annotation controls', async () => {
    const { participants } = await ingest(CLI);
    const files = new Map();
    const built = await buildReport(participants, mergeConfig(CLI).config,
      { sink: (path, data) => files.set(path, data), replayClientSrc: '', fontFaceCss: '' });
    assert.equal(built.runId, null);
    assert.equal(built.generatedAt, null);
    assert.equal(files.get('index.html').includes('run-id'), false);
    // The annotations are stored under the run id: without one, none (each
    // rail row's mark stays empty, in its slot).
    assert.equal(files.get('index.html').includes('ch-annot:'), false);
    assert.deepEqual([...new Set(files.get('index.html').match(/annot-[\w-]+/g))], ['annot-mark']);
  });
});
