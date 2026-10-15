// A browser without the Fullscreen API (iPhone Safari; a frame not allowed to
// go fullscreen) could never satisfy friction's not_fullscreen check:
// requestFullscreen() is a silent no-op there, so in enforce mode the curtain
// could never be dismissed. Friction now requires fullscreen only when the
// document can go fullscreen; otherwise it skips that one check, says so once
// on the console, and keeps the others (tab hidden, blur; the sidebar check
// needs a fullscreen baseline, as before).
//
// The core is an IIFE that runs at import time and touches window / DOM
// prototypes, so bootstrap happy-dom globals BEFORE importing — same pattern
// as tests/jspsych/guard-friction-fullscreen.test.js. happy-dom has no
// Fullscreen API, which is the browser this file is about; the last case
// installs one.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

let GuardFriction, fullscreenAvailableOf;
let token = null;
const warns = [];
const violations = [];
let origWarn;

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
  ({ fullscreenAvailableOf } = await import('../../src/jspsych/extension-guard-friction.js'));
  GuardFriction = window.GuardFriction;
  GuardFriction.onViolation((v) => violations.push(v));
  origWarn = console.warn;
  console.warn = (m) => warns.push(String(m));
});

after(() => {
  console.warn = origWarn;
  if (token) GuardFriction.stop(token);
});

const overlayShown = () => {
  const el = document.getElementById('guard-friction-overlay');
  return !!el && el.style.display === 'flex';
};
const starts = () => violations.filter((v) => v.phase === 'start').map((v) => v.reason);

describe('fullscreenAvailableOf', () => {
  const fn = function () {};

  it('is false without any request method on the root element', () => {
    assert.strictEqual(fullscreenAvailableOf({ documentElement: {} }), false);
  });

  it('is true with the unprefixed or a prefixed request method', () => {
    assert.strictEqual(fullscreenAvailableOf({ documentElement: { requestFullscreen: fn } }), true);
    assert.strictEqual(fullscreenAvailableOf({ documentElement: { webkitRequestFullscreen: fn } }), true);
    assert.strictEqual(fullscreenAvailableOf({ documentElement: { mozRequestFullScreen: fn } }), true);
  });

  it('is false when the document says fullscreen is not enabled (a frame without allow="fullscreen")', () => {
    assert.strictEqual(fullscreenAvailableOf({ fullscreenEnabled: false, documentElement: { requestFullscreen: fn } }), false);
    assert.strictEqual(fullscreenAvailableOf({ webkitFullscreenEnabled: false, documentElement: { webkitRequestFullscreen: fn } }), false);
  });

  it('reads the unprefixed flag first, like fullscreenElementOf', () => {
    assert.strictEqual(fullscreenAvailableOf({ fullscreenEnabled: true, webkitFullscreenEnabled: false, documentElement: { requestFullscreen: fn } }), true);
  });
});

describe('friction on a browser without the Fullscreen API', () => {
  it('enforcing, it does not require fullscreen and warns once', () => {
    token = GuardFriction.start({ observeOnly: false });
    assert.deepStrictEqual(starts(), [], 'no not_fullscreen violation');
    assert.strictEqual(overlayShown(), false, 'no curtain the participant cannot dismiss');
    const s = GuardFriction.getCurrentState();
    assert.strictEqual(s.in_violation, false);
    assert.strictEqual(s.fullscreen_required, false);
    assert.strictEqual(warns.filter((w) => /fullscreen/i.test(w)).length, 1, warns.join('\n'));
  });

  it('the other checks still work', () => {
    document.hasFocus = () => false;
    window.dispatchEvent(new window.Event('blur'));
    assert.deepStrictEqual(starts(), ['window_blurred']);
    assert.strictEqual(overlayShown(), true);
    document.hasFocus = () => true;
    window.dispatchEvent(new window.Event('focus'));
    assert.strictEqual(overlayShown(), false);
  });

  it('a second start on the page does not warn again', () => {
    GuardFriction.stop(token);
    token = GuardFriction.start({ observeOnly: false });
    assert.strictEqual(warns.filter((w) => /fullscreen/i.test(w)).length, 1);
  });

  it('with the API present, not_fullscreen is enforced as before', () => {
    GuardFriction.stop(token);
    violations.length = 0;
    document.documentElement.requestFullscreen = function () {};
    token = GuardFriction.start({ observeOnly: false });
    assert.deepStrictEqual(starts(), ['not_fullscreen']);
    assert.strictEqual(overlayShown(), true);
    assert.strictEqual(GuardFriction.getCurrentState().fullscreen_required, true);
  });
});
