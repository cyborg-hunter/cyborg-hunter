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
import { installLabJsAdapter, detectLabJs } from '../../src/oneliner/adapters/labjs.js';
import { MESSAGES } from '../../src/oneliner/errors.js';
import Papa from 'papaparse';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { parseCsvToRaw } from '../../src/cli/ingest-core.js';
import { collectSegments } from '../../src/cli/segment-reassembly.js';
import { buildReport } from '../../src/cli/report-core.js';
import { mergeConfig } from '../../src/cli/config-core.js';

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

    // Literal expectations: the harness computes its own generation with the
    // same rule, so it cannot stand in for one.
    it('detectLabJs reads the version and the generation', () => {
      assert.deepStrictEqual(detectLabJs(win), { lab, version: build, generation: build === '20.2.4' ? 'classic' : 'flip' });
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
    assert.strictEqual(ctx.host, 'labjs');
    assert.ok(!ctx.vanilla, 'no vanilla adapter on the lab.js host');
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
      assert.strictEqual(r.cyborgHunterParticipantId, 'P1');
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

  it('row 0 carries the participant id when it is a Dummy\'s or a skipped component\'s row', async () => {
    await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root', content: [
      new lab.core.Dummy({ title: 'start' }),
      screen(lab, 'skipped', { skip: true }),
      screen(lab, 'a')
    ] });
    const rows = await runToEnd(study);
    assert.deepStrictEqual(rows.map((r) => r.sender), ['start', 'skipped', 'a', 'root']);
    assert.strictEqual(rows[0].participantId, 'P1');
    assert.strictEqual(rows[0].cyborgHunterVersion, VERSION);
    assert.ok(!('integritySegment' in rows[0]) && !('integritySegment' in rows[1]));
    assert.deepStrictEqual(withSegment(rows).map((r) => r.sender), ['a']);
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

  // Another script wrapped run and end after ch.js: restore() cannot take
  // ch.js's wrapper out of that chain, so the wrapper stands down instead.
  it('restore() under wrappers another script added after ch.js: no ch.js columns, and the other wrappers keep working', async () => {
    const ctx = await bootOn(win);
    const proto = lab.core.Component.prototype;
    const chRun = proto.run, chEnd = proto.end;
    const calls = [];
    proto.run = function () { calls.push('run'); return chRun.apply(this, arguments); };
    proto.end = function () { calls.push('end'); return chEnd.apply(this, arguments); };
    ctx.labjsAdapter.restore();
    const rows = await runToEnd(new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a'), screen(lab, 'b')] }));
    assert.deepStrictEqual(rows.map((r) => r.sender), ['a', 'b', 'root']);
    for (const r of rows) assert.deepStrictEqual(Object.keys(r).filter((k) => /^(integrity|cyborgHunter|ai_|guard_|participantId)/.test(k)), [], r.sender);
    assert.ok(calls.includes('run') && calls.includes('end'), 'the other wrappers still run');
    assert.strictEqual(ctx.labjs.trialsRun, 0);
    assert.strictEqual(ctx.labjs.finalized, false, 'the root end did not run the final hook');
    assert.deepStrictEqual([errors, warns], [[], []]);
  });

  it('a Parallel inside a Parallel is part of the outer trial', async () => {
    await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root', content: [
      new lab.flow.Parallel({ title: 'outer', mode: 'all', content: [
        new lab.flow.Parallel({ title: 'inner', mode: 'all', content: [screen(lab, 'i1')] }),
        screen(lab, 'o2', { timeout: 25 })
      ] }),
      screen(lab, 'after')
    ] });
    const rows = await runToEnd(study);
    assert.deepStrictEqual(withSegment(rows).map((r) => [r.sender, r.integritySegment.trialId]), [['outer', '0'], ['after', '1']]);
    assert.ok(!('integritySegment' in rows.find((r) => r.sender === 'inner')));
  });

  it('a component with datacommit: false is not a trial; its span goes into the next segment\'s gap', async () => {
    const ctx = await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root', content: [
      screen(lab, 'a'), screen(lab, 'nocommit', { datacommit: false, timeout: 60 }), screen(lab, 'c')
    ] });
    const ended = runToEnd(study);
    for (let i = 0; i < 200 && !win.document.body.textContent.includes('nocommit'); i++) await tick(2);
    paste(win, 'during nocommit');
    const rows = await ended;
    assert.deepStrictEqual(rows.map((r) => r.sender), ['a', 'c', 'root']);
    const [a, c] = withSegment(rows);
    assert.deepStrictEqual([a.integritySegment.segmentIndex, c.integritySegment.segmentIndex], [0, 1]);
    assert.strictEqual(c.integritySegment.gap.reduce((n, g) => n + g.pasteEvents.length, 0), 1, 'the paste is in c\'s gap');
    assert.strictEqual(ctx.labjs.trialsRun, 2);
    assert.strictEqual(ctx.labjs.segmentsWritten, 2);
  });

  it('a throwing rotate marks each trial row, logs one error, and lab.js runs to the end', async () => {
    const ctx = await bootOn(win);
    ctx.segmenter.rotate = () => { throw new Error('rotate boom'); };
    const rows = await runToEnd(new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a'), screen(lab, 'b')] }));
    assert.deepStrictEqual(rows.map((r) => [r.sender, r.cyborgHunterError]), [['a', 'rotate boom'], ['b', 'rotate boom'], ['root', undefined]]);
    assert.deepStrictEqual(errors, [MESSAGES.labjsHookFailed('rotate boom')]);
  });

  it('a throwing cut marks each trial row, logs one error, and lab.js runs to the end', async () => {
    const ctx = await bootOn(win);
    ctx.segmenter.cut = () => { throw new Error('cut boom'); };
    const rows = await runToEnd(new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a'), screen(lab, 'b')] }));
    assert.deepStrictEqual(rows.map((r) => [r.sender, r.cyborgHunterError]), [['a', 'cut boom'], ['b', 'cut boom'], ['root', undefined]]);
    assert.deepStrictEqual(errors, [MESSAGES.labjsHookFailed('cut boom')]);
  });

  it('a naming failure marks the row and the next trial still opens', async () => {
    await bootOn(win);
    const bad = screen(lab, 'a', { cyborgHunter: { get trialId() { throw new Error('naming boom'); } } });
    const rows = await runToEnd(new lab.flow.Sequence({ title: 'root', content: [bad, screen(lab, 'b')] }));
    assert.strictEqual(rows[0].cyborgHunterError, 'naming boom');
    assert.deepStrictEqual(withSegment(rows).map((r) => r.sender), ['b']);
    assert.deepStrictEqual(errors, [MESSAGES.labjsHookFailed('naming boom')]);
  });

  // Where a study sets its own participantId, and the participantId column it
  // gives (rows a, b, c, root). ch.js's own id is in cyborgHunterParticipantId
  // on every trial row, and in participantId on row 0 only when the study had
  // set none by the time that row was committed.
  const setId = function () { this.options.datastore.set('participantId', 'R'); };
  const ID_CASES = [
    ['datastore.set in the root\'s prepare', (s) => s.on('prepare', setId), ['R', undefined, undefined, undefined]],
    ['a data option on b', null, ['P1', 'R', undefined, undefined], { data: { participantId: 'R' } }],
    ['datastore.set in b\'s run handler', (s, b) => b.on('run', setId), ['P1', 'R', undefined, undefined]],
    ['datastore.set in b\'s after:end handler', (s, b) => b.on('after:end', setId), ['P1', undefined, 'R', undefined]],
    ['data.participantId in b\'s end handler', (s, b) => b.on('end', function () { this.data.participantId = 'R'; }), ['P1', 'R', undefined, undefined]],
    ['datastore.set in b\'s end handler', (s, b) => b.on('end', setId), ['P1', 'R', undefined, undefined]],
    ['datastore.set in the first component\'s end handler', (s, b, a) => a.on('end', setId), ['R', undefined, undefined, undefined]]
  ];
  for (const [where, hook, column, bOpts] of ID_CASES) {
    it('a participantId the study sets (' + where + ') is kept in its row and in the datastore\'s state', async () => {
      await bootOn(win);
      const a = screen(lab, 'a'), b = screen(lab, 'b', bOpts), c = screen(lab, 'c');
      const study = new lab.flow.Sequence({ title: 'root', content: [a, b, c] });
      if (hook) hook(study, b, a);
      const rows = await runToEnd(study);
      assert.deepStrictEqual(rows.map((r) => r.participantId), column);
      assert.strictEqual(datastoreOf(study).state.participantId, 'R');
      assert.deepStrictEqual(withSegment(rows).map((r) => r.cyborgHunterParticipantId), ['P1', 'P1', 'P1']);
    });
  }

  it('a participantId parameter is kept in every row', async () => {
    await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root', parameters: { participantId: 'param' }, content: [screen(lab, 'a'), screen(lab, 'b')] });
    const rows = await runToEnd(study);
    assert.deepStrictEqual(rows.map((r) => r.participantId), ['param', 'param', 'param']);
    assert.strictEqual(rows[0].cyborgHunterParticipantId, 'P1');
    assert.notStrictEqual(datastoreOf(study).state.participantId, 'P1');
  });

  it('without a study id, row 0 carries ch.js\'s id as participantId, trial rows as cyborgHunterParticipantId, and the state none', async () => {
    await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a'), screen(lab, 'b')] });
    const rows = await runToEnd(study);
    assert.deepStrictEqual(rows.map((r) => [r.participantId, r.cyborgHunterParticipantId]), [['P1', 'P1'], [undefined, 'P1'], [undefined, undefined]]);
    assert.strictEqual(datastoreOf(study).state.participantId, undefined);
  });

  it('installed while a screen is on display: that screen gets no columns, and one warning says so', async () => {
    const study = new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a', { timeout: 60 }), screen(lab, 'b')] });
    const ended = runToEnd(study);
    for (let i = 0; i < 100 && !win.document.querySelector('main p'); i++) await tick(2);
    await bootOn(win);
    const rows = await ended;
    assert.deepStrictEqual(withSegment(rows).map((r) => r.sender), ['b']);
    assert.deepStrictEqual(warns.filter((w) => w.includes('already running')), [MESSAGES.labjsStudyAlreadyRunning()]);
  });

  it('a second install returns the first handle and wraps once', async () => {
    const ctx = await bootOn(win);
    const proto = lab.core.Component.prototype;
    const run = proto.run, end = proto.end;
    const again = installLabJsAdapter({ win, ctx, lab, version: lab.version, generation: 'classic' });
    assert.strictEqual(again, ctx.labjsAdapter);
    assert.strictEqual(proto.run, run);
    assert.strictEqual(proto.end, end);
    const rows = await runToEnd(new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a')] }));
    assert.strictEqual(withSegment(rows).length, 1);
    assert.strictEqual(ctx.labjs.trialsRun, 1);
    assert.strictEqual(ctx.labjs.segmentsWritten, 1);
  });

  it('a plain component after a marked screen is named by its own id, not the screen\'s mark', async () => {
    await bootOn(win);
    const rows = await runToEnd(new lab.flow.Sequence({ title: 'root', content: [
      screen(lab, 'm', { content: '<p data-ch-trial="mark-m">m</p>' }),
      new lab.core.Component({ title: 'iti', timeout: 15 })
    ] }));
    assert.deepStrictEqual(withSegment(rows).map((r) => r.integritySegment.trialId), ['mark-m', '1']);
  });
});

function fakeHoneypot(violations, aiUse, aiReport) {
  return {
    init() {},
    getSessionSummary: () => ({
      guard_assistance_violations_session: JSON.stringify(violations),
      guard_assistance_violation_count_session: violations.length,
      ai_use_session: !!aiUse,
      ai_report_session: aiReport || ''
    })
  };
}
function fakeRecorder() {
  const calls = [];
  return { calls, startTrial: (id) => calls.push('start:' + id), endTrial: () => calls.push('end'), stop: () => calls.push('stop') };
}

describe('ch.js on real lab.js 20.2.4: the end of the session', () => {
  let win, lab;
  beforeEach(() => { ({ win, lab } = createLabWindow({ build: '20.2.4' })); captureConsole(); });
  afterEach(async () => {
    releaseConsole();
    try { if (current) current.monitor.destroy(); } catch { /* destroyed by the final hook */ }
    current = null;
    await closeLabWindow(win);
  });

  it('the root end writes the final segment, the *Final totals and the honeypot summary onto the last trial row, before on(end)', async () => {
    win.GuardHoneypot = fakeHoneypot([{ start: 12, duration: 3, reason: 'tab-away' }], true, 'I used ChatGPT');
    const ctx = await bootOn(win, { guards: 'honeypot' });
    const study = new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a'), screen(lab, 'b'), new lab.core.Dummy({ title: 'bye' })] });
    let seenAtEnd = null;
    study.on('end', () => { seenAtEnd = datastoreOf(study).data.map((r) => Object.assign({}, r)); });
    const rows = await runToEnd(study);
    const last = rows.find((r) => r.sender === 'b');
    assert.strictEqual(last.integritySegmentFinal.segmentIndex, 2);
    assert.strictEqual(last.integritySegmentFinal.source, 'final');
    assert.strictEqual(last.integrityPasteCountFinal, 0);
    assert.strictEqual(typeof last.integritySoftScoreFinal, 'number');
    assert.strictEqual(last.ai_use_session, true);
    assert.strictEqual(last.ai_report_session, 'I used ChatGPT');
    assert.strictEqual(JSON.parse(last.guard_assistance_violations_session).length, 1);
    assert.ok(!('integritySegmentFinal' in rows.find((r) => r.sender === 'bye')), 'the skipped row after it is not the target');
    const root = rows.find((r) => r.sender === 'root');
    assert.strictEqual(root.integritySegmentFinal.segmentIndex, 2, 'the root row carries the final fields too');
    assert.strictEqual(root.integrityPasteCountFinal, 0);
    assert.strictEqual(root.ai_use_session, true);
    const atEnd = seenAtEnd.find((r) => r.sender === 'b');
    assert.ok(atEnd && atEnd.integritySegmentFinal, 'an on(end) save sees the final fields');
    assert.strictEqual(seenAtEnd.length, 3, 'on(end) runs before the root row commits');
    assert.strictEqual(ctx.labjs.finalized, true);
    assert.throws(() => ctx.monitor.startSession(), /destroy/, 'the monitor is torn down');
    assert.deepStrictEqual(errors, []);
  });

  it('a study without a leaf row: the final fields land on the root row', async () => {
    await bootOn(win);
    const rows = await runToEnd(new lab.flow.Sequence({ title: 'root', content: [new lab.core.Dummy({ title: 'bye' })] }));
    assert.strictEqual(rows.length, 2);
    assert.ok(rows[1].integritySegmentFinal, 'root row');
    assert.strictEqual(rows[1].integritySegmentFinal.segmentIndex, 0);
  });

  it('a leaf run on its own is both the trial and the root', async () => {
    await bootOn(win);
    const c = screen(lab, 'solo');
    const rows = await runToEnd(c);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].integritySegment.trialId, 'trial-0');
    assert.ok(rows[0].integritySegmentFinal);
  });

  it('a second study after the first ended: one warning, no columns on its rows', async () => {
    await bootOn(win);
    await runToEnd(new lab.flow.Sequence({ title: 'first', content: [screen(lab, 'a')] }));
    const rows = await runToEnd(new lab.flow.Sequence({ title: 'second', content: [screen(lab, 'b')] }));
    assert.strictEqual(withSegment(rows).length, 0);
    assert.deepStrictEqual(warns, [MESSAGES.secondLabJsStudy()]);
  });

  it('data-replay: the recorder follows every boundary and its trial is ended at the end', async () => {
    const ctx = await bootOn(win);
    ctx.replay = fakeRecorder();
    await runToEnd(new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a', { cyborgHunter: { trialId: 'A' } }), screen(lab, 'b', { cyborgHunter: { trialId: 'B' } })] }));
    assert.deepStrictEqual(ctx.replay.calls, ['end', 'start:A', 'end', 'start:gap-1', 'end', 'start:B', 'end', 'start:gap-2', 'end']);
  });

  // Boot starts friction observe-only (startGuards); the mark starts enforcement.
  it('data-ch-friction-start and CyborgHunter.startFriction() start enforcement (the vanilla path, without the vanilla adapter)', async () => {
    const started = [];
    win.GuardFriction = {
      injectRefusalNotices() {},
      requestFullscreen() { started.push('fullscreen'); },
      start(o) { started.push('start:' + o.observeOnly); return 'tok'; },
      stop() { started.push('stop'); }
    };
    await bootOn(win, { guards: 'friction' });
    await tick();
    assert.deepStrictEqual(started, ['start:true']);
    const btn = win.document.createElement('button');
    btn.setAttribute('data-ch-friction-start', '');
    win.document.body.appendChild(btn);
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick(120);
    assert.deepStrictEqual(started, ['start:true', 'fullscreen', 'start:false']);
    assert.strictEqual(win._guardFrictionToken, 'tok');
    await runToEnd(new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a')] }));
    assert.deepStrictEqual(started, ['start:true', 'fullscreen', 'start:false', 'stop'], 'the final hook stops friction');
    win.CyborgHunter.startFriction();
    await tick(120);
    assert.deepStrictEqual(started.slice(4), ['fullscreen', 'start:false']);
  });

  it('a cut that throws on a leaf run on its own: the row is marked and the session still ends', async () => {
    const ctx = await bootOn(win);
    ctx.segmenter.cut = () => { throw new Error('kaboom'); };
    const rows = await runToEnd(screen(lab, 'solo'));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].cyborgHunterError, 'kaboom');
    assert.strictEqual(rows[0].integritySegmentFinal.segmentIndex, 0);
    assert.strictEqual(ctx.labjs.finalized, true);
    assert.throws(() => ctx.monitor.startSession(), /destroy/, 'the monitor is torn down');
    assert.deepStrictEqual(errors, [MESSAGES.labjsHookFailed('kaboom')]);
  });

  // lab.js ends the root before the child on screen (Sequence.onEnd aborts
  // it afterwards), so the final segment already holds that child's span.
  it('a study ended early (study.end() while a screen runs): the aborted screen\'s row is not marked', async () => {
    const ctx = await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a'), screen(lab, 'b', { timeout: 2000 })] });
    const ended = runToEnd(study);
    for (let i = 0; i < 200 && !win.document.body.textContent.includes('b'); i++) await tick(2);
    study.end('abort');
    const rows = await ended;
    const b = rows.find((r) => r.sender === 'b');
    assert.ok(b, 'b committed its row');
    assert.ok(!('cyborgHunterError' in b), JSON.stringify(b.cyborgHunterError));
    assert.ok(!('integritySegment' in b));
    const a = rows.find((r) => r.sender === 'a');
    assert.strictEqual(a.integritySegmentFinal.segmentIndex, 1);
    assert.strictEqual(a.integritySegmentFinal.trialId, '1', 'b\'s span (b is component 1)');
    assert.strictEqual(ctx.labjs.finalized, true);
    assert.deepStrictEqual(errors, []);
  });

  // Incremental-only Transmit: a slice that left before the root ended
  // already carried the last trial row; the root row goes out after it.
  it('Transmit without the full update: the final fields reach the server on the root row', async () => {
    const posts = [];
    const fakeFetch = (url, o) => {
      posts.push(JSON.parse(o.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
    };
    globalThis.fetch = win.fetch = fakeFetch;
    await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root',
      plugins: [new lab.plugins.Transmit({ url: 'https://collect.example/save', updates: { full: false } })],
      content: [screen(lab, 'a'), screen(lab, 'b'), screen(lab, 'tail', { datacommit: false, timeout: 150 })] });
    const ds = () => datastoreOf(study);
    const ended = runToEnd(study);
    for (let i = 0; i < 200 && !win.document.body.textContent.includes('tail'); i++) await tick(2);
    await tick(40);                             // b's idle queues the slice
    ds().flushIncrementalTransmissionQueue();   // the 2.5 s debounce, fired while the tail is on screen
    await tick(20);
    assert.deepStrictEqual(posts.map((p) => p.data.map((r) => r.sender)), [['a', 'b']]);
    assert.ok(!posts[0].data[1].integritySegmentFinal, 'b left before the root ended');
    await ended;
    ds().flushIncrementalTransmissionQueue();
    await tick(20);
    const root = posts[posts.length - 1].data.find((r) => r.sender === 'root');
    assert.ok(root, 'the root row went out');
    assert.strictEqual(root.integritySegmentFinal.segmentIndex, 2);
    assert.strictEqual(typeof root.integritySoftScoreFinal, 'number');
  });

  it('the final fields never replace a column the study set on its root', async () => {
    await bootOn(win);
    const study = new lab.flow.Sequence({ title: 'root', data: { integritySoftScoreFinal: 'mine' }, content: [screen(lab, 'a')] });
    const rows = await runToEnd(study);
    const root = rows.find((r) => r.sender === 'root');
    assert.strictEqual(root.integritySoftScoreFinal, 'mine');
    assert.strictEqual(typeof root.cyborgHunter_integritySoftScoreFinal, 'number', 'ch.js\'s value under the prefixed name');
    assert.ok(root.integritySegmentFinal);
    assert.deepStrictEqual(warns, [MESSAGES.labjsColumnTaken('integritySoftScoreFinal')]);
  });

  it('a friction mark that fails logs the friction guard error and leaves the hook error for a hook', async () => {
    const ctx = await bootOn(win);
    const btn = win.document.createElement('button');
    win.document.body.appendChild(btn);
    btn.closest = () => { throw new Error('closest boom'); };
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    ctx.segmenter.cut = () => { throw new Error('cut boom'); };
    await runToEnd(new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a')] }));
    assert.deepStrictEqual(errors, [MESSAGES.guardFailed('friction', 'closest boom'), MESSAGES.labjsHookFailed('cut boom')]);
  });

  it('restore() removes the friction mark listener and the handler', async () => {
    const started = [];
    win.GuardFriction = { injectRefusalNotices() {}, requestFullscreen() { started.push('fullscreen'); }, start() { return 'tok'; }, stop() {} };
    const ctx = await bootOn(win);
    ctx.labjsAdapter.restore();
    assert.strictEqual(ctx.handlers.startFriction, undefined);
    const btn = win.document.createElement('button');
    btn.setAttribute('data-ch-friction-start', '');
    win.document.body.appendChild(btn);
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.deepStrictEqual(started, []);
  });
});

