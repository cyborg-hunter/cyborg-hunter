// src/oneliner/guards.js
// Starts the guard cores that ch.js bundles (window.GuardHoneypot,
// window.GuardFriction) without jsPsych: the honeypot injects its bait DOM and
// subscribes to friction's violations; friction injects its AI refusal
// notices and runs observe-only (it logs violations, shows no curtain) until
// a host mark starts enforcement. Called once per page: by boot on the
// vanilla host, or when a jsPsych page falls back to vanilla.
//
// startGuards({ win, doc, guards: { honeypot, friction }, debug })
//
// Order matters, as in extension-guard-friction.js initialize(): friction's
// start() emits its first violation synchronously, so it is deferred to a
// microtask that runs after the honeypot has subscribed. The honeypot needs
// document.body for its bait elements; when ch.js runs in <head> both guards
// wait for DOMContentLoaded, keeping the same order.
//
// A missing core (only possible outside the ch.js bundle) is skipped. A core
// that throws is reported loudly and does not stop the other one.
//
// A guard already running is not started again. That happens on a jsPsych
// page ch.js could not hook whose researcher listed the guard extensions
// themselves: their initialize() ran before the fallback. A second
// GuardHoneypot.init would reset its violation log, a second
// injectRefusalNotices adds another refresh interval. The signs are the DOM
// each one leaves (the honeypot's #fg-honeypot bait, friction's
// #ai-research-notice) and friction's token.

import { MESSAGES } from './errors.js';

function attempt(name, fn) {
  try { fn(); } catch (e) { console.error(MESSAGES.guardFailed(name, String((e && e.message) || e))); }
}

export function startGuards(opts) {
  var win = opts.win, doc = opts.doc, guards = opts.guards;
  var debug = !!opts.debug;

  function present(id) {
    return typeof doc.getElementById === 'function' && !!doc.getElementById(id);
  }

  function run() {
    if (guards.honeypot && win.GuardHoneypot && !present('fg-honeypot')) {
      attempt('honeypot', function () {
        win.GuardHoneypot.init({ jsPsych: null, friction: win.GuardFriction, debug: debug });
      });
    }
    if (guards.friction && win.GuardFriction && !win._guardFrictionToken && !present('ai-research-notice')) {
      // Once per page, as the friction extension's initialize() does (the
      // notices are not idempotent: each call adds another refresh interval).
      attempt('friction', function () { win.GuardFriction.injectRefusalNotices(); });
      Promise.resolve().then(function () {
        attempt('friction', function () {
          var token = win.GuardFriction.start({ jsPsych: null, observeOnly: true, debug: debug });
          // Same non-enumerable slot the friction extension uses, so whoever
          // finalizes the session can stop() with the right token.
          Object.defineProperty(win, '_guardFrictionToken', {
            value: token, writable: false, enumerable: false, configurable: true
          });
        });
      });
    }
  }

  if (doc.body) run();
  else doc.addEventListener('DOMContentLoaded', run, { once: true });
}
