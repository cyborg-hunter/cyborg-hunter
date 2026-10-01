// Dumped-vs-rolled equivalence: one REAL monitor session (happy-dom), observed
// both through the jsPsych extension's finalize() dump and through per-trial segments
// reassembled by the CLI. The two session objects must be identical, so the
// one-line setup's rolling snapshot carries exactly what manual mode saves.
// Bootstrap mirrors tests/core/monitor-session.test.js.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { createSegmentDiffer } from '../../src/oneliner/segment-diff.js';
import { reassembleSegments } from '../../src/cli/segment-reassembly.js';
import { CyborgHunterExtension } from '../../src/jspsych/extension-cyborg-hunter.js';

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
  it('the same session through finalize() and through segments gives an identical session object', async () => {
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
    // Rolled side first: finalize() below destroys the monitor.
    const rolled = reassembleSegments(segs);
    // Dump side: the real jsPsych extension's finalize(), with a stub jsPsych
    // that captures what it would write into the data.
    let lastTrial, properties = {};
    const ext = new CyborgHunterExtension({
      data: {
        addDataToLastTrial: (d) => { lastTrial = d; },
        addProperties: (p) => { Object.assign(properties, p); },
      },
    });
    ext.monitor = monitor;
    ext.finalize();
    monitor = null;   // destroyed by finalize()
    assert.ok(!('cyborgHunterFinalizeError' in properties), `finalize() failed: ${properties.cyborgHunterFinalizeError}`);
    assert.ok(lastTrial, 'finalize() wrote integritySession/integrityScore');
    assert.deepStrictEqual(rolled.session, lastTrial.integritySession);
    assert.deepStrictEqual(rolled.score, lastTrial.integrityScore);
    assert.equal(rolled.session.tabAwayEvents.length, 3, 'sanity: the three tab-aways made it through');
  });
});
