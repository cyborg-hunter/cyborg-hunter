// The analyzer's pseudonym key (demo/analyze/pseudonym-key.js): a key file
// is told by its name or its banner and read with the CLI's own parser, and
// only its secret is kept, in the page's storage, which may refuse it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeDeps } from '../../src/cli/ingest.js';
import { KEY_FILE_BANNER, assignCodes, keyFileUpdate } from '../../src/cli/pseudonymize-core.js';
import { KEY_STORAGE_KEY, isKeyFile, keyFileSecret, readStoredSecret, storeSecret, forgetStoredSecret, keyFingerprint, newSecret } from '../../demo/analyze/pseudonym-key.js';

const SECRET = 'a'.repeat(64);
const cliKeyFile = async () => keyFileUpdate(null, SECRET, await assignCodes(['PROLIFICX5d1e9f00aa'], SECRET, nodeDeps.hmacSha256)).text;

// A storage stand-in with localStorage's three calls.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, map: m };
}

test('isKeyFile: the key file\'s name, or a first line that is its banner (a BOM and CRLF as a spreadsheet saves them)', async () => {
  assert.equal(isKeyFile('cyborg-hunter-pseudonyms.csv', 'anything'), true);
  assert.equal(isKeyFile('keys-2026.csv', await cliKeyFile()), true);
  assert.equal(isKeyFile('keys.csv', '\uFEFF' + KEY_FILE_BANNER + ',\r\n# secret,'), true);
  assert.equal(isKeyFile('data.csv', 'participantId,trial\nP1,1\n'), false);
  assert.equal(isKeyFile('data.csv', 'note\n' + KEY_FILE_BANNER), false, 'the banner must be the first line');
});

test('keyFileSecret: the CLI\'s key file gives its secret; a wrong banner or no readable secret is refused', async () => {
  const text = await cliKeyFile();
  assert.equal(keyFileSecret(text), SECRET);
  assert.equal(keyFileSecret('\uFEFF' + text.replace(/\n/g, '\r\n')), SECRET, 'saved back by a spreadsheet');
  assert.throws(() => keyFileSecret(text.replace(KEY_FILE_BANNER, '# some other file')), /banner/);
  assert.throws(() => keyFileSecret('code,participantId\nP-0123456789,x\n'), /banner/);
  assert.throws(() => keyFileSecret(KEY_FILE_BANNER + '\n# secret,xyz\ncode,participantId\n'), /secret/);
  assert.throws(() => keyFileSecret(KEY_FILE_BANNER + '\ncode,participantId\n'), /secret/);
});

test('the stored secret: kept, read back and forgotten; anything else stored reads as none', () => {
  const s = memoryStorage();
  assert.equal(readStoredSecret(s), null, 'nothing stored');
  assert.equal(storeSecret(s, SECRET), true);
  assert.equal(readStoredSecret(s), SECRET);
  assert.deepEqual([...s.map.keys()], [KEY_STORAGE_KEY]);
  assert.equal(s.map.get(KEY_STORAGE_KEY), SECRET, 'the secret alone: no participant id is stored');
  assert.equal(forgetStoredSecret(s), true);
  assert.equal(readStoredSecret(s), null);
  // Any page of the origin can write the key.
  s.setItem(KEY_STORAGE_KEY, 'not a secret');
  assert.equal(readStoredSecret(s), null);
});

test('refused storage: a read throws (so the page can tell it from nothing stored), a write or a removal says it was not taken', () => {
  assert.throws(() => readStoredSecret(null));
  const refusing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
  assert.throws(() => readStoredSecret(refusing));
  assert.equal(storeSecret(null, SECRET), false);
  assert.equal(storeSecret(refusing, SECRET), false);
  assert.equal(forgetStoredSecret(null), false);
  assert.equal(forgetStoredSecret(refusing), false);
});

test('keyFingerprint: 8 hex digits of the secret\'s SHA-256; newSecret: 32 random bytes as hex', async () => {
  const fp = await keyFingerprint(SECRET);
  assert.match(fp, /^[0-9a-f]{8}$/);
  assert.equal(fp, (await nodeDeps.sha256(SECRET)).slice(0, 8));
  assert.equal(await keyFingerprint(SECRET), fp);
  assert.notEqual(await keyFingerprint('b'.repeat(64)), fp);
  const made = newSecret();
  assert.match(made, /^[0-9a-f]{64}$/);
  assert.notEqual(newSecret(), made);
});
