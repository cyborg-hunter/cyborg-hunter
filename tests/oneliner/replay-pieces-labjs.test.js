// ch-labjs.js with the recorder bundled (build-targets.js `replay`) on the
// vendored lab.js builds: replay is on by default and its recording rides in
// the rows lab.js commits, one piece per trial row and the final piece with
// the other final fields (src/replay/pieces.js).
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createLabWindow, closeLabWindow, datastoreOf } from './support/labjs-window.js';
import { setBuild, buildOf } from './support/build-flags.js';
import { attach as attachRecorder } from '../../src/replay/index.js';
import { CyborgHunterReplayExtension } from '../../src/jspsych/extension-cyborg-hunter-replay.js';
import { groupPieces, reassemblePieces } from '../../src/replay/pieces.js';
import { validateStrict } from '../../src/shared/schema-v2-validator.js';

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

async function runToEnd(study, limitMs = 4000) {
  let ended = false;
  study.on('end', () => { ended = true; });
  study.run();
  for (let i = 0; i < limitMs / 5 && !ended; i++) await tick(5);
  assert.ok(ended, 'the study ended within ' + limitMs + ' ms');
  await tick(40);
  return datastoreOf(study).data;
}

let restoreBuild;
before(() => { restoreBuild = setBuild(buildOf('ch-labjs.js')); });
after(() => restoreBuild());

let errors, orig, current, win;
beforeEach(() => {
  errors = [];
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (...a) => errors.push(a.map(String).join(' '));
  console.warn = () => {};
  console.info = () => {};
});
afterEach(async () => {
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  try { if (current) current.monitor.destroy(); } catch { /* the final hook destroyed it */ }
  try { if (current && current.replay && current.replay.api) current.replay.api.destroy(); } catch { /* destroyed */ }
  current = null;
  if (win) await closeLabWindow(win);
  win = null;
});

async function bootCh(w, dataset) {
  // What entry-replay.js bundles: both globals, defined before boot.
  w.CyborgHunterReplay = { attach: attachRecorder };
  w.jsPsychCyborgHunterReplay = CyborgHunterReplayExtension;
  const { boot } = await import('../../src/oneliner/boot.js');
  const ctx = boot({ script: { dataset: Object.assign({ participantId: 'P-LAB', guards: 'none' }, dataset || {}), src: 'https://x/ch-labjs.js' }, win: w });
  assert.ok(ctx, 'ch-labjs.js booted');
  current = ctx;
  await tick();   // the standalone recorder starts on a microtask
  return ctx;
}

const piecesIn = (rows) => rows.flatMap((r) => [r.cyborgHunterReplay, r.cyborgHunterReplayFinal]).filter(Boolean);

// lab.js 23 is not hooked yet (it runs as a page without a framework, whose
// pieces go with the POST; replay-pieces-vanilla.test.js), so 20.x only.
for (const build of ['20.2.4']) {
  describe('ch-labjs.js with the bundled recorder on lab.js ' + build, () => {
    it('trial rows carry their pieces, and the rows rebuild the whole recording', async () => {
      let lab;
      ({ win, lab } = createLabWindow({ build }));
      const ctx = await bootCh(win);
      assert.deepStrictEqual(ctx.config.replay, { tier: 'trace' });
      assert.equal(ctx.host, 'labjs');
      const study = new lab.flow.Sequence({ title: 'root', content: [
        new lab.html.Screen({ title: 'a', content: '<p>a</p>', timeout: 20 }),
        new lab.html.Screen({ title: 'b', content: '<p>b</p>', timeout: 20 })
      ] });
      const rows = await runToEnd(study);
      const trialRows = rows.filter((r) => r.sender === 'a' || r.sender === 'b');
      assert.ok(trialRows.every((r) => r.cyborgHunterReplay), 'each trial row carries a piece');
      const groups = groupPieces(piecesIn(rows));
      assert.equal(groups.size, 1);
      const rec = reassemblePieces([...groups.values()][0]);
      assert.deepStrictEqual(validateStrict(rec).errors, []);
      assert.equal(rec.extensions['cyborg-hunter'].reassembly, undefined, 'complete');
      assert.equal(rec.participant_id, 'P-LAB');
      assert.ok(rec.segments.length >= 2);
      assert.equal(win.document.querySelectorAll('script[src*="cyborg-hunter-replay"]').length, 0);
      assert.deepStrictEqual(errors, []);
    });

    it('data-replay="off" puts nothing in the rows', async () => {
      let lab;
      ({ win, lab } = createLabWindow({ build }));
      const ctx = await bootCh(win, { replay: 'off' });
      assert.equal(ctx.config.replay, null);
      const study = new lab.flow.Sequence({ title: 'root', content: [
        new lab.html.Screen({ title: 'a', content: '<p>a</p>', timeout: 20 })
      ] });
      const rows = await runToEnd(study);
      assert.equal(piecesIn(rows).length, 0);
      assert.deepStrictEqual(errors, []);
    });
  });
}
