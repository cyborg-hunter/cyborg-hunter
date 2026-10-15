// A dom-tier continuation segment is a list of patches against the tree of
// the keyframe before it, by node id. When pieces go missing (rows filtered
// before saving, one POST refused), a continuation that follows the gap was
// put after the wrong keyframe: its ids then resolved against another tree,
// and typed text landed on the wrong element, with no defect flagged.
// Reassembly now leaves out continuations after a gap until the next
// keyframe, and says how many in the reassembly note. The trace tier has no
// keyframes and keeps every segment.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import * as CHReplay from '../../src/replay/index.js';
import { reassemblePieces } from '../../src/replay/pieces.js';
import { validateStrict } from '../../src/shared/schema-v2-validator.js';
import { recordingsFromPieces } from '../../src/cli/replay-pieces.js';

let win, rafQueue;
before(() => {
  win = new Window({ url: 'https://example.org/exp/' });
  win.document.body.innerHTML = '<div id="stage"><p id="m">one</p><input id="a"></div>';
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.MutationObserver = win.MutationObserver;
  rafQueue = [];
  globalThis.requestAnimationFrame = (fn) => rafQueue.push(fn);
});
after(() => {
  win.close();
  delete globalThis.window; delete globalThis.document;
  delete globalThis.MutationObserver; delete globalThis.requestAnimationFrame;
});

async function settle() {
  let quiet = 0;
  for (let i = 0; i < 50 && quiet < 2; i++) {
    await new Promise((r) => setImmediate(r));
    if (rafQueue.length) { rafQueue.splice(0).forEach((f) => f(0)); quiet = 0; } else quiet++;
  }
}
const viaJson = (x) => JSON.parse(JSON.stringify(x));

// Four trials at keyframeEvery 2: pieces 0..3 hold keyframe s0, continuation
// s1, (the change between trials as a continuation, then) keyframe s2,
// continuation s3; piece 4 is the end.
async function fourTrials() {
  const api = CHReplay.attach({ participantId: 'P', tier: 'dom', root: '#stage', keyframeEvery: 2, autoSave: { mode: 'none' } });
  api.startSession();
  const taker = api.pieceTaker({ recordingId: 'r-gap' });
  const doc = win.document;
  const pieces = [];
  const trial = async (id, fn) => {
    api.startTrial({ trialId: id }); fn(); await settle(); api.endTrial(); pieces.push(viaJson(taker.take()));
  };
  await trial('s0', () => { doc.getElementById('m').firstChild.data = 'A'; });
  await trial('s1', () => { doc.getElementById('m').firstChild.data = 'A2'; });
  doc.getElementById('stage').insertAdjacentHTML('afterbegin', '<div><span>new</span></div>');
  await settle();
  await trial('s2', () => { doc.getElementById('m').firstChild.data = 'B'; });
  await trial('s3', () => { doc.getElementById('m').firstChild.data = 'B2'; doc.getElementById('a').setAttribute('data-k', 'v'); });
  api.stopSession();
  pieces.push(viaJson(taker.take({ final: true })));
  api.destroy();
  return pieces;
}

describe('reassembly after a gap, dom tier', () => {
  it('sanity: the pieces hold keyframes and continuations', async () => {
    const rec = reassemblePieces(await fourTrials());
    assert.deepEqual(rec.segments.map((s) => [s.label, s.initial_dom !== null]),
      [['s0', true], ['s1', false], ['__session__', false], ['s2', true], ['s3', false]]);
  });

  it('a continuation after a missing keyframe is left out, and counted', async () => {
    const pieces = (await fourTrials()).filter((p) => p.seq !== 2);
    const rec = reassemblePieces(pieces);
    assert.deepEqual(validateStrict(rec).errors, []);
    assert.deepEqual(rec.segments.map((s) => s.label), ['s0', 's1']);
    const note = rec.extensions['cyborg-hunter'].reassembly;
    assert.deepEqual(note.missing_seq_ranges, [[2, 2]]);
    assert.equal(note.skipped_segments, 1);
  });

  it('after a missing continuation, the next keyframe and what follows it are kept', async () => {
    const pieces = (await fourTrials()).filter((p) => p.seq !== 1);
    const rec = reassemblePieces(pieces);
    // The between-trials continuation opens piece 2, right after the gap.
    assert.deepEqual(rec.segments.map((s) => s.label), ['s0', 's2', 's3']);
    assert.equal(rec.extensions['cyborg-hunter'].reassembly.skipped_segments, 1);
  });

  it('the CLI warning says that parts after the gap were left out', async () => {
    const pieces = (await fourTrials()).filter((p) => p.seq !== 2);
    const { warnings } = recordingsFromPieces([{ path: 'P.json', pieces }]);
    const text = warnings.map((w) => w.warnings.join(' ')).join('\n');
    assert.match(text, /1 of them are missing/);
    assert.match(text, /1 more segment .*left out/);
  });
});
