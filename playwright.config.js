// playwright.config.js
// Two E2E suites, two static servers:
//   - the demo tour (demo/tests, projects chromium/firefox/webkit): webServer
//     assembles the same artifact the Pages CI workflow deploys (demo/* +
//     dist/ into .demo-site/, gitignored) and serves it with a
//     dependency-free static server, so the suite runs against something
//     that behaves like the deployed site rather than the bare demo/
//     directory;
//   - the one-line setup (tests/e2e/oneliner, project oneliner): fixture
//     experiments that load dist/ch.js by its real URL plus the vendored
//     jsPsych in tests/fixtures/, so the second server serves the repo root.
//     It builds dist/ first, so the specs never run a stale ch.js (the demo
//     server's assemble step is skipped when an existing :8177 server is
//     reused). No race with that step's copy of dist/: Playwright sets up the
//     webServer entries in series, each one only after the previous one's
//     URL answers, so the demo site is assembled before this build starts.
//   - the analyze page (tests/e2e/analyze, projects analyze-*): served by the
//     demo site's server (.demo-site/analyze/, built by the assemble step).

import { defineConfig, devices } from '@playwright/test';

const PORT = 8177;
const ONELINER_PORT = 8178;

export default defineConfig({
  testDir: 'demo/tests',
  retries: 0,
  timeout: 60000,
  workers: 1, // single shared webServer/.demo-site/ — parallel workers would race the assemble+serve step

  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
  },
  webServer: [
    {
      command: `node tools/assemble-demo-site.mjs && node tools/serve-demo.mjs ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
    },
    {
      command: `node build.js && node tools/serve-demo.mjs ${ONELINER_PORT} .`,
      url: `http://localhost:${ONELINER_PORT}/package.json`,
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Firefox/WebKit only run the hermetic blob-iframe smoke (demo/tests/blob-iframe.spec.js),
    // not the full tour suite — that suite depends on Chromium-only test helpers/mocks.
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] }, testMatch: /blob-iframe\.spec\.js/ },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] },  testMatch: /blob-iframe\.spec\.js/ },
    // The one-line setup's fixture experiments (Chromium only, like the tour).
    {
      name: 'oneliner',
      testDir: 'tests/e2e/oneliner',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${ONELINER_PORT}` },
    },
    // The analyze page: the full flow on Chromium; the zero-network, sample
    // and offline-file checks (engines.spec.js) and the policy's own refusals
    // (policy.spec.js) on all three engines.
    { name: 'analyze-chromium', testDir: 'tests/e2e/analyze', use: { ...devices['Desktop Chrome'] } },
    { name: 'analyze-firefox',  testDir: 'tests/e2e/analyze', testMatch: /(engines|policy)\.spec\.js/, use: { ...devices['Desktop Firefox'] } },
    { name: 'analyze-webkit',   testDir: 'tests/e2e/analyze', testMatch: /(engines|policy)\.spec\.js/, use: { ...devices['Desktop Safari'] } },
  ],
});
