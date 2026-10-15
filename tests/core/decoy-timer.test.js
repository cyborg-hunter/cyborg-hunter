// A trial without an explicit decoyAnswer or a decoyMap entry defers its
// decoy injection to a zero-delay timer (startTrial: the trial's UI may not be
// up yet). That timer was not tracked, and dom-protection.js's stale-trial
// guard only aborted when a DIFFERENT trial was current, so a trial ended (or
// a monitor destroyed) before the timer fired still got its decoy inserted
// into the page afterwards. endTrial() and destroy() now cancel the pending
// injection, and the guard also aborts when no trial is current.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { injectDecoy } from '../../src/core/signals/dom-protection.js';

const tick = () => new Promise((r) => setTimeout(r, 10));

let win, monitor, init;

beforeEach(async () => {
  win = new Window();
  global.window = win;
  global.document = win.document;
  global.Node = win.Node;
  global.MutationObserver = win.MutationObserver;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  ({ init } = await import('../../src/core/monitor.js'));
});

afterEach(() => {
  if (monitor) { try { monitor.destroy(); } catch { /* already destroyed */ } }
  monitor = null;
  win.close();
  delete global.window;
  delete global.document;
  delete global.Node;
  delete global.MutationObserver;
  delete global.ResizeObserver;
});

// A boolean, not the element: an assertion message that inspects a happy-dom
// node takes the runner tens of seconds to print.
const decoy = () => !!document.getElementById('ch-decoy');

describe('deferred decoy injection', () => {
  it('is injected when the trial is still running (control)', async () => {
    monitor = init({ participantId: 'D0', decoyAnswers: true });
    monitor.startSession();
    monitor.startTrial({ trialId: 't1' });
    assert.strictEqual(decoy(), false, 'deferred, not synchronous');
    await tick();
    assert.strictEqual(decoy(), true, 'the timer injects it');
  });

  it('is not injected after its trial ended', async () => {
    monitor = init({ participantId: 'D1', decoyAnswers: true });
    monitor.startSession();
    monitor.startTrial({ trialId: 't1' });
    monitor.endTrial();
    await tick();
    assert.strictEqual(decoy(), false);
  });

  it('is not injected after the monitor was destroyed', async () => {
    monitor = init({ participantId: 'D2', decoyAnswers: true });
    monitor.startSession();
    monitor.startTrial({ trialId: 't1' });
    monitor.destroy();
    monitor = null;
    await tick();
    assert.strictEqual(decoy(), false);
  });

  it('the stale-trial guard aborts when no trial is current', () => {
    const trialData = { trialId: 't1' };
    injectDecoy({ decoyAnswer: 'x' }, 't1', { decoyAnswers: true, decoyFraming: 'answer-key', decoyVisibility: 'offscreen' },
      trialData, () => null);
    assert.strictEqual(decoy(), false);
  });
});
