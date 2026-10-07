// tests/demo/steps-shape.test.js
// Structural contract the engine relies on: 11 steps, known ids in order,
// every step has eyebrow/title/body and counts itself against the total, no
// tier vocabulary before step 10, and the last step's files and
// the fonts its hand-off carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STEPS, RAIL_GROUPS, RAIL_INTRO, RAIL_INTRO_TITLE, CODE_TABS, REPLICATE, DOWNLOAD_BATCHES, HANDOFF, SAVE_TO_FOLDER, HANDOFF_ASSETS } from '../../demo/steps.js';

const IDS = ['intro','baseline','clipboard-cheat','tab-away','browser-rearrange',
  'autotype','guard-entry','guard-cheat','guard-debrief',
  'signals-to-scores','your-files'];

test('step map', () => {
  assert.equal(STEPS.length, 11);
  assert.deepEqual(STEPS.map(s => s.id), IDS);
  for (const s of STEPS) { assert.ok(s.eyebrow && s.title && s.body, s.id); }
  STEPS.forEach((s, i) => assert.ok(s.eyebrow.endsWith('Step ' + (i + 1) + ' of ' + STEPS.length), s.id + ': ' + s.eyebrow));
});
test('no tier vocabulary in steps 2-9', () => {
  // Steps 2-9 only: step 1 may NAME the product ("triage report") without narrating scores.
  const before = STEPS.slice(1, 9).map(s => [s.title, s.body, JSON.stringify(s.task || {})].join(' ')).join(' ');
  for (const word of ['HARD', 'SOFT', 'CLEAN', 'tier', 'triage', 'preset']) {
    assert.ok(!before.includes(word), `"${word}" leaked before step 10`);
  }
});
test('the rail intro is one sentence, with the full framing as its tooltip', () => {
  assert.equal(RAIL_INTRO, 'A demo instrument: a curated subset of what the library records.');
  assert.equal(typeof RAIL_INTRO_TITLE, 'string');
  assert.ok(RAIL_INTRO_TITLE.includes('Idle gaps'), RAIL_INTRO_TITLE);
});
test('rail has three tab-away bins', () => {
  const keys = RAIL_GROUPS.detectors.map(d => d.key);
  for (const k of ['tabAwayFlicker', 'tabAwayMid', 'tabAwayLong']) assert.ok(keys.includes(k), k);
});
test('exports the engine consumes exist', () => {
  assert.ok(CODE_TABS.jspsych && CODE_TABS.plainjs);
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
