// demo/analyze/classify-files.js
// What each dropped file is, decided by name only (contents are read later,
// one file at a time, by ingestFiles and the asset matcher). JSON files are
// handed to BOTH the participant and the replay list: ingest-core sniffs a
// session recording by content, as the CLI does for a data directory.
import { ASSET_EXTENSIONS } from '../../src/cli/asset-match.js';

export var CONFIG_NAME = 'cyborg-hunter.config.json';

export function baseName(path) { var i = path.lastIndexOf('/'); return i < 0 ? path : path.slice(i + 1); }
function extOf(name) {
  var lower = name.toLowerCase();
  if (lower.endsWith('.json.gz')) return '.json.gz';
  var i = lower.lastIndexOf('.');
  return i < 0 ? '' : lower.slice(i);
}
function isJunk(name) { return name === '.DS_Store' || name === 'Thumbs.db' || name.indexOf('._') === 0; }

export function classifyFiles(entries) {
  var out = { participant: [], replay: [], assets: [], config: null, ignored: [] };
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var name = baseName(entry.path);
    var ext = extOf(name);
    if (isJunk(name)) out.ignored.push(entry);
    else if (name === CONFIG_NAME) { if (out.config) out.ignored.push(entry); else out.config = entry; }
    else if (ext === '.csv') out.participant.push(entry);
    else if (ext === '.json' || ext === '.json.gz') { out.participant.push(entry); out.replay.push(entry); }
    else if (ASSET_EXTENSIONS.indexOf(ext) >= 0) out.assets.push(entry);
    else out.ignored.push(entry);
  }
  return out;
}
