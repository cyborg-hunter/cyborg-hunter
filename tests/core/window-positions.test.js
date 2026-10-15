// tests/core/window-positions.test.js
// Pins the window/screen log (session.windowPositions, src/core/signals/
// browser.js) to record-on-change with a session cap:
//   (a) one row is taken the moment the signal starts (not after the first
//       2 s poll);
//   (b) a poll or resize pushes a row only when some field other than `t`
//       differs from the last pushed row;
//   (c) thresholds.maxWindowPositions caps the log (null disables); a row
//       dropped by the cap sets session.windowPositionsCapped = true.
// Same happy-dom harness as monitor-session.test.js.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { PRESETS, DEFAULT_THRESHOLDS } from '../../src/shared/constants.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class StubResizeObserver {
  observe() {}
  disconnect() {}
}

let win, monitor, init;

beforeEach(async () => {
  win = new Window();
  global.window = win;
  global.document = win.document;
  global.Node = win.Node;
  global.MutationObserver = win.MutationObserver;
  global.ResizeObserver = StubResizeObserver;
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

// Moves the window on screen. Changes screenX only, so no resize event fires
// and the poll alone has to notice the change.
function moveWindow(x) {
  Object.defineProperty(win, 'screenX', { value: x, configurable: true });
}

describe('window/screen log: record on change', () => {
  it('takes one row immediately when the session starts', () => {
    monitor = init({ participantId: 'W1' });
    monitor.startSession();
    const rows = monitor.getSessionReport().windowPositions;
    assert.equal(rows.length, 1, 'first row must not wait for the first poll');
    assert.equal(typeof rows[0].t, 'number');
    assert.equal(rows[0].iw, win.innerWidth);
  });

  it('pushes no row on a poll when nothing changed', async () => {
    monitor = init({ participantId: 'W2', thresholds: { windowPositionPollMs: 5 } });
    monitor.startSession();
    await sleep(40);
    assert.equal(monitor.getSessionReport().windowPositions.length, 1);
  });

  it('pushes a row on a poll when the window moved, then stays quiet again', async () => {
    monitor = init({ participantId: 'W3', thresholds: { windowPositionPollMs: 5 } });
    monitor.startSession();
    moveWindow(300);
    await sleep(40);
    const rows = monitor.getSessionReport().windowPositions;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].x, 0);
    assert.equal(rows[1].x, 300);
  });

  it('a session with no cap hit carries windowPositionsCapped: false', () => {
    monitor = init({ participantId: 'W4' });
    monitor.startSession();
    assert.strictEqual(monitor.getSessionReport().windowPositionsCapped, false);
  });
});

describe('window/screen log: session cap', () => {
  it('stops at maxWindowPositions and flags the report', async () => {
    monitor = init({
      participantId: 'W5',
      thresholds: { windowPositionPollMs: 5, maxWindowPositions: 2 },
    });
    monitor.startSession();
    moveWindow(100);
    await sleep(30);
    assert.equal(monitor.getSessionReport().windowPositions.length, 2);
    assert.strictEqual(monitor.getSessionReport().windowPositionsCapped, false,
      'reaching the cap without losing a row is not yet capped');
    moveWindow(200);
    await sleep(30);
    const report = monitor.getSessionReport();
    assert.equal(report.windowPositions.length, 2, 'no row beyond the cap');
    assert.strictEqual(report.windowPositionsCapped, true);
  });

  it('maxWindowPositions: null disables the cap', async () => {
    monitor = init({
      participantId: 'W6',
      thresholds: { windowPositionPollMs: 5, maxWindowPositions: null },
    });
    monitor.startSession();
    for (let x = 1; x <= 4; x++) {
      moveWindow(x * 10);
      await sleep(20);
    }
    const report = monitor.getSessionReport();
    assert.equal(report.windowPositions.length, 5);
    assert.strictEqual(report.windowPositionsCapped, false);
  });

  it('defaults to 2000 rows in every preset', () => {
    assert.strictEqual(DEFAULT_THRESHOLDS.maxWindowPositions, 2000);
    for (const [name, preset] of Object.entries(PRESETS)) {
      const effective = { ...DEFAULT_THRESHOLDS, ...preset.thresholds };
      assert.strictEqual(effective.maxWindowPositions, 2000,
        `preset "${name}" must inherit the window-log cap`);
    }
  });
});
