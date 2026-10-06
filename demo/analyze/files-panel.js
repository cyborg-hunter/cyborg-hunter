// demo/analyze/files-panel.js
// The analyze page's file list for its one "Files & settings" step: each
// drop or file choice ADDS to the list. The same file added twice is listed
// once (same path, size and modification time), and a different file that
// arrives under a path already taken (two folders that each hold a
// data/a.json) moves to its own `drop<n>/` folder, because ingest keys a file
// by its path (src/cli/ingest-core.js, the replay pass's `r.path`). Pure: the
// page holds the list, the worker reads the files.

function sameFile(a, b) {
  return a.path === b.path && a.file.size === b.file.size && a.file.lastModified === b.file.lastModified;
}

// `entries` with `added` appended in order. `dropNo` numbers this addition:
// a newcomer whose path is taken by a different file is listed as
// `drop<dropNo>/<path>`.
export function mergeEntries(entries, added, dropNo) {
  var out = entries.slice();
  for (var i = 0; i < added.length; i++) {
    var a = added[i];
    if (out.some(function (e) { return sameFile(e, a); })) continue;
    var taken = out.some(function (e) { return e.path === a.path; });
    out.push(taken ? { path: 'drop' + dropNo + '/' + a.path, file: a.file } : a);
  }
  return out;
}

export function removeEntry(entries, path) {
  return entries.filter(function (e) { return e.path !== path; });
}
