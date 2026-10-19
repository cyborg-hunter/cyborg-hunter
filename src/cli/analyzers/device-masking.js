// src/cli/analyzers/device-masking.js
// Device masking, read from the session's window log (session.windowPositions:
// one row { x, y, w, h, iw, ih, sw, sh, dpr, vvScale, t } at session start and
// one each time the window, the page or the screen changes; collected under
// collectForPostHoc.windowPositionLog, on by default). Tools that mask a
// browser's fingerprint rewrite what it reports about the screen and leave
// contradictions behind. Three rules:
//
//   R1   a pixel ratio no browser produces: within 1e-6 of an OS scale × page
//        zoom product, yet not a float32 number. Browsers compute the ratio
//        in float32 (0.8999999761581421 for 0.9); a tool writes 1.00000001.
//   R2   a pixel ratio frozen under a page zoom: two consecutive rows with the
//        same window position and size, the same pinch scale, and an inner
//        width and height that change by the same factor (within 3 %, by at
//        least 8 %) while the pixel ratio stays put. A page zoom moves the
//        ratio in Chrome and Firefox; a side panel changes the width only.
//        Not applied to Safari, which keeps the ratio fixed under zoom.
//   R3a  a window larger than the screen it reports, by more than 3 % + 20 px.
//        Not applied to Firefox, which reports the outer window in zoomed
//        pixels (seen in the log as w × dpr staying put while w moves with a
//        zoom, or read from the browser line), nor when the log shows a
//        second monitor (the screen size changes, or the window sits off the
//        primary screen).
//   R3b  a fullscreen window (no browser chrome) more than 10 % smaller than
//        the screen it reports: corroboration only, reported next to another
//        rule and never alone, and not with a second monitor in the log.
//
// The browser comes from the session recording's browser line
// (replay.recording.user_agent) when there is one; nothing new is collected.
// Calibrated on recorded human sessions: R1 fired only on 1.00000001, and two
// thirds of the sessions with R1, R2 or R3a were people the researchers kept.
// Masking hides a device; it is not evidence of AI use.
//
// Pure, no DOM, no I/O. A row with a missing or non-positive size or ratio
// is skipped; nothing here throws.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object';
const POSITIVE = ['w', 'h', 'iw', 'ih', 'sw', 'sh', 'dpr'];
const isRow = (e) => isObj(e) && isNum(e.x) && isNum(e.y) && POSITIVE.every((k) => isNum(e[k]) && e[k] > 0);

