import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('CLI integration: scoreWeights end to end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch-score-weights-e2e-'));
  const outputDir = join(dir, 'out');
  const configPath = join(dir, 'config.json');
  const warned = [];

  before(async () => {
    const base = JSON.parse(readFileSync('tests/cli/fixtures/test-config.json', 'utf8'));
    writeFileSync(configPath, JSON.stringify({ ...base, scoreWeights: { fastTyping: 1, synthetc: 1 } }));
    const origWarn = console.warn;
    console.warn = (...a) => { warned.push(a.join(' ')); };
    try {
      const { run } = await import('../../src/cli/report.js');
      await run(['report', '--config', configPath, '--data', 'tests/cli/fixtures', '--output', outputDir, '--no-visuals']);
    } finally {
      console.warn = origWarn;
    }
  });

  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('the configured weight changes the score in summary.csv (P-SUS: 12 + 2 fast-typing trials)', () => {
    const rows = readFileSync(join(outputDir, 'summary.csv'), 'utf8').trim().split('\n');
    const sus = rows.find(r => r.startsWith('P-SUS,'));
    assert.equal(sus.split(',')[2], '14');
  });

  it('writes score-weights.json marked non-default', () => {
    const json = JSON.parse(readFileSync(join(outputDir, 'score-weights.json'), 'utf8'));
    assert.equal(json.isDefault, false);
    assert.equal(json.weights.fastTyping.weight, 1);
  });

  it('index.html names the custom weights in the top bar', () => {
    assert.match(readFileSync(join(outputDir, 'index.html'), 'utf8'), /custom score weights: fastTyping 1/);
  });

  it('prints the typo warning exactly once', () => {
    assert.equal(warned.filter(w => /did you mean "synthetic"/.test(w)).length, 1, warned.join('\n'));
  });
});

describe('CLI integration', () => {
  const outputDir = 'tests/cli/output';

  before(async () => {
    const { run } = await import('../../src/cli/report.js');
    await run(['report', '--config', 'tests/cli/fixtures/test-config.json', '--data', 'tests/cli/fixtures', '--output', outputDir, '--no-visuals']);
  });

  after(() => { rmSync(outputDir, { recursive: true, force: true }); });

  it('creates summary.csv with correct row count', () => {
    const csv = readFileSync(`${outputDir}/summary.csv`, 'utf8');
    const rows = csv.trim().split('\n');
    // header + 2 participants (clean + suspicious)
    assert.equal(rows.length, 3);
  });

  it('creates triage.md', () => {
    assert.ok(existsSync(`${outputDir}/triage.md`));
  });

  it('creates event-log.csv', () => {
    assert.ok(existsSync(`${outputDir}/event-log.csv`));
    const csv = readFileSync(`${outputDir}/event-log.csv`, 'utf8');
    const rows = csv.trim().split('\n');
    // header + 2 paste events from suspicious participant
    assert.ok(rows.length >= 3, `Expected at least 3 rows, got ${rows.length}`);
  });

  it('creates extensions.csv', () => {
    assert.ok(existsSync(`${outputDir}/extensions.csv`));
  });

  it('ranks suspicious participant above clean', () => {
    const md = readFileSync(`${outputDir}/triage.md`, 'utf8');
    const susIdx = md.indexOf('P-SUS');
    const cleanIdx = md.indexOf('P-CLEAN');
    assert.ok(susIdx < cleanIdx, 'Suspicious participant should be ranked first');
  });
});
