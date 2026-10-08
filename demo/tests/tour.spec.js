// demo/tests/tour.spec.js
// Playwright E2E suite for the live demo tour (10 steps; the hand-off to
// the analyzer and the visitor's replay there are in handoff.spec.js).
// Runs against the ASSEMBLED site (.demo-site/, see playwright.config.js +
// tools/assemble-demo-site.mjs) so demo/index.html's ./dist/... relative
// paths resolve the same way they do on Pages.
//
// Every test asserts zero accumulated pageerrors via the auto `pageErrors`
// fixture (helpers.mjs). frozenClock/fullscreenMock are also auto-fixtures,
// inert until a test explicitly calls into them.
//
// Two behaviors below were established by DRIVING THE LIVE PAGE,
// not by reading the copy alone — see the inline comments at each site:
//   1. A synthetic 'blur' Event does NOT trigger a GuardFriction violation
//      (its check() reads real document.hasFocus(), unaffected by a
//      synthetic dispatch) — the guard-cheat test uses fullscreenMock.exit()
//      instead, the same mechanism the guard entry race already relies on.
//   2. GuardFriction's violation overlay (#guard-friction-overlay) is a
//      full-viewport curtain at int-max z-index that pointer-intercepts
//      everything beneath it — which originally trapped the in-card
//      .endguard button behind the overlay's resume flow. The demo now
//      counters this (spec §6 step 9's no-trap guarantee) by lifting the
//      button above the overlay while a violation is active (demo.js's
//      floatEndGuard). The happy path clicks .endguard DURING the active
//      violation — no resume first — and a dedicated test covers the
//      resume-then-click route (including that the unfloat restore doesn't
//      double-fire the advance).

import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  test, expect,
  dispatchPaste, dispatchCopy, dispatchDevToolsShortcut, typeRealistically,
  startTour, waitForLamp, fastForwardToFiles, walkToGuardEntry,
  installFailingFullscreenMock,
  primaryButton, backButton, railRow, pid,
} from './helpers.mjs';
import { VERSION } from '../../src/shared/constants.js';
import { HANDOFF, SAVE_TO_FOLDER, STEPS } from '../steps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_PATH = resolve(__dirname, '..', '..', 'bin', 'cyborg-hunter.js');

// Step 3's text to copy: an assistant's answer to "How is your day today?".
const ANSWER = 'Great question! 😊 Honestly? My day has been a rich tapestry of moments — both big and small — ' +
  'that have reminded me what it truly means to be human. It\'s not just a day — it\'s a journey.';
// The record cuts a pasted text at 28 characters (demo.js paneRow), so its
// rows carry only the answer's first words.
const ANSWER_START = 'Great question!';
const AUTOTYPE_TEXT = 'No one is typing this. It is being inserted.';

