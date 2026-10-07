// demo/analyze/peek-files.js
// A cheap look at one participant file for the id suggestion: CSV header plus
// a few rows (Papa preview), or a JSON object's scalar keys. Runs in the worker.
import Papa from 'papaparse';
import { webGunzip } from './web-deps.js';
import { artifactKind } from '../../src/cli/ingest-core.js';

var decode = function (bytes) { return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); };

// Maps are prototype-free so a key named __proto__ is just a key.
function scalarKeys(obj, prefix) {
  var keys = [], values = Object.create(null);
  var own = Object.keys(obj);
  for (var i = 0; i < own.length; i++) {
    var k = own[i];
    var v = obj[k];
    if (v === null || typeof v !== 'object') { keys.push(prefix + k); values[prefix + k] = [String(v)]; }
  }
  return { keys: keys, values: values };
}

// Gzip magic bytes: a .json.gz participant file is decompressed before
// reading, by the same gunzip ingest uses (no Blob read; web-deps.js).
async function gunzipIfGzip(bytes) {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  return webGunzip(bytes);
}

// { keys, values } for a data file; { recording: true } for a session
// recording, which is no participant's data and is sampled for nothing
// (ingest-core keeps it out of the participant pass by the same content
// sniff, artifactKind); null for a file that cannot be read or parsed.
export async function peekParticipantFile(reader, opts) {
  var maxRows = (opts && opts.maxRows) || 50;
  var text;
  try { text = decode(await gunzipIfGzip(await reader.read())); } catch (e) { return null; }
  if (/\.csv$/i.test(reader.name)) {
    var parsed = Papa.parse(text.trimEnd(), { header: true, skipEmptyLines: true, preview: maxRows });
    var fields = (parsed.meta && parsed.meta.fields) || [];
    var values = Object.create(null);
    for (var i = 0; i < fields.length; i++) values[fields[i]] = parsed.data.map(function (r) { return String(r[fields[i]]); });
    return { keys: fields, values: values };
  }
  var json;
  try { json = JSON.parse(text); } catch (e) { return null; }
  if (artifactKind(json) !== null) return { recording: true };
  if (Array.isArray(json)) return json.length && json[0] && typeof json[0] === 'object' ? scalarKeys(json[0], '') : null;
  if (!json || typeof json !== 'object') return null;
  var top = scalarKeys(json, '');
  if (json.metadata && typeof json.metadata === 'object') {
    var meta = scalarKeys(json.metadata, 'metadata.');
    top.keys = top.keys.concat(meta.keys);
    for (var m = 0; m < meta.keys.length; m++) top.values[meta.keys[m]] = meta.values[meta.keys[m]];
  }
  return top;
}
