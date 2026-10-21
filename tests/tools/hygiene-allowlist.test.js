// The hygiene gate's Prolific-parameter exception is path-scoped: the literal
// passes only in the one-liner's resolver, tests and docs (tracked files) and
// in the built bundles under $GATE_SCAN_DIR (the one-line files, dist/ch.js
// and dist/ch-<name>.js, and the analyze page's two outputs). Each case runs
// the real script in a throwaway git
// repo, so the project's index is never touched. The literal is
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
      'docs/advanced-integration.md': line,
      'docs/qualtrics.md': line
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

  it('under GATE_SCAN_DIR only the built bundles may carry it', () => {
    assert.strictEqual(gate({}, { 'dist/ch.js': line }), 0);
    assert.strictEqual(gate({}, { 'analyze/analyze.bundle.js': line }), 0);
    assert.strictEqual(gate({}, { 'analyze/cyborg-hunter-analyze.html': line }), 0);
    assert.strictEqual(gate({}, { 'analyze/other.js': line }), 1);
    assert.strictEqual(gate({}, { 'analyze/analyze.bundle.js.map': line }), 1);
    assert.strictEqual(gate({}, { 'x/analyze/analyze.bundle.js': line }), 1);
    assert.strictEqual(gate({}, { 'other.js': line }), 1);
    assert.strictEqual(gate({}, { 'dist/other.js': line }), 1);
  });

  // build-targets.js writes one file per framework (dist/ch-qualtrics.js,
  // dist/ch-labjs.js, ...), each with the resolver's parameter list.
  it('under GATE_SCAN_DIR every one-line file may carry it, and no other file named like one', () => {
    assert.strictEqual(gate({}, { 'dist/ch-qualtrics.js': line }), 0);
    assert.strictEqual(gate({}, { 'dist/ch-labjs.js': line }), 0);
    assert.strictEqual(gate({}, { 'dist/chunk.js': line }), 1);
    assert.strictEqual(gate({}, { 'dist/ch.min.js': line }), 1);
    assert.strictEqual(gate({}, { 'dist/ch-labjs.js.map': line }), 1);
    assert.strictEqual(gate({}, { 'x/dist/ch-labjs.js': line }), 1);
    assert.strictEqual(gate({}, { 'ch-labjs.js': line }), 1);
  });
});

// Process labels: tokens from how the code was built (plan task numbers,
// review rounds, finding and review ids) must not appear in source, tests,
// tools or packages. The pattern is tight: it must fail on a label and pass on
// the look-alikes below. The labels are assembled at runtime so this file never
// contains one.
const T = 'T' + '5';
const label = {
  round: 'fix ' + 'round 2',
  task: T + ' Task ' + '3',
  taskDash: 'Task' + '-4',
  version: T + '.9',
  review: 'review ' + 'M-4',
  a3: 'A3 ' + 'review',
  finding: 'finding ' + '6',
  sol: 'Sol ' + 'round-1'
};
const W = 'Task';
const w = W.toLowerCase();

