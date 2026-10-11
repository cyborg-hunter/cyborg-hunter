// What the Pages assembly copies from demo/: the Playwright specs and the
// analyze page's build inputs stay out of the public site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { isRuntimeFile, DEMO_DIR } from '../../tools/assemble-demo-site.mjs';

test('the copy filter keeps the runtime files and leaves out tests and build inputs', () => {
  const at = (...p) => isRuntimeFile(join(DEMO_DIR, ...p));
  assert.equal(at('index.html'), true);
  assert.equal(at('demo.css'), true);
  assert.equal(at('assets', 'example-1.json'), true);
  assert.equal(at('analyze'), true, 'the folder itself, so cpSync walks into it');
  assert.equal(at('analyze', 'index.html'), true);
  assert.equal(at('analyze', 'analyze.bundle.js'), true);
  assert.equal(at('analyze', 'page.js'), false);
  assert.equal(at('analyze', 'worker-entry.js'), false);
  assert.equal(at('tests'), false);
  assert.equal(at('tests', 'demo.spec.js'), false);
  assert.equal(at('testsuite.js'), true, 'only the tests folder, not a name that starts with it');
});
