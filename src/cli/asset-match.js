// src/cli/asset-match.js
// Styled replays from an experiment's own files. A dom-tier recording keeps
// the URL of every external stylesheet and image; this module matches those
// URLs against files the researcher supplies (a dropped folder on the analyze
// page, or `assetsDir` in the CLI config) and inlines what matched into the
// viewer model: stylesheet text as `css`, images as data: URIs. One matcher,
// one mapping, both paths — and never a fetch, which the page's policy forbids.
//
// Data URIs rather than blob URLs on purpose: the zip's replay/*.replay.js is
// opened from file://, where a blob URL minted in a page that no longer exists
// means nothing, and the CLI report has no page at all. A data URI is a string
// in the model and works in all three places.

const MIME = {
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
export const ASSET_EXTENSIONS = Object.keys(MIME);
const FONT_EXT = /\.(woff2?|ttf|otf)(\?|#|$)/i;
const SRC_ATTRS = { src: true, poster: true };
const URL_REF = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

const extOf = (p) => { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i).toLowerCase(); };
export function contentTypeFor(path) { return MIME[extOf(path)] || 'application/octet-stream'; }

function pathOf(url) {
  try { return decodeURIComponent(new URL(url).pathname); } catch { return String(url).split(/[?#]/)[0]; }
}
const lastSegment = (url) => pathOf(url).split('/').filter(Boolean).pop() || url;

// url(...) references inside one sheet's text, absolute. Relative references
// resolve against the sheet's href; a sheet with no href (inline) keeps only
// absolute references. data:/blob:/#fragment references are not assets.
function cssRefs(css, href) {
  const out = [];
  for (const m of String(css).matchAll(URL_REF)) {
    const ref = m[2].trim();
    if (/^(data:|blob:|#)/i.test(ref)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) { out.push(ref); continue; }
    if (href) { try { out.push(new URL(ref, href).href); } catch { /* unresolvable: not an asset */ } }
  }
  return out;
}

function* walkNodes(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const c of node.children || []) yield* walkNodes(c);
}

function* sheetsOf(recording) {
  for (const s of recording.stylesheets || []) if (s) yield s;
  for (const ev of recording.stylesheet_events || recording.stylesheetEvents || []) {
    if (ev && ev.type === 'stylesheet.add' && ev.sheet) yield ev.sheet;
  }
}

function* segmentsOf(recording) {
  for (const seg of recording.segments || []) {
    if (!seg) continue;
    yield { dom: seg.initial_dom !== undefined ? seg.initial_dom : seg.initialDom, events: seg.events || [] };
  }
}

export function collectAssetUrls(recording) {
  const sheets = [], images = [], fonts = [];
  const seen = new Set();
  const add = (list, url) => { if (typeof url === 'string' && url && !seen.has(url)) { seen.add(url); list.push(url); } };
  // data:/blob: sources are already inline content, not assets to match.
  const addRef = (url) => { if (typeof url === 'string' && !/^(data:|blob:|#)/i.test(url)) add(FONT_EXT.test(url) ? fonts : images, url); };
  for (const s of sheetsOf(recording)) {
    if (s.kind === 'link' && s.css == null) add(sheets, s.href);
    else if (s.css) for (const ref of cssRefs(s.css, s.href)) addRef(ref);
  }
  for (const { dom, events } of segmentsOf(recording)) {
    for (const n of walkNodes(dom)) {
      if (n.kind !== 'element') continue;
      for (const a of Object.keys(SRC_ATTRS)) if (n.attrs && n.attrs[a]) addRef(n.attrs[a]);
      if (n.media_src) addRef(n.media_src);
    }
    for (const ev of events) {
      if (ev.type === 'dom.add') for (const n of walkNodes(ev.node)) {
        if (n.kind !== 'element') continue;
        for (const a of Object.keys(SRC_ATTRS)) if (n.attrs && n.attrs[a]) addRef(n.attrs[a]);
        if (n.media_src) addRef(n.media_src);
      } else if (ev.type === 'dom.attr' && SRC_ATTRS[ev.name] && ev.value) addRef(ev.value);
      else if (ev.type === 'stylesheet.update' && ev.css) for (const ref of cssRefs(ev.css, null)) addRef(ref);
    }
  }
  return { stylesheets: sheets, images, fonts };
}

const normalizePath = (p) => String(p).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');

export function matchAssets(urls, droppedPaths) {
  const dropped = [...new Set(droppedPaths.map(normalizePath))];
  const matched = new Map(), missing = [], ambiguous = [];
  for (const url of urls) {
    const up = pathOf(url);
    let cands = dropped.filter((p) => up === '/' + p || up.endsWith('/' + p));
    if (cands.length === 0) {
      const name = lastSegment(url);
      cands = dropped.filter((p) => p.split('/').pop() === name);
    }
    if (cands.length === 1) matched.set(url, cands[0]);
    else if (cands.length > 1) ambiguous.push({ url, candidates: cands });
    else missing.push(url);
  }
  return { matched, missing, ambiguous };
}

export async function buildAssetMap(recordings, droppedFiles) {
  const byPath = new Map(droppedFiles.map((f) => [normalizePath(f.path), f]));
  const urls = [];
  const seen = new Set();
  for (const rec of recordings) {
    const u = collectAssetUrls(rec);
    for (const url of [...u.stylesheets, ...u.images, ...u.fonts]) if (!seen.has(url)) { seen.add(url); urls.push(url); }
  }
  const { matched, missing, ambiguous } = matchAssets(urls, [...byPath.keys()]);
  const assetMap = new Map();
  const bytesByPath = new Map();
  for (const [url, path] of matched) {
    if (!bytesByPath.has(path)) bytesByPath.set(path, await byPath.get(path).read());
    assetMap.set(url, { bytes: bytesByPath.get(path), type: contentTypeFor(path) });
  }
  return { assetMap, report: { matched: [...matched].map(([url, path]) => ({ url, path })), missing, ambiguous } };
}

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const decodeUtf8 = (bytes) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

export function applyAssetMap(model, assetMap) {
  if (!assetMap || assetMap.size === 0) return model;
  const uris = new Map();
  const dataUri = (url) => {
    if (!uris.has(url)) { const e = assetMap.get(url); uris.set(url, 'data:' + e.type + ';base64,' + base64(e.bytes)); }
    return uris.get(url);
  };
  const rewriteCss = (css, href) => String(css).replace(URL_REF, (whole, q, ref) => {
    const r = ref.trim();
    let abs = r;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(r) && href) { try { abs = new URL(r, href).href; } catch { return whole; } }
    return assetMap.has(abs) ? 'url(' + q + dataUri(abs) + q + ')' : whole;
  });
  const sheet = (s) => {
    if (!s) return;
    if (s.kind === 'link' && s.css == null && assetMap.has(s.href)) s.css = decodeUtf8(assetMap.get(s.href).bytes);
    if (s.css) s.css = rewriteCss(s.css, s.href);
  };
  const node = (n) => {
    for (const el of walkNodes(n)) {
      if (el.kind !== 'element') continue;
      for (const a of Object.keys(SRC_ATTRS)) if (el.attrs && assetMap.has(el.attrs[a])) el.attrs[a] = dataUri(el.attrs[a]);
      if (el.media_src && assetMap.has(el.media_src)) el.media_src = dataUri(el.media_src);
    }
  };
  for (const s of model.stylesheets || []) sheet(s);
  for (const ev of model.stylesheetEvents || []) {
    if (ev.type === 'stylesheet.add') sheet(ev.sheet);
    else if (ev.type === 'stylesheet.update' && ev.css) ev.css = rewriteCss(ev.css, null);
  }
  for (const seg of model.segments || []) {
    node(seg.initialDom);
    for (const ev of seg.events || []) {
      if (ev.type === 'dom.add') node(ev.node);
      else if (ev.type === 'dom.attr' && SRC_ATTRS[ev.name] && assetMap.has(ev.value)) ev.value = dataUri(ev.value);
    }
  }
  return model;
}

export function assetMatchSummary(recording, assetMap) {
  const u = collectAssetUrls(recording);
  const tally = (urls) => ({ matched: urls.filter((x) => assetMap.has(x)).length, total: urls.length,
    missing: urls.filter((x) => !assetMap.has(x)).map(lastSegment) });
  return { stylesheets: tally(u.stylesheets), images: tally([...u.images, ...u.fonts]) };
}

export function assetNoteText(summary) {
  const parts = [];
  const word = (t, noun) => `${t.matched} of ${t.total} ${noun} matched` + (t.missing.length ? ` (missing: ${t.missing.join(', ')})` : '');
  if (summary.stylesheets.total > 0) parts.push(word(summary.stylesheets, 'stylesheets'));
  if (summary.images.total > 0) parts.push(word(summary.images, 'images'));
  return parts.length ? 'Experiment assets: ' + parts.join('; ') + '.' : null;
}
