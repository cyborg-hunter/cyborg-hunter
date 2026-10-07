// src/cli/renderers/report-id.js
// The id a participant goes by in the report page (html-index-core.js): a
// row's data-sanitized, its pane's id (p-<this>), the #p-<this> hash the
// report selects on load, and its image file names. A module of its own so
// that the analyze page, which opens a rebuilt report at that hash, imports
// this rule and nothing else of the renderer.
export function sanitize(name) {
  return String(name || '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
}