// ---------------------------------------------------------------------------
// 1. Happy path: all 10 steps in order
// ---------------------------------------------------------------------------
test('happy path: all 10 steps, welcome through your files', async ({ page, frozenClock, fullscreenMock }) => {
  test.setTimeout(90000);

  // ----- Step 1: intro -----
  await startTour(page); // lands on step 2 (baseline)
  // The lamps panel is the title and the lamps: no intro line or note under
  // the title, and the only group heads are Guard and Recording.
  await expect(page.locator('#rail h3')).toHaveText('Tracked signals');
  await expect(page.locator('#rail .sub')).toHaveCount(0);
  await expect(page.locator('#rail')).not.toContainText(/detectors/i);
  await expect(page.locator('#rail .check li:not([data-key])')).toHaveText(['Guard', 'Recording']);

  // ----- Step 2: baseline typing (real per-char typing lights nothing) -----
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 2 of 10');
  await expect(page.locator('#rail .check')).toHaveClass(/awaiting/); // still inert
  await typeRealistically(page.locator('#card textarea'), 'a city in Australia');
  await expect(page.locator('#rail .check')).toHaveClass(/awaiting/); // still inert after typing
  await primaryButton(page).click();

  // ----- Step 3: clipboard cheat (copy the question, paste the answer x2) -----
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 3 of 10');
  await expect(page.locator('#card .task .question')).toHaveText('How is your day today?');
  // The text to copy is a bordered block of its own between the step's text
  // and the task panel (outside the grey panel), its hint on a line under it.
  const offered = page.locator('#card .answerchip code');
  await expect(offered).toHaveText(ANSWER);
  await expect(page.locator('#card .task .answerchip')).toHaveCount(0);
  await expect(page.locator('#card > .stepcopy + .answerchip + .task')).toHaveCount(1);
  const hint = page.locator('#card .answerchip .hint');
  await expect(hint).toHaveText('copy this, then paste it below');
  const offeredBox = await offered.boundingBox();
  expect((await hint.boundingBox()).y).toBeGreaterThanOrEqual(offeredBox.y + offeredBox.height);
  // Every step after the first offers the one link back, "Go back"; the
  // record under the card has no caption.
  await expect(backButton(page)).toHaveText('Go back');
  await expect(page.locator('[data-role="live-pane"] .lp-caption')).toHaveCount(0);
  const offeredText = await offered.textContent();
  await dispatchCopy(page);
  await dispatchPaste(page, '#card textarea', offeredText);
  await expect(railRow(page, 'paste')).toHaveClass(/lit/);
  await expect(railRow(page, 'paste')).not.toHaveClass(/hardlit/); // 1st paste: below the hard threshold (2)
  await dispatchPaste(page, '#card textarea', offeredText);
  await expect(railRow(page, 'paste')).toHaveClass(/hardlit/); // 2nd paste crosses it
  await expect(railRow(page, 'paste').locator('.n')).toHaveText('2');
  // Only the paste that CROSSES the hard threshold is flagged hard in the
  // live pane (verified live: the 1st paste's row has no .hard class, since
  // its own count (1) is below the threshold at the moment it's logged) —
  // both paste rows carry the pasted text regardless.
  const pasteRows = page.locator('.lp-row', { has: page.locator('.lp-event', { hasText: 'paste' }) });
  await expect(pasteRows).toHaveCount(2);
  await expect(pasteRows.nth(0)).toContainText(ANSWER_START);
  await expect(pasteRows.nth(1)).toContainText(ANSWER_START);
  await expect(page.locator('.lp-row.hard')).toHaveCount(1);
  await expect(page.locator('.lp-row.hard')).toContainText(ANSWER_START);
  await primaryButton(page).click();

  // ----- Step 4: tab-away, three bins (frozen clock for exact durations), then a sidebar -----
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 4 of 10');
  // The step's text is its whole task: three paragraphs, no task panel, and
  // the button reads "Done".
  await expect(page.locator('#card .stepcopy p')).toHaveCount(3);
  await expect(page.locator('#card .task')).toHaveCount(0);
  await expect(primaryButton(page)).toHaveText('Done');
  // No panel, but the step's trial is open: the record holds its row.
  await expect(page.locator('.lp-row[data-trial="tabaway"]').first()).toBeAttached();
  await frozenClock.tabAway(0, 2000);      // flicker: <=3000ms
  await frozenClock.tabAway(20000, 6000);  // mid: >3000ms, <10000ms
  await frozenClock.tabAway(40000, 12000); // long: >=10000ms
  // Freezing performance.now() never unfreezes itself — harmless for every
  // earlier step, but step 5 below needs REAL elapsed time between edit
  // timestamps for computeTypingSpeed() to see a nonzero span.
  await frozenClock.unfreeze();
  await expect(railRow(page, 'tabAwayFlicker')).toHaveClass(/lit/);
  await expect(railRow(page, 'tabAwayMid')).toHaveClass(/lit/);
  await expect(railRow(page, 'tabAwayLong')).toHaveClass(/lit/);
  // A sidebar opening narrows the page: dropping the width by 580px (over
  // the 100px sidebar gap) lights the sidebar lamp at the monitor's next
  // 2s check and the viewport lamp at the demo's 5s poll (no onSignal event).
  await expect(railRow(page, 'sidebar')).not.toHaveClass(/lit/);
  await page.setViewportSize({ width: 700, height: 900 });
  await waitForLamp(page, 'sidebar', { timeout: 7000 });
  await waitForLamp(page, 'viewport', { timeout: 7000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await primaryButton(page).click();

  // ----- Step 5: autotype (real synthetic insertion, no keydown behind it) -----
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 5 of 10');
  const autotypeButton = page.locator('[data-role="autotype-button"]');
  await autotypeButton.click();
  await expect(autotypeButton).toBeDisabled();
  await expect(railRow(page, 'syntheticInsertion')).toHaveClass(/lit/);
  await expect(railRow(page, 'syntheticInsertion')).toHaveClass(/hardlit/);
  await expect(autotypeButton).toHaveText('Typed ✓', { timeout: 5000 });
  await expect(page.locator('[data-role="autotype-field"]')).toHaveValue(AUTOTYPE_TEXT);
  await primaryButton(page).click();

  // ----- Step 6: guard entry (library's own entry screen, verbatim) -----
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 6 of 10');
  await expect(page.locator('.entrybox')).toContainText('Fullscreen mode required');
  await page.locator('[data-action="enter-fullscreen"]').click();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 7 of 10');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'act2');

  // ----- Step 7: guard-cheat. A bare synthetic 'blur' dispatch does NOT
  // trigger a violation (verified live: GuardFriction's check() reads real
  // document.hasFocus(), unaffected by a synthetic event) — the fullscreen
  // mock's exit() (the Esc-exit path) is the proven, working mechanism. -----
  await fullscreenMock.exit();
  await expect(page.locator('[data-role="violation-chips"] .chip')).toContainText('not_fullscreen × 1');
  await expect(railRow(page, 'guardViolations')).toHaveClass(/hardlit/);
  await expect(page.locator('#guard-friction-overlay')).toHaveCSS('display', 'flex');
  // No-trap guarantee (spec §6 step 9): while the violation overlay is up,
  // the End button is lifted above it (.floating — reparented to <body>
  // after the overlay at equal z-index; demo.js floatEndGuard). It must be
  // visible, enabled, AND actually clickable with NO resume first — a
  // visitor who refuses to re-enter fullscreen can still end the act.
  const endGuard = page.locator('.endguard');
  await expect(endGuard).toBeVisible();
  await expect(endGuard).toBeEnabled();
  await expect(endGuard).toHaveClass(/floating/);
  await endGuard.click(); // straight through the curtain — the no-trap click
  // finalizeGuard's stop() ended the violation cleanly: overlay hidden, and
  // the violation record (asserted on the downloaded file at step 10)
  // carries both its start AND its end.
  await expect(page.locator('#guard-friction-overlay')).toHaveCSS('display', 'none');

  // ----- Step 8: the record is under the card here as on every step
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 8 of 10');
  const paneInSlot = page.locator('[data-role="pane-slot"] [data-role="live-pane"]');
  await expect(paneInSlot).toHaveCount(1);
  await expect(page.locator('.instrument [data-role="live-pane"]')).toHaveCount(0);
  await expect(page.locator('[data-role="live-pane"]')).not.toHaveClass(/promoted/);
  // A signal dispatched on a step with no trial open still appends a live
  // row. A session-scoped signal (keyboard shortcut), not copy/paste — those
  // are trial-scoped and this step has task: null, no trial open to catch
  // them.
  const rowCountBeforeSignal = await page.locator('.lp-row').count();
  await dispatchDevToolsShortcut(page);
  await expect(page.locator('.lp-row')).toHaveCount(rowCountBeforeSignal + 1);
  await primaryButton(page).click();

  // ----- Step 9: signals to scores (first tier vocabulary appears here) -----
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 9 of 10');
  // The record stays under the card on leaving step 8.
  await expect(paneInSlot).toHaveCount(1);
  await expect(page.locator('.stepcopy')).toContainText('HARD');
  await primaryButton(page).click();

  // ----- Step 10: your files (the hand-off to the analyzer: handoff.spec.js) -----
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 10 of 10');
  await expect(page.locator('#card h2')).toHaveText('Your files');
  const participantId = await pid(page);
  expect(participantId).toMatch(/^DEMO-[a-z0-9]{4}$/);
  await expect(page.locator('[data-action="open-analyzer"]')).toBeVisible();
  await expect(page.locator('.replicate')).toContainText('npx cyborg-hunter@' + VERSION);

  // Both batches: the session's three files from their Save buttons, the
  // two examples from their links.
  const tmpDir = mkdtempSync(join(tmpdir(), 'ch-demo-e2e-'));
  const saves = ['sessionData', 'replay', 'config'].map((key) => `[data-action="download"][data-key="${key}"]`)
    .concat(['example-1.json', 'example-2.json'].map((name) => `a[download="${name}"]`));
  for (const selector of saves) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(selector).click(),
    ]);
    await download.saveAs(join(tmpDir, download.suggestedFilename()));
  }

  // Violations list intact in the record despite the mid-violation end:
  // GuardFriction.stop() closed the open violation, so the downloaded
  // session data carries both phases of the not_fullscreen violation.
  const sessionData = JSON.parse(readFileSync(join(tmpDir, `${participantId}.json`), 'utf8'));
  const violationPhases = (sessionData.guardFriction && sessionData.guardFriction.violations || [])
    .map((v) => `${v.phase}:${v.reason}`);
  expect(violationPhases).toContain('start:not_fullscreen');
  expect(violationPhases).toContain('end:not_fullscreen');

  const stdout = execSync(`node ${JSON.stringify(BIN_PATH)} report`, { cwd: tmpDir, encoding: 'utf8' });
  const reportIndex = join(tmpDir, 'cyborg-hunter-report', 'index.html');
  expect(existsSync(reportIndex)).toBe(true);
  const reportHtml = readFileSync(reportIndex, 'utf8');
  expect(reportHtml).toContain(participantId);
  expect(reportHtml).toContain('example-1');
  expect(reportHtml).toContain('example-2');
  expect(stdout).not.toContain('files had warnings');
  expect(stdout).toContain('Found 3 participants');
});

