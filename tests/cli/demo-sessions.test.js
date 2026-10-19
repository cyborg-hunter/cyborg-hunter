// The bundled dataset examples/demo-sessions: the CLI reads it as the docs
// say (tiers, scores, the pointer verdict line), and the files carry nothing
// personal: the only free text is the tour's own copy, and the one paste
// whose text was removed stays empty.
import { it as test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = 'examples/demo-sessions';
const ORDER = ['DEMO-9mop', 'DEMO-bsq6', 'DEMO-681w', 'DEMO-a3f3'];
// The tour's texts the files' pastes come from, each at its longest in the
// files: every logged paste text is one of these or a selection from inside
// one. The answer step's reply is here twice: DEMO-9mop's has curly
// apostrophes.
const TOUR_TEXTS = [
  'Great question! 😊 Honestly? My day has been a rich tapestry of moments — both big and small — that have reminded me what it truly means to be human. It\'s not just a day — it\'s a journey.',
  'Great question! 😊 Honestly? My day has been a rich tapestry of moments — both big and small — that have reminded me what it truly means to be human. It’s not just a day — it’s a journey.',
  'a flicker (under 3 seconds), a short absence (3–10 seconds), and a long one (over 10 seconds). ',
  'Under the guard, the study requires fullscreen and focus; leaving either scrambles the on-screen text until you return, and every violation is logged with its type and timestamp.',
  'Participants meet it as the box below, the library\'s actual entry screen, word for word. Enter whenever you\'re ready; nothing is enforced until you do.',
];

describe('examples/demo-sessions', () => {
  let out, stdout;
  before(() => {
    out = mkdtempSync(join(tmpdir(), 'ch-demo-sessions-'));
    stdout = execFileSync(process.execPath, [join(process.cwd(), 'bin', 'cyborg-hunter.js'), 'report', '--output', out, '--no-visuals'],
      { cwd: DIR, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, encoding: 'utf8' });
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  test('four files, one participant each, triaged in the documented order with the documented tiers and scores', () => {
    assert.deepEqual(readdirSync(join(DIR, 'data')).sort(),
      ['DEMO-681w.json', 'DEMO-681w.replay.json', 'DEMO-9mop.json', 'DEMO-a3f3.json', 'DEMO-a3f3.replay.json', 'DEMO-bsq6.json', 'DEMO-bsq6.replay.json']);
    const rows = readFileSync(join(out, 'triage.md'), 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l))
      .map((l) => l.split('|').map((c) => c.trim()));
    assert.deepEqual(rows.map((r) => [r[2], r[3], r[4]]),
      [['DEMO-9mop', '**HARD**', '45'], ['DEMO-bsq6', '**HARD**', '21'], ['DEMO-681w', 'soft', '13'], ['DEMO-a3f3', 'clean', '11']]);
    assert.match(rows[1][5], /pointer verdict: highly suspicious \(clicks without a path 12\/12; centered clicks 8\/11\)$/);
    assert.match(stdout, /Pointer verdicts: 1 highly suspicious, 0 suspicious, 1 clean, 2 not assessed \(4 sessions; 2 recorded without device facts\)/);
  });

  test('the README table is the run\'s triage table', () => {
    const want = readFileSync(join(out, 'triage.md'), 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => l.replace(/\s+/g, ' ').trim());
    const readme = readFileSync('README.md', 'utf8').split('\n').filter((l) => /^\| \d+ \| DEMO-/.test(l)).map((l) => l.replace(/\s+/g, ' ').trim());
    assert.deepEqual(readme, want);
  });

  test('summary.csv: the verdict columns the walkthrough quotes', () => {
    const [h, ...r] = readFileSync(join(out, 'summary.csv'), 'utf8').trim().split('\n');
    const H = h.split(',');
    const col = (line, name) => line.split(',')[H.indexOf(name)];
    const byId = Object.fromEntries(r.map((l) => [col(l, 'participantId'), l]));
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'cursorVerdict')), ['not assessed', 'highly suspicious', 'clean', 'not assessed']);
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'cursorNoPathClicks')), ['0/112', '12/12', '0/22', '0/12']);
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'cursorCenteredClicks')), ['', '8/11', '0/8', '0/17']);
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'cursorCenteredNear')), ['', '10/11', '0/8', '0/17']);
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'authoritative_soft_score')), ['12', '10', '6', '3']);
  });

  test('the three recordings are attached to their sessions; DEMO-9mop has none', () => {
    assert.match(stdout, /replay\/ — 3 session replays/);
    const written = readdirSync(join(out, 'replay')).sort();
    assert.equal(written.length, 3);
    for (const id of ['DEMO-681w', 'DEMO-a3f3', 'DEMO-bsq6']) assert.ok(written.some((f) => f.startsWith(id)), id);
    assert.ok(!written.some((f) => f.startsWith('DEMO-9mop')));
  });

  test('the recordings carry no address, path or private text; the one identifying field is the browser line', () => {
    // The redacted paste of DEMO-a3f3 reads "Copy Copy" (its event keeps the
    // length 9); the agent's typed answer and the tour's own copy are the
    // only other typed text.
    const AUTOTYPE = 'No one is typing this. It is being inserted.';
    const AGENT_ANSWER = 'A productive day so far.';
    // The agent pasted the tour's answer into a field that already held "ch",
    // so its values can carry a "ch" at either end, and one holds that paste
    // twice over: the check strips both before matching the tour's text.
    const isTourText = (typed) => {
      const half = typed.slice(0, typed.length / 2);
      const once = typed === half + half ? half : typed;
      return AUTOTYPE.startsWith(typed) || AGENT_ANSWER.startsWith(typed)
        || TOUR_TEXTS.some((s) => s.includes(once.replace(/^ch/, '').replace(/ch$/, '')));
    };
    for (const f of readdirSync(join(DIR, 'data')).filter((n) => n.endsWith('.replay.json'))) {
      const raw = readFileSync(join(DIR, 'data', f), 'utf8');
      assert.doesNotMatch(raw, /\b[a-z][a-z0-9+.-]*:\/\//i, f);
      assert.doesNotMatch(raw, /\b(?:data|javascript|blob|about|mailto):/i, f);
      assert.doesNotMatch(raw, /\/Users\/|localhost|[\w.+-]+@[\w-]+\.[a-z]{2,}|plugin enable|salut/, f);
      const j = JSON.parse(raw);
      assert.match(j.user_agent, /^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/, f);
      assert.deepEqual(j.stylesheets.map((s) => s.href), ['demo.css'], f);
      assert.deepEqual(j.stylesheet_events, [], f);
      // Every keyframe's body holds the demo's three elements, and nothing is
      // added directly under it afterwards: what a browser extension puts into
      // the page lands there.
      const label = (c) => c.tag + (c.attrs && c.attrs.id ? '#' + c.attrs.id : '') + (c.attrs && c.attrs.class ? '.' + c.attrs.class : '');
      let root = null;
      for (const s of j.segments) {
        if (s.initial_dom) {
          root = s.initial_dom.id;
          assert.deepEqual(s.initial_dom.children.filter((c) => c.tag).map(label), ['div.topbar', 'div.cols', 'div#smallmode'], f + ' ' + s.label);
        }
        for (const e of s.events) {
          if (e.type === 'dom.add' && root !== null && e.parent === root) assert.ok(!e.node.tag, f + ' ' + s.label + ': ' + label(e.node));
        }
      }
      const values = [];
      (function walk(v) {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (v && typeof v === 'object') { if (v.type === 'input.value') values.push(String(v.value)); for (const k in v) walk(v[k]); }
      })(j);
      for (const v of values) {
        assert.ok(v === 'Copy Copy' || isTourText(v.endsWith('▏') ? v.slice(0, -1) : v), f + ': ' + v.slice(0, 60));
      }
      // The keys pressed on each field spell what was typed there whatever its
      // value reads: one-character keys without ctrl, meta or alt, in order,
      // pass the same check.
      const keyed = {};
      for (const s of j.segments) {
        for (const e of s.events) {
          if (e.type === 'key.down' && e.key.length === 1 && !e.mods.ctrl && !e.mods.meta && !e.mods.alt) keyed[e.target] = (keyed[e.target] || '') + e.key;
        }
      }
      for (const t in keyed) assert.ok(isTourText(keyed[t]), f + ': keys on ' + t + ': ' + keyed[t].slice(0, 60));
      if (f !== 'DEMO-681w.replay.json') assert.ok(values.length > 0, f);
      if (f === 'DEMO-a3f3.replay.json') {
        assert.equal(values.filter((v) => v === 'Copy Copy').length, 1);
        const pastes = j.segments.flatMap((s) => s.events.filter((e) => e.type === 'clipboard.paste'));
        assert.deepEqual(pastes.map((p) => p.len), [9]);
        // On the pasted field, the paste's chord and the Tab that left it only.
        const fieldKeys = j.segments.flatMap((s) => s.events)
          .filter((e) => e.type.startsWith('key.') && e.target === pastes[0].target).map((e) => e.type + ' ' + e.key);
        assert.deepEqual(fieldKeys, ['key.down Meta', 'key.down v', 'key.up Meta', 'key.up v', 'key.down Tab']);
      }
    }
  });

  test('nothing personal: no user-agent or address, and every paste text is the tour\'s own copy or removed', () => {
    for (const f of readdirSync(join(DIR, 'data')).filter((n) => !n.endsWith('.replay.json'))) {
      const raw = readFileSync(join(DIR, 'data', f), 'utf8');
      assert.doesNotMatch(raw, /Mozilla|https?:\/\/|\/Users\/|localhost|file:/, f);
      const j = JSON.parse(raw);
      for (const t of j.trials) for (const p of t.integrity.pasteEvents) {
        assert.ok(p.text === '' || TOUR_TEXTS.some((s) => s.includes(p.text)), f + ' ' + t.trialId + ': ' + p.text.slice(0, 40));
      }
    }
    const a3f3 = JSON.parse(readFileSync(join(DIR, 'data', 'DEMO-a3f3.json'), 'utf8'));
    const paste = a3f3.trials.find((t) => t.trialId === 'act1-baseline').integrity.pasteEvents[0];
    assert.equal(paste.text, '');
    assert.equal(paste.pastedLength, 49);
  });

  test('device facts: no masking and no renderer recorded; the device lines and the click pictures', () => {
    const [h, ...r] = readFileSync(join(out, 'summary.csv'), 'utf8').trim().split('\n');
    const H = h.split(',');
    const col = (line, name) => line.split(',')[H.indexOf(name)];
    const byId = Object.fromEntries(r.map((l) => [col(l, 'participantId'), l]));
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'deviceMasking')), ['', '', '', '']);
    assert.deepEqual(ORDER.map((id) => col(byId[id], 'cursorSoftwareRenderer')), ['', '', '', '']);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    const count = (s) => html.split(s).length - 1;
    const line = (rest) => `<p class="muted note device-line">device: graphics card not recorded (library before 0.17) · screen facts agree · ${rest}</p>`;
    assert.equal(count(line('automation flag off · mouse or trackpad')), 2);   // DEMO-bsq6, DEMO-681w: device facts since 0.14
    assert.equal(count(line('automation flag not recorded')), 2);              // DEMO-9mop, DEMO-a3f3: recorded before 0.14
    assert.equal(count('<b class="device-flag">'), 0);
    assert.equal(count('<figure class="click-picture">'), 3);                  // the three sessions with a recording
    assert.match(html, />8 at the exact centre \(within 1\.5 px\)</);           // DEMO-bsq6
    assert.ok(html.includes('<figcaption><b>Where each click landed on its control.</b> 11 qualifying clicks, each control scaled to this box.</figcaption>'));
  });
});
