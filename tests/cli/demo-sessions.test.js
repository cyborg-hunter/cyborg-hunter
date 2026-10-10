// The bundled dataset examples/demo-sessions: the CLI reads it as the docs
// say (tiers, scores, the pointer verdict line), and the files carry nothing
// personal: the only free text is the tour's own copy, and the one paste
// whose text was removed stays empty.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = 'examples/demo-sessions';
const ORDER = ['DEMO-9mop', 'DEMO-bsq6', 'DEMO-681w', 'DEMO-a3f3'];
// The opening of every paste text in the files: the tour's copy, or a
// selection from inside it.
const TOUR_PASTES = ['Great question! 😊 Honestly? My day has been', 'ch tapestry of moments',
  'a flicker (under 3 seconds)', 'Under the guard, the study requires fullscreen', 'Participants meet it as the box below'];

describe('examples/demo-sessions', () => {
  let out, stdout;
  before(() => {
    out = mkdtempSync(join(tmpdir(), 'ch-demo-sessions-'));
    stdout = execFileSync(process.execPath, [join(process.cwd(), 'bin', 'cyborg-hunter.js'), 'report', '--output', out, '--no-visuals'],
      { cwd: DIR, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, encoding: 'utf8' });
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  test('four files, one participant each, triaged in the documented order with the documented tiers and scores', () => {
    assert.deepEqual(readdirSync(join(DIR, 'data')).sort(), ['DEMO-681w.json', 'DEMO-9mop.json', 'DEMO-a3f3.json', 'DEMO-bsq6.json']);
    const rows = readFileSync(join(out, 'triage.md'), 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l))
      .map((l) => l.split('|').map((c) => c.trim()));
    assert.deepEqual(rows.map((r) => [r[2], r[3], r[4]]),
      [['DEMO-9mop', '**HARD**', '45'], ['DEMO-bsq6', '**HARD**', '21'], ['DEMO-681w', 'soft', '13'], ['DEMO-a3f3', 'clean', '11']]);
    assert.match(rows[1][5], /pointer verdict: highly suspicious \(clicks without a path 12\/12\)$/);
    assert.match(stdout, /Pointer verdicts: 1 highly suspicious, 0 suspicious, 1 clean, 2 not assessed \(4 sessions; 2 recorded without device facts\)/);
  });

  test('summary.csv: the verdict columns the walkthrough quotes', () => {
    const [h, ...r] = readFileSync(join(out, 'summary.csv'), 'utf8').trim().split('\n');
    const H = h.split(',');
    const col = (line, name) => line.split(',')[H.indexOf(name)];
    const byId = Object.fromEntries(r.map((l) => [col(l, 'participantId'), l]));
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'cursorVerdict')), ['not assessed', 'highly suspicious', 'clean', 'not assessed']);
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'cursorNoPathClicks')), ['0/112', '12/12', '0/22', '0/12']);
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'authoritative_soft_score')), ['12', '10', '6', '3']);
  });

  test('nothing personal: no user-agent or address, and every paste text is the tour\'s own copy or removed', () => {
    for (const f of readdirSync(join(DIR, 'data'))) {
      const raw = readFileSync(join(DIR, 'data', f), 'utf8');
      assert.doesNotMatch(raw, /Mozilla|https?:\/\//, f);
      const j = JSON.parse(raw);
      for (const t of j.trials) for (const p of t.integrity.pasteEvents) {
        assert.ok(p.text === '' || TOUR_PASTES.some((s) => p.text.startsWith(s)), f + ' ' + t.trialId + ': ' + p.text.slice(0, 40));
      }
    }
    const a3f3 = JSON.parse(readFileSync(join(DIR, 'data', 'DEMO-a3f3.json'), 'utf8'));
    const paste = a3f3.trials.find((t) => t.trialId === 'act1-baseline').integrity.pasteEvents[0];
    assert.equal(paste.text, '');
    assert.equal(paste.pastedLength, 49);
  });
});
