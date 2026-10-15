// The recorder's privacy settings used to fail open: `keys` recorded every
// key unless it was exactly 'off' (so keys: false or 'none' recorded them
// all), `clipboardContent: 'false'` stored pasted text, and a misspelt key
// (clipboardContents, redactSelecter) was ignored without a word. The
// recorder now accepts only the documented values, turns anything else off
// (or to the trace tier) with a warning, and warns on unknown keys.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createRecorder } from '../../src/replay/recorder.js';

let warnings, origWarn;
beforeEach(() => {
  globalThis.window = { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 };
  warnings = [];
  origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
});
afterEach(() => { console.warn = origWarn; });

const make = (cfg) => createRecorder(Object.assign({ participantId: 'P', autoSave: { mode: 'none' } }, cfg));

describe('recorder config fails closed', () => {
  for (const bad of [false, 'none', 'FULL', null, 0]) {
    it(`keys: ${JSON.stringify(bad)} records no key identities, with a warning`, () => {
      const rec = make({ keys: bad });
      assert.strictEqual(rec.config.keys, 'off');
      assert.ok(warnings.some((w) => /keys/.test(w) && /off/.test(w)), warnings.join('\n'));
    });
  }

  for (const bad of ['false', 'true', 1]) {
    it(`clipboardContent: ${JSON.stringify(bad)} keeps lengths only, with a warning`, () => {
      const rec = make({ clipboardContent: bad });
      assert.strictEqual(rec.config.clipboardContent, false);
      assert.ok(warnings.some((w) => /clipboardContent/.test(w)), warnings.join('\n'));
    });
  }

  it('keepBait other than true or false is off, with a warning', () => {
    assert.strictEqual(make({ keepBait: 'yes' }).config.keepBait, false);
    assert.ok(warnings.some((w) => /keepBait/.test(w)));
  });

  it('an unknown tier records the trace tier and says so; the file never echoes it', () => {
    const rec = make({ tier: 'DOM' });
    assert.strictEqual(rec.config.tier, 'trace');
    assert.ok(warnings.some((w) => /tier/.test(w) && /trace/.test(w)), warnings.join('\n'));
  });

  it('warns on an unknown key, naming the closest one', () => {
    make({ clipboardContents: true, redactSelecter: '.x' });
    assert.ok(warnings.some((w) => /"clipboardContents".*"clipboardContent"/.test(w)), warnings.join('\n'));
    assert.ok(warnings.some((w) => /"redactSelecter".*"redactSelector"/.test(w)), warnings.join('\n'));
  });

  it('warns on an unknown autoSave key', () => {
    make({ autoSave: { mode: 'none', experimentID: 'X' } });
    assert.ok(warnings.some((w) => /autoSave\.experimentID/.test(w) && /experimentId/.test(w)), warnings.join('\n'));
  });

  it('the documented values pass unchanged and silently', () => {
    const rec = make({ keys: 'off', clipboardContent: true, keepBait: false, tier: 'dom',
      redactSelector: '.p', mouseHz: 20, autoSave: { mode: 'datapipe', experimentId: 'X' } });
    assert.deepStrictEqual(
      [rec.config.keys, rec.config.clipboardContent, rec.config.tier],
      ['off', true, 'dom']);
    assert.deepStrictEqual(warnings, []);
    make({ keys: 'full', tier: 'trace' });
    make({ tier: 'canvas' });
    assert.deepStrictEqual(warnings, []);
  });
});
