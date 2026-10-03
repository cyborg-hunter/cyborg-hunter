// A host that re-renders its header (Qualtrics re-executes the header's ch.js
// tag on every page, same window) runs the same ch.js again. rerun.js tells
// that apart from a real double load before the guard cores evaluate: the
// same version is silent and keeps the first monitor; anything else stays the
// loud double load. Bootstrap mirrors boot.test.js (modules load after the
// happy-dom globals).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { VERSION } from '../../src/shared/constants.js';
import { MESSAGES } from '../../src/oneliner/errors.js';

class StubResizeObserver { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} }
let win, boot, markRerun, noteRerun, errors, warns, orig, ctx;

beforeEach(async () => {
  win = new Window({ url: 'https://brand.qualtrics.com/jfe/form/SV_x' });
  global.window = win; global.document = win.document; global.Node = win.Node;
  global.MutationObserver = win.MutationObserver; global.ResizeObserver = StubResizeObserver;
  ({ boot } = await import('../../src/oneliner/boot.js'));
  ({ markRerun, noteRerun } = await import('../../src/oneliner/rerun.js'));
  errors = []; warns = [];
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (m) => errors.push(String(m)); console.warn = (m) => warns.push(String(m)); console.info = () => {};
  ctx = null;
});
afterEach(() => {
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  if (ctx && ctx.monitor) { try { ctx.monitor.destroy(); } catch { /* already destroyed */ } }
  win.close();
  delete global.window; delete global.document; delete global.Node; delete global.MutationObserver; delete global.ResizeObserver;
});
const script = (dataset) => ({ dataset: dataset || {}, src: 'https://unpkg.com/cyborg-hunter/dist/ch.js' });

describe('markRerun', () => {
  it('is false on a page where ch.js has not run', () => {
    assert.strictEqual(markRerun(win), false);
    assert.strictEqual(win.__cyborgHunterRerun, false);
  });
  it('is true once this version of ch.js runs, and false for another version or min.js', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(win.CyborgHunter.VERSION, VERSION);
    assert.strictEqual(markRerun(win), true);
    assert.strictEqual(win.__cyborgHunterRerun, true);
    const other = Object.assign({}, win.CyborgHunter, { VERSION: '0.0.1' });
    win.CyborgHunter = other;
    assert.strictEqual(markRerun(win), false);
    win.__cyborgHunterLoaded = 'cyborg-hunter.min.js';
    assert.strictEqual(markRerun(win), false);
  });
  // cyborg-hunter.min.js's namespace carries the same VERSION, so only the
  // sentinel tells min.js-then-ch.js (the loud double load) from a re-run.
  it('is false after cyborg-hunter.min.js of the same version', () => {
    win.__cyborgHunterLoaded = 'cyborg-hunter.min.js';
    win.CyborgHunter = { VERSION };
    assert.strictEqual(markRerun(win), false);
    assert.strictEqual(win.__cyborgHunterRerun, false);
  });
});

describe('a same-file re-run', () => {
  it('calls the hook boot installed, counts it, and logs nothing', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    const seen = [];
    ctx.handlers.rerun = (info) => seen.push(info);
    assert.strictEqual(markRerun(win), true);
    noteRerun(win, script());
    noteRerun(win, null);                       // an eval'd re-run has no currentScript
    assert.deepStrictEqual(seen, [{ src: 'https://unpkg.com/cyborg-hunter/dist/ch.js' }, { src: null }]);
    assert.strictEqual(ctx.rerunCount, 2);
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(warns, []);
    assert.strictEqual(win.CyborgHunter, ctx.api);  // the first namespace is untouched
  });
  it('a hook that throws is reported once and does not stop the monitor', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    ctx.handlers.rerun = () => { throw new Error('boom'); };
    noteRerun(win, null);
    assert.deepStrictEqual(errors, [MESSAGES.rerunFailed('boom')]);
    assert.strictEqual(ctx.segmenter.state().open, true);
  });
  it('noteRerun on a page without the hook does nothing', () => {
    assert.doesNotThrow(() => noteRerun(win, null));
  });
  it('a different ch.js version is still the loud double load', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    win.CyborgHunter = Object.assign({}, win.CyborgHunter, { VERSION: '0.0.1' });
    assert.strictEqual(markRerun(win), false);
    const second = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(second, null);
    assert.deepStrictEqual(errors, [MESSAGES.doubleLoad('ch.js', 'ch.js')]);
  });
});

describe('the guard cores', () => {
  // The IIFEs evaluate once per process, so the gate is pinned at source level
  // here; the Playwright harness (tests/e2e/oneliner/qualtrics.spec.js) runs
  // the real re-execution.
  it('stay silent on a same-file re-run', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/jspsych/extension-guard-friction.js', 'src/jspsych/extension-guard-honeypot.js']) {
      const src = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
      assert.match(src, /\} else if \(!global\.__cyborgHunterRerun\) \{\s*console\.error\('\[cyborg-hunter\] Not redefining/);
    }
  });
});
