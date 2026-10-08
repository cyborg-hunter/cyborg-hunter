// tests/demo/steps-shape.test.js
// Structural contract the engine relies on: 10 steps, known ids in order,
// every step has eyebrow/title/body and its eyebrow (the card's step label)
// is its count against the total and nothing else, no tier vocabulary before
// step 9, the lamps panel's layout, and the last step's files and the fonts
// its hand-off carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as copy from '../../demo/steps.js';
import { STEPS, RAIL_GROUPS, REPLICATE, DOWNLOAD_BATCHES, HANDOFF, SAVE_TO_FOLDER, HANDOFF_ASSETS } from '../../demo/steps.js';
import { renderRail } from '../../demo/rail.js';

const IDS = ['intro','baseline','clipboard-cheat','tab-away',
  'autotype','guard-entry','guard-cheat','guard-debrief',
  'signals-to-scores','your-files'];

test('step map', () => {
  assert.equal(STEPS.length, 10);
  assert.deepEqual(STEPS.map(s => s.id), IDS);
  for (const s of STEPS) { assert.ok(s.eyebrow && s.title && s.body, s.id); }
  STEPS.forEach((s, i) => assert.equal(s.eyebrow, 'Step ' + (i + 1) + ' of ' + STEPS.length, s.id));
});
test('no step label names an act', () => {
  // The act lives in each step's `act` field (body[data-view], for the CSS);
  // the labels a visitor reads never say it.
  for (const s of STEPS) {
    const labels = [s.eyebrow, s.primaryLabel || ''];
    for (const label of labels) assert.doesNotMatch(label, /\bAct\b/, s.id + ': ' + label);
  }
});
test('the first step says what the demo is for, in two paragraphs, and starts with "Start the demo"', () => {
  const intro = STEPS[0];
  assert.equal(intro.id, 'intro');
  const body = intro.body.replace(/\s+/g, ' ');
  assert.ok(body.startsWith('<p>cyborg-hunter is an open-source toolkit for online behavioral research: a browser ' +
    'library that records integrity signals while participants work (clipboard use, tab switches, typing dynamics, ' +
    'automation traces), and a command-line tool that turns those records into a triage report a reviewer can read ' +
    'in minutes. The goal is'), body);
  assert.ok(body.includes('The goal is to catch participants using AI assistance during behavioral experiments.'), body);
  assert.ok(body.includes('This demo makes you the participant. It invites you to trigger some of the signals ' +
    'yourself via your actions, over several successive steps. The panel on the right ("Tracked signals") ' +
    'notifies you of the signals as they are being tracked by the plugin. In the end, you will be able to ' +
    "download your session's files and generate a report from them in the analyzer, just like you would from " +
    'the traces left by a real participant taking your study. Your data stays entirely in this browser and ' +
    'will not be uploaded to an external server.'), body);
  assert.doesNotMatch(body, /It exists because/);
  assert.equal((body.match(/<p>/g) || []).length, 2);
  assert.doesNotMatch(body, /\bAct\b/);
  assert.equal(intro.primaryLabel, 'Start the demo');
});
test('the second step asks how your day is, in one paragraph, with no code under it', () => {
  const baseline = STEPS[1];
  assert.equal(baseline.id, 'baseline');
  assert.equal(baseline.body.replace(/\s+/g, ' '), '<p>First, answer the question below the way you normally would. ' +
    'This serves as a baseline: an honest answer produces keystrokes at a human rhythm and not much else. Watch the ' +
    'lamps on the right as you type; the session record under this card lists each event the moment it happens.</p>');
  assert.equal(baseline.task.prompt, 'How is your day today?');
  assert.ok(!('CODE_TABS' in copy), 'CODE_TABS is still exported');
  for (const s of STEPS) {
    assert.ok(!s.showCodeTabs, s.id + ' shows code tabs');
    assert.doesNotMatch(s.body, /Below the task|This page drives/, s.id);
  }
});
test('no step links ahead of the tour: no step carries a secondary field', () => {
  for (const s of STEPS) assert.ok(!('secondary' in s), s.id);
});
test('the third step asks how your day is and offers an assistant\'s answer to copy', () => {
  const cheat = STEPS[2];
  assert.equal(cheat.id, 'clipboard-cheat');
  assert.equal(cheat.task.question, 'How is your day today?');
  assert.equal(cheat.task.providedAnswer, 'Great question! 😊 Honestly? My day has been a rich tapestry of moments ' +
    '— both big and small — that have reminded me what it truly means to be human. It\'s not just a day — it\'s a journey.');
});
test('the fourth step covers leaving the tab and opening a sidebar, in three paragraphs, and ends with "Done"', () => {
  const tabAway = STEPS[3];
  assert.equal(tabAway.id, 'tab-away');
  assert.equal(tabAway.body.replace(/\s+/g, ' '),
    '<p>Another typical trace left by participants using AI assistance is the repeated opening and closing of ' +
    'the current tab, to fetch an answer from an AI assistant located in a browser sidebar or a different window. ' +
    'For this reason, cyborg-hunter tracks each time the user leaves the current tab. We distinguish three types ' +
    'of tab-away events: a flicker (under 3 seconds), a short absence (3–10 seconds), and a long one (over 10 ' +
    'seconds). Flickers are less suspicious because they might simply be the result of a notification or a stray ' +
    'click. Longer absences, especially if they occur at critical moments of the experiment when the user is ' +
    'supposed to find the answer to a non-trivial question, are more suspicious.</p> ' +
    '<p>Another suspicious sign is the presence of browser sidebars, which participants can tuck out to the side ' +
    'of the window in order to consult an AI assistant. cyborg-hunter also tracks when participants open a ' +
    'sidebar.</p> ' +
    '<p>To test these features, you can try it yourself: move to a different tab for different durations and ' +
    'come back, and/or open a sidebar.</p>');
  assert.equal(tabAway.task.kind, 'tab-away');
  assert.equal(tabAway.primaryLabel, 'Done');
});
test('trial ids name the task, not the act, and none is a key the record reserves', () => {
  // The record's trial column and its filter tabs show these ids. 'all' and
  // 'session' are the live pane's own filter keys (live-pane.js).
  const ids = STEPS.filter((s) => s.task && s.task.trialId).map((s) => s.task.trialId);
  assert.deepEqual(ids, ['baseline', 'paste', 'tabaway', 'autotype', 'entry', 'guard']);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.doesNotMatch(id, /^act/, id);
    assert.ok(id !== 'all' && id !== 'session', id);
  }
});
test('the link back reads "Go back"; the record has no caption', () => {
  assert.equal(copy.BACK_LABEL, 'Go back');
  assert.ok(!('caption' in copy.LIVE_PANE), 'LIVE_PANE.caption is still there');
  assert.doesNotMatch(JSON.stringify(copy.LIVE_PANE), /accumulates into/);
});
test('no tier vocabulary in steps 2-8', () => {
  // Steps 2-8 only: step 1 may NAME the product ("triage report") without narrating scores.
  const before = STEPS.slice(1, 8).map(s => [s.title, s.body, JSON.stringify(s.task || {})].join(' ')).join(' ');
  for (const word of ['HARD', 'SOFT', 'CLEAN', 'tier', 'triage', 'preset']) {
    assert.ok(!before.includes(word), `"${word}" leaked before step 9`);
  }
});
test('the lamps panel is the title and the lamps: no intro copy, heads Guard and Recording only', () => {
  assert.ok(!('RAIL_INTRO' in copy), 'RAIL_INTRO is still exported');
  assert.ok(!('RAIL_INTRO_TITLE' in copy), 'RAIL_INTRO_TITLE is still exported');
  // renderRail() only writes innerHTML and then looks rows up, so a bare
  // container is enough to read the markup it builds.
  const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  renderRail(container, { groups: RAIL_GROUPS });
  const html = container.innerHTML;
  assert.ok(html.startsWith('<h3>Tracked signals</h3><ul class="check awaiting">'), html.slice(0, 120));
  assert.doesNotMatch(html, /class="sub|Detectors/);
  // Group heads in source case (demo.css uppercases them): Guard, Recording.
  const heads = [...html.matchAll(/<li class="hint">([^<]*)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Guard', 'Recording']);
  // The panel in order: the detector lamps, Guard and its lamp, Recording
  // and its two lamps.
  const items = [...html.matchAll(/<li (?:data-key="([^"]+)"|class="hint">([^<]*))/g)].map((m) => m[1] || m[2]);
  assert.deepEqual(items, RAIL_GROUPS.detectors.map((r) => r.key)
    .concat(['Guard', 'guardViolations', 'Recording', 'mousePaths', 'replay']));
});
test('rail has three tab-away bins', () => {
  const keys = RAIL_GROUPS.detectors.map(d => d.key);
  for (const k of ['tabAwayFlicker', 'tabAwayMid', 'tabAwayLong']) assert.ok(keys.includes(k), k);
});
test('exports the engine consumes exist', () => {
  assert.ok(Array.isArray(REPLICATE.sections) && REPLICATE.sections.length >= 3);
});
test('the last step offers five files in two batches: the session built here, the examples the site serves', () => {
  assert.deepEqual(DOWNLOAD_BATCHES.map((b) => b.files.map((f) => f.key || f.href)),
    [['sessionData', 'replay', 'config'], ['assets/example-1.json', 'assets/example-2.json']]);
  for (const b of DOWNLOAD_BATCHES) {
    assert.ok(b.heading);
    for (const f of b.files) assert.ok(f.label && f.filename && f.description, f.filename);
  }
  assert.ok(HANDOFF.buttonLabel && HANDOFF.buttonHint && HANDOFF.failed && HANDOFF.leaveHint);
  assert.ok(SAVE_TO_FOLDER.buttonLabel && SAVE_TO_FOLDER.hint && SAVE_TO_FOLDER.failed);
});
test('the hand-off assets are exactly the faces demo.css declares', () => {
  const css = fs.readFileSync(new URL('../../demo/demo.css', import.meta.url), 'utf8');
  const declared = [...css.matchAll(/src:url\('([^']+\.woff2)'\)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual([...HANDOFF_ASSETS].sort(), declared);
  assert.strictEqual(declared.length, 6);
});
test('the walkthrough saves through the folder button or one file per click, not a per-batch "Save all"', () => {
  const text = REPLICATE.sections[0].text;
  assert.doesNotMatch(text, /"Save all"/);
  assert.ok(text.includes('one download per click'), text);
});
// Chrome's folder picker refuses the home folder and folders it treats as
// system folders ("contains system files"): both texts name a folder it accepts.
test('the folder hint and the walkthrough name a folder the browser accepts', () => {
  assert.equal(SAVE_TO_FOLDER.hint, 'Chrome and Edge: pick or create an empty folder (inside Downloads, for example); ' +
    'the browser refuses your home folder and system folders.');
  const text = REPLICATE.sections[0].text;
  assert.ok(text.startsWith('Use "Save all into a folder" above (Chrome and Edge; pick or create an empty folder, ' +
    'inside Downloads for example, since the browser refuses your home folder and system folders), or the Save button ' +
    'of each file: browsers allow one download per click, so each file has its own. If a session file is blocked'), text);
});
