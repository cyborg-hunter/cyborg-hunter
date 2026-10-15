// A .json.gz upload is participant data: a small file can expand to
// gigabytes. Both gunzips (the CLI's node:zlib one and the analyzer's
// DecompressionStream one) stop at a limit (src/shared/limits.js), and ingest
// turns that into a warning for the file instead of a crashed run.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { gzipSync } from 'node:zlib';
import { nodeGunzip } from '../../src/cli/ingest.js';
import { webGunzip, webSha256 } from '../../demo/analyze/web-deps.js';
import { ingestFiles } from '../../src/cli/ingest-core.js';
import { MAX_DECOMPRESSED_BYTES } from '../../src/shared/limits.js';

const MB = 1024 * 1024;
const zeros = (n) => new Uint8Array(gzipSync(Buffer.alloc(n)));

describe('gunzip limit', () => {
  it('the default limit is far above any real file', () => {
    assert.ok(MAX_DECOMPRESSED_BYTES >= 128 * MB);
  });

  for (const [name, gunzip] of [['node', (b, l) => nodeGunzip(l)(b)], ['web', (b, l) => webGunzip(b, l)]]) {
    it(name + ': under the limit reads as usual; over it is refused with a clear message', async () => {
      assert.strictEqual((await gunzip(zeros(MB / 2), MB)).length, MB / 2);
      await assert.rejects(gunzip(zeros(3 * MB), MB), /decompressed size exceeds 1 MB/);
    });
  }

  it('web: several gzip members count against one budget', async () => {
    const two = new Uint8Array([...zeros(700 * 1024), ...zeros(700 * 1024)]);
    await assert.rejects(webGunzip(two, MB), /exceeds/);
    assert.strictEqual((await webGunzip(two, 2 * MB)).length, 1400 * 1024);
  });

  it('ingest: a bomb among the files is a warning for that file, and the run goes on', async () => {
    const bomb = zeros(3 * MB);
    const ok = new TextEncoder().encode(JSON.stringify({ participantId: 'P1', trials: [{ integrity: { trialId: 't', participantId: 'P1', pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [] } }] }));
    const reader = (name, bytes) => ({ name, path: name, size: bytes.length, read: async () => bytes });
    const files = [reader('P1.json', ok), reader('bomb-replay-1751600000000.json.gz', bomb)];
    const { participants, warnings } = await ingestFiles({ participantFiles: files, replayFiles: files },
      { participantIdField: 'participantId', integrityField: 'integrity', dataDir: '.' },
      { gunzip: (b) => webGunzip(b, MB), sha256: webSha256, shellHints: false });
    assert.strictEqual(participants.length, 1);
    assert.ok(warnings.some((w) => String(w.warnings).includes('exceeds')), JSON.stringify(warnings));
  });
});
