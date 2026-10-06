// The analyze page's file collection: a drop walks dropped folders through
// the File System Entries API, a file input reads its own list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDropped, filesFromInput } from '../../demo/analyze/drop.js';
import { mergeEntries, removeEntry } from '../../demo/analyze/files-panel.js';

// A fake DataTransfer whose items vanish the moment the handler yields: the
// real one does exactly that, which is why entries are collected synchronously.
function fakeTransfer(tree) {
  const file = (name) => ({ name, size: 1 });
  const entry = (name, node, path) => node === 'file'
    ? { isFile: true, isDirectory: false, name, fullPath: path, file: (cb) => cb(file(name)) }
    : { isFile: false, isDirectory: true, name, fullPath: path,
        createReader: () => { let done = false; return { readEntries: (cb) => { if (done) return cb([]); done = true;
          cb(Object.entries(node).map(([n, v]) => entry(n, v, path + '/' + n))); } }; } };
  const items = Object.entries(tree).map(([n, v]) => ({ webkitGetAsEntry: () => entry(n, v, '/' + n), kind: 'file' }));
  const dt = { items, files: [] };
  // Simulate the browser clearing the list after the handler's first await.
  queueMicrotask(() => { dt.items = []; });
  return dt;
}

test('collects nested directory entries synchronously, paths relative to the drop', async () => {
  const dt = fakeTransfer({ exp: { 'a.csv': 'file', css: { 'style.css': 'file' } }, 'b.json': 'file' });
  const out = await collectDropped(dt);
  assert.deepEqual(out.map((e) => e.path).sort(), ['b.json', 'exp/a.csv', 'exp/css/style.css']);
});

test('reads a directory whose entries arrive in several batches', async () => {
  const f = (name) => ({ isFile: true, isDirectory: false, name, file: (cb) => cb({ name, size: 1 }) });
  const batches = [[f('a.csv'), f('b.csv')], [f('c.csv')], []];
  const dir = { isFile: false, isDirectory: true, name: 'd', createReader: () => ({ readEntries: (cb) => cb(batches.shift()) }) };
  const out = await collectDropped({ items: [{ webkitGetAsEntry: () => dir }], files: [] });
  assert.deepEqual(out.map((e) => e.path), ['d/a.csv', 'd/b.csv', 'd/c.csv']);
});

test('falls back to dataTransfer.files when items carry no entries (synthetic drops)', async () => {
  const out = await collectDropped({ items: [{ webkitGetAsEntry: () => null }], files: [{ name: 'x.csv', size: 2 }] });
  assert.deepEqual(out.map((e) => e.path), ['x.csv']);
});

test('a file item without an entry is kept beside the items that have one', async () => {
  const entry = { isFile: true, isDirectory: false, name: 'a.csv', file: (cb) => cb({ name: 'a.csv', size: 1 }) };
  const loose = { name: 'b.csv', size: 1 };
  const items = [
    { kind: 'file', webkitGetAsEntry: () => entry },
    { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => loose },
    { kind: 'string', webkitGetAsEntry: () => null, getAsFile: () => null },
  ];
  const dt = { items, files: [] };
  queueMicrotask(() => { dt.items = []; });
  const out = await collectDropped(dt);
  assert.deepEqual(out.map((e) => e.path), ['a.csv', 'b.csv']);
  assert.equal(out[1].file, loose);
});

test('filesFromInput prefers webkitRelativePath', () => {
  const out = filesFromInput({ files: [{ name: 'a.csv', webkitRelativePath: 'd/a.csv' }, { name: 'b.csv', webkitRelativePath: '' }] });
  assert.deepEqual(out.map((e) => e.path), ['d/a.csv', 'b.csv']);
});

// The one-step file list (demo/analyze/files-panel.js): drops add, the same
// file is listed once, a colliding path moves to its own folder.
const listed = (path, size, lastModified) => ({ path, file: { size, lastModified } });

test('a second drop adds to the list; the same file dropped again is listed once', () => {
  const first = [listed('data/a.csv', 10, 1), listed('cyborg-hunter.config.json', 5, 1)];
  const merged = mergeEntries(first, [listed('data/a.csv', 10, 1), listed('replays/A-replay-1.json', 900, 2)], 2);
  assert.deepEqual(merged.map((e) => e.path), ['data/a.csv', 'cyborg-hunter.config.json', 'replays/A-replay-1.json']);
});

test('a different file under a path already taken moves to its own drop folder', () => {
  const merged = mergeEntries([listed('data/a.json', 10, 1)], [listed('data/a.json', 11, 1)], 3);
  assert.deepEqual(merged.map((e) => e.path), ['data/a.json', 'drop3/data/a.json']);
});

test('removing a file by its listed path', () => {
  const list = [listed('a.csv', 1, 1), listed('drop2/a.csv', 2, 1)];
  assert.deepEqual(removeEntry(list, 'drop2/a.csv').map((e) => e.path), ['a.csv']);
});

test('dropping a folder again after one of its files was moved to its drop folder leaves the list unchanged', () => {
  const second = [listed('data/a.json', 11, 1), listed('data/b.json', 5, 1)];
  const list = mergeEntries([listed('data/a.json', 10, 1)], second, 2);
  assert.deepEqual(list.map((e) => e.path), ['data/a.json', 'drop2/data/a.json', 'data/b.json']);
  assert.deepEqual(mergeEntries(list, second, 3).map((e) => e.path), list.map((e) => e.path));
});

// The suffix goes on the drop folder, never on the file's own name: the
// classifier and the asset matcher read the name.
test('two same-named files in one drop, the name already listed, get distinct paths', () => {
  const list = mergeEntries([listed('x.csv', 1, 1)], [listed('x.csv', 2, 1), listed('x.csv', 3, 1)], 2);
  assert.deepEqual(list.map((e) => e.path), ['x.csv', 'drop2/x.csv', 'drop2-2/x.csv']);
  assert.deepEqual(removeEntry(list, 'drop2/x.csv').map((e) => e.file.size), [1, 3], 'Remove takes out one file');
});
