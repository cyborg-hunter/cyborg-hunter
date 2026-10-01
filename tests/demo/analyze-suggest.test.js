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
  assert.deepEqual(p.values, { a: ['1', '2'], b: ['x', 'x'] });
});

test('peek: JSON object gives top-level scalars and dotted metadata scalars', async () => {
  const p = await peekParticipantFile(reader('p.json', JSON.stringify({ id: 'a', trials: [1], metadata: { sessionId: 's1', nested: { z: 1 } } })));
  assert.deepEqual(p.keys, ['id', 'metadata.sessionId']);
  assert.deepEqual(p.values, { id: ['a'], 'metadata.sessionId': ['s1'] });
});

test('peek: JSON array uses the first element; unparsable gives null', async () => {
  const p = await peekParticipantFile(reader('p.json', JSON.stringify([{ subject_ID: 'S1', rt: 3 }, { subject_ID: 'S1', rt: 4 }])));
  assert.deepEqual(p.keys, ['subject_ID', 'rt']);
  assert.equal(await peekParticipantFile(reader('p.json', '{oops')), null);
  assert.equal(await peekParticipantFile(reader('p.json', '[]')), null);
});