describe('hygiene gate: process labels', () => {
  it('fails on a label in source, tests, tools and packages', () => {
    assert.strictEqual(gate({ 'src/a.js': '// ' + label.round }), 1);
    assert.strictEqual(gate({ 'src/a.js': '// (' + label.task + ' + more)' }), 1);
    assert.strictEqual(gate({ 'tests/a.test.js': '// ' + label.taskDash + ' carry' }), 1);
    assert.strictEqual(gate({ 'tools/a.mjs': '// shipped in ' + label.version + ' fix' }), 1);
    assert.strictEqual(gate({ 'packages/p/src/a.js': '// (' + label.review + ')' }), 1);
    assert.strictEqual(gate({ 'tests/a.test.js': '// ' + label.a3 + ', ' + label.finding }), 1);
    assert.strictEqual(gate({ 'tests/fixtures/a.html': '<!-- ' + label.sol + ' -->' }), 1);
    assert.strictEqual(gate({ 'demo/a.js': '// ' + label.review }), 1);
  });

  it('passes ordinary words, quoted ids, colours, versions and base64', () => {
    assert.strictEqual(gate({ 'src/a.js': '// Task: run the task list; the Task class' }), 0);
    assert.strictEqual(gate({ 'src/a.js': "const c = '#D3D3D3', d = 'D3';" }), 0);
    assert.strictEqual(gate({ 'src/a.js': "init({ participantId: '" + T + "' }); // ids 'T1' and \"T2\"" }), 0);
    assert.strictEqual(gate({ 'src/a.js': '// ships in v0.7.1, schema 1.2.3, at 2026-09-02' + 'T10:00:00Z' }), 0);
    assert.strictEqual(gate({ 'tests/a.json': '{"d":"iVBORw0KGgo/' + T + '/+' + T + '=AAAA"}' }), 0);
    assert.strictEqual(gate({ 'src/a.js': '// the review found nothing; a fix is a fix; one round of review' }), 0);
    assert.strictEqual(gate({ 'src/a.js': '// T-shirt sizes, ST5 and ' + T + 'x are not labels' }), 0);
  });

  // The word in any case, then a number after a space, a hyphen or '#'. A
  // numeral straight after the word reads as a label, so the word and then
  // "3D" fails too: prose puts the number first ("a 3D task") or spells it
  // out. The word glued to a digit is an identifier and passes.
  it('fails on a task label in any case, hyphenated or with #', () => {
    for (const text of [
      '// carried from ' + w + ' 3',
      '// (' + w + '-3-review item 1)',
      '// ' + W.toUpperCase() + ' 6 owns the predicates',
      '// fix to ' + w + ' #25',
      '// see ' + W + '-#4 and ' + W + '#5',
      '// ' + w + 's 4-7',
      '// the ' + w + ' 3D',
    ]) assert.strictEqual(gate({ 'tests/a.test.js': text }), 1, text);
  });

  it('passes the word in ordinary prose and code', () => {
    assert.strictEqual(gate({ 'src/a.js': [
      '// this ' + w + '; a ' + w + ' list; the ' + w + "'s 3 phases; " + w + 's: 3 of them',
      '// a 3D ' + w + ', three ' + w + 's, ' + w + ' three, the ' + w + 'bar 2, multi' + w + ' 3',
      "const t = { name: '" + w + "', n: 3 }, " + w + "1 = t, " + W + "2 = t;",
    ].join('\n') }), 0);
  });

  it('does not scan docs', () => {
    assert.strictEqual(gate({ 'docs/guide.md': label.task }), 0);
    assert.strictEqual(gate({ 'README.md': label.round }), 0);
    assert.strictEqual(gate({ 'docs/guide.md': '// a model. ' + W + '\n// ' + '10(b) settled it' }), 0);
  });

  // A comment wrapped inside a label: one line ends in the word, the next
  // starts (after comment markers) with the number, so neither line alone
  // carries it. The pieces are joined at runtime: no line of this file ends
  // in the word.
  it('fails on a label split across a line break', () => {
    assert.strictEqual(gate({ 'src/a.js': ' *   a model. ' + W + '\n *     ' + '10(b) settled that' }), 1);
    assert.strictEqual(gate({ 'tests/a.test.js': '// carried by ' + W + 's\n// ' + '4-7 below' }), 1);
    assert.strictEqual(gate({ 'tools/a.sh': '# done in ' + W + '  \n#   ' + '3, then' }), 1);
    assert.strictEqual(gate({ 'demo/a.html': '<p>see ' + W + '\n<!-- ' + '12 -->' }), 1);
    assert.strictEqual(gate({ 'src/a.js': 'const a = 1; // ' + W + '\n' + '9 more' }), 1);
    assert.strictEqual(gate({ 'src/a.js': '// carried by ' + W.toUpperCase() + '\n// ' + '3 below' }), 1, 'any case');
    assert.strictEqual(gate({ 'src/a.js': '// carried by ' + w + '\n// ' + '3 below' }), 1, 'any case');
  });

  it('passes ordinary prose and code that wraps after the word', () => {
    assert.strictEqual(gate({ 'src/a.js': '// each ' + W + '\n// list grows by one' }), 0);
    assert.strictEqual(gate({ 'src/a.js': '// one ' + W + '\n// ten things later' }), 0);
    assert.strictEqual(gate({ 'src/a.js': 'class ' + W + '\n{ run() { return 3; } }' }), 0);
    assert.strictEqual(gate({ 'src/a.js': '// a ' + W + '\n\n// ' + '3 is unrelated' }), 0);
    assert.strictEqual(gate({ 'src/a.js': '// the Multi' + W + '\n// ' + '3 lanes' }), 0);
    assert.strictEqual(gate({ 'src/a.js': '// the last word: ' + W, 'src/b.js': '3 starts this file' }), 0);
  });

  it('under GATE_SCAN_DIR a label in a built file fails', () => {
    assert.strictEqual(gate({}, { 'dist/ch.js': '// ' + label.round }), 1);
    assert.strictEqual(gate({}, { 'dist/ch.js': '// ordinary comment, Task done' }), 0);
    assert.strictEqual(gate({}, { 'dist/ch.js': '// see ' + W + '\n// ' + '10(b)' }), 1);
    assert.strictEqual(gate({}, { 'dist/ch.js': '// see ' + W + '\n// list' }), 0);
  });
});

