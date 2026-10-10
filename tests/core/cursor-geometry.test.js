// tests/core/cursor-geometry.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathLength, displacement, maxDeviation } from '../../src/shared/cursor-geometry.js';
import { computeMouseMetrics } from '../../src/core/signals/mouse.js';

// Printed by the current computeMouseMetrics before this change (see the
// commit body); the helper must leave these values byte for byte.
const GOLDEN = {"straight":{"pathEfficiency":1,"directionChanges":0,"speedVariance":0,"moveCount":8},"jitter":{"pathEfficiency":0.89,"directionChanges":2,"speedVariance":0.1311,"moveCount":8},"mixed":{"pathEfficiency":0.474,"directionChanges":0,"speedVariance":0.2237,"moveCount":4},"few":null};

const straight = [0,1,2,3,4,5,6,7].map(i => ({ x: 100 + i * 50, y: 200, t: i * 50, type: 'move' }));
const jitter = [0,1,2,3,4,5,6,7].map(i => ({ x: 100 + i * 40 + (i % 2 ? 9 : -9), y: 200 + Math.round(30 * Math.sin(i)), t: i * 50, type: 'move' }));
const mixed = [ { x: 10, y: 10, t: 0, type: 'move' }, { x: 60, y: 10, t: 50, type: 'move' }, { x: 60, y: 10, t: 55, type: 'click' }, { x: 60, y: 90, t: 100, type: 'move' }, { x: 20, y: 90, t: 160, type: 'move' } ];

describe('cursor geometry', () => {
  it('a straight run has efficiency 1 and no deviation', () => {
    assert.equal(pathLength(straight), 350);
    assert.equal(displacement(straight), 350);
    assert.equal(maxDeviation(straight), 0);
  });
  it('a jittered run is longer than its chord and deviates from it', () => {
    assert.ok(pathLength(jitter) > displacement(jitter));
    assert.ok(maxDeviation(jitter) > 0);
  });
  it('one point or none gives 0 everywhere', () => {
    for (const pts of [[], [{ x: 3, y: 4 }]]) {
      assert.equal(pathLength(pts), 0);
      assert.equal(displacement(pts), 0);
      assert.equal(maxDeviation(pts), 0);
    }
  });
  it('a chord of length 0 (start = end) measures deviation as distance from the point', () => {
    assert.equal(maxDeviation([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 0, y: 0 }]), 5);
  });
});

describe('computeMouseMetrics keeps its outputs', () => {
  it('matches the recorded values', () => {
    assert.ok(GOLDEN, 'GOLDEN not pasted');
    assert.deepEqual(computeMouseMetrics(straight, 3), GOLDEN.straight);
    assert.deepEqual(computeMouseMetrics(jitter, 3), GOLDEN.jitter);
    assert.deepEqual(computeMouseMetrics(mixed, 3), GOLDEN.mixed);
    assert.equal(computeMouseMetrics(mixed.slice(0, 2), 3), GOLDEN.few);
  });
});
