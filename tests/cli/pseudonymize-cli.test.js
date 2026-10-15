// The CLI side of the pseudonymized export: the flags, where the key file
// is resolved, the refusal to write it inside the report, and a run that
// creates the key file and a second one that reuses it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseFlags, loadConfig, keyFileInsideOutput } from '../../src/cli/config.js';
import { parseKeyFile } from '../../src/cli/pseudonymize-core.js';

const bin = new URL('../../bin/cyborg-hunter.js', import.meta.url).pathname;
// CI=1: no update check (no network from the tests).
const cli = (args, cwd) => spawnSync(process.execPath, [bin, 'report', '--no-visuals', ...args], { cwd, encoding: 'utf8', env: { ...process.env, CI: '1' } });

function inTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ch-pseudo-cli-'));
  const cwd = process.cwd();
  try { process.chdir(dir); return fn(dir); } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); }
}

describe('CLI flags: pseudonymize', () => {
  it('accepts --pseudonymize and --pseudonym-key-file', () => {
    assert.deepEqual(parseFlags(['--pseudonymize']), { pseudonymize: true });
    assert.equal(parseFlags(['--pseudonym-key-file', 'k.csv']).pseudonymKeyFile, 'k.csv');
  });

  it('is off by default; the key file defaults to cyborg-hunter-pseudonyms.csv in the working directory', () => {
    inTempDir((dir) => {
      const c = loadConfig([]);
      assert.equal(c.pseudonymize, false);
      assert.match(c.pseudonymKeyFile, /\/cyborg-hunter-pseudonyms\.csv$/);
      assert.ok(c.pseudonymKeyFile.endsWith(join(dir.split('/').pop(), 'cyborg-hunter-pseudonyms.csv')));
    });
  });

  it('a config file and the flags set both; the flag wins', () => {
    inTempDir((dir) => {
      writeFileSync(join(dir, 'c.json'), JSON.stringify({ pseudonymize: true, pseudonymKeyFile: 'keys/from-file.csv' }));
      const c = loadConfig(['--config', join(dir, 'c.json')]);
      assert.equal(c.pseudonymize, true);
      assert.match(c.pseudonymKeyFile, /^\/.*\/keys\/from-file\.csv$/);
      assert.match(loadConfig(['--config', join(dir, 'c.json'), '--pseudonym-key-file', 'cli.csv']).pseudonymKeyFile, /^\/.*\/cli\.csv$/);
      assert.equal(loadConfig(['--pseudonymize']).pseudonymize, true);
      writeFileSync(join(dir, 'null.json'), JSON.stringify({ pseudonymKeyFile: null }));
      assert.match(loadConfig(['--config', join(dir, 'null.json')]).pseudonymKeyFile, /\/cyborg-hunter-pseudonyms\.csv$/);
    });
  });

  it('keyFileInsideOutput: the output folder itself and anything under it, nothing beside it', () => {
    assert.equal(keyFileInsideOutput('/s/report/k.csv', '/s/report'), true);
    assert.equal(keyFileInsideOutput('/s/report/sub/k.csv', '/s/report'), true);
    assert.equal(keyFileInsideOutput('/s/report', '/s/report'), true);
    assert.equal(keyFileInsideOutput('/s/k.csv', '/s/report'), false);
    assert.equal(keyFileInsideOutput('/s/report-keys/k.csv', '/s/report'), false);
    assert.equal(keyFileInsideOutput('/s/..k.csv', '/s/report'), false);
  });
});

function studyDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ch-pseudo-cli-'));
  mkdirSync(join(dir, 'data'));
  for (const f of ['clean_participant.json', 'suspicious_participant.json']) copyFileSync(join('tests/cli/fixtures', f), join(dir, 'data', f));
  writeFileSync(join(dir, 'cyborg-hunter.config.json'), JSON.stringify({ dataDir: 'data', outputDir: 'report' }));
  return dir;
}

describe('CLI run: pseudonymize', () => {
  it('refuses a key file inside the output folder, before writing anything', () => {
    const dir = studyDir();
    try {
      const run = cli(['--pseudonymize', '--pseudonym-key-file', 'report/keys.csv'], dir);
      assert.equal(run.status, 1, run.stdout);
      assert.match(run.stderr, /pseudonym key file .*report\/keys\.csv.* is inside the output folder/);
      assert.equal(existsSync(join(dir, 'report')), false, 'no report written');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the key file beside the report, then reuses it: the same codes, no row twice, a new participant appended', () => {
    const dir = studyDir();
    try {
      const first = cli(['--pseudonymize'], dir);
      assert.equal(first.status, 0, first.stderr);
      const keyPath = join(dir, 'cyborg-hunter-pseudonyms.csv');
      assert.match(first.stdout, /Pseudonym key: .*cyborg-hunter-pseudonyms\.csv — keep it private; never share it with the report\./);
      const key1 = readFileSync(keyPath, 'utf8');
      const rows1 = key1.trim().split('\n').slice(3).sort();
      assert.deepEqual(rows1.map((r) => r.split(',')[1]).sort(), ['P-CLEAN', 'P-SUS']);
      const summary1 = readFileSync(join(dir, 'report', 'summary.csv'), 'utf8');
      assert.doesNotMatch(summary1, /P-CLEAN|P-SUS/);
      for (const r of rows1) assert.ok(summary1.includes(r.split(',')[0] + ','), r);

      const second = cli(['--pseudonymize'], dir);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(readFileSync(keyPath, 'utf8'), key1, 'nothing appended for the same cohort');
      assert.equal(readFileSync(join(dir, 'report', 'summary.csv'), 'utf8'), summary1, 'the same codes');

      const p3 = JSON.parse(readFileSync(join(dir, 'data', 'clean_participant.json'), 'utf8'));
      p3.participantId = 'P-THIRD';
      writeFileSync(join(dir, 'data', 'third.json'), JSON.stringify(p3).replaceAll('P-CLEAN', 'P-THIRD'));
      assert.equal(cli(['--pseudonymize'], dir).status, 0);
      const key3 = readFileSync(keyPath, 'utf8');
      assert.ok(key3.startsWith(key1), 'the old rows stay as they were');
      assert.match(key3.slice(key1.length), /^P-[0-9a-f]{10},P-THIRD\n$/);
      assert.equal(parseKeyFile(key3).secret, parseKeyFile(key1).secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a key file it cannot read a secret from, rather than minting a new one', () => {
    const dir = studyDir();
    try {
      writeFileSync(join(dir, 'cyborg-hunter-pseudonyms.csv'), 'code,participantId\n');
      const run = cli(['--pseudonymize'], dir);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /cyborg-hunter-pseudonyms\.csv.*secret/);
      assert.equal(existsSync(join(dir, 'report')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
