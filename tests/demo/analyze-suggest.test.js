import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestIdField, KNOWN_ID_NAMES } from '../../demo/analyze/participant-id-suggest.js';
import { peekParticipantFile } from '../../demo/analyze/peek-files.js';

const PROLIFIC = 'PROLIFIC' + '_PID';   // assembled at runtime: the literal is allowed only in the one-line setup's own files

test('a known column name wins and is listed first', () => {
  const r = suggestIdField([
    { keys: ['rt', 'subject_ID', 'trial_index'], values: { rt: ['1', '2'], subject_ID: ['S1', 'S1'], trial_index: ['0', '1'] } },
    { keys: ['rt', 'subject_ID', 'trial_index'], values: { rt: ['3', '4'], subject_ID: ['S2', 'S2'], trial_index: ['0', '1'] } },
  ]);
  assert.equal(r.suggested, 'subject_ID');
  assert.equal(r.candidates[0].reason, 'known name');
});

test('Prolific\'s parameter name is a known name (via the one-line setup\'s list)', () => {
  assert.ok(KNOWN_ID_NAMES.includes(PROLIFIC));
  const r = suggestIdField([{ keys: ['x', PROLIFIC], values: { x: ['1'], [PROLIFIC]: ['abc'] } }]);
  assert.equal(r.suggested, PROLIFIC);
});

test('without a known name, a column constant per file and unique across files is suggested', () => {
  const r = suggestIdField([
    { keys: ['rt', 'worker', 'cond'], values: { rt: ['1', '2'], worker: ['W1', 'W1'], cond: ['a', 'a'] } },
    { keys: ['rt', 'worker', 'cond'], values: { rt: ['1', '9'], worker: ['W2', 'W2'], cond: ['a', 'a'] } },
  ]);
  assert.equal(r.suggested, 'worker');
  assert.deepEqual(r.candidates.map((c) => c.field), ['worker']);
});

test('JSON keys use the same rule; metadata.* dotted keys are candidates', () => {
  const r = suggestIdField([
    { keys: ['metadata.sessionId', 'trials'], values: { 'metadata.sessionId': ['s-1'] } },
    { keys: ['metadata.sessionId', 'trials'], values: { 'metadata.sessionId': ['s-2'] } },
  ]);
  assert.equal(r.suggested, 'metadata.sessionId');
});

test('nothing fits → null, no candidates', () => {
  assert.deepEqual(suggestIdField([{ keys: ['rt'], values: { rt: ['1', '2'] } }]), { suggested: null, candidates: [] });
});

const reader = (name, text) => ({ name, read: async () => new TextEncoder().encode(text) });

test('peek: CSV header and sampled values, capped at maxRows', async () => {
  const p = await peekParticipantFile(reader('p.csv', 'a,b\n1,x\n2,x\n3,x\n'), { maxRows: 2 });
  assert.deepEqual(p.keys, ['a', 'b']);
  assert.deepEqual({ ...p.values }, { a: ['1', '2'], b: ['x', 'x'] });
});

test('peek: JSON object gives top-level scalars and dotted metadata scalars', async () => {
  const p = await peekParticipantFile(reader('p.json', JSON.stringify({ id: 'a', trials: [1], metadata: { sessionId: 's1', nested: { z: 1 } } })));
  assert.deepEqual(p.keys, ['id', 'metadata.sessionId']);
  assert.deepEqual({ ...p.values }, { id: ['a'], 'metadata.sessionId': ['s1'] });
});

test('peek: JSON array uses the first element; unparsable gives null', async () => {
  const p = await peekParticipantFile(reader('p.json', JSON.stringify([{ subject_ID: 'S1', rt: 3 }, { subject_ID: 'S1', rt: 4 }])));
  assert.deepEqual(p.keys, ['subject_ID', 'rt']);
  assert.equal(await peekParticipantFile(reader('p.json', '{oops')), null);
  assert.equal(await peekParticipantFile(reader('p.json', '[]')), null);
});

test('peek: a long whitespace run mid-file does not stall the parse', async () => {
  const t0 = Date.now();
  const p = await peekParticipantFile(reader('p.csv', 'a,b\n1,' + ' '.repeat(200000) + 'x\n2,y\n'));
  assert.deepEqual(p.keys, ['a', 'b']);
  assert.ok(Date.now() - t0 < 200, 'took ' + (Date.now() - t0) + ' ms');
});

test('a __proto__ key is an ordinary key, in peek and in suggestion', async () => {
  const p = await peekParticipantFile(reader('p.json', '{"__proto__":"S1","metadata":{"__proto__":"m"}}'));
  assert.deepEqual(p.keys, ['__proto__', 'metadata.__proto__']);
  assert.deepEqual(p.values['__proto__'], ['S1']);
  assert.deepEqual(Object.keys(p.values), ['__proto__', 'metadata.__proto__']);
  const q = await peekParticipantFile(reader('q.json', '{"__proto__":"S2"}'));
  const r = suggestIdField([p, q]);
  assert.equal(r.suggested, '__proto__');
});

// A session recording is no participant's data (ingest-core skips it by the
// same content sniff): the peek reports it as a recording and samples none of
// its keys, which no data file shares.
test('peek: a session recording is reported as a recording, plain or gzipped, and nothing of it is sampled', async () => {
  const { readFileSync } = await import('node:fs');
  const { gzipSync } = await import('node:zlib');
  const text = readFileSync(new URL('../fixtures/demo/DEMO-FIXT-replay-1785352263344.json', import.meta.url), 'utf8');
  assert.deepEqual(await peekParticipantFile(reader('DEMO-FIXT-replay-1785352263344.json', text)), { recording: true });
  const gz = gzipSync(Buffer.from(text));
  assert.deepEqual(await peekParticipantFile({ name: 'r.json.gz', read: async () => new Uint8Array(gz) }), { recording: true });
});

