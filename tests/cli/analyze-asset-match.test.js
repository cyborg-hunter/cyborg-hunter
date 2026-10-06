// One matcher for dropped experiment folders (browser page) and assetsDir (CLI).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { collectAssetUrls, matchAssets, buildAssetMap, applyAssetMap, assetMatchSummary, assetNoteText, contentTypeFor } from '../../src/cli/asset-match.js';
import { buildViewerModel } from '../../src/replay/viewer-model.js';

const bytes = (s) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function recording() {
  return {
    schema_version: 2, recorder: { name: 'cyborg-hunter-replay', version: '0.9.1' }, participant_id: 'P1',
    recording_started_at: '2026-01-01T00:00:00.000Z', recording_started_at_perf: 0,
    user_agent: 'x', viewport: { w: 800, h: 600 }, observed_root: '#root',
    stylesheets: [
      { id: 1, kind: 'link', href: 'https://exp.example.org/study/css/style.css', css: null, media: null },
      { id: 2, kind: 'link', href: 'https://exp.example.org/study/css/fonts.css', css: null, media: null },
      { id: 3, kind: 'inline', href: null, css: 'body{color:red}', media: null },
      { id: 4, kind: 'link', href: 'https://exp.example.org/study/css/bg.css', css: '.a{background:url("../img/bg.png")}', media: null },
    ],
    stylesheet_events: [], viewport_changes: [], rng: null, rng_calls: null, ended_at_perf: 10, end_reason: 'end', truncated: false,
    extensions: { 'cyborg-hunter': { tier: 'dom' } },
    segments: [{
      index: 0, label: null, plugin: null, t_start: 0, t_dom_ready: 0, t_load: null, t_end: 10,
      initial_dom: { id: 1, kind: 'element', tag: 'body', attrs: {}, children: [
        { id: 2, kind: 'element', tag: 'img', attrs: { src: 'https://exp.example.org/study/img/stim-1.png', alt: 'a' }, children: [] },
        { id: 3, kind: 'element', tag: 'video', attrs: { poster: 'https://exp.example.org/study/img/poster.jpg' }, children: [], media_src: 'https://exp.example.org/study/clip.webm' },
        { id: 4, kind: 'text', text: 'https://exp.example.org/study/img/not-an-asset.png' },
        { id: 6, kind: 'element', tag: 'img', attrs: { src: 'data:image/png;base64,AAAA' }, children: [] },
      ] },
      initial_state: null,
      events: [
        { type: 'dom.add', t: 1, parent: 1, before: null, node: { id: 5, kind: 'element', tag: 'img', attrs: { src: 'https://exp.example.org/study/img/stim-2.png' }, children: [] } },
        { type: 'dom.attr', t: 2, node: 2, name: 'src', value: 'https://exp.example.org/study/img/stim-3.png' },
        { type: 'dom.attr', t: 3, node: 2, name: 'alt', value: 'https://exp.example.org/study/img/stim-1.png' },
      ],
      host_data: null, extensions: null,
    }],
  };
}

describe('collectAssetUrls', () => {
  it('lists href-only sheets, image sources in the DOM and in mutations, and url() refs resolved against the sheet', () => {
    const u = collectAssetUrls(recording());
    assert.deepStrictEqual(u.stylesheets, ['https://exp.example.org/study/css/style.css', 'https://exp.example.org/study/css/fonts.css']);
    assert.deepStrictEqual(u.images, [
      'https://exp.example.org/study/img/bg.png',
      'https://exp.example.org/study/img/stim-1.png',
      'https://exp.example.org/study/img/poster.jpg',
      'https://exp.example.org/study/img/stim-2.png',
      'https://exp.example.org/study/img/stim-3.png',
    ], 'an inline data: image is not an asset; a video\'s poster is an image');
    assert.deepStrictEqual(u.media, ['https://exp.example.org/study/clip.webm'], 'what a video plays is media, not an image');
  });
});

describe('matchAssets', () => {
  const urls = ['https://exp.example.org/study/css/style.css', 'https://exp.example.org/study/css/fonts.css', 'https://exp.example.org/study/img/stim-1.png', 'https://exp.example.org/study/img/dup.png'];
  it('matches by path suffix, falls back to the filename, lists ambiguity and misses', () => {
    const r = matchAssets(urls, ['experiment/css/style.css', 'stim-1.png', 'a/img/dup.png', 'b/img/dup.png']);
    assert.strictEqual(r.matched.get(urls[0]), 'experiment/css/style.css');
    assert.strictEqual(r.matched.get(urls[2]), 'stim-1.png');
    assert.deepStrictEqual(r.missing, [urls[1]]);
    assert.deepStrictEqual(r.ambiguous, [{ url: urls[3], candidates: ['a/img/dup.png', 'b/img/dup.png'] }]);
  });
  it('a suffix match beats a filename-only match and strips ./ and leading /', () => {
    const r = matchAssets(['https://h/x/css/style.css'], ['./css/style.css', 'other/style.css']);
    assert.strictEqual(r.matched.get('https://h/x/css/style.css'), 'css/style.css');
  });
  it('tolerates a URL that does not parse', () => {
    const r = matchAssets(['not a url/style.css'], ['style.css']);
    assert.strictEqual(r.matched.get('not a url/style.css'), 'style.css');
  });
});

