import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { createZipSink } from '../../demo/analyze/zip-sink.js';

function collect() {
  const chunks = [];
  const z = createZipSink((c) => chunks.push(c));
  return { z, bytes: () => { const n = chunks.reduce((a, c) => a + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; } };
}

test('streams a zip whose entries round-trip; png stored, text deflated', () => {
  const { z, bytes } = collect();
  z.sink('summary.csv', 'a,b\n1,2\n');
  z.sink('images/x.png', new Uint8Array([137, 80, 78, 71, 0, 0, 0]));
  z.sink('replay/p.replay.js', new TextEncoder().encode('window.x=1;'));
  z.end();
  // The zip's own method field per entry (APPNOTE 4.4.5: 0 = stored, 8 = deflate).
  const method = {};
  const files = unzipSync(bytes(), { filter: (f) => { method[f.name] = f.compression; return true; } });
  assert.deepEqual(Object.keys(files).sort(), ['images/x.png', 'replay/p.replay.js', 'summary.csv']);
  assert.deepEqual(method, { 'summary.csv': 8, 'images/x.png': 0, 'replay/p.replay.js': 8 });
  assert.equal(strFromU8(files['summary.csv']), 'a,b\n1,2\n');
  assert.deepEqual([...files['images/x.png']], [137, 80, 78, 71, 0, 0, 0]);
  assert.equal(z.bytes, bytes().length);
});

test('refuses writes after end', () => {
  const { z } = collect();
  z.end();
  assert.throws(() => z.sink('late.txt', 'x'), /ended/);
});
