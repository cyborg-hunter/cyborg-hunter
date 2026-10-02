// demo/analyze/web-deps.js
// The browser's implementations of the two injected ingest dependencies, plus
// a base64 helper and the worker's canvas. Nothing here touches the DOM or
// the network, so the same functions run inside the analyze worker and in
// node tests (Node 18+ has DecompressionStream as a global; the global
// `crypto` arrives in Node 19, so tests on Node 18 install it from
// node:crypto first).
//
// No Blob is read on the way to a result that has another route: in WebKit a
// worker started from a file:// page cannot read any Blob ("The I/O read
// operation failed."), so the offline single file would fail at gunzip and at
// the report's images. Chromium and Firefox, and every engine over http, keep
// the browser's own paths.
import { gunzipSync } from 'fflate';
import { encodePng } from './png-encode.js';

// The browser's DecompressionStream over a stream built from the bytes (not
// from a Blob), read chunk by chunk. If that fails, fflate inflates the same
// bytes to the same output; if fflate fails too, the input is not gzip and
// the stream's error is the one reported.
export async function webGunzip(bytes) {
  try {
    return await streamGunzip(bytes);
  } catch (e) {
    try { return gunzipSync(bytes); } catch (ignored) { throw e; }
  }
}
async function streamGunzip(bytes) {
  var source = new ReadableStream({ start: function (c) { c.enqueue(bytes); c.close(); } });
  var reader = source.pipeThrough(new DecompressionStream('gzip')).getReader();
  var parts = [], total = 0;
  for (;;) {
    var step = await reader.read();
    if (step.done) break;
    parts.push(step.value); total += step.value.length;
  }
  var out = new Uint8Array(total);
  for (var o = 0, i = 0; i < parts.length; o += parts[i].length, i++) out.set(parts[i], o);
  return out;
}

export async function webSha256(text) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  var out = '';
  var view = new Uint8Array(digest);
  for (var i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

// Bytes → base64 in chunks (String.fromCharCode on a whole PNG or font would
// blow the argument limit). Same loop as demo/results.js's toBase64.
export function bytesToBase64(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// OffscreenCanvas is the worker's canvas; the plot cores only need getContext('2d').
export function offscreenCreateCanvas(w, h) { return new OffscreenCanvas(w, h); }
// The canvas's own PNG when its Blob can be read; otherwise the pixels,
// encoded here (png-encode.js).
export async function offscreenEncodePng(canvas) {
  try {
    var blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } catch (e) {
    var image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return encodePng(image.width, image.height, image.data);
  }
}
