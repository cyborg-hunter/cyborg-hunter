// demo/steps.js
// ALL tutorial copy as data. Numbers are {{path}} placeholders substituted
// from signal-manifest.json at runtime — never hardcode thresholds here.
// Register (spec 2026-07-31 G1): plain, dry, direct. Signals only until the
// signals-to-scores step (G2).

/** Intro positioning copy. De-slopped 2026-08-01 (verbatim lock lifted). */
export const POSITIONING =
  "Prolific's built-in Authenticity Checks give you a verdict inside one " +
  "platform. cyborg-hunter gives you the evidence: full behavioral traces, " +
  "replayable sessions, and honeypot catches, on any platform (Prolific, MTurk, " +
  "classroom, or standalone), free and inspectable. Use them together: " +
  "platform-level screening plus study-level evidence you can defend in review.";

/** Sidebar rail intro: one line, with the full framing as its tooltip. */
export const RAIL_INTRO = 'A demo instrument: a curated subset of what the library records.';
export const RAIL_INTRO_TITLE =
  'Not part of the product UI. These lamps show a curated subset of what the ' +
  'library records; the full record is in the live session record under the ' +
  'card. Idle gaps, window position, zoom, DOM mutations, and the extension ' +
  'scan also run in the background, but nothing on this page can trigger them on cue.';

export const RAIL_GROUPS = {
  detectors: [
    { key: 'paste', label: 'paste', hardSignal: true },
    { key: 'copy', label: 'copy', hardSignal: false },
    { key: 'drop', label: 'drag & drop', hardSignal: true },
    { key: 'tabAwayFlicker', label: 'tab-away <3s', hardSignal: false },
    { key: 'tabAwayMid', label: 'tab-away 3–10s', hardSignal: false },
    { key: 'tabAwayLong', label: 'tab-away ≥10s', hardSignal: false },
    { key: 'sidebar', label: 'browser sidebar', hardSignal: false },
    { key: 'viewport', label: 'viewport shift', hardSignal: false },
    { key: 'fastTyping', label: 'fast typing', hardSignal: false },
    { key: 'syntheticInsertion', label: 'synthetic insertion', hardSignal: true },
    { key: 'foreignInput', label: 'foreign input', hardSignal: false },
  ],
  guard: [{ key: 'guardViolations', label: 'guard violations', hardSignal: true }],
  recording: [
    { key: 'mousePaths', label: 'mouse paths', hardSignal: false },
    { key: 'replay', label: 'replay', hardSignal: false },
  ],
};

/** Live session pane chrome (the pane itself is demo/live-pane.js). */
export const LIVE_PANE = {
  title: 'Live session record',
  tabs: { stream: 'signal stream', json: 'raw JSON' },
  caption:
    'Every row accumulates into {{pid}}.json, the file you download at the ' +
    'end and feed to the CLI. The stream is the demo\'s live view; the JSON ' +
    'is the product\'s actual file.',
  trials: { allLabel: 'All', sessionLabel: 'session', groupLabel: 'Filter the stream by trial' },
};

/** Step-2 integration code box: what this question looks like in your code. */
export const CODE_TABS = {
  defaultTab: 'jspsych',
  caption:
    'This page drives the same monitor through the plain-JS API. Most ' +
    'experiments use the jsPsych extension instead; both produce the same record.',
  jspsych: {
    label: 'jsPsych',
    code:
`// your trial, as you'd write it anyway
const trial = {
  type: jsPsychSurveyText,
  questions: [{ prompt: 'What is the capital of Australia?' }],
};

// the cyborg-hunter wrap-around
const jsPsych = initJsPsych({
  extensions: [{ type: jsPsychCyborgHunter,
    params: { participantId: subject.id, preset: 'standard' } }],
  on_finish: () => {
    jsPsych.extensions['cyborg-hunter'].finalize();
    jsPsych.data.get().localSave('csv', 'data.csv');
  },
});
trial.extensions = [{ type: jsPsychCyborgHunter }];
jsPsych.run([trial]);`,
  },
  plainjs: {
    label: 'plain JS',
    code:
`// your trial, built with your own JS however you like
showQuestion('What is the capital of Australia?');   // your code

CyborgHunter.init({ participantId: subject.id, preset: 'standard' });
CyborgHunter.startTrial('q1');   // 'q1' is just your label for this trial
// participant answers
CyborgHunter.endTrial();         // seal q1's integrity record

const payload = CyborgHunter.getSessionReport();
// one JSON file per participant → the CLI builds the report`,
  },
};

