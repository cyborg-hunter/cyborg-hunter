// The opt-in pseudonymized export (config.pseudonymize): stable HMAC codes,
// the key file that maps them back, and a report in which no raw participant
// ID survives, built end to end through ingest and buildReport.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingest, nodeDeps } from '../../src/cli/ingest.js';
import { mergeConfig } from '../../src/cli/config-core.js';
import { buildReport, renderInPageHtml } from '../../src/cli/report-core.js';
import { webHmacSha256 } from '../../demo/analyze/web-deps.js';
import {
  KEY_FILE_BANNER, pseudonymCode, assignCodes, parseKeyFile, keyFileUpdate, pseudonymizeParticipants, pseudonymizeWarnings,
} from '../../src/cli/pseudonymize-core.js';

if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;

const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);
const hmac = nodeDeps.hmacSha256;

describe('pseudonym codes', () => {
  it('are P- and 10 hex digits, the same for the same secret and id', async () => {
    const a = await pseudonymCode(SECRET, 'PROLIFICX5d1e9f00aa', hmac);
    assert.match(a, /^P-[0-9a-f]{10}$/);
    assert.equal(await pseudonymCode(SECRET, 'PROLIFICX5d1e9f00aa', hmac), a);
    assert.notEqual(await pseudonymCode(OTHER_SECRET, 'PROLIFICX5d1e9f00aa', hmac), a, 'another secret, another code');
    assert.notEqual(await pseudonymCode(SECRET, 'MTURKA2Z9QX7YYB', hmac), a, 'another id, another code');
  });

  it('come out the same from the browser\'s crypto.subtle as from node:crypto', async () => {
    for (const id of ['PROLIFICX5d1e9f00aa', 'ünïcode-id', '']) {
      assert.equal(await pseudonymCode(SECRET, id, webHmacSha256), await pseudonymCode(SECRET, id, hmac), id);
    }
  });

  it('assignCodes maps each distinct id once and refuses two ids that share a code', async () => {
    const codes = await assignCodes(['x', 'y', 'x'], SECRET, hmac);
    assert.deepEqual([...codes.keys()], ['x', 'y']);
    await assert.rejects(assignCodes(['x', 'y'], SECRET, () => '00000000000000'), /x.*y.*same code/);
  });
});

describe('the key file', () => {
  it('is the banner, the secret, a header and one row per participant', async () => {
    const codes = await assignCodes(['PROLIFICX5d1e9f00aa', '=1+2'], SECRET, hmac);
    const { text, added } = keyFileUpdate(null, SECRET, codes);
    assert.equal(added, 2);
    assert.equal(text, [
      KEY_FILE_BANNER,
      '# secret,' + SECRET,
      'code,participantId',
      codes.get('PROLIFICX5d1e9f00aa') + ',PROLIFICX5d1e9f00aa',
      codes.get('=1+2') + ",'=1+2",   // csv-cell.js: a formula-like cell is defused
      '',
    ].join('\n'));
    assert.equal(KEY_FILE_BANNER, '# cyborg-hunter pseudonym key — keep private; do not share with the report');
  });

  it('is reused: its secret comes back, and only new participants are appended', async () => {
    const first = keyFileUpdate(null, SECRET, await assignCodes(['A-1', 'B-2'], SECRET, hmac)).text;
    const parsed = parseKeyFile(first);
    assert.equal(parsed.secret, SECRET);
    const again = keyFileUpdate(first, parsed.secret, await assignCodes(['B-2', 'A-1'], parsed.secret, hmac));
    assert.deepEqual([again.text, again.added], [first, 0], 'the same cohort adds nothing');
    const codes = await assignCodes(['A-1', 'C-3'], parsed.secret, hmac);
    const grown = keyFileUpdate(first, parsed.secret, codes);
    assert.equal(grown.added, 1);
    assert.equal(grown.text, first + codes.get('C-3') + ',C-3\n');
  });

  it('reads a file a spreadsheet saved back (CRLF, a BOM, no final newline)', async () => {
    const codes = await assignCodes(['A-1'], SECRET, hmac);
    const saved = '﻿' + keyFileUpdate(null, SECRET, codes).text.trimEnd().replace(/\n/g, '\r\n');
    assert.equal(parseKeyFile(saved).secret, SECRET);
    const grown = keyFileUpdate(saved, SECRET, await assignCodes(['A-1', 'B-2'], SECRET, hmac));
    assert.equal(grown.added, 1);
    assert.ok(grown.text.startsWith(saved + '\n'), 'appended on a line of its own');
  });

  it('refuses a file without a secret line, or with a malformed secret', () => {
    assert.throws(() => parseKeyFile('code,participantId\nP-0123456789,x\n'), /secret/);
    assert.throws(() => parseKeyFile(KEY_FILE_BANNER + '\n# secret,xyz\ncode,participantId\n'), /secret/);
  });
});

