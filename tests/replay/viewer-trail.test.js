// tests/replay/viewer-trail.test.js
// The replay overlay draws the cursor trail as breadcrumb dots (Can's pick in
// the 2026-09 report palette): one fading dot per trail point, drawn before
// the click ripples and the cursor. The cursor stays the LAST arc drawn
// (r=5 confident, or the uncertain r=7 ring then r=2 centre), because
// tests/browser/replay/cursor-alignment.battery.mjs reads the glyph off the
// final arcs — so a dot must never use radius 2, 5 or 7.
// Recorded draw calls only (happy-dom has no painting); pixels are the
// browser batteries' business.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { FIXTURES_URL } from '@cyborg-hunter/sessionrecording-conformance/corpus';
import { boot } from './support/viewer-harness.js';

const rec = JSON.parse(readFileSync(new URL('jspsych-full.json', FIXTURES_URL), 'utf8'));

// The free-sort segment (91 pointer moves), at its end: a long live trail.
function lastOverlayFrame() {
  const v = boot(rec);
  v.dbg.selectSegment(10);
  v.flushFrames();
  v.dbg.seek(1600);
  v.flushFrames();
  const calls = v.mount.querySelector('canvas.replay-overlay').__ctx.calls;
  let i = calls.length - 1;
  while (i >= 0 && calls[i].name !== 'clearRect') i--;
  return calls.slice(i);
}

describe('replay overlay: breadcrumb-dot trail', () => {
  it('draws the trail as dots, not a polyline', () => {
    const frame = lastOverlayFrame();
    assert.equal(frame.filter(c => c.name === 'lineTo').length, 0, 'no trail strokes');
    const dots = frame.filter(c => c.name === 'arc' && c.args[2] === 2.2);
    assert.ok(dots.length >= 10, `expected a dot per trail point, got ${dots.length}`);
  });

  it('never gives a dot the radius of a cursor glyph (2, 5, 7)', () => {
    const frame = lastOverlayFrame();
    const arcs = frame.filter(c => c.name === 'arc');
    const cursorArcs = arcs.slice(-1);
    for (const a of arcs.slice(0, -1)) {
      if (a.args[2] === 2.2) continue;               // trail dot
      assert.ok(a.args[2] > 4 && a.args[2] !== 5 && a.args[2] !== 7, `ripple radius ${a.args[2]}`);
    }
    assert.equal(cursorArcs[0].args[2], 5, 'the confident cursor is still the last arc');
  });

  it('draws every dot before any ripple or the cursor', () => {
    const frame = lastOverlayFrame();
    const arcs = frame.map((c, i) => ({ c, i })).filter(x => x.c.name === 'arc');
    const lastDot = Math.max(...arcs.filter(x => x.c.args[2] === 2.2).map(x => x.i));
    const firstOther = Math.min(...arcs.filter(x => x.c.args[2] !== 2.2).map(x => x.i));
    assert.ok(lastDot < firstOther, 'dots first');
  });
});
