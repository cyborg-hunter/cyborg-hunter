// scripts/pin-snippets.mjs pins every documented unpkg URL to the package's
// version and gives every unpkg <script> tag the Subresource Integrity hash
// of its dist/ file. Each case runs the real script on a throwaway root
// (package.json, dist/, README.md, docs/) so the project's own docs and
// dist/ are never touched.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'pin-snippets.mjs');

const sri = (text) => 'sha384-' + createHash('sha384').update(text).digest('base64');

const CH = 'console.log("ch");\n';
const QUALTRICS = 'console.log("qualtrics");\n';

const README = [
  '<script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>',
  '<script src="https://unpkg.com/cyborg-hunter@0.9.0/dist/ch-qualtrics.js" data-participant-id="${e://Field/ResponseID}" data-debug></script>',
  '<script src="jspsych/jspsych.js"></script>',
  '<script src="https://cdn.example.org/other.js" integrity="sha384-abc" crossorigin="anonymous"></script>',
  'Pin a version: `https://unpkg.com/cyborg-hunter/dist/...`.',
  'Never the bare package URL `https://unpkg.com/cyborg-hunter`.',
  ''
].join('\n');

const DOC = [
  '1. Paste:',
  '',
  '   ```html',
  '   <script crossorigin="anonymous" src="https://unpkg.com/cyborg-hunter/dist/ch.js" integrity="sha384-old" data-replay="dom"></script>',
  '   ```',
  ''
].join('\n');

const PLAN = '<script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>\n';

const PINNED_README = [
  `<script src="https://unpkg.com/cyborg-hunter@1.2.3/dist/ch.js" integrity="${sri(CH)}" crossorigin="anonymous"></script>`,
  `<script src="https://unpkg.com/cyborg-hunter@1.2.3/dist/ch-qualtrics.js" integrity="${sri(QUALTRICS)}" crossorigin="anonymous" data-participant-id="\${e://Field/ResponseID}" data-debug></script>`,
  '<script src="jspsych/jspsych.js"></script>',
  '<script src="https://cdn.example.org/other.js" integrity="sha384-abc" crossorigin="anonymous"></script>',
  'Pin a version: `https://unpkg.com/cyborg-hunter@1.2.3/dist/...`.',
  'Never the bare package URL `https://unpkg.com/cyborg-hunter`.',
  ''
].join('\n');

const PINNED_DOC = [
  '1. Paste:',
  '',
  '   ```html',
  `   <script src="https://unpkg.com/cyborg-hunter@1.2.3/dist/ch.js" integrity="${sri(CH)}" crossorigin="anonymous" data-replay="dom"></script>`,
  '   ```',
  ''
].join('\n');

// A fresh root holding the fixture files; returns its path.
function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ch-pin-'));
  const all = Object.assign({
    'package.json': JSON.stringify({ name: 'cyborg-hunter', version: '1.2.3' }),
    'dist/ch.js': CH,
    'dist/ch-qualtrics.js': QUALTRICS,
    'README.md': README,
    'docs/guide.md': DOC,
    'docs/plans/plan.md': PLAN
  }, files);
  for (const [p, text] of Object.entries(all)) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

const run = (root, ...args) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
const read = (root, p) => readFileSync(join(root, p), 'utf8');