describe('buildAssetMap + applyAssetMap', () => {
  const dropped = [
    { path: 'study/css/style.css', read: async () => bytes('p{margin:0}') },
    { path: 'study/img/stim-1.png', read: async () => PNG },
    { path: 'study/img/bg.png', read: async () => PNG },
  ];
  it('reads each matched file once and inlines sheets and images into the viewer model', async () => {
    let reads = 0;
    const counted = dropped.map((d) => ({ path: d.path, read: async () => { reads++; return d.read(); } }));
    const { assetMap, report } = await buildAssetMap([recording(), recording()], counted);
    assert.strictEqual(reads, 3, 'two recordings, three files, each read once');
    assert.deepStrictEqual(report.matched.map((m) => m.path).sort(), ['study/css/style.css', 'study/img/bg.png', 'study/img/stim-1.png']);
    assert.ok(report.missing.includes('https://exp.example.org/study/css/fonts.css'));
    const model = applyAssetMap(buildViewerModel(recording()), assetMap);
    assert.strictEqual(model.stylesheets[0].css, 'p{margin:0}');
    assert.strictEqual(model.stylesheets[1].css, null, 'unmatched stays href-only');
    assert.match(model.stylesheets[3].css, /url\("data:image\/png;base64,iVBORw=="\)/);
    const body = model.segments[0].initialDom;
    assert.strictEqual(body.children[0].attrs.src, 'data:image/png;base64,iVBORw==');
    assert.strictEqual(body.children[0].attrs.alt, 'a');
    assert.strictEqual(body.children[2].text, 'https://exp.example.org/study/img/not-an-asset.png', 'text nodes are never rewritten');
    assert.strictEqual(model.segments[0].events[2].value, 'https://exp.example.org/study/img/stim-1.png', 'only src/poster attrs are rewritten');
    assert.strictEqual(body.children[3].attrs.src, 'data:image/png;base64,AAAA', 'inline data: images untouched');
  });
  it('rewrites the recording too (the model aliases it), so the summary must be taken first', async () => {
    const { assetMap } = await buildAssetMap([recording()], dropped);
    const rec = recording();
    const before = assetMatchSummary(rec, assetMap);
    applyAssetMap(buildViewerModel(rec), assetMap);
    assert.strictEqual(rec.stylesheets[0].css, 'p{margin:0}', 'the recording\'s sheet object is the model\'s');
    assert.strictEqual(before.stylesheets.matched, 1);
    assert.strictEqual(assetMatchSummary(rec, assetMap).stylesheets.total, 1, 'after the apply, the matched sheet no longer counts as external');
  });
  it('is a no-op on an empty map', () => {
    const before = JSON.stringify(buildViewerModel(recording()));
    assert.strictEqual(JSON.stringify(applyAssetMap(buildViewerModel(recording()), new Map())), before);
  });
  it('summarises per recording and words the report note', async () => {
    const { assetMap } = await buildAssetMap([recording()], dropped);
    const s = assetMatchSummary(recording(), assetMap);
    assert.deepStrictEqual(s.stylesheets, { matched: 1, total: 2, missing: ['fonts.css'], ambiguous: [] });
    assert.strictEqual(s.images.total, 5);
    assert.strictEqual(s.images.matched, 2);
    assert.deepStrictEqual(s.media, { total: 1 });
    assert.strictEqual(assetNoteText(s), 'Experiment assets: 1 of 2 stylesheets matched (missing: fonts.css); 2 of 5 images matched (missing: poster.jpg, stim-2.png, stim-3.png); 1 video/audio element shown as placeholder; replays never play media.');
    assert.strictEqual(assetNoteText(assetMatchSummary({ stylesheets: [], segments: [] }, assetMap)), null);
  });
  it('contentTypeFor knows the asset extensions', () => {
    assert.strictEqual(contentTypeFor('a/b.CSS'), 'text/css');
    assert.strictEqual(contentTypeFor('x.woff2'), 'font/woff2');
    assert.strictEqual(contentTypeFor('x.bin'), 'application/octet-stream');
  });
});

// A recording whose one sheet the capture could not inline: href-only, so its
// text (and everything it references) comes from the supplied files.
function hrefOnly(extraNodes = [], events = []) {
  const r = recording();
  r.stylesheets = [{ id: 1, kind: 'link', href: 'https://exp.example.org/study/css/style.css', css: null, media: null }];
  r.segments[0].initial_dom.children = extraNodes;
  r.segments[0].events = events;
  return r;
}
const STYLE = '@font-face{font-family:F;src:url(fonts/a.woff2)} body{background:url(\'../img/bg.png\')}';
const WOFF = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);

