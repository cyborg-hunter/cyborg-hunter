// tests/e2e/oneliner/support.mjs
// Shared Playwright fixtures and helpers for the one-line setup's fixture
// experiments (tests/e2e/oneliner/fixtures/*.html, served from the repo root
// on the oneliner project's own port, see playwright.config.js).
//
// Every spec follows the same path a researcher's data takes:
//   page (real jsPsych + dist/ch.js) → the file the experiment saves (its own
//   jsPsych.data.get().csv(), captured on window instead of downloaded) →
//   the CLI (bin/cyborg-hunter.js report) → assertions on summary.csv /
//   triage.md.
//
//   test / expect     @playwright/test, plus an auto `pageErrors` fixture
//                     (copied from demo/tests/helpers.mjs): any uncaught page
//                     error fails the test at teardown.
//   collectConsole    records console.error / warn / info text; attach it
//                     before page.goto.
//   installFullscreenMock   document.fullscreenElement + requestFullscreen /
//                     exitFullscreen stand-ins (demo/tests/helpers.mjs
//                     pattern): headless Chromium's real Fullscreen API needs
//                     a user gesture and is unreliable, and friction's entry
//                     trial calls requestFullscreen() from a jsPsych on_finish.
//   pasteInto         a synthetic paste event: the core listens for `paste` on
//                     document and reads clipboardData (core/signals/clipboard.js).
//   parseCsv          papaparse, header row → objects.
//   newTmpDir / cleanupTmpDirs   a temp dir per CLI run; the spec removes
//                     them all in afterAll.
//   saveAndReport     writes the saved file + a CLI config to a temp dir, runs
//                     `cyborg-hunter report --no-visuals` there, returns stdout,
//                     the parsed summary.csv rows and triage.md.

import { test as base, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BIN_PATH = resolve(__dirname, '..', '..', '..', 'bin', 'cyborg-hunter.js');

export const test = base.extend({
  pageErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));
    await use(errors);
    expect(errors, 'accumulated page errors: ' + errors.map((e) => e.message).join('; ')).toEqual([]);
  }, { auto: true }],
});
export { expect };

export function collectConsole(page) {
  const log = { error: [], warn: [], info: [] };
  page.on('console', (msg) => {
    const type = msg.type() === 'warning' ? 'warn' : msg.type();
    if (log[type]) log[type].push(msg.text());
  });
  return log;
}

export async function installFullscreenMock(page) {
  await page.addInitScript(() => {
    let fsEl = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get() { return fsEl; },
    });
    // On the prototype: addInitScript can run before documentElement exists.
    Element.prototype.requestFullscreen = function () {
      fsEl = this;
      return Promise.resolve().then(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    };
    document.exitFullscreen = function () {
      fsEl = null;
      return Promise.resolve().then(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    };
    // A participant's Esc: the browser leaves fullscreen and fires fullscreenchange.
    window.__chExitFullscreen = function () {
      fsEl = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
}

export async function pasteInto(page, selector, text) {
  await page.focus(selector);
  await page.evaluate(([sel, t]) => {
    const el = document.querySelector(sel);
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    el.value += t;   // what the browser's default action would have inserted
  }, [selector, text]);
}

export function parseCsv(text) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error('CSV parse errors: ' + JSON.stringify(parsed.errors.slice(0, 3)));
  return parsed.data;
}

const tmpDirs = [];
export function newTmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), 'ch-oneliner-e2e-' + label + '-'));
  tmpDirs.push(dir);
  return dir;
}
export function cleanupTmpDirs() {
  while (tmpDirs.length) rmSync(tmpDirs.pop(), { recursive: true, force: true });
}

// The saved file goes to <tmpDir>/data: with dataDir '.', the CLI's own
// cyborg-hunter.config.json would match *.json and be read as a participant file.
export function saveAndReport(tmpDir, filename, text) {
  mkdirSync(join(tmpDir, 'data'), { recursive: true });
  writeFileSync(join(tmpDir, 'data', filename), text);
  writeFileSync(join(tmpDir, 'cyborg-hunter.config.json'), JSON.stringify({
    dataDir: 'data',
    filePattern: '*.{json,csv}',
    participantIdField: 'participantId',
  }));
  const stdout = execSync('node ' + JSON.stringify(BIN_PATH) + ' report --no-visuals', { cwd: tmpDir, encoding: 'utf8' });
  const outDir = join(tmpDir, 'cyborg-hunter-report');
  return {
    stdout,
    summaryCsv: parseCsv(readFileSync(join(outDir, 'summary.csv'), 'utf8')),
    triage: readFileSync(join(outDir, 'triage.md'), 'utf8'),
  };
}
