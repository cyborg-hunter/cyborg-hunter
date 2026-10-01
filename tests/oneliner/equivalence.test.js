// Dumped-vs-rolled equivalence: one REAL monitor session (happy-dom), observed
// both through the finalize()-style dump and through per-trial segments
// reassembled by the CLI. The two session objects must be identical, so the
// one-line setup's rolling snapshot carries exactly what manual mode saves.
// Bootstrap mirrors tests/core/monitor-session.test.js.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { createSegmentDiffer } from '../../src/oneliner/segment-diff.js';
import { reassembleSegments } from '../../src/cli/segment-reassembly.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class StubResizeObserver {
  constructor(cb) { this.cb = cb; }
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

describe('dumped vs rolled session', () => {
  it('the same session through finalize()-style dump and through segments gives an identical session object', async () => {
    monitor = init({ participantId: 'EQ1' });
    monitor.startSession();
    const differ = createSegmentDiffer(monitor);
    const segs = [];
    let idx = 0;
    for (const tid of ['a', 'b', 'c']) {
      monitor.startTrial({ trialId: tid });
      win.dispatchEvent(new win.Event('blur')); await sleep(10); win.dispatchEvent(new win.Event('focus'));
      const report = monitor.endTrial();
      segs.push(differ.cut({ segmentIndex: idx++, source: 'host', trialId: tid, pageOrigin: 0, trialReport: report }));
    }
    // Dump path: exactly what extension-cyborg-hunter.js finalize() builds.
    const full = monitor.getSessionReport();
    const { sidebarEvents = [], keyboardShortcuts = [], windowPositions = [], layoutShifts = [], zoomChanges = [], idleGaps = [],
      extensionInjections = [], tabAwaySums = [], charsPerSec = [], aiExtensionsFound = [],
      hardScore, softScore, anyHardTriggered, trialsCompleted, softScoreThreshold,
      pasteCount = 0, copyCount = 0, dropCount = 0, libraryVersion, config, ...extras } = full;
    const dumped = { pasteCount, copyCount, dropCount, sidebarEvents, keyboardShortcuts, windowPositions, layoutShifts, zoomChanges,
      idleGaps, extensionInjections, tabAwaySums, charsPerSec, aiExtensionsFound, config, ...extras };
    const rolled = reassembleSegments(segs);
    assert.deepStrictEqual(rolled.session, dumped);
    assert.deepStrictEqual(rolled.score, { hardScore, softScore, anyHardTriggered, trialsCompleted, softScoreThreshold });
    assert.equal(rolled.session.tabAwayEvents.length, 3, 'sanity: the three tab-aways made it through');
  });
});
