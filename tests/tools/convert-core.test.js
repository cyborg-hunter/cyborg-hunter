// The converter's pure core: the hash is injected, so the same conversion runs
// in Node (createHash) and in a browser (crypto.subtle). The Node tool's sync
// convertRecording() keeps its own tests in convert.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { prepareConversion, convertRecording, CONVERTER_VERSION } from '../../tools/convert/convert-core.mjs';
import { convertRecording as convertSync } from '../../tools/convert/jspsych-v1-to-v2.mjs';

const V1_PATH = 'tests/tools/fixtures/jspsych-v1-minimal.json';
const v1 = () => JSON.parse(readFileSync(V1_PATH, 'utf8'));
const nodeSha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
// webcrypto.subtle is the browser's crypto.subtle; imported rather than read
// off the global, which Node 18 (the engines floor) does not define in ESM.
const webSha = async (t) => {
  const buf = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

test('the core has no node: imports', () => {
  const src = readFileSync('tools/convert/convert-core.mjs', 'utf8');
  assert.equal(/^\s*import\b/m.test(src), false, 'convert-core.mjs must import nothing');
});

test('prepareConversion exposes the canonical text and builds v2 from a given hash', () => {
  const prep = prepareConversion(v1());
  assert.equal(typeof prep.canonicalText, 'string');
  const out = prep.build('ab'.repeat(32));
  assert.equal(out.schema_version, 2);
  assert.equal(out.extensions['cyborg-hunter'].converter.source_sha256, 'ab'.repeat(32));
  assert.equal(out.extensions['cyborg-hunter'].converter.version, CONVERTER_VERSION);
});

test('prepareConversion refuses exactly like the Node tool', () => {
  let err;
  try { prepareConversion({ schema_version: 1 }); } catch (e) { err = e; }
  assert.ok(Array.isArray(err.reasons) && err.reasons.length > 0);
});

test('an injected web sha256 produces the Node tool\'s output exactly', async () => {
  const viaWeb = await convertRecording(v1(), { sha256: webSha });
  assert.deepEqual(viaWeb, convertSync(v1()));
});

test('a sync sha256 is accepted too', async () => {
  const viaNode = await convertRecording(v1(), { sha256: nodeSha });
  assert.deepEqual(viaNode, convertSync(v1()));
});

test('the Node tool stays the single source of its own hash', () => {
  const prep = prepareConversion(v1());
  assert.equal(convertSync(v1()).extensions['cyborg-hunter'].converter.source_sha256, nodeSha(prep.canonicalText));
});
