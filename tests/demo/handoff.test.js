// tests/demo/handoff.test.js
// The demo's hand-off to the analyze page (demo/handoff.js): a stored record
// becomes the page's file entries, and a stale one opens nothing. The
// IndexedDB round trip itself runs in browsers (tests/e2e/analyze/site.spec.js
// and demo/tests/handoff.spec.js): Node has no IndexedDB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handoffEntries, HANDOFF_MAX_AGE_MS } from '../../demo/handoff.js';

const record = (createdAt) => ({ createdAt, files: [
  { path: 'DEMO-ab12.json', blob: new Blob(['{"participantId":"DEMO-ab12"}'], { type: 'application/json' }) },
  { path: 'examples/DEMO-bsq6.json', blob: new Blob(['{}']) },
] });

test('a fresh record becomes one file entry per stored file, each File named and dated and marked as the hand-off\'s', async () => {
  const entries = handoffEntries(record(1000), 6000);
  assert.deepEqual(entries.map((e) => [e.path, e.file.name, e.file.lastModified, e.handoff]),
    [['DEMO-ab12.json', 'DEMO-ab12.json', 1000, true], ['examples/DEMO-bsq6.json', 'DEMO-bsq6.json', 1000, true]]);
  assert.equal(await entries[0].file.text(), '{"participantId":"DEMO-ab12"}');
});

test('no record, a record without files, or one older than the hand-off window opens nothing', () => {
  assert.deepEqual(handoffEntries(null, 0), []);
  assert.deepEqual(handoffEntries({ createdAt: 0 }, 0), []);
  assert.equal(handoffEntries(record(0), HANDOFF_MAX_AGE_MS).length, 2, 'at the window: still fresh');
  assert.deepEqual(handoffEntries(record(0), HANDOFF_MAX_AGE_MS + 1), []);
});
