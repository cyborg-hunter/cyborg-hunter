// demo/steps.js
// ALL tutorial copy as data. Numbers are {{path}} placeholders substituted
// from signal-manifest.json at runtime — never hardcode thresholds here.
// Register: plain, dry, direct. Signals only until the signals-to-scores
// step.

/** Intro positioning copy. */
export const POSITIONING =
  "Prolific's built-in Authenticity Checks give you a verdict inside one " +
  "platform. cyborg-hunter gives you the evidence: full behavioral traces, " +
  "replayable sessions, and honeypot catches, on any platform (Prolific, MTurk, " +
  "classroom, or standalone), free and inspectable. Use them together: " +
  "platform-level screening plus study-level evidence you can defend in review.";

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
  trials: { allLabel: 'All', sessionLabel: 'session', groupLabel: 'Filter the stream by trial' },
};

/**
 * Step-9 scoring panel (demo.js's renderScoringPanel/fillLiveScore):
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
 * The 10-step script. Advance is never blocked; every task is an invitation.
 * act: intro | act1 | act2 | bridge | finale, set on body[data-view] for the
 * CSS and never shown. eyebrow: the card's step label, the step count only.
 */
export const STEPS = [
  {
    id: 'intro',
    act: 'intro',
    eyebrow: 'Step 1 of 10',
    title: 'What this is',
    body: `
<p>cyborg-hunter is an open-source toolkit for online behavioral research:
a browser library that records integrity signals while participants work
(clipboard use, tab switches, typing dynamics, automation traces), and a
command-line tool that turns those records into a triage report a reviewer
can read in minutes. The goal is to catch participants using AI assistance
during behavioral experiments.</p>
<p>This demo makes you the participant. It invites you to trigger some of the
signals yourself via your actions, over several successive steps. The panel
on the right ("Tracked signals") notifies you of the signals as they are
being tracked by the plugin. In the end, you will be able to download your
session's files and generate a report from them in the analyzer, just like
you would from the traces left by a real participant taking your study. Your
data stays entirely in this browser and will not be uploaded to an external
server.</p>`.trim(),
    positioning: true,
    task: null,
    primaryLabel: 'Start the demo',
  },
  {
    id: 'baseline',
    act: 'act1',
    eyebrow: 'Step 2 of 10',
    title: 'Answer a question normally',
    body: `
<p>First, answer the question below the way you normally would. This
serves as a baseline: an honest answer produces keystrokes at a human rhythm
and not much else. Watch the lamps on the right as you type; the session
record under this card lists each event the moment it happens.</p>`.trim(),
    task: {
      kind: 'type-answer',
      trialId: 'baseline',
      prompt: 'How is your day today?',
    },
    primaryLabel: 'Answered →',
  },
  {
    id: 'clipboard-cheat',
    act: 'act1',
    eyebrow: 'Step 3 of 10',
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
      trialId: 'paste',
      question: 'How is your day today?',
      providedAnswer: 'Great question! 😊 Honestly? My day has been a rich tapestry of moments ' +
        '— both big and small — that have reminded me what it truly means to be human. ' +
        'It\'s not just a day — it\'s a journey.',
      targetPastes: 2,
    },
    primaryLabel: 'Pasted twice →',
  },
  {
    id: 'tab-away',
    act: 'act1',
    eyebrow: 'Step 4 of 10',
    title: 'Leave the tab, three ways',
    body: `
<p>Another typical trace left by participants using AI assistance is the
repeated opening and closing of the current tab, to fetch an answer from an
AI assistant located in a browser sidebar or a different window. For this
reason, cyborg-hunter tracks each time the user leaves the current tab. We
distinguish three types of tab-away events: a flicker (under 3 seconds), a
short absence (3–10 seconds), and a long one (over 10 seconds). Flickers are
less suspicious because they might simply be the result of a notification or
a stray click. Longer absences, especially if they occur at critical moments
of the experiment when the user is supposed to find the answer to a
non-trivial question, are more suspicious.</p>
<p>Another suspicious sign is the presence of browser sidebars, which
participants can tuck out to the side of the window in order to consult an
AI assistant. cyborg-hunter also tracks when participants open a
sidebar.</p>
<p>To test these features, you can try it yourself: move to a different tab
for different durations and come back, and/or open a sidebar.</p>`.trim(),
    // No task panel for this kind (demo.js renderTaskPanel): the text is the
    // task. The trialId still brackets the step in the record.
    task: { kind: 'tab-away', trialId: 'tabaway' },
    primaryLabel: 'Done',
  },
  {
    id: 'autotype',
    act: 'act1',
    eyebrow: 'Step 5 of 10',
    title: 'Let something else type',
    body: `
<p>Another class of cheaters cyborg-hunter can help detect is automated bots,
which take the experiment autonomously without human intervention, aided or
not by a language model for their answers. These bots also leave
characteristic traces in the data. One of them is text insertion.</p>
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
      trialId: 'autotype',
      autotypeText: 'No one is typing this. It is being inserted.',
      buttonLabel: 'Type it for me',
      busyLabel: 'Typing…',
      doneLabel: 'Typed ✓',
    },
    primaryLabel: 'Continue →',
  },
  {
    id: 'guard-entry',
    act: 'act2',
    eyebrow: 'Step 6 of 10',
    title: 'The other approach: prevention',
    body: `
<p>On top of means to track down signals, cyborg-hunter also ships with a
guard that is designed to make it harder for participants to cheat. Under
the guard, the study requires fullscreen and focus; leaving either
scrambles the on-screen text until you return, and every violation is
logged with its type and timestamp.</p>
<p>Participants are prompted by a page like the one below to enter the
guarded mode (the wording on the page can be customized). Click the button
"Enter fullscreen and continue" to trigger the guard yourself.</p>`.trim(),
    task: {
      kind: 'fullscreen-entry',
      trialId: 'guard-entry',
      fallbackNote:
        'Fullscreen didn’t engage in this browser, so the guard ' +
        'can’t run here. Skip ahead: the rest of the tour still works without it.',
    },
    primaryLabel: null, // the entry box carries the library's own button
  },
  {
    id: 'guard-cheat',
    act: 'act2',
    eyebrow: 'Step 7 of 10',
    title: 'Try to break the guard',
    body: `
<p>Tab away. Press Esc. Click another window. Each attempt logs a violation
and scrambles the task text until you come back; try to read it while
you're half-out. Pastes still go through and get recorded exactly as in the
earlier steps: the guard leaves input alone and instead makes
<em>leaving</em> costly, logging a violation trail each time.</p>
<p>When you've had enough, the button below ends the guard; after that,
fullscreen is no longer required.</p>`.trim(),
    task: { kind: 'guard-cheat', trialId: 'guard' },
    primaryLabel: 'End the guard',
  },
  {
    id: 'guard-debrief',
    act: 'act2',
    eyebrow: 'Step 8 of 10',
    title: 'What enforcement left behind',
    body: `
<p>The guard is off. Scroll the session record: every violation from the
last step is there with a type (not_fullscreen, window_blurred) and a
timestamp, next to the other previously recorded events.</p>`.trim(),
    task: null,
    primaryLabel: 'Continue to scoring →',
  },
  {
    id: 'signals-to-scores',
    act: 'bridge',
    eyebrow: 'Step 9 of 10',
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
rows before soft before clean. Inside a tier, a default ranking score orders
the rest, one the weights above never touch: 5 points per paste event, 5
per copy event, 3 per sidebar-open, 1 per tab-away past the participant's
cutoff (a flicker under that cutoff scores nothing). A hard trigger, a
detected AI extension, and an edge exit do not add to this score; they
show up in the row's reason text instead, next to whatever did.</p>`.trim(),
    task: null,
    primaryLabel: 'See your files →',
  },
  {
    id: 'your-files',
    act: 'finale',
    eyebrow: 'Step 10 of 10',
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
  },
];

