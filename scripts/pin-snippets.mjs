#!/usr/bin/env node
// Pin the documented CDN snippets to this release.
//
// Researchers copy <script src="https://unpkg.com/cyborg-hunter/dist/…"> tags
// straight from README.md and docs/*.md. This script rewrites every such tag
// to name the exact version in package.json and to carry the Subresource
// Integrity hash of its file, `integrity="sha384-…" crossorigin="anonymous"`,
// so a study keeps loading the bytes it was tested with. Other attributes on
// the tag (data-*, nonce…) keep their values and order; integrity and
// crossorigin always come right after src. Bare URL mentions in prose and
// backticks get the version only. docs/plans/ and other subdirectories are
// not read; the bare package URL (no /dist/) is left as written.
//
// The hashes are computed from dist/, which this script does not build. They
// match the file unpkg serves for <version> only when dist/ was built from
// the release commit itself, the same dist/ that `npm publish` uploads. So
// the release order is: bump the version, `node build.js`, `npm run
// pin:snippets`, commit, publish that dist/. Between releases the source
// moves on and a fresh build hashes differently, which is why the test suite
// runs the check with --no-hash (pins and attributes only).
//
// Usage: node scripts/pin-snippets.mjs [--check] [--no-hash] [--root DIR] [--dist DIR]
//   --check    change nothing; list each offending line and exit 1 if any
//   --no-hash  with --check: do not compare hashes against dist/
//   --root     the repo root (default: this script's repo)
//   --dist     the built files (default: <root>/dist)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// Any unpkg URL into the package's dist/, pinned or not. Group 1 is the
// "@version" part, if any.
const URL_RE = /https:\/\/unpkg\.com\/cyborg-hunter(@[^/\s"'`<>()]*)?\/dist\//g;
// An opening <script> tag (it may span lines).
const TAG_RE = /<script\b[^>]*>/g;
// The tag's src when it points into the package's dist/. Group 1 is the
// whitespace before src, group 2 the file name.
const SRC_RE = /(\s)src="https:\/\/unpkg\.com\/cyborg-hunter(?:@[^/"]*)?\/dist\/([^"/]+)"/;
// An integrity or crossorigin attribute with the whitespace before it.
const SRI_ATTR_RE = /\s+(?:integrity|crossorigin)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=[\s/>])/g;
const SHA384_RE = /^sha384-[A-Za-z0-9+/]{64}$/;

export const cdnBase = (version) => `https://unpkg.com/cyborg-hunter@${version}/dist/`;

export const sri = (bytes) => 'sha384-' + createHash('sha384').update(bytes).digest('base64');

// The tag in pinned form: src at <version>, then integrity and crossorigin,
// then the tag's other attributes as they were. Tags that do not load from
// the package's dist/ come back unchanged.
export function pinTag(tag, version, sriFor) {
  const m = SRC_RE.exec(tag);
  if (!m) return tag;
  const file = m[2];
  return tag
    .replace(SRI_ATTR_RE, '')
    .replace(SRC_RE, (_, space) =>
      `${space}src="${cdnBase(version)}${file}" integrity="${sriFor(file)}" crossorigin="anonymous"`);
}

// The markdown with every snippet pinned. sriFor(file) gives a dist file's hash.
export function pinMarkdown(text, version, sriFor) {
  return text
    .replace(TAG_RE, (tag) => pinTag(tag, version, sriFor))
    .replace(URL_RE, cdnBase(version));
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

// The problems in one markdown file, as { line, reason }. sriFor is null
// under --no-hash; otherwise it returns a dist file's hash, or null when the
// file is missing.
export function checkMarkdown(text, version, sriFor) {
  const problems = [];
  for (const m of text.matchAll(URL_RE)) {
    if (m[1] === '@' + version) continue;
    problems.push({
      line: lineAt(text, m.index),
      reason: m[1] ? `pinned to ${m[1]}, not @${version}` : `not pinned to @${version}`
    });
  }
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[0];
    const src = SRC_RE.exec(tag);
    if (!src) continue;
    const file = src[2];
    const line = lineAt(text, m.index);
    const integrity = /\sintegrity="([^"]*)"/.exec(tag);
    if (!integrity) { problems.push({ line, reason: 'script tag has no integrity attribute' }); continue; }
    if (!SHA384_RE.test(integrity[1])) { problems.push({ line, reason: 'integrity is not a sha384 hash' }); continue; }
    if (sriFor) {
      const want = sriFor(file);
      if (want === null) { problems.push({ line, reason: `dist/${file} not found: run node build.js first (or pass --no-hash)` }); continue; }
      if (want !== integrity[1]) { problems.push({ line, reason: `integrity does not match dist/${file}` }); continue; }
    }
    // The hash is right: the tag must also be in the exact form the rewrite
    // produces (crossorigin present, no duplicates, right after src). A wrong
    // version is reported by the URL loop above, so it is set aside here.
    if (pinTag(tag, version, () => integrity[1]) !== tag.replace(URL_RE, cdnBase(version))) {
      problems.push({ line, reason: 'script tag not in pinned form (integrity and crossorigin="anonymous" right after src)' });
    }
  }
  return problems.sort((a, b) => a.line - b.line);
}

// README.md and docs/*.md (top level only, so docs/plans/ is never read).
export function snippetFiles(root) {
  const docs = existsSync(join(root, 'docs'))
    ? readdirSync(join(root, 'docs'), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => 'docs/' + e.name)
      .sort()
    : [];
  return ['README.md', ...docs].filter((p) => existsSync(join(root, p)));
}

// sriFor over a dist directory: each file is read and hashed once; a missing
// file gives null.
function distHashes(dist) {
  const cache = new Map();
  return (file) => {
    if (!cache.has(file)) {
      const p = join(dist, file);
      cache.set(file, existsSync(p) ? sri(readFileSync(p)) : null);
    }
    return cache.get(file);
  };
}

function option(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const root = option(args, '--root') || REPO;
  const dist = option(args, '--dist') || join(root, 'dist');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const hashes = distHashes(dist);
  const files = snippetFiles(root);

  if (check) {
    const sriFor = args.includes('--no-hash') ? null : hashes;
    let count = 0;
    for (const p of files) {
      for (const { line, reason } of checkMarkdown(readFileSync(join(root, p), 'utf8'), version, sriFor)) {
        console.error(`${p}:${line}: ${reason}`);
        count += 1;
      }
    }
    if (count) {
      console.error(`${count} snippet problem(s); run npm run pin:snippets after node build.js`);
      process.exit(1);
    }
    console.log(`snippets pinned to @${version}`);
    return;
  }

  // Rewrite in memory first, so a missing dist file leaves every doc as it was.
  const missing = new Set();
  const sriFor = (file) => {
    const h = hashes(file);
    if (h === null) { missing.add(file); return ''; }
    return h;
  };
  const changed = [];
  for (const p of files) {
    const before = readFileSync(join(root, p), 'utf8');
    const after = pinMarkdown(before, version, sriFor);
    if (after !== before) changed.push([p, after]);
  }
  if (missing.size) {
    for (const file of missing) console.error(`dist/${file} not found in ${dist}: run node build.js first`);
    process.exit(1);
  }
  for (const [p, text] of changed) {
    writeFileSync(join(root, p), text);
    console.log(`pinned ${p}`);
  }
  if (!changed.length) console.log(`snippets already pinned to @${version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
