// The Buffer-free base64 the report, the asset matcher and the analyze
// worker share. It works in 32 KiB chunks, so the lengths around a chunk
// edge are the ones that could go wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBase64 } from '../../src/shared/base64.js';

test('matches Buffer on every length around the chunk size', () => {
  const CHUNK = 0x8000;
  for (const n of [0, 1, 2, 3, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK + 2, 2 * CHUNK, 2 * CHUNK + 1, 3 * CHUNK - 2]) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 131 + 7) & 0xff;
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'), 'length ' + n);
  }
});

test('reads a view at its own offset, not the whole buffer', () => {
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
  assert.equal(bytesToBase64(backing.subarray(2, 5)), Buffer.from([1, 2, 3]).toString('base64'));
});
