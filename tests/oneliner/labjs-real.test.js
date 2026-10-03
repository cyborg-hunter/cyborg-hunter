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
import { VERSION } from '../../src/shared/constants.js';
import { installLabJsAdapter } from '../../src/oneliner/adapters/labjs.js';

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

let bootCh, errors, warns, orig, current;
async function bootOn(win, dataset) {
  ({ boot: bootCh } = await import('../../src/oneliner/boot.js'));
  const ctx = bootCh({ script: { dataset: Object.assign({ participantId: 'P1', guards: 'none' }, dataset || {}), src: 'https://x/ch.js' }, win });
  assert.ok(ctx, 'ch.js booted');
  if (!ctx.labjsAdapter) ctx.labjsAdapter = installLabJsAdapter({ win, ctx, lab: win.lab, version: win.lab.version, generation: typeof win.lab.core.Component.prototype.lock === 'function' ? 'flip' : 'classic' });
  current = ctx;
  return ctx;
}
function captureConsole() {
  errors = []; warns = [];
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (...a) => errors.push(a.map(String).join(' '));
  console.warn = (...a) => warns.push(a.map(String).join(' '));
  console.info = () => {};
}
function releaseConsole() { console.error = orig.error; console.warn = orig.warn; console.info = orig.info; }
function paste(win, text) {
  const ta = win.document.createElement('textarea');
  win.document.body.appendChild(ta);
  ta.focus();
  const ev = new win.Event('paste', { bubbles: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
  ta.dispatchEvent(ev);
}
const withSegment = (rows) => rows.filter((r) => r.integritySegment);
const screen = (lab, title, extra) => new lab.html.Screen(Object.assign({ title, content: '<p>' + title + '</p>', timeout: 15 }, extra || {}));

describe('ch.js on real lab.js 20.2.4: trials and rows', () => {
  let win, lab;
  beforeEach(() => { ({ win, lab } = createLabWindow({ build: '20.2.4' })); captureConsole(); });
  afterEach(async () => {
    releaseConsole();
    try { if (current) current.monitor.destroy(); } catch { /* the final hook destroyed it */ }
    current = null;
    await closeLabWindow(win);
  });

  it('every leaf is a trial, containers and skipped components get no columns, the root row commits last', async () => {
    const ctx = await bootOn(win);
    assert.strictEqual(ctx.labjs.generation, 'classic');
    const study = new lab.flow.Sequence({ title: 'root', content: [
      screen(lab, 'intro'),
      new lab.flow.Loop({ title: 'loop', template: screen(lab, 'item', { content: '<p>${ parameters.p }</p>' }), templateParameters: [{ p: 1 }, { p: 2 }] }),
      new lab.canvas.Screen({ title: 'shapes', content: [{ type: 'rect', left: 0, top: 0, width: 10, height: 10, fill: '#000' }], timeout: 15 }),
      new lab.html.Frame({ title: 'frame', context: '<div><main id="in"></main></div>', contextSelector: '#in', content: screen(lab, 'inner') }),
      new lab.core.Dummy({ title: 'bye' })
    ] });
    const rows = await runToEnd(study);
    assert.deepStrictEqual(rows.map((r) => r.sender), ['intro', 'item', 'item', 'loop', 'shapes', 'inner', 'frame', 'bye', 'root']);
    const trials = withSegment(rows);
    assert.deepStrictEqual(trials.map((r) => r.integritySegment.trialId), ['0', '1_0', '1_1', '2', '3_0']);
    assert.deepStrictEqual(trials.map((r) => r.integritySegment.segmentIndex), [0, 1, 2, 3, 4]);
    for (const r of trials) {
      assert.strictEqual(r.integritySegment.source, 'host');
      assert.strictEqual(r.integrity.trialId, r.integritySegment.trialId);
      assert.strictEqual(typeof r.integrity.trialStart_perfNow, 'number');
      assert.strictEqual(r.participantId, 'P1');
      assert.strictEqual(r.cyborgHunterVersion, VERSION);
      assert.strictEqual(typeof r.integritySoftScore, 'number');
      assert.ok(!('cyborgHunterError' in r), JSON.stringify(r.cyborgHunterError));
    }
    for (const s of ['loop', 'frame', 'bye', 'root']) {
      const r = rows.find((x) => x.sender === s);
      assert.ok(!('integritySegment' in r) && !('integrity' in r), s + ' carries no columns');
    }
    assert.strictEqual(ctx.labjs.trialsRun, 5);
    assert.strictEqual(ctx.labjs.segmentsWritten, 5);
    assert.deepStrictEqual(errors, []);
  });

  it('a paste during a trial lands in that trial; one before the first trial is a gap on the first segment', async () => {
    await bootOn(win);
    paste(win, 'early');
    const study = new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a', { timeout: 60 }), screen(lab, 'b')] });
    const ended = runToEnd(study);
    for (let i = 0; i < 100 && !win.document.querySelector('main p'); i++) await tick(2);
    paste(win, 'during a');
    const rows = await ended;
    const [a, b] = withSegment(rows);
    assert.strictEqual(a.integrity.pasteEvents.length, 1);
    assert.strictEqual(a.integritySegment.gap.length, 1, 'the early paste is the boot gap on the first segment');
    assert.strictEqual(a.integritySegment.gap[0].pasteEvents.length, 1);
    assert.strictEqual(b.integrity.pasteEvents.length, 0);
    assert.strictEqual(b.integrityPasteCount, 2, 'running totals count both');
  });

  it('naming: options.cyborgHunter, a Sequence-level chPhase parameter, a data-ch-trial element', async () => {
    const ctx = await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root', parameters: { chPhase: 'practice' }, content: [
      screen(lab, 'a', { cyborgHunter: { trialId: 'named-a', phase: 'test' } }),
      screen(lab, 'b', { parameters: { chTrialId: 'param-b' } }),
      screen(lab, 'c', { content: '<p data-ch-trial="mark-c">c</p>' })
    ] });
    const rows = await runToEnd(study);
    assert.deepStrictEqual(withSegment(rows).map((r) => [r.integritySegment.trialId, r.integrity.phase]),
      [['named-a', 'test'], ['param-b', 'practice'], ['mark-c', 'practice']]);
    assert.strictEqual(ctx.labjs.trialsRun, 3);
  });

  // The root's run() prepares the whole tree first (20.x run() calls
  // prepare() when the component is not prepared, and prepareNested recurses
  // through Parallel.onPrepare), so every child has its id before any run.
  it('a Parallel is one trial; its children get no columns', async () => {
    await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root', content: [
      new lab.flow.Parallel({ title: 'par', mode: 'all', content: [screen(lab, 'p1'), screen(lab, 'p2', { timeout: 25 })] }),
      screen(lab, 'after')
    ] });
    const rows = await runToEnd(study);
    assert.deepStrictEqual(withSegment(rows).map((r) => r.sender), ['par', 'after']);
    assert.ok(!('integritySegment' in rows.find((r) => r.sender === 'p1')));
  });

  it('the hooks pass this, arguments and return values through, and restore() puts the originals back', async () => {
    const proto = lab.core.Component.prototype;
    const origRun = proto.run, origEnd = proto.end;
    const ctx = await bootOn(win);
    assert.notStrictEqual(proto.run, origRun);
    const c = screen(lab, 'solo');
    const p = c.run();
    assert.strictEqual(typeof p.then, 'function');
    await p;
    const r = await c.end('response', performance.now());
    assert.strictEqual(typeof r, 'number', 'lab.js 20.x end() resolves to the timestamp');
    ctx.labjsAdapter.restore();
    assert.strictEqual(proto.run, origRun);
    assert.strictEqual(proto.end, origEnd);
  });
});