describe('references inside a supplied stylesheet', () => {
  it('matches and inlines the fonts and images a supplied sheet references, resolved against its recorded URL', async () => {
    const files = [
      { path: 'study/css/style.css', read: async () => bytes(STYLE) },
      { path: 'study/css/fonts/a.woff2', read: async () => WOFF },
      { path: 'study/img/bg.png', read: async () => PNG },
    ];
    const { assetMap, report } = await buildAssetMap([hrefOnly()], files);
    assert.deepStrictEqual(report.matched.map((m) => m.path).sort(), ['study/css/fonts/a.woff2', 'study/css/style.css', 'study/img/bg.png']);
    assert.deepStrictEqual(report.missing, []);
    const rec = hrefOnly();
    const s = assetMatchSummary(rec, assetMap);
    assert.strictEqual(assetNoteText(s), 'Experiment assets: 1 of 1 stylesheets matched; 1 of 1 images matched; 1 of 1 fonts matched.');
    const model = applyAssetMap(buildViewerModel(rec), assetMap);
    assert.strictEqual(model.stylesheets[0].css,
      '@font-face{font-family:F;src:url("data:font/woff2;base64,d09GMg==")} body{background:url("data:image/png;base64,iVBORw==")}');
    const once = JSON.stringify(model);
    assert.strictEqual(JSON.stringify(applyAssetMap(model, assetMap)), once, 'a second apply changes nothing');
  });
  it('turns the references it cannot supply into absolute URLs and says what is missing', async () => {
    const { assetMap, report } = await buildAssetMap([hrefOnly()], [{ path: 'style.css', read: async () => bytes(STYLE) }]);
    assert.deepStrictEqual(report.missing.sort(), ['https://exp.example.org/study/css/fonts/a.woff2', 'https://exp.example.org/study/img/bg.png']);
    const rec = hrefOnly();
    assert.strictEqual(assetNoteText(assetMatchSummary(rec, assetMap)),
      'Experiment assets: 1 of 1 stylesheets matched; 0 of 1 images matched (missing: bg.png); 0 of 1 fonts matched (missing: a.woff2).');
    const model = applyAssetMap(buildViewerModel(rec), assetMap);
    assert.strictEqual(model.stylesheets[0].css,
      '@font-face{font-family:F;src:url("https://exp.example.org/study/css/fonts/a.woff2")} body{background:url("https://exp.example.org/study/img/bg.png")}');
  });
  it('splices a supplied @import in place; the imported sheet\'s own references are made absolute, not followed', async () => {
    const files = [
      { path: 'css/style.css', read: async () => bytes('@import "base.css";\nh1{color:red}') },
      { path: 'css/base.css', read: async () => bytes('p{background:url(../img/p.png)}') },
      { path: 'img/p.png', read: async () => PNG },
    ];
    const { assetMap, report } = await buildAssetMap([hrefOnly()], files);
    assert.deepStrictEqual(report.matched.map((m) => m.path), ['css/style.css', 'css/base.css']);
    const rec = hrefOnly();
    assert.deepStrictEqual(assetMatchSummary(rec, assetMap).stylesheets, { matched: 2, total: 2, missing: [], ambiguous: [] });
    const model = applyAssetMap(buildViewerModel(rec), assetMap);
    assert.strictEqual(model.stylesheets[0].css, 'p{background:url("https://exp.example.org/study/img/p.png")}\nh1{color:red}');
    const once = JSON.stringify(model);
    assert.strictEqual(JSON.stringify(applyAssetMap(model, assetMap)), once, 'a second apply changes nothing');
  });
  // The model aliases the recording's sheets and events, so a second model
  // over the same recording (the analyze page re-rendering, or serving one
  // replay) starts from the text the first apply wrote. A spliced sheet keeps
  // its own supplied imports as URLs, which a second apply would find at the
  // top level and splice as well.
  it('a second apply over the same recording leaves a diamond of supplied @imports as the first wrote it', async () => {
    const files = [
      { path: 'css/style.css', read: async () => bytes('@import "theme.css";\n@import "vars.css";\nh1{color:red}') },
      { path: 'css/theme.css', read: async () => bytes('@import "vars.css";\n.t{}') },
      { path: 'css/vars.css', read: async () => bytes(':root{--v:1}') },
    ];
    const rec = hrefOnly();
    rec.stylesheet_events = [{ type: 'stylesheet.update', t: 5, id: 1, css: '@import url(https://exp.example.org/study/css/theme.css);\n.u{}' }];
    const { assetMap } = await buildAssetMap([rec], files);
    const first = applyAssetMap(buildViewerModel(rec), assetMap);
    assert.strictEqual(first.stylesheets[0].css, '@import url("https://exp.example.org/study/css/vars.css");\n.t{}\n:root{--v:1}\nh1{color:red}');
    assert.strictEqual(first.stylesheetEvents[0].css, '@import url("https://exp.example.org/study/css/vars.css");\n.t{}\n.u{}');
    const once = JSON.stringify(first);
    assert.strictEqual(JSON.stringify(applyAssetMap(buildViewerModel(rec), assetMap)), once, 'a second model, a second apply');
    assert.strictEqual(JSON.stringify(applyAssetMap(first, assetMap)), once, 'the same model applied again');
  });
  it('an @import in recorded CSS counts as a stylesheet, not an image, and is spliced in, never turned into a data: URI', async () => {
    const r = hrefOnly();
    r.stylesheets = [{ id: 1, kind: 'link', href: 'https://exp.example.org/study/css/main.css',
      css: '@import url("theme.css") screen;\n@import url(l.css) layer(base);\n.a{color:red}', media: null }];
    const u = collectAssetUrls(r);
    assert.deepStrictEqual(u.images, []);
    assert.deepStrictEqual(u.stylesheets, ['https://exp.example.org/study/css/theme.css'], 'a layer()/supports() import is left alone');
    const { assetMap } = await buildAssetMap([r], [{ path: 'css/theme.css', read: async () => bytes('.t{}') }, { path: 'css/l.css', read: async () => bytes('.l{}') }]);
    const model = applyAssetMap(buildViewerModel(r), assetMap);
    // The import left as a URL moves to the top: an @import after a rule is ignored.
    assert.strictEqual(model.stylesheets[0].css, '@import url("https://exp.example.org/study/css/l.css") layer(base);\n@media screen{.t{}}\n\n.a{color:red}');
  });
  it('leaves @import and url() inside CSS comments inert and untouched', async () => {
    const files = [
      { path: 'css/style.css', read: async () => bytes('/* @import "x.css"; url(y.png) */\n@import "base.css";\n.a{}') },
      { path: 'css/base.css', read: async () => bytes('.b{}') },
      { path: 'css/x.css', read: async () => bytes('.x{}') },
      { path: 'css/y.png', read: async () => PNG },
    ];
    const { assetMap, report } = await buildAssetMap([hrefOnly()], files);
    assert.deepStrictEqual(report.matched.map((m) => m.path), ['css/style.css', 'css/base.css']);
    const model = applyAssetMap(buildViewerModel(hrefOnly()), assetMap);
    assert.strictEqual(model.stylesheets[0].css, '/* @import "x.css"; url(y.png) */\n.b{}\n.a{}');
  });
  it('matches and inlines absolute references in a recorded stylesheet update', async () => {
    const rec = recording();
    rec.stylesheet_events = [{ type: 'stylesheet.update', t: 5, id: 3, css: '.c{background:url(https://exp.example.org/study/img/late.png)}' }];
    assert.ok(collectAssetUrls(rec).images.includes('https://exp.example.org/study/img/late.png'));
    const { assetMap, report } = await buildAssetMap([rec], [{ path: 'study/img/late.png', read: async () => PNG }]);
    assert.deepStrictEqual(report.matched.map((m) => m.path), ['study/img/late.png']);
    const model = applyAssetMap(buildViewerModel(rec), assetMap);
    assert.strictEqual(model.stylesheetEvents[0].css, '.c{background:url("data:image/png;base64,iVBORw==")}');
  });
  it('reads url() and @import whatever their case, as CSS does', async () => {
    const rec = recording();
    rec.stylesheets = [{ id: 1, kind: 'inline', href: null, css: '@IMPORT URL("https://exp.example.org/study/css/base.css");\n.a{background:URL(https://exp.example.org/study/img/bg.png)}', media: null }];
    const u = collectAssetUrls(rec);
    assert.deepStrictEqual(u.stylesheets, ['https://exp.example.org/study/css/base.css']);
    assert.ok(u.images.includes('https://exp.example.org/study/img/bg.png'));
    const { assetMap } = await buildAssetMap([rec], [{ path: 'css/base.css', read: async () => bytes('.b{}') }, { path: 'img/bg.png', read: async () => PNG }]);
    const model = applyAssetMap(buildViewerModel(rec), assetMap);
    assert.strictEqual(model.stylesheets[0].css, '.b{}\n.a{background:url("data:image/png;base64,iVBORw==")}');
  });
  it('an import left as a URL at the very end, with no semicolon, does not swallow the rule after it when moved up', async () => {
    const files = [
      { path: 'css/style.css', read: async () => bytes('@import "sub.css"; .a{} @import url(https://x.org/y.css)') },
      { path: 'css/sub.css', read: async () => bytes('.s{}') },
    ];
    const { assetMap } = await buildAssetMap([hrefOnly()], files);
    const model = applyAssetMap(buildViewerModel(hrefOnly()), assetMap);
    assert.strictEqual(model.stylesheets[0].css, '@import url(https://x.org/y.css);\n.s{} .a{} ');
  });
  it('drops a byte-order mark from a supplied sheet', async () => {
    const { assetMap } = await buildAssetMap([hrefOnly()], [{ path: 'style.css', read: async () => bytes('﻿body{margin:0}') }]);
    const model = applyAssetMap(buildViewerModel(hrefOnly()), assetMap);
    assert.strictEqual(model.stylesheets[0].css, 'body{margin:0}');
  });
  it('a recorded href cannot break out of the url("...") it is resolved into', async () => {
    // other.png matches, so the map is not empty and the sheet is rewritten.
    const r = hrefOnly([{ id: 2, kind: 'element', tag: 'img', attrs: { src: 'https://h/other.png' }, children: [] }]);
    r.stylesheets = [
      { id: 1, kind: 'link', href: 'https://h/a"b)c/main.css?x="y', css: '.a{background:url(x.png)}', media: null },
      // A non-http scheme keeps a backslash through the URL parser; it is escaped.
      { id: 2, kind: 'link', href: 'foo://h/a/main.css', css: '.b{background:url(x\\)}', media: null },
    ];
    const { assetMap } = await buildAssetMap([r], [{ path: 'other.png', read: async () => PNG }]);
    const model = applyAssetMap(buildViewerModel(r), assetMap);
    assert.strictEqual(model.stylesheets[0].css, '.a{background:url("https://h/a%22b)c/x.png")}');
    assert.strictEqual(model.stylesheets[1].css, '.b{background:url("foo://h/a/x\\5c ")}');
  });
});

