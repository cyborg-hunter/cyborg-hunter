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
test('the fifth step says what bots leave behind, then lets something else type', () => {
  const autotype = STEPS[4];
  assert.equal(autotype.id, 'autotype');
  assert.equal(autotype.body.replace(/\s+/g, ' '),
    '<p>Another class of cheaters cyborg-hunter can help detect is automated bots, which take the experiment ' +
    'autonomously without human intervention, aided or not by a language model for their answers. These bots ' +
    'also leave characteristic traces in the data. One of them is text insertion.</p> ' +
    '<p>Press the button and watch the field fill itself: text appearing with no keystrokes behind it. ' +
    'Automation, scripts, and agentic tools all write into a page this way, so the library flags it immediately ' +
    'as synthetic insertion. Typing speed is also computed per trial; sustained rates above {{typingSpeed.cps}} ' +
    'characters per second get their own flag when the trial closes.</p> ' +
    '<p>Dictation and some accessibility tools can produce similar patterns, a caveat the docs carry too: these ' +
    'are signals for a human reviewer to weigh, not automatic verdicts.</p>');
  assert.equal(autotype.task.kind, 'autotype');
  assert.equal(autotype.primaryLabel, 'Continue →');
});
test('the sixth step says what the guard is and names the button the entry page and the library both show', () => {
  const entry = STEPS[5];
  assert.equal(entry.id, 'guard-entry');
  assert.equal(entry.body.replace(/\s+/g, ' '),
    '<p>On top of means to track down signals, cyborg-hunter also ships with a guard that is designed to make it ' +
    'harder for participants to cheat. Under the guard, the study requires fullscreen and focus; leaving either ' +
    'scrambles the on-screen text until you return, and every violation is logged with its type and ' +
    'timestamp.</p> ' +
    '<p>Participants are prompted by a page like the one below to enter the guarded mode (the wording on the page ' +
    'can be customized). Click the button "Enter fullscreen and continue" to trigger the guard yourself.</p>');
  assert.equal(entry.task.kind, 'fullscreen-entry');
  assert.equal(entry.primaryLabel, null);
  // The button the paragraph names: the entry trial's only choice in the
  // library, and the label of the demo's copy of that page.
  const label = /Click the button "([^"]+)"/.exec(entry.body.replace(/\s+/g, ' '))[1];
  const friction = fs.readFileSync(new URL('../../src/jspsych/extension-guard-friction.js', import.meta.url), 'utf8');
  assert.deepEqual([...friction.matchAll(/choices: \['([^']+)'\]/g)].map((m) => m[1]), [label]);
  const demo = fs.readFileSync(new URL('../../demo/demo.js', import.meta.url), 'utf8');
  assert.equal(/data-action="enter-fullscreen">([^<]+)<\/button>/.exec(demo)[1], label);
});
test('the seventh step asks you to break the guard, and its button ends the guard', () => {
  const cheat = STEPS[6];
  assert.equal(cheat.id, 'guard-cheat');
  assert.equal(cheat.title, 'Try to break the guard');
  assert.equal(cheat.body.replace(/\s+/g, ' '),
    '<p>Tab away. Press Esc. Click another window. Each attempt logs a violation and scrambles the task text ' +
    'until you come back; try to read it while you\'re half-out. Pastes still go through and get recorded ' +
    'exactly as in the earlier steps: the guard leaves input alone and instead makes <em>leaving</em> costly, ' +
    'logging a violation trail each time.</p> ' +
    '<p>When you\'ve had enough, the button below ends the guard; after that, fullscreen is no longer ' +
    'required.</p>');
  assert.equal(cheat.task.kind, 'guard-cheat');
  assert.equal(cheat.primaryLabel, 'End the guard');
});
test('the eighth step says where the violations are, in one paragraph', () => {
  const debrief = STEPS[7];
  assert.equal(debrief.id, 'guard-debrief');
  assert.equal(debrief.body.replace(/\s+/g, ' '),
    '<p>The guard is off. Scroll the session record: every violation from the last step is there with a type ' +
    '(not_fullscreen, window_blurred) and a timestamp, next to the other previously recorded events.</p>');
});
test('no step, note or fallback message names an act', () => {
  // \s+, not a space: the copy wraps, and "Act" can end one line and "1"
  // start the next.
  const ACT = /\b[Aa]ct\s+[12]\b|guarded\s+act/;
  for (const s of STEPS) {
    assert.doesNotMatch([s.title, s.body, JSON.stringify(s.task || {})].join(' '), ACT, s.id);
  }
  assert.equal(STEPS[5].task.fallbackNote, 'Fullscreen didn’t engage in this browser, so the guard can’t run ' +
    'here. Skip ahead: the rest of the tour still works without it.');
  // The fallback message demo.js shows when a step has no note of its own.
  const demo = fs.readFileSync(new URL('../../demo/demo.js', import.meta.url), 'utf8');
  assert.ok(demo.includes('"Fullscreen didn\'t engage in time, so the guard can\'t run in this browser. ' +
    'Skip ahead; everything else in the tour still works."'));
  assert.doesNotMatch(demo, ACT);
});
test('trial ids name the task, not the act, and none is a key the record reserves', () => {
  // The record's trial column and its filter tabs show these ids. 'all' and
  // 'session' are the live pane's own filter keys (live-pane.js).
  const ids = STEPS.filter((s) => s.task && s.task.trialId).map((s) => s.task.trialId);
  assert.deepEqual(ids, ['baseline', 'paste', 'tabaway', 'autotype', 'guard-entry', 'guard']);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.doesNotMatch(id, /^act/, id);
    assert.ok(id !== 'all' && id !== 'session', id);
  }
});
test('the closing invitation names the one script tag, not code the tour no longer shows', () => {
  assert.equal(copy.CLOSING_CTA.installInvitation, 'One script tag is the whole integration; the quickstart shows it.');
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
// The page cannot create or name a folder, so both name the one to create.
test('the folder hint and the walkthrough name a folder the browser accepts', () => {
  assert.equal(SAVE_TO_FOLDER.hint, 'Chrome and Edge: inside Downloads, create a folder named cyborg-hunter-demo ' +
    'and pick it; the browser refuses your home folder and system folders.');
  const text = REPLICATE.sections[0].text;
  assert.ok(text.startsWith('Use "Save all into a folder" above (Chrome and Edge; inside Downloads, create a folder ' +
    'named cyborg-hunter-demo and pick it, since the browser refuses your home folder and system folders), or the ' +
    'Save button of each file: browsers allow one download per click, so each file has its own. If a session file ' +
    'is blocked'), text);
});
test('the hand-off button names the analyzer web app', () => {
  assert.equal(HANDOFF.buttonLabel, 'Open in the analyzer web app →');
});
