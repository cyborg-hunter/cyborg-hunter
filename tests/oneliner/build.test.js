// dist/ch.js, the one-line setup bundle: build.js has the seventh target with
// no globalName (entry.js assigns window.CyborgHunter itself, after the
// double-load check), and the built file is small and carries the sentinel.
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildSrc = readFileSync(join(ROOT, 'build.js'), 'utf8');

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
    assert.ok(block.includes("outfile: 'dist/ch.js'"), block);
    assert.ok(block.includes("format: 'iife'"), block);
  });

  it('sets no globalName: entry.js owns window.CyborgHunter', () => {
    const block = chBlock();
    assert.ok(block.length > 0);
    assert.ok(!block.includes('globalName'), block);
  });
});

describe('dist/ch.js', () => {
  before(() => {
    execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'ignore' });
  });

  it('exists, is under 120 KB and carries the double-load sentinel', () => {
    const file = join(ROOT, 'dist', 'ch.js');
    assert.ok(statSync(file).size < 120 * 1024, statSync(file).size + ' bytes');
    assert.ok(readFileSync(file, 'utf8').includes('__cyborgHunterLoaded'));
  });
});