describe('matching rules', () => {
  it('the candidate sharing the longest path suffix with the URL wins', () => {
    const url = 'https://h/study/node_modules/jspsych/css/jspsych.css';
    const r = matchAssets([url], ['node_modules/jspsych/css/jspsych.css', 'jspsych/css/jspsych.css']);
    assert.strictEqual(r.matched.get(url), 'node_modules/jspsych/css/jspsych.css');
  });
  it('a file whose whole path is a suffix of the URL beats a longer path with the same tail', () => {
    const a = 'https://h/study/img/a.png';
    assert.strictEqual(matchAssets([a], ['img/a.png', 'lib/img/a.png']).matched.get(a), 'img/a.png');
    const b = 'https://h/a.png';
    assert.strictEqual(matchAssets([b], ['a.png', 'x/a.png']).matched.get(b), 'a.png');
  });
  it('a dropped folder named differently from the URL path still matches on the shared tail', () => {
    const url = 'https://h/study/css/style.css';
    const r = matchAssets([url], ['my-exp/css/style.css', 'my-exp/other/style.css']);
    assert.strictEqual(r.matched.get(url), 'my-exp/css/style.css');
    assert.deepStrictEqual(r.ambiguous, []);
  });
  it('a tie at the longest shared suffix is ambiguous, and the note says so instead of calling it missing', async () => {
    const files = [{ path: 'a/img/stim-1.png', read: async () => PNG }, { path: 'b/img/stim-1.png', read: async () => PNG }];
    const r = hrefOnly([{ id: 2, kind: 'element', tag: 'img', attrs: { src: 'https://exp.example.org/study/img/stim-1.png' }, children: [] }]);
    const { assetMap, report } = await buildAssetMap([r], files);
    assert.deepStrictEqual(report.ambiguous, [{ url: 'https://exp.example.org/study/img/stim-1.png', candidates: ['a/img/stim-1.png', 'b/img/stim-1.png'] }]);
    assert.strictEqual(assetNoteText(assetMatchSummary(r, assetMap)),
      'Experiment assets: 0 of 1 stylesheets matched (missing: style.css); 0 of 1 images matched (ambiguous: stim-1.png).');
    const model = applyAssetMap(buildViewerModel(r), assetMap);
    assert.strictEqual(model.segments[0].initialDom.children[0].attrs.src, 'https://exp.example.org/study/img/stim-1.png', 'an ambiguous URL is not inlined');
  });
  it('only image and media elements contribute src/poster URLs (an iframe\'s src is not an image)', () => {
    const r = hrefOnly(
      [{ id: 2, kind: 'element', tag: 'iframe', attrs: { src: 'https://survey.example.org/form.html' }, children: [] },
        { id: 3, kind: 'element', tag: 'img', attrs: { src: 'https://exp.example.org/a.png' }, children: [] }],
      [{ type: 'dom.attr', t: 1, node: 2, name: 'src', value: 'https://survey.example.org/page2.html' },
        { type: 'dom.attr', t: 2, node: 3, name: 'src', value: 'https://exp.example.org/b.png' }]);
    assert.deepStrictEqual(collectAssetUrls(r).images, ['https://exp.example.org/a.png', 'https://exp.example.org/b.png']);
  });
});

// A recording with no stylesheets, so the note holds only what the DOM
// references.
function domOnly(nodes, events = []) {
  const r = hrefOnly(nodes, events);
  r.stylesheets = [];
  return r;
}
const el = (id, tag, attrs, children = [], extra = {}) => ({ id, kind: 'element', tag, attrs, children, ...extra });
const X = 'https://exp.example.org/study/';

