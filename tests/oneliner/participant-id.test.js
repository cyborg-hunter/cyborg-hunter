// Participant-id resolution: a URL parameter from the injected list, then the
// data-participant-id attribute, then CyborgHunterConfig.participantId, then a
// random id (which the boot warns about: the rows cannot be linked).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveParticipantId, randomParticipantId } from '../../src/oneliner/participant-id.js';

const never = () => { throw new Error('random() must not be called'); };

describe('resolveParticipantId', () => {
  it('reads the first listed URL parameter present in the query string', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '?workerId=W9&x=1', params: ['PP', 'workerId'], random: never }),
      { id: 'W9', source: 'url:workerId' });
  });

  it('the first matching name in params wins, not the first in the URL', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '?workerId=W9&participant=P1', params: ['participant', 'workerId'], random: never }),
      { id: 'P1', source: 'url:participant' });
  });

  it('a URL parameter beats the attribute and the config', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '?participant=P1', attr: 'A1', configId: 'C1', params: ['participant'], random: never }),
      { id: 'P1', source: 'url:participant' });
  });

  it('parameters not in the list are ignored', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '?workerId=W9', attr: 'A1', params: ['participant'], random: never }),
      { id: 'A1', source: 'attribute' });
  });

  it('the attribute beats the config', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '', attr: 'A1', configId: 'C1', params: [], random: never }),
      { id: 'A1', source: 'attribute' });
  });

  it('the config is used when there is no URL parameter or attribute', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '?x=1', configId: 'C1', params: ['workerId'], random: never }),
      { id: 'C1', source: 'config' });
  });

  it('nothing found → random() is used, source random', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '', params: ['workerId'], random: () => 'ch-aaaaaaaaaaaa' }),
      { id: 'ch-aaaaaaaaaaaa', source: 'random' });
  });

  it('ids are trimmed; empty or blank values count as missing', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '?workerId=%20%20&participant=', attr: '  ', configId: '  C1 ', params: ['workerId', 'participant'], random: never }),
      { id: 'C1', source: 'config' });
    assert.deepStrictEqual(
      resolveParticipantId({ search: '?workerId=%20W9%20', params: ['workerId'], random: never }),
      { id: 'W9', source: 'url:workerId' });
  });

  it('a non-string config id (e.g. a number) is accepted as text', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '', configId: 42, params: [], random: never }),
      { id: '42', source: 'config' });
  });

  it('works with no params list (the default list is supplied by the caller)', () => {
    assert.deepStrictEqual(
      resolveParticipantId({ search: '?workerId=W9', attr: 'A1', random: never }),
      { id: 'A1', source: 'attribute' });
  });
});

describe('randomParticipantId', () => {
  it("is 'ch-' followed by 12 lowercase hex characters", () => {
    for (let i = 0; i < 20; i++) assert.match(randomParticipantId(globalThis.crypto), /^ch-[0-9a-f]{12}$/);
  });

  it('draws from the given crypto.getRandomValues', () => {
    const fake = { getRandomValues: (a) => { a.fill(0xab); return a; } };
    assert.strictEqual(randomParticipantId(fake), 'ch-abababababab');
  });
});
