// What depends on which one-line file runs (build-targets.js): every file
// sets the same sentinel and names itself, and the messages about the file
// name the one that runs. The node tests run every host in and CH_FILE
// 'ch.js' (src/oneliner/build-flags.js); a describe here sets another file's
// constants for its tests and puts the defaults back after them.
// Bootstrap mirrors boot.test.js (modules load after the happy-dom globals).
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { MESSAGES } from '../../src/oneliner/errors.js';
import { setBuild } from './support/build-flags.js';

class StubResizeObserver { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} }
let win, boot, errors, warns, infos, orig, ctx;

beforeEach(async () => {
  win = new Window({ url: 'https://lab.example/study.html' });
  global.window = win; global.document = win.document; global.Node = win.Node;
  global.MutationObserver = win.MutationObserver; global.ResizeObserver = StubResizeObserver;
  ({ boot } = await import('../../src/oneliner/boot.js'));
  errors = []; warns = []; infos = [];
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (m) => errors.push(String(m)); console.warn = (m) => warns.push(String(m)); console.info = (m) => infos.push(String(m));
  ctx = null;
});
afterEach(() => {
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  if (ctx && ctx.vanilla) ctx.vanilla.teardown();
  if (ctx && ctx.monitor) { try { ctx.monitor.destroy(); } catch { /* already destroyed */ } }
  win.close();
  delete global.window; delete global.document; delete global.Node; delete global.MutationObserver; delete global.ResizeObserver;
});
const script = (dataset) => ({ dataset: dataset || {}, src: 'https://cdn/x/ch.js' });

describe('every one-line file sets the same sentinel and names itself', () => {
  it('ch.js: ctx.file and a non-enumerable window.__cyborgHunterFile; the sentinel is ch.js', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(ctx.file, 'ch.js');
    const desc = Object.getOwnPropertyDescriptor(win, '__cyborgHunterFile');
    assert.ok(desc, 'the file mark is set');
    assert.strictEqual(desc.value, 'ch.js');
    assert.strictEqual(desc.enumerable, false);
    assert.strictEqual(desc.writable, false);
    assert.strictEqual(win.__cyborgHunterLoaded, 'ch.js');
  });

  it('a one-line file of an earlier release set only the sentinel: the double-load error names ch.js', () => {
    win.__cyborgHunterLoaded = 'ch.js';
    win.CyborgHunter = { from: 'earlier ch.js' };
    assert.strictEqual(boot({ script: script({ participantId: 'P1' }), win }), null);
    assert.deepStrictEqual(errors, [MESSAGES.doubleLoad('ch.js', 'ch.js')]);
  });
});

describe('another one-line file (CH_FILE ch-labjs.js)', () => {
  let restore;
  before(() => { restore = setBuild({ CH_FILE: 'ch-labjs.js' }); });
  after(() => restore());

  it('sets the ch.js sentinel and names itself in ctx.file and window.__cyborgHunterFile', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(win.__cyborgHunterLoaded, 'ch.js');
    assert.strictEqual(ctx.file, 'ch-labjs.js');
    assert.strictEqual(win.__cyborgHunterFile, 'ch-labjs.js');
  });

  it('loaded after ch.js: one double-load error naming both files, and the first namespace stays', () => {
    const restoreFirst = setBuild({ CH_FILE: 'ch.js' });
    try { ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win }); } finally { restoreFirst(); }
    assert.strictEqual(boot({ script: script({ participantId: 'P2', guards: 'none' }), win }), null);
    assert.deepStrictEqual(errors, [MESSAGES.doubleLoad('ch.js', 'ch-labjs.js')]);
    assert.ok(errors[0].includes(': ch-labjs.js was loaded after ch.js.'), errors[0]);
    assert.strictEqual(win.CyborgHunter, ctx.api);
  });

  it('the random-id warning names the running file', () => {
    ctx = boot({ script: script({ guards: 'none' }), win });
    assert.deepStrictEqual(warns, [MESSAGES.randomId(ctx.participantId, 'ch-labjs.js')]);
    assert.ok(warns[0].includes('to the ch-labjs.js tag'), warns[0]);
  });

  it('CyborgHunter.init() and replay() name the running file', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    win.CyborgHunter.init({});
    win.CyborgHunter.replay();
    assert.deepStrictEqual(errors, [MESSAGES.manualInitOnOneLiner('ch-labjs.js')]);
    assert.deepStrictEqual(warns, [MESSAGES.replayOff('ch-labjs.js')]);
    assert.ok(warns[0].includes('the ch-labjs.js tag has no data-replay'), warns[0]);
  });

  it('data-replay on an inline tag: the replay error names the running file', () => {
    ctx = boot({ script: { dataset: { participantId: 'P1', guards: 'none', replay: '' }, src: '' }, win });
    assert.strictEqual(errors.length, 1, errors.join('\n'));
    assert.ok(errors[0].startsWith('[cyborg-hunter] Session replay is not recording: ch-labjs.js could not tell which URL'), errors[0]);
    assert.ok(errors[0].includes('next to ch-labjs.js'), errors[0]);
  });

  it('a failed boot leaves an inert namespace whose warning names the running file', () => {
    boot({ script: script({ participantId: 'P1' }), win, monitorFactory: () => { throw new Error('kaboom'); } });
    win.CyborgHunter.mark('q1');
    assert.deepStrictEqual(warns, [MESSAGES.notRunning('ch-labjs.js')]);
    assert.ok(warns[0].includes('ch-labjs.js did not start'), warns[0]);
  });
});
