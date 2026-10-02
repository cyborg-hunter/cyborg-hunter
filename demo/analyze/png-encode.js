// demo/analyze/png-encode.js
// A minimal PNG encoder over raw RGBA pixels (a canvas's getImageData), for
// the worker that cannot read the Blob its canvas encodes: WebKit refuses
// every Blob read in a worker started from a file:// page. The file is the
// smallest valid PNG (PNG spec, ISO/IEC 15948): the signature, IHDR (8-bit
// RGBA, no interlace), one IDAT holding the zlib stream of the scanlines,
// each led by filter byte 0 (none), and IEND. Every chunk ends with the
// CRC-32 of its type and data. The fallback only: where the browser's own
// encoding can be read, its bytes are the ones the report keeps.
import { zlibSync } from 'fflate';

var CRC_TABLE = (function () {
  var table = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes, start, end) {
  var c = 0xffffffff;
  for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// One chunk: length, type, data, then the CRC over type + data.
function chunk(type, data) {
  var out = new Uint8Array(12 + data.length);
  var view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (var i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

export function encodePng(width, height, rgba) {
  var header = new Uint8Array(13);
  var hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8;   // bit depth
  header[9] = 6;   // colour type: RGBA
  // compression, filter method and interlace stay 0
  var stride = width * 4;
  var raw = new Uint8Array(height * (1 + stride));
  for (var y = 0; y < height; y++) {
    // raw[y * (1 + stride)] is the row's filter byte, already 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  var parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  var out = new Uint8Array(parts.reduce(function (a, p) { return a + p.length; }, 0));
  for (var o = 0, j = 0; j < parts.length; o += parts[j].length, j++) out.set(parts[j], o);
  return out;
}
