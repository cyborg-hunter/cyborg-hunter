// src/cli/analyzers/centered-clicks.js
// The centered-clicks rule, read from a SessionRecording v2: how many of a
// session's pointer clicks on controls land at the exact centre of the
// clicked element. Browser automation (Playwright, Puppeteer, many AI
// browser agents) clicks the centre of the element's box; people almost
// never do so repeatedly (calibrated on recorded human sessions: no session
// above 1.7 % of clicks within 1.5 px). A near tier (within 5 px) is counted
// for agents that aim from screenshots; it is reported, not judged.
//
// Pure, no DOM. Every field is type-checked: a click with anything unusable
// is not counted, and nothing here throws (the analyzer page runs this on
// recordings a participant could have written).

// The controls a click is judged on: the anchor's tag only, since the trace
// tier records no DOM tree to look up role="button" in.
export const CONTROL_TAGS = Object.freeze(new Set(['button', 'a', 'input', 'select', 'textarea', 'label']));

// At most this many click points are kept for the report's click picture
// (html-index-core.js renderClickPicture); the counts cover every click.
export const MAX_CLICK_POINTS = 200;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object';

// The click's rect when it is one we can judge, else null.
function rectOf(e) {
  const a = isObj(e.anchor) ? e.anchor : null;
  const r = a && isObj(a.rect) ? a.rect : null;
  if (!r || !isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h)) return null;
  return r;
}
const tagOf = (e) => (isObj(e.anchor) && typeof e.anchor.tag === 'string' ? e.anchor.tag.toLowerCase() : '');
// The pinch zoom: an absent camera reads as unzoomed; a malformed one gives NaN, which excludes the click.
const zoom = (e) => (e.camera === undefined ? 1 : isObj(e.camera) && isNum(e.camera.vv_scale) ? e.camera.vv_scale : NaN);

// A click's offset from the centre over the half-size, clamped to [-1, 1]
// and rounded to 3 decimals. A qualifying click lies inside its box, so the
// clamp only guards against rounding.
const unit = (d, half) => Math.round(1000 * Math.max(-1, Math.min(1, d / half))) / 1000;

/**
 * recording: a SessionRecording v2 (or anything: non-v2 gives null).
 * L: { centerExactPx, centerNearPx, minTargetPx, maxTargetPx, pressWindowMs, repeatWindowMs }.
 * → null | { state: 'ok' | 'touch', count, of, trialIds, trials, near: { count, of },
 *            points: [{ u, v, exact }] (at most MAX_CLICK_POINTS) }
 */
export function centeredClicks(recording, L) {
  if (!isObj(recording) || recording.schema_version !== 2 || !Array.isArray(recording.segments)) return null;
  const segments = recording.segments.filter(isObj);
  const eventsOf = (s) => (Array.isArray(s.events) ? s.events.filter(isObj) : []);
  const out = { state: 'ok', count: 0, of: 0, trialIds: [], trials: 0, near: { count: 0, of: 0 }, points: [] };
  // A touch recording: taps are not pointer clicks, so nothing is judged.
  if (segments.some((s) => eventsOf(s).some((e) => typeof e.type === 'string' && e.type.startsWith('touch.')))) {
    return { ...out, state: 'touch' };
  }
  let lastPress = null;     // { t } of the latest mouse.down / mouse.up
  let lastQualifying = null; // { t, x, y } of the previous qualifying click
  for (const s of segments) {
    let hit = false;
    for (const e of eventsOf(s)) {
      if ((e.type === 'mouse.down' || e.type === 'mouse.up') && isNum(e.t)) { lastPress = { t: e.t }; continue; }
      if (e.type !== 'mouse.click' || !isNum(e.t) || !isNum(e.x) || !isNum(e.y)) continue;
      const r = rectOf(e);
      if (!r || !CONTROL_TAGS.has(tagOf(e)) || zoom(e) !== 1) continue;
      // (0,0): a keyboard activation or a click the page's script dispatched.
      if (e.x === 0 && e.y === 0) continue;
      // A pointer click follows a press within pressWindowMs.
      if (!lastPress || e.t - lastPress.t > L.pressWindowMs || e.t < lastPress.t) continue;
      if (Math.min(r.w, r.h) < L.minTargetPx || Math.max(r.w, r.h) > L.maxTargetPx) continue;
      // Inside the rect, edges included: label-forwarded clicks and dropdown
      // choices land outside the element that reports them.
      if (e.x < r.x || e.x > r.x + r.w || e.y < r.y || e.y > r.y + r.h) continue;
      // A repeat at the same point within repeatWindowMs is one click.
      if (lastQualifying && e.t - lastQualifying.t <= L.repeatWindowMs && e.x === lastQualifying.x && e.y === lastQualifying.y) continue;
      lastQualifying = { t: e.t, x: e.x, y: e.y };
      const dx = e.x - (r.x + r.w / 2);
      const dy = e.y - (r.y + r.h / 2);
      const exact = Math.max(Math.abs(dx), Math.abs(dy)) <= L.centerExactPx;
      out.of++;
      out.near.of++;
      if (exact) { out.count++; hit = true; }
      if (Math.hypot(dx, dy) <= L.centerNearPx) out.near.count++;
      // The click picture: every control scaled to one box (minTargetPx
      // keeps the half-sizes above zero).
      if (out.points.length < MAX_CLICK_POINTS) out.points.push({ u: unit(dx, r.w / 2), v: unit(dy, r.h / 2), exact });
    }
    if (hit) {
      out.trials++;
      const id = typeof s.label === 'string' ? s.label : Number.isInteger(s.index) ? String(s.index) : String(out.trials);
      if (out.trialIds.length < 10 && !out.trialIds.includes(id)) out.trialIds.push(id);
    }
  }
  return out;
}
