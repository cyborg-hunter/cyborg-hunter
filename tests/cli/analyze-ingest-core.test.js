// ingestFiles is the ingest the CLI runs, over lazy readers and injected
// gunzip/sha256: the Node shell feeds it fs-backed readers, the browser page
// feeds it dropped files. Both must produce what ingest() produces today.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { ingest, fsReader } from '../../src/cli/ingest.js';
import { ingestFiles, migrateArtifact, artifactKind } from '../../src/cli/ingest-core.js';
import { webGunzip, webSha256 } from '../../demo/analyze/web-deps.js';
import { convertRecording as convertSync } from '../../tools/convert/jspsych-v1-to-v2.mjs';

// webSha256 reads the browser's global `crypto`; Node 18 (the engines floor)
// only exposes it from node:crypto, so install it for these tests when absent.
if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;

const nodeDeps = {
  gunzip: async (b) => new Uint8Array(gunzipSync(b)),
  sha256: (t) => createHash('sha256').update(t, 'utf8').digest('hex'),
};
const webDeps = { gunzip: webGunzip, sha256: webSha256 };

// In-memory reader: `bytes` is a Uint8Array; `reads` counts read() calls.
function memReader(name, bytes) {
  const r = { name, path: name, size: bytes.length, reads: 0,
    read: async () => { r.reads++; return bytes; } };
  return r;
}
const textBytes = (s) => new TextEncoder().encode(s);

describe('ingestFiles over readers', () => {
  it('matches ingest() on the CLI fixtures (same participants, same warnings)', async () => {
    const dir = 'tests/cli/fixtures';
    const config = { dataDir: dir, filePattern: '*_participant.json', participantIdField: 'participantId', integrityField: 'integrity' };
    const viaShell = await ingest(config);
    const names = readdirSync(dir).filter((f) => /_participant\.json$/.test(f)).sort();
    const participantFiles = names.map((f) => fsReader(join(dir, f)));
    const replayFiles = readdirSync(dir).map((f) => fsReader(join(dir, f)));
    const viaCore = await ingestFiles({ participantFiles, replayFiles }, config, nodeDeps);
    assert.deepStrictEqual(viaCore, viaShell);
  });

  it('reads a participant CSV exactly once', async () => {
    const csv = memReader('p1.csv', readFileSync('examples/synthetic-pilot/data/sim-SYN-CLEAN-01.csv'));
    const { participants } = await ingestFiles({ participantFiles: [csv], replayFiles: [csv] },
      { dataDir: '.', filePattern: '*.csv', participantIdField: 'subject_ID' }, webDeps);
    assert.strictEqual(participants.length, 1);
    assert.strictEqual(participants[0].participantId, 'SYN-CLEAN-01');
    assert.strictEqual(csv.reads, 1);
  });

  it('attaches a gzipped v2 replay through DecompressionStream', async () => {
    const dir = 'tests/fixtures/demo';
    const part = memReader('DEMO-FIXT.json', readFileSync(join(dir, 'DEMO-FIXT.json')));
    const gz = memReader('DEMO-FIXT-replay-1785352263344.json.gz',
      new Uint8Array(gzipSync(readFileSync(join(dir, 'DEMO-FIXT-replay-1785352263344.json')))));
    const config = { dataDir: dir, filePattern: 'DEMO-*.json', participantIdField: 'participantId', integrityField: 'integrity' };
    const { participants, warnings } = await ingestFiles(
      { participantFiles: [part], replayFiles: [part, gz] }, config, webDeps);
    assert.deepStrictEqual(warnings, []);
    assert.strictEqual(participants[0].replay.recording.schema_version, 2);
    assert.strictEqual(participants[0].replay.file, 'DEMO-FIXT-replay-1785352263344.json.gz');
  });

  it('converts a jsPsych v1 artifact with the injected hash and matches the Node tool', async () => {
    const v1 = readFileSync('tests/tools/fixtures/jspsych-v1-minimal.json');
    const part = memReader('P1.json', textBytes(JSON.stringify({ participantId: 'P1', trials: [{ trialId: 't1', integrity: { pasteCount: 0 } }] })));
    const art = memReader('P1-replay-1.json', new Uint8Array(v1));
    const config = { dataDir: '(dropped files)', filePattern: '*.json', participantIdField: 'participantId', integrityField: 'integrity' };
    const web = await ingestFiles({ participantFiles: [part, art], replayFiles: [part, art] }, config, { ...webDeps, shellHints: false });
    const expected = convertSync(JSON.parse(v1.toString('utf8')));
    assert.deepStrictEqual(web.participants[0].replay.recording, expected);
    const note = web.warnings.map((w) => w.warnings.join(' ')).find((t) => /converted to SessionRecording v2/.test(t));
    assert.ok(note, 'conversion is announced');
    assert.ok(note.includes(expected.extensions['cyborg-hunter'].converter.source_sha256));
    assert.ok(!/node tools\/convert/.test(note), 'no shell command in the browser wording');
    const withHints = await ingestFiles({ participantFiles: [part, art], replayFiles: [part, art] }, config, nodeDeps);
    const hinted = withHints.warnings.map((w) => w.warnings.join(' ')).find((t) => /converted to SessionRecording v2/.test(t));
    assert.ok(/node tools\/convert\/jspsych-v1-to-v2\.mjs P1-replay-1\.json/.test(hinted));
  });

  it('reports an unreadable replayDir where the shell reports it today', async () => {
    const { warnings } = await ingestFiles({ participantFiles: [], replayFiles: [] },
      { dataDir: '/x', replayDir: '/nope', filePattern: '*.json' }, { ...nodeDeps, replayDirError: 'ENOENT: no such file or directory' });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].file, '/nope');
    assert.match(warnings[0].warnings[0], /^replayDir not readable: ENOENT/);
  });
});