// Two participants whose ids are distinctive strings, so a grep of every
// output finds any copy that survived: one with a dom-tier recording (built
// from the demo fixture: its id swapped in the tracker file, the recording's
// participant_id set and the file named after it), a platform id, a
// Qualtrics response id and ch.js's own id; one with none of those.
const RAW = {
  pidA: 'PROLIFICX5d1e9f00aa', pidB: 'MTURKA2Z9QX7YYB',
  platform: 'PLATFORMQ77abc9', qualtrics: 'R_QUALTRICSzz91', chId: 'CHIDw3x9k2mm',
};

function writeCohort(dir) {
  const tracker = (pid) => JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT.json', 'utf8').replaceAll('DEMO-FIXT', pid));
  const a = tracker(RAW.pidA);
  a.metadata = { ...(a.metadata || {}), platform_pid: RAW.platform, qualtricsResponseId: RAW.qualtrics, cyborgHunterParticipantId: RAW.chId };
  a.trials[0].cyborgHunterParticipantId = RAW.chId;
  a.trials[0].platform_pid = RAW.platform;
  writeFileSync(join(dir, RAW.pidA + '.json'), JSON.stringify(a));
  const rec = JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT-replay-1785352263344.json', 'utf8'));
  rec.participant_id = RAW.pidA;
  // Structured data inside the recording that names the participant: the
  // viewer model must not carry it into replay/<code>.replay.js.
  rec.segments[0].host_data = { subject_ID: RAW.pidA, participantId: RAW.pidA };
  rec.segments[0].extensions = { ...(rec.segments[0].extensions || {}), 'cyborg-hunter': { ...((rec.segments[0].extensions || {})['cyborg-hunter'] || {}), participantId: RAW.pidA } };
  writeFileSync(join(dir, RAW.pidA + '-replay-1785352263344.json'), JSON.stringify(rec));
  writeFileSync(join(dir, RAW.pidB + '.json'), JSON.stringify(tracker(RAW.pidB)));
}

async function buildAll(participants, config, createCanvas) {
  const out = {};
  const deps = {
    sink: (path, data) => { out[path] = data; }, keepImages: true, sha256: nodeDeps.sha256,
    createCanvas, encodePng: async (c) => new Uint8Array(c.toBuffer('image/png')),
    replayClientSrc: '/* client */', fontFaceCss: '',
  };
  const built = await buildReport(participants, config, deps);
  out['(in-page report)'] = await renderInPageHtml(built, participants, config, { replayClientSrc: '/* client */', fontFaceCss: '' });
  return { out, built };
}

// Every raw identifier found in an output's name or content.
function leaks(out) {
  const found = [];
  for (const [path, data] of Object.entries(out)) {
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('latin1');
    for (const raw of Object.values(RAW)) {
      if (path.includes(raw)) found.push(path + ' (name): ' + raw);
      if (text.includes(raw)) found.push(path + ': ' + raw);
    }
  }
  return found;
}

