// The hygiene gate's Prolific-parameter exception is path-scoped: the literal
// passes only in the one-liner's resolver, tests and docs (tracked files) and
// in dist/ch.js under $GATE_SCAN_DIR. Each case runs the real script in a
// throwaway git repo, so the project's index is never touched. The literal is
// assembled at runtime so this file itself never contains it.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LITERAL = 'PROLIFIC' + '_PID';

// Exit status of the gate in a fresh repo holding `tracked` (path → text,
// git-added) and, optionally, a scan dir `site/` holding `scanned`.
function gate(tracked, scanned) {
  const repo = mkdtempSync(join(tmpdir(), 'ch-hygiene-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    mkdirSync(join(repo, 'scripts'));
    copyFileSync(join(ROOT, 'scripts', 'check-public-hygiene.sh'), join(repo, 'scripts', 'check-public-hygiene.sh'));
    for (const [p, text] of Object.entries(tracked)) {
      mkdirSync(dirname(join(repo, p)), { recursive: true });
      writeFileSync(join(repo, p), text + '\n');
    }
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const env = Object.assign({}, process.env);
    delete env.GATE_COMMIT;
    delete env.GATE_SCAN_DIR;
    if (scanned) {
      for (const [p, text] of Object.entries(scanned)) {
        mkdirSync(dirname(join(repo, 'site', p)), { recursive: true });
        writeFileSync(join(repo, 'site', p), text + '\n');
      }
      env.GATE_SCAN_DIR = 'site';
    }
    return spawnSync('bash', ['scripts/check-public-hygiene.sh'], { cwd: repo, env, encoding: 'utf8' }).status;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const line = 'const p = "' + LITERAL + '";';

describe('hygiene gate: Prolific URL parameter allowlist', () => {
  it('passes in the allowlisted one-liner paths', () => {
    assert.strictEqual(gate({
      'src/oneliner/participant-id.js': line,
      'tests/oneliner/participant-id.test.js': line,
      'tests/oneliner/debug.test.js': line,
      'tests/e2e/oneliner/fixtures/page.html': line,
      'docs/quickstart.md': line,
      'docs/advanced-integration.md': line
    }), 0);
  });

  it('fails anywhere else, including look-alike paths', () => {
    assert.strictEqual(gate({ 'src/core/tmp.js': line }), 1);
    assert.strictEqual(gate({ 'src/oneliner/tmp.js': line }), 1);
    assert.strictEqual(gate({ 'docs/quickstart.md.bak': line }), 1);
    assert.strictEqual(gate({ 'dist/ch.js': line }), 1, 'a tracked dist/ch.js is not the scanned bundle');
    assert.strictEqual(gate({ 'src/core/tmp.js': '// ' + LITERAL + ' src/oneliner/participant-id.js: /dist/ch.js:' }), 1,
      'an allowlisted path inside the text does not count');
  });

  it('under GATE_SCAN_DIR only <dir>/dist/ch.js may carry it', () => {
    assert.strictEqual(gate({}, { 'dist/ch.js': line }), 0);
    assert.strictEqual(gate({}, { 'other.js': line }), 1);
    assert.strictEqual(gate({}, { 'dist/other.js': line }), 1);
  });
});