describe('pin-snippets: rewriting', () => {
  it('pins unpkg tags and URLs with the dist file hashes, leaving other tags and docs/plans/ alone', () => {
    const root = fixture();
    try {
      const r = run(root);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(read(root, 'README.md'), PINNED_README);
      assert.strictEqual(read(root, 'docs/guide.md'), PINNED_DOC);
      assert.strictEqual(read(root, 'docs/plans/plan.md'), PLAN);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('is idempotent: a second run changes nothing', () => {
    const root = fixture();
    try {
      assert.strictEqual(run(root).status, 0);
      const r = run(root);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(read(root, 'README.md'), PINNED_README);
      assert.strictEqual(read(root, 'docs/guide.md'), PINNED_DOC);
      assert.match(r.stdout, /already pinned/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('writes nothing and fails when a referenced dist file is missing', () => {
    const root = fixture({ 'dist/ch-qualtrics.js': null });
    try {
      const r = run(root);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /dist\/ch-qualtrics\.js/);
      assert.strictEqual(read(root, 'README.md'), README);
      assert.strictEqual(read(root, 'docs/guide.md'), DOC);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('pin-snippets: --check', () => {
  it('passes on pinned docs', () => {
    const root = fixture({ 'README.md': PINNED_README, 'docs/guide.md': PINNED_DOC });
    try {
      const r = run(root, '--check');
      assert.strictEqual(r.status, 0, r.stderr);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('fails on unpinned and other-version snippets, listing each line, and changes nothing', () => {
    const root = fixture();
    try {
      const r = run(root, '--check');
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /^README\.md:1: /m);
      assert.match(r.stderr, /^README\.md:2: .*0\.9\.0/m);
      assert.match(r.stderr, /^README\.md:5: /m);
      assert.match(r.stderr, /^docs\/guide\.md:4: /m);
      assert.doesNotMatch(r.stderr, /README\.md:[346]:/);
      assert.doesNotMatch(r.stderr, /plans/);
      assert.strictEqual(read(root, 'README.md'), README);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('fails when a hash does not match the dist file', () => {
    const root = fixture({ 'README.md': PINNED_README, 'docs/guide.md': PINNED_DOC, 'dist/ch.js': 'console.log("rebuilt");\n' });
    try {
      const r = run(root, '--check');
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /^README\.md:1: .*integrity/m);
      assert.match(r.stderr, /^docs\/guide\.md:4: .*integrity/m);
      assert.doesNotMatch(r.stderr, /README\.md:2:/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('fails on a pinned tag without integrity or crossorigin', () => {
    const bare = '<script src="https://unpkg.com/cyborg-hunter@1.2.3/dist/ch.js"></script>\n';
    const noCors = `<script src="https://unpkg.com/cyborg-hunter@1.2.3/dist/ch.js" integrity="${sri(CH)}"></script>\n`;
    const root = fixture({ 'README.md': bare, 'docs/guide.md': noCors });
    try {
      const r = run(root, '--check');
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /^README\.md:1: .*integrity/m);
      assert.match(r.stderr, /^docs\/guide\.md:1: .*crossorigin/m);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('--no-hash checks pins and attributes without dist/', () => {
    const noDist = { 'dist/ch.js': null, 'dist/ch-qualtrics.js': null };
    const pinned = fixture(Object.assign({ 'README.md': PINNED_README, 'docs/guide.md': PINNED_DOC }, noDist));
    const unpinned = fixture(noDist);
    try {
      const ok = run(pinned, '--check', '--no-hash');
      assert.strictEqual(ok.status, 0, ok.stderr);
      const bad = run(unpinned, '--check', '--no-hash');
      assert.strictEqual(bad.status, 1);
      assert.match(bad.stderr, /^README\.md:1: /m);
    } finally {
      rmSync(pinned, { recursive: true, force: true });
      rmSync(unpinned, { recursive: true, force: true });
    }
  });

  it('without --no-hash, a missing dist file fails the check', () => {
    const root = fixture({ 'README.md': PINNED_README, 'docs/guide.md': PINNED_DOC, 'dist/ch.js': null });
    try {
      const r = run(root, '--check');
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /dist\/ch\.js/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// The project's own docs: every snippet names package.json's version and
// carries integrity and crossorigin. Hash values are not compared here: they
// match only a dist/ built from the release commit, and the source moves on
// between releases. The release checks them with `npm run pin:snippets -- --check`
// after `node build.js`.
describe('pin-snippets: the project docs', () => {
  it('README.md and docs/*.md are pinned to the package version', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--root', ROOT, '--check', '--no-hash'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'unpinned snippets (run node build.js, then npm run pin:snippets):\n' + r.stderr);
  });
});
