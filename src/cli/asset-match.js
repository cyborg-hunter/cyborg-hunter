// src/cli/asset-match.js
// Styled replays from an experiment's own files. A dom-tier recording keeps
// the URL of every external stylesheet and image; this module matches those
// URLs against files the researcher supplies (a dropped folder on the analyze
// page, or `assetsDir` in the CLI config) and inlines what matched into the
// viewer model: stylesheet text as `css`, images as data: URIs. One matcher,
// one mapping, both paths — and never a fetch, which the page's policy forbids.
//
// What a <video> or <audio> plays is collected too, as media, but never
// matched or inlined: the viewer shows the element at its size and never
// loads or plays it, so the note counts media in a clause of its own rather
// than as images that can never match. A video's poster is an image.
//
// Data URIs rather than blob URLs on purpose: the zip's replay/*.replay.js is
// opened from file://, where a blob URL minted in a page that no longer exists
// means nothing, and the CLI report has no page at all. A data URI is a string
// in the model and works in all three places.
//
// The asset map is Map<url, entry>. A matched URL's entry is { bytes, type };
// a URL several supplied files matched equally well is recorded as
// { bytes: null, type: null, candidates } so the report note can say
// "ambiguous" rather than "missing". Only entries with bytes are inlined.
//
// Paths compare exactly first. Only a URL no supplied file matches exactly
// gets a second, case-blind pass (card_a.png ↔ Card_A.png, common for
// experiments built on a case-insensitive file system), ranked the same way:
// one best file is matched under its own spelling, a tie is ambiguous.
//
// A stylesheet supplied as a file brings its own references (fonts,
// background images, @imports). They resolve against the sheet's RECORDED
// URL, are matched like everything else, and are inlined; the ones not
// supplied become absolute URLs so they resolve where they did on the
// experiment's server. One level only: an @import'ed sheet's own references
// are made absolute but not followed.
import { bytesToBase64 } from '../shared/base64.js';

