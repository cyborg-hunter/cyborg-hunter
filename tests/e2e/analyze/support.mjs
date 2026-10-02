// tests/e2e/analyze/support.mjs
// Shared fixtures for the analyze page's specs. The one thing every spec
// asserts: the page makes no request beyond its own boot files, from before
// goto to after the zip download. Observers, installed before goto:
//   - the record: page.on('request') sees every request any frame of the
//     page makes (the report and replay frames included); after boot the
//     only URLs allowed are the boot files and blob:/data: ones (the worker,
//     the report and replay frames, the downloads). Chromium also reports a
//     load a policy refused, as a request that then fails with 'csp'; those
//     count too, except in the viewer's reconstruction frame (below);
//   - the guard: a page.route catch-all that lets only the boot files
//     through. Not used for file:// loads, which some engines do not route;
//   - the attempts: a load the policy refuses never reaches the network (and
//     in Firefox and WebKit not the record either), so every frame that runs
//     scripts records its securitypolicyviolation events. A violation means
//     the page tried to load something, and fails the test. The viewer's
//     reconstruction frame runs no scripts and is the one frame without this
//     recorder: a recorded external image refused there is the viewer's own
//     policy working, and the styled-replay spec checks it with a sentinel
//     server instead (startSentinel). Not observable in any engine: a load
//     the policy refuses inside the worker (no document to listen on, no
//     request reported); a worker request that does go out is in the record.
//
//   test / expect     @playwright/test, plus an auto `pageErrors` fixture
//                     (the house pattern, demo/tests/helpers.mjs): any
//                     uncaught page error fails the test at teardown.
//   guardNetwork / assertOnlyAllowed / siteAllowlist   the observers above.
//   waitReady / loadSample / buildReport / railOrder / reportFrame /
//   downloadZip       the page's steps, through its data-action/data-role hooks.
//   pilotFiles / cliPilotTree   the synthetic pilot as dropped files, and the
//                     CLI's report tree for it.
//   startSentinel / makeReplayCohort   a counting local server, and a
//                     two-participant dom-tier cohort (a stylesheet to drop,
//                     a recorded image from the sentinel) in a temp dir.
import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..', '..', '..');
export const OFFLINE_FILE = join(ROOT, '.demo-site', 'analyze', 'cyborg-hunter-analyze.html');
export const PILOT_DIR = join(ROOT, 'examples', 'synthetic-pilot');
export const PILOT_ORDER = ['SYN-HARD-03', 'SYN-SOFT-02', 'SYN-CLEAN-01'];

export const test = base.extend({
  pageErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));
    await use(errors);
    expect(errors, 'accumulated page errors: ' + errors.map((e) => e.message).join('; ')).toEqual([]);
  }, { auto: true }],
});
export { expect };

// URLs that name something already in the browser's memory: a blob: or
// data: URL, or about:blank / about:srcdoc for the frames.
const isLocal = (url) => /^(blob:|data:|about:)/.test(url);

// Install BEFORE goto. Returns the record (Request objects); call
// assertOnlyAllowed at the end. opts.route = false skips the route catch-all
// (file:// loads: not every engine routes them, and continue() on an
// unroutable request throws).
export async function guardNetwork(page, allow, opts) {
  const seen = [];
  page.on('request', (r) => seen.push(r));
  if (!opts || opts.route !== false) {
    // WebKit routes the page's blob: loads too (the worker, the frames, the
    // zip); those never leave the browser, so they pass.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return isLocal(url) || allow.includes(url) ? route.continue() : route.abort('blockedbyclient');
    });
  }
  // Runs in every frame that runs scripts; each frame keeps its own list.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  return seen;
}

// Chromium's report of a load the reconstruction frame's policy refused. Any
// other refused load (the page, the report, the replay host, the worker)
// stays in the record: it is an attempt, and fails the test.
function refusedInReconstruction(r) {
  const f = r.failure();
  if (!f || f.errorText !== 'csp') return false;
  try { return r.frame().url() === 'about:srcdoc'; } catch (e) { return false; }   // a worker's request has no frame
}
// The URLs of the record, less the reconstruction frame's refused loads.
export const requested = (seen) => seen.filter((r) => !refusedInReconstruction(r)).map((r) => r.url());

// The policy violations recorded in every frame still attached. Only the
// viewer's reconstruction frame (about:srcdoc, no scripts) may lack the
// recorder; any other frame without it fails the check.
async function cspViolations(page) {
  const all = [];
  for (const frame of page.frames()) {
    const list = await frame.evaluate(() => window.__cspViolations || null).catch(() => null);
    if (list === null) { if (frame.url() !== 'about:srcdoc') all.push(frame.url() + ': no violation recorder in this frame'); continue; }
    for (const v of list) all.push(frame.url() + ': ' + v);
  }
  return all;
}