// ---------------------------------------------------------------------------
// Top bar and step label: the bar holds the title and, once the session
// records, the REC cue right after it. The step count is on the card, and
// it names no act (the act stays on body[data-view], for the CSS).
// ---------------------------------------------------------------------------
test('top bar: the title, then the REC cue; the card label says the step only', async ({ page }) => {
  await page.goto('/');
  await page.locator('#card h2').waitFor();
  const bar = page.locator('.topbar');
  await expect(bar.locator('.brand')).toHaveText('cyborg-hunter · live demo');
  await expect(page.locator('#pid, #progress')).toHaveCount(0);
  await expect(page.locator('#rec')).toBeHidden();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 1 of 10');

  await page.getByRole('button', { name: 'Start the demo', exact: true }).click(); // -> baseline (step 2)
  await expect(page.locator('#rec')).toBeVisible();
  await expect(page.locator('#rec')).toHaveText('REC replay');
  expect(await bar.evaluate((el) => Array.from(el.children, (c) => c.className))).toEqual(['brand', 'rec']);
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 2 of 10');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'act1');
});

// ---------------------------------------------------------------------------
// The first step: two paragraphs that name no act, then one button, "Start
// the demo", larger than the tour's other buttons and centred 28px under the
// text. The size and the centring are the first step's only.
// ---------------------------------------------------------------------------
test('first step: two paragraphs, then a large "Start the demo" centred under them', async ({ page }) => {
  await page.goto('/');
  await page.locator('#card h2').waitFor();
  const paragraphs = page.locator('#card .stepcopy p');
  await expect(paragraphs).toHaveCount(2);
  await expect(page.locator('#card')).not.toContainText(/\bAct\b/);
  await expect(page.locator('#card button')).toHaveCount(1);

  const start = page.getByRole('button', { name: 'Start the demo', exact: true });
  await expect(start).toHaveCSS('font-size', '17px');
  await expect(start).toHaveCSS('padding', '14px 28px');
  const text = await page.locator('#card .stepcopy').boundingBox();
  const last = await paragraphs.last().boundingBox();
  const button = await start.boundingBox();
  expect(Math.abs((button.x + button.width / 2) - (text.x + text.width / 2))).toBeLessThan(1);
  expect(Math.round(button.y - (last.y + last.height))).toBe(28);

  await start.click(); // -> baseline (step 2): the tour's own button again
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 2 of 10');
  await expect(primaryButton(page)).toHaveCSS('font-size', '15px');
  await expect(primaryButton(page)).toHaveCSS('padding', '10px 22px');
});