// The pixel ratios a browser can report: OS scale × page zoom (Chrome's zoom
// levels), for the usual OS scales.
const OS_SCALES = [1, 1.1, 1.2, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
const ZOOMS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const PRODUCTS = [...new Set(OS_SCALES.flatMap((s) => ZOOMS.map((z) => s * z)))];

// R1: not a float32 number, and within 1e-6 of a product without being one
// (a product itself, 1.1 say, is a ratio some browsers report exactly).
export function isPerturbedDpr(d) {
  let near = PRODUCTS[0];
  for (const p of PRODUCTS) if (Math.abs(p - d) < Math.abs(near - d)) near = p;
  const diff = Math.abs(d - near);
  return Math.fround(d) !== d && diff >= 1e-12 && diff < 1e-6;
}

// The browser family from a user-agent string, by engine where the rules
// need it: every browser on iOS runs WebKit ('safari'); Edge, Opera and the
// other Chromium browsers say Chrome/ ('chrome'). null without a string.
export function browserFamily(ua) {
  if (typeof ua !== 'string' || ua === '') return null;
  if (/iPhone|iPad|iPod/.test(ua)) return 'safari';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Chromium\//.test(ua)) return 'chrome';
  if (/AppleWebKit\//.test(ua)) return 'safari';
  return 'other';
}

/**
 * participant: an ingested participant ({ session, replay }); anything else
 * gives 'not recorded'.
 * → { state: 'ok' | 'not recorded', rules: Array<'R1' | 'R2' | 'R3a'>,
 *     corroborated: boolean (R3b next to another rule),
 *     browser: 'chrome' | 'firefox' | 'safari' | 'other' | null,
 *     detail: string (what contradicts what; '' when no rule fired) }
 */
export function analyzeDeviceMasking(participant) {
  const session = isObj(participant) && isObj(participant.session) ? participant.session : null;
  const rows = session && Array.isArray(session.windowPositions) ? session.windowPositions.filter(isRow) : [];
  const replay = isObj(participant) && isObj(participant.replay) ? participant.replay : null;
  const recording = replay && isObj(replay.recording) ? replay.recording : null;
  const browser = browserFamily(recording ? recording.user_agent : null);
  if (!rows.length) return { state: 'not recorded', rules: [], corroborated: false, browser, detail: 'window log not recorded' };
  // Consecutive rows, in log order (the monitor appends them as they come).
  const pairs = rows.slice(1).map((b, i) => [rows[i], b]);

  const perturbed = rows.map((e) => e.dpr).find(isPerturbedDpr);
  const frozen = browser === 'safari' ? undefined : pairs.find(([a, b]) => {
    if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.vvScale !== b.vvScale) return false;
    const fw = b.iw / a.iw, fh = b.ih / a.ih;
    return Math.abs(fw - 1) >= 0.08 && Math.abs(fw - fh) <= 0.03 && a.dpr === b.dpr;
  });

  // A second monitor: the reported screen changes, or the window sits off
  // the primary screen (a minimised window parks far off-screen and does
  // not count).
  const minimised = (e) => e.x < -10000 || e.y < -10000;
  const otherMonitor = new Set(rows.map((e) => e.sw + 'x' + e.sh)).size > 1
    || rows.some((e) => !minimised(e) && (e.x >= e.sw || e.x <= -e.sw / 2 || e.y >= e.sh));
  const onScreen = (e) => e.x > -20 && e.y > -20 && e.x < e.sw && e.y < e.sh;
  // Firefox's convention: the outer width moves with a zoom while w × dpr
  // stays put.
  const outerScales = pairs.some(([a, b]) => a.x === b.x && a.y === b.y
    && Math.abs(b.w / a.w - 1) >= 0.08 && Math.abs((b.w * b.dpr) / (a.w * a.dpr) - 1) <= 0.03);
  const larger = browser === 'firefox' || outerScales || otherMonitor ? undefined
    : rows.find((e) => onScreen(e) && (e.w > 1.03 * e.sw + 20 || e.h > 1.03 * e.sh + 20));
  // No browser chrome: the inner height, in window pixels (× w / iw), fills
  // the window within 20 px. Two-sided, so a side panel (which narrows the
  // page, not the window) is not read as a zoom.
  const chromeless = (e) => Math.abs(e.ih * (e.w / e.iw) - e.h) <= 20;
  const smaller = otherMonitor ? undefined
    : rows.find((e) => onScreen(e) && chromeless(e) && (e.w < 0.9 * e.sw || e.h < 0.9 * e.sh));

  const rules = [];
  const parts = [];
  if (perturbed !== undefined) { rules.push('R1'); parts.push(`pixel ratio ${perturbed}`); }
  if (frozen) {
    rules.push('R2');
    const what = perturbed !== undefined ? 'unchanged through a page zoom' : `pixel ratio ${frozen[0].dpr} unchanged through a page zoom`;
    parts.push(browser === null ? `${what} (browser unknown)` : what);
  }
  if (larger) { rules.push('R3a'); parts.push(`window ${larger.w} × ${larger.h} larger than the ${larger.sw} × ${larger.sh} screen`); }
  const corroborated = rules.length > 0 && smaller !== undefined;
  if (corroborated) parts.push(`fullscreen window ${smaller.w} × ${smaller.h} smaller than the ${smaller.sw} × ${smaller.sh} screen`);
  return { state: 'ok', rules, corroborated, browser, detail: parts.join(', ') };
}
