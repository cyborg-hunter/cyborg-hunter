// tests/cli/session-layout.test.js
// sessionLayout (session-timeline-core.js): the one layout both charts and
// the report page use. The offset is the timeline's own estimate, applied
// alike to trials and to their events; the domain covers every trial.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sessionLayout, deriveSessionOffset, collectEvents } from '../../src/cli/renderers/session-timeline-core.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';

const FIXT = JSON.parse(readFileSync(new URL('../fixtures/demo/DEMO-FIXT.json', import.meta.url), 'utf8'));
const P = extractIntegrityData(FIXT, { outputDir: '.', participantIdField: 'participantId' });

// A session of n trials one second apart, each 0.9 s long with a copy and a
// paste, built with a loop (no recursion, so a long one is safe on any Node).
function evenSession(n) {
  const trials = [];
  for (let i = 0; i < n; i++) {
    trials.push({ trialId: 'n' + i, startTime: i * 1000, duration_ms: 900,
      copyEvents: [{ type: 'copy', t: i * 1000 + 100 }], pasteEvents: [{ type: 'paste', t: i * 1000 + 200 }] });
  }
  return { participantId: 'N-' + n, session: {}, metadata: {}, trials };
}

describe('sessionLayout', () => {
  it('uses the timeline\'s session offset for trials and Text input marks alike', () => {
    const p = structuredClone(P);
    // A session start and a trial whose wall-clock end and rt pin the offset:
    // deriveSessionOffset's first strategy.
    p.metadata = { ...p.metadata, startTime: '2026-07-29T19:11:00.000Z' };
    p.trials[1].rt = 337;
    p.trials[1].pasteEvents = [{ type: 'paste', t: p.trials[1].startTime + 100, text: '' }];
    const L = sessionLayout(p, {});
    const offset = deriveSessionOffset(p, collectEvents(p, {}));
    assert.equal(L.offsetMs, offset);
    assert.notEqual(offset, 0);
    const span = L.spans[1];
    assert.equal(span.startSec, (p.trials[1].startTime - offset) / 1000);
    assert.ok(L.marks.pastes.every((m) => m.sec >= span.startSec && m.sec <= span.endSec), 'the paste inside its trial');
  });

  it('DEMO-FIXT aligns: six spans, a domain past the last trial end, no gallery bands', () => {
    const L = sessionLayout(P, {});
    assert.equal(L.aligned, true);
    assert.equal(L.spans.length, 6);
    assert.ok(L.domainSec >= L.spans[5].endSec);
    assert.equal(L.galleryPhases, false);
    assert.deepEqual(L.guides.phaseChanges, []);
    assert.equal(L.bars.length, 6);
  });

  it('trials without start times do not align; marks and bars are still there', () => {
    const p = structuredClone(P);
    for (const t of p.trials) delete t.startTime;
    const L = sessionLayout(p, {});
    assert.equal(L.aligned, false);
    assert.deepEqual(L.spans, []);
    assert.equal(L.bars.length, 6);
  });

  it('a gallery band of positive width turns the phase strip on', () => {
    const g = { participantId: 'G-1', session: {}, galleryStudyMs: [30000],
      metadata: { startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T00:10:00.000Z' },
      trials: [{ trialId: 'c-1', rulePosition: 0, timestamp: '2026-01-01T00:02:00.000Z', rt: 4000 }] };
    assert.equal(sessionLayout(g, {}).galleryPhases, true);
  });

  it('20 trials spread over the chart keep a line at every start, and their bars keep their glyphs', () => {
    const L = sessionLayout(evenSession(20), {});
    assert.equal(L.aligned, true);
    assert.equal(L.guides.trialStarts.length, 20);
    assert.equal(L.guides.trialLinesHidden, 0);
    assert.ok(L.bars.every((b) => b.glyphs.join('') === 'CP'), 'C and P above every bar');
  });

  it('300 trials are too close for lines or glyphs: the lines are hidden and counted, no bar has a glyph', () => {
    const L = sessionLayout(evenSession(300), {});
    assert.equal(L.aligned, true);
    assert.deepEqual(L.guides.trialStarts, []);
    assert.equal(L.guides.trialLinesHidden, 300);
    assert.ok(L.bars.every((b) => b.glyphs.length === 0), 'no glyph on a 2 px bar');
    // The Text input lane still has every copy and paste.
    assert.equal(L.marks.copies.length, 300);
    assert.equal(L.marks.pastes.length, 300);
  });

  it('an open sidebar runs to the end of the domain, past the session\'s recorded duration', () => {
    const p = structuredClone(P);
    // The recorded duration (10 s) ends before the last trial (about 17.5 s).
    p.metadata = { ...p.metadata, totalDurationMs: 10000 };
    p.session.sidebarEvents = [{ type: 'opened', t: 2000 }];
    const L = sessionLayout(p, {});
    assert.ok(L.domainSec > 17, `the domain covers the last trial (${L.domainSec})`);
    const open = L.events.sidebarSpans.find((s) => !s.closed);
    assert.equal(open.end_sec, L.domainSec);
  });
});