// The viewer never plays media, and media files are never matched: the note
// counts media elements in their own clause instead of as images.
describe('video and audio', () => {
  it('media leaves the image counts; a video\'s poster stays an image and is inlined', async () => {
    const nodes = () => [
      el(2, 'img', { src: X + 'img/a.png' }),
      el(3, 'video', { src: X + 'media/clip.mp4', poster: X + 'img/poster.png' }, [], { media_src: X + 'media/clip.mp4' }),
      el(4, 'audio', {}, [el(5, 'source', { src: X + 'media/tone.mp3', type: 'audio/mpeg' })]),
    ];
    const files = [{ path: 'img/a.png', read: async () => PNG }, { path: 'img/poster.png', read: async () => PNG }];
    const { assetMap, report } = await buildAssetMap([domOnly(nodes())], files);
    assert.deepStrictEqual(report.missing, [], 'media is never offered to the matcher, so never missing');
    const s = assetMatchSummary(domOnly(nodes()), assetMap);
    assert.deepStrictEqual(s.images, { matched: 2, total: 2, missing: [], ambiguous: [] });
    assert.deepStrictEqual(s.media, { total: 2 });
    assert.strictEqual(assetNoteText(s),
      'Experiment assets: 2 of 2 images matched; 2 video/audio elements shown as placeholders; replays never play media.');
    const body = applyAssetMap(buildViewerModel(domOnly(nodes())), assetMap).segments[0].initialDom;
    assert.strictEqual(body.children[1].attrs.poster, 'data:image/png;base64,iVBORw==');
    assert.strictEqual(body.children[1].attrs.src, X + 'media/clip.mp4', 'a video\'s own source is never rewritten');
  });
  it('media alone gives a note of its own, singular for one', () => {
    const s = assetMatchSummary(domOnly([el(2, 'video', { src: X + 'clip.webm' })]), new Map());
    assert.deepStrictEqual(s.images, { matched: 0, total: 0, missing: [], ambiguous: [] });
    assert.strictEqual(assetNoteText(s), 'Experiment assets: 1 video/audio element shown as placeholder; replays never play media.');
  });
  it('counts each element once, and elements playing the same file once', () => {
    const r = domOnly([el(2, 'video', { src: X + 'a.mp4' }, [], { media_src: X + 'a.mp4' }), el(3, 'video', { src: X + 'a.mp4' }), el(4, 'audio', { src: X + 'b.wav' })]);
    assert.deepStrictEqual(collectAssetUrls(r).media, [X + 'a.mp4', X + 'b.wav']);
    assert.strictEqual(assetNoteText(assetMatchSummary(r, new Map())), 'Experiment assets: 2 video/audio elements shown as placeholders; replays never play media.');
  });
  it('a <source> is media under <video> or <audio>, an image under <picture>, and goes by its extension when its parent is unknown', () => {
    const r = domOnly(
      [el(2, 'video', {}, [el(3, 'source', { src: X + 'v.png' })]),
        el(4, 'picture', {}, [el(5, 'source', { src: X + 'p.mp4' }), el(6, 'img', { src: X + 'p.png' })])],
      [{ type: 'dom.add', t: 1, parent: 99, before: null, node: el(7, 'source', { src: X + 'loose.ogg' }) },
        { type: 'dom.add', t: 2, parent: 99, before: null, node: el(8, 'source', { src: X + 'loose.jpg' }) },
        { type: 'dom.add', t: 3, parent: 4, before: null, node: el(9, 'source', { src: X + 'later.png' }) },
        { type: 'dom.add', t: 4, parent: 2, before: null, node: el(10, 'source', { src: X + 'later.jpg' }) },
        { type: 'dom.attr', t: 5, node: 3, name: 'src', value: X + 'swapped.png' },
        { type: 'dom.attr', t: 6, node: 5, name: 'src', value: X + 'swapped.mp4' }]);
    const u = collectAssetUrls(r);
    assert.deepStrictEqual(u.images, [X + 'p.mp4', X + 'p.png', X + 'loose.jpg', X + 'later.png', X + 'swapped.mp4']);
    // One entry per media element: later.jpg and swapped.png are sources of
    // the video already counted by v.png; loose.ogg's parent (99) is one more.
    assert.deepStrictEqual(u.media, [X + 'v.png', X + 'loose.ogg']);
  });
  it('a captured <video> counts once: its relative src and absolute media_src, or its several <source>s, are one element', () => {
    // Capture records the src attribute as written and media_src as the
    // resolved URL the element loaded (currentSrc).
    const r = domOnly([
      el(2, 'video', { src: 'stim.mp4' }, [], { media_src: X + 'stim.mp4' }),
      el(3, 'video', {}, [el(4, 'source', { src: 'clip.mp4', type: 'video/mp4' }), el(5, 'source', { src: 'clip.webm', type: 'video/webm' })]),
      el(6, 'video', { controls: '' }, [el(7, 'source', { src: 'b.mp4' }), el(8, 'source', { src: 'b.webm' })], { media_src: X + 'b.mp4' }),
      el(9, 'audio', {}),
    ], [
      { type: 'dom.attr', t: 1, node: 9, name: 'src', value: 'tone.mp3' },
      { type: 'dom.attr', t: 2, node: 2, name: 'src', value: 'stim-2.mp4' },
      { type: 'dom.add', t: 3, parent: 3, before: null, node: el(10, 'source', { src: 'clip.ogv' }) },
    ]);
    assert.deepStrictEqual(collectAssetUrls(r).media, [X + 'stim.mp4', 'clip.mp4', X + 'b.mp4', 'tone.mp3'],
      'an audio given its src later counts then; a video whose src changes, or gains a source, is still one element');
    assert.strictEqual(assetNoteText(assetMatchSummary(r, new Map())),
      'Experiment assets: 4 video/audio elements shown as placeholders; replays never play media.');
  });
  // Node ids restart at every keyframe: id 3 in one keyframe and id 3 in the
  // next are different elements. A segment without a keyframe continues the
  // last one's ids.
  const keyframes = (...doms) => {
    const r = domOnly([]);
    r.segments = doms.map((d, i) => ({ ...r.segments[0], index: i, initial_dom: d.dom === undefined ? d : d.dom, events: d.events || [] }));
    return r;
  };
  const body = (...kids) => el(1, 'body', {}, kids);
  it('elements sharing an id in different keyframes are different elements', () => {
    const count = (r) => assetMatchSummary(r, new Map()).media.total;
    assert.strictEqual(count(keyframes(body(el(3, 'video', { src: 'a.mp4' })), body(el(3, 'video', { src: 'b.mp4' })))), 2, 'two trials, two files');
    assert.strictEqual(count(keyframes(body(el(3, 'video', { src: 'a.mp4' })), body(el(3, 'video', { src: 'a.mp4' })))), 1, 'a video kept across keyframes counts once');
    assert.strictEqual(count(keyframes(body(el(3, 'video', { src: 'a.mp4' })), body(el(3, 'audio', { src: 'b.mp3' })))), 2, 'a video, then an audio with the same id');
    assert.strictEqual(count(keyframes(
      body(el(3, 'video', {}, [el(4, 'source', { src: 'a.mp4' })])),
      { dom: null, events: [{ type: 'dom.add', t: 1, parent: 3, before: null, node: el(5, 'source', { src: 'a.webm' }) }] })), 1,
    'a segment without a keyframe continues the same elements');
  });
  it('one element kept across keyframes counts once when only a later keyframe has its media_src', () => {
    // media_src is the element's currentSrc, empty when the keyframe is taken
    // in the task that inserts the element and set at the next one.
    const source = () => el(3, 'video', {}, [el(4, 'source', { src: 'clip.mp4' })]);
    const r = keyframes(body(source()), body({ ...source(), media_src: X + 'clip.mp4' }));
    assert.deepStrictEqual(collectAssetUrls(r).media, [X + 'clip.mp4']);
    assert.strictEqual(assetNoteText(assetMatchSummary(r, new Map())),
      'Experiment assets: 1 video/audio element shown as placeholder; replays never play media.');
    // The same with the src attribute, and with the element's src changed in
    // the first span before the second keyframe resolves it.
    const viaSrc = keyframes(
      { dom: body(el(3, 'video', { src: 'a.mp4' })), events: [{ type: 'dom.attr', t: 1, node: 3, name: 'src', value: 'b.mp4' }] },
      body(el(3, 'video', { src: 'b.mp4' }, [], { media_src: X + 'b.mp4' })));
    assert.deepStrictEqual(collectAssetUrls(viaSrc).media, [X + 'b.mp4']);
  });
  it('an <img> pointing at a media extension is still an image; MEDIA extensions decide only for a parentless <source>', () => {
    const u = collectAssetUrls(domOnly([el(2, 'img', { src: X + 'odd.mp4' })]));
    assert.deepStrictEqual(u.images, [X + 'odd.mp4']);
    assert.deepStrictEqual(u.media, []);
  });
});

