// tests/cli/device-masking.test.js
// Device masking from the window log: each rule on synthetic rows, the
// Safari and Firefox exclusions, R3b as corroboration only, the browser read
// from the recording's browser line, data without a window log, and junk.
// Every row and browser line here is made up; no participant's data.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDeviceMasking, isPerturbedDpr, browserFamily } from '../../src/cli/analyzers/device-masking.js';
import { buildReport } from '../../src/cli/report-core.js';

// One window-log row: a 1600 × 1000 window at (0, 0) on a 1920 × 1080 screen,
// the page at 100 % (inner 1600 × 900: 100 px of browser chrome), pixel
// ratio 1. `over` changes any field.
const row = (over = {}, t = 0) => ({ x: 0, y: 0, w: 1600, h: 1000, iw: 1600, ih: 900, sw: 1920, sh: 1080, dpr: 1, vvScale: 1, t, ...over });
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
// A participant with these rows and, given a browser line, a recording.
const part = (rows, ua) => ({
  participantId: 'P', trials: [], session: { windowPositions: rows },
  ...(ua === undefined ? {} : { replay: { recording: { schema_version: 2, user_agent: ua, segments: [] } } })
});
const rulesOf = (rows, ua = CHROME) => analyzeDeviceMasking(part(rows, ua)).rules;
// A page zoom to 125 %: the inner size shrinks by 0.8 on both axes.
const zoomed = (over = {}) => row({ iw: 1280, ih: 720, ...over }, 2000);

describe('analyzeDeviceMasking', () => {
  it('a window log that agrees: state ok, no rule, empty detail', () => {
    assert.deepEqual(analyzeDeviceMasking(part([row(), row({ dpr: 1.25, iw: 1280, ih: 720 }, 2000)], CHROME)),
      { state: 'ok', rules: [], corroborated: false, browser: 'chrome', detail: '' });
  });

  it('R1: a pixel ratio no browser produces', () => {
    const out = analyzeDeviceMasking(part([row({ dpr: 1.00000001 })], CHROME));
    assert.deepEqual([out.rules, out.detail], [['R1'], 'pixel ratio 1.00000001']);
    // Float32 rounding of a product, exact products, and custom OS scaling
    // are ratios browsers report.
    for (const d of [0.8999999761581421, 1.3499999046325684, 1.350000023841858, 1.100000023841858, 1.1, 1.25, 1.5, 2, 0.75, 1.0169491525423728]) {
      assert.equal(isPerturbedDpr(d), false, String(d));
      assert.deepEqual(rulesOf([row({ dpr: d })]), [], String(d));
    }
  });

  it('R2: the pixel ratio stays put through a page zoom', () => {
    const out = analyzeDeviceMasking(part([row(), zoomed()], CHROME));
    assert.deepEqual([out.rules, out.detail], [['R2'], 'pixel ratio 1 unchanged through a page zoom']);
    assert.deepEqual(rulesOf([row(), zoomed({ dpr: 1.25 })]), [], 'the ratio moved with the zoom');
    assert.deepEqual(rulesOf([row(), row({ iw: 1280 }, 2000)]), [], 'a side panel: the width alone');
    assert.deepEqual(rulesOf([row(), row({ iw: 1520, ih: 855 }, 2000)]), [], 'a 5 % change');
    assert.deepEqual(rulesOf([row(), zoomed({ vvScale: 1.25 })]), [], 'a pinch zoom');
    assert.deepEqual(rulesOf([row(), zoomed({ x: 40 })]), [], 'the window moved');
  });

  it('R2 is not applied to Safari; without a browser line it says so', () => {
    assert.deepEqual(rulesOf([row(), zoomed()], SAFARI), []);
    const out = analyzeDeviceMasking(part([row(), zoomed()]));
    assert.deepEqual([out.rules, out.browser, out.detail], [['R2'], null, 'pixel ratio 1 unchanged through a page zoom (browser unknown)']);
  });

  it('R1 and R2 together read as one sentence', () => {
    const out = analyzeDeviceMasking(part([row({ dpr: 1.00000001 }), zoomed({ dpr: 1.00000001 })], CHROME));
    assert.deepEqual([out.rules, out.detail], [['R1', 'R2'], 'pixel ratio 1.00000001, unchanged through a page zoom']);
  });

  it('R3a: a window larger than the screen it reports', () => {
    const big = { w: 2000, h: 1000, iw: 2000, ih: 900, sw: 1440, sh: 900 };
    const out = analyzeDeviceMasking(part([row(big)], CHROME));
    assert.deepEqual([out.rules, out.detail], [['R3a'], 'window 2000 × 1000 larger than the 1440 × 900 screen']);
    assert.deepEqual(rulesOf([row({ w: 1950, h: 1100, iw: 1950, ih: 1000 })]), [], 'within 3 % + 20 px');
    assert.deepEqual(rulesOf([row({ ...big, x: -32000, y: -32000 })]), [], 'a minimised window');
    // Firefox's convention, seen in the log: w moves with a zoom, w × dpr stays put.
    assert.deepEqual(rulesOf([row(big), row({ ...big, w: 1600, iw: 1600, dpr: 1.25 }, 2000)], undefined), []);
    // Firefox, read from the browser line.
    assert.deepEqual(rulesOf([row(big)], FIREFOX), []);
    // A second monitor: the screen changes, or the window sits off the primary screen.
    assert.deepEqual(rulesOf([row(big), row({ ...big, sw: 2560, sh: 1440 }, 2000)]), []);
    assert.deepEqual(rulesOf([row(big), row({ ...big, x: 1500 }, 2000)]), []);
  });

  it('R3b: a fullscreen window smaller than the screen counts only next to another rule', () => {
    const fs = { w: 1280, h: 720, iw: 1280, ih: 720, sw: 2880, sh: 1800, dpr: 1.5 };
    assert.deepEqual(analyzeDeviceMasking(part([row(fs)], CHROME)),
      { state: 'ok', rules: [], corroborated: false, browser: 'chrome', detail: '' });
    const out = analyzeDeviceMasking(part([row(fs), row({ ...fs, iw: 1024, ih: 576 }, 2000)], CHROME));
    assert.deepEqual([out.rules, out.corroborated, out.detail],
      [['R2'], true, 'pixel ratio 1.5 unchanged through a page zoom, fullscreen window 1280 × 720 smaller than the 2880 × 1800 screen']);
    // Not with a second monitor in the log (R2 still fires).
    const moved = analyzeDeviceMasking(part([row(fs), row({ ...fs, iw: 1024, ih: 576 }, 2000), row({ ...fs, iw: 1024, ih: 576, sw: 1920, sh: 1080 }, 4000)], CHROME));
    assert.deepEqual([moved.rules, moved.corroborated], [['R2'], false]);
    // A side panel narrows the page, not the window: not read as fullscreen.
    const panel = { w: 2622, h: 1440, iw: 2236, ih: 1345, sw: 3440, sh: 1440 };
    const withPanel = analyzeDeviceMasking(part([row({ ...panel, dpr: 1.00000001 })], CHROME));
    assert.deepEqual([withPanel.rules, withPanel.corroborated], [['R1'], false]);
  });

  it('without a window log, or with only junk rows, it is not recorded; nothing throws', () => {
    const cases = [null, 7, 'x', {}, { session: 'x' }, { session: {} }, { session: { windowPositions: 'x' } },
      { session: { windowPositions: [] } },
      { session: { windowPositions: [null, 5, 'r', { dpr: 'a' }, row({ iw: 0 }), row({ dpr: NaN }), row({ sw: -1 })] } }];
    for (const c of cases) {
      assert.doesNotThrow(() => analyzeDeviceMasking(c));
      assert.deepEqual(analyzeDeviceMasking(c), { state: 'not recorded', rules: [], corroborated: false, browser: null, detail: 'window log not recorded' });
    }
    // Junk rows are skipped; the good ones are judged.
    assert.deepEqual(rulesOf([null, row({ dpr: 1.00000001 }), { x: 'a' }]), ['R1']);
    // A recording without a browser line, or with junk in it.
    for (const recording of [null, 'x', {}, { user_agent: 42 }]) {
      assert.equal(analyzeDeviceMasking({ session: { windowPositions: [row()] }, replay: { recording } }).browser, null);
    }
  });
});

