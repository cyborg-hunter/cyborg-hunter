// demo/analyze/web-deps.js
// The browser's implementations of the two injected ingest dependencies, plus
// a base64 helper. Nothing here touches the DOM or the network, so the same
// functions run inside the analyze worker and in node tests (Node 18+ has
// DecompressionStream as a global; the global `crypto` arrives in Node 19, so
// tests on Node 18 install it from node:crypto first).
export async function webGunzip(bytes) {
  var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
