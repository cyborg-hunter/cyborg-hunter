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

  it('module source has no fs/path/zlib imports', () => {
    const src = readFileSync(new URL('../../src/cli/extract-core.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from ['"](node:)?(fs|path|zlib)['"]/);
  });

  it('segment-reassembly.js (imported by extract-core) imports nothing', () => {
    const src = readFileSync(new URL('../../src/cli/segment-reassembly.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /^\s*import\s/m);
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