describe('browserFamily', () => {
  it('reads the engine from the browser line', () => {
    assert.equal(browserFamily(CHROME), 'chrome');
    assert.equal(browserFamily(CHROME + ' Edg/140.0.0.0'), 'chrome');
    assert.equal(browserFamily(FIREFOX), 'firefox');
    assert.equal(browserFamily(SAFARI), 'safari');
    assert.equal(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'), 'safari');
    assert.equal(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15'), 'safari');
    assert.equal(browserFamily('curl/8.0'), 'other');
    for (const v of ['', undefined, null, 42]) assert.equal(browserFamily(v), null);
  });
});

describe('device masking in the report', () => {
  const config = { outputDir: '.', participantIdField: 'participantId' };
  const build = async (cfg) => {
    const files = {};
    const masked = { ...part([row({ dpr: 1.00000001 })], CHROME), participantId: 'M' };
    const plain = { ...part([row()], CHROME), participantId: 'N' };
    const built = await buildReport([masked, plain], cfg, { sink: (p, d) => { files[p] = d; } });
    return { built, files };
  };
  it('report-core attaches summary.deviceMasking, and summary.csv carries the rules after the cursor block', async () => {
    const { built, files } = await build(config);
    const byId = Object.fromEntries(built.summaries.map((s) => [s.participantId, s.deviceMasking]));
    assert.deepEqual([byId.M.rules, byId.N.rules], [['R1'], []]);
    const [h, ...rows] = files['summary.csv'].trim().split('\n');
    const H = h.split(',');
    const at = H.indexOf('deviceMasking');
    assert.ok(at > H.indexOf('cursorSoftwareRenderer'));
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.split(',')[0], r.split(',')[at]])), { M: 'R1', N: '' });
  });
  it('phase scoping leaves it whole: it reads the session, not the trials', async () => {
    const { built } = await build({ ...config, phaseScope: { exclude: ['debrief'] } });
    assert.deepEqual(built.summaries.find((s) => s.participantId === 'M').deviceMasking.rules, ['R1']);
  });
});
