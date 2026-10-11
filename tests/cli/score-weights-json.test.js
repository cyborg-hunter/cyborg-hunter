// tests/cli/score-weights-json.test.js
// score-weights.json records the weights a report's score was built with, so
// two reports built with different configs cannot be mistaken as comparable.
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { renderScoreWeights } from '../../src/cli/renderers/score-weights.js';

const outputDir = mkdtempSync(join(tmpdir(), 'ch-score-weights-'));
after(() => rmSync(outputDir, { recursive: true, force: true }));
const read = () => JSON.parse(readFileSync(join(outputDir, 'score-weights.json'), 'utf8'));

describe('score-weights.json', () => {
  it('records the default weights when scoreWeights is absent', () => {
    renderScoreWeights({ outputDir });
    const json = read();
    assert.equal(json.isDefault, true);
    assert.deepEqual(json.weights.paste, { weight: 5, max: null });
    assert.deepEqual(json.weights.synthetic, { weight: 0, max: null });
    assert.equal(Object.keys(json.weights).length, 17);
  });

  it('records custom weights and marks them non-default', () => {
    renderScoreWeights({ outputDir, scoreWeights: { synthetic: 1, copy: { weight: 5, max: 3 } } });
    const json = read();
    assert.equal(json.isDefault, false);
    assert.deepEqual(json.weights.synthetic, { weight: 1, max: null });
    assert.deepEqual(json.weights.copy, { weight: 5, max: 3 });
  });

  it('holds weights only, never warnings (those go to the console)', () => {
    renderScoreWeights({ outputDir, scoreWeights: { synthetc: 1 } });
    const json = read();
    assert.deepEqual(Object.keys(json).sort(), ['isDefault', 'weights']);
  });
});