// ---------------------------------------------------------------------------
// The second step asks its question in one paragraph and a panel: the
// question and a box, with no code under it. From there to the files, no
// task panel carries a label and no step offers a link ahead of the tour
// (Back is the only link). The files step's panel is built apart from the
// others (renderDownloadsPanel), so the walk goes all the way.
// ---------------------------------------------------------------------------
test('second step: the question and a box, no code; no step has a task label or a link ahead', async ({ page }) => {
  const stepLabel = page.locator('[data-role="step-label"]');
  async function noLabelNoLinkAhead() {
    await expect(page.locator('#card .task .label')).toHaveCount(0);
    await expect(page.locator('#card a.skip:not([data-action="back"])')).toHaveCount(0);
  }

  await startTour(page); // -> baseline (step 2)
  await expect(page.locator('#card .stepcopy p')).toHaveCount(1);
  await expect(page.locator('#card .task .question')).toHaveText('How is your day today?');
  await expect(page.locator('#card .task textarea')).toHaveCount(1);
  await expect(page.locator('#card .code-tab, #card [data-role="code-pane"], #card pre')).toHaveCount(0);

  // Steps 2 to 6 with the primary button alone (as walkToGuardEntry, with
  // the checks at each step), then the guard's own buttons, then the
  // primary again. A missing entry box fails on the step label below.
  const enter = page.locator('[data-action="enter-fullscreen"]');
  const entryStep = STEPS.findIndex((s) => s.id === 'guard-entry') + 1;
  for (let clicks = 0;
    clicks < STEPS.length && await enter.count() === 0 && await primaryButton(page).count() > 0;
    clicks++) {
    await noLabelNoLinkAhead();
    await primaryButton(page).click();
  }
  await expect(stepLabel).toHaveText('Step ' + entryStep + ' of ' + STEPS.length);
  await noLabelNoLinkAhead(); // step 6, the guard's entry
  await enter.click();
  await expect(stepLabel).toHaveText('Step 7 of 10', { timeout: 5000 });
  await noLabelNoLinkAhead();
  await page.locator('.endguard').click(); // -> step 8
  await noLabelNoLinkAhead();
  await primaryButton(page).click(); // -> step 9
  await noLabelNoLinkAhead();
  await primaryButton(page).click(); // -> step 10, your files
  await expect(stepLabel).toHaveText('Step 10 of 10');
  await expect(page.locator('#card .task')).toHaveCount(1);
  await noLabelNoLinkAhead();
});

// ---------------------------------------------------------------------------
// Guard-cheat, resume-then-click route: the classic path (re-enter
// fullscreen via the overlay's own resume button, THEN end the act) must
// also keep working after the no-trap float/unfloat mechanics.
// ---------------------------------------------------------------------------
test('guard-cheat resume route: button unfloats after resume and advances exactly one step', async ({ page, fullscreenMock }) => {
  await startTour(page); // -> baseline
  await walkToGuardEntry(page); // -> guard-entry
  await page.locator('[data-action="enter-fullscreen"]').click();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 7 of 10', { timeout: 5000 });

  await fullscreenMock.exit(); // violation starts -> button floats above the overlay
  await expect(page.locator('.endguard')).toHaveClass(/floating/);
  await page.locator('#guard-friction-resume').click(); // re-enter fullscreen -> violation ends
  await expect(page.locator('#guard-friction-overlay')).toHaveCSS('display', 'none');

  // The button unfloated back into its in-card spot...
  await expect(page.locator('#card .endguard')).toBeVisible();
  await expect(page.locator('.endguard')).not.toHaveClass(/floating/);
  // ...and clicking it advances EXACTLY one step. Landing on step 9 here
  // would mean the float-time direct listener survived the unfloat and
  // double-fired the advance alongside the card's delegated handler.
  await page.locator('.endguard').click();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 8 of 10');
});