describe('a pseudonymized report', () => {
  let dir, participants, createCanvas;
  const fileConfig = { platformIdField: 'platform_pid', showPlatformId: true };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ch-pseudo-'));
    writeCohort(dir);
    try { createCanvas = (await import('canvas')).createCanvas; } catch { createCanvas = null; }
    const { config } = mergeConfig({ ...fileConfig, dataDir: dir });
    ({ participants } = await ingest(config));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('the fixture is a fair test: without pseudonymization the raw ids reach the outputs', async () => {
    assert.deepEqual(participants.map((p) => p.participantId).sort(), [RAW.pidA, RAW.pidB].sort());
    assert.ok(participants.find((p) => p.participantId === RAW.pidA).replay.recording, 'the recording attached');
    const { config } = mergeConfig(fileConfig);
    const { out } = await buildAll(participants, config, createCanvas);
    const found = leaks(out).join('\n');
    for (const raw of [RAW.pidA, RAW.pidB, RAW.platform]) assert.ok(found.includes(raw), raw + ' is visible in a plain report');
    assert.ok(Object.keys(out).some((p) => p.startsWith('replay/') && p.includes(RAW.pidA)), 'the replay file is named by the raw id');
  });

  it('carries no raw id in any output, its name or its content', async () => {
    const { config } = mergeConfig({ ...fileConfig, pseudonymize: true });
    const codes = await assignCodes(participants.map((p) => p.participantId), SECRET, hmac);
    const coded = pseudonymizeParticipants(participants, codes, config);
    const { out, built } = await buildAll(coded, config, createCanvas);
    assert.deepEqual(leaks(out), []);
    const codeA = codes.get(RAW.pidA);
    assert.ok(out['replay/' + codeA + '.replay.js'], 'the replay file is named by the code');
    assert.match(Buffer.from(out['replay/' + codeA + '.replay.js']).toString('utf8'), new RegExp('"pid":"' + codeA + '"'), 'the viewer shows the code');
    if (createCanvas) assert.ok(out['images/trajectories_' + codeA + '.png'], 'images are named by the code');
    assert.deepEqual(built.triageOrder.slice().sort(), [...codes.values()].sort());
    assert.match(out['summary.csv'], new RegExp('^' + codeA + ',', 'm'));
  });

  it('says in index.html and triage.md that the ids are pseudonymized codes', async () => {
    const { config } = mergeConfig({ pseudonymize: true });
    const coded = pseudonymizeParticipants(participants, await assignCodes(participants.map((p) => p.participantId), SECRET, hmac), config);
    const { out } = await buildAll(coded, config, null);
    assert.match(out['index.html'], /<span class="meta">[^<]*participant IDs are pseudonymized codes/);
    assert.match(out['triage.md'], /_2 participants analyzed_\n\n_Participant IDs are pseudonymized codes; the key that maps them back is kept apart from this report._\n/);
    const plain = (await buildAll(participants, mergeConfig({}).config, null)).out;
    assert.doesNotMatch(plain['index.html'] + plain['triage.md'], /pseudonymized/i);
  });

  it('copies: the participants it was given keep their raw ids', async () => {
    const { config } = mergeConfig({ ...fileConfig, pseudonymize: true });
    const before = JSON.stringify(participants.map((p) => [p.participantId, p.metadata, p.trials[0], p.replay && p.replay.file]));
    pseudonymizeParticipants(participants, await assignCodes(participants.map((p) => p.participantId), SECRET, hmac), config);
    assert.equal(JSON.stringify(participants.map((p) => [p.participantId, p.metadata, p.trials[0], p.replay && p.replay.file])), before);
  });

  it('buildReport refuses raw participants when the config asks for pseudonymization', async () => {
    const { config } = mergeConfig({ pseudonymize: true });
    await assert.rejects(buildReport(participants, config, { sink: () => {} }), /pseudonymize/);
  });
});

