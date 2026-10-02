// The built page bundle: self-contained, Node-free, inline-safe, and carrying
// what the page may never fetch. Builds into a temp dir so demo/ is untouched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineSrcHazards } from '../../src/shared/inline-safe.js';
import { TESTED_PARTICIPANTS, TESTED_FIXTURE } from '../../demo/analyze/limits.js';

let dir, bundle;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ch-analyze-bundle-'));
  execFileSync(process.execPath, ['tools/build-analyze.mjs'], { env: { ...process.env, ANALYZE_OUTDIR: dir }, stdio: 'pipe' });
  bundle = readFileSync(join(dir, 'analyze.bundle.js'), 'utf8');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('carries the worker source, the viewer client, the fonts and the sample', () => {
  assert.ok(bundle.includes('initChReplayViewer'), 'viewer client baked in');
  assert.ok(bundle.includes('@font-face'), 'fonts baked in');
  assert.ok(bundle.includes('SYN-HARD-03') && bundle.includes('subject_ID'), 'sample data + its config baked in');
  assert.ok(bundle.includes('self.onmessage') || bundle.includes('self.postMessage'), 'worker loop baked in');
});

// The size the page shows is a measurement (tests/browser/analyze/load-measure.mjs),
// tied to the fixture it was measured on; the bundle carries both.
test('carries the measured cohort size and names its fixture', () => {
  assert.ok(Number.isInteger(TESTED_PARTICIPANTS) && TESTED_PARTICIPANTS > 0);
  assert.notEqual(TESTED_FIXTURE, 'not yet measured');
  assert.ok(TESTED_FIXTURE.includes(String(TESTED_PARTICIPANTS) + ' dom-tier participants'), 'the fixture names the size');
  assert.ok(bundle.includes(TESTED_FIXTURE), 'fixture text baked in');
});

test('reaches no network and no Node API', () => {
  assert.equal(bundle.includes('registry.npmjs.org'), false, 'update check is unreachable');
  // ESM imports as well as require(): esbuild keeps either form when a
  // built-in is marked external, so both must be absent.
  assert.equal(/(from\s*|import\s*\(\s*|require\s*\(\s*)["'](node:[^"']*|fs|path|zlib|crypto)["']/.test(bundle), false);
  assert.equal(/fetch\(\s*["'`]\.\//.test(bundle), false, 'no fetch of the page\'s own files');
});

test('can be inlined into a <script> for the offline file', () => {
  assert.deepEqual(inlineSrcHazards(bundle), []);
});
