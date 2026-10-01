// data-debug: the on-page badge, the one-line console summary and the perf
// counters. createDebug only reads ctx, so a plain object stands in for it.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { createDebug } from '../../src/oneliner/debug.js';

var win, logs;
function log(m) { logs.push(m); }

function jsCtx(extra) {
  return Object.assign({
    host: 'jspsych',
    participantIdSource: 'url:workerId',
    config: { debug: true, guards: { honeypot: true, friction: false } },
    jspsych: { segmentsWritten: 14, entryTrialFound: false },
    win: null
  }, extra);
}

beforeEach(() => { win = new Window({ url: 'https://lab.example/s.html' }); logs = []; });

describe('createDebug', () => {
  it('summary for a jsPsych ctx names the resolved URL parameter', () => {
    var d = createDebug({ doc: win.document, ctx: jsCtx({ win: win }), log: log });
    assert.strictEqual(d.summary(),
      'Cyborg Hunter active · jsPsych detected · 14 trials instrumented · ID from workerId · honeypot on · friction off');
  });

  it('update() renders the badge and logs exactly once', () => {
    var d = createDebug({ doc: win.document, ctx: jsCtx({ win: win }), log: log });
    d.update();
    var b = win.document.getElementById('ch-debug-badge');
    assert.ok(b);
    assert.strictEqual(b.textContent, d.summary());
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0], d.summary());
    d.update();
    assert.strictEqual(logs.length, 2);
    assert.strictEqual(win.document.querySelectorAll('#ch-debug-badge').length, 1);
  });

  it('badge neither blocks clicks nor sits below the page', () => {
    var d = createDebug({ doc: win.document, ctx: jsCtx({ win: win }), log: log });
    d.update();
    var s = win.document.getElementById('ch-debug-badge').getAttribute('style');
    assert.match(s, /pointer-events:\s*none/);
    assert.match(s, /position:\s*fixed/);
    assert.match(s, /z-index:\s*2147483646/);
  });

  it('the badge reflects a changed count after update()', () => {
    var ctx = jsCtx({ win: win });
    var d = createDebug({ doc: win.document, ctx: ctx, log: log });
    d.update();
    ctx.jspsych.segmentsWritten = 15;
    d.update();
    assert.match(win.document.getElementById('ch-debug-badge').textContent, /15 trials instrumented/);
  });

  it('id sources and friction modes read from ctx', () => {
    function sum(extra) { return createDebug({ doc: win.document, ctx: jsCtx(Object.assign({ win: win }, extra)), log: log }).summary(); }
    assert.match(sum({ participantIdSource: 'attribute' }), /ID from data-participant-id/);
    assert.match(sum({ participantIdSource: 'config' }), /ID from CyborgHunterConfig/);
    assert.match(sum({ participantIdSource: 'random' }), /ID from random id \(not linkable\)/);
    assert.match(sum({ participantIdSource: 'session' }), /ID from random id \(not linkable\)/);
    var g = (h, f) => ({ config: { guards: { honeypot: h, friction: f } } });
    assert.match(sum(g(false, true)), /honeypot off · friction observe$/);
    assert.match(sum(Object.assign(g(true, true), { jspsych: { segmentsWritten: 1, entryTrialFound: true } })), /friction enforce$/);
  });

  it('vanilla summary counts [data-ch-trial] mark elements', () => {
    win.document.body.innerHTML = '<button data-ch-trial="a">a</button><div data-ch-trial="b"></div>';
    var d = createDebug({ doc: win.document, ctx: jsCtx({ host: 'vanilla', jspsych: undefined, win: win }), log: log });
    assert.match(d.summary(), /^Cyborg Hunter active · vanilla mode · 2 mark elements · /);
  });

  it('stats() holds the perf counter array, same one each call', () => {
    var d = createDebug({ doc: win.document, ctx: jsCtx({ win: win }), log: log });
    d.stats().segmentWriteMs.push(1.5);
    assert.deepStrictEqual(d.stats().segmentWriteMs, [1.5]);
  });

  it('badge waits for DOMContentLoaded when there is no body yet, and never throws', () => {
    var fake = { body: null, listeners: [], addEventListener(t, f) { this.listeners.push(f); }, getElementById() { return null; } };
    var d = createDebug({ doc: fake, ctx: jsCtx({ win: win }), log: log });
    assert.doesNotThrow(() => d.update());
    assert.strictEqual(logs.length, 1);
    var throwing = { get body() { throw new Error('boom'); }, addEventListener() { throw new Error('boom'); } };
    var d2 = createDebug({ doc: throwing, ctx: jsCtx({ win: win }), log: log });
    assert.doesNotThrow(() => d2.update());
  });

  it('remove() takes the badge away', () => {
    var d = createDebug({ doc: win.document, ctx: jsCtx({ win: win }), log: log });
    d.update();
    d.remove();
    assert.strictEqual(win.document.getElementById('ch-debug-badge'), null);
  });
});
