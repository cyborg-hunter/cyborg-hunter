// On the trace tier (the one-line setup's default) there is no snapshot walk
// to mark what sits inside a redacted container, so a field the page moved
// out of a [data-ch-redact] container before the participant typed in it was
// recorded key by key; the dom tier withheld the same keys. Every recording
// trial now marks the redacted containers' contents at its start, so a field
// that was inside one when a trial began stays withheld on both tiers.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import * as CHReplay from '../../src/replay/index.js';

let win;
before(() => {
  win = new Window({ url: 'https://example.org/exp/' });
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.MutationObserver = win.MutationObserver;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
});
after(() => {
  win.close();
  delete globalThis.window; delete globalThis.document;
  delete globalThis.MutationObserver; delete globalThis.requestAnimationFrame;
});

const settle = () => new Promise((r) => setTimeout(r, 20));

function typeInto(el, text) {
  for (const ch of text) {
    el.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, key: ch, code: 'Key' + ch.toUpperCase() }));
    el.value = (el.value || '') + ch;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  }
}

for (const tier of ['trace', 'dom']) {
  describe('a field moved out of a redacted container, ' + tier + ' tier', () => {
    it('keeps its keys withheld', async () => {
      win.document.body.innerHTML =
        '<div id="stage"><div data-ch-redact><div id="box-' + tier + '"><input id="f-' + tier + '"></div></div></div>';
      const api = CHReplay.attach({ participantId: 'P', tier, autoSave: { mode: 'none' } });
      api.startSession();
      api.startTrial({ trialId: 't1' });
      win.document.getElementById('stage').appendChild(win.document.getElementById('box-' + tier));
      await settle();
      typeInto(win.document.getElementById('f-' + tier), 'QZXW');
      await settle();
      api.endTrial();
      api.stopSession('finished');
      const rec = api.getRecording();
      api.destroy();
      const keys = rec.segments.flatMap((s) => s.events).filter((e) => e.type === 'key.down');
      assert.ok(keys.length >= 4, 'the key presses are recorded');
      assert.deepEqual(keys.filter((e) => /[QZXW]/.test(String(e.key))), [], 'no key identity');
    });
  });
}