// ---------------------------------------------------------------------------
// The record's place under the card, the OTHER leave direction: the
// happy-path test above covers forward (8 -> 9); Back (8 -> 7) must leave
// the record under the card too, in the main column, never in the
// instrument column.
// ---------------------------------------------------------------------------
test('step 8: the record stays under the card on Back to step 7', async ({ page }) => {
  await startTour(page); // -> baseline
  await walkToGuardEntry(page); // -> guard-entry
  await page.locator('[data-action="enter-fullscreen"]').click();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 7 of 10', { timeout: 5000 });
  await page.locator('.endguard').click(); // -> guard-debrief (step 8)
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 8 of 10');
  await expect(page.locator('[data-role="pane-slot"] [data-role="live-pane"]')).toHaveCount(1);

  await backButton(page).click(); // -> guard-cheat (step 7)
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 7 of 10');
  const paneInSlot = page.locator('[data-role="pane-slot"] [data-role="live-pane"]');
  await expect(paneInSlot).toHaveCount(1);
  await expect(page.locator('.instrument [data-role="live-pane"]')).toHaveCount(0);
  await expect(page.locator('[data-role="live-pane"]')).not.toHaveClass(/promoted/);
});

// ---------------------------------------------------------------------------
// 10. Fullscreen exit: the files step leaves fullscreen through the
// plugin's own exitFullscreen(), on the way into "Your files" — no Esc
// press, no fullscreenMock.exit() call, anywhere in this test. The visitor
// is fullscreen through the whole guarded act (step 7) and no longer
// fullscreen once the files step shows. Downloading the session file there
// and checking guardFriction.violations pins the ORDERING the same way the
// happy-path test pins violation phases above (exitFullscreenIfActive()
// runs AFTER finalizeGuard(), demo.js's goTo()): a visitor who never left
// fullscreen themselves must see an EMPTY violations list — any entry there
// would mean the demo's own exit ran while the guard was still armed and
// logged a false violation against the participant.
// ---------------------------------------------------------------------------
test('the files step leaves fullscreen via the plugin, with no false violation left behind', async ({ page }) => {
  test.setTimeout(60000);
  await startTour(page); // -> baseline
  await walkToGuardEntry(page); // -> guard-entry (step 6)
  await page.locator('[data-action="enter-fullscreen"]').click();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 7 of 10', { timeout: 5000 });
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);

  await page.locator('.endguard').click(); // -> guard-debrief (step 8), violation-free
  await primaryButton(page).click(); // -> signals-to-scores (step 9)
  await primaryButton(page).click(); // -> your files (step 10)
  await expect(page.locator('#card h2')).toHaveText('Your files');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);

  const participantId = await pid(page);
  const tmpDir = mkdtempSync(join(tmpdir(), 'ch-demo-e2e-exit-fs-'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-action="download"][data-key="sessionData"]').click(),
  ]);
  await download.saveAs(join(tmpDir, download.suggestedFilename()));
  const sessionData = JSON.parse(readFileSync(join(tmpDir, `${participantId}.json`), 'utf8'));
  expect((sessionData.guardFriction && sessionData.guardFriction.violations) || []).toEqual([]);
});

// ---------------------------------------------------------------------------
// 10b. The files step's cards name each file as it is saved (the session
// files carry the visitor's id). Where the browser has a folder picker
// (Chrome, Edge), one "Save all into a folder" writes all five files into
// the folder the visitor picks; the picker is stubbed here, since a test
// cannot answer the browser's own dialog. A dismissed picker changes nothing;
// a folder that cannot be written says so. Without the picker, only the
// per-file Save buttons are offered (the happy path above saves through each
// of them).
// ---------------------------------------------------------------------------
test('files step: "Save all into a folder" writes the five files through the folder picker', async ({ page }) => {
  await page.addInitScript(() => {
    window.__written = [];
    window.showDirectoryPicker = async (opts) => {
      window.__pickerOpts = opts;
      return {
        name: 'demo-files',
        getFileHandle: async (name, o) => ({
          createWritable: async () => {
            let entry = null;
            return {
              write: async (blob) => {
                entry = { name, size: blob.size, create: !!(o && o.create), closed: false };
                window.__written.push(entry);
              },
              close: async () => { entry.closed = true; },
            };
          },
        }),
      };
    };
  });
  await fastForwardToFiles(page);
  const participantId = await pid(page);
  const cardNames = await page.locator('.file small').allTextContents();
  expect(cardNames[0]).toMatch(/^DEMO-[a-z0-9]{4}\.json$/);
  expect(cardNames[1]).toMatch(new RegExp('^' + participantId + '-replay-\\d+\\.json$'));
  expect(cardNames.slice(2)).toEqual(['cyborg-hunter.config.json', 'example-1.json', 'example-2.json']);

  await expect(page.locator('[data-action="save-all"]')).toHaveCount(0);
  const btn = page.locator('[data-action="save-folder"]');
  await btn.click();
  await expect(btn).toHaveText(/Saved 5 files to demo-files/);
  await expect(btn).toBeDisabled();
  // Written in the order the cards list them (batch order), each one closed.
  const written = await page.evaluate(() => window.__written);
  expect(written.map((w) => w.name)).toEqual(cardNames);
  expect(written.every((w) => w.size > 0 && w.create)).toBe(true);
  expect(written.filter((w) => w.closed)).toHaveLength(5);
  expect(await page.evaluate(() => window.__pickerOpts))
    .toEqual({ mode: 'readwrite', id: 'cyborg-hunter-demo', startIn: 'downloads' });
});

