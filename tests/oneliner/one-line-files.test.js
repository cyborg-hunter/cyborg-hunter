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
import { setBuild, buildOf } from './support/build-flags.js';
import { fakeSurveyEngine } from './support/fake-qualtrics.js';

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
  if (ctx && ctx.qualtrics) ctx.qualtrics.teardown();
  if (ctx && ctx.vanilla) ctx.vanilla.teardown();
  if (ctx && ctx.monitor) { try { ctx.monitor.destroy(); } catch { /* already destroyed */ } }
  win.close();
  delete global.window; delete global.document; delete global.Node; delete global.MutationObserver; delete global.ResizeObserver;
});
const script = (dataset) => ({ dataset: dataset || {}, src: 'https://cdn/x/ch.js' });
// A tag in <head>, still parsing (as boot.test.js 'host diagnosis' does).
const loading = () => Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true });
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('every one-line file sets the same sentinel and names itself', () => {
  it('ch.js: ctx.file and a non-enumerable window.__cyborgHunterFile; the sentinel is ch.js', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(ctx.file, 'ch.js');
    const desc = Object.getOwnPropertyDescriptor(win, '__cyborgHunterFile');
    assert.ok(desc, 'the file mark is set');
    assert.strictEqual(desc.value, 'ch.js');
    assert.strictEqual(desc.enumerable, false);
    assert.strictEqual(desc.writable, false);
    assert.strictEqual(desc.configurable, true);
    assert.strictEqual(win.__cyborgHunterLoaded, 'ch.js');
  });

  // The mark is a diagnostic: a page that already holds the name, locked,
  // keeps its own value and ch.js boots as usual.
  it('a page whose own __cyborgHunterFile cannot be redefined: ch.js still boots and names itself', () => {
    Object.defineProperty(win, '__cyborgHunterFile', { value: 'page', writable: false, configurable: false });
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.ok(ctx, 'boot returns its context');
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(win.CyborgHunter, ctx.api);
    assert.strictEqual(typeof win.CyborgHunter.mark, 'function');
    assert.strictEqual(win.__cyborgHunterLoaded, 'ch.js');
    assert.strictEqual(ctx.file, 'ch.js');
    assert.strictEqual(win.__cyborgHunterFile, 'page');
    win.CyborgHunter.init({});
    assert.deepStrictEqual(errors, [MESSAGES.manualInitOnOneLiner('ch.js')]);
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

// A file without the jsPsych adapter (ch-qualtrics.js, ch-labjs.js) on a
// jsPsych page: one error naming ch.js, then the page is recorded as a page
// without a framework. initJsPsych is left alone and no extension class is
// put on the window: jsPsych runs as it would without the file.
describe('a file without the jsPsych adapter (HAS_JSPSYCH false)', () => {
  let restore;
  before(() => { restore = setBuild({ HAS_JSPSYCH: false, CH_FILE: 'ch-labjs.js' }); });
  after(() => restore());

  it('on a jsPsych page: one wrongBuild error naming ch.js, the vanilla host, initJsPsych untouched', () => {
    const original = function () { return { data: { addProperties() {} }, run() {} }; };
    win.initJsPsych = original;
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.deepStrictEqual(errors, [MESSAGES.wrongBuild('jsPsych', 'ch.js', 'ch-labjs.js')]);
    assert.ok(errors[0].includes('load ch.js in place of ch-labjs.js'), errors[0]);
    assert.deepStrictEqual(ctx.wrongBuild, { host: 'jsPsych', file: 'ch.js' });
    assert.strictEqual(ctx.host, 'vanilla');
    assert.ok(ctx.vanilla, 'the vanilla adapter records the page');
    assert.strictEqual(ctx.segmenter.state().open, true);
    assert.strictEqual(win.initJsPsych, original);
    assert.strictEqual(win.jsPsychCyborgHunter, undefined);
  });

  it('on a page without jsPsych: no error', () => {
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(ctx.wrongBuild, null);
    assert.strictEqual(ctx.host, 'vanilla');
  });

  it('with data-debug the summary names the file to load', () => {
    win.initJsPsych = function () {};
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none', debug: '' }), win });
    assert.strictEqual(infos.length, 1, infos.join('\n'));
    assert.ok(infos[0].endsWith(' · wrong file: this page runs jsPsych, load ch.js'), infos[0]);
  });

  it('a failed boot on a jsPsych page leaves initJsPsych as it was', () => {
    const original = function () {};
    win.initJsPsych = original;
    boot({ script: script({ participantId: 'P1' }), win, monitorFactory: () => { throw new Error('kaboom'); } });
    assert.strictEqual(win.initJsPsych, original);
  });

  // A tag above jspsych.js: initJsPsych is defined only after boot, so the
  // file looks again once the DOM is parsed, and only once.
  it('jsPsych defined after the tag: one wrongBuild error at DOMContentLoaded, initJsPsych untouched', async () => {
    loading();
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(ctx.wrongBuild, null);
    const original = function () {};
    win.initJsPsych = original;
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await tick();
    assert.deepStrictEqual(errors, [MESSAGES.wrongBuild('jsPsych', 'ch.js', 'ch-labjs.js')]);
    assert.deepStrictEqual(ctx.wrongBuild, { host: 'jsPsych', file: 'ch.js' });
    assert.strictEqual(ctx.host, 'vanilla');
    assert.strictEqual(win.initJsPsych, original);
  });

  it('no jsPsych by DOMContentLoaded: no error', async () => {
    loading();
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await tick();
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(ctx.wrongBuild, null);
  });
});

// The same late jsPsych with ch.js, which carries the adapter: the placement
// check reports the tag above jspsych.js (adapters/jspsych.js), and the page
// is not a wrong-file page.
describe('ch.js (its own flags): jsPsych defined after the tag', () => {
  let restore;
  before(() => { restore = setBuild(buildOf('ch.js')); });
  after(() => restore());

  it('no wrongBuild; only the placement error', async () => {
    loading();
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    const original = function () {};
    win.initJsPsych = original;
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await tick();
    assert.deepStrictEqual(errors, [MESSAGES.loadedAboveJsPsych()]);
    assert.strictEqual(ctx.wrongBuild, null);
    assert.strictEqual(win.initJsPsych, original);
  });
});

describe('every host in (the node default): a jsPsych page is a jsPsych page', () => {
  it('no wrongBuild', () => {
    win.initJsPsych = function () {};
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(ctx.host, 'jspsych');
    assert.strictEqual(ctx.wrongBuild, null);
    assert.deepStrictEqual(errors, []);
  });
});

const jsPsychStub = () => function () { return { data: { addProperties() {} }, run() {} }; };

// ch-qualtrics.js looks for the survey before jsPsych: a survey whose page
// also runs jsPsych is a Qualtrics page, with one warning and no error.
describe('ch-qualtrics.js', () => {
  let restore;
  before(() => { restore = setBuild(buildOf('ch-qualtrics.js')); });
  after(() => restore());

  it('a survey that also runs jsPsych: a Qualtrics page, one warning, page rows written, header re-runs silent', () => {
    const qx = fakeSurveyEngine();
    win.Qualtrics = { SurveyEngine: qx.SE };
    win.initJsPsych = jsPsychStub();
    ctx = qx.runHeader(() => boot({ script: script({ participantId: 'P1', guards: 'none' }), win }));
    assert.strictEqual(ctx.host, 'vanilla');
    assert.strictEqual(ctx.qualtricsLayout, 'new');
    assert.ok(ctx.qualtrics, 'the Qualtrics writer is installed');
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(warns, [MESSAGES.qualtricsJsPsych()]);
    qx.rerunHeader(win, script());
    assert.deepStrictEqual(errors, []);
    assert.ok(qx.submit().__js_cyborg_hunter, 'the page row is in embedded data');
  });

  it('a jsPsych page outside Qualtrics: one wrongBuild error naming ch.js', () => {
    win.initJsPsych = jsPsychStub();
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.deepStrictEqual(errors, [MESSAGES.wrongBuild('jsPsych', 'ch.js', 'ch-qualtrics.js')]);
    assert.strictEqual(ctx.host, 'vanilla');
    assert.strictEqual(win.__cyborgHunterRerunHost, undefined);
  });

  // The tag above jspsych.js on a survey: jsPsych is defined only after boot,
  // and the look at DOMContentLoaded says what boot says when it is already
  // there, once: the one warning, no wrongBuild.
  it('a survey whose jsPsych is defined after the tag: the same one warning at DOMContentLoaded, no error', async () => {
    loading();
    const qx = fakeSurveyEngine();
    win.Qualtrics = { SurveyEngine: qx.SE };
    ctx = qx.runHeader(() => boot({ script: script({ participantId: 'P1', guards: 'none' }), win }));
    assert.deepStrictEqual(warns, []);
    const original = jsPsychStub();
    win.initJsPsych = original;
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await tick();
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(warns, [MESSAGES.qualtricsJsPsych()]);
    assert.strictEqual(ctx.wrongBuild, null);
    assert.strictEqual(ctx.qualtricsLayout, 'new');
    assert.ok(ctx.qualtrics, 'the Qualtrics writer is installed');
    assert.strictEqual(win.initJsPsych, original);
  });
});

// ch.js on a survey: one error naming ch-qualtrics.js, the page recorded as
// one without a framework (nothing in embedded data), and the header's
// re-runs on later pages silent, so the error is said once.
describe('ch.js on a Qualtrics survey', () => {
  let restore;
  before(() => { restore = setBuild(buildOf('ch.js')); });
  after(() => restore());

  it('one wrongBuild error naming ch-qualtrics.js, no writer, header re-runs silent', () => {
    const qx = fakeSurveyEngine();
    win.Qualtrics = { SurveyEngine: qx.SE };
    ctx = qx.runHeader(() => boot({ script: script({ participantId: 'P1', guards: 'none' }), win }));
    assert.deepStrictEqual(errors, [MESSAGES.wrongBuild('Qualtrics', 'ch-qualtrics.js', 'ch.js')]);
    assert.strictEqual(ctx.host, 'vanilla');
    assert.strictEqual(ctx.qualtricsLayout, null);
    assert.strictEqual(ctx.qualtrics, undefined);
    qx.rerunHeader(win, script());
    qx.rerunHeader(win, script());
    assert.strictEqual(ctx.rerunCount, 2);
    assert.strictEqual(errors.length, 1, errors.join('\n'));
    assert.strictEqual(qx.submit().__js_cyborg_hunter, undefined);
  });

  it('a survey whose page runs jsPsych is a jsPsych page, as before', () => {
    win.Qualtrics = { SurveyEngine: fakeSurveyEngine().SE };
    win.initJsPsych = jsPsychStub();
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.strictEqual(ctx.host, 'jspsych');
    assert.deepStrictEqual(errors, []);
  });
});

// A file with neither adapter on a survey that also runs jsPsych: one error,
// for the survey.
describe('a file without the jsPsych and Qualtrics adapters on a survey that runs jsPsych', () => {
  let restore;
  before(() => { restore = setBuild({ HAS_JSPSYCH: false, HAS_QUALTRICS: false, CH_FILE: 'ch-labjs.js' }); });
  after(() => restore());

  it('one wrongBuild error, naming ch-qualtrics.js', () => {
    win.Qualtrics = { SurveyEngine: fakeSurveyEngine().SE };
    win.initJsPsych = jsPsychStub();
    ctx = boot({ script: script({ participantId: 'P1', guards: 'none' }), win });
    assert.deepStrictEqual(errors, [MESSAGES.wrongBuild('Qualtrics', 'ch-qualtrics.js', 'ch-labjs.js')]);
    assert.strictEqual(ctx.host, 'vanilla');
  });
});