describe('migrateArtifact (async)', () => {
  it('passes a v2 through and converts v1 with the injected sha256', async () => {
    const v2 = { schema_version: 2, recorder: { name: 'x' }, segments: [] };
    assert.deepStrictEqual(await migrateArtifact(v2, 'v2', webDeps), { recording: v2 });
    const v1 = JSON.parse(readFileSync('tests/tools/fixtures/jspsych-v1-minimal.json', 'utf8'));
    const out = await migrateArtifact(v1, 'jspsych-v1', webDeps);
    assert.strictEqual(out.converted, true);
    assert.deepStrictEqual(out.recording, convertSync(v1));
  });
  it('still accepts a bare convert function as the third argument', async () => {
    const out = await migrateArtifact({ schema_version: 1, trials: [] }, 'jspsych-v1', () => { throw new Error('boom'); });
    assert.match(out.internal, /boom/);
  });
  it('artifactKind is exported from the core', () => {
    assert.strictEqual(artifactKind({ schema_version: 1, trials: [] }), 'jspsych-v1');
  });
});

// webGunzip's two paths give the same bytes: the browser's DecompressionStream
// over a stream built without a Blob (a worker of a file:// page in WebKit
// cannot read any Blob), and fflate's gunzip when that stream fails.
describe('webGunzip', () => {
  // Large enough that the stream hands the output over in several chunks.
  const text = Array.from({ length: 40000 }, (_, i) => 'line ' + i + ' ' + (i * 7919 % 1000)).join('\n');
  const gz = new Uint8Array(gzipSync(Buffer.from(text)));
  const expected = new Uint8Array(gunzipSync(gz));
  const withGlobal = async (name, value, fn) => {
    const saved = globalThis[name];
    globalThis[name] = value;
    try { return await fn(); } finally { globalThis[name] = saved; }
  };

  it('inflates without constructing a Blob', async () => {
    const out = await withGlobal('Blob', class { constructor() { throw new Error('Blob loading failed'); } }, () => webGunzip(gz));
    assert.deepStrictEqual(out, expected);
  });

  it('falls back to fflate when the decompression stream fails, with identical output', async () => {
    const failing = class { constructor() { throw new Error('The I/O read operation failed.'); } };
    const out = await withGlobal('DecompressionStream', failing, () => webGunzip(gz));
    assert.deepStrictEqual(out, expected);
    const none = await withGlobal('DecompressionStream', undefined, () => webGunzip(gz));
    assert.deepStrictEqual(none, expected);
  });

  it('rejects bytes that are not gzip with the stream\'s own error', async () => {
    const garbage = textBytes('not gzip at all');
    const native = await new Response(new Blob([garbage]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      .then(() => null, (e) => e);
    assert.ok(native, 'the native stream rejects the input');
    await assert.rejects(webGunzip(garbage), (e) => e.message === native.message);
  });
});