test('files step: a dismissed folder picker changes nothing', async ({ page }) => {
  await page.addInitScript(() => {
    window.__pickerCalls = 0;
    window.showDirectoryPicker = async () => {
      window.__pickerCalls++;
      throw new DOMException('', 'AbortError');
    };
  });
  await fastForwardToFiles(page);
  const btn = page.locator('[data-action="save-folder"]');
  const label = await btn.textContent();
  await btn.click();
  await expect.poll(() => page.evaluate(() => window.__pickerCalls)).toBe(1);
  await expect(btn).toBeEnabled();
  await expect(btn).toHaveText(label);
  await expect(page.locator('[data-role="handoff-note"]')).toBeHidden();
});

test('files step: a folder that cannot be written says so and leaves the button usable', async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => ({
      name: 'demo-files',
      getFileHandle: async () => { throw new Error('mock: the folder refuses new files'); },
    });
  });
  await fastForwardToFiles(page);
  const btn = page.locator('[data-action="save-folder"]');
  const label = await btn.textContent();
  await btn.click();
  const note = page.locator('[data-role="handoff-note"]');
  await expect(note).toBeVisible();
  await expect(note).toHaveText(SAVE_TO_FOLDER.failed);
  await expect(btn).toBeEnabled();
  await expect(btn).toHaveText(label);
});

// A write that fails part-way aborts its file (the browser then discards
// its temporary copy instead of leaving it in the folder), and a later save
// that succeeds takes the failure line away again.
test('files step: a failed write aborts its file; a later save clears the failure line', async ({ page }) => {
  await page.addInitScript(() => {
    window.__aborted = [];
    let failNextWrite = true;
    window.showDirectoryPicker = async () => ({
      name: 'demo-files',
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async () => {
            if (failNextWrite) { failNextWrite = false; throw new Error('mock: the disk is full'); }
          },
          close: async () => {},
          abort: async () => { window.__aborted.push(name); },
        }),
      }),
    });
  });
  await fastForwardToFiles(page);
  const firstCard = await page.locator('.file small').first().textContent();
  const btn = page.locator('[data-action="save-folder"]');
  const note = page.locator('[data-role="handoff-note"]');
  await btn.click();
  await expect(note).toHaveText(SAVE_TO_FOLDER.failed);
  expect(await page.evaluate(() => window.__aborted)).toEqual([firstCard]);

  await btn.click();
  await expect(btn).toHaveText(/Saved 5 files to demo-files/);
  await expect(note).toBeHidden();
});

// The note line is shared with the hand-off: a folder save that succeeds
// takes away only its own failure line, never the hand-off's.
test('files step: a folder save that succeeds leaves the hand-off\'s failure line on screen', async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => ({
      name: 'demo-files',
      getFileHandle: async () => ({
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      }),
    });
  });
  await fastForwardToFiles(page);
  await page.evaluate(() => { indexedDB.open = () => { throw new Error('refused by the test'); }; });
  await page.locator('[data-action="open-analyzer"]').click();
  const note = page.locator('[data-role="handoff-note"]');
  const handoffFailed = HANDOFF.failed.replace(/<[^>]+>/g, '');   // the note's text, without its link
  await expect(note).toHaveText(handoffFailed);

  const btn = page.locator('[data-action="save-folder"]');
  await btn.click();
  await expect(btn).toHaveText(/Saved 5 files to demo-files/);
  await expect(note).toBeVisible();
  await expect(note).toHaveText(handoffFailed);
});

test('files step: without the folder picker only the per-file Save buttons are offered', async ({ page }) => {
  await page.addInitScript(() => { delete window.showDirectoryPicker; });
  await fastForwardToFiles(page);
  await expect(page.locator('[data-action="save-folder"]')).toHaveCount(0);
  await expect(page.locator('[data-action="download"]')).toHaveCount(3);
  await expect(page.locator('.file-actions a[download]')).toHaveCount(2);
  await expect(page.locator('[data-role="leave-hint"]')).toHaveText(HANDOFF.leaveHint);
  // The config caveat, once, right after the first batch's grid.
  await expect(page.locator('[data-role="config-caveat"]')).toHaveCount(1);
  await expect(page.locator('.files + .file-caveat')).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector('.files').nextElementSibling.getAttribute('data-role')))
    .toBe('config-caveat');
});

// ---------------------------------------------------------------------------
// 2. Live pane: row count grows across acts; raw-JSON tab shows the payload
// ---------------------------------------------------------------------------
test('live pane: row count strictly grows across acts; raw-JSON tab shows participantId', async ({ page, frozenClock }) => {
  const rowCount = () => page.locator('.lp-row').count();

  await startTour(page); // -> baseline (step 2); trial_start for baseline
  const c0 = await rowCount();

  await primaryButton(page).click(); // -> clipboard-cheat: trial_end + trial_start
  await dispatchCopy(page);
  await dispatchPaste(page, '#card textarea', ANSWER);
  await dispatchPaste(page, '#card textarea', ANSWER);
  const c1 = await rowCount();
  expect(c1).toBeGreaterThan(c0);

  await primaryButton(page).click(); // -> tab-away
  await frozenClock.tabAway(0, 2000);
  await frozenClock.tabAway(20000, 6000);
  await frozenClock.tabAway(40000, 12000);
  await frozenClock.unfreeze();
  const c2 = await rowCount();
  expect(c2).toBeGreaterThan(c1);

  await primaryButton(page).click(); // -> autotype
  await page.locator('[data-role="autotype-button"]').click();
  await expect(page.locator('[data-role="autotype-button"]')).toHaveText('Typed ✓', { timeout: 5000 });
  const c3 = await rowCount();
  expect(c3).toBeGreaterThan(c2);

  // Raw-JSON tab: the literal payload the pid.json download carries.
  await page.locator('.lp-tab[data-tab="json"]').click();
  // The rail is hidden on this view and the grid collapses to one column,
  // so the JSON takes the record's full width, not the rail's 156px track.
  const bodyBox = await page.locator('.lp-body').boundingBox();
  const jsonBox = await page.locator('[data-role="lp-json"]').boundingBox();
  expect(jsonBox.width).toBeGreaterThanOrEqual(bodyBox.width * 0.9);
  const jsonText = await page.locator('[data-role="lp-json"]').textContent();
  expect(jsonText).toContain('"participantId"');
  expect(() => JSON.parse(jsonText)).not.toThrow();
});

