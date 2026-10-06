// The analyze page's side of the report's annotations
// (demo/analyze/annotations.js): which posted changes it accepts, and its
// storage under the run id. The wiring is tests/demo/analyze-page.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAnnotate, loadAnnotations, readAnnotations, saveAnnotations, storageKey } from '../../demo/analyze/annotations.js';

const RUN = '0123456789abcdef';
const IDS = ['A', 'B'];
const NOW = '2026-10-05T14:00:00.000Z';
const change = (over) => ({ type: 'cyborg-hunter:annotate', runId: RUN, participantId: 'A', label: 'exclude', note: 'pasted', ...over });

test('a change from this run, for a participant of this report, with a known label applies', () => {
  const state = Object.create(null);
  assert.equal(applyAnnotate(state, change(), RUN, IDS, NOW), true);
  assert.deepEqual({ ...state }, { A: { label: 'exclude', note: 'pasted', annotatedAt: NOW } });
  assert.equal(applyAnnotate(state, change({ label: null, note: '' }), RUN, IDS, NOW), true, 'no label and no note: not reviewed');
  assert.deepEqual({ ...state }, {});
});

test('another run, an unknown participant, another label or a note that is not text is refused', () => {
  const state = Object.create(null);
  for (const bad of [change({ runId: 'ffffffffffffffff' }), change({ participantId: 'Z' }), change({ participantId: { toString: () => 'A' } }),
    change({ label: 'reject' }), change({ note: 42 }), null]) {
    assert.equal(applyAnnotate(state, bad, RUN, IDS, NOW), false);
  }
  assert.deepEqual({ ...state }, {});
});

test('a note longer than the report\'s note field allows is refused', () => {
  const state = Object.create(null);
  assert.equal(applyAnnotate(state, change({ note: 'x'.repeat(2001) }), RUN, IDS, NOW), false);
  assert.equal(applyAnnotate(state, change({ note: 'x'.repeat(2000) }), RUN, IDS, NOW), true);
});

test('the state is stored under ch-annot:<runId>; a storage that refuses leaves it in memory', () => {
  const items = new Map();
  const storage = { getItem: (k) => (items.has(k) ? items.get(k) : null), setItem: (k, v) => items.set(k, v) };
  assert.equal(storageKey(RUN), 'ch-annot:' + RUN);
  saveAnnotations(storage, RUN, { A: { label: 'flag', note: '', annotatedAt: NOW } });
  assert.deepEqual({ ...loadAnnotations(storage, RUN) }, { A: { label: 'flag', note: '', annotatedAt: NOW } });
  assert.deepEqual({ ...loadAnnotations(storage, 'ffffffffffffffff') }, {}, 'another run starts empty');
  const refusing = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } };
  assert.deepEqual({ ...loadAnnotations(refusing, RUN) }, {});
  saveAnnotations(refusing, RUN, {});
  assert.deepEqual({ ...loadAnnotations(null, RUN) }, {});
});

// Any page of the origin can write the key, so what it holds is read as an
// import is. readAnnotations throws where storage is refused, so that the
// page can tell "nothing stored" from "storage refused" before a merge.
test('what storage holds is read as an import is; with the report\'s ids, only theirs', () => {
  const items = new Map([[storageKey(RUN), JSON.stringify({ A: { label: 'flag', note: '', annotatedAt: NOW },
    B: { label: 'reject', note: '' }, Z: { label: 'include', note: '', annotatedAt: NOW } })]]);
  const storage = { getItem: (k) => (items.has(k) ? items.get(k) : null), setItem: (k, v) => items.set(k, v) };
  assert.deepEqual(Object.keys(loadAnnotations(storage, RUN)), ['A', 'Z']);
  assert.deepEqual(Object.keys(loadAnnotations(storage, RUN, IDS)), ['A']);
  assert.deepEqual(Object.keys(readAnnotations(storage, RUN, IDS)), ['A']);
  items.set(storageKey(RUN), '{not json');
  assert.deepEqual({ ...readAnnotations(storage, RUN, IDS) }, {}, 'unreadable: empty, not refused');
  assert.throws(() => readAnnotations({ getItem: () => { throw new Error('SecurityError'); } }, RUN, IDS), /SecurityError/);
  assert.throws(() => readAnnotations(null, RUN, IDS));
});
