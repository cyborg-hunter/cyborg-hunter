// tests/cli/qualtrics-csv.test.js
// The Qualtrics CSV export reader: one export file, one participant per
// response row. The fixture (fixtures/qualtrics-export.csv) is data: three
// header rows as Qualtrics writes them, then R_1 (a level-0 payload, 2 pages,
// 1 paste, participantId P-ONE), R_2 (a payload reduced to level 2 whose
// participantId is a random ch- id), R_3 (an empty cell) and R_4 (`not json`).
// The two payloads were built with buildQualtricsPayload as of efbbbfe.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { isQualtricsExport, parseQualtricsExport } from '../../src/cli/qualtrics-csv.js';
import { ingestFiles } from '../../src/cli/ingest-core.js';

const text = readFileSync(new URL('./fixtures/qualtrics-export.csv', import.meta.url), 'utf8');
const reader = (name, t) => ({ name, path: 'data/' + name, size: t.length, read: async () => new TextEncoder().encode(t) });
const deps = { gunzip: async (b) => b, sha256: () => 'x' };

describe('isQualtricsExport', () => {
  it('needs ResponseId and the payload column in the first line', () => {
    assert.strictEqual(isQualtricsExport(text), true);
    assert.strictEqual(isQualtricsExport('trial_index,rt,integrity\n0,1,{}'), false);
    assert.strictEqual(isQualtricsExport('"ResponseId","cyborg_hunter"\n"R_1",""'), true);      // legacy field
    assert.strictEqual(isQualtricsExport('"ResponseId","other"\n'), false);
  });
  it('reads a header line that starts with a byte-order mark and ends in CRLF', () => {
    assert.strictEqual(isQualtricsExport('﻿StartDate,ResponseId,__js_cyborg_hunter\r\nx,R_1,\r\n'), true);
  });
  it('a configured field name replaces the default one', () => {
    assert.strictEqual(isQualtricsExport('ResponseId,__js_ch_custom\n', '__js_ch_custom'), true);
    assert.strictEqual(isQualtricsExport('ResponseId,__js_cyborg_hunter\n', '__js_ch_custom'), false);
  });
});

describe('parseQualtricsExport', () => {
  it('drops the two extra header rows and returns one raw per response', () => {
    const q = parseQualtricsExport(text, {});
    assert.strictEqual(q.column, '__js_cyborg_hunter');
    assert.deepStrictEqual(q.responses.map((r) => r.responseId), ['R_1', 'R_2']);
    assert.deepStrictEqual(q.empty, ['R_3']);
    assert.deepStrictEqual(q.invalid.map((r) => r.responseId), ['R_4']);
    assert.strictEqual(q.responses[0].raw.metadata.qualtricsResponseId, 'R_1');
    assert.strictEqual(q.responses[0].raw.participantId, 'P-ONE');
    assert.strictEqual(q.responses[1].raw.participantId, 'R_2');            // ch- random id replaced
    assert.strictEqual(q.responses[1].raw.metadata.participantIdFromResponseId, true);
  });
  it('reads a one-header-row export too', () => {
    const lines = text.split('\n');
    const one = [lines[0], ...lines.slice(3)].join('\n');
    const q = parseQualtricsExport(one, {});
    assert.deepStrictEqual(q.responses.map((r) => r.responseId), ['R_1', 'R_2']);
    assert.ok(q.warnings.some((w) => /one header row/.test(w)));
  });
  it('numbers data rows from 1 after the header rows, and keeps a linkable participantId', () => {
    const q = parseQualtricsExport(text, {});
    assert.deepStrictEqual(q.responses.map((r) => r.rowIndex), [1, 2]);
    assert.strictEqual(q.invalid[0].rowIndex, 4);
    assert.strictEqual(q.responses[0].raw.metadata.participantIdFromResponseId, undefined);
    assert.deepStrictEqual(q.warnings, []);
  });
  it('uses the legacy-layout column when the export has only that one', () => {
    const q = parseQualtricsExport('ResponseId,cyborg_hunter\nR_9,"{""participantId"":""P9"",""trials"":[]}"\n', {});
    assert.strictEqual(q.column, 'cyborg_hunter');
    assert.deepStrictEqual(q.responses.map((r) => r.raw.participantId), ['P9']);
  });
  it('a cell that parses to something other than an object is invalid, not a response', () => {
    const q = parseQualtricsExport('ResponseId,__js_cyborg_hunter\nR_5,null\nR_6,42\n', {});
    assert.deepStrictEqual(q.responses, []);
    assert.deepStrictEqual(q.invalid.map((r) => r.responseId), ['R_5', 'R_6']);
  });
  it('a payload with no participantId takes the ResponseId', () => {
    const q = parseQualtricsExport('ResponseId,__js_cyborg_hunter\nR_7,"{""trials"":[]}"\n', {});
    assert.strictEqual(q.responses[0].raw.participantId, 'R_7');
    assert.strictEqual(q.responses[0].raw.metadata.participantIdFromResponseId, true);
  });
});

