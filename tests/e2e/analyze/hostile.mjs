// tests/e2e/analyze/hostile.mjs
// A hostile dom-tier SessionRecording v2, built from the committed demo
// fixture: every element, attribute, CSS construct and event a participant
// could put in a file to make the analyst's browser send a request, each
// pointing at its own path on a sentinel server (support.mjs startSentinel),
// so a request that arrives names the construct that caused it. The path
// prefix names the class of request:
//   /doc-img/   images the recording references
//   /doc-font/  fonts
//   /doc-css/   CSS url() images
//   /doc-sheet/ external stylesheets
//   /x/         anything else
// The first four are what the CLI report may load by design; the analyze
// page loads none of them. Malformed shapes the viewer must survive without
// a page error ride along (a stylesheet id that is not a number, a value
// aimed at a file input, a `children` that is not an array).
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './support.mjs';

const FIXT_DIR = join(ROOT, 'tests', 'fixtures', 'demo');
export const EPOCH = '1785352263344';

let nextId = 900000;
const el = (tag, attrs = {}, children = [], extra = {}) => ({ id: ++nextId, kind: 'element', tag, attrs, children, ...extra });
const text = (t) => ({ id: ++nextId, kind: 'text', text: t });

export function hostileNodes(S) {
  const nodes = [];
  const push = (n) => { nodes.push(n); return n; };
  // Focus stealers first (one autofocus wins): a link that would navigate the frame on Enter.
  push(el('a', { href: S + '/x/afocus', autofocus: '', id: 'afocus' }, [text('focus me')]));
  // HTML image carriers.
  const img = push(el('img', { src: S + '/doc-img/img.png', alt: '' }));
  push(el('img', { srcset: S + '/doc-img/srcset.png 1x', alt: '' }));
  push(el('picture', {}, [el('source', { srcset: S + '/doc-img/picsource.png' }), el('img', { src: S + '/doc-img/picimg.png', alt: '' })]));
  push(el('input', { type: 'image', src: S + '/doc-img/inputimg.png', alt: '' }));
  push(el('body', { background: S + '/doc-img/nested-body-bg.png' }));   // a second body element, in body
  push(el('table', { background: S + '/doc-img/tablebg.png' }, [el('tr', {}, [el('td', { background: S + '/doc-img/tdbg.png' }, [text('x')])])]));
  // Media (the poster is an image).
  const video = push(el('video', { poster: S + '/doc-img/poster.png', src: S + '/x/video.mp4', controls: '' }));
  push(el('video', { controls: '' }, [el('source', { src: S + '/x/vsource.webm' }), el('track', { src: S + '/x/track.vtt', kind: 'subtitles' })]));
  push(el('audio', { controls: '' }, [], { media_src: S + '/x/audio.mp3' }));
  // Plugin and frame carriers.
  push(el('object', { data: S + '/x/object.svg', type: 'image/svg+xml' }, [text('obj')]));
  push(el('embed', { src: S + '/x/embed.svg', type: 'image/svg+xml' }));
  const iframe = push(el('iframe', { src: S + '/x/iframe.html', srcdoc: '<img src="' + S + '/x/srcdoc.png">' }));
  push(el('frame', { src: S + '/x/frame.html' }));
  push(el('frameset', {}, [el('frame', { src: S + '/x/frameset-frame.html' })]));
  push(el('div', {}, [], { media_src: S + '/x/div-media-src.html' }));
  push(el('portal', { src: S + '/x/portal.html' }));
  push(el('fencedframe', { src: S + '/x/fenced.html' }));
  // Head-only and executable elements placed in the body (rebuilt as inert
  // <template>s), one with a resource-bearing child.
  for (const rel of ['prefetch', 'preload', 'prerender', 'icon', 'dns-prefetch', 'preconnect', 'modulepreload', 'manifest', 'stylesheet']) {
    push(el('link', { rel, href: S + '/x/link-' + rel + (rel === 'stylesheet' ? '.css' : ''), as: 'image', crossorigin: '' }));
  }
  push(el('meta', { 'http-equiv': 'refresh', content: '0;url=' + S + '/x/refresh' }));
  push(el('base', { href: S + '/x/base/' }));
  push(el('img', { src: 'rel-after-base.png', alt: '' }));          // resolves under /x/base/ only if <base> worked
  push(el('script', { src: S + '/x/script.js' }));
  push(el('script', {}, [text('fetch("' + S + '/x/inline-script")')]));
  push(el('noscript', {}, [el('img', { src: S + '/x/noscript.png', alt: '' })]));
  // CSS: every url()-taking property, @import, @font-face (with local() probing), media queries.
  const styleText = push(text(
    '@import url(' + S + '/x/import.css);' +
    'body{background:url(' + S + '/doc-css/bg.png)}' +
    '@font-face{font-family:hx;src:url(' + S + '/doc-font/font.woff)}' +
    '@font-face{font-family:probeA;src:local("Arial"),url(' + S + '/x/font-probe-arial-installed.woff)}' +
    '@font-face{font-family:probeB;src:local("NoSuchFontZZZ"),url(' + S + '/x/font-probe-missing.woff)}' +
    '.hx{font-family:hx}.pa{font-family:probeA}.pb{font-family:probeB}' +
    '.cur{cursor:url(' + S + '/doc-css/cursor.png),auto;width:50px;height:50px}' +
    '.msk{mask:url(' + S + '/x/mask.svg#m);-webkit-mask:url(' + S + '/x/mask.svg#m);width:50px;height:50px;background:red}' +
    '.flt{filter:url(' + S + '/x/filter.svg#f);width:50px;height:50px;background:red}' +
    '.cp{clip-path:url(' + S + '/x/clip.svg#c);width:50px;height:50px;background:red}' +
    '.li{list-style-image:url(' + S + '/doc-css/li.png)}' +
    '.bi{border:5px solid;border-image:url(' + S + '/doc-css/border.png) 1;width:50px;height:50px}' +
    '.ct::before{content:url(' + S + '/doc-css/content.png)}' +
    '.so{float:left;shape-outside:url(' + S + '/doc-css/shape.png);width:50px;height:50px}' +
    '.is{background-image:image-set(url(' + S + '/doc-css/imageset.png) 1x);width:50px;height:50px}' +
    '.fill{fill:url(' + S + '/x/fill.svg#g)}.mk{marker-start:url(' + S + '/x/marker.svg#m)}' +
    '@media (prefers-color-scheme: light){.mq{background:url(' + S + '/x/mq-scheme-light.png)}}' +
    '@media (prefers-color-scheme: dark){.mq{background:url(' + S + '/x/mq-scheme-dark.png)}}' +
    '@media (min-resolution: 1.5dppx){.mq{border-image:url(' + S + '/x/mq-hidpi.png) 1}}' +
    '.mq{width:50px;height:50px}'));
  push(el('style', {}, [styleText]));
  for (const c of ['hx', 'pa', 'pb']) push(el('span', { class: c }, [text('font probe')]));
  for (const c of ['cur', 'msk', 'flt', 'cp', 'bi', 'ct', 'so', 'is', 'mq']) push(el('div', { class: c }, [text('.')]));
  push(el('ul', { class: 'li' }, [el('li', {}, [text('item')])]));
  const inlineStyled = push(el('div', { style: 'background:url(' + S + '/doc-css/inline-style.png);width:50px;height:50px' }));
  // SVG.
  push(el('svg', { xmlns: 'http://www.w3.org/2000/svg', 'xmlns:xlink': 'http://www.w3.org/1999/xlink', width: '100', height: '100', onload: 'fetch("' + S + '/x/svg-onload")' }, [
    el('use', { href: S + '/x/use.svg#x' }),
    el('use', { 'xlink:href': S + '/x/usexlink.svg#x' }),
    el('use', { href: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" id="x"><image href="' + S + '/x/use-data-image.png"/></svg>#x' }),
    el('image', { href: S + '/doc-img/svgimage.png', width: '10', height: '10' }),
    el('image', { 'xlink:href': S + '/doc-img/svgimage-xlink.png', width: '10', height: '10' }),
    el('image', { 'XLINK:HREF': S + '/doc-img/svgimage-xlink-upper.png', width: '10', height: '10' }),
    el('image', { href: 'javascript:fetch("' + S + '/x/svg-js-href")', width: '10', height: '10' }),
    el('filter', { id: 'f' }, [el('feImage', { href: S + '/x/feimage.png' })]),
    el('rect', { width: '10', height: '10', filter: 'url(#f)' }),
    el('rect', { width: '10', height: '10', class: 'fill' }),
    el('line', { x1: '0', y1: '0', x2: '10', y2: '10', class: 'mk', stroke: 'black' }),
    el('script', { href: S + '/x/svgscript.js' }),
    el('a', { href: S + '/x/svga' }, [el('text', { x: '0', y: '10' }, [text('link')])]),
    el('image', { href: '#', width: '10', height: '10' }, [el('animate', { attributeName: 'href', to: S + '/doc-img/animate-href.png', begin: '0s', dur: '0.1s', fill: 'freeze' })]),
    el('image', { href: '#', width: '10', height: '10' }, [el('set', { attributeName: 'href', to: S + '/doc-img/set-href.png', begin: '0s' })]),
    el('set', { attributeName: 'onload', to: 'fetch("' + S + '/x/svg-set-onload")', begin: '0s' }),
    el('style', {}, [text('@import url(' + S + '/x/svgstyle.css);rect{fill:url(' + S + '/x/svgcssfill.svg#p)}')]),
    el('foreignObject', { width: '50', height: '50' }, [el('img', { src: S + '/doc-img/fo.png', alt: '' })]),
    el('cursor', { 'xlink:href': S + '/x/svgcursor.png' }),
  ]));
  push(el('svg', { 'xml:base': S + '/x/xmlbase/', width: '10', height: '10' }, [el('image', { href: 'rel.png', width: '10', height: '10' })]));
  // MathML.
  push(el('math', {}, [
    el('mi', { href: S + '/x/math-href' }, [text('x')]),
    el('mglyph', { src: S + '/x/mglyph.png', alt: 'g' }),
    el('semantics', {}, [el('mi', {}, [text('y')]), el('annotation-xml', { encoding: 'text/html' }, [el('img', { src: S + '/x/mathimg.png', alt: '' })])]),
  ]));
  // Attribute-name tricks.
  push(el('a', { HREF: 'javascript:fetch("' + S + '/x/href-upper")' }, [text('A')]));
  push(el('a', { href: 'java\tscript:fetch("' + S + '/x/href-tab")' }, [text('B')]));
  push(el('a', { href: ' javascript:fetch("' + S + '/x/href-space")' }, [text('C')]));
  push(el('a', { href: S + '/x/a-ping', ping: S + '/x/ping' }, [text('D')]));
  // Forms, and a file input a recorded value is aimed at.
  push(el('form', { action: S + '/x/form', method: 'post' }, [el('input', { name: 'q', autofocus: '' }), el('input', { type: 'submit' }), el('button', { formaction: S + '/x/formaction' }, [text('go')])]));
  const fileInput = push(el('input', { type: 'file' }));
  // A canvas for the canvas.snapshot event.
  const canvas = push(el('canvas', { width: '10', height: '10' }, [], { canvas_size: { w: 10, h: 10 } }));
  // Viewer-owned attributes, forged.
  push(el('div', { 'data-ch-placeholder': 'iframe', 'data-ch-shadow': '' }, [text('forged')]));
  const plainDiv = push(el('div', { class: 'x', id: 'plain' }, [text('plain')]));
  // `children` that only claims a length.
  push({ id: ++nextId, kind: 'element', tag: 'div', attrs: {}, children: { length: 1e9 } });
  return { nodes, ids: { img, video, iframe, styleText, inlineStyled, canvas, plainDiv, fileInput } };
}

// The recording: the fixture with the hostile nodes at the front of its
// keyframe body, a second copy added by a dom.add, hostile patches in the
// keyframe segment (applied at its origin), hostile session sheets and
// sheet events, and hostile <html> attributes.
export function buildHostileRecording(S) {
  nextId = 900000;
  const rec = JSON.parse(readFileSync(join(FIXT_DIR, 'DEMO-FIXT-replay-' + EPOCH + '.json'), 'utf8'));
  const k = rec.segments.find((s) => s.initial_dom);
  const origin = k.t_load ?? k.t_dom_ready ?? k.t_start ?? k.events[0].t;
  const { nodes, ids } = hostileNodes(S);
  k.initial_dom.children.unshift(...nodes);
  // The recorded <html> attributes (CH vendor data).
  k.extensions = k.extensions || {};
  k.extensions['cyborg-hunter'] = Object.assign({}, k.extensions['cyborg-hunter'], {
    root_attrs: { lang: 'en', manifest: S + '/x/appcache.manifest', style: 'background:url(' + S + '/doc-css/root-style.png)', onload: 'fetch("' + S + '/x/root-onload")' },
  });
  // Session sheets: the fixture's own sheet made href-only (the CLI report's
  // opt-out external fetch), plus inline ones carrying @import/url().
  rec.stylesheets[0].css = null;
  rec.stylesheets[0].href = S + '/doc-sheet/demo.css';
  rec.stylesheets.push(
    { id: 2, kind: 'inline', href: null, css: '@import url(' + S + '/x/sheet-import.css);.x{outline:1px solid;border-image:url(' + S + '/doc-css/sheet-url.png) 1}', media: null },
    { id: 3, kind: 'link', href: 'javascript:fetch("' + S + '/x/sheet-js-href")', css: null, media: null },
    { id: 4, kind: 'link', href: S + '/doc-sheet/link-only.css', css: null, media: '"],[x="' },
  );
  rec.stylesheet_events = [
    { type: 'stylesheet.add', t: origin - 1, sheet: { id: 5, kind: 'inline', css: '.x{background-image:url(' + S + '/doc-css/event-add.png)}', href: null, media: null } },
    { type: 'stylesheet.update', t: origin - 0.5, id: 2, css: '@import url(' + S + '/x/update-import.css);.x{background:url(' + S + '/doc-css/event-update.png)}' },
    // Ids that are not numbers: one ends a selector, one widens it to the viewer's own rules.
    { type: 'stylesheet.add', t: origin - 0.4, sheet: { id: 'a"b', kind: 'inline', css: 'body{}', href: null, media: null } },
    { type: 'stylesheet.add', t: origin - 0.3, sheet: { id: 'x"],[data-ch-shell-rules],[x="', kind: 'inline', css: 'body{}', href: null, media: null } },
    { type: 'stylesheet.update', t: origin - 0.2, id: 'x"],[data-ch-shell-rules],[x="', css: '.x{background:url(' + S + '/x/shell-rules.png)}' },
  ];
  const t = origin;
  const added = hostileNodes(S);   // a second copy, added by a dom.add patch
  k.events.unshift(
    { type: 'dom.add', t, parent: k.initial_dom.id, before: null, node: el('div', { id: 'added' }, added.nodes.slice(1)) },
    { type: 'dom.add', t, parent: k.initial_dom.id, before: null, node: el('link', { rel: 'prefetch', href: S + '/x/add-prefetch' }) },
    { type: 'dom.add', t, parent: k.initial_dom.id, before: null, node: el('iframe', { src: S + '/x/add-iframe.html' }) },
    { type: 'dom.attr', t, node: ids.iframe.id, name: 'src', value: S + '/x/attr-iframe-src.html' },
    { type: 'dom.attr', t, node: ids.iframe.id, name: 'srcdoc', value: '<img src="' + S + '/x/attr-srcdoc.png">' },
    { type: 'dom.attr', t, node: ids.iframe.id, name: 'SRC', value: S + '/x/attr-iframe-SRC.html' },
    { type: 'dom.attr', t, node: ids.img.id, name: 'src', value: S + '/doc-img/attr-img.png' },
    { type: 'dom.attr', t, node: ids.plainDiv.id, name: 'style', value: 'background:url(' + S + '/doc-css/attr-style.png)' },
    { type: 'dom.attr', t, node: ids.plainDiv.id, name: 'onclick', value: 'fetch("' + S + '/x/attr-onclick")' },
    { type: 'dom.attr', t, node: ids.video.id, name: 'poster', value: S + '/doc-img/attr-poster.png' },
    { type: 'dom.attr', t, node: ids.video.id, name: 'autoplay', value: '' },
    { type: 'dom.attr', t, node: ids.plainDiv.id, name: 'data-ch-placeholder', value: 'iframe' },
    { type: 'dom.text', t, node: ids.styleText.id, text: '.x{background:url(' + S + '/doc-css/text-patch.png)}' },
    { type: 'canvas.snapshot', t, node: ids.canvas.id, data_url: S + '/x/canvas-snapshot.png' },
    { type: 'input.value', t, node: ids.fileInput.id, value: 'C:\\fakepath\\x.txt' },
  );
  return rec;
}

// A one-participant cohort dir: the fixture's tracker data, the hostile
// recording under the CH file name, a config naming the id field.
export function makeHostileCohort(S) {
  const dir = mkdtempSync(join(tmpdir(), 'ch-e2e-hostile-'));
  writeFileSync(join(dir, 'DEMO-FIXT.json'), readFileSync(join(FIXT_DIR, 'DEMO-FIXT.json'), 'utf8'));
  writeFileSync(join(dir, 'DEMO-FIXT-replay-' + EPOCH + '.json'), JSON.stringify(buildHostileRecording(S)));
  writeFileSync(join(dir, 'cyborg-hunter.config.json'), JSON.stringify({ filePattern: 'DEMO-*.json', participantIdField: 'participantId' }));
  const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).map((f) => join(dir, f));
  return { dir, files, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