/**
 * Step-10 scoring panel (demo.js's renderScoringPanel/fillLiveScore):
 * the visitor's soft score so far, as the library itself computes it under
 * the standard weights, a note on what the analyzer's settings panel changes
 * afterwards, and two config-as-source snippets. The copy lives here; the
 * numbers come from the monitor and signal-manifest.json (never hand-typed)
 * so a preset change can't silently drift from what's shown.
 */
export const SCORING_PANEL = {
  intro: 'Your session so far, scored with the standard weights: the number the command-line tool reads.',
  analyzerNote: 'Changing the analysis after the fact is the analyzer’s job: its settings panel moves the ' +
    'soft-score threshold, which re-tiers participants against the scores their sessions saved, and the ' +
    'ranking weights that order them within a tier, and it exports the config that reproduces the report ' +
    'on the command line.',
  configIntro: 'As it reads in the library’s scoring config:',
  cliConfigIntro: 'As it reads in the CLI’s config file:',
};

/**
 * The 11-step script. Advance is never blocked; every task is an invitation.
 * act: intro | act1 | act2 | bridge | finale
 */
export const STEPS = [
  {
    id: 'intro',
    act: 'intro',
    eyebrow: 'Step 1 of 11',
    title: 'What this is',
    body: `
<p>cyborg-hunter is an open-source toolkit for online behavioral research:
a browser library that records integrity signals while participants work
(clipboard use, tab switches, typing dynamics, automation traces), and a
command-line tool that turns those records into a triage report a reviewer
can read in minutes. It exists because participants increasingly answer
studies with an AI in a second window, and self-report doesn't catch that.</p>
<p>This demo makes you the participant. You'll trigger the signals yourself,
watch them being recorded, run into the enforcement mode, and end with your
session's files, one click away from a real report built from them in the
analyzer. Two instruments on this page are demo-only: the signal lamps on
the right and the live session record below
this card. The lamps show a curated handful of what cyborg-hunter records; the
full list is in docs/signals-reference.md. The recording itself is the
actual product, behaving exactly as it does in a study.</p>
<p>The tour runs in four parts: Act 1 (steps 2 through 6) lets you try every
trick unguarded, while everything is still recorded; Act 2 (steps 7 through
9) puts the same tricks under enforcement; step 10 turns the recorded
signals into scores; step 11 hands you your session's files, to open in the
analyzer, which builds the report in your browser, or to save and run
through the command-line tool yourself.</p>
<p>Recording starts the moment you click Start: mouse movement is sampled,
not tracked pixel by pixel, and keystroke rhythm and tab switches are
recorded as well. Everything stays in this browser. No server, no upload;
the session recording (REC, top bar) is kept in memory so your report can
include a replay, and it leaves this tab only if you save it or open it in
the analyzer, a page of this same site.</p>`.trim(),
    positioning: true,
    task: null,
    primaryLabel: 'Start',
    secondary: null,
  },
  {
    id: 'baseline',
    act: 'act1',
    eyebrow: 'Act 1 · Unguarded · Step 2 of 11',
    title: 'Answer a question normally',
    body: `
<p>Type your answer to the question below the way you normally would. This
is the baseline: an honest answer produces keystrokes at a human rhythm and
not much else. Watch the lamps on the right as you type; the session record
under this card lists each event the moment it happens.</p>
<p>Below the task: what this exact question looks like in an experiment's
source code, with the cyborg-hunter wiring around it.</p>`.trim(),
    task: {
      kind: 'type-answer',
      trialId: 'act1-baseline',
      prompt: 'What is the capital of Australia?',
    },
    showCodeTabs: true,
    primaryLabel: 'Answered →',
    secondary: [{ kind: 'link', key: 'skipToGuardedAct', label: 'Skip to the guarded act' }],
  },
  {
    id: 'clipboard-cheat',
    act: 'act1',
    eyebrow: 'Act 1 · Unguarded · Step 3 of 11',
    title: 'Now cheat with the clipboard',
    body: `
<p>Suppose you don't know the answer and an AI does. Play that participant:
copy the question text, as if taking it to another app. Then copy the
answer provided below and paste it into the box. Paste it twice.</p>
<p>Both moves are recorded, but differently: the copy logs only that text
was taken and how many characters, while each paste carries the pasted
text itself, verbatim. A reviewer sees exactly what was pasted, down to
the words.</p>`.trim(),
    task: {
      kind: 'copy-paste',
      trialId: 'act1-paste',
      question: 'What is the capital of Australia?',
      providedAnswer: 'Canberra',
      targetPastes: 2,
    },
    primaryLabel: 'Pasted twice →',
    secondary: [{ kind: 'link', key: 'skipToGuardedAct', label: 'Skip to the guarded act' }],
  },
  {
    id: 'tab-away',
    act: 'act1',
    eyebrow: 'Act 1 · Unguarded · Step 4 of 11',
    title: 'Leave the tab, three ways',
    body: `
<p>Imagine an AI app open in another window. Switch away and come back
three times: a flicker (under 3 seconds), a short absence (3–10 seconds),
and a long one (over 10 seconds). Each lights a different lamp.</p>
<p>The bins encode how the duration reads. A flicker is usually nothing: a
notification, a stray click. Three to ten seconds is enough to read
something elsewhere. Past ten seconds is enough to switch windows, paste a
question, wait for an answer, and come back, which is why long absences
carry the most weight. The record keeps the exact duration and timestamps
of each absence either way.</p>`.trim(),
    task: { kind: 'tab-away', trialId: 'act1-tabaway' },
    primaryLabel: 'Back for good →',
    secondary: [{ kind: 'link', key: 'skipToGuardedAct', label: 'Skip to the guarded act' }],
  },
  {
    id: 'browser-rearrange',
    act: 'act1',
    eyebrow: 'Act 1 · Unguarded · Step 5 of 11',
    title: 'Dock an AI beside the task',
    body: `
<p>The modern cheat doesn't always leave the tab. Browsers now ship AI
sidebars (Gemini, Copilot, the Edge panel) that dock next to the page,
reading it while the participant works. Docking one changes the window's
geometry, and geometry is recorded: open a sidebar, split the window, or
resize it, and watch the record.</p>
<p>Resizing never ends the session. The layout adapts and recording
continues, whatever shape the window takes.</p>`.trim(),
    task: { kind: 'sidebar-resize', trialId: 'act1-sidebar' },
    primaryLabel: 'Done rearranging →',
    secondary: [{ kind: 'link', key: 'skipToGuardedAct', label: 'Skip to the guarded act' }],
  },
  {
    id: 'autotype',
    act: 'act1',
    eyebrow: 'Act 1 · Unguarded · Step 6 of 11',
    title: 'Let something else type',
    body: `
<p>Press the button and watch the field fill itself: text appearing with no
keystrokes behind it. Automation, scripts, and agentic tools all write into
a page this way, so the library flags it immediately as synthetic
insertion. Typing speed is also computed per trial; sustained rates above
{{typingSpeed.cps}} characters per second get their own flag when the trial
closes.</p>
<p>Dictation and some accessibility tools can produce similar patterns, a
caveat the docs carry too: these are signals for a human reviewer to weigh,
not automatic verdicts.</p>`.trim(),
    task: {
      kind: 'autotype',
      trialId: 'act1-autotype',
      autotypeText: 'No one is typing this. It is being inserted.',
      buttonLabel: 'Type it for me',
      busyLabel: 'Typing…',
      doneLabel: 'Typed ✓',
    },
    primaryLabel: 'Continue →',
    secondary: [{ kind: 'link', key: 'skipToGuardedAct', label: 'Skip to the guarded act' }],
  },
  {
    id: 'guard-entry',
    act: 'act2',
    eyebrow: 'Act 2 · Guarded · Step 7 of 11',
    title: 'The other approach: prevention',
    body: `
<p>Everything so far was detection: record quietly, report later. The guard
is the complementary mode: it makes cheating costly while the task runs.
Under the guard, the study requires fullscreen and focus; leaving either
scrambles the on-screen text until you return, and every violation is
logged with its type and timestamp.</p>
<p>Participants meet it as the box below, the library's actual entry
screen, word for word. Enter whenever you're ready; nothing is enforced
until you do.</p>`.trim(),
    task: {
      kind: 'fullscreen-entry',
      trialId: 'act2-entry',
      fallbackNote:
        'Fullscreen didn’t engage in this browser, so the guarded act ' +
        'can’t run here. Skip ahead: the rest of the tour still works without it.',
    },
    primaryLabel: null, // the entry box carries the library's own button
    secondary: null,
  },
  {
    id: 'guard-cheat',
    act: 'act2',
    eyebrow: 'Act 2 · Guarded · Step 8 of 11',
    title: 'Try the same tricks',
    body: `
<p>Tab away. Press Esc. Click another window. Each attempt logs a violation
and scrambles the task text until you come back; try to read it while
you're half-out. Pastes still go through and get recorded exactly as in Act
1: the guard leaves input alone and instead makes <em>leaving</em> costly,
logging a violation trail each time.</p>
<p>When you've had enough, the button below ends the guarded act; after
that, fullscreen is no longer required.</p>`.trim(),
    task: { kind: 'guard-cheat', trialId: 'act2-cheat' },
    primaryLabel: 'End the guarded act',
    secondary: null,
  },
  {
    id: 'guard-debrief',
    act: 'act2',
    eyebrow: 'Act 2 · Guarded · Step 9 of 11',
    title: 'What enforcement left behind',
    body: `
<p>The guard is off. Scroll the session record: every violation from the
last step is there with a type (fullscreen_exit, window_blurred) and a
timestamp, next to the Act 1 events that went unchallenged. Same tricks,
two different postures: Act 1 recorded them silently; Act 2 intervened and
logged each attempt.</p>`.trim(),
    task: null,
    primaryLabel: 'Continue to scoring →',
    secondary: null,
  },
  {
    id: 'signals-to-scores',
    act: 'bridge',
    eyebrow: 'Step 10 of 11',
    title: 'From signals to scores',
    body: `
<p>Everything you triggered is now rows in a session file. The library
that recorded them already scores each session: paste and drop each have
their own count threshold; every other signal carries a weight, and the
weights that fired sum into a soft score checked against its own
threshold. Crossing either kind of threshold puts a session in one of
three tiers: HARD (a hard signal crossed its threshold), SOFT (the soft
score crossed its threshold), CLEAN (neither).</p>
<p>These numbers live in two different places. Per-signal weights, and the
two presets they belong to (standard, strict), are set once, in the
library's scoring config, when a study is initialized. The soft-score
threshold, and two threshold fallbacks (tab-away cutoff, typing speed), are
set separately, in the CLI's config file, on the analysis side. Below is
both, as they actually read in code.</p>
<p>Ordering the participant list is a separate step, done afterward by the
CLI, once every session already has a tier. Tier comes first, always: hard
rows before soft before clean. Inside a tier, a fixed ranking score orders
the rest, one the weights above never touch: 5 points per paste event, 5
per copy event, 3 per sidebar-open, 1 per tab-away past the participant's
cutoff (a flicker under that cutoff scores nothing). A hard trigger, a
detected AI extension, and an edge exit do not add to this score; they
show up in the row's reason text instead, next to whatever did.</p>`.trim(),
    task: null,
    primaryLabel: 'See your files →',
    secondary: null,
  },
  {
    id: 'your-files',
    act: 'finale',
    eyebrow: 'Step 11 of 11',
    title: 'Your files',
    body: `
<p>Your session is now three files: the session data, the replay recording
and a config. Two example participants come with them, so the triage list
reads as it would in a real study. Open them all in the analyzer, which
builds the report right here in your browser and lets you change the
analysis settings and watch the report follow. Or save them and build the
same report with the command-line tool, the way you would with real study
data.</p>`.trim(),
    task: { kind: 'downloads', trialId: null },
    primaryLabel: null, // the step's own action is the panel's "Open in the analyzer"
    secondary: null,
  },
];

