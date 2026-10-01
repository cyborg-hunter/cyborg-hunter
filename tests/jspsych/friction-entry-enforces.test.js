// Spec (one-line setup, friction): "From the mark on, it enforces. Enabled
// without a mark → observe-only." The one-liner starts friction observe-only
// at boot; the entry trial is the mark. start() only overwrites observeOnly
// when the option is passed, so an entry trial that omits it would inherit
// the sticky observe-only flag and never show the curtain. The entry trial
// therefore passes observeOnly: false explicitly.
//
// The core is an IIFE that runs at import time and touches window / DOM
// prototypes, so bootstrap happy-dom globals BEFORE importing — same
// pattern as tests/jspsych/guard-friction-fullscreen.test.js.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

let GuardFriction;
let observeToken = null;

before(async () => {
  const win = new Window();
  global.window = win;
  global.document = win.document;
  global.Node = win.Node;
  global.Document = win.Document;
  global.EventTarget = win.EventTarget;
  global.Event = win.Event;
  global.performance = win.performance || { now: () => Date.now() };
  global.requestAnimationFrame = win.requestAnimationFrame
    ? win.requestAnimationFrame.bind(win)
    : (cb) => setTimeout(() => cb(Date.now()), 0);
  // createEntryTrial() reads the button-response plugin global eagerly.
  global.jsPsychHtmlButtonResponse = { name: 'html-button-response' };
  await import('../../src/jspsych/extension-guard-friction.js');
  GuardFriction = window.GuardFriction;
});

after(async () => {
  // start() leaves poll intervals running; stop them so the process exits,
  // even when an assertion failed before the entry trial's start (whose
  // timer is awaited so its token is the current one).
  await new Promise((r) => setTimeout(r, 150));
  GuardFriction.stop(window._guardFrictionToken || observeToken);
  delete global.jsPsychHtmlButtonResponse;
});

const overlayShown = () => {
  const el = document.getElementById('guard-friction-overlay');
  return !!el && el.style.display === 'flex';
};

describe('friction entry trial after an observe-only start', () => {
  it('switches friction to enforcement (the curtain shows outside fullscreen)', async () => {
    observeToken = GuardFriction.start({ observeOnly: true });
    assert.strictEqual(GuardFriction.getCurrentState().observe_only, true);
    assert.strictEqual(overlayShown(), false, 'observe-only shows no curtain');

    // No stop() in between: stop() resets observeOnly itself and would hide
    // the bug.
    const trial = GuardFriction.createEntryTrial();
    trial.on_finish();
    await new Promise((r) => setTimeout(r, 150)); // on_finish starts after 100 ms

    const s = GuardFriction.getCurrentState();
    assert.strictEqual(s.active, true);
    assert.strictEqual(s.observe_only, false);
    assert.strictEqual(overlayShown(), true, 'enforcing: not fullscreen → curtain');
  });
});