// What the report CLI and the analyze page read from a lab.js study: its
// exportJson() (the JATOS export, the Download plugin's JSON), the body the
// Transmit plugin posts at the end, and its exportCsv(). The final fields sit
// on the last trial row and on the root row; read either way they count once.
describe('ch.js on real lab.js 20.2.4: the saved data through the report reader', () => {
  let win, lab;
  beforeEach(() => { ({ win, lab } = createLabWindow({ build: '20.2.4' })); captureConsole(); });
  afterEach(async () => {
    releaseConsole();
    try { if (current) current.monitor.destroy(); } catch { /* destroyed by the final hook */ }
    current = null;
    await closeLabWindow(win);
  });

  async function runAndSave() {
    const posts = [];
    globalThis.fetch = win.fetch = (url, o) => {
      posts.push(JSON.parse(o.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
    };
    win.GuardHoneypot = fakeHoneypot([{ start: 12, duration: 3, reason: 'tab-away' }], true, 'I used ChatGPT');
    await bootOn(win, { guards: 'honeypot' });
    const study = new lab.flow.Sequence({ title: 'root',
      plugins: [new lab.plugins.Transmit({ url: 'https://collect.example/save' })],
      content: [screen(lab, 'a', { timeout: 60 }), screen(lab, 'b'), new lab.core.Dummy({ title: 'bye' })] });
    const ended = runToEnd(study);
    for (let i = 0; i < 100 && !win.document.querySelector('main p'); i++) await tick(2);
    paste(win, 'during a');
    await ended;
    await tick(40);
    const ds = datastoreOf(study);
    return { json: JSON.parse(ds.exportJson()), csv: ds.exportCsv(), full: posts.find((p) => p.metadata && p.metadata.payload === 'full') };
  }

  it('exportJson(), the Transmit body and exportCsv() give the same participant, session and disclosure', async () => {
    const { json, csv, full } = await runAndSave();
    assert.ok(json.find((r) => r.sender === 'b').integritySegmentFinal && json.find((r) => r.sender === 'root').integritySegmentFinal,
      'the final segment is on the last trial row and on the root row');
    assert.deepStrictEqual(collectSegments({ trials: json }).map((s) => s.segmentIndex), [0, 1, 2], 'two trial segments and one final, once');

    const r = extractIntegrityData(json, {});
    assert.strictEqual(r.participantId, 'P1');
    assert.deepStrictEqual(r.trials.map((t) => t.sender), ['a', 'b']);
    assert.ok(r.session, 'the session is reassembled from the rows');
    assert.strictEqual(r.session.pasteCount, 1, 'the paste counts once');
    assert.strictEqual(typeof r.score.anyHardTriggered, 'boolean');
    assert.deepStrictEqual(r.honeypot, { aiUse: true, aiReport: 'I used ChatGPT' });
    assert.strictEqual(r.guardFriction.violations.length, 1);
    assert.deepStrictEqual(r.warnings.filter((w) => /participantId|both a dumped/.test(w)), []);

    const withoutRoot = extractIntegrityData(json.filter((row) => row.sender !== 'root'), {});
    assert.deepStrictEqual([withoutRoot.session, withoutRoot.score, withoutRoot.honeypot], [r.session, r.score, r.honeypot],
      'the root row\'s copy of the final fields adds nothing');
    const wrapped = extractIntegrityData({ participantId: 'P1', trials: json }, {});
    assert.deepStrictEqual([r.session, r.score], [wrapped.session, wrapped.score], 'the rows read as a { trials } file does');

    assert.ok(full, 'the Transmit plugin posted the full data');
    const t = extractIntegrityData(full, {});
    assert.strictEqual(t.participantId, 'P1');
    assert.strictEqual(t.trials.length, 2);
    assert.deepStrictEqual([t.session, t.score, t.honeypot], [r.session, r.score, r.honeypot]);

    const header = Papa.parse(csv).data[0];
    assert.strictEqual(new Set(header).size, header.length, 'no column twice');
    const c = extractIntegrityData(parseCsvToRaw(csv, {}), {});
    assert.strictEqual(c.participantId, 'P1');
    assert.strictEqual(c.trials.length, 2);
    assert.strictEqual(c.session.pasteCount, 1);
    assert.deepStrictEqual(c.honeypot, r.honeypot);
    assert.deepStrictEqual(errors, []);
  });
});

// ch.js never replaces a value the study set under one of ch.js's column
// names. The study's value stays, in its row and in lab.js's state (which
// every commit updates); ch.js's goes under cyborgHunter_<name> from then on,
// with one warning per name; the report reads ch.js's value from there.
describe('ch.js on real lab.js 20.2.4: column names the study uses too', () => {
  const TIMING = new Set(['time_run', 'time_render', 'time_show', 'time_end', 'time_commit', 'time_switch', 'timestamp', 'duration']);

  // Runs the study once without ch.js and once with it, each in its own window.
  async function twice(make, dataset, prepare) {
    const out = {};
    for (const withCh of [false, true]) {
      const { win, lab } = createLabWindow({ build: '20.2.4' });
      captureConsole();
      try {
        if (prepare) prepare(win);
        if (withCh) await bootOn(win, dataset);
        const seen = {};
        const study = make(lab, seen);
        const rows = await runToEnd(study);
        const ds = datastoreOf(study);
        out[withCh ? 'ch' : 'base'] = { rows, state: { ...ds.state }, seen, csv: ds.exportCsv(), warns: warns.slice(), errors: errors.slice() };
      } finally {
        releaseConsole();
        try { if (current) current.monitor.destroy(); } catch { /* the final hook destroyed it */ }
        current = null;
        await closeLabWindow(win);
      }
    }
    return out;
  }
  // Every column of every row the study writes without ch.js (lab.js's
  // timing aside) holds the same value with ch.js.
  function assertStudyDataKept(base, ch) {
    assert.strictEqual(ch.rows.length, base.rows.length);
    base.rows.forEach((row, i) => {
      for (const k of Object.keys(row)) {
        if (!TIMING.has(k)) assert.deepStrictEqual(ch.rows[i][k], row[k], 'row ' + i + ' (' + row.sender + ') column ' + k);
      }
    });
  }
  // The same rows as if the study had used none of ch.js's names: the
  // study's value gone and ch.js's under its usual name.
  function withoutCollisions(rows) {
    return rows.map((row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith('cyborgHunter_')) out[k.slice('cyborgHunter_'.length)] = v;
        else if (!(('cyborgHunter_' + k) in row)) out[k] = v;
      }
      return out;
    });
  }

  it('the study\'s values in lab.js\'s state and in a screen\'s data stay; ch.js\'s go under cyborgHunter_<name>, and the report reads them', async () => {
    const make = (lab, seen) => {
      const a = screen(lab, 'a');
      const b = screen(lab, 'b', { data: { integrity: 'mine' } });
      const c = screen(lab, 'c', { data: { integritySoftScoreFinal: 'mine-final' } });
      for (const [name, comp] of [['a', a], ['b', b], ['c', c]]) comp.on('run', function () { seen[name] = this.options.datastore.state.integrity; });
      const study = new lab.flow.Sequence({ title: 'root', content: [a, b, c] });
      study.on('prepare', function () { this.options.datastore.set({ integrity: 'S', cyborgHunterVersion: 'study-v' }); });
      return study;
    };
    const { base, ch } = await twice(make);
    assertStudyDataKept(base, ch);
    assert.deepStrictEqual(base.seen, { a: 'S', b: 'S', c: 'mine' });
    assert.deepStrictEqual(ch.seen, base.seen, 'the study reads its own values from lab.js\'s state');
    for (const k of ['integrity', 'cyborgHunterVersion', 'integritySoftScoreFinal']) assert.deepStrictEqual(ch.state[k], base.state[k], 'state.' + k);
    const trials = withSegment(ch.rows);
    assert.deepStrictEqual(trials.map((r) => [r.sender, r.cyborgHunter_integrity.trialId, r.cyborgHunter_cyborgHunterVersion]), [['a', '0', VERSION], ['b', '1', VERSION], ['c', '2', VERSION]]);
    const c = ch.rows.find((r) => r.sender === 'c');
    assert.strictEqual(typeof c.cyborgHunter_integritySoftScoreFinal, 'number');
    assert.ok(c.integritySegmentFinal, 'a final field the study does not use keeps its name');
    const root = ch.rows.find((r) => r.sender === 'root');
    assert.strictEqual(typeof root.cyborgHunter_integritySoftScoreFinal, 'number');
    assert.ok(!('integritySoftScoreFinal' in root));
    assert.deepStrictEqual(ch.warns, ['integrity', 'cyborgHunterVersion', 'integritySoftScoreFinal'].map((k) => MESSAGES.labjsColumnTaken(k)));
    assert.deepStrictEqual(ch.errors, []);

    // The report: these rows read as the same rows without the collisions do,
    // from exportJson() and from exportCsv().
    const read = extractIntegrityData(ch.rows, {});
    assert.deepStrictEqual(read, extractIntegrityData(withoutCollisions(ch.rows), {}));
    assert.deepStrictEqual(read.trials.map((t) => [t.trialId, t.sender]), [['0', 'a'], ['1', 'b'], ['2', 'c']]);
    assert.ok(read.session, 'the session is reassembled');
    const sinkOf = async (r) => {
      const files = new Map();
      await buildReport([{ ...r, replay: null }], mergeConfig({ noVisuals: true }).config, { sink: (path, data) => files.set(path, data), replayClientSrc: '', fontFaceCss: '' });
      return files;
    };
    const [got, want] = [await sinkOf(read), await sinkOf(extractIntegrityData(withoutCollisions(ch.rows), {}))];
    for (const f of ['summary.csv', 'triage.md', 'event-log.csv', 'extensions.csv']) assert.strictEqual(got.get(f), want.get(f), f);
    const fromCsv = extractIntegrityData(parseCsvToRaw(ch.csv, {}), {});
    assert.deepStrictEqual([fromCsv.participantId, fromCsv.trials.length, fromCsv.session, fromCsv.score], [read.participantId, 3, read.session, read.score]);
  });

  it('a Loop parameter named like a ch.js column stays in each iteration\'s row', async () => {
    const make = (lab) => new lab.flow.Sequence({ title: 'root', content: [
      new lab.flow.Loop({ title: 'loop', template: screen(lab, 'item'), templateParameters: [{ integrity: 'p1' }, { integrity: 'p2' }] }),
      screen(lab, 'z')
    ] });
    const { base, ch } = await twice(make);
    assertStudyDataKept(base, ch);
    assert.deepStrictEqual(ch.rows.filter((r) => r.sender === 'item').map((r) => [r.integrity, r.cyborgHunter_integrity.trialId]), [['p1', '0_0'], ['p2', '0_1']]);
    assert.strictEqual(ch.state.integrity, base.state.integrity);
    assert.deepStrictEqual(ch.warns, [MESSAGES.labjsColumnTaken('integrity')]);
  });

  // A study's end handler runs after ch.js's hook, so its value under one of
  // ch.js's names replaces ch.js's on that row; ch.js sees it in the state at
  // the next trial and writes under the prefixed name from there. The report
  // skips the row whose report the study replaced; its segment still counts.
  it('a value the study\'s end handler writes under integrity: that row keeps it, later rows take the prefixed name, the report skips that row', async () => {
    const make = (lab) => {
      const b = screen(lab, 'b');
      b.on('end', function () { this.data.integrity = 'from-end'; });
      return new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a'), b, screen(lab, 'c')] });
    };
    const { base, ch } = await twice(make);
    assertStudyDataKept(base, ch);
    assert.deepStrictEqual(ch.rows.map((r) => [r.sender, typeof r.integrity, !!r.cyborgHunter_integrity]),
      [['a', 'object', false], ['b', 'string', false], ['c', 'undefined', true], ['root', 'undefined', false]]);
    assert.deepStrictEqual(ch.warns, [MESSAGES.labjsColumnTaken('integrity')]);
    const read = extractIntegrityData(ch.rows, {});
    assert.deepStrictEqual(read.trials.map((t) => t.trialId), ['0', '2']);
    assert.deepStrictEqual(collectSegments({ trials: ch.rows }).map((g) => g.segmentIndex), [0, 1, 2, 3]);
    assert.ok(read.session, 'the session is reassembled from every segment');
    assert.deepStrictEqual(read.warnings.filter((w) => /missing fields/.test(w)), []);
  });

  // The check that tells the rule apart from prefixing everything: lab.js's
  // state holds ch.js's own values after the first trial, and those are not
  // the study's.
  it('a study that uses none of the names: no cyborgHunter_ column anywhere, and no warning', async () => {
    const make = (lab) => new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a'), screen(lab, 'b'), screen(lab, 'c')] });
    const { ch } = await twice(make, { guards: 'honeypot' }, (win) => { win.GuardHoneypot = fakeHoneypot([], false, ''); });
    assert.deepStrictEqual(ch.rows.flatMap((r) => Object.keys(r).filter((k) => k.startsWith('cyborgHunter_'))), []);
    assert.deepStrictEqual([ch.warns, ch.errors], [[], []]);
    assert.strictEqual(withSegment(ch.rows).length, 3);
    const c = ch.rows.find((r) => r.sender === 'c');
    assert.ok(c.integritySegmentFinal && c.ai_use_session === false, 'the final fields under their own names');
  });
});

