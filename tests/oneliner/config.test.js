// readConfig merges the ch.js tag's data-* attributes with
// window.CyborgHunterConfig. Attributes win; everything that is not a
// one-liner key passes through to init() untouched.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readConfig, DATA_KEYS } from '../../src/oneliner/config.js';

let warns, origWarn;
beforeEach(() => { warns = []; origWarn = console.warn; console.warn = (m) => warns.push(String(m)); });
afterEach(() => { console.warn = origWarn; });

describe('readConfig', () => {
  it('DATA_KEYS lists the tag attributes the one-liner reads', () => {
    assert.deepStrictEqual(DATA_KEYS, ['preset', 'participantId', 'guards', 'replay', 'replaySrc', 'debug']);
  });

  it('reads the tag attributes (bare data-replay / data-debug count as set)', () => {
    const c = readConfig({ dataset: { preset: 'strict', guards: 'none', replay: '', debug: '' } });
    assert.strictEqual(c.preset, 'strict');
    assert.deepStrictEqual(c.guards, { honeypot: false, friction: false });
    assert.strictEqual(c.replay.tier, 'trace');
    assert.strictEqual(c.debug, true);
  });

  it('defaults: standard preset, honeypot on, friction off, no replay, no debug', () => {
    const c = readConfig({ dataset: {} });
    assert.strictEqual(c.preset, 'standard');
    assert.deepStrictEqual(c.guards, { honeypot: true, friction: false });
    assert.strictEqual(c.replay, null);
    assert.strictEqual(c.replaySrc, null);
    assert.strictEqual(c.debug, false);
    assert.strictEqual(c.participantIdAttr, null);
    assert.deepStrictEqual(c.monitor, {});
  });

  it('works with no dataset and no global config at all', () => {
    const c = readConfig({});
    assert.strictEqual(c.preset, 'standard');
    assert.deepStrictEqual(c.monitor, {});
  });

  it('a tag attribute wins over CyborgHunterConfig', () => {
    const c = readConfig({ dataset: { preset: 'strict' }, globalConfig: { preset: 'permissive' } });
    assert.strictEqual(c.preset, 'strict');
  });

  it('CyborgHunterConfig is used where the tag says nothing', () => {
    const c = readConfig({ dataset: {}, globalConfig: { preset: 'permissive', guards: 'friction', replay: 'dom', debug: true } });
    assert.strictEqual(c.preset, 'permissive');
    assert.deepStrictEqual(c.guards, { honeypot: false, friction: true });
    assert.deepStrictEqual(c.replay, { tier: 'dom' });
    assert.strictEqual(c.debug, true);
  });

  it("guards: 'honeypot,friction' turns both on (spaces and case tolerated)", () => {
    assert.deepStrictEqual(readConfig({ dataset: { guards: 'honeypot,friction' } }).guards, { honeypot: true, friction: true });
    assert.deepStrictEqual(readConfig({ dataset: { guards: ' Friction , HONEYPOT ' } }).guards, { honeypot: true, friction: true });
    assert.deepStrictEqual(readConfig({ dataset: { guards: 'friction' } }).guards, { honeypot: false, friction: true });
  });

  it('an unknown guard name is ignored with a warning', () => {
    const c = readConfig({ dataset: { guards: 'honeypot,frcition' } });
    assert.deepStrictEqual(c.guards, { honeypot: true, friction: false });
    assert.ok(warns.some((w) => w.includes('frcition')), warns.join('\n'));
  });

  it("data-replay: 'trace' → trace, 'dom' → dom; an unknown tier warns and records the trace tier", () => {
    assert.deepStrictEqual(readConfig({ dataset: { replay: 'trace' } }).replay, { tier: 'trace' });
    assert.deepStrictEqual(readConfig({ dataset: { replay: 'dom' } }).replay, { tier: 'dom' });
    assert.deepStrictEqual(readConfig({ dataset: { replay: 'full' } }).replay, { tier: 'trace' });
    assert.ok(warns.some((w) => w.includes('full')), warns.join('\n'));
  });

  it('data-debug="false" turns debug off', () => {
    assert.strictEqual(readConfig({ dataset: { debug: 'false' } }).debug, false);
  });

  it('data-participant-id and data-replay-src are read', () => {
    const c = readConfig({ dataset: { participantId: 'A1', replaySrc: 'https://cdn/r.js' } });
    assert.strictEqual(c.participantIdAttr, 'A1');
    assert.strictEqual(c.replaySrc, 'https://cdn/r.js');
  });

  it('autoMonitor / excludeTrialTypes are dropped with a warning; other init() keys are kept', () => {
    const scoring = { softScoreThreshold: 9 };
    const c = readConfig({ dataset: {}, globalConfig: { autoMonitor: false, excludeTrialTypes: ['x'], scoring, typoKey: 1 } });
    assert.deepStrictEqual(c.monitor.scoring, scoring);
    assert.strictEqual(c.monitor.typoKey, 1);   // left to init()'s own "did you mean" warning
    assert.ok(!('autoMonitor' in c.monitor));
    assert.ok(!('excludeTrialTypes' in c.monitor));
    assert.ok(warns.some((w) => w.includes('autoMonitor')), warns.join('\n'));
    assert.ok(warns.some((w) => w.includes('excludeTrialTypes')), warns.join('\n'));
  });

  it('one-liner keys do not leak into the init() config; participantId rides through for the resolver', () => {
    const c = readConfig({ dataset: {}, globalConfig: { preset: 'strict', guards: 'none', replay: 'dom', replaySrc: 'x', debug: true, participantId: 'C1' } });
    assert.deepStrictEqual(c.monitor, { participantId: 'C1' });
  });
});