const MIME = {
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
export const ASSET_EXTENSIONS = Object.keys(MIME);
const FONT_EXT = /\.(woff2?|ttf|otf)(\?|#|$)/i;
// Decides a <source> whose parent the recording does not show.
const MEDIA_EXT = /\.(mp4|webm|ogg|ogv|oga|mp3|wav|m4a|aac|flac|mov)(\?|#|$)/i;
const MEDIA_TAGS = { video: true, audio: true };
// One pass over CSS text finds both kinds of reference, and steps over
// comments (matched first, with no groups, and always left as they are, so an
// @import or url() inside one stays inert). Case-insensitive, as CSS is
// (URL(...), @IMPORT). Groups: 2 or 4 =
// an @import's URL (url(...) or string form), 5 = its condition (media list,
// layer(), supports()); 7 = a url(...) reference.
const CSS_REF = /\/\*[\s\S]*?(?:\*\/|$)|@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)([^;{}]*)(?:;|$)|url\(\s*(['"]?)([^'")]+)\6\s*\)/gi;
// A layer()/supports() import cannot be spliced as a plain @media block; it is
// left as an absolute @import and not counted.
const CONDITIONAL_IMPORT = /\b(layer|supports)\b/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const isComment = (m) => m[0].startsWith('/*');

// The default decoder drops a leading byte-order mark, which in a <style>
// would otherwise become part of the first selector.
const decodeUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);
const extOf = (p) => { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i).toLowerCase(); };
export function contentTypeFor(path) { return MIME[extOf(path)] || 'application/octet-stream'; }

function pathOf(url) {
  try { return decodeURIComponent(new URL(url).pathname); } catch { return String(url).split(/[?#]/)[0]; }
}
const lastSegment = (url) => pathOf(url).split('/').filter(Boolean).pop() || url;

// A reference in CSS, absolute. Relative references resolve against the
// sheet's href (`resolved` true: the URL parser produced it); a sheet with no
// href (inline) keeps only absolute references. data:/blob:/#fragment
// references are not assets.
function resolveRef(ref, href) {
  const r = ref.trim();
  if (/^(data:|blob:|#)/i.test(r)) return null;
  if (SCHEME.test(r)) return { url: r, resolved: false };
  if (!href) return null;
  try { return { url: new URL(r, href).href, resolved: true }; } catch { return null; }
}

// A URL written into CSS as a quoted string. The URL parser already
// percent-encodes quotes in http(s) URLs; the escape covers any other scheme
// a recorded href might carry, so the string can never be closed early.
const cssUrl = (u) => 'url("' + u.replace(/[\\"\n\r\f]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ') + '")';

// The references inside one sheet's text: spliceable @imports (no condition,
// or a plain media list) and url(...) references.
function cssRefs(css, href) {
  const imports = [], urls = [];
  for (const m of String(css).matchAll(CSS_REF)) {
    if (isComment(m)) continue;
    const isImport = m[7] === undefined;
    const ref = resolveRef(isImport ? (m[2] !== undefined ? m[2] : m[4]) : m[7], href);
    if (!ref) continue;
    if (!isImport) urls.push(ref.url);
    else if (!CONDITIONAL_IMPORT.test(m[5])) imports.push(ref.url);
  }
  return { imports, urls };
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

// A stylesheet.update replaces a sheet's text later in the session. Its CSS
// is read with no base URL (applyAssetMap rewrites it the same way), so only
// its absolute references count.
function* sheetUpdatesOf(recording) {
  for (const ev of recording.stylesheet_events || recording.stylesheetEvents || []) {
    if (ev && ev.type === 'stylesheet.update' && ev.css) yield ev.css;
  }
}

function* segmentsOf(recording) {
  for (const seg of recording.segments || []) {
    if (!seg) continue;
    yield { dom: seg.initial_dom !== undefined ? seg.initial_dom : seg.initialDom, events: seg.events || [] };
  }
}

// Every element node seen so far, by id, as { tag, parent }: a dom.attr
// event names its node only by id, and a <source>'s kind depends on its
// parent. `parent` is the parent's id (a dom.add root's is the event's).
function noteTree(elems, node, parent) {
  if (!node || typeof node !== 'object') return;
  if (node.kind === 'element' && node.id != null) elems.set(node.id, { tag: node.tag, parent });
  for (const c of node.children || []) noteTree(elems, c, node.id);
}
const parentTagOf = (elems, id) => {
  const e = elems.get(id);
  const p = e ? elems.get(e.parent) : undefined;
  return p ? p.tag : undefined;
};

// Whether one attribute of an element references an image ('image'), a
// media file ('media'), or nothing to match (null). Only these elements'
// attributes count: an iframe's src is a page, which the viewer never loads.
// A <source> is media under <video>/<audio> and an image under <picture>;
// anywhere else, or under a parent the recording never showed, its
// extension decides.
function refKind(tag, parentTag, name, value) {
  if (tag === 'img') return name === 'src' ? 'image' : null;
  if (tag === 'video') return name === 'src' ? 'media' : name === 'poster' ? 'image' : null;
  if (tag === 'audio') return name === 'src' ? 'media' : null;
  if (tag === 'source' && name === 'src') {
    if (MEDIA_TAGS[parentTag]) return 'media';
    if (parentTag === 'picture') return 'image';
    return MEDIA_EXT.test(value) ? 'media' : 'image';
  }
  return null;
}

// Calls visit(kind, value, replace) for every image or media reference in
// the segments' keyframe trees, dom.add subtrees and dom.attr values, in
// order; replace(v) writes a new value back where the old one was found.
// `media_src` (the resolved URL a video or audio loaded) is always media.
function eachRef(segments, visit) {
  const elems = new Map();
  const tree = (root) => {
    for (const n of walkNodes(root)) {
      if (n.kind !== 'element') continue;
      const parentTag = parentTagOf(elems, n.id);
      for (const name of Object.keys(n.attrs || {})) {
        const v = n.attrs[name];
        const kind = v ? refKind(n.tag, parentTag, name, v) : null;
        if (kind) visit(kind, v, (x) => { n.attrs[name] = x; });
      }
      if (n.media_src) visit('media', n.media_src, (x) => { n.media_src = x; });
    }
  };
  for (const { dom, events } of segments) {
    noteTree(elems, dom, null);
    tree(dom);
    for (const ev of events) {
      if (ev.type === 'dom.add') { noteTree(elems, ev.node, ev.parent); tree(ev.node); }
      else if (ev.type === 'dom.attr' && ev.value && elems.has(ev.node)) {
        const kind = refKind(elems.get(ev.node).tag, parentTagOf(elems, ev.node), ev.name, ev.value);
        if (kind) visit(kind, ev.value, (x) => { ev.value = x; });
      }
    }
  }
}

// An entry is usable for inlining only when a single file matched (bytes set).
const supplied = (assetMap, url) => {
  const e = assetMap ? assetMap.get(url) : undefined;
  return e && e.bytes ? e : null;
};

// The URLs a recording references, by kind. With an asset map, a link sheet
// the map supplies also contributes the references inside its text (one
// level: what an @import'ed sheet references is not followed). `media` is
// listed for the note only; it is never matched.
function collect(recording, assetMap) {
  const sheets = [], images = [], fonts = [], media = [];
  const seen = new Set();
  const add = (list, url) => { if (typeof url === 'string' && url && !seen.has(url)) { seen.add(url); list.push(url); } };
  // data:/blob: sources are already inline content, not assets to match.
  const inline = (url) => typeof url !== 'string' || /^(data:|blob:|#)/i.test(url);
  const addRef = (url) => { if (!inline(url)) add(FONT_EXT.test(url) ? fonts : images, url); };
  const addCss = (css, href) => {
    const r = cssRefs(css, href);
    for (const u of r.imports) add(sheets, u);
    for (const u of r.urls) addRef(u);
  };
  for (const s of sheetsOf(recording)) {
    if (s.kind === 'link' && s.css == null) {
      add(sheets, s.href);
      const e = supplied(assetMap, s.href);
      if (e) addCss(decodeUtf8(e.bytes), s.href);
    } else if (s.css) addCss(s.css, s.href);
  }
  for (const css of sheetUpdatesOf(recording)) addCss(css, null);
  eachRef(segmentsOf(recording), (kind, url) => {
    if (kind === 'media') { if (!inline(url)) add(media, url); } else addRef(url);
  });
  return { stylesheets: sheets, images, fonts, media };
}

export function collectAssetUrls(recording) { return collect(recording, null); }

const normalizePath = (p) => String(p).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');

// How many trailing path segments a supplied path shares with the URL's path
// ('/study/css/a.css' and 'exp/css/a.css' share 2). 0 (not even the
// filename) is no candidate. `fold` is applied to both sides of each
// comparison: identity for the exact pass, lowercasing for the case-blind one.
function sharedTail(urlSegs, path, fold) {
  const p = path.split('/');
  let n = 0;
  while (n < p.length && n < urlSegs.length && fold(p[p.length - 1 - n]) === fold(urlSegs[urlSegs.length - 1 - n])) n++;
  return n;
}

const exact = (s) => s;
const caseBlind = (s) => s.toLowerCase();

// The supplied paths that rank best for one URL, in their own spelling.
// Rank: a file whose WHOLE path is a suffix of the URL's path first
// ('img/a.png' over 'lib/img/a.png' for /study/img/a.png), then the longer
// shared tail ('node_modules/x/a.css' over 'x/a.css'). Only a tie at the top
// rank is ambiguous.
function bestCandidates(segs, dropped, fold) {
  let best = 0, cands = [];
  for (const p of dropped) {
    const n = sharedTail(segs, p, fold);
    if (n === 0) continue;
    const rank = (n === p.split('/').length ? segs.length + 1 : 0) + n;
    if (rank > best) { best = rank; cands = [p]; } else if (rank === best) cands.push(p);
  }
  return cands;
}

export function matchAssets(urls, droppedPaths) {
  const dropped = [...new Set(droppedPaths.map(normalizePath))];
  const matched = new Map(), missing = [], ambiguous = [];
  for (const url of urls) {
    const segs = pathOf(url).split('/').filter(Boolean);
    // Any exact candidate, however weak, wins over a case-blind one.
    let cands = bestCandidates(segs, dropped, exact);
    if (cands.length === 0) cands = bestCandidates(segs, dropped, caseBlind);
    if (cands.length === 1) matched.set(url, cands[0]);
    else if (cands.length > 1) ambiguous.push({ url, candidates: cands });
    else missing.push(url);
  }
  return { matched, missing, ambiguous };
}

// Two passes: the URLs the recordings reference, then the references inside
// the stylesheets the first pass supplied. Each file is read once.
export async function buildAssetMap(recordings, droppedFiles) {
  const byPath = new Map(droppedFiles.map((f) => [normalizePath(f.path), f]));
  const assetMap = new Map();
  const bytesByPath = new Map();
  const report = { matched: [], missing: [], ambiguous: [] };
  const seen = new Set();
  for (const pass of [null, assetMap]) {
    const urls = [];
    for (const rec of recordings) {
      const u = collect(rec, pass);
      for (const url of [...u.stylesheets, ...u.images, ...u.fonts]) if (!seen.has(url)) { seen.add(url); urls.push(url); }
    }
    const { matched, missing, ambiguous } = matchAssets(urls, [...byPath.keys()]);
    for (const [url, path] of matched) {
      if (!bytesByPath.has(path)) bytesByPath.set(path, await byPath.get(path).read());
      assetMap.set(url, { bytes: bytesByPath.get(path), type: contentTypeFor(path) });
      report.matched.push({ url, path });
    }
    for (const a of ambiguous) {
      assetMap.set(a.url, { bytes: null, type: null, candidates: a.candidates });
      report.ambiguous.push(a);
    }
    report.missing.push(...missing);
  }
  return { assetMap, report };
}

export function applyAssetMap(model, assetMap) {
  if (!assetMap || assetMap.size === 0) return model;
  const uris = new Map();
  const dataUri = (url) => {
    if (!uris.has(url)) { const e = supplied(assetMap, url); uris.set(url, 'data:' + e.type + ';base64,' + bytesToBase64(e.bytes)); }
    return uris.get(url);
  };
  // A supplied @import is spliced in place of the statement (inside @media
  // when it had a media list): a data: stylesheet would be blocked by the
  // viewer's style-src. Anything else becomes, or stays, an absolute URL;
  // only URLs that went through the URL parser (or data URIs) are rewritten,
  // and cssUrl escapes them, so a recorded href cannot close the string.
  // `nested` is the spliced sheet's own text: one level, no further splicing.
  const rewriteCss = (css, href, nested) => {
    const text = String(css);
    const spliceable = (m) => {
      if (nested || isComment(m) || m[7] !== undefined || CONDITIONAL_IMPORT.test(m[5])) return null;
      const ref = resolveRef(m[2] !== undefined ? m[2] : m[4], href);
      return ref && supplied(assetMap, ref.url) ? ref.url : null;
    };
    // Once one import is spliced, rules precede the rest, and an @import
    // after a rule is ignored: the imports left as URLs move to the top.
    // That puts their rules before the spliced ones (a cascade-order change
    // only for a sheet whose imports were partly supplied). An unsupplied
    // import that stays an @import still will not load in the viewer, whose
    // style-src blocks external sheets once this sheet is inline; the note
    // lists it as missing (a layer()/supports() import is not counted).
    const hoist = [...text.matchAll(CSS_REF)].some((m) => spliceable(m) !== null);
    const hoisted = [];
    const out = text.replace(CSS_REF, (...m) => {
      if (isComment(m)) return m[0];
      if (m[7] === undefined) {
        const url = spliceable(m);
        if (url) {
          const inner = rewriteCss(decodeUtf8(supplied(assetMap, url).bytes), url, true);
          const media = m[5].trim();
          return media ? '@media ' + media + '{' + inner + '}' : inner;
        }
        const ref = resolveRef(m[2] !== undefined ? m[2] : m[4], href);
        const stmt = ref && ref.resolved ? '@import ' + cssUrl(ref.url) + m[5].replace(/\s+$/, '') + ';' : m[0];
        // An import at the very end may lack its ';'; moved up, it would
        // swallow the rule that now follows it.
        if (hoist) { hoisted.push(/;$/.test(stmt) ? stmt : stmt.trimEnd() + ';'); return ''; }
        return stmt;
      }
      const ref = resolveRef(m[7], href);
      if (!ref) return m[0];
      if (supplied(assetMap, ref.url)) return cssUrl(dataUri(ref.url));
      return ref.resolved ? cssUrl(ref.url) : m[0];
    });
    return hoisted.length ? hoisted.join('\n') + '\n' + out : out;
  };
  const sheet = (s) => {
    if (!s) return;
    const e = s.kind === 'link' && s.css == null ? supplied(assetMap, s.href) : null;
    if (e) s.css = decodeUtf8(e.bytes);
    if (s.css) s.css = rewriteCss(s.css, s.href, false);
  };
  for (const s of model.stylesheets || []) sheet(s);
  for (const ev of model.stylesheetEvents || []) {
    if (ev.type === 'stylesheet.add') sheet(ev.sheet);
    else if (ev.type === 'stylesheet.update' && ev.css) ev.css = rewriteCss(ev.css, null, false);
  }
  // Media is never matched, so only image references are rewritten.
  eachRef(segmentsOf(model), (kind, url, replace) => {
    if (kind === 'image' && supplied(assetMap, url)) replace(dataUri(url));
  });
  return model;
}

// Per recording, taken BEFORE applyAssetMap (which rewrites the recording
// through the model's aliases). Fonts are counted on their own: a supplied
// stylesheet usually brings them. Media has only a total: it is never matched.
export function assetMatchSummary(recording, assetMap) {
  const u = collect(recording, assetMap);
  const tally = (urls) => ({
    matched: urls.filter((x) => supplied(assetMap, x)).length, total: urls.length,
    missing: urls.filter((x) => !assetMap.has(x)).map(lastSegment),
    ambiguous: urls.filter((x) => assetMap.has(x) && !supplied(assetMap, x)).map(lastSegment),
  });
  return { stylesheets: tally(u.stylesheets), images: tally(u.images), fonts: tally(u.fonts), media: { total: u.media.length } };
}

export function assetNoteText(summary) {
  const parts = [];
  const word = (t, noun) => {
    const detail = [];
    if (t.missing.length) detail.push(`missing: ${t.missing.join(', ')}`);
    if (t.ambiguous.length) detail.push(`ambiguous: ${t.ambiguous.join(', ')}`);
    return `${t.matched} of ${t.total} ${noun} matched` + (detail.length ? ` (${detail.join('; ')})` : '');
  };
  if (summary.stylesheets.total > 0) parts.push(word(summary.stylesheets, 'stylesheets'));
  if (summary.images.total > 0) parts.push(word(summary.images, 'images'));
  if (summary.fonts.total > 0) parts.push(word(summary.fonts, 'fonts'));
  const m = summary.media.total;
  if (m > 0) parts.push((m === 1 ? '1 video/audio element shown as placeholder' : `${m} video/audio elements shown as placeholders`) +
    '; replays never load or play media');
  return parts.length ? 'Experiment assets: ' + parts.join('; ') + '.' : null;
}
