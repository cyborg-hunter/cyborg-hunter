// The recordings' names, read from the dataset folder: what the bundle bakes
// (as names) and the site assembler copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleRecordingNames } from '../../tools/sample-recordings.mjs';

test('names the *.replay.json files of a folder, sorted, and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-sample-recordings-'));
  for (const f of ['DEMO-b.replay.json', 'DEMO-a.replay.json', 'DEMO-a.json', 'cyborg-hunter.config.json', 'notes.txt']) writeFileSync(join(dir, f), '{}');
  assert.deepEqual(sampleRecordingNames(dir), ['DEMO-a.replay.json', 'DEMO-b.replay.json']);
  rmSync(dir, { recursive: true, force: true });
});

test('the dataset has the three recordings', () => {
  assert.deepEqual(sampleRecordingNames('examples/demo-sessions/data'),
    ['DEMO-681w.replay.json', 'DEMO-a3f3.replay.json', 'DEMO-bsq6.replay.json']);
});