// Three more ways a page shows an image: a srcset candidate list (on <img>
// and on a <picture>'s <source>), an SVG <image>'s href or xlink:href, and an
// <input type="image">. Recorded as written (only an <img>'s src is
// resolved at capture), so relative URLs match by their path.
describe('srcset, SVG <image> and <input type="image">', () => {
  const files = [{ path: 'img/a.png', read: async () => PNG }, { path: 'img/c.png', read: async () => PNG }];
  const D = 'data:image/png;base64,iVBORw==';
  it('collects every srcset candidate, with density or width descriptors, with or without a space after the comma', () => {
    const u = collectAssetUrls(domOnly([
      el(2, 'img', { src: X + 'img/a.png', srcset: 'img/a.png 1x, img/b.png 2x' }),
      el(3, 'picture', {}, [el(4, 'source', { srcset: 'img/c.png 480w, img/d.png 800w', media: '(min-width: 600px)' }), el(5, 'img', { src: X + 'img/e.png' })]),
      el(6, 'img', { srcset: 'img/f.png 1x,img/g.png 2x' }),
      el(7, 'img', { srcset: '  img/h.png,  img/i.png 1.5x ,' }),
    ]));
    assert.deepStrictEqual(u.images, [X + 'img/a.png', 'img/a.png', 'img/b.png', 'img/c.png', 'img/d.png', X + 'img/e.png',
      'img/f.png', 'img/g.png', 'img/h.png', 'img/i.png']);
  });
  it('inlines each supplied candidate and leaves the rest of the srcset exactly as written', async () => {
    const nodes = () => [el(2, 'img', { srcset: 'img/a.png 1x, img/b.png 2x' }), el(3, 'img', { srcset: 'img/b.png 480w,img/c.png  800w' })];
    const { assetMap } = await buildAssetMap([domOnly(nodes())], files);
    assert.strictEqual(assetNoteText(assetMatchSummary(domOnly(nodes()), assetMap)), 'Experiment assets: 2 of 3 images matched (missing: b.png).');
    const body = applyAssetMap(buildViewerModel(domOnly(nodes())), assetMap).segments[0].initialDom;
    assert.strictEqual(body.children[0].attrs.srcset, D + ' 1x, img/b.png 2x');
    assert.strictEqual(body.children[1].attrs.srcset, 'img/b.png 480w,' + D + '  800w');
    assert.deepStrictEqual(collectAssetUrls(domOnly([body.children[0]])).images, ['img/b.png'], 'the rewritten srcset still parses: a data: URI\'s comma is inside its candidate');
  });
  it('a <source> under <video> has no images in its srcset', () => {
    const u = collectAssetUrls(domOnly([el(2, 'video', {}, [el(3, 'source', { srcset: 'img/a.png 1x' })])]));
    assert.deepStrictEqual(u.images, []);
  });
  it('collects and inlines an SVG <image>\'s href and xlink:href, and an <input type="image">\'s src', async () => {
    const nodes = () => [
      el(2, 'svg', {}, [el(3, 'image', { href: 'img/a.png', width: '10' }), el(4, 'image', { 'xlink:href': 'img/c.png' })]),
      el(5, 'a', { href: 'img/a.png' }),
      el(6, 'input', { type: 'IMAGE', src: X + 'img/a.png', alt: 'go' }),
      el(7, 'input', { type: 'text', src: X + 'img/z.png' }),
    ];
    const u = collectAssetUrls(domOnly(nodes()));
    assert.deepStrictEqual(u.images, ['img/a.png', 'img/c.png', X + 'img/a.png'], 'a link\'s href and a text input\'s src are not images');
    const { assetMap } = await buildAssetMap([domOnly(nodes())], files);
    assert.strictEqual(assetNoteText(assetMatchSummary(domOnly(nodes()), assetMap)), 'Experiment assets: 3 of 3 images matched.');
    const body = applyAssetMap(buildViewerModel(domOnly(nodes())), assetMap).segments[0].initialDom;
    assert.strictEqual(body.children[0].children[0].attrs.href, D);
    assert.strictEqual(body.children[0].children[1].attrs['xlink:href'], D);
    assert.strictEqual(body.children[1].attrs.href, 'img/a.png');
    assert.strictEqual(body.children[2].attrs.src, D);
  });
  it('an input that becomes an image button shows the src it already has: collected and inlined there', async () => {
    const kf = () => domOnly([el(5, 'input', { type: 'text', src: 'img/a.png' })],
      [{ type: 'dom.attr', t: 1, node: 5, name: 'type', value: 'image' }]);
    assert.deepStrictEqual(collectAssetUrls(kf()).images, ['img/a.png']);
    const { assetMap } = await buildAssetMap([kf()], files);
    assert.strictEqual(assetNoteText(assetMatchSummary(kf(), assetMap)), 'Experiment assets: 1 of 1 images matched.');
    assert.strictEqual(applyAssetMap(buildViewerModel(kf()), assetMap).segments[0].initialDom.children[0].attrs.src, D);
    // The src a dom.attr set while it was a text field is rewritten in that event.
    const ev = () => domOnly([el(5, 'input', { type: 'text' })],
      [{ type: 'dom.attr', t: 1, node: 5, name: 'src', value: 'img/c.png' },
        { type: 'dom.attr', t: 2, node: 5, name: 'type', value: 'image' }]);
    const m = applyAssetMap(buildViewerModel(ev()), (await buildAssetMap([ev()], files)).assetMap);
    assert.deepStrictEqual(m.segments[0].events.map((e) => e.value), [D, 'image']);
  });

  it('follows a dom.attr that sets a srcset, an href or an image input\'s src later in the session', async () => {
    const rec = () => domOnly(
      [el(2, 'img', { src: X + 'img/x.png' }), el(3, 'svg', {}, [el(4, 'image', {})]), el(5, 'input', { type: 'text' })],
      [{ type: 'dom.attr', t: 1, node: 2, name: 'srcset', value: 'img/a.png 1x, img/b.png 2x' },
        { type: 'dom.attr', t: 2, node: 4, name: 'xlink:href', value: 'img/c.png' },
        { type: 'dom.attr', t: 3, node: 5, name: 'src', value: 'img/n.png' },
        { type: 'dom.attr', t: 4, node: 5, name: 'type', value: 'image' },
        { type: 'dom.attr', t: 5, node: 5, name: 'src', value: 'img/a.png' },
        { type: 'dom.add', t: 6, parent: 1, before: null, node: el(6, 'picture', {}, [el(7, 'source', { srcset: 'img/c.png 2x' })]) }]);
    assert.deepStrictEqual(collectAssetUrls(rec()).images, [X + 'img/x.png', 'img/a.png', 'img/b.png', 'img/c.png', 'img/n.png'],
      'a src set while the input was a text field becomes an image when the type does');
    const { assetMap } = await buildAssetMap([rec()], files);
    const events = applyAssetMap(buildViewerModel(rec()), assetMap).segments[0].events;
    assert.deepStrictEqual(events.map((e) => (e.type === 'dom.attr' ? e.value : e.node.children[0].attrs.srcset)),
      [D + ' 1x, img/b.png 2x', D, 'img/n.png', 'image', D, D + ' 2x']);
  });
});

