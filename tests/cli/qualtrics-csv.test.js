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
import { ingestWarningLines } from '../../src/cli/report.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    assert.ok(flat.some((t) => /carry no Cyborg Hunter data.*survey not published after the tag was added/.test(t)), 'the empty-rows warning names an unpublished survey');
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

// A payload cell as Qualtrics quotes it.
const cell = (o) => '"' + JSON.stringify(o).replace(/"/g, '""') + '"';
const oneTrial = [{ integrity: { trialId: 't0', pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [] } }];

describe('the ResponseId fallback under any participantIdField', () => {
  for (const field of ['workerId', 'subject_ID']) {
    it(`participantIdField ${field}: the payload's own id, else the ResponseId; no unresolved-id warning`, async () => {
      const out = await ingestFiles({ participantFiles: [reader('export.csv', text)], replayFiles: [] }, { participantIdField: field }, deps);
      assert.deepStrictEqual(out.participants.map((p) => p.participantId), ['P-ONE', 'R_2']);
      assert.strictEqual(out.participants[1].metadata.participantIdFromResponseId, true);
      assert.strictEqual(out.participants[0].metadata.participantIdFromResponseId, undefined);
      const flat = out.warnings.flatMap((w) => w.warnings.map((t) => w.file + ': ' + t));
      assert.ok(!flat.some((t) => /participantId unresolved/.test(t)), flat.join('\n'));
      assert.ok(flat.some((t) => /\(response R_2\): .*participantId taken from the ResponseId column/.test(t)));
      assert.ok(!flat.some((t) => /\(response R_1\): .*ResponseId column/.test(t)));
    });
  }
  it('a configured field the payload carries wins', async () => {
    const csv = 'StartDate,ResponseId,__js_cyborg_hunter\nx,R_8,' + cell({ participantId: 'ch-0123456789ab', workerId: 'W8', trials: oneTrial }) + '\n';
    const out = await ingestFiles({ participantFiles: [reader('export.csv', csv)], replayFiles: [] }, { participantIdField: 'workerId' }, deps);
    assert.deepStrictEqual(out.participants.map((p) => p.participantId), ['W8']);
  });
  it('a configured field that resolves to a random ch- id still falls back to the ResponseId', async () => {
    const csv = 'StartDate,ResponseId,__js_cyborg_hunter\nx,R_8,' + cell({ participantId: 'ch-0123456789ab', trials: oneTrial, metadata: { sid: 'ch-0123456789ab' } }) + '\n';
    const out = await ingestFiles({ participantFiles: [reader('export.csv', csv)], replayFiles: [] }, { participantIdField: 'metadata.sid' }, deps);
    assert.deepStrictEqual(out.participants.map((p) => p.participantId), ['R_8']);
  });
});

describe('header rows and detection', () => {
  it('a label row it does not recognise is still dropped when the ImportId row follows it', () => {
    const lines = text.split('\n');
    lines[1] = lines[1].replace('"Response ID"', '"Antwort-ID"');
    const q = parseQualtricsExport(lines.join('\n'), {});
    assert.deepStrictEqual(q.responses.map((r) => r.responseId), ['R_1', 'R_2']);
    assert.deepStrictEqual(q.invalid.map((r) => r.responseId), ['R_4']);
    assert.deepStrictEqual(q.warnings, []);
  });
  it('an ImportId row with no label row before it is dropped', () => {
    const lines = text.split('\n');
    const q = parseQualtricsExport([lines[0], ...lines.slice(2)].join('\n'), {});
    assert.deepStrictEqual(q.responses.map((r) => r.responseId), ['R_1', 'R_2']);
    assert.deepStrictEqual(q.warnings, []);
  });
  it('a jsPsych CSV that happens to carry ResponseId and cyborg_hunter columns is not an export', () => {
    assert.strictEqual(isQualtricsExport('participantId,ResponseId,trial_index,cyborg_hunter,integrity\nP1,R_1,0,,{}\n'), false);
    assert.strictEqual(isQualtricsExport('ResponseId,trial_type,__js_cyborg_hunter\n'), false);
  });
  it('header names are trimmed the same way for detection and for reading', () => {
    const csv = 'StartDate, ResponseId , __js_cyborg_hunter\nx,R_9,' + cell({ participantId: 'P9', trials: [] }) + '\n';
    assert.strictEqual(isQualtricsExport(csv), true);
    const q = parseQualtricsExport(csv, {});
    assert.deepStrictEqual(q.responses.map((r) => r.responseId), ['R_9']);
  });
});

describe('malformed cells', () => {
  it('a broken quote is reported, with record numbers and no cell text', () => {
    const csv = 'ResponseId,__js_cyborg_hunter\nR_a,"{""participantId"":""SECRET""\nR_b,' + cell({ participantId: 'P-B', trials: [] }) + '\n';
    const q = parseQualtricsExport(csv, {});
    const w = q.warnings.find((t) => /malformed/.test(t));
    assert.ok(w, q.warnings.join('\n'));
    assert.ok(!/SECRET/.test(w));
  });
  it('a cell that is not JSON is described by position and length, never quoted', () => {
    const q = parseQualtricsExport('ResponseId,__js_cyborg_hunter\nR_1,not json\nR_2,"{""participantId"":""SECRET"",}"\n', {});
    assert.deepStrictEqual(q.invalid.map((r) => r.responseId), ['R_1', 'R_2']);
    for (const bad of q.invalid) {
      assert.ok(!/not json|SECRET/.test(bad.error), bad.error);
      assert.match(bad.error, /\d+ characters/);
    }
  });
});

describe('the shape of a real export', () => {
  it('BOM, CRLF line ends and a free-text answer with a newline, a comma and quotes read like the plain fixture', () => {
    const lines = text.replace(/\n$/, '').split('\n')
      .map((l) => l.replace(',An answer,', ',"line one\r\nline, ""two""",'));
    const real = '﻿' + lines.join('\r\n') + '\r\n';
    assert.strictEqual(isQualtricsExport(real), true);
    const q = parseQualtricsExport(real, {});
    const plain = parseQualtricsExport(text, {});
    assert.deepStrictEqual(q.responses.map((r) => [r.responseId, r.rowIndex, r.raw.participantId]), plain.responses.map((r) => [r.responseId, r.rowIndex, r.raw.participantId]));
    assert.deepStrictEqual(q.empty, plain.empty);
    assert.deepStrictEqual(q.invalid.map((r) => r.responseId), ['R_4']);
    assert.deepStrictEqual(q.warnings, []);
  });
});

describe('ingest warnings on a successful run', () => {
  it('lists file-level entries first, one line per warning, capped with a count of the rest', () => {
    const ws = [
      { file: 'd/x.csv (response R_1)', response: 'R_1', warnings: ['a', 'b'] },
      { file: 'd/x.csv', warnings: ['3 of 9 responses carry no Cyborg Hunter data'] },
      ...Array.from({ length: 30 }, (_, i) => ({ file: `d/x.csv (response R_${i + 2})`, response: `R_${i + 2}`, warnings: ['c'] }))
    ];
    const lines = ingestWarningLines(ws, 20);
    assert.strictEqual(lines[0], '  Per-file warnings (33):');
    assert.strictEqual(lines[1], '    - d/x.csv: 3 of 9 responses carry no Cyborg Hunter data');
    assert.strictEqual(lines[2], '    - d/x.csv (response R_1): a');
    assert.strictEqual(lines.length, 22);
    assert.strictEqual(lines[21], '    ... and 13 more');
    assert.deepStrictEqual(ingestWarningLines([]), []);
  });
  it('a file list without responses keeps its order', () => {
    const lines = ingestWarningLines([{ file: 'b.json', warnings: ['x'] }, { file: 'a.json', warnings: ['y'] }]);
    assert.deepStrictEqual(lines, ['  Per-file warnings (2):', '    - b.json: x', '    - a.json: y']);
  });
  it('the report command prints them to stderr after the participant count, stdout unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ch-qx-'));
    try {
      mkdirSync(join(dir, 'data'));
      writeFileSync(join(dir, 'data', 'export.csv'), text);
      writeFileSync(join(dir, 'cyborg-hunter.config.json'), JSON.stringify({ dataDir: 'data', filePattern: '*.csv' }));
      const bin = new URL('../../bin/cyborg-hunter.js', import.meta.url).pathname;
      const run = spawnSync(process.execPath, [bin, 'report', '--no-visuals'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '1' } });
      assert.strictEqual(run.status, 0, run.stderr);
      assert.match(run.stdout, /Found 2 participants \(3 files had warnings\)/);
      assert.ok(!/carry no Cyborg Hunter data/.test(run.stdout));
      const err = run.stderr.split('\n');
      assert.match(err[0], /^  Per-file warnings \(\d+\):$/);
      assert.match(err[1], /export\.csv: 1 of 4 responses carry no Cyborg Hunter data/);
      assert.ok(err.some((l) => /\(response R_4\): __js_cyborg_hunter is not JSON/.test(l)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
