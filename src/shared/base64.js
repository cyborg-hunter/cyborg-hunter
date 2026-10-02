// src/shared/base64.js
// Bytes → base64 without Buffer (the analyze worker has none), for the data:
// URIs of report images and replay assets. In 32 KiB chunks, so
// String.fromCharCode never gets a whole PNG or font as arguments.
export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
