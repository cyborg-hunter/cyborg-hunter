import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFiles, CONFIG_NAME } from '../../demo/analyze/classify-files.js';

const e = (path, size = 1) => ({ path, size });

test('routes by extension and content role', () => {
  const r = classifyFiles([e('data/p1.csv'), e('data/p2.json'), e('data/p2-replay-1.json.gz'), e('exp/css/a.css'), e('exp/img/b.PNG'),
    e('data/' + CONFIG_NAME), e('notes.txt'), e('.DS_Store'), e('data/._p1.csv')]);
  assert.deepEqual(r.participant.map((x) => x.path), ['data/p1.csv', 'data/p2.json', 'data/p2-replay-1.json.gz']);
  assert.deepEqual(r.replay.map((x) => x.path), ['data/p2.json', 'data/p2-replay-1.json.gz']);
  assert.deepEqual(r.assets.map((x) => x.path), ['exp/css/a.css', 'exp/img/b.PNG']);
  assert.equal(r.config.path, 'data/' + CONFIG_NAME);
  assert.deepEqual(r.ignored.map((x) => x.path), ['notes.txt', '.DS_Store', 'data/._p1.csv']);
});

test('a second config file is ignored, not merged', () => {
  const r = classifyFiles([e('a/' + CONFIG_NAME), e('b/' + CONFIG_NAME)]);
  assert.equal(r.config.path, 'a/' + CONFIG_NAME);
  assert.deepEqual(r.ignored.map((x) => x.path), ['b/' + CONFIG_NAME]);
});

test('Thumbs.db is ignored and no config yields null', () => {
  const r = classifyFiles([e('x/Thumbs.db')]);
  assert.equal(r.config, null);
  assert.deepEqual(r.ignored.map((x) => x.path), ['x/Thumbs.db']);
});