// ---------------------------------------------------------------------------
// XSS paste: a pasted <script> string renders escaped, never executes
// ---------------------------------------------------------------------------
test('XSS paste: a hostile <script> string is escaped in the live pane, never executed', async ({ page }) => {
  let dialogFired = false;
  page.on('dialog', async (d) => { dialogFired = true; await d.dismiss(); });

  await startTour(page); // -> baseline
  await primaryButton(page).click(); // -> clipboard-cheat
  const hostile = '<script>alert(1)</script>';
  await dispatchPaste(page, '#card textarea', hostile);

  const streamHtml = await page.locator('.lp-stream').innerHTML();
  expect(streamHtml).not.toContain('<script>alert');
  expect(streamHtml).toContain('&lt;script&gt;');
  expect(dialogFired).toBe(false);
});

// ---------------------------------------------------------------------------
// 4. Step 9's live score: the library's own soft score for the visitor's
// session so far, under the standard weights, and a note on the analyzer's
// settings panel.
// ---------------------------------------------------------------------------
test('step 9 shows the library\'s own soft score from the session so far', async ({ page }) => {
  test.setTimeout(60000);
  await startTour(page); // -> baseline
  await typeRealistically(page.locator('#card textarea'), 'a city in Australia');
  await primaryButton(page).click(); // -> clipboard-cheat
  await dispatchCopy(page); // 1 copy event
  await dispatchPaste(page, '#card textarea', ANSWER); // 1 paste — below the hard threshold (2), stays out of HARD
  await walkToGuardEntry(page); // -> guard-entry
  await page.locator('[data-action="enter-fullscreen"]').click();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 7 of 10', { timeout: 5000 });
  await page.locator('.endguard').click(); // -> guard-debrief
  await primaryButton(page).click(); // -> signals-to-scores (step 9)
  // No inputs: the score is the library's own, with the standard weights
  // (one copy hit × weight 2 = 2, under the threshold of 6).
  await expect(page.locator('[data-weight-key]')).toHaveCount(0);
  const liveScore = page.locator('[data-role="live-score"]');
  await expect(liveScore).toHaveText(/^Your soft score so far, with the standard weights: 2 \(flags at 6 or above\)\.$/, { timeout: 5000 });
  await expect(page.locator('[data-role="scoring-panel"]')).toContainText('settings panel');
});

// ---------------------------------------------------------------------------
// 5. Zero-lamp path: do no task; the files step still offers the files
// ---------------------------------------------------------------------------
test('zero-lamp path: walk past every task, then the guard skip -> the files step', async ({ page }) => {
  await installFailingFullscreenMock(page); // forces the guard-entry fallback (no other skip route out of act 2)
  await startTour(page); // -> baseline
  await walkToGuardEntry(page); // -> guard-entry
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 6 of 10'); // sanity: really at the guard's entry
  await page.locator('[data-action="enter-fullscreen"]').click();
  await expect(page.locator('.fallback-note')).toBeVisible({ timeout: 3000 });

  const skipLink = page.locator('a[data-key="skipToScores"]');
  await expect(skipLink).toBeVisible();
  await skipLink.click();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 9 of 10');
  await primaryButton(page).click(); // -> your files

  await expect(page.locator('#card h2')).toHaveText('Your files');
  await expect(page.locator('[data-action="download"][data-key="sessionData"]')).toBeEnabled();
});

