// tests/cli/extract-core.test.js
// Pins the pure extraction core: participant/trial shape, no Node imports.
// This is the 0.7.2 extraction from cli/ingest.js — the fs-touching wrapper's
// own behavior (file discovery, CSV parsing, replay-artifact attachment)
// stays covered by tests/cli/ingest.test.js, which now imports
// extractIntegrityData through ingest.js's re-export.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { extractIntegrityData, ruleChronologicalCompare } from '../../src/cli/extract-core.js';
import { parseCsvToRaw } from '../../src/cli/ingest-core.js';

describe('extractIntegrityData (pure core)', () => {
  it('extracts a Shape-1 raw object into { participantId, trials, warnings }', () => {
    const raw = {
      participantId: 'P1',
      trials: [
        { trialId: 't1', integrity: { pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [] } }
      ]
    };
    const result = extractIntegrityData(raw, { integrityField: 'integrity', participantIdField: 'participantId' });
    assert.strictEqual(result.participantId, 'P1');
    assert.strictEqual(result.trials.length, 1);
    assert.strictEqual(result.trials[0].trialId, 't1');
  });

  it('warns and defaults to "unknown" when participantId is unresolved', () => {
    const raw = { trials: [{ trialId: 't1', integrity: { pasteEvents: [] } }] };
    const result = extractIntegrityData(raw, {});
    assert.strictEqual(result.participantId, 'unknown');
    assert.ok(result.warnings.some(w => w.includes('participantId unresolved')));
  });

  const labRow = (sender, extra) => Object.assign({ sender, sender_type: 'html.Screen', sender_id: '0', timestamp: '2026-10-02T10:00:00.000Z' }, extra);
  const integrity = (id) => ({ trialId: id, participantId: 'L1', pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [] });

  it('a top-level array (lab.js exportJson, JATOS) takes its participant id from the first row that carries one', () => {
    const raw = [
      labRow('bye', { ended_on: 'skipped' }),                                      // a skipped component's row: no columns
      labRow('a', { participantId: 'L1', integrity: integrity('0'), integritySegment: { segmentIndex: 0, source: 'host', trialId: '0', pageOrigin: 1, deltas: {}, counters: { pasteCount: 0, copyCount: 0, dropCount: 0 }, score: {} } }),
      labRow('root', { sender_type: 'flow.Sequence' })
    ];
    const r = extractIntegrityData(raw, { integrityField: 'integrity', participantIdField: 'participantId' });
    assert.strictEqual(r.participantId, 'L1');
    assert.strictEqual(r.trials.length, 1);
    assert.strictEqual(r.trials[0].trialId, '0');
    assert.ok(!r.warnings.some((w) => w.includes('participantId unresolved')));
  });

  it('a top-level array whose rows carry the id only inside the integrity report still resolves it', () => {
    const raw = [labRow('a', { integrity: integrity('0') })];
    assert.strictEqual(extractIntegrityData(raw, {}).participantId, 'L1');
  });

  it('a top-level array with no id anywhere stays "unknown", with the warning', () => {
    const raw = [labRow('a', { integrity: { trialId: '0', pasteEvents: [] } })];
    const r = extractIntegrityData(raw, {});
    assert.strictEqual(r.participantId, 'unknown');
    assert.ok(r.warnings.some((w) => w.includes('participantId unresolved')));
  });

  it('the lab.js Transmit envelope { metadata, url, data } is read as rows', () => {
    const raw = {
      metadata: { slice: 0, id: '3b1c…', payload: 'full' },
      url: 'https://study.example/index.html',
      data: [labRow('a', { participantId: 'L2', integrity: integrity('0') }), labRow('root', { sender_type: 'flow.Sequence' })]
    };
    const r = extractIntegrityData(raw, {});
    assert.strictEqual(r.participantId, 'L2');
    assert.strictEqual(r.trials.length, 1);
  });

  it('an object with a `data` array that is not an envelope of rows is not mistaken for one', () => {
    const r = extractIntegrityData({ data: [1, 2, 3] }, {});
    assert.strictEqual(r.trials.length, 0);
    assert.strictEqual(r.participantId, 'unknown');
  });

  it('module source has no fs/path/zlib imports', () => {
    const src = readFileSync(new URL('../../src/cli/extract-core.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from ['"](node:)?(fs|path|zlib)['"]/);
  });

  it('segment-reassembly.js (imported by extract-core) imports nothing', () => {
    const src = readFileSync(new URL('../../src/cli/segment-reassembly.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /^\s*import\s/m);
  });
});

describe('a reduced one-line payload', () => {
  const raw = (truncated) => ({
    participantId: 'P1',
    cyborgHunterOneLiner: { version: '0.12.0', host: 'qualtrics', pageCount: 4, truncated },
    trials: [{ trialId: 't1', integrity: { trialId: 't1', libraryVersion: '0.12.0', participantId: 'P1', startTime: 0, duration_ms: 10,
      pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0, trialSignals: {} } }]
  });

  it('warns once, naming the level and the non-zero counts', () => {
    const r = extractIntegrityData(raw({ level: 2, droppedSessionEntries: {}, pagesTrimmed: 3, pagesDropped: 0 }), {});
    const hits = r.warnings.filter(w => /embedded-data cap/.test(w));
    assert.strictEqual(hits.length, 1);
    assert.match(hits[0], /reduced to fit the embedded-data cap \(level 2: 3 pages trimmed\)/);
  });

  it('lists dropped session entries and dropped pages', () => {
    const r = extractIntegrityData(raw({ level: 3, droppedSessionEntries: { tabAwayEvents: 55, keyboardShortcuts: 0 }, pagesTrimmed: 4, pagesDropped: 35 }), {});
    assert.ok(r.warnings.some(w => w.includes('(level 3: 55 tabAwayEvents entries dropped, 4 pages trimmed, 35 pages dropped)')), r.warnings.join('\n'));
  });

  // The note says which numbers are the whole session's: with the carried
  // totals every count is; a reduced payload without them (built before
  // the writer carried them) keeps only its clipboard counters whole.
  it('says which numbers are the whole session\'s, with and without carried totals', () => {
    const withTotals = extractIntegrityData(raw({ level: 3, droppedSessionEntries: {}, pagesTrimmed: 4, pagesDropped: 2, totals: { tabAways: 3 } }), {});
    assert.ok(withTotals.warnings.some(w => w.endsWith("— its counts, scores and tier are the whole session's; the page rows, the means taken over them (typing speed, mouse metrics), the event lists and the names of AI extensions cover only what it kept")), withTotals.warnings.join('\n'));
    const without = extractIntegrityData(raw({ level: 3, droppedSessionEntries: {}, pagesTrimmed: 4, pagesDropped: 2 }), {});
    assert.ok(without.warnings.some(w => w.endsWith("— its paste, copy and drop counts, scores and tier are the whole session's; its other counts, per-page rows and event lists cover only what it kept")), without.warnings.join('\n'));
    const five = extractIntegrityData({ participantId: 'P1', cyborgHunterOneLiner: { host: 'qualtrics', truncated: { level: 5 } }, trials: [] }, {});
    assert.ok(five.warnings.some(w => w.endsWith('(level 5: nothing listed) — no page of the session was kept, so the response is not in the report')), five.warnings.join('\n'));
  });

  it('says nothing when the payload was not reduced', () => {
    const r = extractIntegrityData(raw(false), {});
    assert.ok(!r.warnings.some(w => /embedded-data cap/.test(w)));
  });

  it('marks the participant as reduced, with the level and the carried totals, only when the payload was', () => {
    assert.deepStrictEqual(extractIntegrityData(raw({ level: 3, droppedSessionEntries: {}, pagesTrimmed: 4, pagesDropped: 2 }), {}).reducedPayload, { level: 3, totals: null });
    const totals = { tabAways: 40, sidebarOpenings: 2 };
    assert.deepStrictEqual(extractIntegrityData(raw({ level: 3, droppedSessionEntries: {}, pagesTrimmed: 4, pagesDropped: 2, totals }), {}).reducedPayload, { level: 3, totals });
    assert.strictEqual(extractIntegrityData(raw({ level: 2, totals: [1, 2] }), {}).reducedPayload.totals, null);
    for (const t of [false, undefined, true, 'yes']) {
      assert.strictEqual(extractIntegrityData(raw(t), {}).reducedPayload, null, String(t));
    }
    assert.strictEqual(extractIntegrityData({ participantId: 'P1', trials: [] }, {}).reducedPayload, null);
  });
});

describe('ruleChronologicalCompare (pure core)', () => {
  it('orders gallery before post_gallery_query before classification, end_requery last', () => {
    const trials = [
      { phase: 'end_requery', rulePosition: null, trialNumber: 1 },
      { phase: 'classification', rulePosition: 1, trialNumber: 1 },
      { phase: 'gallery', rulePosition: 1, trialNumber: 0 },
      { phase: 'post_gallery_query', rulePosition: 1, trialNumber: 0 },
    ];
    trials.sort(ruleChronologicalCompare);
    assert.deepStrictEqual(trials.map(t => t.phase),
      ['gallery', 'post_gallery_query', 'classification', 'end_requery']);
  });
});

// A participant id is a string from the extractor on: the report names its
// files after it and --participant compares strings. 0 and false are ids
// (a CSV's dynamic typing turns a numeric subject id into a number); a
// missing, null or empty id is not.
describe('participant ids that are not strings', () => {
  const integ = (id) => ({ trialId: id, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [] });

  for (const [id, key] of [[42, '42'], [0, '0'], [false, 'false']]) {
    it('Shape 1 with participantId ' + JSON.stringify(id) + ' is keyed "' + key + '"', () => {
      const r = extractIntegrityData({ participantId: id, trials: [{ integrity: integ('t1') }] }, {});
      assert.strictEqual(r.participantId, key);
      assert.ok(!r.warnings.some((w) => w.includes('participantId unresolved')), r.warnings.join(' | '));
    });
  }
  for (const id of [undefined, null, '']) {
    it('Shape 1 with participantId ' + JSON.stringify(id) + ' stays "unknown", with the warning', () => {
      const r = extractIntegrityData({ participantId: id, trials: [{ integrity: integ('t1') }] }, {});
      assert.strictEqual(r.participantId, 'unknown');
      assert.ok(r.warnings.some((w) => w.includes('participantId unresolved')));
    });
  }
  it('an id in metadata that is a number is keyed by its string', () => {
    assert.strictEqual(extractIntegrityData({ metadata: { participantId: 7 }, trials: [] }, {}).participantId, '7');
  });
  it('a CSV with a numeric id (dynamic typing makes it a number) is keyed by its string, 0 included', () => {
    const csv = (id) => ['participantId,integrity', id + ',"{""trialId"":""0"",""pasteEvents"":[]}"'].join('\n');
    assert.strictEqual(extractIntegrityData(parseCsvToRaw(csv('42'), {}), {}).participantId, '42');
    assert.strictEqual(extractIntegrityData(parseCsvToRaw(csv('0'), {}), {}).participantId, '0');
  });
});

// The one-line setup on lab.js writes its own id as cyborgHunterParticipantId
// on every trial row, and as participantId on row 0 only when the study has
// set none. A participantId that differs from it is the study's own.
describe('lab.js rows: the study\'s participantId and ch.js\'s id', () => {
  const row = (sender, extra) => Object.assign({ sender, sender_type: 'html.Screen' }, extra);
  const integ = (id) => ({ trialId: id, participantId: 'CH1', pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [] });

  it('a study that sets its id mid-study is keyed by that id; ch.js\'s id goes into the metadata', () => {
    const raw = [
      row('intro', { participantId: 'CH1', cyborgHunterParticipantId: 'CH1', integrity: integ('0') }),   // row 0: ch.js's stamp
      row('form', { participantId: 'R7', cyborgHunterParticipantId: 'CH1', integrity: integ('1') }),
      row('task', { cyborgHunterParticipantId: 'CH1', integrity: integ('2') })
    ];
    const r = extractIntegrityData(raw, {});
    assert.strictEqual(r.participantId, 'R7');
    assert.strictEqual(r.metadata.cyborgHunterParticipantId, 'CH1');
    assert.strictEqual(r.trials.length, 3);
  });

  it('the same id in both columns: keyed by it, no metadata entry', () => {
    const raw = [row('a', { participantId: 'CH1', cyborgHunterParticipantId: 'CH1', integrity: integ('0') })];
    const r = extractIntegrityData(raw, {});
    assert.strictEqual(r.participantId, 'CH1');
    assert.ok(!('cyborgHunterParticipantId' in r.metadata));
  });

  it('only cyborgHunterParticipantId (a custom id column the study never filled): keyed by ch.js\'s id, no warning', () => {
    const raw = [row('a', { cyborgHunterParticipantId: 'CH2', integrity: { trialId: '0', pasteEvents: [] } })];
    const r = extractIntegrityData(raw, { participantIdField: 'subject' });
    assert.strictEqual(r.participantId, 'CH2');
    assert.ok(!r.warnings.some((w) => w.includes('participantId unresolved')));
  });

  it('the Transmit envelope\'s metadata is copied, never changed', () => {
    const metadata = Object.freeze({ slice: 0, payload: 'full' });
    const raw = { metadata, url: 'https://x/', data: [row('a', { participantId: 'R1', cyborgHunterParticipantId: 'CH1', integrity: integ('0') })] };
    const r = extractIntegrityData(raw, {});
    assert.strictEqual(r.participantId, 'R1');
    assert.deepStrictEqual(r.metadata, { slice: 0, payload: 'full', cyborgHunterParticipantId: 'CH1' });
    assert.deepStrictEqual(Object.keys(metadata), ['slice', 'payload']);
  });

  it('rows are read like a { trials } file: a session report and a honeypot disclosure on a row are found', () => {
    const session = { softScore: 0.5, anyHardTriggered: false, trialsCompleted: 1, tabAwaySums: [] };
    const raw = [row('a', { participantId: 'R1', integrity: integ('0'), integritySession: session, ai_use_session: true, ai_report_session: 'yes' })];
    const r = extractIntegrityData(raw, {});
    assert.deepStrictEqual(r.session, session);
    assert.strictEqual(r.score.softScore, 0.5);
    assert.deepStrictEqual(r.honeypot, { aiUse: true, aiReport: 'yes' });
  });

  it('a lab.js CSV is keyed the same way (the study\'s id from a later row; ch.js\'s id in the metadata)', () => {
    const csv = [
      'sender,participantId,cyborgHunterParticipantId,integrity',
      'intro,CH1,CH1,"{""trialId"":""0"",""pasteEvents"":[]}"',
      'form,R7,CH1,"{""trialId"":""1"",""pasteEvents"":[]}"',
      'root,,,'
    ].join('\n');
    const r = extractIntegrityData(parseCsvToRaw(csv, {}), {});
    assert.strictEqual(r.participantId, 'R7');
    assert.strictEqual(r.metadata.cyborgHunterParticipantId, 'CH1');
  });

  it('a CSV without cyborgHunterParticipantId keeps hoisting row 0 as before', () => {
    const csv = ['participantId,integrity', ',"{""trialId"":""0""}"', 'P9,"{""trialId"":""1""}"'].join('\n');
    const raw = parseCsvToRaw(csv, {});
    assert.strictEqual(raw.participantId, 'unknown');
    assert.ok(!('metadata' in raw));
  });
});
