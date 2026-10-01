// demo/analyze/peek-files.js
// A cheap look at one participant file for the id suggestion: CSV header plus
// a few rows (Papa preview), or a JSON object's scalar keys. Runs in the worker.
import Papa from 'papaparse';

var decode = function (bytes) { return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); };

function scalarKeys(obj, prefix) {
  var keys = [], values = {};
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var v = obj[k];
    if (v === null || typeof v !== 'object') { keys.push(prefix + k); values[prefix + k] = [String(v)]; }
  }
  return { keys: keys, values: values };
}

export async function peekParticipantFile(reader, opts) {
  var maxRows = (opts && opts.maxRows) || 50;
  var text;
  try { text = decode(await reader.read()); } catch (e) { return null; }
  if (/\.csv$/i.test(reader.name)) {
    var parsed = Papa.parse(text.replace(/\s+$/, ''), { header: true, skipEmptyLines: true, preview: maxRows });
    var fields = (parsed.meta && parsed.meta.fields) || [];
    var values = {};
    for (var i = 0; i < fields.length; i++) values[fields[i]] = parsed.data.map(function (r) { return String(r[fields[i]]); });
    return { keys: fields, values: values };
  }
  var json;
  try { json = JSON.parse(text); } catch (e) { return null; }
  if (Array.isArray(json)) return json.length && json[0] && typeof json[0] === 'object' ? scalarKeys(json[0], '') : null;
  if (!json || typeof json !== 'object') return null;
  var top = scalarKeys(json, '');
  if (json.metadata && typeof json.metadata === 'object') {
    var meta = scalarKeys(json.metadata, 'metadata.');
    top.keys = top.keys.concat(meta.keys);
    for (var k in meta.values) top.values[k] = meta.values[k];
  }
  return top;
}
