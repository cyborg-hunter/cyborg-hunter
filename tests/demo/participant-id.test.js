// The visitor's id: DEMO- and four base-36 characters, never one of the
// bundled sessions' (the files step would show two cards with one name, and
// Load sample data would skip that session as already listed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomParticipantId, drawSuffix } from '../../demo/participant-id.js';
import { BUNDLED_IDS } from '../../demo/steps.js';

test('draws again when the id names a bundled session', () => {
  const draws = ['bsq6', '9mop', 'zz12'];
  assert.equal(randomParticipantId(() => draws.shift(), BUNDLED_IDS), 'DEMO-zz12');
  assert.deepEqual(draws, []);
});

test('the default draw is four base-36 characters, padded when the number is short', () => {
  assert.match(drawSuffix(() => 0), /^[a-z0-9]{4}$/);
  assert.equal(drawSuffix(() => 0), '0000');
  assert.match(drawSuffix(Math.random), /^[a-z0-9]{4}$/);
  assert.match(randomParticipantId(), /^DEMO-[a-z0-9]{4}$/);
});
