// demo/analyze/limits.js
// The largest cohort the page has been run on (tests/browser/analyze/load-measure.mjs).
// Shown on the page; above it, the page points to the CLI. A measured number
// tied to a named fixture, never a guess: change it only with a new measurement.
//
// Measured 2026-10-01 on a MacBook Pro 14 (Mac16,8, Apple M4 Pro, 24 GB),
// macOS 26.6.1, Node v26.0.0, Playwright 1.62.0, headless Chromium
// 151.0.7922.34, Firefox 153.0 and WebKit 26.5. Cohorts from
// tools/gen-analyze-load-fixture.mjs (copies of tests/fixtures/demo, a 0.8 MB
// dom-tier recording each). A run counts as completed when the report lists
// every participant, the zip holds every replay and the last replay opens.
// Five repetitions of the table; build = "Build the report" to results,
// median seconds; memory = the browser's peak resident set, all processes.
//
//   participants  engine    completed  build s  peak MB  zip MB
//    50           chromium  5/5         1.8      853      25
//    50           firefox   5/5         2.4     1382      23
//    50           webkit    5/5         2.8     1564      25
//   150           chromium  5/5         4.4     1774      76
//   150           firefox   5/5         6.9     1947      69
//   150           webkit    5/5         7.9     2417      73
//   300           chromium  5/5         8.5     2206     151
//   300           firefox   3/5        14.3     2382     138
//   300           webkit    5/5        15.0     3333     146
//
// 150, not 300: at 300 Firefox did not always finish (in 2 of 5 runs the
// report frame never listed the cohort, with no error on the page).
export var TESTED_PARTICIPANTS = 150;
export var TESTED_FIXTURE = '150 dom-tier participants (tests/fixtures/demo copies, 0.8 MB recording each) in headless Chromium 151, Firefox 153 and WebKit 26.5 on a MacBook Pro (M4 Pro, 24 GB), 2026-10-01';