export async function assertOnlyAllowed(page, seen, allow) {
  const outside = requested(seen).filter((u) => !isLocal(u) && !allow.includes(u));
  expect(outside, 'requests outside the allowlist').toEqual([]);
  expect(await cspViolations(page), 'security policy violations (attempted loads)').toEqual([]);
}
export const siteAllowlist = (baseURL) => [baseURL + '/analyze/', baseURL + '/analyze/index.html', baseURL + '/analyze/analyze.bundle.js'];

export async function waitReady(page) {
  await expect(page.locator('[data-role="tested-size"]')).not.toHaveText('…', { timeout: 30000 });
}
export async function loadSample(page) {
  await page.click('[data-action="sample"]');
  await expect(page.locator('section[data-step="check"]')).toBeVisible();
  await expect(page.locator('[data-role="id-field"]')).toHaveValue('subject_ID');
}
// A failed run sends the page back to the check step with its error shown:
// fail at once with the page's own message instead of at the timeout.
export async function buildReport(page) {
  await expect(page.locator('[data-action="run"]')).toBeEnabled();
  await page.click('[data-action="run"]');
  const results = page.locator('section[data-step="results"]');
  const error = page.locator('[data-role="error"]');
  await expect(results.or(error).filter({ visible: true }).first()).toBeVisible({ timeout: 120000 });
  if (await error.isVisible()) throw new Error('the page reported: ' + (await error.textContent()));
}
export function reportFrame(page) { return page.frameLocator('iframe.analyze-report'); }
export async function railOrder(page) {
  const rows = reportFrame(page).locator('.cohort-row[data-pid]');
  await expect(rows.first()).toBeVisible({ timeout: 30000 });
  return rows.evaluateAll((els) => els.map((r) => r.dataset.pid));
}
export async function downloadZip(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="download-zip"]')]);
  const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
  return { names: Object.keys(files).sort(), text: (n) => strFromU8(files[n]) };
}
export const pilotFiles = () => readdirSync(join(PILOT_DIR, 'data')).filter((f) => f.endsWith('.csv')).sort().map((f) => join(PILOT_DIR, 'data', f))
  .concat([join(PILOT_DIR, 'cyborg-hunter.config.json')]);

// The CLI's tree for the synthetic pilot (images when node-canvas is
// installed), for the zip-tree comparison.
export function cliPilotTree() {
  const out = mkdtempSync(join(tmpdir(), 'ch-e2e-cli-'));
  execFileSync(process.execPath, [join(ROOT, 'bin', 'cyborg-hunter.js'), 'report', '--output', join(out, 'report')],
    { cwd: PILOT_DIR, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, stdio: 'pipe' });
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const names = walk(join(out, 'report')).map((p) => relative(join(out, 'report'), p)).sort();
  return { names, text: (n) => readFileSync(join(out, 'report', n), 'utf8'), cleanup: () => rmSync(out, { recursive: true, force: true }) };
}

// A local HTTP server that counts the requests it receives: the ground truth
// for "never requested" (a request the browser sent arrives here, whatever
// any observer in the page saw). Returns { url, hits, close }.
export async function startSentinel() {
  const hits = [];
  const server = createServer((req, res) => { hits.push(req.url); res.end(); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: 'http://127.0.0.1:' + server.address().port, hits, close: () => new Promise((ok) => server.close(ok)) };
}

// A two-participant dom-tier cohort from the committed demo pair: the sheet is
// made href-only (so a dropped demo.css styles it), a recorded image is
// injected from imageOrigin (so the viewer's policy has something to block;
// a sentinel's url, or an unreachable origin), and a second participant is a
// renamed copy. Written to a temp dir.
export function makeReplayCohort(imageOrigin) {
  const dir = mkdtempSync(join(tmpdir(), 'ch-e2e-cohort-'));
  const raw = readFileSync(join(ROOT, 'tests', 'fixtures', 'demo', 'DEMO-FIXT.json'), 'utf8');
  const rec = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'demo', 'DEMO-FIXT-replay-1785352263344.json'), 'utf8'));
  rec.stylesheets[0].css = null;
  const keyframe = rec.segments.find((s) => s.initial_dom);
  keyframe.initial_dom.children.unshift({ id: 900001, kind: 'element', tag: 'img', attrs: { src: (imageOrigin || 'http://127.0.0.1:1') + '/blocked.png', alt: '' }, children: [] });
  const write = (pid) => {
    writeFileSync(join(dir, pid + '.json'), raw.split('DEMO-FIXT').join(pid));
    writeFileSync(join(dir, pid + '-replay-1785352263344.json'), JSON.stringify({ ...rec, participant_id: pid }));
  };
  write('DEMO-FIXT'); write('DEMO-FIXT-B');
  writeFileSync(join(dir, 'cyborg-hunter.config.json'), JSON.stringify({ filePattern: 'DEMO-*.json', participantIdField: 'participantId' }));
  mkdirSync(join(dir, 'exp'));
  writeFileSync(join(dir, 'exp', 'demo.css'), 'body{outline:3px solid lime}');
  const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).map((f) => join(dir, f)).concat([join(dir, 'exp', 'demo.css')]);
  return { dir, files, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