// The analyze page words its replay card's note in the worker
// (demo/analyze/worker-entry.js: assetNoteText(assetMatchSummary(...)) through
// the page bundle's entry, before the report pass); the CLI words the
// report's replay section inside buildReplayAssets. The two must agree.
describe('the analyze page and the CLI word the note the same', () => {
  it('for a recording with stylesheets, images in every form, and media', async () => {
    const entry = await import('../../src/cli/preview-entry.js');
    const { buildReplayAssets } = await import('../../src/cli/renderers/replay-assets-core.js');
    const files = [
      { path: 'study/css/style.css', read: async () => bytes('p{margin:0}') },
      { path: 'study/img/stim-1.png', read: async () => PNG },
    ];
    // srcset, an SVG <image> and an image input count among the images.
    const rec = () => {
      const r = recording();
      r.segments[0].initial_dom.children.push(
        el(20, 'img', { srcset: 'img/stim-1.png 1x, img/stim-1@2x.png 2x' }),
        el(21, 'svg', {}, [el(22, 'image', { 'xlink:href': 'img/shape.png' })]),
        el(23, 'input', { type: 'image', src: X + 'img/go.png' }));
      return r;
    };
    const { assetMap } = await entry.buildAssetMap([rec()], files);
    const page = entry.assetNoteText(entry.assetMatchSummary(rec(), assetMap));
    const p = { participantId: 'P1', replay: { recording: rec(), file: 'P1-replay.json' } };
    buildReplayAssets([p], { sink: () => {}, assetMap });
    assert.strictEqual(p.replay.assetNote, page);
    assert.strictEqual(page, 'Experiment assets: 1 of 2 stylesheets matched (missing: fonts.css); 2 of 9 images matched (missing: bg.png, poster.jpg, stim-1@2x.png, shape.png, go.png, stim-2.png, stim-3.png); 1 video/audio element shown as placeholder; replays never play media.');
  });
});

// Experiments built on a case-insensitive file system often reference
// card_a.png while the file is Card_A.png.
describe('case-blind fallback', () => {
  const a = 'https://h/study/img/a.png';
  it('an exact match wins over a case-folded one, even a better-ranked one', () => {
    const r = matchAssets([a], ['IMG/A.png', 'img/a.png']);
    assert.strictEqual(r.matched.get(a), 'img/a.png');
    assert.deepStrictEqual(r.ambiguous, []);
    assert.strictEqual(matchAssets([a], ['IMG/A.png', 'x/a.png']).matched.get(a), 'x/a.png', 'exact filename over case-folded whole path');
  });
  it('a file differing only in case matches when it is the only candidate, under its own spelling', () => {
    const url = 'https://h/study/img/card_a.png';
    const r = matchAssets([url], ['exp/img/Card_A.png', 'exp/img/card_b.png']);
    assert.strictEqual(r.matched.get(url), 'exp/img/Card_A.png');
    assert.deepStrictEqual(r.missing, []);
  });
  it('two case variants and no exact file are ambiguous, never a guess', () => {
    const r = matchAssets([a], ['Img/A.png', 'img/A.PNG']);
    assert.deepStrictEqual(r.matched, new Map());
    assert.deepStrictEqual(r.ambiguous, [{ url: a, candidates: ['Img/A.png', 'img/A.PNG'] }]);
  });
  it('ranks case-folded candidates as exact ones: a whole-path suffix beats a longer path with the same tail', () => {
    assert.strictEqual(matchAssets([a], ['lib/Img/a.PNG', 'IMG/A.PNG']).matched.get(a), 'IMG/A.PNG');
  });
  it('nothing matching in any case is missing', () => {
    const r = matchAssets([a], ['img/b.png', 'A.gif']);
    assert.deepStrictEqual(r.missing, [a]);
    assert.deepStrictEqual(r.ambiguous, []);
  });
  it('a font a supplied stylesheet references matches case-blind and is inlined', async () => {
    const files = [
      { path: 'study/css/style.css', read: async () => bytes(STYLE) },
      { path: 'study/css/Fonts/A.WOFF2', read: async () => WOFF },
    ];
    const { assetMap, report } = await buildAssetMap([hrefOnly()], files);
    assert.deepStrictEqual(report.matched.map((m) => m.path), ['study/css/style.css', 'study/css/Fonts/A.WOFF2']);
    const model = applyAssetMap(buildViewerModel(hrefOnly()), assetMap);
    assert.match(model.stylesheets[0].css, /src:url\("data:font\/woff2;base64,d09GMg=="\)/);
  });
});

