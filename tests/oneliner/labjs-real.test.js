// ch.js against real lab.js builds (tests/fixtures/labjs-20.2.4 and
// labjs-23.0.0-alpha9, vendored, Apache-2.0) under happy-dom. The fakes in
// labjs-adapter.test.js cannot reproduce lab.js's own call order (a container
// ends inside its last child's end(); the flip generation ends a component
// twice), and the cases below depend on it. Forms are not driven here (a
// synthetic submit does not advance a lab.js Form under happy-dom); the
// Playwright suite owns forms and pastes into them.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createLabWindow, closeLabWindow, datastoreOf } from './support/labjs-window.js';

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// Runs a study to its end: resolves once the root's 'end' event fired and the
// root row had a frame to commit.
async function runToEnd(study, limitMs = 4000) {
  let ended = false;
  study.on('end', () => { ended = true; });
  study.run();
  for (let i = 0; i < limitMs / 5 && !ended; i++) await tick(5);
  assert.ok(ended, 'the study ended within ' + limitMs + ' ms');
  await tick(40);
  return datastoreOf(study).data;
}

for (const build of ['20.2.4', '23.0.0-alpha9']) {
  describe('the vendored lab.js ' + build + ' runs under happy-dom', () => {
    let win, lab;
    beforeEach(() => { ({ win, lab } = createLabWindow({ build })); });
    afterEach(async () => { await closeLabWindow(win); });

    it('a two-screen sequence commits three rows with sender ids', async () => {
      assert.strictEqual(lab.version, build);
      const study = new lab.flow.Sequence({ title: 'root', content: [
        new lab.html.Screen({ title: 'a', content: '<p>a</p>', timeout: 15 }),
        new lab.html.Screen({ title: 'b', content: '<p>b</p>', timeout: 15 })
      ] });
      const rows = await runToEnd(study);
      assert.deepStrictEqual(rows.map((r) => r.sender), ['a', 'b', 'root']);
      assert.deepStrictEqual(rows.slice(0, 2).map((r) => r.sender_id), ['0', '1']);
      assert.strictEqual(rows[0].ended_on, 'timeout');
    });
  });
}

// Teardown: Node's own globals the window shadowed come back, and a frame still
// pending from an unfinished study never fires against a closed window. The
// natives are read at import time, before any window existed.
const NATIVE = ['fetch', 'Event', 'EventTarget', 'CustomEvent', 'navigator', 'Blob', 'FormData'];
const NODE_GLOBALS = new Map(NATIVE.map((k) => [k, globalThis[k]]));

describe('closeLabWindow restores the process', () => {
  for (const build of ['20.2.4', '23.0.0-alpha9']) {
    it('lab.js ' + build + ': Node globals are back and no frame fires after close', async () => {
      const { win, lab } = createLabWindow({ build });
      let closed = false;
      let firedAfterClose = 0;
      let onFirstRequest;
      const firstRequest = new Promise((r) => { onFirstRequest = r; });
      const raf = win.requestAnimationFrame;
      globalThis.requestAnimationFrame = win.requestAnimationFrame = (cb) => {
        const id = raf((t) => { if (closed) { firedAfterClose++; return; } cb(t); });
        onFirstRequest();
        return id;
      };
      new lab.flow.Sequence({ title: 'root', content: [
        new lab.html.Screen({ title: 'a', content: '<p>a</p>', timeout: 10000 })
      ] }).run();
      await firstRequest;            // a frame is now pending (it fires 4 ms later)
      closed = true;
      await closeLabWindow(win);
      await tick(40);
      assert.strictEqual(firedAfterClose, 0, 'no frame fired after close');
      for (const k of NATIVE) {
        assert.ok(NODE_GLOBALS.get(k) !== undefined, k + ' is a Node global');
        assert.strictEqual(globalThis[k], NODE_GLOBALS.get(k), k + ' is Node\'s again');
      }
      assert.strictEqual(globalThis.window, undefined);
      assert.strictEqual(globalThis.document, undefined);
    });
  }
});