describe('ingestFiles with a Qualtrics export', () => {
  it('yields one participant per response, counts empty rows, reports the invalid one, surfaces truncation', async () => {
    const out = await ingestFiles({ participantFiles: [reader('export.csv', text)], replayFiles: [] }, { participantIdField: 'participantId', qualtricsField: '__js_cyborg_hunter' }, deps);
    assert.deepStrictEqual(out.participants.map((p) => p.participantId), ['P-ONE', 'R_2']);
    assert.strictEqual(out.participants[0].trials.length, 2);
    assert.strictEqual(out.participants[0].session.pasteCount, 1);
    assert.strictEqual(out.participants[0].metadata.qualtricsResponseId, 'P-ONE' === out.participants[0].participantId ? 'R_1' : undefined);
    const flat = out.warnings.flatMap((w) => w.warnings.map((t) => w.file + ': ' + t));
    assert.ok(flat.some((t) => /1 of 4 responses carry no Cyborg Hunter data/.test(t)));
    assert.ok(flat.some((t) => /\(response R_4\): __js_cyborg_hunter is not JSON/.test(t)));
    assert.ok(flat.some((t) => /\(response R_2\): .*reduced to fit the embedded-data cap \(level 2/.test(t)));
    assert.ok(flat.some((t) => /\(response R_2\): .*participantId taken from the ResponseId column/.test(t)));
  });
  it('a jsPsych CSV still goes through parseCsvToRaw (one participant per file)', async () => {
    const js = 'participantId,trial_index,integrity\nP9,0,"{""trialId"":""t0"",""pasteEvents"":[],""copyEvents"":[],""dropEvents"":[],""tabAwayEvents"":[]}"\n';
    const out = await ingestFiles({ participantFiles: [reader('p9.csv', js)], replayFiles: [] }, { participantIdField: 'participantId' }, deps);
    assert.deepStrictEqual(out.participants.map((p) => p.participantId), ['P9']);
  });
  it('--participant keeps one response of the export', async () => {
    const out = await ingestFiles({ participantFiles: [reader('export.csv', text)], replayFiles: [] }, { participantIdField: 'participantId', singleParticipant: 'R_2' }, deps);
    assert.deepStrictEqual(out.participants.map((p) => p.participantId), ['R_2']);
  });
  it('a response whose payload holds no usable trials is reported under its row, and the others still count', async () => {
    const lines = text.split('\n');
    lines[5] += '"{""participantId"":""P3"",""trials"":5}"';      // R_3's empty cell, filled
    const out = await ingestFiles({ participantFiles: [reader('export.csv', lines.join('\n'))], replayFiles: [] }, { participantIdField: 'participantId' }, deps);
    assert.deepStrictEqual(out.participants.map((p) => p.participantId), ['P-ONE', 'R_2']);
    assert.ok(out.warnings.some((w) => w.file === 'data/export.csv (response R_3)'));
    assert.ok(!out.warnings.some((w) => w.warnings.some((t) => /carry no Cyborg Hunter data/.test(t))));
  });
});
