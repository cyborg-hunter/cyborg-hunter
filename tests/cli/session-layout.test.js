// tests/cli/session-layout.test.js
// sessionLayout (session-timeline-core.js): the one layout both charts and
// the report page use. The offset is the timeline's own estimate, applied
// alike to trials and to their events; the domain covers every trial.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sessionLayout, deriveSessionOffset, collectEvents, drawSessionTimeline } from '../../src/cli/renderers/session-timeline-core.js';
import { drawTypingProfile } from '../../src/cli/renderers/typing-profile-core.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { buildReport } from '../../src/cli/report-core.js';
import { analyzeTyping } from '../../src/cli/analyzers/typing.js';
import { hoverData } from '../../src/cli/renderers/timeline-layout.js';
import { makeRecordingCanvasFactory } from './recording-canvas.js';
import { keyRecording, participantFromRecording, botGaps, humanGaps } from './typing-fixtures.js';

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

  it('timed trials on a domain of no length do not align: no timeline is drawn, so the typing chart is one bar per trial', async () => {
    // Session start and end times that do not parse leave the timeline's own
    // domain unreadable; the trials all start and end at the session's start.
    const p = { participantId: 'Z-0', session: {}, metadata: { startTime: 'not a time', endTime: 'not a time' },
      trials: [{ trialId: 'a', startTime: 0, duration_ms: 0, charsPerSec: 5 }, { trialId: 'b', startTime: 0, duration_ms: 0, charsPerSec: 6 }] };
    const L = sessionLayout(p, {});
    assert.equal(L.domainSec, 0);
    assert.equal(L.aligned, false);
    assert.deepEqual(L.spans, []);
    assert.deepEqual(L.guides.trialStarts, []);
    assert.equal(await drawSessionTimeline(p, {}, makeRecordingCanvasFactory([])), null, 'no timeline');
    const log = [];
    drawTypingProfile(p, {}, makeRecordingCanvasFactory(log));
    assert.deepEqual(log[0], ['createCanvas', 600, 300], 'one bar per trial');
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

describe('under a phase scope', () => {
  // A tutorial typed by a person, then the main trial typed by software
  // (synthetic keys, typing-fixtures.js). The scope keeps the main trial,
  // whose rhythm rule fires.
  const scoped = () => {
    const p = participantFromRecording('SCOPED', keyRecording([['tutorial', 10, humanGaps(120, 1)], ['main', 60010, botGaps(30)]]));
    p.trials[0].phase = 'tutorial';
    p.trials[1].phase = 'main';
    return p;
  };
  const config = { outputDir: '.', participantIdField: 'participantId', phaseScope: { include: ['main'] } };

  it('the typing chart keeps the R of an in-scope trial, and the hover rate is the full analysis\'s', async () => {
    const log = [];
    const built = await buildReport([scoped()], config, {
      sink: () => {}, createCanvas: makeRecordingCanvasFactory(log), encodePng: async () => new Uint8Array(0) });
    // The summary's analysis covers the scoped trial only: one entry for the
    // two trials the charts draw, so the chart cannot use it.
    const summaryAnalysis = built.summaries[0].typingAnalysis;
    assert.equal(summaryAnalysis.byIndex.length, 1);
    // Only the typing chart writes a bare R: its legend's and the main trial's.
    assert.equal(log.filter((c) => c[0] === 'fillText' && c[1] === 'R').length, 2);
    // The chart's rates come from the analysis of every trial: the main
    // trial's rate is the one the full analysis judged, which the summary's
    // analysis would have left out.
    const p = scoped();
    const full = analyzeTyping(p, config);
    assert.equal(full.byIndex[1].rhythm, true);
    assert.ok(full.byIndex[1].cps > 0);
    assert.equal(hoverData(sessionLayout(p, config, full)).trials[1][4], full.byIndex[1].cps);
    assert.equal(hoverData(sessionLayout(p, config, summaryAnalysis)).trials[1][4], null);
  });

  // The page is built after the replay pass, which takes a recording it
  // cannot load (this synthetic one) out of the participant: an analysis
  // taken then would see no keys. The page reads the one the chart drew.
  it('the page\'s hover numbers come from the same full analysis as the chart', async () => {
    let html = '';
    const p = scoped();
    await buildReport([p], config, {
      sink: (name, body) => { if (name === 'index.html') html = body; },
      createCanvas: makeRecordingCanvasFactory([]), encodePng: async () => new Uint8Array(0) });
    assert.equal(p.replay.recording, undefined, 'the replay pass took the recording out');
    const attr = html.match(/<div class="tl-stage" data-timeline="([^"]*)">/);
    assert.ok(attr, 'the block carries its hover numbers');
    const data = JSON.parse(attr[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    const full = analyzeTyping(scoped(), config);
    assert.equal(data.trials.length, 2);
    assert.ok(full.byIndex[1].cps > 0);
    assert.equal(data.trials[1][4], full.byIndex[1].cps, 'the main trial\'s rate, which the scoped analysis leaves out');
  });
});
