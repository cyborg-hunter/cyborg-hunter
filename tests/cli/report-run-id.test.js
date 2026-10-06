// The report's run id and time (report-core.js runIdOf; the top bar of
// html-index-core.js). The id names the cohort: its participant ids, sorted
// and hashed, so a rebuild of the same files under other settings keeps it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ingest, nodeDeps } from '../../src/cli/ingest.js';
import { buildReport, renderInPageHtml, runIdOf } from '../../src/cli/report-core.js';
import { mergeConfig } from '../../src/cli/config-core.js';
import { webSha256 } from '../../demo/analyze/web-deps.js';

// webSha256 reads the browser's global `crypto`; Node 18 (the engines floor)
// only exposes it from node:crypto.
if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;

const CLI = { dataDir: 'tests/cli/fixtures', filePattern: '*_participant.json', participantIdField: 'participantId', integrityField: 'integrity' };
const NOW = () => '2026-10-05T14:03:12.345Z';
const cohort = (ids) => ids.map((participantId) => ({ participantId }));

describe('the run id', () => {
  it('is the first 16 hex digits of the sha256 of the sorted ids as JSON, whatever their order', async () => {
    const expected = createHash('sha256').update('["P1","P2","P3"]', 'utf8').digest('hex').slice(0, 16);
    assert.equal(await runIdOf(cohort(['P2', 'P3', 'P1']), nodeDeps.sha256), expected);
    assert.equal(await runIdOf(cohort(['P1', 'P2', 'P3']), webSha256), expected, 'the browser hash agrees');
    assert.notEqual(await runIdOf(cohort(['P1', 'P2']), nodeDeps.sha256), expected, 'another cohort, another id');
  });

  it('is in the top bar with the time of the run, in the CLI report and in the in-page one', async () => {
    const { participants } = await ingest(CLI);
    const config = mergeConfig(CLI).config;
    const files = new Map();
    const built = await buildReport(participants, config,
      { sink: (path, data) => files.set(path, data), replayClientSrc: '', fontFaceCss: '', sha256: nodeDeps.sha256, now: NOW });
    assert.equal(built.runId, await runIdOf(participants, nodeDeps.sha256));
    assert.equal(built.generatedAt, NOW());
    const line = ' &middot; run <code class="mono run-id">' + built.runId + '</code>' +
      ' &middot; <time class="run-time" datetime="2026-10-05T14:03:12.345Z">2026-10-05 14:03 UTC</time></span>';
    assert.ok(files.get('index.html').includes(line), 'the CLI report');
    const inPage = await renderInPageHtml(built, participants, config, { replayClientSrc: '', fontFaceCss: '' });
    assert.ok(inPage.includes(line), 'the in-page report');
  });

  it('is absent when no hash is given: the top bar is unchanged', async () => {
    const { participants } = await ingest(CLI);
    const files = new Map();
    const built = await buildReport(participants, mergeConfig(CLI).config,
      { sink: (path, data) => files.set(path, data), replayClientSrc: '', fontFaceCss: '' });
    assert.equal(built.runId, null);
    assert.equal(built.generatedAt, null);
    assert.equal(files.get('index.html').includes('run-id'), false);
  });
});
