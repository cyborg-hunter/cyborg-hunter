// ch.js running jsPsych inside a Qualtrics survey kept the participant ID
// under the page's folder, /jfe/form/: the folder of every survey on the
// university's Qualtrics domain. A second lab's jsPsych-in-Qualtrics study
// opened later in the same tab, with no ID of its own, adopted the first
// study's platform ID. On any /jfe/ page the ID is now kept per survey (the
// SV_ id in the address), whichever file and framework run there.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { setBuild, buildOf } from './support/build-flags.js';

class StubResizeObserver { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} }

let restoreBuild;
before(() => { restoreBuild = setBuild(buildOf('ch.js')); });
after(() => restoreBuild());

let win, boot, orig, contexts, storage;
beforeEach(async () => {
  ({ boot } = await import('../../src/oneliner/boot.js'));
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = () => {}; console.warn = () => {}; console.info = () => {};
  contexts = [];
  storage = null;
});
afterEach(() => {
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  for (const c of contexts) { try { c.monitor.destroy(); } catch { /* destroyed */ } }
  if (win) win.close();
  delete global.window; delete global.document; delete global.Node;
  delete global.MutationObserver; delete global.ResizeObserver;
});

// A jsPsych page at `url`, in the same tab as the pages before it (the tab's
// sessionStorage carried over).
function jsPsychPage(url) {
  if (win) win.close();
  win = new Window({ url });
  if (storage) for (const [k, v] of storage) win.sessionStorage.setItem(k, v);
  global.window = win; global.document = win.document; global.Node = win.Node;
  global.MutationObserver = win.MutationObserver; global.ResizeObserver = StubResizeObserver;
  win.initJsPsych = function () { return { data: { addProperties() {} }, run() {} }; };
  const ctx = boot({ script: { dataset: { guards: 'none', replay: 'off' }, src: 'https://cdn/x/ch.js' }, win });
  contexts.push(ctx);
  storage = [];
  for (let i = 0; i < win.sessionStorage.length; i++) {
    const k = win.sessionStorage.key(i);
    storage.push([k, win.sessionStorage.getItem(k)]);
  }
  return ctx;
}

describe('ch.js on a Qualtrics /jfe/ page keeps the ID per survey', () => {
  it('a second survey on the same domain does not adopt the first one\'s ID', () => {
    const a = jsPsychPage('https://uni.example.qualtrics.com/jfe/form/SV_AAAAAAAA?participant=P1');
    assert.strictEqual(a.host, 'jspsych');
    assert.strictEqual(a.participantId, 'P1');
    const b = jsPsychPage('https://uni.example.qualtrics.com/jfe/form/SV_BBBBBBBB');
    assert.notStrictEqual(b.participantId, 'P1');
    assert.strictEqual(b.participantIdSource, 'random');
  });

  it('a reload of the same survey keeps its ID', () => {
    jsPsychPage('https://uni.example.qualtrics.com/jfe/form/SV_AAAAAAAA?participant=P1');
    const again = jsPsychPage('https://uni.example.qualtrics.com/jfe/form/SV_AAAAAAAA');
    assert.strictEqual(again.participantId, 'P1');
    assert.strictEqual(again.participantIdSource, 'session');
  });
});
