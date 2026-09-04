// Tests for bench/harness/trial-filter.js
//
// The filter is a pure function over plain objects, so the fixtures below are
// just `{ type: { info: { name } } }` stubs — the same shape jsPsych trial
// objects expose, with nothing else the filter reads.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ALWAYS_FILTERED,
  BOT_INCOMPATIBLE_TRIALS,
  REPLAY_DEMO_FILTERED,
  trialName,
  filterTrials,
} from '../trial-filter.js';

const trial = (name) => ({ type: { info: { name } } });

// A stand-in for the composed bench timeline: upstream replay-test trials
// plus the two custom grafted ones.
const SUITE = [
  trial('instructions'),
  trial('fullscreen'),
  trial('html-keyboard-response'),
  trial('html-button-response'),
  trial('html-slider-response'),
  trial('canvas-keyboard-response'),
  trial('sketchpad'),
  trial('free-sort'),
  trial('survey-multi-choice'),
  trial('bench-describe-card'),
  trial('bench-recording-trial'),
];

const names = (trials) => trials.map(trialName);

describe('filterTrials — default (human, no preset)', () => {
  it('drops only the always-filtered survey-multi-choice', () => {
    const kept = names(filterTrials(SUITE));
    assert.ok(!kept.includes('survey-multi-choice'));
    assert.equal(kept.length, SUITE.length - 1);
  });

  it('keeps the microphone trial', () => {
    assert.ok(names(filterTrials(SUITE)).includes('bench-recording-trial'));
  });
});

describe('filterTrials — bot-mode', () => {
  it('drops every bot-incompatible trial as well', () => {
    const kept = names(filterTrials(SUITE, { botMode: true }));
    for (const name of BOT_INCOMPATIBLE_TRIALS) {
      assert.ok(!kept.includes(name), `expected ${name} to be filtered`);
    }
    assert.ok(!kept.includes('survey-multi-choice'));
  });
});

describe('filterTrials — demo=replay', () => {
  it('drops the microphone trial', () => {
    const kept = names(filterTrials(SUITE, { replayDemo: true }));
    assert.ok(!kept.includes('bench-recording-trial'));
  });

  it('keeps every other recorder-exercising trial', () => {
    // These are the trials the replay demo exists to show off: they must
    // survive the preset even though bot-mode strips them.
    const kept = names(filterTrials(SUITE, { replayDemo: true }));
    for (const name of ['canvas-keyboard-response', 'sketchpad', 'free-sort']) {
      assert.ok(kept.includes(name), `expected ${name} to survive demo=replay`);
    }
    for (const name of [
      'instructions',
      'fullscreen',
      'html-keyboard-response',
      'html-button-response',
      'html-slider-response',
      'bench-describe-card',
    ]) {
      assert.ok(kept.includes(name), `expected ${name} to survive demo=replay`);
    }
  });

  it('removes exactly one trial more than the default timeline', () => {
    const base = filterTrials(SUITE).length;
    const demo = filterTrials(SUITE, { replayDemo: true }).length;
    assert.equal(demo, base - 1);
  });
});

describe('filter set invariants', () => {
  it('REPLAY_DEMO_FILTERED is a subset of BOT_INCOMPATIBLE_TRIALS', () => {
    // The demo reuses the bot-mode mechanism; if a name is ever added here
    // that bot-mode does not already strip, that is a deliberate decision and
    // this assertion should be revisited rather than silently drift.
    for (const name of REPLAY_DEMO_FILTERED) {
      assert.ok(
        BOT_INCOMPATIBLE_TRIALS.has(name),
        `${name} is filtered by demo=replay but not by bot-mode`
      );
    }
  });

  it('the filter sets do not overlap with ALWAYS_FILTERED', () => {
    for (const name of ALWAYS_FILTERED) {
      assert.ok(!BOT_INCOMPATIBLE_TRIALS.has(name));
      assert.ok(!REPLAY_DEMO_FILTERED.has(name));
    }
  });
});

describe('filterTrials — hygiene', () => {
  it('does not mutate the input array', () => {
    const input = [...SUITE];
    filterTrials(input, { botMode: true, replayDemo: true });
    assert.deepEqual(names(input), names(SUITE));
  });

  it('tolerates trials with no plugin info', () => {
    const kept = filterTrials([{}, trial('instructions')]);
    assert.equal(kept.length, 2);
  });
});
