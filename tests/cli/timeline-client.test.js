// tests/cli/timeline-client.test.js
// The Session timeline block's hover and pin script (timeline-client.js):
// the label it writes, and the script run from its source text alone, as the
// report inlines it, over the report's own markup in happy-dom.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { chClock, chTimelineLabel, chPanelBox, chPanelAt, timelineScript } from '../../src/cli/renderers/timeline-client.js';
import { drawTrajectoryGrid } from '../../src/cli/renderers/trajectories-core.js';
import { inlineSrcHazards } from '../../src/shared/inline-safe.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import { parseQualtricsExport } from '../../src/cli/qualtrics-csv.js';
import { sessionLayout } from '../../src/cli/renderers/session-timeline-core.js';
import { hoverData } from '../../src/cli/renderers/timeline-layout.js';
import { reportCss, parseRules, lastProp } from './report-css-helpers.js';

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

  // timelineScript checks its own text, so a hazard typed into an inlined
  // function (a comment that mentions HTML is the usual one) fails the
  // report's build and the analyzer's, not only this test. A function's
  // text is what String gives it: the test gives one function its own
  // toString, then takes it away.
  it('refuses to build when an inlined function holds a hazard', () => {
    for (const hazard of ['/* <!-- */', 'var s = "<script>";']) {
      chClock.toString = () => 'function chClock(sec) { ' + hazard + ' return ""; }';
      try {
        assert.throws(() => timelineScript(), /cannot be inlined/, hazard);
      } finally {
        delete chClock.toString;
      }
    }
    assert.deepEqual(inlineSrcHazards(timelineScript()), [], 'the functions\' own text again');
  });

  // The report's markup for DEMO-FIXT (its trials carry start times, so the
  // charts align), with the script run from its source text in a fresh
  // context: a function that used anything from its module would throw.
  // `edit` changes the participant before the report is built.
  async function page(edit) {
    const config = { outputDir: '.', participantIdField: 'participantId' };
    const raw = JSON.parse(readFileSync(new URL('../fixtures/demo/DEMO-FIXT.json', import.meta.url), 'utf8'));
    const p = extractIntegrityData(raw, config);
    if (edit) edit(p);
    const summaries = computeSummary([p], config);
    const html = await renderIndexHtml(summaries, rankTriage(summaries, detectEdgeExits([p], config), config), [p], config, true, {});
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    win.document.write(html);
    const stage = win.document.querySelector('.tl-stage');
    // happy-dom lays nothing out: the stage reports a 1000 px wide box, so
    // one client pixel is one unit of the chart's own 1000.
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 });
    runInNewContext(timelineScript(), { document: win.document });
    const readout = stage.closest('.tl-block').querySelector('.tl-readout');
    const move = (x) => stage.dispatchEvent(new win.MouseEvent('mousemove', { clientX: x, bubbles: true }));
    return { win, html, stage, readout, move, data: JSON.parse(stage.getAttribute('data-timeline')) };
  }
  const xAt = (d, sec) => d.left + (sec / d.domain) * d.chart;
  const mid = (t) => (t[2] + t[3]) / 2;

  it('the stage holds the typing chart above the timeline', async () => {
    const { stage } = await page();
    assert.deepEqual([...stage.querySelectorAll('img')].map((i) => i.getAttribute('src')),
      ['images/typing_profile_DEMO-FIXT.png', 'images/session_timeline_DEMO-FIXT.png']);
  });

  it('the readout is in the header row, between the heading and "enlarge"; nothing in the stage holds text', async () => {
    const { stage, readout, move, data } = await page();
    const head = stage.closest('.tl-block').querySelector('.tl-head');
    assert.deepEqual([...head.children].map((c) => c.className), ['section-heading', 'tl-readout', 'tl-enlarge']);
    assert.equal(readout.parentNode, head);
    move(xAt(data, mid(data.trials[2])));
    stage.dispatchEvent(new stage.ownerDocument.defaultView.MouseEvent('click', { clientX: 500, bubbles: true }));
    assert.equal(stage.querySelector('.tl-readout'), null);
    assert.deepEqual([...stage.children].map((c) => c.className || c.tagName), ['IMG', 'IMG', 'tl-line', 'tl-pin']);
    assert.equal(stage.textContent.trim(), '', 'only lines over the images');
  });

  it('a move over a trial shows the line and writes its label in the header; the left margin clears both', async () => {
    const { stage, readout, move, data } = await page();
    const tab = data.trials.find((t) => t[0] === 'act1-tabaway');
    move(xAt(data, mid(tab)));
    assert.equal(stage.querySelector('.tl-line').hidden, false);
    assert.equal(readout.textContent, chTimelineLabel(data, mid(tab)));
    assert.match(readout.textContent, /trial act1-tabaway/);
    move(20);
    assert.equal(stage.querySelector('.tl-line').hidden, true);
    assert.equal(readout.textContent, '');
  });

  it('leaving the stage clears the line and the readout', async () => {
    const { win, stage, readout, move, data } = await page();
    move(xAt(data, mid(data.trials[0])));
    assert.notEqual(readout.textContent, '');
    stage.dispatchEvent(new win.MouseEvent('mouseleave'));
    assert.equal(stage.querySelector('.tl-line').hidden, true);
    assert.equal(readout.textContent, '');
  });

  it('an unrounded saved rate reads rounded in the label', async () => {
    const { readout, move, data } = await page((p) => { p.trials[0].charsPerSec = 10 / 3; });
    move(xAt(data, mid(data.trials[0])));
    assert.match(readout.textContent, / · 3\.33 cps$/);
  });

  // A trial id and a phase reach the page from participant data, through
  // data-timeline: they stay an attribute value, make no element, and the
  // label shows them as the text they are.
  it('a hostile trial id and phase stay text: escaped in the attribute, no element made, shown as written', async () => {
    const ID = '"></div><script>x</script>';
    const PHASE = 'a &quot;b&quot; <i>c';
    const plain = await page();
    const { win, html, stage, readout, move, data } = await page((p) => { p.trials[2].trialId = ID; p.trials[2].phase = PHASE; });
    const attr = html.match(/<div class="tl-stage" data-timeline="([^"]*)">/);
    assert.ok(attr, 'the attribute ends where it should');
    assert.ok(!/[<>"]/.test(attr[1]), 'no raw < > or " inside it');
    assert.ok(attr[1].includes('&amp;quot;b&amp;quot;'), "the phase's own &quot; is escaped, not decoded");
    assert.equal(win.document.querySelectorAll('.tl-stage').length, 1);
    for (const tag of ['script', 'i']) {
      assert.equal(win.document.querySelectorAll(tag).length, plain.win.document.querySelectorAll(tag).length, 'no ' + tag + ' made');
    }
    assert.deepEqual(data.trials[2].slice(0, 2), [ID, PHASE]);
    move(xAt(data, mid(data.trials[2])));
    assert.ok(readout.textContent.includes('trial ' + ID + ' (' + PHASE + ')'), readout.textContent);
    assert.equal(readout.children.length, 0);
    assert.equal(stage.querySelectorAll('img').length, 2);
  });

  // The header row's layout, read from the report's CSS (a real browser
  // checks the rendered row): the readout takes the room between the heading
  // and the button and is cut on one line, and neither of those shrinks.
  it('the readout is cut on one line with an ellipsis; the heading and "enlarge" never shrink', async () => {
    const rules = parseRules(await reportCss());
    assert.equal(lastProp(rules, '.tl-head', 'display'), 'flex');
    assert.equal(lastProp(rules, '.tl-head .section-heading', 'flex'), 'none');
    assert.equal(lastProp(rules, '.tl-enlarge', 'flex'), 'none');
    for (const [prop, value] of [['flex', '1 1 auto'], ['min-width', '0'], ['overflow', 'hidden'],
      ['text-overflow', 'ellipsis'], ['white-space', 'nowrap']]) {
      assert.equal(lastProp(rules, '.tl-readout', prop), value, prop);
    }
    assert.equal(lastProp(rules, '.tl-readout', 'position'), null, 'not placed over the stage');
  });

  it('a click places the line, a click elsewhere moves it, a click within 6 px removes it', async () => {
    const { win, stage } = await page();
    const click = (x) => stage.dispatchEvent(new win.MouseEvent('click', { clientX: x, bubbles: true }));
    const pins = () => [...stage.querySelectorAll('.tl-pin')];
    click(500);
    assert.equal(pins().length, 1);
    const before = pins()[0].style.left;
    click(700);
    assert.equal(pins().length, 1, 'still one line');
    assert.notEqual(pins()[0].style.left, before, 'at the new place');
    click(704);
    assert.equal(pins().length, 0);
    click(500);
    click(40);
    assert.equal(pins().length, 1, 'the left margin is no time: the line stays');
  });

  // The box against the real drawing: each panel's frame, as the grid strokes
  // it, must lie inside the box chPanelBox gives for that panel, and no other
  // panel's frame may reach into it.
  it('chPanelBox holds the frame the grid draws for that panel', () => {
    for (const n of [1, 6, 17, 200, 201]) {
      const frames = [];
      const ctx = new Proxy({ measureText: () => ({ width: 10 }), strokeRect: (...a) => frames.push(a) },
        { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
      const createCanvas = (w, h) => ({ width: w, height: h, getContext: () => ctx });
      const p = { participantId: 'x', trials: Array.from({ length: n }, (_, i) => ({ trialId: 't' + i })) };
      const canvas = drawTrajectoryGrid(p, {}, { trajectoryDisplayOrder: 'insertion' }, createCanvas);
      const k = canvas.width / (Math.min(5, n) * 440 + 40);
      assert.equal(frames.length, n);
      frames.forEach(([x, y, w, h], i) => {
        const b = chPanelBox(i, n, canvas.width, canvas.height);
        assert.ok(b.left * canvas.width <= x * k && (b.left + b.width) * canvas.width >= (x + w) * k, 'x, panel ' + i);
        assert.ok(b.top * canvas.height <= y * k && (b.top + b.height) * canvas.height >= (y + h) * k, 'y, panel ' + i);
      });
      if (n > 1) {
        const b = chPanelBox(0, n, canvas.width, canvas.height);
        const [x1] = frames[1];
        assert.ok((b.left + b.width) * canvas.width <= x1 * k, 'the next panel stays out, n=' + n);
      }
    }
    assert.equal(chPanelBox(0, 3, 0, 0), null, 'an image that has not loaded');
    assert.equal(chPanelBox(3, 3, 1360, 800), null, 'no such panel');
    assert.equal(chPanelBox(0, 6, 2240, 100), null, 'an image too short to be this grid');
  });

  it('chPanelAt finds the panel under a point, and none over the header or margins', () => {
    const [count, W, H] = [6, 4480, 1792];
    for (let panel = 0; panel < count; panel++) {
      const b = chPanelBox(panel, count, W, H);
      assert.equal(chPanelAt(b.left + b.width / 2, b.top + b.height / 2, count, W, H), panel);
    }
    assert.equal(chPanelAt(0.001, 0.001, count, W, H), null);
    assert.equal(chPanelAt(0.5, 0.5, count, 0, 0), null, 'an image that has not loaded');
  });

  // A grid of the fixture's six trials, as drawn at twice the pixels.
  function gridOf(win) {
    const grid = win.document.querySelector('img[alt="Mouse trajectories"]');
    let w = 4480;
    Object.defineProperty(grid, 'naturalWidth', { get: () => w });
    Object.defineProperty(grid, 'naturalHeight', { get: () => (w ? 1792 : 0) });
    grid.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 400 });
    return { grid, unload: () => { w = 0; }, load: () => { w = 4480; grid.dispatchEvent(new win.Event('load')); } };
  }

  it('the line opens its trial\'s mouse plot under the block; moved and removed with the line', async () => {
    const { win, stage, data } = await page();
    const { grid } = gridOf(win);
    const block = stage.closest('.tl-block');
    const plot = block.querySelector('.tl-plot');
    const click = (x) => stage.dispatchEvent(new win.MouseEvent('click', { clientX: x, bubbles: true }));
    assert.equal(plot.hidden, true, 'nothing until a click');
    assert.equal(block.querySelector('.tl-plot img'), null, 'no image in the block until then: it hides when its charts fail');
    click(xAt(data, mid(data.trials[0])));
    assert.equal(plot.hidden, false);
    const img = plot.querySelector('img');
    assert.equal(img.getAttribute('src'), grid.getAttribute('src'));
    assert.ok(img.getAttribute('alt').includes('trial ' + data.trials[0][0]), img.getAttribute('alt'));
    const first = img.style.left + img.style.top;
    click(xAt(data, mid(data.trials[1])));
    assert.notEqual(img.style.left + img.style.top, first, 'the next trial\'s panel');
    assert.equal(block.querySelectorAll('.tl-plot img').length, 1);
    click(xAt(data, mid(data.trials[1])));
    assert.equal(plot.hidden, true, 'gone with the line');
    assert.equal(stage.querySelector('.tl-plot'), null, 'and never over the charts');
  });

  it('a click before the grid image has loaded shows the plot when it does', async () => {
    const { win, stage, data } = await page();
    const { unload, load } = gridOf(win);
    unload();
    const plot = stage.closest('.tl-block').querySelector('.tl-plot');
    stage.dispatchEvent(new win.MouseEvent('click', { clientX: xAt(data, mid(data.trials[0])), bubbles: true }));
    assert.equal(plot.hidden, true);
    assert.equal(stage.querySelectorAll('.tl-pin').length, 1);
    load();
    assert.equal(plot.hidden, false);
  });

  // The page's own overlay script does not run here (the browser tests open
  // the whole grid from the header): this is the script's part of the click.
  it('a click on a plot in the grid opens that plot alone; the header leaves the click to the link', async () => {
    const { win } = await page();
    const doc = win.document;
    const { grid } = gridOf(win);
    const count = Number(grid.getAttribute('data-panel-count'));
    assert.equal(count, 6);
    const b = chPanelBox(1, count, 4480, 1792);
    const at = (fx, fy) => {
      const e = new win.MouseEvent('click', { clientX: fx * 1000, clientY: fy * 400, bubbles: true, cancelable: true });
      grid.dispatchEvent(e);
      return e;
    };
    const overlay = doc.getElementById('lightbox');
    assert.equal(at(0.001, 0.001).defaultPrevented, false);
    assert.equal(overlay.classList.contains('open'), false);
    assert.equal(at(b.left + b.width / 2, b.top + b.height / 2).defaultPrevented, true);
    assert.equal(overlay.classList.contains('open'), true);
    assert.equal(doc.getElementById('lightbox-img').hidden, true);
    assert.equal(doc.getElementById('lightbox-stack').hidden, false);
    assert.equal(doc.querySelectorAll('#lightbox-stack .tl-plot-frame img').length, 1);
  });
});
