// tests/cli/demo-charts.test.js
// The aligned charts for the bundled sessions (examples/demo-sessions),
// drawn through the whole report with node-canvas: every session gets a
// typing chart and a session timeline, both 1000 px wide (one time axis),
// and no plot fails. Skipped where node-canvas is not installed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ingest } from '../../src/cli/ingest.js';
import { buildReport } from '../../src/cli/report-core.js';
import { mergeConfig } from '../../src/cli/config-core.js';

let canvas = null;
try { canvas = await import('canvas'); } catch { /* skipped below */ }
const DATA = join(process.cwd(), 'examples', 'demo-sessions', 'data');
const IDS = ['DEMO-9mop', 'DEMO-bsq6', 'DEMO-681w', 'DEMO-a3f3'];
// A PNG's width: the IHDR chunk's first four bytes, big-endian, at offset 16.
const pngWidth = (b) => ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;

describe('the four demo sessions', { skip: canvas ? false : 'canvas is not installed' }, () => {
  it('each gets a typing chart and a session timeline, both 1000 px wide', async () => {
    process.env.NO_UPDATE_NOTIFIER = '1';
    const config = mergeConfig({ dataDir: DATA, filePattern: '*.json', participantIdField: 'participantId' }).config;
    const { participants } = await ingest(config);
    const files = new Map();
    const built = await buildReport(participants, config, {
      sink: (path, data) => files.set(path, data),
      createCanvas: canvas.createCanvas,
      encodePng: async (c) => new Uint8Array(c.toBuffer('image/png')),
    });
    assert.deepEqual(built.warnings.filter((w) => /timeline|typing profile|trajectories/.test(w)), []);
    for (const id of IDS) {
      for (const kind of ['typing_profile', 'session_timeline']) {
        const png = files.get(`images/${kind}_${id}.png`);
        assert.ok(png, `${kind} for ${id}`);
        assert.equal(pngWidth(png), 1000, `${kind} for ${id}`);
      }
    }
  });
});