/** The link back to the previous step, on every step but the first. */
export const BACK_LABEL = 'Go back';

/** The last step's files, in two download batches (a Save button per file,
 * and one "Save all into a folder" for all five where the browser has a
 * folder picker; no zip): the session built in this tab (`key`,
 * built by demo.js's buildDownloadFile) and the two example participants the
 * site serves (`href`). A session file's card shows the name it is saved
 * under (demo.js sessionFileName); its `filename` here is the pattern, shown
 * only for a recording this browser could not make. The hand-off to the
 * analyzer passes the same files, and the page's fonts (HANDOFF_ASSETS). */
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

/** The tour's own typefaces (demo.css @font-face), handed to the analyzer
 * with the files so a replay of this page renders in them. Not offered as
 * downloads: they are not study data. */
export const HANDOFF_ASSETS = [
  'assets/fonts/spacegrotesk/spacegrotesk-300-700.woff2',
  'assets/fonts/tomorrow/tomorrow-400.woff2',
  'assets/fonts/sofiasans/sofiasans-1-1000.woff2',
  'assets/fonts/sora/sora-100-800.woff2',
  'assets/fonts/recursive/recursive-300-1000.woff2',
  'assets/fonts/majormonodisplay/majormonodisplay-400.woff2',
];

/** The last step's one-click hand-off to the analyze page (demo/handoff.js).
 * `failed` is first-party HTML: the step shows it when the files could not be
 * handed over (an example file failed to download, or the browser refused to
 * store them). `leaveHint` sits under the button: the session lives in this
 * page only. */
