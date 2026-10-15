// The bundled recorder's globals used to be plain assignments: a page's own
// window.CyborgHunterReplay (or a second copy of the recorder's file) was
// overwritten without a word. Like the guard cores, the recorder now keeps
// the first definition and says why it did not redefine it.
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('replay globals keep the first definition', () => {
  it('a page-defined CyborgHunterReplay and jsPsychCyborgHunterReplay survive the import, with an error', async () => {
    const mine = { mine: true };
    const myExt = function MyExtension() {};
    globalThis.window = { CyborgHunterReplay: mine, jsPsychCyborgHunterReplay: myExt };
    const errs = [];
    const origErr = console.error;
    console.error = (msg) => errs.push(String(msg));
    try {
      await import('../../src/jspsych/extension-cyborg-hunter-replay.js');
    } finally {
      console.error = origErr;
    }
    assert.strictEqual(globalThis.window.CyborgHunterReplay, mine);
    assert.strictEqual(globalThis.window.jsPsychCyborgHunterReplay, myExt);
    assert.strictEqual(errs.filter((e) => /Not redefining CyborgHunterReplay/.test(e)).length, 1);
    assert.strictEqual(errs.filter((e) => /Not redefining jsPsychCyborgHunterReplay/.test(e)).length, 1);
  });
});