// The 23 line (pre-releases) is not hooked yet: boot warns once and runs the
// vanilla host, as on a page without lab.js.
describe('ch.js on real lab.js 23.0.0-alpha9: not hooked', () => {
  let win, lab;
  beforeEach(() => { ({ win, lab } = createLabWindow({ build: '23.0.0-alpha9' })); captureConsole(); });
  afterEach(async () => {
    releaseConsole();
    try { if (current) current.monitor.destroy(); } catch { /* already destroyed */ }
    try { if (current && current.vanilla) current.vanilla.teardown(); } catch { /* already torn down */ }
    current = null;
    await closeLabWindow(win);
  });

  it('one warning, the vanilla host, and lab.js rows without columns', async () => {
    const run = lab.core.Component.prototype.run;
    const ctx = await bootOn(win);
    assert.strictEqual(ctx.host, 'vanilla');
    assert.ok(ctx.vanilla, 'the vanilla adapter');
    assert.strictEqual(ctx.labjsAdapter, undefined);
    assert.strictEqual(lab.core.Component.prototype.run, run, 'lab.js is left alone');
    assert.deepStrictEqual(warns, [MESSAGES.labjsVersionUnsupported('23.0.0-alpha9')]);
    const study = new lab.flow.Sequence({ title: 'root', content: [screen(lab, 'a'), screen(lab, 'b')] });
    const rows = await runToEnd(study);
    assert.deepStrictEqual(rows.map((r) => r.sender), ['a', 'b', 'root']);
    assert.deepStrictEqual(withSegment(rows), []);
    assert.ok(rows.every((r) => r.cyborgHunterParticipantId === undefined));
    assert.deepStrictEqual(errors, [], 'not taken for a tag above lib/lab.js');
  });
});
