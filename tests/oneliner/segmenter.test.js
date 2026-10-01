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

let win, monitor, init, origConsoleError, origConsoleWarn;

beforeEach(async () => {
  win = new Window();
  global.window = win;
  global.document = win.document;
  global.Node = win.Node;
  global.MutationObserver = win.MutationObserver;
  global.ResizeObserver = StubResizeObserver;
  ({ init } = await import('../../src/core/monitor.js'));
  origConsoleError = console.error;
  origConsoleWarn = console.warn;
  console.error = () => {};   // the segmenter logs caught failures; keep test output clean
  console.warn = () => {};    // state-machine.js warns on the rejected transitions the failure cases provoke
});

afterEach(() => {
  console.error = origConsoleError;
  console.warn = origConsoleWarn;
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

// A plain delegating wrapper around the (frozen) real monitor; `over` replaces
// individual methods. Carries everything the segmenter and the differ call.
function wrap(real, over) {
  return Object.assign({
    startTrial: (o) => real.startTrial(o),
    endTrial: () => real.endTrial(),
    getSessionReport: () => real.getSessionReport(),
    getSessionScore: () => real.getSessionScore(),
  }, over);
}

// startTrial that runs the real one (so the monitor IS in a trial) and then
// throws while `armed.left > 0`: a partial startTrial failure. Tests re-arm
// it mid-test to aim the failure at one specific call.
const armed = { left: 0 };
function startThrowsAfter(times) {
  armed.left = times;
  return (real) => wrap(real, {
    startTrial: (o) => {
      real.startTrial(o);
      if (armed.left > 0) { armed.left -= 1; throw new Error('start boom'); }
    },
  });
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

  // ── partial failures keep data and resync ──

  it('a startTrial throw after a successful cut still returns the segment, with the error', () => {
    const seg = setup(startThrowsAfter(0));
    seg.start();
    paste('hello');
    armed.left = 1;   // fail only the reopen inside cut()
    const out = seg.cut({ source: 'host' });
    assert.match(out.error, /start boom/);
    assert.ok(out.segment, 'the cut segment is not discarded');
    assert.equal(out.segment.counters.pasteCount, 1);
    assert.equal(out.trialReport.pasteEvents.length, 1);
    assert.equal(seg.state().open, true, 'the monitor did enter the next trial');
    assert.equal(seg.state().currentTrialId, 'span-1');
  });

  it("a partial startTrial failure in rotate leaves the host's trial open and the gap buffered", () => {
    const seg = setup(startThrowsAfter(0));
    seg.start();
    paste('in the gap');
    armed.left = 1;
    const r = seg.rotate({ trialId: 'q1' });
    assert.match(r.error, /start boom/);
    assert.equal(seg.state().open, true);
    assert.equal(seg.state().currentTrialId, 'q1');
    assert.equal(seg.start(), null, 'start() is a no-op, not a trial→trial throw');
    const out = seg.cut({ source: 'host' });
    assert.ok(!out.error, out.error);
    assert.equal(out.segment.trialId, 'q1');
    assert.equal(out.segment.gap.length, 1);
    assert.equal(out.segment.gap[0].pasteEvents.length, 1);
  });

  it('finish after a partial startTrial failure still yields the final segment', () => {
    const seg = setup(startThrowsAfter(1));
    const s = seg.start();
    assert.match(s.error, /start boom/);
    paste('hello');
    const fin = seg.finish({ source: 'final' });
    assert.ok(fin && fin.segment, 'the final segment is not silently dropped');
    assert.equal(fin.segment.source, 'final');
    assert.equal(fin.segment.counters.pasteCount, 1);
  });

  it('endTrial throwing after the state flip → the next rotate works, listeners attached once', () => {
    let throwOnce = true;
    const seg = setup((real) => wrap(real, {
      endTrial: () => {
        const r = real.endTrial();
        if (throwOnce) { throwOnce = false; throw new Error('end boom'); }
        return r;
      },
    }));
    seg.start();
    const bad = seg.rotate({ trialId: 'q1' });
    assert.match(bad.error, /end boom/);
    assert.equal(seg.state().open, false);
    const ok = seg.rotate({ trialId: 'q2' });
    assert.ok(!(ok && ok.error), ok && ok.error);
    assert.equal(seg.state().currentTrialId, 'q2');
    paste('once');
    const out = seg.cut({ source: 'host' });
    assert.equal(out.trialReport.pasteEvents.length, 1, 'no double-attached paste listener');
  });

  it('endTrial throwing before the state flip → the next rotate heals the orphan trial and works', () => {
    let throwOnce = true;
    const seg = setup((real) => wrap(real, {
      endTrial: () => {
        if (throwOnce) { throwOnce = false; throw new Error('end boom'); }
        return real.endTrial();
      },
    }));
    seg.start();
    paste('orphan');
    const bad = seg.rotate({ trialId: 'q1' });
    assert.match(bad.error, /end boom/);
    const ok = seg.rotate({ trialId: 'q2' });
    assert.ok(!(ok && ok.error), ok && ok.error);
    assert.equal(seg.state().open, true);
    assert.equal(seg.state().currentTrialId, 'q2');
    paste('once');
    const out = seg.cut({ source: 'host' });
    assert.ok(!out.error, out.error);
    assert.equal(out.trialReport.pasteEvents.length, 1, 'no double-attached paste listener');
    assert.equal(out.segment.gap.length, 1, 'the orphan span is kept as a gap');
    assert.equal(out.segment.gap[0].pasteEvents.length, 1);
  });

  it('an explicit trialId is not overridden by nextOpts.trialId or rotate opts', () => {
    const seg = setup();
    seg.start();
    seg.cut({ source: 'host', nextTrialId: 'q2', nextOpts: { trialId: 'evil', phase: 'test' } });
    assert.equal(seg.state().currentTrialId, 'q2');
    const out = seg.cut({ source: 'host', nextOpts: { trialId: 'evil' } });
    assert.equal(out.segment.trialId, 'q2');
    assert.equal(out.trialReport.trialId, 'q2');
    assert.equal(out.trialReport.phase, 'test');
    assert.equal(seg.state().currentTrialId, 'span-2', 'nextOpts.trialId never names a span');
  });

  it("abandon then cut → { error }, and the host's own trial is left alone", () => {
    const seg = setup();
    seg.start();
    seg.abandon();
    monitor.startTrial({ trialId: 'manual' });
    let out;
    assert.doesNotThrow(() => { out = seg.cut({ source: 'host' }); });
    assert.equal(out.error, 'abandoned');
    assert.equal(seg.start().error, 'abandoned');
    assert.equal(seg.rotate({ trialId: 'q1' }).error, 'abandoned');
    assert.equal(seg.finish({ source: 'final' }), null);
    const r = monitor.endTrial();
    assert.equal(r.trialId, 'manual', "the host's trial survived the segmenter calls");
  });

  it('after finish, start/rotate/cut return { error: finished } without touching the monitor', () => {
    const seg = setup();
    seg.start();
    seg.finish({ source: 'final' });
    assert.equal(seg.start().error, 'finished');
    assert.equal(seg.rotate({ trialId: 'q1' }).error, 'finished');
    assert.equal(seg.cut({ source: 'host' }).error, 'finished');
    assert.equal(seg.state().open, false, 'nothing was reopened');
    assert.doesNotThrow(() => { monitor.startTrial({ trialId: 'host' }); monitor.endTrial(); });
  });
});

// ch.js monitors the whole page: what happens between two host trials falls
// in a gap span and counts. Manual mode attaches its listeners only inside
// startTrial/endTrial, so the same behaviour there records nothing. Same
// session through both: trial A, then a paste and a tab-away, then trial B.
describe('whole-page monitoring vs manual mode', () => {
  const cfg = { participantId: 'SEG2', thresholds: { tabAwayDurationMs: 5 } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function betweenTrials() {
    paste('between trials');
    win.dispatchEvent(new win.Event('blur')); await sleep(15); win.dispatchEvent(new win.Event('focus'));
  }

  it('an event between two trials counts through the segmenter and not in manual mode', async () => {
    // Manual mode first, destroyed before the second monitor attaches.
    const manual = init(cfg);
    manual.startSession();
    manual.startTrial({ trialId: 'A' }); manual.endTrial();
    await betweenTrials();
    manual.startTrial({ trialId: 'B' }); manual.endTrial();
    const manualReport = manual.getSessionReport();
    const manualScore = manual.getSessionScore();
    manual.destroy();

    // The jsPsych host's calls: boot span, then rotate at each on_load and
    // cut at each on_finish, then finish at the end of the session.
    monitor = init(cfg);
    monitor.startSession();
    const seg = createSegmenter({ monitor, differ: createSegmentDiffer(monitor), clock: () => 0 });
    seg.start();
    seg.rotate({ trialId: 'A' }); seg.cut({ source: 'host', nextTrialId: 'gap-0' });
    await betweenTrials();
    seg.rotate({ trialId: 'B' });
    const b = seg.cut({ source: 'host', nextTrialId: 'gap-1' });
    const last = seg.finish({ source: 'final' }).segment;

    assert.equal(manualReport.pasteCount, 0);
    assert.equal(manualScore.softScore, 0);
    assert.equal(manualScore.trialsCompleted, 2);

    assert.equal(b.segment.gap.length, 1, 'the gap before B is folded into B\'s segment');
    assert.equal(b.segment.gap[0].pasteEvents.length, 1);
    assert.equal(b.trialReport.pasteEvents.length, 0, 'not in B\'s own trial report');
    assert.equal(last.counters.pasteCount, 1);
    assert.ok(last.score.softScore > manualScore.softScore, 'the tab-away raises the soft score');
    assert.equal(last.score.trialsCompleted, 5, 'spans: boot, A, gap, B, final gap (2N+1)');
  });
});
