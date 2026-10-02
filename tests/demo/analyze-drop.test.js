// The analyze page's file collection: a drop walks dropped folders through
// the File System Entries API, a file input reads its own list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDropped, filesFromInput } from '../../demo/analyze/drop.js';

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

test('filesFromInput prefers webkitRelativePath', () => {
  const out = filesFromInput({ files: [{ name: 'a.csv', webkitRelativePath: 'd/a.csv' }, { name: 'b.csv', webkitRelativePath: '' }] });
  assert.deepEqual(out.map((e) => e.path), ['d/a.csv', 'b.csv']);
});
