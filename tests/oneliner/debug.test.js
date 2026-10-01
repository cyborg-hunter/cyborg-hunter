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
    jspsych: { segmentsWritten: 3, instrumented: 14, entryTrialFound: false },
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
    assert.strictEqual(b.textContent, d.badgeText());
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

  it('refresh() updates the badge to written/planned without logging', () => {
    var ctx = jsCtx({ win: win });
    var d = createDebug({ doc: win.document, ctx: ctx, log: log });
    d.update();
    assert.match(win.document.getElementById('ch-debug-badge').textContent, /3\/14 trials/);
    ctx.jspsych.segmentsWritten = 4;
    d.refresh();
    assert.match(win.document.getElementById('ch-debug-badge').textContent, /4\/14 trials/);
    assert.strictEqual(logs.length, 1);
  });

  it('badge shows repeated-trial rows as "N trials (M planned)"', () => {
    function badge(w, p) {
      var c = jsCtx({ win: win });
      c.jspsych.segmentsWritten = w; c.jspsych.instrumented = p;
      return createDebug({ doc: win.document, ctx: c, log: log }).badgeText();
    }
    assert.match(badge(5, 3), /· 5 trials \(3 planned\) ·/);
    assert.doesNotMatch(badge(5, 3), /5\/3/);
    assert.match(badge(2, 3), /· 2\/3 trials ·/);
    assert.match(badge(3, 3), /· 3\/3 trials ·/);
  });

  it('id sources and friction modes read from ctx', () => {
    function sum(extra) { return createDebug({ doc: win.document, ctx: jsCtx(Object.assign({ win: win }, extra)), log: log }).summary(); }
    assert.match(sum({ participantIdSource: 'url:PROLIFIC_PID' }), /ID from PROLIFIC_PID ·/);
    assert.match(sum({ participantIdSource: 'attribute' }), /ID from data-participant-id/);
    assert.match(sum({ participantIdSource: 'config' }), /ID from CyborgHunterConfig/);
    assert.match(sum({ participantIdSource: 'random' }), /ID from random id \(not linkable\)/);
    assert.match(sum({ participantIdSource: 'session' }), /ID from random id \(not linkable\)/);
    var g = (h, f) => ({ config: { guards: { honeypot: h, friction: f } } });
    assert.match(sum(g(false, true)), /honeypot off · friction observe$/);
    assert.match(sum(Object.assign(g(true, true), { jspsych: { segmentsWritten: 1, instrumented: 1, entryTrialFound: true } })), /friction enforce$/);
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

  it('refresh() puts the badge back after the host wipes <body> (jsPsych prepareDom)', () => {
    var ctx = jsCtx({ win: win });
    var d = createDebug({ doc: win.document, ctx: ctx, log: log });
    d.update();
    // jsPsych 7 sets display_element.innerHTML, and display_element defaults to <body>.
    win.document.body.innerHTML = '<div class="jspsych-content-wrapper"><div id="jspsych-content"></div></div>';
    assert.ok(win.document.getElementById('ch-debug-badge') === null, 'wiped');
    ctx.jspsych.segmentsWritten = 5;
    d.refresh();
    var b = win.document.getElementById('ch-debug-badge');
    assert.ok(b, 'badge re-attached');
    assert.strictEqual(win.document.querySelectorAll('#ch-debug-badge').length, 1);
    assert.match(b.textContent, /5\/14 trials/);
    assert.match(b.getAttribute('style'), /pointer-events:\s*none/);
    assert.strictEqual(logs.length, 1, 'refresh() logs nothing');
    // update() re-attaches too.
    win.document.body.innerHTML = '';
    d.update();
    assert.ok(win.document.getElementById('ch-debug-badge'));
  });

  it('a detached badge goes under <html> when there is no <body>, and never throws', () => {
    var d = createDebug({ doc: win.document, ctx: jsCtx({ win: win }), log: log });
    d.update();
    var b = win.document.getElementById('ch-debug-badge');
    win.document.body.remove();
    assert.doesNotThrow(() => d.refresh());
    // ok(===), not strictEqual: a failing diff of two happy-dom nodes never finishes.
    assert.ok(b.parentNode === win.document.documentElement, 'badge under <html>');
  });

  it('remove() takes the badge away', () => {
    var d = createDebug({ doc: win.document, ctx: jsCtx({ win: win }), log: log });
    d.update();
    d.remove();
    assert.strictEqual(win.document.getElementById('ch-debug-badge'), null);
  });
});