describe('CLI assetsDir', () => {
  it('inlines a matched stylesheet into replay/*.replay.js and notes it in index.html', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    process.env.NO_UPDATE_NOTIFIER = '1';
    const tmp = mkdtempSync(join(tmpdir(), 'ch-assets-'));
    try {
      const data = join(tmp, 'data'); mkdirSync(data);
      cpSync('tests/fixtures/demo/DEMO-FIXT.json', join(data, 'DEMO-FIXT.json'));
      // The demo recording inlined its one sheet; make it href-only so there is something to match.
      const rec = JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT-replay-1785352263344.json', 'utf8'));
      rec.stylesheets[0].css = null;
      writeFileSync(join(data, 'DEMO-FIXT-replay-1785352263344.json'), JSON.stringify(rec));
      mkdirSync(join(tmp, 'exp')); writeFileSync(join(tmp, 'exp', 'demo.css'), 'body{outline:1px solid lime}');
      writeFileSync(join(tmp, 'config.json'), JSON.stringify({ dataDir: data, filePattern: 'DEMO-*.json', participantIdField: 'participantId', assetsDir: join(tmp, 'exp') }));
      const { run } = await import('../../src/cli/report.js');
      const origLog = console.log; console.log = () => {};
      try { await run(['report', '--config', join(tmp, 'config.json'), '--output', join(tmp, 'out'), '--no-visuals']); }
      finally { console.log = origLog; }
      const asset = readFileSync(join(tmp, 'out', 'replay', 'DEMO-FIXT.replay.js'), 'utf8');
      assert.ok(asset.includes('body{outline:1px solid lime}'), 'sheet text inlined into the model');
      const index = readFileSync(join(tmp, 'out', 'index.html'), 'utf8');
      assert.ok(index.includes('Experiment assets: 1 of 1 stylesheets matched.'));
      assert.ok(!index.includes('also fetch'), 'nothing left to fetch');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  it('a recording with fields of the wrong shape, which the viewer keeps, still gets its report and replay', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    process.env.NO_UPDATE_NOTIFIER = '1';
    const tmp = mkdtempSync(join(tmpdir(), 'ch-assets-'));
    try {
      const data = join(tmp, 'data'); mkdirSync(data);
      cpSync('tests/fixtures/demo/DEMO-FIXT.json', join(data, 'DEMO-FIXT.json'));
      const rec = JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT-replay-1785352263344.json', 'utf8'));
      rec.stylesheets = {};
      rec.segments[0].initial_dom.children = {};
      writeFileSync(join(data, 'DEMO-FIXT-replay-1785352263344.json'), JSON.stringify(rec));
      mkdirSync(join(tmp, 'exp')); writeFileSync(join(tmp, 'exp', 'demo.css'), 'body{outline:1px solid lime}');
      writeFileSync(join(tmp, 'config.json'), JSON.stringify({ dataDir: data, filePattern: 'DEMO-*.json', participantIdField: 'participantId', assetsDir: join(tmp, 'exp') }));
      const { run } = await import('../../src/cli/report.js');
      const origLog = console.log; console.log = () => {};
      try { await run(['report', '--config', join(tmp, 'config.json'), '--output', join(tmp, 'out'), '--no-visuals']); }
      finally { console.log = origLog; }
      assert.ok(existsSync(join(tmp, 'out', 'replay', 'DEMO-FIXT.replay.js')));
      assert.ok(readFileSync(join(tmp, 'out', 'index.html'), 'utf8').includes('DEMO-FIXT'));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});

// Ingest admits any JSON with schema_version 2, recorder.name and a segments
// array, and the viewer's tolerant loader keeps fields of the wrong shape. One
// such recording must not stop the cohort's report.
describe('recordings with malformed fields', () => {
  const files = [
    { path: 'study/img/stim-1.png', read: async () => PNG },
    { path: 'study/css/style.css', read: async () => bytes('p{margin:0}') },
  ];
  const STIM = 'https://exp.example.org/study/img/stim-1.png';
  const cases = {
    'stylesheets: {}': (r) => { r.stylesheets = {}; },
    'stylesheet_events: [null, 5, {}]': (r) => { r.stylesheet_events = [null, 5, {}]; },
    'initial_dom.children: {}': (r) => { r.segments[0].initial_dom.children[1].children = {}; },
    'a node\'s children: 5': (r) => { r.segments[0].initial_dom.children[0].children = 5; },
    'events: [null, 7, a dom.add without a node]': (r) => { r.segments[0].events.unshift(null, 7, { type: 'dom.add', t: 1, parent: 1, before: null, node: null }); },
    'a segment\'s events: {}': (r) => { r.segments.push({ index: 1, label: null, t_load: 5, t_end: 6, initial_dom: null, events: {} }); },
    'segments: [null, ...]': (r) => { r.segments.unshift(null); },
    'attrs: "src"': (r) => { r.segments[0].initial_dom.children[3].attrs = 'src'; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    it(`${name}: every entry point goes on, and the rest still matches`, async () => {
      const r = recording(); mutate(r);
      assert.ok(collectAssetUrls(r).images.includes(STIM));
      const { assetMap, report } = await buildAssetMap([r], files);
      assert.ok(report.matched.some((m) => m.url === STIM));
      assert.strictEqual(assetMatchSummary(r, assetMap).images.matched >= 1, true);
      let model;
      try { model = buildViewerModel(JSON.parse(JSON.stringify(r))); } catch { return; }   // the viewer refuses it: nothing to apply
      applyAssetMap(model, assetMap);
      assert.strictEqual(model.segments.find((s) => s && s.initialDom).initialDom.children[0].attrs.src, 'data:image/png;base64,iVBORw==');
    });
  }

  it('buildAssetMap keeps going past a recording it cannot read, and says which', async () => {
    const bad = recording();
    bad.participant_id = 'P-BAD';
    Object.defineProperty(bad, 'segments', { get() { throw new Error('unreadable'); } });
    const { assetMap, report } = await buildAssetMap([bad, recording()], files);
    assert.ok(assetMap.get(STIM) && assetMap.get(STIM).bytes, 'the other recording still matched');
    assert.strictEqual(report.warnings.length, 1);
    assert.match(report.warnings[0], /P-BAD/);
    assert.match(report.warnings[0], /unreadable/);
    const clean = await buildAssetMap([recording()], files);
    assert.deepStrictEqual(clean.report.warnings, []);
  });

  it('a participant whose asset note fails keeps its replay; the others keep their notes', async () => {
    const { buildReplayAssets } = await import('../../src/cli/renderers/replay-assets-core.js');
    const { assetMap } = await buildAssetMap([recording()], files);
    // A map that cannot answer for one URL only P-ODD references.
    const ODD = 'https://exp.example.org/study/img/odd.png';
    const picky = new Map(assetMap);
    picky.get = function (url) { if (url === ODD) throw new Error('lookup failed'); return Map.prototype.get.call(this, url); };
    picky.has = function (url) { if (url === ODD) throw new Error('lookup failed'); return Map.prototype.has.call(this, url); };
    const odd = recording();
    odd.segments[0].initial_dom.children.push({ id: 30, kind: 'element', tag: 'img', attrs: { src: ODD }, children: [] });
    const ps = [
      { participantId: 'P-ODD', replay: { recording: odd, file: 'odd.json' } },
      { participantId: 'P-OK', replay: { recording: recording(), file: 'ok.json' } },
    ];
    const written = [];
    const res = buildReplayAssets(ps, { sink: (path) => written.push(path), assetMap: picky });
    assert.strictEqual(res.count, 2, 'both replays are written');
    assert.deepStrictEqual(written, ['replay/P-ODD.replay.js', 'replay/P-OK.replay.js']);
    assert.strictEqual(ps[0].replay.assetNote, null);
    assert.match(ps[1].replay.assetNote, /^Experiment assets: /);
    assert.deepStrictEqual(res.assetErrors.map((e) => e.participantId), ['P-ODD']);
    assert.match(res.assetErrors[0].reason, /lookup failed/);
  });
});
