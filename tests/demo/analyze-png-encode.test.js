// The analyze worker's own PNG encoder (demo/analyze/png-encode.js), the
// path the report's images take when the worker cannot read the Blob its
// canvas encodes. Checked twice over: the file's structure byte by byte
// (signature, chunk lengths, each CRC, the zlib stream inflating back to the
// filtered scanlines), and, when node-canvas is installed, a real decoder
// reading the pixels back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzlibSync } from 'fflate';
import { encodePng } from '../../demo/analyze/png-encode.js';
import { offscreenEncodePng } from '../../demo/analyze/web-deps.js';

let canvasLib = null;
try { canvasLib = await import('canvas'); } catch (e) { /* not installed: structural checks only */ }

// A small image whose every pixel differs, alpha included.
function pixels(w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = (i * 37) & 255; rgba[i * 4 + 1] = (i * 11 + 5) & 255;
    rgba[i * 4 + 2] = 255 - ((i * 3) & 255); rgba[i * 4 + 3] = 255 - (i & 127);
  }
  return rgba;
}

// CRC-32 (ISO-HDLC), bit by bit: independent of the table the encoder uses.
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}

function chunks(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out = [];
  let o = 8;
  while (o < png.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    out.push({ type, data: png.subarray(o + 8, o + 8 + len), crc: view.getUint32(o + 8 + len), crcOver: png.subarray(o + 4, o + 8 + len) });
    o += 12 + len;
  }
  assert.equal(o, png.length, 'chunks end exactly at the end of the file');
  return out;
}

test('writes signature, IHDR, IDAT, IEND with correct lengths and CRCs', () => {
  const w = 5, h = 3, rgba = pixels(w, h);
  const png = encodePng(w, h, rgba);
  assert.ok(png instanceof Uint8Array);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const list = chunks(png);
  assert.deepEqual(list.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  for (const c of list) assert.equal(c.crc, crc32(c.crcOver), c.type + ' CRC');
  const ihdr = new DataView(list[0].data.buffer, list[0].data.byteOffset, 13);
  assert.equal(ihdr.getUint32(0), w);
  assert.equal(ihdr.getUint32(4), h);
  // 8-bit RGBA, deflate, adaptive filtering method 0, no interlace.
  assert.deepEqual([...list[0].data.subarray(8)], [8, 6, 0, 0, 0]);
  assert.equal(list[2].data.length, 0);
  // IDAT is a zlib stream of the scanlines, each led by filter byte 0.
  const raw = unzlibSync(list[1].data);
  assert.equal(raw.length, h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (1 + w * 4)], 0, 'filter byte of row ' + y);
    assert.deepEqual([...raw.subarray(y * (1 + w * 4) + 1, (y + 1) * (1 + w * 4))], [...rgba.subarray(y * w * 4, (y + 1) * w * 4)]);
  }
});

test('a decoder reads back the exact pixels', { skip: !canvasLib && 'node-canvas not installed' }, async () => {
  // Fully opaque: a decoder's premultiplied canvas rounds translucent
  // pixels, so only an opaque image can be compared byte for byte.
  const w = 7, h = 4, opaque = pixels(w, h);
  for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
  const img = await canvasLib.loadImage(Buffer.from(encodePng(w, h, opaque)));
  assert.equal(img.width, w);
  assert.equal(img.height, h);
  const c = canvasLib.createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  assert.deepEqual([...ctx.getImageData(0, 0, w, h).data], [...opaque]);
});

// A worker canvas whose PNG Blob cannot be read (WebKit, from a file:// page).
function unreadableBlobCanvas(w, h, rgba) {
  return {
    width: w, height: h,
    convertToBlob: async () => ({ arrayBuffer: () => Promise.reject(new Error('The I/O read operation failed.')) }),
    getContext: () => ({ getImageData: (x, y, gw, gh) => ({ width: gw, height: gh, data: rgba }) }),
  };
}

test('offscreenEncodePng falls back to the encoder when the canvas Blob cannot be read', async () => {
  const w = 4, h = 2, rgba = pixels(w, h);
  const png = await offscreenEncodePng(unreadableBlobCanvas(w, h, rgba));
  assert.deepEqual(png, encodePng(w, h, rgba));
});

test('offscreenEncodePng keeps the native encoding when the Blob reads', async () => {
  const native = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const canvas = { width: 1, height: 1, convertToBlob: async () => new Blob([native]), getContext: () => { throw new Error('not used'); } };
  assert.deepEqual(await offscreenEncodePng(canvas), native);
});