/** The last step's files, in two download batches (a Save link per file and
 * a "Save all" per batch, no zip): the session built in this tab (`key`,
 * built by demo.js's buildDownloadFile) and the two example participants the
 * site serves (`href`). A session file's card shows the name it is saved
 * under (demo.js sessionFileName); its `filename` here is the pattern, shown
 * only for a recording this browser could not make. The hand-off to the
 * analyzer passes the same files. */
export const DOWNLOAD_BATCHES = [
  {
    heading: 'Your session',
    files: [
      { key: 'sessionData', filename: 'DEMO-<id>.json', label: 'Session data',
        description: 'your trials and session record', savedLabel: 'Saved ✓' },
      { key: 'replay', filename: 'DEMO-<id>-replay-<epoch>.json', label: 'Replay',
        description: 'your session recording', savedLabel: 'Saved ✓' },
      { key: 'config', filename: 'cyborg-hunter.config.json', label: 'Config',
        description: 'the analysis settings for all five files', savedLabel: 'Saved ✓' },
    ],
  },
  {
    heading: 'Two example participants',
    files: [
      { href: 'assets/example-1.json', filename: 'example-1.json', label: 'Example 1',
        description: 'pasted an answer twice' },
      { href: 'assets/example-2.json', filename: 'example-2.json', label: 'Example 2',
        description: 'a clean session' },
    ],
  },
];

