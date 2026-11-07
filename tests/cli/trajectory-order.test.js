// 0.6.1 — retro item 3: the trajectories grid used to render trials in raw
// ingest order. It now defaults to chronological-by-rule ordering (the same
// comparator the ingest uses when merging phaseTrials), with 'time' and
// 'insertion' as config.trajectoryDisplayOrder alternatives.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { orderTrials, trajectoryPanels } from '../../src/cli/renderers/trajectories-core.js';

const ids = (trials) => trials.map(t => t.trialId);

describe('trajectoryPanels', () => {
  it('gives each trial its place in the grid, in display order', () => {
    const trials = [{ trialId: 'b', timestamp: '2026-01-01T00:00:02Z' }, { trialId: 'a', timestamp: '2026-01-01T00:00:01Z' }];
    assert.deepStrictEqual(trajectoryPanels(trials, { trajectoryDisplayOrder: 'time' }), { count: 2, byIndex: [1, 0] });
    assert.deepStrictEqual(trajectoryPanels(trials, { trajectoryDisplayOrder: 'insertion' }), { count: 2, byIndex: [0, 1] });
  });

  it('leaves out the trials past the panel cap', () => {
    const trials = Array.from({ length: 401 }, (_, i) => ({ trialId: 't' + i }));
    const m = trajectoryPanels(trials, { trajectoryDisplayOrder: 'insertion' });
    assert.strictEqual(m.count, 400);
    assert.strictEqual(m.byIndex[400], null);
  });

  it('is null for a list it cannot read', () => {
    assert.strictEqual(trajectoryPanels(null, {}), null);
  });
});

describe('trajectories displayOrder', () => {
  const trials = [
    { trialId: 'erq-1', phase: 'end_requery', rulePosition: null, trialNumber: 90, timestamp: '2026-05-31T21:50:00Z' },
    { trialId: 'r2-class', phase: 'classification', rulePosition: 2, trialNumber: 10, timestamp: '2026-05-31T21:20:00Z' },
    { trialId: 'r1-class', phase: 'classification', rulePosition: 1, trialNumber: 5, timestamp: '2026-05-31T21:10:00Z' },
    { trialId: 'r1-gallery', phase: 'gallery', rulePosition: 1, trialNumber: 4, timestamp: '2026-05-31T21:08:00Z' },
  ];

  it("default 'rule': (rulePosition, phase-rank, trialNumber), end-requery last", () => {
    assert.deepEqual(ids(orderTrials(trials, {})),
      ['r1-gallery', 'r1-class', 'r2-class', 'erq-1']);
  });

  it("'time': wall-clock timestamps", () => {
    assert.deepEqual(ids(orderTrials(trials, { trajectoryDisplayOrder: 'time' })),
      ['r1-gallery', 'r1-class', 'r2-class', 'erq-1']);
    const swapped = [trials[1], trials[0]];  // erq after r2 in wall-clock
    assert.deepEqual(ids(orderTrials(swapped, { trajectoryDisplayOrder: 'time' })),
      ['r2-class', 'erq-1']);
  });

  it("'insertion': returns the input array untouched", () => {
    const out = orderTrials(trials, { trajectoryDisplayOrder: 'insertion' });
    assert.strictEqual(out, trials);
    assert.deepEqual(ids(out), ['erq-1', 'r2-class', 'r1-class', 'r1-gallery']);
  });

  it('default sort is stable for trials without ordering fields (no behavior change)', () => {
    const bare = [{ trialId: 'a' }, { trialId: 'b' }, { trialId: 'c' }];
    assert.deepEqual(ids(orderTrials(bare, {})), ['a', 'b', 'c']);
  });

  it('does not mutate the input array in sorting modes', () => {
    const before = ids(trials);
    orderTrials(trials, {});
    assert.deepEqual(ids(trials), before);
  });
});
