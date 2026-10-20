// tests/cli/timeline-client.test.js
// The Session timeline block's hover and pin script (timeline-client.js):
// the label it writes, and the script run from its source text alone, as the
// report inlines it, over the report's own markup in happy-dom.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { chClock, chTimelineLabel, timelineScript } from '../../src/cli/renderers/timeline-client.js';
import { inlineSrcHazards } from '../../src/shared/inline-safe.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import { parseQualtricsExport } from '../../src/cli/qualtrics-csv.js';
import { sessionLayout } from '../../src/cli/renderers/session-timeline-core.js';
import { hoverData } from '../../src/cli/renderers/timeline-layout.js';

// Trial entries as hoverData writes them: [id, phase, startSec, endSec, cps,
// truncated].
const DATA = { w: 1000, left: 90, chart: 880, domain: 100,
  trials: [['tut-1', 'tutorial', 0, 40, 2.6, false], ['q-1', null, 40, 80, null, false]],
  tabs: [[50, 60]], sidebars: [[70, 100]] };

describe('the hover label', () => {
  it('writes the time as m:ss', () => {
    assert.equal(chClock(0), '0:00');
    assert.equal(chClock(65.4), '1:05');
    assert.equal(chClock(59.6), '1:00');
  });

  it('names the trial, its phase and its judged rate', () => {
    assert.equal(chTimelineLabel(DATA, 12), '0:12 · trial tut-1 (tutorial) · 2.6 cps');
  });

  it('a trial with no judged rate gets none; "tabbed away" and "sidebar open" when they were', () => {
    assert.equal(chTimelineLabel(DATA, 55), '0:55 · trial q-1 · tabbed away');
    assert.equal(chTimelineLabel(DATA, 75), '1:15 · trial q-1 · sidebar open');
  });

  it('between the trials, and with no trials at all', () => {
    assert.equal(chTimelineLabel(DATA, 90), '1:30 · between trials · sidebar open');
    assert.equal(chTimelineLabel({ ...DATA, trials: [] }, 5), '0:05');
  });

  it('a page whose events the payload did not keep says so, after the trial', () => {
    const data = { ...DATA, trials: [['page-1', null, 0, 60, null, true], ['page-2', null, 60, 80, 3.1, false]] };
    assert.equal(chTimelineLabel(data, 55), '0:55 · trial page-1 · events not kept · tabbed away');
    assert.equal(chTimelineLabel(data, 65), '1:05 · trial page-2 · 3.1 cps');
  });
});

describe('trimmed Qualtrics pages', () => {
  // The Qualtrics reader's fixture: response R_2 is a payload reduced to
  // level 2, so every page but the newest lost its events (integrityTruncated).
  const csv = readFileSync(new URL('./fixtures/qualtrics-export.csv', import.meta.url), 'utf8');
  const p = extractIntegrityData(parseQualtricsExport(csv, {}).responses[1].raw, {});

  it('the label over a trimmed page says its events were not kept; over the newest page it does not', () => {
    const data = hoverData(sessionLayout(p, {}));
    assert.deepEqual(data.trials.map((t) => [t[0], t[5]]), [
      ['page-1', true], ['page-2', true], ['page-3', true], ['page-4', true], ['page-5', false]]);
    const mid = (t) => (t[2] + t[3]) / 2;
    for (const t of data.trials.slice(0, 4)) {
      assert.match(chTimelineLabel(data, mid(t)), new RegExp('trial ' + t[0] + ' · events not kept'));
    }
    assert.doesNotMatch(chTimelineLabel(data, mid(data.trials[4])), /not kept/);
  });
});

describe('the inline script', () => {
  it('holds nothing the HTML parser would react to', () => {
    const src = timelineScript();
    assert.deepEqual(inlineSrcHazards(src), []);
    assert.equal(/<\/script/i.test(src), false);
  });

  // The report's markup for DEMO-FIXT (its trials carry start times, so the
  // charts align), with the script run from its source text in a fresh
  // context: a function that used anything from its module would throw.
  async function page() {
    const config = { outputDir: '.', participantIdField: 'participantId' };
    const raw = JSON.parse(readFileSync(new URL('../fixtures/demo/DEMO-FIXT.json', import.meta.url), 'utf8'));
    const p = extractIntegrityData(raw, config);
    const summaries = computeSummary([p], config);
    const html = await renderIndexHtml(summaries, rankTriage(summaries, detectEdgeExits([p], config), config), [p], config, true, {});
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    win.document.write(html);
    const stage = win.document.querySelector('.tl-stage');
    // happy-dom lays nothing out: the stage reports a 1000 px wide box, so
    // one client pixel is one unit of the chart's own 1000.
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 });
    runInNewContext(timelineScript(), { document: win.document });
    return { win, stage, data: JSON.parse(stage.getAttribute('data-timeline')) };
  }
  const xAt = (d, sec) => d.left + (sec / d.domain) * d.chart;

  it('the stage holds the typing chart above the timeline', async () => {
    const { stage } = await page();
    assert.deepEqual([...stage.querySelectorAll('img')].map((i) => i.getAttribute('src')),
      ['images/typing_profile_DEMO-FIXT.png', 'images/session_timeline_DEMO-FIXT.png']);
  });

  it('a move over a trial shows the line and its label; the left margin hides them', async () => {
    const { win, stage, data } = await page();
    const tab = data.trials.find((t) => t[0] === 'act1-tabaway');
    stage.dispatchEvent(new win.MouseEvent('mousemove', { clientX: xAt(data, (tab[2] + tab[3]) / 2), bubbles: true }));
    assert.equal(stage.querySelector('.tl-line').hidden, false);
    assert.match(stage.querySelector('.tl-readout').textContent, /trial act1-tabaway/);
    stage.dispatchEvent(new win.MouseEvent('mousemove', { clientX: 20, bubbles: true }));
    assert.equal(stage.querySelector('.tl-line').hidden, true);
    assert.equal(stage.querySelector('.tl-readout').hidden, true);
  });

  it('a click pins a line, a click within 6 px removes it, a click elsewhere adds another', async () => {
    const { win, stage } = await page();
    const click = (x) => stage.dispatchEvent(new win.MouseEvent('click', { clientX: x, bubbles: true }));
    click(500);
    assert.equal(stage.querySelectorAll('.tl-pin').length, 1);
    click(504);
    assert.equal(stage.querySelectorAll('.tl-pin').length, 0);
    click(500);
    click(700);
    assert.equal(stage.querySelectorAll('.tl-pin').length, 2);
    click(40);
    assert.equal(stage.querySelectorAll('.tl-pin').length, 2, 'the left margin is no time: nothing pinned');
  });
});