// ---------------------------------------------------------------------------
// 6. Act2-skip path: forced fullscreen failure mid-tour, with real Act 1 data
// ---------------------------------------------------------------------------
test('guard-skip path: fullscreen failure falls back, skip lands on "From signals to scores"', async ({ page }) => {
  await installFailingFullscreenMock(page);
  await startTour(page); // -> baseline
  await primaryButton(page).click(); // -> clipboard-cheat
  await dispatchPaste(page, '#card textarea', ANSWER);
  await dispatchPaste(page, '#card textarea', ANSWER); // >=1 lamp lit: not the zero-lamp path

  await walkToGuardEntry(page); // -> guard-entry
  await page.locator('[data-action="enter-fullscreen"]').click();
  await expect(page.locator('.fallback-note')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.fallback-note')).toContainText("guarded act can’t run here");

  await page.locator('a[data-key="skipToScores"]').click();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 9 of 10');
  await expect(page.locator('#card h2')).toHaveText('From signals to scores');
  await expect(page.locator('.cols')).not.toHaveClass(/\bfull\b/);

  await primaryButton(page).click(); // -> your files
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 10 of 10');
  // The rail retires here, so the step takes the full width.
  await expect(page.locator('.cols')).toHaveClass(/\bfull\b/);
  await expect(page.locator('.instrument')).not.toBeVisible();

  // The rail's retirement is one-way (demo.js, lampWiringRetired): it stays
  // hidden on Back, and the full width follows it.
  await backButton(page).click(); // -> signals-to-scores
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 9 of 10');
  await expect(page.locator('#rail')).toBeHidden();
  await expect(page.locator('.cols')).toHaveClass(/\bfull\b/);
});

// ---------------------------------------------------------------------------
// 11. Live pane: per-trial tab rail. Tabs appear in
// STEPS' RUN order (TRIAL_TABS, demo.js) as each trial is actually reached,
// All is the default (identical to today's view — the earlier tests above
// that read `.lp-row` counts/text with no tab interaction stay valid
// unchanged), and the rail keeps filtering after state.pane.freeze() runs
// on entering the files step — filtering is a view concern layered on top
// of the append-only stream, not something freeze() is meant to touch.
// ---------------------------------------------------------------------------
test('live pane rail: filters by trial in run order, All is the default view, and filtering survives freeze() at the files step', async ({ page }) => {
  test.setTimeout(30000);
  await startTour(page); // -> baseline (step 2); trial_start registers its tab
  await typeRealistically(page.locator('#card textarea'), 'a city in Australia');
  await primaryButton(page).click(); // -> clipboard-cheat (step 3); registers its tab
  await dispatchPaste(page, '#card textarea', ANSWER);
  await dispatchPaste(page, '#card textarea', ANSWER);

  const rail = page.locator('[data-role="lp-trials"] .lp-trial-tab');
  // Keyed, not hasText: the labels are prose now, and hasText matches
  // substrings case-insensitively — 'All' also matches "Answer a question
  // normALLy". The label text itself is asserted wholesale below.
  const allTab = page.locator('[data-role="lp-trials"] [data-trial-key="all"]');
  const pasteTab = page.locator('[data-role="lp-trials"] [data-trial-key="paste"]');
  // Labels are each step's own heading — the name the visitor read while
  // running that trial (STEPS[i].title) — not the trialId the stream's trial
  // column prints ('paste', asserted below) and not task.kind's slug.
  // Order is RUN order (TRIAL_TABS, demo.js), not visit order; walking
  // forward, as below, the two agree.
  await expect(rail).toHaveText(['All', 'Answer a question normally', 'Now cheat with the clipboard']);
  // The heading is truthfully what step 3 showed, and the tooltip pairs it
  // with the id, the one place both names appear together.
  await expect(pasteTab).toHaveAttribute('title', 'Now cheat with the clipboard (paste)');
  await expect(page.locator('#card h2')).toHaveText('Now cheat with the clipboard'); // same string, live on the card
  await expect(allTab).toHaveAttribute('aria-pressed', 'true'); // All is the default

  const totalRows = await page.locator('.lp-row').count();
  await pasteTab.click();
  await expect(pasteTab).toHaveAttribute('aria-pressed', 'true');
  const visibleTrials = await page.locator('.lp-row:not(.lp-off)')
    .evaluateAll((rows) => rows.map((r) => r.dataset.trial));
  expect(visibleTrials.length).toBeGreaterThan(0);
  expect(visibleTrials.every((t) => t === 'paste')).toBe(true);
  // Baseline's rows are hidden, not gone — the stream is append-only, so
  // they're still in the DOM under lp-off.
  await expect(page.locator('.lp-row[data-trial="baseline"]').first()).toHaveClass(/lp-off/);

  await allTab.click();
  await expect(page.locator('.lp-row:not(.lp-off)')).toHaveCount(totalRows); // full count back

  // -> your files (step 10), walking past the remaining tasks — freeze() runs
  // on entry (goTo()'s last-step block), while addRow/setPayload stay frozen.
  await walkToGuardEntry(page); // -> guard-entry (step 6)
  await page.locator('[data-action="enter-fullscreen"]').click();
  await expect(page.locator('[data-role="step-label"]')).toHaveText('Step 7 of 10', { timeout: 5000 });
  await page.locator('.endguard').click(); // -> guard-debrief (step 8)
  await primaryButton(page).click(); // -> signals-to-scores (step 9)
  await primaryButton(page).click(); // -> your files (step 10)
  await expect(page.locator('#card h2')).toHaveText('Your files');

  const frozenTotal = await page.locator('.lp-row').count();
  await pasteTab.click(); // same rail node, just reparented — freeze must not disable it
  const frozenVisibleTrials = await page.locator('.lp-row:not(.lp-off)')
    .evaluateAll((rows) => rows.map((r) => r.dataset.trial));
  expect(frozenVisibleTrials.length).toBeGreaterThan(0);
  expect(frozenVisibleTrials.every((t) => t === 'paste')).toBe(true);
  await allTab.click();
  await expect(page.locator('.lp-row:not(.lp-off)')).toHaveCount(frozenTotal); // full count back, even frozen
});
