// The offline single file: the same page with the bundle inlined and a policy
// without 'self' (nothing is loaded by URL any more). Built from the real
// index.html so a drifted marker fails here, not silently on a release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOfflineHtml, OFFLINE_NAME } from '../../tools/offline-analyze.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const index = readFileSync(join(ROOT, 'demo', 'analyze', 'index.html'), 'utf8');
// A closing tag inside a string: inlineSafeSrc must neutralise it.
const bundle = 'console.log("a</script>b"); var cafe = "café";';

function policyOf(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(m, 'the page declares its policy in a meta tag');
  return m[1];
}

test('inlines the bundle and drops self from the policy', () => {
  const out = buildOfflineHtml(index, bundle);
  assert.equal(out.includes('src="./analyze.bundle.js"'), false);
  assert.ok(out.includes('<script type="module">console.log("a<\\/script>b");'));
  assert.ok(out.includes("script-src 'unsafe-inline' blob:;"));
  assert.ok(out.includes('img-src blob: data:;'));
  assert.equal(out.includes("'self'"), false);
  // The top bar's link to this very file says where the reader is instead.
  assert.ok(out.includes('<a href="https://github.com/cyborg-hunter/cyborg-hunter#readme">GitHub</a><span>You are using the offline file.</span>'));
  assert.equal(out.includes('href="../"'), false);
  assert.ok(out.includes('href="https://cyborg-hunter.github.io/cyborg-hunter/">live demo</a>'));
  assert.equal(OFFLINE_NAME, 'cyborg-hunter-analyze.html');
});

test('keeps every other directive of the page policy unchanged', () => {
  const out = buildOfflineHtml(index, bundle);
  assert.equal(policyOf(out),
    "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src blob: data:; " +
    "font-src data:; frame-src blob:; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'");
});

test('declares the charset before the inlined script', () => {
  // The bundle carries non-ASCII text; a file opened from disk has no HTTP
  // header to name its encoding, so the meta tag must come first.
  const out = buildOfflineHtml(index, bundle);
  const charset = out.indexOf('<meta charset="utf-8">');
  assert.ok(charset >= 0 && charset < 1024, 'charset meta within the first 1024 bytes');
  assert.ok(charset < out.indexOf('<script'), 'charset meta before any script');
});

test('no closing script tag inside the inlined script', () => {
  const out = buildOfflineHtml(index, bundle);
  const open = '<script type="module">';
  const start = out.indexOf(open) + open.length;
  const end = out.indexOf('</script>', start);
  assert.ok(start >= open.length && end > start);
  assert.equal(/<\/script/i.test(out.slice(start, end)), false);
  assert.equal(out.slice(end + '</script>'.length).includes('<script'), false, 'one script only');
});

test('loads nothing by URL: no src attribute, links only to data: or absolute navigation', () => {
  const out = buildOfflineHtml(index, bundle);
  assert.equal(/\ssrc\s*=/i.test(out.replace(/<script type="module">[\s\S]*?<\/script>/, '')), false);
  for (const tag of out.match(/<link\b[^>]*>/gi) || []) {
    assert.match(tag, /href="data:/, 'a <link> may only carry a data: URL: ' + tag);
  }
  // Anchors are navigation, not loads; a relative one would point at nothing
  // once the file is saved to disk, so each must be absolute https.
  for (const href of out.match(/<a\b[^>]*\shref="[^"]*"/gi) || []) {
    assert.match(href, /href="https:\/\//, 'anchor not absolute: ' + href);
  }
});

test('refuses a bundle that could swallow its own closing tag', () => {
  assert.throws(() => buildOfflineHtml(index, '/* <!-- */ var s = "<script>";'), /inlined safely/);
});

test('refuses an index.html without the markers it rewrites', () => {
  assert.throws(() => buildOfflineHtml('<html><head></head></html>', bundle), /marker/);
});

// Each marker on its own: the real index.html with only that one missing.
for (const marker of [
  '<meta charset="utf-8">',
  '<script type="module" src="./analyze.bundle.js"></script>',
  "script-src 'self' 'unsafe-inline' blob:;",
  '<a href="./' + OFFLINE_NAME + '" download>offline version</a>',
  '<a href="../">live demo</a>',
]) {
  test('refuses an index.html without ' + marker, () => {
    assert.ok(index.includes(marker), 'the real index.html has it');
    assert.throws(() => buildOfflineHtml(index.replace(marker, ''), bundle),
      (e) => e.message.includes('marker not found') && e.message.includes(marker));
  });
}

test('refuses an index.html whose charset no longer precedes the script', () => {
  const moved = index.replace('<meta charset="utf-8">\n', '').replace('</body>', '<meta charset="utf-8">\n</body>');
  assert.throws(() => buildOfflineHtml(moved, bundle), /charset/);
});
