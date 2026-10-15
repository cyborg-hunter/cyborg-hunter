// src/cli/renderers/report-id.js
// The id a participant goes by in the report page (html-index-core.js): a
// row's data-sanitized, its pane's id (p-<this>), the #p-<this> hash the
// report selects on load, and its image file names. A module of its own so
// that the analyze page, which opens a rebuilt report at that hash, imports
// this rule and nothing else of the renderer. The three plot renderers use
// it too, so a file name and the page that links it cannot disagree.
//
// Cleaning is many-to-one ('a.b' and 'a_b'; two ids sharing their first 40
// characters), and two participants under one cleaned name overwrote each
// other's plots and shared a pane. So whenever cleaning changes an id, a
// fingerprint of the raw id is appended: an id that is already clean keeps
// its name, and two different raw ids no longer meet. The fingerprint is
// FNV-1a over the UTF-16 units, 32 bits, written as 8 hex digits: enough to
// keep honest ids apart, not a defence against an id crafted to collide
// with a known other one.
function fingerprint(s) {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

export function sanitize(name) {
  var raw = String(name == null ? '' : name);
  var clean = raw.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
  return clean === raw ? clean : clean + '-' + fingerprint(raw);
}
