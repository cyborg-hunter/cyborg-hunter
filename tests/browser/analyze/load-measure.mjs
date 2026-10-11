// tests/browser/analyze/load-measure.mjs
// Measures the analyze page on cohorts of 50 / 150 / 300 dom-tier participants
// in the three engines, headless: the time from goto to the check step (the
// page reads every dropped file), the time from "Build the report" to the
// results (the report and the zip are built by then), the time until the
// report frame lists the last participant, the unzipped size of
// the zip, the time to open the last participant's replay, the browser's
// peak resident memory, and whether the run completed.
// Not a test; prints one row per run as it finishes (and appends it to the
// output file, if given), then the table. Run it several times: the largest
// size whose three rows are ok in every run sets TESTED_PARTICIPANTS in
// demo/analyze/limits.js (which records five runs).
// Usage (site assembled and served first):
//   node tools/assemble-demo-site.mjs && node tools/serve-demo.mjs 8177 &
//   node tests/browser/analyze/load-measure.mjs [50,150,300] [http://localhost:8177] [out.txt]
import { chromium, firefox, webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sizes = JSON.parse(process.argv[2] || '[50,150,300]');
const base = process.argv[3] || 'http://localhost:8177';
const out = process.argv[4] || null;
const TIMEOUT_MS = 10 * 60 * 1000;

const log = (line) => { console.log(line); if (out) appendFileSync(out, line + '\n'); };

// Peak resident memory of the browser, all its processes summed (the page,
// the worker's, GPU and network helpers), sampled once a second. The browser's
// processes: this script's descendants, plus the processes launched from the
// same engine install directory (WebKit's helpers are XPC services whose
// parent is launchd, not the browser). performance.memory would be
// Chromium-only and blind to the worker.
function sampleRss() {
  let peak = 0;
  const once = () => {
    const procs = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' }).split('\n')
      .map((l) => l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), kb: Number(m[3]), command: m[4] }));
    const mine = new Set([process.pid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const p of procs) if (!mine.has(p.pid) && mine.has(p.ppid)) { mine.add(p.pid); grew = true; }
    }
    const installDirs = new Set();
    for (const p of procs) {
      const m = mine.has(p.pid) && p.command.match(/^(.*\/ms-playwright\/[^/]+\/)/);
      if (m) installDirs.add(m[1]);
    }
    let kb = 0;
    for (const p of procs) if ([...installDirs].some((d) => p.command.startsWith(d))) kb += p.kb;
    if (kb > peak) peak = kb;
  };
  const timer = setInterval(once, 1000);
  return { stop: () => { clearInterval(timer); once(); return Math.round(peak / 1024); } };
}

// Waits for the target, or for the page's own error message, whichever comes
// first (the results section is always in the page, so it waits to be
// shown): a failed run, a report frame that did not load, or a replay that did
// not open fails at once with the page's words instead of at the timeout.
async function untilOrError(page, target, state) {
  const error = page.locator('[data-role="error"]').filter({ visible: true });
  const which = await Promise.race([
    target.first().waitFor({ state: state || 'attached', timeout: TIMEOUT_MS }).then(() => 'target'),
    error.first().waitFor({ timeout: TIMEOUT_MS }).then(() => 'error'),
  ]);
  if (which === 'error') throw new Error('the page reported: ' + (await error.first().textContent()).trim());
}

const rows = [];
log('# ' + new Date().toISOString() + ' ' + base + ' sizes ' + JSON.stringify(sizes));
for (const n of sizes) {
  const dir = mkdtempSync(join(tmpdir(), 'ch-load-'));
  execFileSync(process.execPath, ['tools/gen-analyze-load-fixture.mjs', String(n), dir], { stdio: 'inherit' });
  const files = readdirSync(dir).map((f) => join(dir, f));
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
    const tLaunch = Date.now();
    const browser = await engine.launch();
    const rss = sampleRss();
    const page = await browser.newPage({ acceptDownloads: true });
    let status = 'ok', intake = null, build = null, report = null, zipMB = null, replay = null;
    const t0 = Date.now();
    try {
      await page.goto(base + '/analyze/');
      await page.waitForFunction(() => !!(window.__chAnalyze && window.__chAnalyze.state.limits), null, { timeout: 60000 });
      await page.setInputFiles('[data-role="file-input"]', files);
      await page.waitForSelector('[data-role="files-panel"]:not([hidden])', { timeout: TIMEOUT_MS });
      await page.waitForSelector('[data-action="run"]:not([disabled])', { timeout: TIMEOUT_MS });
      intake = (Date.now() - t0) / 1000;
      const t1 = Date.now();
      await page.click('[data-action="run"]');
      // A failed run returns to the file list with the page's own error.
      await untilOrError(page, page.locator('section[data-step="results"]'), 'visible');
      build = (Date.now() - t1) / 1000;
      // Completed means every participant is in the report and in the zip,
      // and the last one's replay opens.
      const tReport = Date.now();
      const last = 'LOAD-' + String(n).padStart(4, '0');
      const rail = page.frameLocator('iframe.analyze-report').locator('.cohort-row[data-pid]');
      await untilOrError(page, rail.and(page.frameLocator('iframe.analyze-report').locator('[data-pid="' + last + '"]')));
      report = (Date.now() - tReport) / 1000;
      const listed = await rail.count();
      if (listed !== n) throw new Error('the report lists ' + listed + ' of ' + n + ' participants');
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="download-zip"]')]);
      const zip = unzipSync(new Uint8Array(readFileSync(await download.path())));
      zipMB = Math.round(Object.values(zip).reduce((a, b) => a + b.length, 0) / 1048576);
      const replays = Object.keys(zip).filter((f) => f.startsWith('replay/') && f.includes('LOAD-')).length;
      if (replays !== n) throw new Error('the zip holds ' + replays + ' of ' + n + ' replays');
      // The report selects its first row on load and moves the dropdown
      // there; wait for that before choosing, as the page's own specs do.
      await page.waitForFunction(() => window.__chAnalyze.state.selected !== null, null, { timeout: 60000 });
      const t2 = Date.now();
      await page.selectOption('[data-role="replay-select"]', last);
      await page.click('[data-action="load-replay"]');
      await untilOrError(page, page.frameLocator('iframe.replay-host-frame[data-participant-id="' + last + '"]').frameLocator('iframe.replay-frame').locator('body *').first());
      replay = (Date.now() - t2) / 1000;
    } catch (e) { status = 'FAIL: ' + e.message.split('\n')[0]; }
    const version = browser.version(), peakRssMB = rss.stop();
    await browser.close();
    const row = { participants: n, engine: name, version, wallSeconds: (Date.now() - tLaunch) / 1000, intakeSeconds: intake, buildSeconds: build, reportSeconds: report, zipMB, replaySeconds: replay, peakRssMB, status };
    rows.push(row);
    log(JSON.stringify(row));
  }
  rmSync(dir, { recursive: true, force: true });
}
console.table(rows);
