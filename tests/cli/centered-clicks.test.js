// tests/cli/centered-clicks.test.js
// The centered-clicks rule: browser automation (Playwright, Puppeteer, many
// AI browser agents) clicks the exact centre of the element; people almost
// never do so repeatedly. Calibrated on recorded human sessions and on
// scripted ones (Playwright fixture, a GPT sidebar agent).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { centeredClicks, MAX_CLICK_POINTS } from '../../src/cli/analyzers/centered-clicks.js';

const L = { centerExactPx: 1.5, centerNearPx: 5, minTargetPx: 16, maxTargetPx: 800, pressWindowMs: 1000, repeatWindowMs: 500 };
const rect = (x, y, w, h) => ({ x, y, w, h });
const cam = { vv_scale: 1 };
// A recording with one segment holding `events` (v2 shape, minimal).
const rec = (events, label = 't1') => ({ schema_version: 2, segments: [{ label, events }] });
// A pointer click at (x, y) on a <button> with rect r, its press 80 ms before.
const press = (t, x, y) => ({ type: 'mouse.down', t: t - 80, x, y, button: 0, camera: cam });
const click = (t, x, y, r, tag = 'button') => ({ type: 'mouse.click', t, x, y, button: 0, camera: cam, anchor: { tag, id: null, rect: r, node: 1 } });
const both = (t, x, y, r, tag) => [press(t, x, y), click(t, x, y, r, tag)];

