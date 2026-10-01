// The shipped validator copy must stay byte-identical to the conformance
// package's source. Editing either side without running the sync script fails
// here — that is the whole guarantee that keeps the two copies from drifting.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import { SYNCED, render, currentTarget } from '../../scripts/sync-conformance.mjs';

test('every synced file is byte-identical to its package source', () => {
  assert.ok(SYNCED.length > 0, 'nothing declared as synced');
  for (const entry of SYNCED) {
    const have = currentTarget(entry);
    assert.notStrictEqual(have, null, `${entry.target} is missing — run npm run sync:conformance`);
    assert.strictEqual(
      have,
      render(entry),
      `${entry.target} drifted from ${entry.sourceLabel} — edit ${entry.sourceLabel}, then run npm run sync:conformance`,
    );
  }
});

test('the shipped copy carries the generated-file header', () => {
  for (const entry of SYNCED) {
    const text = readFileSync(entry.target, 'utf8');
    assert.match(text, /^\/\/ GENERATED from .* — do not edit; run npm run sync:conformance\n/);
  }
});

test('the shipped copy imports no workspace package', () => {
  for (const entry of SYNCED) {
    const text = readFileSync(entry.target, 'utf8');
    assert.ok(
      !text.includes('@cyborg-hunter/sessionrecording-conformance'),
      `${entry.target} still resolves the workspace package, which is absent from the tarball`,
    );
  }
});
