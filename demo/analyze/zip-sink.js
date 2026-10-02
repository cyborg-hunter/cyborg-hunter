// demo/analyze/zip-sink.js
// The browser's sink for buildReport: every output file goes straight into a
// streaming zip (fflate) and out through onChunk as it is produced, so the
// output tree never sits in memory as a whole. PNGs are already compressed
// and are stored; everything else deflates.
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

export function createZipSink(onChunk) {
  var ended = false;
  var api = { bytes: 0 };
  var zip = new Zip(function (err, chunk, final) {
    if (err) throw err;
    api.bytes += chunk.length;
    onChunk(chunk, final);
  });
  api.sink = function (path, data) {
    if (ended) throw new Error('zip sink already ended');
    var bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    var entry = /\.png$/i.test(path) ? new ZipPassThrough(path) : new ZipDeflate(path, { level: 6 });
    zip.add(entry);
    entry.push(bytes, true);
  };
  api.end = function () { if (!ended) { ended = true; zip.end(); } };
  return api;
}
