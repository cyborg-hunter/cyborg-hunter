// demo/analyze/files-panel.js
// The analyze page's file list for its one "Files & settings" step: each
// drop or file choice ADDS to the list. The same file added twice is listed
// once (same dropped path, size and modification time), and a different file
// that arrives under a path already taken (two folders that each hold a
// data/a.json) moves to its own `drop<n>/` folder, because ingest keys a file
// by its path (src/cli/ingest-core.js, the replay pass's `r.path`). Pure: the
// page holds the list, the worker reads the files.

// A moved entry keeps the path it was dropped under in `from`, so dropping
// the same folder again finds it.
function sameFile(e, a) {
  return (e.from || e.path) === a.path && e.file.size === a.file.size && e.file.lastModified === a.file.lastModified;
}
function taken(list, path) { return list.some(function (e) { return e.path === path; }); }

// `entries` with `added` appended in order. `dropNo` numbers this addition:
// a newcomer whose path is taken by a different file is listed as
// `drop<dropNo>/<path>`, or `drop<dropNo>-2/<path>` and so on when that is
// taken too (two same-named files in one drop). The suffix goes on the
// folder: the file's own name is what the classifier and the asset matcher
// read. Every listed path is distinct, so Remove takes out one file.
export function mergeEntries(entries, added, dropNo) {
  var out = entries.slice();
  for (var i = 0; i < added.length; i++) {
    var a = added[i];
    if (out.some(function (e) { return sameFile(e, a); })) continue;
    if (!taken(out, a.path)) { out.push(a); continue; }
    var path = 'drop' + dropNo + '/' + a.path;
    for (var n = 2; taken(out, path); n++) path = 'drop' + dropNo + '-' + n + '/' + a.path;
    out.push({ path: path, from: a.path, file: a.file });
  }
  return out;
}

export function removeEntry(entries, path) {
  return entries.filter(function (e) { return e.path !== path; });
}
