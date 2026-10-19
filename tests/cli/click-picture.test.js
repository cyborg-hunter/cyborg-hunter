// tests/cli/click-picture.test.js
// The click picture under the pointer verdict: where each qualifying click
// landed on its control, from the centered-clicks rule's points. The
// exact-centre clicks are one red dot sized by their count, the rest grey
// dots, with a legend giving both counts; the title and the sentence about
// the clicks are the figure's caption, under the SVG. Nothing is drawn for a
// touch recording, without a recording, or without a qualifying click.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCursor } from '../../src/cli/analyzers/cursor.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderClickPicture, renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';

const L = { centerExactPx: 1.5 };
const cc = (count, of, points) => ({ state: 'ok', count, of, trialIds: [], trials: 0, near: { count, of }, points });
const atCentre = (k) => Array.from({ length: k }, () => ({ u: 0, v: 0, exact: true }));
// The box is 150 × 60 at (14, 14): its centre is (89, 44).
const greyDots = (svg) => (svg.match(/r="3\.2"/g) || []).length - 1;   // minus the legend's grey key

describe('renderClickPicture', () => {
  it('draws the exact clicks as one red dot sized by their count, the rest as grey dots, with the legend and the caption', () => {
    const svg = renderClickPicture(cc(3, 5, [...atCentre(3), { u: 1, v: -1, exact: false }, { u: -0.5, v: 0.5, exact: false }]), L);
    assert.ok(svg.startsWith('<figure class="click-picture">'));
    assert.match(svg, /<circle cx="89" cy="44" r="7" fill="#d32f2f" fill-opacity="0.85"\/>/);
    assert.match(svg, /<circle cx="164\.0" cy="14\.0" r="3\.2"/);   // u 1, v −1: the top right corner
    assert.match(svg, /<circle cx="51\.5" cy="59\.0" r="3\.2"/);
    assert.equal(greyDots(svg), 2);
    assert.match(svg, />3 at the exact centre \(within 1\.5 px\)</);
    assert.match(svg, />2 elsewhere</);
    assert.match(svg, /aria-label="5 qualifying clicks, each control scaled to this box"/);
    assert.match(svg, /<\/svg>\s*<figcaption><b>Where each click landed on its control\.<\/b>/);
    // The SVG itself holds no title and no caption sentence: both are in the figcaption.
    const inSvg = svg.slice(0, svg.indexOf('</svg>'));
    assert.doesNotMatch(inSvg, /where each click landed/i);
    assert.doesNotMatch(inSvg, /<text[^>]*>[^<]*qualifying clicks/);
  });
  it('the red dot stops growing at ten exact clicks; with none there is no red dot', () => {
    assert.match(renderClickPicture(cc(20, 20, atCentre(20)), L), /cx="89" cy="44" r="10"/);
    const none = renderClickPicture(cc(0, 2, [{ u: 0.2, v: 0.1, exact: false }, { u: -0.2, v: 0, exact: false }]), L);
    assert.ok(!none.includes('cx="89" cy="44"'));
    assert.match(none, />0 at the exact centre/);
    assert.equal(greyDots(none), 2);
  });
  it('says how many clicks it drew when the points were capped', () => {
    const many = Array.from({ length: 200 }, () => ({ u: 0.5, v: 0.5, exact: false }));
    const svg = renderClickPicture(cc(0, 250, many), L);
    assert.match(svg, /250 qualifying clicks, each control scaled to this box; the first 200 drawn/);
    assert.match(svg, /<figcaption><b>Where each click landed on its control\.<\/b> 250 qualifying clicks, each control scaled to this box; the first 200 drawn\.<\/figcaption>/);
  });
  it('skips a point whose u or v is not a finite number', () => {
    const svg = renderClickPicture(cc(0, 4, [null, { u: 'x', v: 0 }, { u: NaN, v: 1 }, { u: Infinity, v: 0 }]), L);
    assert.doesNotMatch(svg, /NaN|Infinity/);
    assert.equal(greyDots(svg), 0);
  });
  it('draws nothing without a rule, for a touch recording, without a qualifying click or without points', () => {
    for (const c of [null, undefined, { ...cc(1, 1, []), state: 'touch' }, cc(0, 0, []), cc(1, 2, null)]) assert.equal(renderClickPicture(c, L), '');
  });
  it('escapes the threshold it prints', () => {
    assert.match(renderClickPicture(cc(1, 1, atCentre(1)), { centerExactPx: '<b>' }), /within &lt;b&gt; px/);
  });
});

describe('the click picture in the report', () => {
  const config = { outputDir: '.', participantIdField: 'participantId' };
  const mv = (x, y, t) => ({ x, y, cx: x, cy: y, t, type: 'move' });
  const ck = (x, y, t) => ({ x, y, cx: x, cy: y, t, type: 'click', trusted: true, detail: 1, pointerType: 'mouse' });
  const track = () => [mv(100, 100, 0), mv(150, 130, 50), mv(210, 150, 105), mv(260, 160, 160), ck(260, 160, 200)];
  // Two trials with a pointer stream and device facts, and the given replay.
  const person = (id, replay) => ({
    participantId: id,
    trials: [0, 1].map((i) => ({ trialId: 'q' + (i + 1), startTime: 1000 + i * 6000, duration_ms: 5000, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0, mouseEvents: track(), libraryVersion: '0.14.0' })),
    session: { device: { maxTouchPoints: 0, coarsePointer: false, webdriver: false } },
    ...(replay ? { replay } : {})
  });
  // n clicks on a 100 × 40 button at (100, 100), the first `exact` at its centre.
  const recording = (n, exact) => {
    const events = [];
    for (let i = 0; i < n; i++) {
      const t = 1000 + i * 2000, x = i < exact ? 150 : 120, y = i < exact ? 120 : 110;
      events.push({ type: 'mouse.down', t: t - 80, x, y, button: 0, camera: { vv_scale: 1 } });
      events.push({ type: 'mouse.click', t, x, y, button: 0, camera: { vv_scale: 1 }, anchor: { tag: 'button', id: null, rect: { x: 100, y: 100, w: 100, h: 40 }, node: 1 } });
    }
    return { schema_version: 2, segments: [{ label: 'q1', events }] };
  };
  const render = async (participants) => {
    const summaries = computeSummary(participants, config);
    const cursors = analyzeCursor(participants);
    summaries.forEach((s, i) => { s.cursorAnalysis = cursors[i]; });
    const triage = rankTriage(summaries, detectEdgeExits(participants, config), config);
    return renderIndexHtml(summaries, triage, participants, config, false);
  };

  it('sits under the verdict and above the details when the rule judged at least one click', async () => {
    const html = await render([person('PIC', { recording: recording(10, 3) })]);
    const fig = html.indexOf('<figure class="click-picture">');
    const verdict = html.indexOf('class="cursor-verdict"');
    assert.ok(verdict >= 0);
    assert.ok(fig > verdict);
    assert.ok(fig < html.indexOf('<details class="cursor-details">'));
    assert.match(html, />3 at the exact centre \(within 1\.5 px\)</);
    assert.match(html, />7 elsewhere</);
  });
  it('is absent without a recording, for a touch recording and with no qualifying click', async () => {
    const touchRec = { schema_version: 2, segments: [{ label: 'q1', events: [{ type: 'touch.start', t: 10, touches: [] }] }] };
    const noClicks = { schema_version: 2, segments: [{ label: 'q1', events: [] }] };
    for (const replay of [undefined, { recording: touchRec }, { recording: noClicks }]) {
      assert.ok(!(await render([person('NOPIC', replay)])).includes('<figure class="click-picture">'));
    }
  });
});
