// The analyze page bundles the report, config and ingest cores for the
// browser. Each must bundle with platform 'browser' on its own: no Node
// built-in reachable from it, and no update check (registry request).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { build } from 'esbuild';
import { NODE_IMPORT } from './node-import-pattern.js';

const CORES = ['src/cli/report-core.js', 'src/cli/config-core.js', 'src/cli/ingest-core.js', 'src/cli/asset-match.js'];

describe('browser bundle of the CLI cores', () => {
  for (const entry of CORES) {
    it(`${entry} bundles for the browser with no Node imports`, async () => {
      const result = await build({ entryPoints: [entry], bundle: true, platform: 'browser',
        format: 'esm', write: false, logLevel: 'silent' }).catch((e) => e);
      assert.deepStrictEqual((result.errors || []).map((e) => e.text), [], 'bundles without errors');
      const text = result.outputFiles[0].text;
      assert.doesNotMatch(text, NODE_IMPORT);
      assert.ok(!text.includes('registry.npmjs.org'), 'no update check in the bundle');
    });
  }
});
