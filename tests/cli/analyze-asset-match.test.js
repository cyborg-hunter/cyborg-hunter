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
      'https://exp.example.org/study/clip.webm',
      'https://exp.example.org/study/img/stim-2.png',
      'https://exp.example.org/study/img/stim-3.png',
    ], 'an inline data: image is not an asset');
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
    assert.strictEqual(s.images.total, 6);
    assert.strictEqual(s.images.matched, 2);
    assert.strictEqual(assetNoteText(s), 'Experiment assets: 1 of 2 stylesheets matched (missing: fonts.css); 2 of 6 images matched (missing: poster.jpg, clip.webm, stim-2.png, stim-3.png).');
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
});