/** The last step's one-click hand-off to the analyze page (demo/handoff.js).
 * `failed` is first-party HTML: the step shows it when the browser refuses to
 * store the files. */
export const HANDOFF = {
  buttonLabel: 'Open in the analyzer →',
  buttonHint: 'The files below, kept in this browser: nothing is uploaded.',
  failed: 'This browser would not keep the files for the analyzer. Save them ' +
    'below and drop them on <a href="analyze/">the analyzer</a> instead.',
};

/** The last step's documentation-style walkthrough. Rendered as numbered
 * sections with copyable code blocks (engine renders section.code in
 * <pre><code>). */
export const REPLICATE = {
  sections: [
    { n: 1, heading: 'Save the five files into one empty folder',
      text: 'Use "Save all" on each batch above, or the Save button of each file. After the first file of a "Save all", ' +
        'your browser may ask whether this site may download several files: allow it, or save the rest with their own ' +
        'Save buttons. If a session file is still blocked, use its "show as text" link and save the text yourself; for an ' +
        'example file, right-click its Save link and choose "Save link as".',
      code: null },
    { n: 2, heading: 'Install Node.js if you don’t have it',
      text: 'Node 18 or newer. Check with:',
      code: 'node --version' },
    { n: 3, heading: 'Build the report',
      text: 'npx downloads cyborg-hunter automatically the first time it runs, ' +
        'so nothing needs installing beforehand. In a terminal, from the ' +
        'folder with the five files:',
      code: 'cd <that folder>\nnpx cyborg-hunter@{{version}} report' },
    { n: 4, heading: 'Open it',
      text: 'The CLI writes cyborg-hunter-report/ next to your files:',
      code: 'open cyborg-hunter-report/index.html' },
    { n: 5, heading: 'Optional: install it once, run it anywhere',
      text: 'Rather not fetch it through npx each time? Install cyborg-hunter ' +
        'globally once, then call it directly from any folder:',
      code: 'npm install -g cyborg-hunter\ncyborg-hunter report' },
  ],
  installNote: '',
};

/** Config caveat shown next to the downloadable cyborg-hunter.config.json. */
export const CONFIG_CAVEAT =
  "This config matches the demo's data shape. A real study likely needs " +
  "participantIdField 'subject_ID' and filePattern '*.csv' (see quickstart §6).";

/** Closing call-to-action on the last step. */
export const CLOSING_CTA = {
  primaryLabel: 'Get started in your experiment',
  primaryHref: 'https://github.com/cyborg-hunter/cyborg-hunter/blob/main/docs/quickstart.md',
  installInvitation:
    'The jsPsych wiring you saw at step 2 is the whole integration; the ' +
    'quickstart walks through it.',
  githubHref: 'https://github.com/cyborg-hunter/cyborg-hunter',
};