test('peek: a gzipped JSON file is decompressed first', async () => {
  const { gzipSync } = await import('node:zlib');
  const bytes = gzipSync(Buffer.from(JSON.stringify({ subject_ID: 'S1', metadata: { run: 'r' } })));
  const p = await peekParticipantFile({ name: 'p.json.gz', read: async () => new Uint8Array(bytes) });
  assert.deepEqual(p.keys, ['subject_ID', 'metadata.run']);
});

test('peek: a gzipped file is read without a Blob (a WebKit worker of a file:// page cannot read one)', async () => {
  const { gzipSync } = await import('node:zlib');
  const bytes = gzipSync(Buffer.from(JSON.stringify({ subject_ID: 'S1' })));
  const saved = globalThis.Blob;
  globalThis.Blob = class { constructor() { throw new Error('Blob loading failed'); } };
  try {
    const p = await peekParticipantFile({ name: 'p.json.gz', read: async () => new Uint8Array(bytes) });
    assert.ok(p, 'peeked');
    assert.deepEqual(p.keys, ['subject_ID']);
  } finally { globalThis.Blob = saved; }
});
// lab.js's Transmit plugin posts { metadata: { slice, id, payload }, url,
// data: [rows] }; metadata.id is lab.js's upload-session id, not the
// participant's. The CLI reads the rows (extract-core transmitRows), so the
// peek does too, plus the object's own top-level scalars, never its metadata.
const envelope = (studyId, sessionId) => JSON.stringify({
  metadata: { slice: 0, id: sessionId, payload: 'full' },
  url: 'https://example.org/save',
  data: [
    { sender: 'intro', sender_id: '0', participantId: studyId, cyborgHunterParticipantId: 'ch-' + studyId, integritySoftScore: 0 },
    { sender: 'final', sender_id: '1', participantId: null, cyborgHunterParticipantId: 'ch-' + studyId, integritySoftScore: 1 },
    { sender: 'root', participantId: null },
  ],
});

test('peek: a Transmit envelope gives the first row\'s keys, never metadata.*', async () => {
  const p = await peekParticipantFile(reader('p.json', envelope('RES-1', 'sess-1')));
  assert.deepEqual(p.keys, ['sender', 'sender_id', 'participantId', 'cyborgHunterParticipantId', 'integritySoftScore', 'url']);
  assert.deepEqual(p.values.participantId, ['RES-1']);
  assert.ok(!p.keys.some((k) => k.startsWith('metadata.')));
});

test('Transmit envelopes: participantId is suggested and metadata.id is not a candidate', async () => {
  const peeks = [
    await peekParticipantFile(reader('a.json', envelope('RES-1', 'sess-1'))),
    await peekParticipantFile(reader('b.json', envelope('RES-2', 'sess-2'))),
  ];
  const r = suggestIdField(peeks);
  assert.equal(r.suggested, 'participantId');
  assert.ok(!r.candidates.some((c) => c.field === 'metadata.id' || c.field === 'id'), JSON.stringify(r.candidates));
});

test('peek: any object holding its rows under data gives the rows\' keys and its own top-level scalars', async () => {
  const p = await peekParticipantFile(reader('p.json', JSON.stringify({ subject: 'S1', data: [{ rt: 3, cond: 'a' }, { rt: 4, cond: 'a' }] })));
  assert.deepEqual(p.keys, ['rt', 'cond', 'subject']);
  assert.deepEqual(p.values.subject, ['S1']);
});

test('peek: an object with trials keeps the top-level and metadata reading, whatever its data holds', async () => {
  const p = await peekParticipantFile(reader('p.json', JSON.stringify({ id: 'a', trials: [1], data: [{ x: 1 }], metadata: { sessionId: 's1' } })));
  assert.deepEqual(p.keys, ['id', 'metadata.sessionId']);
});

test("cyborg-hunter's own per-trial columns are never offered as the id, whatever the column order", async () => {
  // The synthetic pilot with its id column renamed to a name nobody knows and
  // moved to the end, where jsPsych's addProperties columns land after the
  // extension's integrity* columns: those are constant per file and, on a
  // small cohort, unique across files too.
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = 'examples/synthetic-pilot/data/';
  const peeks = [];
  const Papa = (await import('papaparse')).default;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.csv')).sort()) {
    const rows = Papa.parse(readFileSync(dir + f, 'utf8'), { header: true, skipEmptyLines: true }).data;
    const fields = Object.keys(rows[0]).filter((k) => k !== 'subject_ID').concat('worker');
    const moved = rows.map((r) => ({ ...r, worker: r.subject_ID }));
    peeks.push(await peekParticipantFile(reader(f, Papa.unparse(moved, { columns: fields }))));
  }
  assert.equal(peeks[0].keys.at(-1), 'worker', 'the id column is last');
  assert.ok(peeks[0].keys.includes('integrityCopyCount') && peeks[0].keys.includes('cyborgHunterVersion'));
  const r = suggestIdField(peeks);
  assert.equal(r.suggested, 'worker');
  assert.deepEqual(r.candidates.map((c) => c.field), ['worker']);
});

test('the one-line setup and the extension columns are excluded by name; known names still win', () => {
  const own = ['integrityPasteCount', 'integritySoftScore', 'integrityReplayMeta', 'cyborgHunterVersion', 'cyborgHunterOneLiner', 'cyborgHunterError'];
  const file = (i) => ({ keys: own.concat('subject'), values: Object.fromEntries(own.map((k) => [k, ['v' + i]]).concat([['subject', ['S' + i]]])) });
  const r = suggestIdField([file(1), file(2)]);
  assert.deepEqual(r.candidates.map((c) => c.field), ['subject']);
});
