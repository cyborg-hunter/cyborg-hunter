// The browser page runs ingestFiles + buildReport with web deps (DecompressionStream,
// crypto.subtle, dropped-file readers). This proves that path produces byte for
// byte what the CLI writes, on every spec corpus entry.
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, cpSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ingestFiles } from '../../src/cli/ingest-core.js';
import { ingest, fsReader } from '../../src/cli/ingest.js';
import { buildReport } from '../../src/cli/report-core.js';
import { mergeConfig } from '../../src/cli/config-core.js';
import { readReplayClientSrc } from '../../src/cli/renderers/replay-client-source.js';
import { buildFontFaceCss } from '../../src/cli/renderers/report-fonts.js';
import { webGunzip, webSha256 } from '../../demo/analyze/web-deps.js';

// webSha256 reads the browser's global `crypto`; Node 18 (the engines floor)
// only exposes it from node:crypto, so install it for these tests when absent.
if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;

process.env.NO_UPDATE_NOTIFIER = '1';
let canvasMod = null;
try { canvasMod = await import('canvas'); } catch { /* visuals off on both sides */ }

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base)); else out.push(relative(base, full));
  }
  return out.sort();
}

async function viaCli(dataDir, config, out) {
  const cfgPath = join(out, 'config.json');
  writeFileSync(cfgPath, JSON.stringify({ ...config, dataDir }));
  const { run } = await import('../../src/cli/report.js');
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try {
    await run(['report', '--config', cfgPath, '--output', join(out, 'report')].concat(canvasMod ? [] : ['--no-visuals']));
  } finally { console.log = origLog; console.warn = origWarn; }
  return join(out, 'report');
}

// ingestFiles over the directory's files, as the page hands it dropped files.
async function browserIngest(dataDir, config) {
  const names = readdirSync(dataDir).filter((f) => statSync(join(dataDir, f)).isFile()).sort();
  const pattern = config.filePattern === '*.json' ? /\.(json|csv)$/i : new RegExp('^' + config.filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
  const readers = names.map((f) => fsReader(join(dataDir, f)));
  const participantFiles = readers.filter((r) => pattern.test(r.name));
  const { participants } = await ingestFiles({ participantFiles, replayFiles: readers }, config, { gunzip: webGunzip, sha256: webSha256, shellHints: false });
  return participants;
}

async function viaBrowserPath(dataDir, fileConfig) {
  const { config } = mergeConfig(fileConfig);
  config.dataDir = dataDir;
  if (!canvasMod) config.noVisuals = true;
  const participants = await browserIngest(dataDir, config);
  const files = new Map();
  await buildReport(participants, config, {
    sink: (p, d) => files.set(p, typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d)),
    createCanvas: canvasMod ? canvasMod.createCanvas : null,
    encodePng: async (c) => new Uint8Array(c.toBuffer('image/png')),
    replayClientSrc: readReplayClientSrc(), fontFaceCss: buildFontFaceCss(), sha256: webSha256,
  });
  return files;
}

// The time a report was built is the one part of index.html that differs
// between two runs over the same files (the run id is the cohort's own).
const withoutRunTime = (html) => html.replace(/<time class="run-time" datetime="[^"]*">[^<]*<\/time>/, '<time class="run-time"></time>');

async function assertParity(dataDir, fileConfig, tmp) {
  const cliDir = await viaCli(dataDir, fileConfig, tmp);
  const web = await viaBrowserPath(dataDir, fileConfig);
  const cliFiles = walk(cliDir);
  assert.deepStrictEqual([...web.keys()].sort(), cliFiles, 'same file tree');
  for (const f of cliFiles) {
    if (f !== 'index.html') { assert.ok(readFileSync(join(cliDir, f)).equals(web.get(f)), `${f} differs`); continue; }
    const cliIndex = readFileSync(join(cliDir, f), 'utf8');
    assert.match(cliIndex, /<code class="mono run-id">[0-9a-f]{16}<\/code>/, 'the CLI report carries its run id');
    assert.strictEqual(withoutRunTime(web.get(f).toString('utf8')), withoutRunTime(cliIndex), 'index.html differs');
  }
  return cliFiles;
}

describe('browser path parity with the CLI', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ch-parity-'));
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('examples/demo-sessions', async () => {
    const files = await assertParity('examples/demo-sessions/data',
      JSON.parse(readFileSync('examples/demo-sessions/cyborg-hunter.config.json', 'utf8')), mkdirSync(join(tmp, 'sessions'), { recursive: true }));
    assert.ok(files.includes('triage.md'));
  });
  it('tests/cli/fixtures', async () => {
    await assertParity('tests/cli/fixtures', JSON.parse(readFileSync('tests/cli/fixtures/test-config.json', 'utf8')), mkdirSync(join(tmp, 'cli'), { recursive: true }));
  });
  it('tests/fixtures/demo (dom-tier replay)', async () => {
    const files = await assertParity('tests/fixtures/demo', JSON.parse(readFileSync('tests/fixtures/demo/cyborg-hunter.config.json', 'utf8')), mkdirSync(join(tmp, 'demo'), { recursive: true }));
    assert.ok(files.includes('replay/DEMO-FIXT.replay.js'));
  });
  it('tests/fixtures/demo with the replay gzipped (gunzip exercised on both sides)', async () => {
    const d = mkdirSync(join(tmp, 'demo-gz', 'data'), { recursive: true });
    cpSync('tests/fixtures/demo/DEMO-FIXT.json', join(d, 'DEMO-FIXT.json'));
    writeFileSync(join(d, 'DEMO-FIXT-replay-1785352263344.json.gz'), gzipSync(readFileSync('tests/fixtures/demo/DEMO-FIXT-replay-1785352263344.json')));
    const files = await assertParity(d, { filePattern: 'DEMO-*.json', participantIdField: 'participantId' }, join(tmp, 'demo-gz'));
    assert.ok(files.includes('replay/DEMO-FIXT.replay.js'));
  });
  it('a jsPsych v1 artifact converts identically (sha256 injected vs createHash)', async () => {
    const d = mkdirSync(join(tmp, 'v1', 'data'), { recursive: true });
    writeFileSync(join(d, 'P1.json'), JSON.stringify({ participantId: 'P1', trials: [{ trialId: 't1', integrity: { pasteCount: 0, tabAwayEvents: [] } }] }));
    cpSync('tests/tools/fixtures/jspsych-v1-minimal.json', join(d, 'P1-replay-1.json'));
    const fileConfig = { filePattern: '*.json', participantIdField: 'participantId' };
    const files = await assertParity(d, fileConfig, join(tmp, 'v1'));
    assert.ok(files.includes('replay/P1.replay.js'));
    // The hash is provenance inside the converted recording, which no output
    // file carries, so compare the ingested recordings themselves: the Node
    // shell hashes with createHash, the browser path with crypto.subtle.
    const config = { ...mergeConfig(fileConfig).config, dataDir: d };
    const [viaNode] = (await ingest(config)).participants;
    const [viaWeb] = await browserIngest(d, config);
    const provenance = (p) => p.replay.recording.extensions['cyborg-hunter'].converter.source_sha256;
    assert.match(provenance(viaWeb), /^[0-9a-f]{64}$/);
    assert.strictEqual(provenance(viaWeb), provenance(viaNode));
    assert.deepStrictEqual(viaWeb.replay.recording, viaNode.replay.recording);
  });
});
