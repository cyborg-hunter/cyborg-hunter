// ch.js with the recorder bundled (build-targets.js `replay`) on real
// jsPsych 7.3.1: replay is on by default and its recording rides in the rows
// the experiment already saves, one piece per trial (src/replay/pieces.js).
//
// The case this exists for: a save-as-a-trial plugin (DataPipe's
// jsPsychPipe) takes its snapshot of jsPsych.data when the save trial starts,
// before initJsPsych's on_finish. A call-function trial that copies the data
// is that snapshot here. Every trial before it must be in the recording the
// CLI rebuilds from that copy.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import Papa from 'papaparse';
import { setBuild, buildOf } from './support/build-flags.js';
import { groupPieces, reassemblePieces } from '../../src/replay/pieces.js';
import { validateStrict } from '../../src/shared/schema-v2-validator.js';

const FIX = new URL('../fixtures/jspsych-7.3.1/', import.meta.url);
let win, boot, restoreBuild;

before(async () => {
  restoreBuild = setBuild(buildOf('ch.js'));
  win = new Window({ url: 'https://lab.example/study.html' });
  for (const k of ['document', 'Node', 'MutationObserver', 'HTMLElement', 'Element', 'navigator', 'location',
    'getComputedStyle', 'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'Document', 'EventTarget', 'screen', 'NodeFilter']) {
    try { globalThis[k] = win[k]; } catch { /* read-only in this node version */ }
  }
  globalThis.window = win;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.addEventListener = win.addEventListener.bind(win);
  for (const f of ['jspsych.js', 'plugin-call-function.js', 'plugin-html-button-response.js']) {
    vm.runInThisContext(readFileSync(new URL(f, FIX), 'utf8'), { filename: f });
  }
  win.jsPsychModule = globalThis.jsPsychModule;
  await import('../../src/jspsych/extension-guard-friction.js');
  await import('../../src/jspsych/extension-guard-honeypot.js');
  // What entry-replay.js bundles: both globals, defined before boot.
  await import('../../src/jspsych/extension-cyborg-hunter-replay.js');
  assert.equal(typeof win.jsPsychCyborgHunterReplay, 'function');
  assert.equal(typeof win.CyborgHunterReplay.attach, 'function');
  ({ boot } = await import('../../src/oneliner/boot.js'));
});

after(async () => {
  restoreBuild();
  await win.happyDOM.close();
});

let errors, orig, current;
beforeEach(() => {
  errors = [];
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (...a) => errors.push(a.map(String).join(' '));
  console.warn = () => {};
  console.info = () => {};
  delete win.__cyborgHunterLoaded;
  delete win.CyborgHunter;
  delete win.CyborgHunterConfig;
  win.initJsPsych = globalThis.jsPsychModule.initJsPsych;
  win.document.documentElement.removeAttribute('jspsych');
  win.document.body.innerHTML = '';
});
afterEach(() => {
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  try { if (current) current.monitor.destroy(); } catch { /* the final hook destroyed it */ }
  current = null;
});

function bootCh(dataset) {
  const ctx = boot({ script: { dataset: Object.assign({ participantId: 'P-ROWS' }, dataset || {}), src: 'https://x/ch.js' }, win });
  assert.ok(ctx, 'ch.js booted');
  current = ctx;
  return ctx;
}

class Timer {
  static info = { name: 'timer', parameters: {} };
  constructor(jsPsych) { this.jsPsych = jsPsych; }
  trial(el, trial) {
    el.innerHTML = '<p>' + (trial.text || 'timer') + '</p>';
    setTimeout(() => this.jsPsych.finishTrial({}), 5);
  }
}
const timer = (text) => ({ type: Timer, text });

// Every piece in a set of rows, the way the CLI will find them.
const piecesIn = (rows) => rows.flatMap((r) => [r.cyborgHunterReplay, r.cyborgHunterReplayFinal]).filter(Boolean);

function rebuild(rows) {
  const groups = groupPieces(piecesIn(rows));
  assert.equal(groups.size, 1, 'one recording');
  const rec = reassemblePieces([...groups.values()][0]);
  assert.deepStrictEqual(validateStrict(rec).errors, []);
  return rec;
}

describe('ch.js with the bundled recorder on real jsPsych', () => {
  it('records by default, loads no second script, and the rows rebuild the whole recording', async () => {
    const ctx = bootCh();
    assert.deepStrictEqual(ctx.config.replay, { tier: 'trace' });
    const jsPsych = win.initJsPsych({});
    await jsPsych.run([timer('a'), timer('b'), timer('c')]);
    const rows = jsPsych.data.get().values();
    assert.ok(rows.every((r) => r.cyborgHunterReplay), 'every trial row carries its piece');
    assert.ok(rows[rows.length - 1].cyborgHunterReplayFinal, 'the last row carries the final piece');
    const rec = rebuild(rows);
    assert.equal(rec.extensions['cyborg-hunter'].reassembly, undefined, 'complete');
    assert.equal(rec.participant_id, 'P-ROWS');
    assert.equal(rec.end_reason, 'finished');
    assert.deepStrictEqual(rec.host, { name: 'jspsych', version: '7.3.1' });
    assert.ok(rec.segments.length >= 3);
    assert.equal(rows[0].integrityReplayMeta.saved_to, 'rows');
    assert.equal(win.document.querySelectorAll('script[src*="cyborg-hunter-replay"]').length, 0);
    // CyborgHunter.replay() still returns the whole recording, the same segments.
    const whole = win.CyborgHunter.replay();
    assert.deepStrictEqual(whole.segments, rec.segments);
    assert.deepStrictEqual(errors, []);
  });

  it('a save trial mid-timeline (DataPipe-style snapshot) has every earlier trial', async () => {
    bootCh();
    const jsPsych = win.initJsPsych({});
    let snapshot = null;
    await jsPsych.run([
      timer('one'), timer('two'), timer('three'),
      { type: globalThis.jsPsychCallFunction, func: () => { snapshot = JSON.parse(JSON.stringify(jsPsych.data.get().values())); } },
      timer('after the save')
    ]);
    assert.equal(snapshot.length, 3, 'the snapshot holds the three rows before the save trial');
    const rec = rebuild(snapshot);
    assert.deepStrictEqual(rec.extensions['cyborg-hunter'].reassembly,
      { complete: false, missing_seq_ranges: [], missing_end: true });
    // The three trials before the save trial, each as its own segment.
    const full = rebuild(jsPsych.data.get().values());
    assert.deepStrictEqual(rec.segments, full.segments.slice(0, rec.segments.length));
    assert.ok(rec.segments.length >= 3);
    assert.deepStrictEqual(errors, []);
  });

  it('pieces survive a CSV save (jsPsych.data.get().csv())', async () => {
    bootCh();
    const jsPsych = win.initJsPsych({});
    await jsPsych.run([timer('a'), timer('b')]);
    const csv = jsPsych.data.get().csv();
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
    const rows = parsed.map((r) => ({
      cyborgHunterReplay: r.cyborgHunterReplay ? JSON.parse(r.cyborgHunterReplay) : undefined,
      cyborgHunterReplayFinal: r.cyborgHunterReplayFinal ? JSON.parse(r.cyborgHunterReplayFinal) : undefined
    }));
    const fromCsv = rebuild(rows);
    assert.deepStrictEqual(fromCsv, rebuild(jsPsych.data.get().values()));
  });

  for (const off of ['off', 'none', 'false']) {
    it(`data-replay="${off}" records nothing`, async () => {
      const ctx = bootCh({ replay: off });
      assert.equal(ctx.config.replay, null);
      const jsPsych = win.initJsPsych({});
      await jsPsych.run([timer('a')]);
      const rows = jsPsych.data.get().values();
      assert.ok(rows.every((r) => !('cyborgHunterReplay' in r) && !('cyborgHunterReplayFinal' in r)));
      assert.deepStrictEqual(errors, []);
    });
  }
});
