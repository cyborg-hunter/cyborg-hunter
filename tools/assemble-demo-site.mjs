// tools/assemble-demo-site.mjs
// Assembles the same artifact the Pages CI workflow builds — demo/* at site
// root + dist/ — into .demo-site/ (gitignored), so the Playwright suite runs
// against something that behaves like the deployed site instead of the bare
// demo/ directory (whose index.html expects ./dist/... next to it). This is
// also the single source of assembly logic: the Pages CI workflow calls this
// same script rather than duplicating the copy step.
//
// Steps:
//   1. `node build.js` -> dist/ (skipped if dist/ is newer than every file
//      under src/ — "if stale").
//   2. `node tools/build-preview-core.mjs` -> demo/preview-core.js.
//   2b. `node tools/build-analyze.mjs` -> demo/analyze/analyze.bundle.js.
//   3. Copy demo/* (excluding demo/tests/ — Playwright specs must not ship
//      in the public artifact — and, under demo/analyze/, everything but
//      index.html and the built bundle) and dist/ into .demo-site/.
//   4. Write the ASSEMBLED replay viewer script to the site root —
//      demo/results.js fetches it as text to embed in the in-browser
//      report, and it must be the same assembly html-index.js inlines into
//      the CLI report: the client alone is missing the §4 instantiation
//      module it calls into (the build's concatenation decision).
//   5. Write the analyze page as one offline file,
//      .demo-site/analyze/cyborg-hunter-analyze.html (bundle inlined, policy
//      without 'self'; see tools/offline-analyze.mjs).
//
// Usage: node tools/assemble-demo-site.mjs

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readReplayClientSrc } from '../src/cli/renderers/replay-client-source.js';
import { buildOfflineHtml, OFFLINE_NAME } from './offline-analyze.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SITE_DIR = join(ROOT, '.demo-site');
const DEMO_DIR = join(ROOT, 'demo');

// Excludes demo/tests/ (Playwright specs + helpers — dev-only, must not ship
// publicly) and, under demo/analyze/, everything but the page and its built
// bundle: the other files there are build inputs of tools/build-analyze.mjs.
// Everything else under demo/ is runtime: index.html, demo.css, the *.js
// modules, signal-manifest.json, assets/.
function isRuntimeFile(src) {
  const rel = relative(DEMO_DIR, src);
  if (rel === 'tests' || rel.startsWith('tests' + sep)) return false;
  if (rel.startsWith('analyze' + sep)) {
    const inner = rel.slice(('analyze' + sep).length);
    return inner === 'index.html' || inner === 'analyze.bundle.js';
  }
  return true;
}

function newestMtimeUnder(dir) {
  var newest = 0;
  for (var entry of readdirSync(dir, { withFileTypes: true })) {
    var full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeUnder(full));
    } else {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

function distIsStale() {
  var marker = join(ROOT, 'dist', 'cyborg-hunter.min.js');
  if (!existsSync(marker)) return true;
  var distMtime = statSync(marker).mtimeMs;
  return newestMtimeUnder(join(ROOT, 'src')) > distMtime;
}

function run(label, cmd, args) {
  console.log('assemble-demo-site: ' + label);
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
}

function main() {
  if (distIsStale()) {
    run('building dist/ (stale)', process.execPath, ['build.js']);
  } else {
    console.log('assemble-demo-site: dist/ is up to date, skipping build.js');
  }

  run('building demo/preview-core.js', process.execPath, ['tools/build-preview-core.mjs']);
  run('building demo/analyze/analyze.bundle.js', process.execPath, ['tools/build-analyze.mjs']);

  rmSync(SITE_DIR, { recursive: true, force: true });
  mkdirSync(SITE_DIR, { recursive: true });
  cpSync(DEMO_DIR, SITE_DIR, { recursive: true, filter: isRuntimeFile });
  cpSync(join(ROOT, 'dist'), join(SITE_DIR, 'dist'), { recursive: true });
  // demo/assets/ (example-participants.json) is copied above as part of
  // demo/* — it isn't excluded by isRuntimeFile. The replay viewer lives
  // outside demo/ (it's the CLI's own renderer asset) and is an ASSEMBLY of
  // two source files, so the site gets the assembled text under the name
  // demo/results.js fetches — never a copy of the client alone, which would
  // load into the demo with `mountTree` undefined.
  writeFileSync(join(SITE_DIR, 'replay-viewer.client.js'), readReplayClientSrc());
  // The report's typefaces (WOFF2 + each family's OFL.txt + the manifest),
  // copied from their one committed home rather than duplicated under demo/.
  // demo.css loads them by URL for the tour itself; demo/results.js fetches
  // them and inlines them into the in-browser report and the replay host.
  cpSync(join(ROOT, 'src', 'cli', 'renderers', 'fonts'), join(SITE_DIR, 'assets', 'fonts'), { recursive: true });
  // The analyze page as a single offline file, next to the page it mirrors
  // (the page's download link points at this name).
  writeFileSync(join(SITE_DIR, 'analyze', OFFLINE_NAME), buildOfflineHtml(
    readFileSync(join(DEMO_DIR, 'analyze', 'index.html'), 'utf8'),
    readFileSync(join(DEMO_DIR, 'analyze', 'analyze.bundle.js'), 'utf8')));

  console.log('assemble-demo-site: assembled ' + SITE_DIR);
}

main();
