// The centered-clicks rule over the bundled sessions, run the way a
// researcher runs it: `cyborg-hunter report` inside examples/demo-sessions
// finds each session's recording (the .replay.json next to its data file),
// attaches it, and writes the rule's result into summary.csv. The agent's
// session carries the centered tell; the two human sessions carry none.
// Their rule cells (0 of 8, 0 of 17) are pinned too: a session without a
// recording leaves that cell empty, so the counts show the recordings
// arrived, not only that no tell fired.
// describe/it (not test) so the before hook runs first on Node 18 as well.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = 'examples/demo-sessions';

describe('the centered-clicks rule in the CLI report over examples/demo-sessions', () => {
  let out, rows;
  before(() => {
    out = mkdtempSync(join(tmpdir(), 'ch-centered-clicks-'));
    execFileSync(process.execPath, [join(process.cwd(), 'bin', 'cyborg-hunter.js'), 'report', '--output', out, '--no-visuals'],
      { cwd: DIR, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, encoding: 'utf8' });
    // No cell in this report holds a comma, so a plain split reads it.
    const [header, ...lines] = readFileSync(join(out, 'summary.csv'), 'utf8').trim().split('\n');
    const H = header.split(',');
    rows = {};
    for (const line of lines) {
      const cells = line.split(',');
      rows[cells[H.indexOf('participantId')]] = Object.fromEntries(H.map((name, i) => [name, cells[i]]));
    }
  });
  after(() => { if (out) rmSync(out, { recursive: true, force: true }); });

  it('the agent session carries the centered tell beside the no-path one', () => {
    assert.equal(rows['DEMO-bsq6'].cursorTells, 'clicks without a path 12/12; centered clicks 8/11');
    assert.equal(rows['DEMO-bsq6'].cursorCenteredClicks, '8/11');
  });

  it('the two human sessions were judged on their recordings and carry no tell', () => {
    for (const [id, centered] of [['DEMO-681w', '0/8'], ['DEMO-a3f3', '0/17']]) {
      assert.equal(rows[id].cursorTells, '', id);
      assert.equal(rows[id].cursorCenteredClicks, centered, id);
    }
  });
});