describe('pseudonymizing deeply nested participant data', () => {
  it('copies a value nested far deeper than the call stack, and still codes the ids inside it', async () => {
    // JSON.parse reads such a value without recursion, so it reaches the
    // copy; built here as an object chain 200,000 deep.
    let deep = { participantId: 'DEEP-RAW', note: 'leaf' };
    for (let i = 0; i < 200000; i++) deep = [deep];
    const p = { participantId: 'DEEP-RAW', metadata: {}, trials: [{ trialId: 't0', extra: deep, keep: { a: 1, b: [2, 3] } }] };
    const codes = await assignCodes(['DEEP-RAW'], SECRET, hmac);
    const [copy] = pseudonymizeParticipants([p], codes, {});
    let leaf = copy.trials[0].extra;
    let depth = 0;
    while (Array.isArray(leaf)) { leaf = leaf[0]; depth++; }
    assert.equal(depth, 200000);
    assert.deepEqual(leaf, { participantId: codes.get('DEEP-RAW'), note: 'leaf' });
    assert.deepEqual(Object.keys(copy.trials[0]), ['trialId', 'extra', 'keep'], 'keys keep their order');
    assert.deepEqual(copy.trials[0].keep, { a: 1, b: [2, 3] });
  });
});

describe('pseudonymized text that names participants', () => {
  it('the reason a replay is not shown carries no raw id, nor the form file names give it', async () => {
    const RAWID = 'AB/CD';            // file names carry it as AB_CD
    const dir = mkdtempSync(join(tmpdir(), 'ch-pseudo-reason-'));
    try {
      const data = readFileSync('tests/fixtures/demo/DEMO-FIXT.json', 'utf8').replaceAll('"DEMO-FIXT"', JSON.stringify(RAWID));
      writeFileSync(join(dir, 'first.json'), data);
      writeFileSync(join(dir, 'second.json'), data);
      for (const [epoch, shift] of [[1785352263344, 0], [1785355863344, 3600e3]]) {
        const rec = JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT-replay-1785352263344.json', 'utf8'));
        rec.participant_id = RAWID;
        rec.recording_started_at = new Date(Date.parse(rec.recording_started_at) + shift).toISOString();
        writeFileSync(join(dir, `AB_CD-replay-${epoch}.json`), JSON.stringify(rec));
      }
      const { config } = mergeConfig({ dataDir: dir, filePattern: '*.json', participantIdField: 'participantId', pseudonymize: true });
      const { participants } = await ingest(config);
      assert.equal(participants[0].replay.error, 'ambiguous');
      assert.match(participants[0].replay.reason, /AB_CD-replay-/, 'the plain reason lists the files');
      const coded = pseudonymizeParticipants(participants, await assignCodes(participants.map((p) => p.participantId), SECRET, hmac), config);
      const { out } = await buildAll(coded, config, null);
      for (const [path, text] of Object.entries(out)) {
        if (typeof text !== 'string') continue;
        assert.ok(!text.includes('AB_CD') && !text.includes(RAWID), path + ' names the participant');
      }
      assert.match(coded[0].replay.reason, /P-[0-9a-f]{10}-replay-/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pseudonymizeWarnings: ids, Qualtrics response ids and ch.js ids become codes; a longer id is not cut', async () => {
    const participants = [
      { participantId: 'P1', metadata: { qualtricsResponseId: 'R_abc123' } },
      { participantId: 'P10', metadata: { cyborgHunterParticipantId: 'ch-zz9' } },
      { participantId: 'A/B', metadata: {} },
    ];
    const codes = await assignCodes(participants.map((p) => p.participantId), SECRET, hmac);
    const out = pseudonymizeWarnings([
      { file: 'data/P1.json', warnings: ['duplicate participantId "P1" appears in 2 files'] },
      { file: 'export.csv (response R_abc123)', response: 'R_abc123', warnings: ['P10 and ch-zz9; A_B-replay-1.json and A/B'] },
    ], participants, codes);
    const [c1, c10, cab] = ['P1', 'P10', 'A/B'].map((id) => codes.get(id));
    assert.deepEqual(out, [
      { file: `data/${c1}.json`, warnings: [`duplicate participantId "${c1}" appears in 2 files`] },
      { file: `export.csv (response ${c1})`, response: c1, warnings: [`${c10} and ${c10}; ${cab}-replay-1.json and ${cab}`] },
    ]);
  });
});
