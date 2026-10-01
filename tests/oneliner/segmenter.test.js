// The segmenter keeps a REAL monitor permanently inside a trial, so a paste
// between host trials is recorded instead of falling outside any listener.
// Real monitor under happy-dom + the real differ; bootstrap mirrors
// tests/oneliner/equivalence.test.js.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { createSegmentDiffer } from '../../src/oneliner/segment-diff.js';
import { createSegmenter } from '../../src/oneliner/segmenter.js';

class StubResizeObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
}

let win, monitor, init, origConsoleError;

beforeEach(async () => {
  win = new Window();
  global.window = win;
  global.document = win.document;
  global.Node = win.Node;
  global.MutationObserver = win.MutationObserver;
  global.ResizeObserver = StubResizeObserver;
  ({ init } = await import('../../src/core/monitor.js'));
  origConsoleError = console.error;
  console.error = () => {};   // the segmenter logs caught failures; keep test output clean
});

afterEach(() => {
  console.error = origConsoleError;
  if (monitor) { try { monitor.destroy(); } catch { /* already destroyed */ } }
  monitor = null;
  win.close();
  delete global.window;
  delete global.document;
  delete global.Node;
  delete global.MutationObserver;
  delete global.ResizeObserver;
});

// A paste on a focused textarea, bubbling to the document listener the
// monitor attaches at startTrial.
function paste(text) {
  const ta = win.document.createElement('textarea');
  win.document.body.appendChild(ta);
  ta.focus();
  const ev = new win.Event('paste', { bubbles: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
  ta.dispatchEvent(ev);
}

function setup(m) {
  monitor = init({ participantId: 'SEG1' });
  monitor.startSession();
  const mon = m ? m(monitor) : monitor;
  const seg = createSegmenter({
    monitor: mon, differ: createSegmentDiffer(mon), clock: () => 12345, sourceDefault: 'host',
  });
  return seg;
}

describe('segmenter', () => {
  it('a paste before the first boundary IS counted', () => {
    const seg = setup();
    seg.start();
    paste('hello');
    const out = seg.cut({ source: 'manual' });
    assert.ok(!out.error, out.error);
    assert.equal(out.segment.counters.pasteCount, 1);
    assert.equal(out.trialReport.pasteEvents.length, 1);
    assert.equal(out.segment.pageOrigin, 12345);
    assert.equal(out.segment.trialId, 'span-0');
    assert.equal(seg.state().currentTrialId, 'span-1', 'a new span opens after the cut');
    assert.equal(seg.state().open, true);
  });

  it('rotate keeps the lifecycle legal and returns a gap report', () => {
    const seg = setup();
    seg.start();
    seg.start();   // idempotent
    const gap = seg.rotate({ trialId: 'q1' });
    assert.ok(gap && Array.isArray(gap.pasteEvents), 'rotate returns the gap trial report');
    const out = seg.cut({ source: 'host' });
    assert.ok(!out.error, out.error);
    assert.equal(out.segment.trialId, 'q1');
    assert.equal(monitor.getSessionScore().trialsCompleted, 2);
  });

  it('gap pastes are folded into the next segment, not the trial report', () => {
    const seg = setup();
    seg.start();
    paste('hello');
    seg.rotate({ trialId: 'q1' });
    const out = seg.cut({ source: 'host' });
    assert.equal(out.segment.gap.length, 1);
    assert.equal(out.segment.gap[0].pasteEvents.length, 1);
    assert.equal(out.trialReport.pasteEvents.length, 0);
    const next = seg.cut({ source: 'host' });
    assert.ok(!('gap' in next.segment), 'the gap buffer is cleared at each cut');
  });

  it('segmentIndex increments across cuts and honours setSegmentIndex', () => {
    const seg = setup();
    seg.start();
    assert.equal(seg.cut({ source: 'host' }).segment.segmentIndex, 0);
    assert.equal(seg.cut({ source: 'host' }).segment.segmentIndex, 1);
    seg.setSegmentIndex(7);
    assert.equal(seg.cut({ source: 'host' }).segment.segmentIndex, 7);
    assert.equal(seg.state().segmentIndex, 8);
  });

  it('finish is idempotent and a cut after finish returns { error } instead of throwing', () => {
    const seg = setup();
    seg.start();
    const first = seg.finish({ source: 'final' });
    assert.equal(first.segment.source, 'final');
    assert.equal(seg.state().open, false);
    assert.equal(seg.finish({ source: 'final' }), null);
    let out;
    assert.doesNotThrow(() => { out = seg.cut({ source: 'host' }); });
    assert.ok(typeof out.error === 'string' && out.error.length > 0);
  });

  it('abandon closes the open trial without a segment and is idempotent', () => {
    const seg = setup();
    seg.start();
    seg.abandon();
    seg.abandon();
    assert.equal(seg.state().open, false);
    assert.equal(monitor.getSessionScore().trialsCompleted, 1);
    // the host can now drive the monitor itself
    assert.doesNotThrow(() => { monitor.startTrial({ trialId: 'manual' }); monitor.endTrial(); });
  });

  it('a monitor whose endTrial throws → cut returns { error: /boom/ } and re-start() recovers', () => {
    let throwOnce = true;
    const seg = setup((real) => ({
      startTrial: (o) => real.startTrial(o),
      getSessionReport: () => real.getSessionReport(),
      getSessionScore: () => real.getSessionScore(),
      endTrial: () => {
        const r = real.endTrial();
        if (throwOnce) { throwOnce = false; throw new Error('boom'); }
        return r;
      },
    }));
    seg.start();
    let out;
    assert.doesNotThrow(() => { out = seg.cut({ source: 'host' }); });
    assert.match(out.error, /boom/);
    assert.equal(seg.state().open, false);
    seg.start();
    const again = seg.cut({ source: 'host' });
    assert.ok(!again.error, again.error);
    assert.equal(again.segment.segmentIndex, 0);
  });
});
