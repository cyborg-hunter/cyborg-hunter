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
//     It does not build: the demo server's assemble step rebuilds dist/ when
//     it is older than src/, and no test starts before both servers answer.
//     (Building here too would race that step's copy of dist/.)

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
      command: `node tools/serve-demo.mjs ${ONELINER_PORT} .`,
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
  ],
});
