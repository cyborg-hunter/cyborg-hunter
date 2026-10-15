// The honeypot's hidden fields sat in the keyboard Tab order: the honeypot is
// appended after the page content, so a participant who pressed Tab after the
// last visible control landed on the invisible "AI use" checkbox, Space ticked
// it, and a second Tab put their typing into the "AI report" box. Every bait
// element must be out of sequential focus (tabindex -1) while staying in the
// page and the accessibility tree, where agents that read the page find it.

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

let GuardHoneypot, win;

before(async () => {
  win = new Window();
  global.window = win;
  global.document = win.document;
  global.Node = win.Node;
  global.Document = win.Document;
  global.EventTarget = win.EventTarget;
  global.Event = win.Event;
  global.performance = win.performance || { now: () => Date.now() };
  await import('../../src/jspsych/extension-guard-honeypot.js');
  GuardHoneypot = win.GuardHoneypot;
});

describe('honeypot bait is out of the Tab order', () => {
  it('every honeypot field and bait control has tabindex -1', () => {
    GuardHoneypot.init({ jsPsych: null, friction: null });
    for (const id of ['fg-ai-use', 'fg-ai-report', 'fg-ai-bait-button', 'fg-ai-bait-input']) {
      const el = win.document.getElementById(id);
      assert.ok(el, id + ' is injected');
      assert.strictEqual(el.getAttribute('tabindex'), '-1', id + ' must not be reachable by Tab');
      assert.strictEqual(el.getAttribute('aria-hidden'), null, id + ' stays visible to agents reading the page');
    }
  });
});
