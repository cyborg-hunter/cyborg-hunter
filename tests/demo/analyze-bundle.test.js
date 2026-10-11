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
import { NODE_IMPORT } from '../cli/node-import-pattern.js';
import { VERSION } from '../../src/shared/constants.js';

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
  // The config's text is a string in the worker's source, and that source is
  // a string in the page bundle: it is there escaped twice.
  const configText = readFileSync('examples/demo-sessions/cyborg-hunter.config.json', 'utf8');
  assert.ok(bundle.includes('DEMO-9mop') && bundle.includes(JSON.stringify(JSON.stringify(configText)).slice(1, -1)), 'sample data + its config baked in');
  assert.ok(bundle.includes('self.onmessage') || bundle.includes('self.postMessage'), 'worker loop baked in');
  // The recordings are fetched on the site, never baked: their JSON is absent
  // (the trackers spell the id camel-case; a recording spells it participant_id).
  // Both are looked for escaped twice, as the config above; the tracker's
  // form being there shows the recording's would be found if it were.
  const twice = (s) => JSON.stringify(JSON.stringify(s).slice(1, -1)).slice(1, -1);
  assert.ok(bundle.includes(twice('"participantId":"DEMO-bsq6"')), 'the tracker baked in, found as the recording would be');
  assert.ok(!bundle.includes(twice('"participant_id":"DEMO-bsq6"')), 'no recording baked in');
  assert.ok(bundle.length < 2.5e6, 'the bundle stays under 2.5 MB: ' + bundle.length);
});

test('carries the recordings’ names and the version for the page, not their files', () => {
  // Baked for the page: what to fetch on the site, and which release holds
  // the downloads for the offline file. (That the recordings' JSON is not
  // baked is the first test's check; not repeated here.)
  // The page's module is baked at the page level (escaped once, by
  // inlineSafeJson, which leaves these characters alone): the exact object.
  const baked = JSON.stringify({ names: ['DEMO-681w.replay.json', 'DEMO-a3f3.replay.json', 'DEMO-bsq6.replay.json'], version: VERSION });
  assert.ok(bundle.includes(baked), 'names and version baked for the page: ' + baked);
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
  assert.equal(NODE_IMPORT.test(bundle), false);
  assert.equal(/fetch\(\s*["'`]\.\//.test(bundle), false, 'no fetch of the page\'s own files');
});

test('can be inlined into a <script> for the offline file', () => {
  assert.deepEqual(inlineSrcHazards(bundle), []);
});
