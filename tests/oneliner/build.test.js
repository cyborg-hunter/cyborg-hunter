// dist/ch.js, the one-line setup bundle: build.js has the seventh target with
// no globalName (entry.js assigns window.CyborgHunter itself, after the
// double-load check), and the built file is small and carries the sentinel.
// The bundles are built into a temporary directory (BUILD_OUTDIR), so this
// file never rewrites the dist/ that the browser tests serve.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MESSAGES } from '../../src/oneliner/errors.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildSrc = readFileSync(join(ROOT, 'build.js'), 'utf8');

let outDir;
before(() => {
  outDir = mkdtempSync(join(tmpdir(), 'ch-build-'));
  execFileSync(process.execPath, ['build.js'], {
    cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { BUILD_OUTDIR: outDir })
  });
});
after(() => { rmSync(outDir, { recursive: true, force: true }); });

// The ch.js block runs from its entry point to the next build (or, as the
// last target, to the closing log line).
function chBlock() {
  const m = buildSrc.match(/src\/oneliner\/entry\.js[\s\S]*?(?=await esbuild\.build|console\.log\('Build complete)/);
  return m ? m[0] : '';
}

describe('build.js: the ch.js target', () => {
  it('builds src/oneliner/entry.js as an IIFE into dist/ch.js', () => {
    assert.ok(buildSrc.includes("entryPoints: ['src/oneliner/entry.js']"));
    const block = chBlock();
    assert.ok(block.includes("outfile: OUT + '/ch.js'"), block);
    assert.ok(buildSrc.includes("const OUT = process.env.BUILD_OUTDIR || 'dist';"));
    assert.ok(block.includes("format: 'iife'"), block);
  });

  it('sets no globalName: entry.js owns window.CyborgHunter', () => {
    const block = chBlock();
    assert.ok(block.length > 0);
    assert.ok(!block.includes('globalName'), block);
  });
});

describe('dist/ch.js', () => {
  it('exists, is under 120 KB and carries the double-load sentinel', () => {
    const file = join(outDir, 'ch.js');
    assert.ok(statSync(file).size < 120 * 1024, statSync(file).size + ' bytes');
    assert.ok(readFileSync(file, 'utf8').includes('__cyborgHunterLoaded'));
  });
});

// dist/cyborg-hunter.min.js run in a bare context whose global is its own
// window (as in a browser: the bundle's top-level `var CyborgHunter` and
// window.CyborgHunter are one slot). Loaded after ch.js, min.js must leave
// ch.js's namespace in place (the double-load message says it does not start
// a second monitor); alone, or after another min.js, it is the core namespace.
describe('dist/cyborg-hunter.min.js: window.CyborgHunter after the footer', () => {
  let src;
  before(() => {
    src = readFileSync(join(outDir, 'cyborg-hunter.min.js'), 'utf8');
  });

  function load(globals) {
    const errors = [];
    const g = Object.assign({ console: { error: (m) => errors.push(String(m)), warn() {}, info() {}, log() {} } }, globals);
    g.window = g;
    vm.createContext(g);
    vm.runInContext(src, g);
    return { g, errors };
  }

  it('after ch.js: ch.js\'s namespace is restored, IntegrityMonitor points at it, no helper global is left', () => {
    const chNs = { mark() {}, data() {}, replay() {}, init() {} };
    const { g, errors } = load({ __cyborgHunterLoaded: 'ch.js', CyborgHunter: chNs });
    assert.ok(g.CyborgHunter === chNs, 'window.CyborgHunter is ch.js\'s namespace');
    assert.ok(g.IntegrityMonitor === chNs);
    assert.strictEqual(g.__cyborgHunterLoaded, 'ch.js');
    assert.strictEqual(g.__cyborgHunterPrevNS, undefined);
    assert.deepStrictEqual(errors, [MESSAGES.doubleLoad('ch.js', 'cyborg-hunter.min.js')]);
  });

  it('alone: the core namespace, and the sentinel names min.js', () => {
    const { g, errors } = load({});
    assert.strictEqual(typeof g.CyborgHunter.init, 'function');
    assert.ok(g.IntegrityMonitor === g.CyborgHunter);
    assert.strictEqual(g.__cyborgHunterLoaded, 'cyborg-hunter.min.js');
    assert.deepStrictEqual(errors, []);
  });

  it('after another copy of min.js: the core namespace again, the neutral loaded-twice error', () => {
    const first = { init() {} };
    const { g, errors } = load({ __cyborgHunterLoaded: 'cyborg-hunter.min.js', CyborgHunter: first });
    assert.ok(g.CyborgHunter !== first);
    assert.strictEqual(typeof g.CyborgHunter.init, 'function');
    assert.deepStrictEqual(errors, [MESSAGES.coreLoadedTwice()]);
  });
});