export const HANDOFF = {
  buttonLabel: 'Open in the analyzer →',
  buttonHint: 'The files below and this page\'s fonts, kept in this browser: nothing is uploaded.',
  failed: 'The files could not be prepared for the analyzer. Save them below ' +
    'and drop them on <a href="analyze/">the analyzer</a> instead.',
  leaveHint: 'Leaving this page can end the session: open it in the analyzer or save the files first; ' +
    'Back from the analyzer may start a new tour.',
};

/** The last step's "Save all into a folder" (demo.js saveToFolder), offered
 * only where the browser has a folder picker (Chrome, Edge). `failed` is
 * plain text: the step shows it when the folder could not be written. */
export const SAVE_TO_FOLDER = {
  buttonLabel: 'Save all into a folder…',
  hint: 'Chrome and Edge: pick or create an empty folder (inside Downloads, for example); ' +
    'the browser refuses your home folder and system folders.',
  failed: 'The folder could not be written. Save the files one by one below.',
};

/** The last step's documentation-style walkthrough. Rendered as numbered
 * sections with copyable code blocks (engine renders section.code in
 * <pre><code>). */
export const REPLICATE = {
  sections: [
    { n: 1, heading: 'Save the five files into one empty folder',
      text: 'Use "Save all into a folder" above (Chrome and Edge; pick or create an empty folder, inside Downloads ' +
        'for example, since the browser refuses your home folder and system folders), or the Save button of each ' +
        'file: browsers allow one download per click, so each file has its own. If a session file is blocked, use ' +
        'its "show as text" link and save the text yourself; for an example file, right-click its Save link and ' +
        'choose "Save link as".',
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

/** Config caveat, shown once on the last step, under the grid of the batch
 * that holds cyborg-hunter.config.json (the first batch). */
export const CONFIG_CAVEAT =
  "This config matches the demo's data shape. A real study likely needs " +
  "participantIdField 'subject_ID' and filePattern '*.csv' (see quickstart §6).";

/** Closing call-to-action on the last step. */
export const CLOSING_CTA = {
  primaryLabel: 'Get started in your experiment',
  primaryHref: 'https://github.com/cyborg-hunter/cyborg-hunter/blob/main/docs/quickstart.md',
  installInvitation: 'One script tag is the whole integration; the quickstart shows it.',
  githubHref: 'https://github.com/cyborg-hunter/cyborg-hunter',
};
