// demo/analyze/drop.js
// Files from a drop or a file input, as [{ path, file }] with paths relative
// to what was dropped. Directory entries are walked through the File System
// Entries API. EVERY webkitGetAsEntry() call happens synchronously inside
// the drop handler, before the first await: DataTransfer items are gone once
// the event handler yields. A synthetic drop (tests) has no entries and
// falls back to dataTransfer.files. A file item without an entry, beside
// items that have one, is taken as a plain file (getAsFile(), also before
// the first await).

// readEntries() hands a directory's children over in batches; an empty batch
// means there are no more.
function readDirectory(dirEntry) {
  return new Promise(function (resolve, reject) {
    var reader = dirEntry.createReader();
    var all = [];
    (function next() {
      reader.readEntries(function (batch) {
        if (!batch.length) { resolve(all); return; }
        for (var i = 0; i < batch.length; i++) all.push(batch[i]);
        next();
      }, reject);
    })();
  });
}

async function walkEntry(entry, prefix, out) {
  var path = prefix ? prefix + '/' + entry.name : entry.name;
  if (entry.isFile) {
    var file = await new Promise(function (resolve, reject) { entry.file(resolve, reject); });
    out.push({ path: path, file: file });
  } else if (entry.isDirectory) {
    var children = await readDirectory(entry);
    for (var i = 0; i < children.length; i++) await walkEntry(children[i], path, out);
  }
}

export async function collectDropped(dataTransfer) {
  var entries = [];
  var loose = [];
  var items = dataTransfer.items || [];
  for (var i = 0; i < items.length; i++) {          // synchronous: no await in this loop
    var e = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
    if (e) { entries.push(e); continue; }
    var f = items[i].kind === 'file' && items[i].getAsFile ? items[i].getAsFile() : null;
    if (f) loose.push(f);
  }
  var out = [];
  if (entries.length === 0) {
    var files = dataTransfer.files || [];
    for (var j = 0; j < files.length; j++) out.push({ path: files[j].name, file: files[j] });
    return out;
  }
  for (var k = 0; k < entries.length; k++) await walkEntry(entries[k], '', out);
  for (var m = 0; m < loose.length; m++) out.push({ path: loose[m].name, file: loose[m] });
  return out;
}

export function filesFromInput(input) {
  var out = [];
  for (var i = 0; i < input.files.length; i++) {
    var f = input.files[i];
    out.push({ path: f.webkitRelativePath || f.name, file: f });
  }
  return out;
}
