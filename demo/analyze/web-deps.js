// demo/analyze/web-deps.js
// The browser's implementations of the two injected ingest dependencies, plus
// a base64 helper and the worker's canvas. Nothing here touches the DOM or
// the network, so the same functions run inside the analyze worker and in
// node tests (Node 18+ has DecompressionStream as a global; the global
// `crypto` arrives in Node 19, so tests on Node 18 install it from
// node:crypto first).
//
// gunzip reads no Blob, and the canvas's PNG Blob is read only with a
// fallback: in WebKit a worker started from a file:// page cannot read any
// Blob ("The I/O read operation failed."), so the offline single file would
// fail at gunzip and at the report's images. Chromium and Firefox, and every
// engine over http, keep the browser's own PNG encoding.
import { Gunzip } from 'fflate';
import { encodePng } from './png-encode.js';
import { MAX_DECOMPRESSED_BYTES, tooLargeMessage } from '../../src/shared/limits.js';

// The browser's DecompressionStream does the inflating and every check:
// CRC-32, ISIZE, bytes after a member, truncation, the same set node:zlib
// rejects (the CLI's gunzip), so the page rejects the corrupt files the CLI
// rejects. It reads no Blob: the stream is built from the bytes, which works
// in a WebKit worker of a file:// page too.
//
// One gap: browsers reject a file of several gzip members (cat a.gz b.gz),
// which node:zlib reads as their concatenation. When the whole file fails,
// fflate finds where each member starts (it inflates to locate the ends,
// validating nothing, its output discarded) and, if there are several, each
// member goes through the browser's stream on its own. A corrupt member
// still fails there; one member or no members found means the first error
// stands.
//
// The output is capped at `limit` bytes (src/shared/limits.js), across all
// members: a gzip upload is participant data, and a bomb must cost a
// warning, not the worker's memory.
export async function webGunzip(bytes, limit) {
  var budget = { left: limit || MAX_DECOMPRESSED_BYTES, limit: limit || MAX_DECOMPRESSED_BYTES };
  try {
    return await inflateMember(bytes, budget);
  } catch (e) {
    if (e && e.tooLarge) throw e;
    var starts = memberStarts(bytes, budget.limit);
    if (starts.length < 2) throw e;
    budget.left = budget.limit;
    var parts = [];
    for (var i = 0; i < starts.length; i++) parts.push(await inflateMember(bytes.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : bytes.length), budget));
    return concat(parts);
  }
}

async function inflateMember(bytes, budget) {
  var source = new ReadableStream({ start: function (c) { c.enqueue(bytes); c.close(); } });
  var reader = source.pipeThrough(new DecompressionStream('gzip')).getReader();
  var parts = [];
  for (;;) {
    var step = await reader.read();
    if (step.done) break;
    budget.left -= step.value.length;
    if (budget.left < 0) {
      try { await reader.cancel(); } catch (_) { /* already failing */ }
      var err = new Error(tooLargeMessage(budget.limit));
      err.tooLarge = true;
      throw err;
    }
    parts.push(step.value);
  }
  return concat(parts);
}

// The offset of every member, or [] when fflate cannot walk the file.
// fflate's push() recurses once per member it finds in a chunk, so a file of
// thousands of small members overflows the stack when pushed whole; small
// chunks keep the depth bounded.
var WALK_CHUNK = 1024;
function memberStarts(bytes, limit) {
  var starts = [0];
  var seen = 0;
  try {
    var walker = new Gunzip();
    // Its output is discarded, but inflating a bomb still costs the time:
    // stop at the same limit.
    walker.ondata = function (chunk) {
      seen += chunk.length;
      if (limit && seen > limit) throw new Error('too large');
    };
    walker.onmember = function (offset) { starts.push(offset); };
    for (var at = 0; at < bytes.length; at += WALK_CHUNK) {
      walker.push(bytes.subarray(at, at + WALK_CHUNK), at + WALK_CHUNK >= bytes.length);
    }
  } catch (e) { return []; }
  return starts;
}

function concat(parts) {
  var total = 0;
  for (var i = 0; i < parts.length; i++) total += parts[i].length;
  var out = new Uint8Array(total);
  for (var o = 0, j = 0; j < parts.length; o += parts[j].length, j++) out.set(parts[j], o);
  return out;
}

export async function webSha256(text) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  var out = '';
  var view = new Uint8Array(digest);
  for (var i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

// The pseudonym codes' HMAC (pseudonymize-core.js), node:crypto's createHmac
// in report.js's place: the key is the secret's 32 bytes, the digest hex.
export async function webHmacSha256(secretHex, text) {
  var bytes = new Uint8Array(secretHex.length / 2);
  for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(secretHex.slice(2 * i, 2 * i + 2), 16);
  var key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
function toHex(buffer) {
  var view = new Uint8Array(buffer), out = '';
  for (var i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

// Bytes → base64 in chunks, shared with the report and the asset matcher.
export { bytesToBase64 } from '../../src/shared/base64.js';

// OffscreenCanvas is the worker's canvas; the plot cores only need getContext('2d').
export function offscreenCreateCanvas(w, h) { return new OffscreenCanvas(w, h); }
// The canvas's own PNG when its Blob can be read; otherwise the pixels,
// encoded here (png-encode.js). Only the Blob read falls back: a canvas
// that cannot encode at all fails as before.
export async function offscreenEncodePng(canvas) {
  var blob = await canvas.convertToBlob({ type: 'image/png' });
  try {
    return new Uint8Array(await blob.arrayBuffer());
  } catch (e) {
    var image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return encodePng(image.width, image.height, image.data);
  }
}