describe('centeredClicks', () => {
  it('counts a click within 1.5 px of the centre on both axes as exact, and within 5 px as near', () => {
    const r = rect(100, 100, 100, 40);                  // centre (150, 120)
    const out = centeredClicks(rec([
      ...both(1000, 150, 120, r),                       // exact
      ...both(3000, 151, 121, r),                       // exact (1, 1)
      ...both(5000, 153, 123, r),                       // near only (3, 3): 4.2 px
      ...both(7000, 120, 110, r),                       // neither
    ]), L);
    assert.equal(out.state, 'ok');
    assert.deepEqual([out.count, out.of], [2, 4]);
    assert.deepEqual([out.near.count, out.near.of], [3, 4]);
    assert.deepEqual(out.trialIds, ['t1']);
    assert.equal(out.trials, 1);
  });

  it('leaves out clicks that are not on a control, too small or too large, outside the rect, at (0,0), without a press, zoomed, or repeated', () => {
    const r = rect(100, 100, 100, 40);
    const out = centeredClicks(rec([
      ...both(1000, 150, 120, rect(100, 100, 100, 40), 'div'),       // not a control
      ...both(3000, 105, 105, rect(100, 100, 10, 10)),               // smaller than 16 px
      ...both(5000, 600, 120, rect(100, 100, 1000, 40)),             // wider than 800 px
      ...both(7000, 90, 90, r),                                      // outside the rect
      press(9000, 0, 0), click(9000, 0, 0, r),                       // (0,0): keyboard or element.click()
      click(11000, 150, 120, r),                                     // no press within 1 s
      { ...press(13000, 150, 120), camera: { vv_scale: 2 } }, { ...click(13000, 150, 120, r), camera: { vv_scale: 2 } }, // pinch-zoomed
      ...both(15000, 150, 120, r),                                   // qualifies
      ...both(15300, 150, 120, r),                                   // repeat within 500 ms at the same point
    ]), L);
    assert.deepEqual([out.count, out.of], [1, 1]);
  });

  it('a recording with any touch event is not judged', () => {
    const r = rect(100, 100, 100, 40);
    const out = centeredClicks(rec([{ type: 'touch.start', t: 10, touches: [] }, ...both(1000, 150, 120, r)]), L);
    assert.equal(out.state, 'touch');
    assert.deepEqual([out.count, out.of], [0, 0]);
    assert.deepEqual(out.points, []);
  });

  it('a hostile recording never throws: junk fields make clicks non-qualifying', () => {
    const junk = [
      null, 7, 'x', { type: 'mouse.click' }, { type: 'mouse.click', x: 'a', y: 1, anchor: { tag: 'button', rect: { x: 0, y: 0, w: 50, h: 50 } } },
      { type: 'mouse.click', t: 1, x: 10, y: 10, anchor: { tag: 'button', rect: { x: NaN, y: 0, w: 50, h: 50 } } },
      { type: 'mouse.click', t: 1, x: 10, y: 10, anchor: { tag: { toString: null }, rect: null } },
      { type: 'mouse.click', t: 1, x: 10, y: 10, camera: 'z', anchor: 'z' },
    ];
    const cases = [null, {}, { schema_version: 2 }, { schema_version: 2, segments: 'x' }, { schema_version: 2, segments: [null, { events: 'x' }, { events: junk }] }];
    for (const c of cases) assert.doesNotThrow(() => centeredClicks(c, L));
    assert.equal(centeredClicks(null, L), null);
    assert.deepEqual(centeredClicks(cases[4], L).of, 0);
    assert.ok(Array.isArray(centeredClicks(cases[4], L).points));
    // A segment index that cannot become a string: the trial id falls back to the trial count.
    const badIndex = { schema_version: 2, segments: [{ index: { toString: null, valueOf: null }, events: both(1000, 150, 120, rect(100, 100, 100, 40)) }] };
    assert.doesNotThrow(() => centeredClicks(badIndex, L));
    assert.deepEqual(centeredClicks(badIndex, L).trialIds, ['1']);
  });

  it('the Playwright fixture recording: every qualifying click is exact', () => {
    const r = JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT-replay-1785352263344.json', 'utf8'));
    const out = centeredClicks(r, L);
    assert.ok(out.of >= 8, `of = ${out.of}`);
    assert.equal(out.count, out.of);
  });

  it('a human tester\'s recording: no exact-centre clicks', () => {
    const r = JSON.parse(readFileSync('examples/demo-sessions/data/DEMO-681w.replay.json', 'utf8'));
    const out = centeredClicks(r, L);
    assert.ok(out.of >= 8, `of = ${out.of}`);
    assert.equal(out.count, 0);
  });

  it('returns each qualifying click as a point: its offset over the half-size and whether it was exact', () => {
    const r = rect(100, 100, 100, 40);                  // centre (150, 120), half-size 50 × 20
    const out = centeredClicks(rec([
      ...both(1000, 150, 120, r),                       // the centre: exact
      ...both(3000, 175, 130, r),                       // (+25, +10): u 0.5, v 0.5
      ...both(5000, 100, 140, r),                       // the left and bottom edges: u −1, v 1
      ...both(7000, 200, 100, r),                       // the right and top edges: u 1, v −1
      ...both(9000, 600, 600, r),                       // outside the rect: not qualifying, no point
    ]), L);
    assert.deepEqual(out.points, [
      { u: 0, v: 0, exact: true }, { u: 0.5, v: 0.5, exact: false }, { u: -1, v: 1, exact: false }, { u: 1, v: -1, exact: false },
    ]);
  });

  it('keeps at most 200 points, while the counts cover every qualifying click', () => {
    const r = rect(100, 100, 100, 40);
    const events = [];
    // 250 clicks 2 s apart, alternating off-centre (120, 110) and exact (150, 120).
    for (let i = 0; i < 250; i++) events.push(...both(1000 + i * 2000, i % 2 ? 150 : 120, i % 2 ? 120 : 110, r));
    const out = centeredClicks(rec(events), L);
    assert.equal(MAX_CLICK_POINTS, 200);
    assert.deepEqual([out.count, out.of, out.points.length], [125, 250, 200]);
    assert.deepEqual(out.points.slice(0, 2), [{ u: -0.6, v: -0.5, exact: false }, { u: 0, v: 0, exact: true }]);
  });
});
