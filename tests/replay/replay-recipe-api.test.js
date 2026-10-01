// tests/replay/replay-recipe-api.test.js
// Pins the API surface that docs/using-cyborg-hunter.md's "Saving the replay
// to your own server" recipe calls, so a rename breaks a test instead of
// silently breaking researchers' copy-pasted code.
//
// Imports are DYNAMIC on purpose: static imports are hoisted above the window
// stub, and index.js only assigns window.CyborgHunterReplay when a window
// exists at evaluation time.

import { describe, it, before } from 'node:test';
import assert from 'node:assert';

let CHReplay;
let CyborgHunterReplayExtension;

before(async () => {
  globalThis.window = { innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {} };
  globalThis.document = {
    body: { nodeType: 1, tagName: 'BODY', attributes: [], childNodes: [] },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    styleSheets: [],
  };
  // The query string gives this file its own evaluation of index.js, so the
  // window assignment runs against the stub above even if another test file
  // already loaded the module without one.
  CHReplay = await import('../../src/replay/index.js?recipe-api');
  ({ CyborgHunterReplayExtension } =
    await import('../../src/jspsych/extension-cyborg-hunter-replay.js'));
});

describe('replay recipe API', () => {
  it('attach() returns getRecording, getRecordingCompressed and stopSession', () => {
    const api = CHReplay.attach({ participantId: 'P1', autoSave: { mode: 'none' } });
    try {
      for (const name of ['getRecording', 'getRecordingCompressed', 'stopSession']) {
        assert.strictEqual(typeof api[name], 'function', name);
      }
    } finally { api.destroy(); }
  });

  it('the jsPsych replay extension has finalize and getLastRecording', () => {
    for (const name of ['finalize', 'getLastRecording']) {
      assert.strictEqual(typeof CyborgHunterReplayExtension.prototype[name], 'function', name);
    }
  });

  it('replayFilename names the file <pid>-replay-<epoch>.json', () => {
    const name = CHReplay.replayFilename({
      participant_id: 'P1', recording_started_at: new Date().toISOString(),
    });
    assert.match(name, /^P1-replay-\d+\.json$/);
  });

  it('replayFilename sanitizes the participant id the way the CLI expects', () => {
    const name = CHReplay.replayFilename({
      participant_id: 'P 1/x', recording_started_at: new Date().toISOString(),
    });
    assert.match(name, /^P_1_x-replay-\d+\.json$/);
  });

  it('the browser global exposes replayFilename next to attach', () => {
    assert.strictEqual(typeof globalThis.window.CyborgHunterReplay.attach, 'function');
    assert.strictEqual(globalThis.window.CyborgHunterReplay.replayFilename, CHReplay.replayFilename);
  });
});
