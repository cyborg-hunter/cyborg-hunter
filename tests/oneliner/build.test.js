// The one-line setup: build.js writes one file per framework from the same
// entry (build-targets.js), each with the compile-time host flags of its
// target (src/oneliner/build-flags.js) and no globalName (entry.js assigns
// window.CyborgHunter itself, after the double-load check). Every file is
// small, sets the shared sentinel and carries only its own hosts' adapters.
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
import { ONE_LINE_TARGETS, defineFor } from '../../build-targets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildSrc = readFileSync(join(ROOT, 'build.js'), 'utf8');
const CAP = 120 * 1024;   // bytes, for each one-line file

let outDir;
before(() => {
  outDir = mkdtempSync(join(tmpdir(), 'ch-build-'));
  execFileSync(process.execPath, ['build.js'], {
    cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { BUILD_OUTDIR: outDir })
  });
});
after(() => { rmSync(outDir, { recursive: true, force: true }); });

// The one-line loop runs to the closing log line (it is the last target).
function oneLineBlock() {
  const m = buildSrc.match(/for \(const target of ONE_LINE_TARGETS\)[\s\S]*?(?=console\.log\('Build complete)/);
  return m ? m[0] : '';
}

// A string only one host's adapter carries: in the files that carry that
// host, and in no other. (A field name the debug summary imports, such as
// Qualtrics' __js_cyborg_hunter, is in every file and cannot serve.)
const MARKERS = {
  jspsych: 'extensions is not an array'
};

describe('build.js: the one-line targets', () => {
  it('builds every target from src/oneliner/entry.js as an IIFE, with its own define and no globalName', () => {
    const block = oneLineBlock();
    assert.ok(block.includes("entryPoints: ['src/oneliner/entry.js']"), block);
    assert.ok(block.includes('define: defineFor(target)'), block);
    assert.ok(block.includes("outfile: OUT + '/' + target.file"), block);
    assert.ok(block.includes("format: 'iife'"), block);
    assert.ok(!block.includes('globalName'), block);
    assert.ok(buildSrc.includes("const OUT = process.env.BUILD_OUTDIR || 'dist';"));
  });

  it('ch.js is a target, and every target names hosts this file has a marker for', () => {
    assert.ok(ONE_LINE_TARGETS.some((t) => t.file === 'ch.js'));
    for (const t of ONE_LINE_TARGETS) {
      for (const h of t.hosts) assert.ok(h in MARKERS, t.file + ': no marker for ' + h);
    }
  });

  it('defineFor turns a target into literal flags and its own file name', () => {
    assert.deepStrictEqual(defineFor({ file: 'ch-x.js', hosts: ['labjs'] }),
      { HAS_JSPSYCH: 'false', HAS_QUALTRICS: 'false', HAS_LABJS: 'true', CH_FILE: '"ch-x.js"' });
  });

  it('docs/quickstart.md#which-file lists every target and nothing else', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'quickstart.md'), 'utf8');
    const parts = doc.split(/^### Which file$/m);
    assert.strictEqual(parts.length, 2, 'one "### Which file" heading');
    const section = parts[1].split(/^#{2,3} /m)[0];
    const files = [...section.matchAll(/^\| `([^`]+\.js)` \|/gm)].map((m) => m[1]).sort();
    assert.deepStrictEqual(files, ONE_LINE_TARGETS.map((t) => t.file).sort());
  });
});

for (const target of ONE_LINE_TARGETS) {
  describe('dist/' + target.file, () => {
    it('exists, is under 120 KiB and sets the one-line sentinel', () => {
      const file = join(outDir, target.file);
      assert.ok(statSync(file).size < CAP, target.file + ': ' + statSync(file).size + ' bytes');
      assert.match(readFileSync(file, 'utf8'), /\.__cyborgHunterLoaded="ch\.js"/);
    });

    it('carries the adapters of its own hosts and none of the others', () => {
      const src = readFileSync(join(outDir, target.file), 'utf8');
      for (const [host, marker] of Object.entries(MARKERS)) {
        assert.strictEqual(src.includes(marker), target.hosts.includes(host), target.file + ' / ' + host + ': ' + marker);
      }
    });
  });
}

// dist/cyborg-hunter.min.js run in a bare context whose global is its own
// window (as in a browser: the bundle's top-level `var CyborgHunter` and
// window.CyborgHunter are one slot). Loaded after a one-line file (every one
// sets the sentinel to 'ch.js'), min.js must leave that file's namespace in
// place (the double-load message says it does not start a second monitor);
// alone, or after another min.js, it is the core namespace.
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
