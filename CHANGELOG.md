# Changelog

All notable changes to **cyborg-hunter** are documented here. This project follows
[Semantic Versioning](https://semver.org).

## [Unreleased]

Pointer and device checks. Collected data changes (one device fact, read
just after the session starts) and reports change (one new pointer tell, a
device line, a click picture, three new `summary.csv` columns): read
[docs/upgrading.md](docs/upgrading.md). Typing: the typing rate is
corrected, which changes the live soft score; trial reports gain a count of
edits and the typing-rhythm summaries; reports gain a Typing dynamics
section and six more `summary.csv` columns. The report's typing chart moves
onto the session timeline's time axis, in one Session timeline block. The
report can add a hard tier of its own (`hardAt`, shown as `HARD*`, in a new
last `summary.csv` column), re-weights its list live, and its rail opens
sorted by score.

### Added
- The centered-clicks rule in the pointer verdict, read from the session
  recording: the share of pointer clicks on a control that land within
  1.5 px of its centre (browser automation clicks the centre). Suspicious
  from 0.2, highly suspicious from 0.9, judged from 8 qualifying clicks;
  touch recordings are not judged. A near tier (within 5 px) is reported,
  not judged. `cursorCenteredClicks` is now filled; `cursorCenteredNear` is
  new.
- The software-renderer device fact: whether the browser draws without a
  graphics card (only the software family's name, such as `swiftshader`, or
  `none` without WebGL; never the graphics hardware's name), read once when
  the browser is next idle, within about 1 s of the session start.
  `signals.softwareRenderer` (default on) turns it off. Shown in the cursor
  section and in `cursorSoftwareRenderer`; it does not change the pointer
  verdict.
- Device masking in the report, from the window log the monitor already
  keeps: a pixel ratio no browser produces (R1), a pixel ratio that stays
  fixed through a page zoom (R2, not applied to Safari), a window larger
  than the screen it reports (R3a, not applied to Firefox when the browser
  is known). The browser is read from the session recording when there is
  one. Column `deviceMasking`. Not evidence of AI use.
- A device line at the top of the cursor section (graphics, screen facts,
  automation flag, kind of pointer) and, under the verdict, a picture of
  where each qualifying click landed on its control.
- `scoreWeights` keys `softwareRenderer` and `deviceMasking` (default 0).
- Typing rhythm: for each text field with 20 or more gaps between typed
  characters, the library saves the gaps' count, median, share under 60 ms
  and variation, with the field's tag and never its id (`typingRhythm`,
  `signals.typingRhythm`, on by default); the rhythm saves no keystroke
  times. Trial reports also carry `typingEdits`, a count. The Qualtrics
  payload carries both.
- The report's Typing dynamics section: a typing verdict per session
  (suspicious from one kind of rule, highly suspicious from fast and even
  typing in one field), judged from the library's summaries or, for older
  data, from a session recording that keeps the page (`dom` tier);
  `typing-limits.json`; summary.csv columns `typingVerdict`, `typingTells`,
  `typingFieldsJudged`, `typingFastestMedianMs`, `typingLowestCv`,
  `typingRateSource`; the `typingRhythm` score weight (default 0); a typing
  clause in the triage reason, before the pointer clause.
- The report's **Session timeline** block: the typing chart is drawn on the
  session timeline's time axis and stacked above it, with a hover line,
  click-to-pin lines and an **enlarge** button. The block's header row
  names the time, trial, phase and typing rate under the pointer. Works in
  the CLI report and in the analyzer.
- The session timeline gains a Trials strip (coloured by `phase` when set), a
  Text input lane (copy or cut, paste, drop, synthetic insertions) and dashed
  guides at trial starts and phase changes; the typing chart draws the same
  guides and marks C, P and R (typing rhythm) over its trials at least 8 px
  wide in the image. When the trial starts average under 6 px apart in the
  image, their lines are left out and both legends say so. Pages a reduced
  Qualtrics payload kept without their events are hatched and counted in
  the timeline's footer, and the header row adds "events not kept" while
  the pointer is over one.
- `hardAt` in the CLI config: per-signal counts at or above which the report
  moves a participant into the hard tier, shown as `HARD*` beside the
  library's `HARD`. summary.csv gains `reportTier` as its last column,
  triage.md lists `HARD*` with the hard rows, score-weights.json records the
  rule, the top bar names it, and the console counts the participants it
  moved. Unknown keys warn with the closest name.
- One score-weights panel, with a 0–20 slider, a number box, a cap and a
  Hard at count per signal, grouped: in the analyzer's settings, with
  **Reset to defaults** beside **Export config**, and in a **Weights…**
  dialog in the CLI
  report, which re-scores, re-tiers and re-sorts the list as you type. The
  dialog changes the page only, and its button reads **Weights… (edited)**
  while its values differ from the run's; the report's files and annotation
  exports keep the run's values, and **Copy config** gives the
  `scoreWeights` and `hardAt` lines.
- The report's rail: tier and label filters as joined button blocks, a search
  box that also finds participants by the start of a signal word (`mous`,
  `cut pan`), and sorts by score (now the default), tier then score, pointer
  verdict, typing verdict and id.

### Changed
- `cursorChecksRecorded` counts the software-renderer fact: 3–4 with a
  cursor stream, 1–2 without one.
- The typing rate is (edits − 1) per second between a trial's first edit
  and its last, and needs 20 edits (`thresholds.typingMinEdits`). This
  changes the library's live soft score: short fields no longer fire
  `typingSpeed`. The report recomputes older data's rates from saved edit
  times or from a session recording that keeps the page (`dom` tier), and
  marks the rest "old formula"; a `trace`-tier recording holds no edits and
  recomputes nothing.
- The typing chart draws the typing analysis's rate for each trial, the one
  the Typing dynamics section and `summary.csv` use: the corrected rate
  where the data allow one (a 0.17 library, saved edit times, a `dom`-tier
  recording), else the old-formula rate the library saved. It drew the saved
  rate everywhere before.
- The typing chart is 1000 px wide on the session time axis whenever every
  trial carries `startTime` and `duration_ms`, and no longer caps the trials
  it shows; data where a trial lacks them keeps one bar per trial. The
  Phases strip (the gallery phase bands) is drawn only for sessions that
  have those bands.
- The one-bar-per-trial typing chart steps its y-axis in round numbers (5,
  10 or 20 up to 160 chars/sec, then 1, 2 or 5 × a power of ten) instead of
  five equal ticks up to the fastest rate or 1.5 × the threshold; prints the
  threshold after the title, with the legend on the line below; and is at
  least 600 px wide (700 when a reduced Qualtrics payload kept a page
  without its events), so a short session no longer cuts its legend.
- The session timeline's title prints the whole participant id, cut with an
  ellipsis before the legend as the typing chart's title is. It printed the
  first 8 characters.
- The report's rail opens sorted by score instead of by tier; **Tier, then
  score** gives the old order.

## [0.16.0] — 2026-10-15

Hardening before an institutional review: what is collected, kept and sent is
now stated in the docs and matches the code, session replay is on by default
and saved with the data, and a set of privacy and robustness bugs is fixed.
Collected data, configuration and reports all change: read
[docs/upgrading.md](docs/upgrading.md).

### Added
- Session replay on by default in `ch.js` and `ch-labjs.js`, with the
  recorder bundled into them. The recording is saved with the data, in
  pieces: `cyborgHunterReplay` per jsPsych or lab.js row and
  `cyborgHunterReplayFinal` at the end, or a `cyborgHunterReplay` POST field
  (and `CyborgHunter.data()` key) on pages without a framework. A save trial
  mid-session keeps every earlier trial. `data-replay="off"` turns it off;
  `ch-qualtrics.js` keeps replay opt-in.
- The CLI and the analyzer rebuild recordings from pieces wherever they sit
  (rows, CSV cells, saved POST fields) and join one participant's
  consecutive recordings (pages, reloads) into one replay.
- Pseudonymized export: `pseudonymize` / `--pseudonymize` and
  `pseudonymKeyFile`, and an analyzer setting; the key stays out of the report.
  The analyzer remembers the key in the browser and accepts the CLI's key
  file, so its codes stay the same across visits and match the CLI's.
- `scripts/pin-snippets.mjs` (`npm run pin:snippets`): every documented
  script tag names an exact version and carries an SRI `integrity` hash;
  `--check` runs in the tests, and after each release a workflow job checks
  the tags against the files published on npm.
- `thresholds.maxWindowPositions`; the session report's
  `windowPositionsCapped`.
- `thresholds.maxPasteDropChars` (20,000) and `maxPasteDropCharsPerTrial`
  (200,000): stored pasted and dropped text is capped, with the full length
  and `truncated: true` kept.

### Changed
- The window/screen log records a row at start and then only on change, with
  a session cap.
- The participant ID and session kept in the tab are scoped to the study's
  folder.
- `onSignal` payloads carry pasted, dropped and typed text only when the
  matching `collectForPostHoc` switch is on.
- `data-debug` left the Qualtrics copy-paste tag (it is a separate test step).
- Docs: a full privacy model (what is stored by default, from when, where it
  is kept and sent), and corrections where they understated collection: the
  `data-ch-redact` mark covers the recording only (the integrity monitor
  still stores text pasted into a marked field); the honeypot's `<meta>` tag
  and friction's notices, both addressed to AI agents and asking them not to
  tell the participant; decoys need `decoyAnswers: true` and then run on
  every trial; wall-clock trial times, foreign-input field names and click
  targets are listed.

### Fixed
- A recorded `<link rel="prefetch">` made Chromium fetch any address from the
  report and the analyzer despite their CSP; recorded `<link>`, `<meta>` and
  `<base>` elements are now inert.
- The replay viewer withstands hostile recordings: what sits inside a recorded
  `<noscript>` or other inert element no longer loads; trees nested deeper
  than 512 levels, non-array `children` and oversized node lists are
  dropped and counted instead of freezing or stopping the viewer; stylesheet
  ids must be numbers; a canvas snapshot must be a `data:image` URL; a value
  aimed at a file input is skipped.
- A `.gz` upload is decompressed to at most 256 MB, and a participant file
  larger than 256 MB is not read.
- One participant can no longer stop the report for everyone: a study with
  426 or more trials (plots now capped at 400 trajectory panels and 800
  typing bars, with a note), a deeply nested recording, a `null` entry in a
  signal list, or an ID too long for a file name.
- A recording inside one participant's data file is credited to that
  participant only; recordings found elsewhere join a participant's replay
  only from a browser their own data shows; pieces sharing a recording id
  across participants are not joined.
- Plot files of IDs that differ only in case no longer overwrite each other
  on macOS and Windows.
- Pseudonymized output: replay reasons, the analyzer's warnings and a
  missing recording's save location use the codes; the key-file guard compares real paths; deeply nested data no
  longer stops the run; `triage.md` escapes the Reason column.
- Participant IDs that clean up to the same file name no longer overwrite
  each other's plots; an ID of `__proto__` no longer pollutes the analyzer's
  image map; `triage.md` escapes IDs.
- A misspelt nested privacy switch, and an invalid `redactSelector`, are now
  reported instead of silently leaving collection on.
- `collectForPostHoc.responseText`, which no code ever read, is removed;
  passing it now warns as an unknown key.
- The `domProtection` init option, which no code ever read, is removed;
  passing it now warns as an unknown key. Copy logging is `signals.copy`; the
  DOM protections are the functions `preventTextSelection(selector)`,
  `addHoneypot()` and `setAltText()`.
- Privacy switches given an unexpected value (`'false'`, `keys: false`) now
  turn collection off with a warning instead of leaving it on; the recorder
  warns on unknown option names.
- A deferred decoy is never injected after its trial ended.
- Friction no longer traps a participant whose browser cannot go fullscreen
  (the tab and focus checks still run; the sidebar check does not).
- The same recording found in the rows and in a saved file counts once.
- On the trace tier, a field the page moves out of a `data-ch-redact`
  container stays redacted, as on the dom tier.
- On a page without a framework, a back/forward-cache restore (Back, then a
  resubmit) records the restored visit as a new recording, which the CLI
  joins with the other pages; a recording the page started itself before
  ch.js attached goes on (ch.js records nothing and warns); ch.js warns once,
  and notes it in the data, when its hidden POST fields pass 1 MB; a
  `data-replay-src` on ch.js is reported as doing nothing.
- A patch refused by a per-trial cap no longer leaves later replay segments
  pointing at nodes the recording never got; friction's page copies are
  taken only when they will be kept, and a destroyed recorder unsubscribes.
- `signals` switches fail closed like `collectForPostHoc`.
- The kept participant ID continues from a parent folder only for the
  study's own bare link, and is per survey on every Qualtrics address but
  the legacy layout's.
- In a page served as `application/xhtml+xml` (lower-case tag names), inline
  scripts are no longer recorded and the password floor holds; element ids are read from the attribute, so a
  form with a field named `id` no longer corrupts a click's anchor.

## [0.15.0] — 2026-10-11

Replays for the sample: the bundled example dataset now carries the replay
recordings of three of its four sessions, so `cyborg-hunter report` there
plays them, and the analyzer's Load sample data fetches them from the site
(the offline file offers them as release downloads). Nothing changes in
collected data, configuration or the report's contents.

### Added
- `examples/demo-sessions/`: the replay recordings of three of the four
  sessions (`DEMO-<id>.replay.json`, 1.7–2.3 MB each), so `cyborg-hunter
  report` there plays them. They are the tour's recordings, with the
  stylesheet URL made the relative `demo.css` and without what the recording
  browser's extensions added to the page; `DEMO-a3f3`'s shows `Copy Copy`
  where its paste was, with nothing typed after it. The recordings carry the
  browser line (Chrome on a Mac) and each session's start time and viewport,
  nothing else that identifies.
- `/analyze/`: "Load sample data" on the site fetches the three recordings
  with the trackers, inside the same request, so the report's replay card
  plays them; a recording that cannot be fetched is named on a line and left
  out. The offline file offers the three as this version's release downloads
  instead, with "then drop them here". The page's policy allows its own
  origin (`connect-src 'self'`); the offline file's still allows none.
- The GitHub release carries the three recordings beside the offline analyzer.

### Changed
- Live demo: the visitor's id is drawn again when it would be one of the
  bundled sessions' (`DEMO-9mop`, `DEMO-bsq6`, `DEMO-681w`, `DEMO-a3f3`).
- Live demo, `/analyze/`, the HTML report and the replay viewer: a round of
  visual polish within their existing look (spacing, alignment, control
  heights, focus rings, ink instead of browser blue). Step 6 of the tour is
  now titled "Added friction as a complementary feature". In the tour, Tab
  reaches a step's primary button before "Go back". The report's and the
  replay viewer's default output changes accordingly (snapshots updated).

### Fixed
- `/analyze/`: the files step's inputs (Load sample data, choose files, choose
  a folder, the drop zone) are disabled while a request is on its way; before,
  they looked available and a drop was silently refused.
- Docs: `event-log.csv` holds the events recorded during a trial; the
  reference said every tab-away.
- HTML report on phones: the participant list no longer runs off the right
  edge (scores and tier badges were hidden); the rail stacks above the detail,
  and a long participant id wraps instead of pushing the score off screen.
- Live demo: the page shown below 820px wide is styled (it ran edge to edge
  with browser-blue links); the config's "show as text" dialog opens centred,
  not pinned top-left; the guard's row in the signals panel no longer reads as
  an alarm at 0 violations; a long pasted answer shows whole.
- `/analyze/`: the drop zone's file inputs are its two text links instead of
  raw browser widgets; the Settings fields stay inside their box on a phone;
  the progress bar and the annotations Import picker match the page.

## [0.14.0] — 2026-10-10

Cursor dynamics in the report: a pointer verdict per session (clean,
suspicious, highly suspicious, or not assessed, with its reason) from what
the browser reports and from first clicks that arrive without a path, the
tells shown and the movement shape measured. The bundled example dataset is
now four sessions recorded on the demo tour, one of them by an AI agent, and
the analyzer's Load sample data adds them to the files already listed.

### Added
- Report (CLI and `/analyze/`): a "Cursor dynamics" section for each
  session that opens with its pointer verdict (clean, suspicious, highly
  suspicious, or not assessed with the reason) and the tells that decided
  it: the automation flag set by the browser (`navigator.webdriver`), clicks
  the page's own scripts dispatched (`isTrusted` false), clicks that arrived
  without a path (a first pointer click whose movement has at most one
  sample and starts 20 px or more from where the pointer was last seen,
  judged from 4 first clicks with a known position before them), and
  trials clicked without pointer movement. Beneath, in a closed details block, are
  every check with its count, its denominator and up to ten trial ids,
  clicks after a pointer jump and the shape of each movement (duration,
  path length, displacement, speed, efficiency and deviation, as medians
  with their n).
  With it come a "Pointer verdict" tile ("—" when the session is not
  assessed), a rail cell ("pointer: highly suspicious") and its sort option,
  a clause in the triage reason, nineteen `cursor…` columns at the end of
  `summary.csv` (no existing header changes), a new file,
  `cursor-limits.json`, with the constants the section judged with, their
  meanings and the verdicts over the cohort, and one line in the run output,
  "Pointer verdicts: H highly suspicious, S suspicious, C clean, U not
  assessed (…)", which `/analyze/` prints under its results summary. A new
  `scoreWeights` key, `cursor` (default 0, shown in the analyzer's settings
  as "pointer verdict (cursor)"), adds the weight times the verdict's level
  (suspicious 1, highly suspicious 2) to the triage score; the tier is
  unchanged, and the CLI warns when the weight is on and some sessions carry
  no device facts. The thresholds behind the verdict are provisional.
  For the checks the monitor now records the session's device facts
  (`device: { maxTouchPoints, coarsePointer, webdriver }`), viewport
  coordinates (`cx`, `cy`) on every mouse sample, and `trusted`, `detail`
  and `pointerType` on every click, press and release. One trial of 2,000
  moves grows from 84,878 to 119,978 bytes of JSON, one of 2,000 clicks from
  86,878 to 217,978; the Qualtrics write still leaves the mouse track out and
  adds 69 bytes for the device facts, so Qualtrics sessions read "not
  collected" while the automation flag still comes through. Sessions
  recorded before 0.14 show the checks as "not recorded" and are not
  assessed (docs/upgrading.md). The bundled dataset's agent session,
  DEMO-bsq6, reads highly suspicious: all twelve of its first clicks with a
  known position arrived without a path. The two sessions recorded on the
  earlier tour, before the device facts existed, show the checks as not
  recorded and are not assessed.

### Changed
- `computeMouseMetrics` (each trial's `mouseMetrics`) measures path length
  and displacement with the geometry the report's cursor section uses; its
  outputs are unchanged. Its comment no longer gives bot and human ranges:
  it says that `pathEfficiency` covers the whole trial (the cursor section's
  efficiency is per movement) and that direction changes and speed variance
  depend on the sampling interval.
- The bundled example dataset is four sessions recorded on the demo tour
  (`examples/demo-sessions/`), three by Mira, a human tester, and one by a GPT agent
  driving Chrome from a sidebar; the CLI's worked example, the README table,
  the analyzer's "Load sample data" and the demo's two example participants
  read it. "Load sample data" adds the sessions to the files already listed
  instead of replacing them: a session already listed by name is left out,
  the sample's config comes only to an empty list (a cohort keeps the config
  and settings it has), and each added file can be removed like any other.
  The sessions are read under the cohort's participant-ID field: beside
  files keyed by another field, one side reads as `unknown` until it is
  removed.

### Removed
- The synthetic pilot (`examples/synthetic-pilot/`) and the demo's generated
  example participants, with their generators.
## [0.13.0] — 2026-10-10

The demo tour and the analyze page after two review rounds: a ten-step tour
with the live session record under the card and a last step, Your files,
that hands the session to the analyzer; one Files & settings step there,
with a settings panel; annotations (Include, Exclude, Flag) kept by run id in
the report and on the page; 1:1 and fullscreen views of figures. Also:
recordings carry the attributes of the html element, each Qualtrics survey
keeps a session of its own, one CSV cell writer for every CSV file, and the
docs lead with the one-line setup.

### Added
- Reports: the top bar names the run (`run 3f9c2a7b1d4e8a60 · 2026-10-05
  14:03 UTC`). The id is a hash of each participant's id, trial count, and
  first and last trial timestamps. A report rebuilt from the same files keeps
  it, whatever the analysis settings (a change to the ID or integrity field
  reads the files again and can give another id), and the CLI and
  `/analyze/` give the same files the same id, in whatever order they read
  them. Two studies that share participant ids get different ids when their
  trials carry timestamps (0.6.1 and later), so their annotations stay apart.
- Reports: annotate each participant with Include, Exclude or Flag and a
  note (keys `i`, `e`, `f` for the selected one). The rail shows the label
  as a glyph at the left of each row, in place of the tier dot (Include ✓,
  Exclude ✗, Flag ⚑, the same glyphs as on the buttons; the tier stays on
  the row's badge), and how many participants are reviewed. The report
  keeps the annotations in the browser under its run id; Export JSON and
  Import carry them elsewhere, and Export CSV writes one row per participant
  (`participantId, tier, triageScore, label, note, annotatedAt, runId`),
  optionally counting the unreviewed as included.
- `/analyze/`: the same annotations in the in-page report. The page keeps
  them under the report's run id, so a re-analysis keeps them, and the
  results step has the CSV and JSON exports and the import.
- Report (CLI and `/analyze/`): an enlarged figure has a **1:1** control
  that shows it at the size it was drawn, scrolling inside the overlay (a
  click on the figure switches too), and a **Fullscreen** control wherever
  the page may go fullscreen. On `/analyze/` the report frame now allows it.
- Qualtrics: each survey opened in a tab keeps a session of its own. The
  tag's `data-qualtrics-survey-id`, which the install snippet fills with
  `${e://Field/SurveyID}`, names the survey, and the page address does when
  the attribute is missing or unfilled.
- Session replay: the recorder records `<html>`'s own attributes (on every
  keyframe, and each change), and the viewer applies them to the replay.
  A page that keeps its layout on `<html>`, for example CSS variables set
  with `document.documentElement.style.setProperty`, replays at the sizes
  the participant saw; before, everything sized by those variables fell
  back to its default (a card image at its natural size). The data rides in
  the recording's `extensions["cyborg-hunter"]` (`root_attrs` on keyframe
  segments, `root_attr_events` on the recording), so other players ignore
  it. Recordings made before 0.13.0 replay as before.
- `/analyze/`: a settings panel with the keys a report can apply after
  collection (score weights, soft-score threshold, the ID, integrity and
  session-report fields, and platform ID). On the results, a change
  re-analyses in place without dropping the files again; a change to the
  ID, integrity or session-report field reads the files again from the same
  list. A drop that adds data files or recordings keeps the panel's values;
  only a config whose values differ from the loaded one replaces them, and
  a line under the file list says so. The Participant ID field likewise
  keeps the analyst's choice while the files still offer it and the config
  is unchanged. The threshold has a line saying what it is for, and the
  score weights are open, under a summary that says what they do. The
  phase scope and the trajectory order stay CLI keys: the panel does not
  show them, and a dropped config that sets them keeps them in every run
  and in the exported config (the page's worker no longer reports a run's
  phases, `done.phases`).
- Docs: the friction entry trial's text is an option of the call that
  builds it, `CyborgHunter.frictionEntryTrial({ message })` under the
  one-line setup (quickstart) and
  `jsPsychGuardFriction.entryTrial({ message })` with the extensions wired
  by hand (advanced-integration.md). The message replaces the default
  text, heading included; the button keeps its label, "Enter fullscreen and
  continue".

### Changed
- `/analyze/`: dropping and checking are one "Files & settings" step. Every
  drop or file choice adds to the list, so data and replays can come from
  different folders; the same file dropped twice is listed once. A table
  lists each file with what it was read as (participant data, replay
  recording, experiment asset, settings, ignored, unreadable) and a Remove
  button, and a line says whether the settings came from a dropped
  `cyborg-hunter.config.json` or are the defaults.
- Live demo: the tour ends with your files. Its last step, "Your files",
  takes the page's full width and offers the session data, the replay
  recording and a config, plus two example participants, each with its own
  Save button (no zip). In Chrome and Edge, "Save all into a folder" writes
  all five into one folder the visitor picks (the step asks for one named
  `cyborg-hunter-demo` inside Downloads). "Open in the analyzer web app"
  hands the five files and the page's six fonts to `/analyze/` in the same
  browser, where the five files are listed as if dropped and the visitor's
  replay renders in the tour's typefaces. The hand-off keeps them for ten
  minutes; `/analyze/` opened from it later says that nothing was handed
  off. The report the tour used to build at its end, its scoring playground
  and the scoring step's weight inputs are gone: the scoring step shows the
  visitor's soft score so far, as the library computes it with the standard
  weights, and the analyzer builds the report and holds the settings that
  apply after collection (its settings panel). The tour has 10 steps.
- Live demo: leaving the tab and opening a browser sidebar are one step
  (step 4, whose text is its task and whose button reads "Done"); the step
  that docked an AI beside the task is gone. The trials in the visitor's
  session file and record are `baseline`, `paste`, `tabaway`, `autotype`,
  `guard-entry` and `guard` (they were `act1-*` and `act2-*`).
- Live demo: new copy on every step. The first step says what the demo is
  for, and its button, "Start the demo", is larger and centred under the
  text. Step 2 asks "How is your day today?" and no longer shows the code
  box with its jsPsych and plain-JS tabs; step 3 asks the same question and
  offers an assistant's answer to copy, in a bordered block between the
  step's text and its task panel. Step 5 opens with what automated bots
  leave behind, and step 6 says what the guard is and that the wording of
  its entry page can be changed. No task panel shows a label, no step has
  a "Skip to the guarded act" link, no text names an act, and a small
  button beneath the primary one reads "← Go back" on every step. The
  last step's closing line reads
  "One script tag is the whole integration; the quickstart shows it."
- Live demo: the guard's step, "Try to break the guard", has no task box.
  Its own text is what the guard scrambles and hides while the visitor is
  out of fullscreen or focus, and the violation chips stay legible under
  it. Its button, "End the guard", is centred under the text. The debrief
  names the reasons the guard records (`not_fullscreen`, `window_blurred`).
- Live demo: the top bar holds only the title, and the recording lamp in
  the rail carries the REC cue, pulsing red while the session records; the
  step count ("Step 2 of 10") is on the card, and the participant ID is no
  longer in the top bar. The lamps panel is its title, a framed box with
  the signals the current step detected ("nothing detected on this step"
  until one fires), the detector lamps and the Guard and Recording groups:
  the intro line, its tooltip, the "awaiting your session" note and the
  Detectors head are gone. The session record under the card has no
  caption.
- Live demo: the live session record sits under the step card on every
  step, collapsed under a bar that opens it on hover or keyboard focus (a
  click on the bar pins it open; step 8, whose text points to it, opens it),
  and the column on the right holds the lamps panel alone, which stay in
  view while the step scrolls. Before, the record was always open, shared
  that column with the lamps and moved under the card for one step only.
- `/analyze/`: the top bar reads "cyborg-hunter · report generator" and
  links the live demo, GitHub (the link that read "docs") and the offline
  version, the single-file page as a download. The paragraph that described
  the page's security policy is gone; the policy is unchanged. The browser
  the page needs is no longer stated in the top bar, only in the warning a
  cohort above the tested size gets. The "Settings from …" line under the
  file list and the settings panel's explanatory paragraph are gone; the
  score weights' Cap column has a tooltip instead.
- Docs: the one-line setup comes first. README and using-cyborg-hunter.md
  show the ch.js tag before the jsPsych extension, and replay with
  `data-replay` and `CyborgHunter.replay()` (saved to DataPipe or to your
  own server) before manual mode's wiring, which is labelled as such.
  configuration.md and signals-reference.md set the monitor's options in
  `window.CyborgHunterConfig`, with `CyborgHunter.init()` shown as manual
  mode's form: with the one-line setup, `init()` logs an error and returns
  a monitor that records nothing.
- CSV files (`summary.csv`, `event-log.csv`, `extensions.csv`, and the
  annotations' Export CSV in the report and on `/analyze/`): a text cell
  that begins with `=`, `+`, `-`, `@`, a tab or a carriage return is written
  with a leading apostrophe (`'`), so a spreadsheet reads it as text instead
  of running it as a formula. Numbers, negative ones included, are written
  unchanged. `event-log.csv` (participant and trial IDs) and
  `extensions.csv` (participant IDs) now quote a value that holds a comma, a
  quote or a line break, as `summary.csv` does.
- Replay viewer: the stage shows the participant's whole recorded viewport,
  scaled to fit on both axes. Before, it took the available width only, and a
  tall recording ran below the window. **1:1** shows the recorded page at
  its own pixel size, scrolling inside the stage's box; **Fullscreen** gives
  the viewer the whole screen. In the CLI report the replay takes the detail
  pane's full width and height, beyond the 800 px column the rest of the pane
  keeps.
- `/analyze/`: the replay frame is as tall as the viewer inside it (it was a
  fixed 640 px, so a tall replay scrolled inside it), the viewer fits the
  page's window, and its **Fullscreen** control works there, the offline
  single file included.
- Experiment assets: an image a replay shows on many elements (a stimulus
  image shown on every trial) is now stored once in the report's replay file
  (`replay/<id>.replay.js`), however many elements show it, and the viewer
  puts it back on each element when the replay loads; the recordings
  themselves are unchanged. A `srcset` keeps its images inline.

### Fixed
- Live demo: the example participant `example-1.json` (offered on the files
  step) records its fullscreen violation as `not_fullscreen`, the reason the
  guard records; it read `fullscreen_exit`, which the guard never records.
  It copies and pastes the question and the answer the tour shows.
- `/analyze/`: a new report opens on its first participant; when that one
  has no replay recording and another has, the replay card stays on the
  first participant with one.
- `/analyze/`: "Export config" writes only the settings that differ from the
  CLI's defaults, plus the participant-ID field. Before, it wrote every
  default key and replaced your own `dataDir`, `filePattern` and `outputDir`
  with fixed values. With experiment files dropped, it sets `assetsDir` to
  `./assets`, and the page says where to put them.
- Report and `/analyze/`: when several data records share a participant ID
  and several replays claim it, no replay is attached, and the replay section
  said the session was never recorded. It now says why no replay is shown and
  names the replay files. The analyze page's replay card gives the reason
  too, and does the same for a replay file that could not be loaded.

### Removed
- Two options of undocumented deep-import paths: `renderIndexHtml`
  (`src/cli/renderers/html-index-core.js`) no longer reads
  `inlineReplayModels`, which embedded replay models in the page, and
  `fontFaceCss` (`src/cli/renderers/font-face-css.js`) no longer takes a
  third `display` argument; its faces always use `font-display: block`, the
  default before. Nothing in the package passed either, and the report is
  unchanged. A call that still passes one gets the default page, or
  `block`.
- Live demo site: `report-frame.js` and `replay-host.js` are no longer
  published at the site's root. The analyze page's bundle holds them, and
  the tour never loaded them.
- Live demo site: `signal-manifest.json` holds what the tour reads. Its
  `presets` block holds only `standard.scoring.soft`, which the scoring
  step prints; `presets.strict`, each preset's `controls` and
  `presets.standard.scoring.softScoreThreshold` are gone.
  `signals.softScoreThreshold`, which the CLI config snippet reads, stays.

## [0.12.0] — 2026-10-07

Qualtrics and lab.js: two more one-line files, `dist/ch-qualtrics.js` for
Qualtrics surveys and `dist/ch-labjs.js` for lab.js studies, next to
`dist/ch.js` for jsPsych and pages without a framework. The CLI and the
`/analyze/` page read both frameworks' data. Also fixes for the one-line
setup on pages without jsPsych (form submits, pages restored from the
back/forward cache), the jsPsych extensions, session replay and the report.

### Added
- One-line setup in Qualtrics surveys: `dist/ch-qualtrics.js` in the
  survey's Look & Feel header writes a capped summary of the session
  (scores, counts and event timings, never text the participant typed or
  pasted) into the declared embedded-data field `__js_cyborg_hunter` at
  every page submit, and stays silent when Qualtrics runs the header again
  on the next page. The CLI and the analyze page read the Qualtrics CSV
  export, one participant per response (`qualtricsField`,
  `--qualtrics-field`). Replay recordings are never written to Qualtrics.
  In a report built from a reduced payload (session entries cut to the
  newest ones), the Sidebar, keyboard-shortcut and AI-extension tiles count
  the whole session from the carried totals while their event cells list
  only the kept entries, so a cell's count can be lower than its tile's.
  See docs/qualtrics.md.
- One-line setup in lab.js studies: `dist/ch-labjs.js`, its tag below
  `lib/lab.js` (lab.js 20.x, what the builder exports). Every lab.js
  component that is shown is a trial, named from the `cyborgHunter`
  component option, the `chTrialId` / `chPhase` parameters or a
  `data-ch-trial` element, and its integrity columns are written into
  lab.js's own rows. ch-labjs.js never overwrites the study's
  `participantId`; its own ID goes into `cyborgHunterParticipantId`.
  A value the study holds under one of ch-labjs.js's column names
  (`integrity`, for example) is kept too: ch-labjs.js then writes its own
  under `cyborgHunter_<name>`, with one console warning per name, and the
  CLI and the analyze page read it from there.
  When the root component ends, the final fields are written onto the last
  trial row and the root row, before `on('end')` handlers run. A lab.js 23
  pre-release is not hooked yet: one warning, and the page runs as one
  without lab.js. See docs/labjs.md.
- One-line setup: one file per framework. `ch.js` stays the file for jsPsych
  and pages without a framework; `ch-qualtrics.js` is the file for Qualtrics
  surveys and `ch-labjs.js` for lab.js studies. The files share the API, the
  tag's attributes and the double-load sentinel, and each carries only its
  own framework's adapter, so participants never download the others. A file
  on a page that runs another framework logs one console error naming the
  file to load (also on the `data-debug` badge) and records the page as a
  page without a framework (one exception: `ch-labjs.js` on a lab.js page
  whose jsPsych loads after it keeps lab.js hooked). `ch-qualtrics.js`
  records a survey whose page also runs jsPsych as a Qualtrics page, with
  one warning. See docs/quickstart.md#which-file.
- CLI and analyze page: the lab.js Transmit plugin's envelope
  (`{ metadata, url, data: [rows] }`, what `datastore.transmit()` posts) is
  read as a participant file. So is any object that holds its rows under
  `data` (a custom server's `{ subject, data: [...] }`, for example), which
  was dropped before. An incremental Transmit slice
  (`metadata.payload: "incremental"`) is read with a warning: ingest only the
  final `full` body.
- CLI and analyze page: lab.js data from the one-line setup (`exportJson()`,
  the Transmit body, `exportCsv()`, or those rows wrapped as
  `{ trials: [...] }`) is keyed by the study's own `participantId`, even one
  first set on a later screen, else by the setup's
  `cyborgHunterParticipantId`; when the two differ, the setup's id is kept in
  the participant's metadata as `cyborgHunterParticipantId`, and a session
  recording that carries that id is attached to the participant (when no
  other participant carries or is keyed by it). A file whose rows carry more
  than one setup id, or more than one `participantId` besides it (several
  sessions in one file), is read with a warning, and the setup's id is not
  used to attach a recording to it.
- Analyze page: for an object that holds its rows under `data` (the lab.js
  Transmit body), the participant ID field is suggested from its first row
  and its own top-level fields, never from its `metadata` (where `id` is
  lab.js's upload-session id).
- Standalone replay recorder (`CyborgHunterReplay.attach()`):
  `resumeSession()` records again after `stopSession()`, in later segments of
  the same recording; call `startTrial()` right after it.
  `startTrial({ extensions })` sets a segment's vendor `extensions`. The
  one-line setup uses both for a page restored from the back/forward cache,
  marking its segment `extensions["cyborg-hunter"].restored_from: "bfcache"`.
  A value that is not an object keyed by lowercase vendor names (`"my-lab"`),
  or that holds anything a JSON copy would change (a function, `undefined`,
  `NaN`, a `Date`), is left out whole and logged as a `segment_extensions`
  capture failure.

### Changed
- CLI: with `--participant`, a replay recording that has no embedded
  participant ID is judged against every participant file in the data, as
  in a run without the filter. A file name that also fits another
  participant there (`A` and `a`, say) is now ambiguous and not attached;
  before, the filtered run attached it.
- CLI and analyze page: a participant ID that is a number (a CSV column
  holding numbers, or a study that stores one) is read as its string. Before,
  such an ID stopped the whole report at the first plot
  (`name.replace is not a function`), and `--participant 42` could not find
  it. `0` and `false` are IDs now; a missing, `null` or empty ID is still
  `unknown`.
- CLI and analyze page: a participant file that is a top-level array of rows
  (lab.js `exportJson()`, a JATOS result) is now keyed by the first row
  carrying `participantId` (or `integrity.participantId`) instead of
  `unknown`. Existing Shape-3 cohorts that relied on the `unknown` key get
  their real ids; re-run `cyborg-hunter report` once after upgrading. Such a
  file is now also read like a `{ trials: [...] }` file: a session report,
  rolling segments, a honeypot disclosure and error markers on its rows are
  found, where before the report said it had no session-level data.
- Experiment assets (`assetsDir`, files dropped on `/analyze/`): a file whose
  path differs from the recorded URL only in upper/lower case now matches
  when no file matches exactly. Such files are ranked the same way as exact
  ones: the best-fitting one is used; if several fit equally well, the URL
  is reported as ambiguous.
- The experiment-assets note no longer counts video and audio sources as
  images that never match: it says how many video/audio elements are shown as
  placeholders and that replays never play media. A video's poster is still
  an image.
- CLI report: a session replay no longer requests the recording's video and
  audio files. The replay frame's policy now blocks media
  (`media-src 'none'`), as the analyze page's does, so opening a replay no
  longer sends the analyst's address to the server that held the
  experiment's media. Replays never played media; the elements are still
  drawn as placeholders.
- Experiment assets now also cover `srcset` candidates (on `<img>` and on a
  `<picture>`'s `<source>`), an SVG `<image>`'s `href`/`xlink:href`, and an
  `<input type="image">`'s `src` (also when the input becomes an image button
  later in the session): each is matched, inlined when supplied, and counted
  among the images in the note.
- `/analyze/`: when a check or a build sends no progress for a minute, the
  page shows "Still working — this is taking longer than usual. If nothing
  changes in a few minutes, reload the page." under the step. The next
  progress, the result, an error or Start over hides it. Nothing is cancelled
  or restarted.
- A jsPsych call-function (or other synchronous) step labelled with
  trialId/phase now keeps that label on its row; unlabelled steps keep
  `gap-<n>`. Rows recorded by 0.10.x–0.11.x for such steps were labelled
  `gap-<n>`.

### Fixed
- One-line setup on pages without jsPsych: more form submits that keep the
  page no longer lose the data recorded after them. A form target with
  spaces around it (`target=" "`, `" _self "`) names another window, as
  browsers read it. A `submit` event the page dispatches itself
  (`form.dispatchEvent(new Event('submit'))`) is no longer taken for a page
  load; Chromium and WebKit submit nothing for it. Firefox does send the
  form, and on such pages its participants get one extra, empty segment;
  nothing is lost. A POST form with a control named `method` now gets the
  `cyborgHunterData` hidden input, so its backend receives that field too;
  a `method="dialog"` form with such a control counts as a dialog submit,
  not a page load. A form with a control named `getAttribute` or
  `hasAttribute` no longer makes the submit handling throw; before, an error
  was logged and the post carried no `cyborgHunterData`.
- One-line setup on pages without jsPsych: what the participant does after
  a same-window form submit is no longer lost when the page stays (the
  server answers 204 or with a download, the action is `javascript:`, or the
  participant answers a "leave this page?" prompt with Stay) or while the
  next page is still loading. It is saved as its own segment when the page
  is left, and a later `form.submit()` posts it. A submit that the next page
  follows with nothing done in between still adds no segment; mouse movement
  or waiting alone does not count.
- One-line setup on pages without jsPsych: a form whose own `submit` handler
  changes its method or target is handled as the browser sends it. Switched
  from GET to POST, it now carries `cyborgHunterData`; switched from POST to
  GET, the blob no longer goes into the URL; sent into a new window instead
  of this one, the data recorded after it is kept. A handler that disables
  the form's inputs (against double submission) no longer drops
  `cyborgHunterData` either. Browsers without the `formdata` event keep the
  earlier behaviour for these.
- One-line setup: a boot that fails before the page has loaded (ch.js in
  `<head>`) logs one "Cyborg Hunter did not start" error with its cause;
  before, a second one followed, quoting a monitor lifecycle message that
  hid the cause.
- `/analyze/`: selecting a participant without a replay recording in the
  report no longer leaves the previous participant's replay on screen. The
  replay card closes it and says `Participant <id> has no replay recording.`;
  Load stays disabled until a participant with a recording is selected.
- One-line setup with `data-replay` on pages without jsPsych: a page the
  browser shows again from the back/forward cache (Back) now records on, from
  a keyframe segment marked
  `extensions["cyborg-hunter"].restored_from: "bfcache"`. If
  `CyborgHunter.replay()` was not called before the participant left,
  recording continues in the same recording. If it was (for example in the
  submit handler, as the docs recommend), `replay()` after Back returns a new
  recording of the restored visit, starting with that marked segment, instead
  of the earlier recording again; save every recording it returns. Before,
  everything after Back was missing from the replay.
- Integrity monitor: mouse clicks (and mousedown/mouseup) are recorded
  before the page's own handlers on the document and its elements run. A click that ends a trial, such as a
  jsPsych response button, a `data-ch-trial` mark or a button whose `onclick`
  submits the form, is now in that trial's `mouseTrack`; before, it was
  recorded in the span after it or not at all. A click whose handler stops
  its propagation is recorded too.
- Session replay: an input value, scroll, touch move or viewport change in
  the last animation frame before a segment ends now stays in that segment.
  Before, it arrived a frame later in the next segment, timed before that
  segment began; at a stop (`stopSession()`, `CyborgHunter.replay()`, leaving
  the page) it was lost; and on a page restored from the back/forward cache
  it landed in the restored segment.
- Report (CLI and `/analyze/`): a replay recording with a list field of the
  wrong shape that the viewer still plays (`stylesheets: {}`, a node's
  `children: {}`, a `null` event) no longer stops the whole report. Before,
  the index page failed on such a recording, and with experiment assets so
  did the asset matching. A recording the matcher cannot read at all is left
  out of the matching with a warning, and keeps its replay without the note.
- jsPsych extension (`jsPsychCyborgHunter`, manual wiring): the late load
  callback of a synchronous step (a `call-function`, say) no longer starts a
  monitor trial. With every trial opted in, as the docs' `forEach` does, it
  threw `invalid lifecycle call: cannot transition from 'trial'` into
  jsPsych, and after a `post_trial_gap` the next trial's row carried the
  step's `trial-<n>` label.
- jsPsych replay extension: the late load callback of a synchronous step (a
  `call-function`, say) no longer opens a replay segment. Followed by a
  `post_trial_gap`, it opened a segment for the step that had ended;
  followed by a trial that returns a Promise (audio plugins), it started that
  trial's segment early, under the step's `trialId`. Either way the real
  start then logged a `lifecycle` capture failure. With the one-line setup a
  researcher's own per-trial replay entry without `params` is covered too.
- One-line setup: a page that loads `ch.js` twice (two tags, or two
  versions) gets a double-load error whose fix says to load `ch.js` once and
  keep one of its `<script>` tags. Before, the fix said to load only one of
  `ch.js` and `cyborg-hunter.min.js`, a file the page did not load.
- Report (CLI and `/analyze/`): the ▸ toggle beside a long paste now shows
  its full text. Before, a click hid the preview and showed nothing.
- Report (CLI and `/analyze/`): "… +N more" under a session-level signal
  (AI extensions, sidebar events, keyboard shortcuts) now opens the rest of
  the list. Before, it was plain text, and the rest was nowhere in the report.
- Report (CLI and `/analyze/`): the "Sidebar events" list shows one line per
  sidebar opening (its width change, its time and how long it stayed open),
  as many as the Sidebar count above it. Before, it listed every open and
  close entry of the log, and a sidebar seen by both detectors twice.
- `/analyze/`: a replay recording among the dropped files no longer empties
  the participant ID suggestion. The check step skips recordings when it
  reads the files' columns; before, one recording left no candidate and the
  page fell back to `participantId`, which is wrong for jsPsych's
  `subject_ID`. The line beside the field counts the data files read and
  the recordings skipped.
- CLI and analyze page: a CSV participant ID keeps its text (`007` stays
  `007`, and so does ch-labjs.js's ID on lab.js rows). Before, `007` was
  keyed `7`, so its replay recording did not attach and `--participant 007`
  found nothing.

### Removed
- Internal renderer wrappers removed
  (`src/cli/renderers/{trajectories,session-timeline,typing-profile,html-index,replay-assets}.js`).
  The report is unchanged. Deep imports of these undocumented paths no longer
  resolve.

## [0.11.0] — 2026-10-02

The report in the browser: the `/analyze/` page on the project site builds
the CLI's report from dropped data files, with nothing to install and nothing
uploaded. Also fixes for the one-line setup on pages without jsPsych and for
the replay viewer. No change to scoring or data formats.

### Added
- `/analyze/` page: drop the data files (or a folder) and get the CLI's
  report, built in the browser: the interactive report with replays,
  `summary.csv`, `triage.md`, `event-log.csv`, the plots, and a `.zip` in the
  CLI's output layout. The page's security policy makes the browser refuse
  data requests, form submissions and loads from other addresses. Its code
  never navigates away or opens another page, and the end-to-end tests fail
  the build if it does.
- The page as one offline file, `cyborg-hunter-analyze.html`, attached to
  each GitHub release.
- CLI: `assetsDir` config key and `--assets-dir` flag. The experiment's own
  stylesheets, images and fonts style the replays when its server is gone;
  `url()` and `@import` references inside a supplied stylesheet are matched
  too. The replay section of the report says what matched and what is
  missing.
- Report option `selectionPostMessage` (the report tells its parent page
  which participant is selected) and replay-viewer option `noExternalCss`
  (a viewer that may not fetch says so instead of offering a fetch). Both
  are off by default.

### Changed
- The node-canvas install message now prints before "Analyzing...".
- The analyze page's security policy no longer allows images from the
  page's own site (`'self'` dropped from `img-src`), so a dropped stylesheet
  or recording cannot make the browser request anything from the hosting
  site.
- Dev dependencies updated: esbuild 0.28, happy-dom 20.14. `npm audit`
  reports no vulnerabilities.

### Fixed
- One-line setup on pages without jsPsych: a form submit that did not
  replace the page could lose the data recorded after it. This happened when
  the form posted into another window or a frame, when `submit()` was called
  on a form outside the document, when two submits ran in one click, or when
  a same-window post did not leave the page (a 204 answer, a download, Stop)
  and a later submit was cancelled. The final pagehide now keeps that data.
  A cancelled submit whose handler then calls `form.submit()` now counts as
  the page load instead of leaving an empty segment.
- One-line setup: with `data-debug`, after the hand-over to the page's own
  extension the summary now says manual mode, instead of "0 trials
  instrumented" with ch.js's guard settings.
- Replay: a recorded attribute change can no longer turn `autoplay` back on
  for a video or audio element.
- Replay: on pages whose body has no percentage height, interactions at the
  bottom of the page no longer replay 8px off.
- The CLI warns when `cyborg-hunter.config.json` holds something other than
  a JSON object (null, a list, a string, a number). Its settings were
  silently ignored. The analyze page warns too.
- Analyze page and `assetsDir` (fixed before their first release): Start
  over frees the previous run in the worker; a failed run keeps the config
  warnings; dropping a mix of files and folders keeps every file;
  references in recorded stylesheet updates and uppercase `URL(` and
  `@IMPORT` are matched.

### Notes
- The analyze page reads multi-member `.json.gz` recordings and rejects
  corrupt gzip files as the CLI does, with one difference: when the data
  after a gzip member starts with a zero byte, the CLI ignores it and the
  page rejects the file.
- The analyze page was tested with up to 150 participants in Chromium,
  Firefox and WebKit; it warns above that. The CLI is not limited by browser
  memory.
- Qualtrics support and the heuristic detector move to a later release.

## [0.10.0] — 2026-10-01

A one-line setup: a single `<script>` tag, `dist/ch.js`, monitors an
experiment and writes the integrity data into the data the experiment already
saves. Manual mode (the jsPsych extension wired by hand) is unchanged.

### Added
- `dist/ch.js`, the one-line setup, for jsPsych 7 and for pages without
  jsPsych. Below `jspsych.js` it monitors every trial, nested timelines
  included, with no extension list, per-trial loop or `finalize()` call.
  Without jsPsych, trials are marked with `data-ch-trial` or
  `CyborgHunter.mark()`. The participant ID comes from the study URL or
  `data-participant-id`; the guards are set with `data-guards`.
- Rolling snapshot: under ch.js each row carries `integritySegment` (what
  happened since the previous row, with running counters and score) and
  running totals. At the end of the session the last row gets
  `integritySegmentFinal` and every row gets the end-of-session totals under
  `*Final` names (`integritySoftScoreFinal`, `integrityPasteCountFinal`, …).
- CLI: the rolling snapshot is a fifth session-lookup convention, next to the
  four it already reads. The CLI joins the segments into the session report;
  for a session spread over several pages it re-bases each page's times onto
  the first page and sums the pages' counters and scores.
- `data-debug`: an on-page badge and a console summary while piloting.
- `data-replay` records a session replay. ch.js loads the replay recorder
  only when this attribute is set.
- On the browser global: `CyborgHunter.data()` (the object to save on a
  page without jsPsych), `CyborgHunter.mark()` (a trial boundary) and
  `CyborgHunter.replay()` (the recording, for your save code).
- `docs/advanced-integration.md`: manual mode, switching to the one-liner,
  double loads, friction, the honeypot ethics note and the data format.

### Changed
- Under the one-line setup the honeypot is on by default
  (`data-guards="none"` turns it off). In manual mode it still runs only when
  `jsPsychGuardHoneypot` is listed.
- The README and quickstart lead with the one-liner; manual mode moved to
  `docs/advanced-integration.md`.
- A double load now logs an error in the console. `cyborg-hunter.min.js`
  loaded twice, or after ch.js, no longer silently replaces the namespace,
  and the guard files no longer throw when ch.js already defined the guards.

### Notes
- No change to manual-mode data formats. The CLI reads files from both
  setups.
- ch.js monitors the whole page, so events before the first trial and
  between trials count toward the counters and the soft score. Manual mode
  counted only events inside trials, so soft scores of a study moved to ch.js
  can be higher.
- Under ch.js, `trialsCompleted` counts the spans between boundaries, not
  jsPsych trials.
- Qualtrics support and the heuristic detector arrive in 0.11.0.

## [0.9.2] — 2026-10-01

A maintenance release: documentation for keeping replays on your own server,
one small browser-global addition, and a hardening fix in the replay viewer. No
change to scoring or data formats.

### Added
- SessionRecording v2 conformance package in the repository
  (`packages/sessionrecording-conformance`, a workspace package; not published
  to npm): the fixture corpus, the validator, a JSON Schema and TypeScript
  types, run with `npm run test:package` (part of `npm test`). The validator
  the CLI uses is a generated copy of the package's, checked for drift before
  every test run.
- Docs: saving the replay to your own server instead of DataPipe
  (`autoSave.mode: 'none'`, `getRecording()`, a POST to your endpoint, and the
  file name the CLI expects).
- `CyborgHunterReplay.replayFilename` on the browser global, next to
  `attach`. It was an ES-module export only, so script-tag users could not
  produce the `<id>-replay-<epoch>.json` name the CLI matches on.
- `scripts/check-public-hygiene.sh` can also check a commit message:
  `GATE_COMMIT=<rev>`.

### Changed
- Research tooling (the benchmark harness and investigation probes) moved out
  of this repository. No change to the published package.
- The per-release notes for 0.6.1 and 0.7.0 are merged into
  `docs/upgrading.md`.
- The recorder options table in `docs/using-cyborg-hunter.md` is refreshed
  (`participantId`, `clipboardContent`, `autoSave.experimentId`; clipboard
  capture is length-only by default).

### Fixed
- Replay viewer: a replayed attribute event can no longer re-arm an iframe
  placeholder's `src` or `srcdoc`. The viewer's Content Security Policy
  already blocked the load; this is defence in depth.
- Stale docs in `docs/using-cyborg-hunter.md`: the verify step names
  `mouseTrack` (not `mouseEvents`); the replay meta pointer's size key is
  `bytes_uncompressed`; the canvas tier no longer refers to v0.8; the
  "no network calls" statement now covers the integrity monitor only, since
  the optional replay recorder saves a separate artifact.

### Notes
- After pulling, run `npm install`: the tests resolve the workspace package.
- Installing from a git URL runs the `prepack` script, which regenerates
  `src/shared/schema-v2-validator.js` from the workspace package.

## [0.9.1] — 2026-10-01

A visual redesign of the HTML triage report and the live demo. No change to
scoring, data formats or the browser library's behaviour.

### Changed
- Report typefaces: six Google Fonts families (Space Grotesk, Tomorrow, Sofia
  Sans, Sora, Recursive, Major Mono Display) are embedded in every
  `index.html` as base64 WOFF2 (about +227 KB), so the report stays a single
  offline file. Each text role uses one of them; their OFL licences ship in
  `src/cli/renderers/fonts/`.
- Report shapes: high-contrast neutrals, square badges, tiles and boxes, a
  double rule under the header, soft shadows on cells and plots, an outlined
  selected participant row, the filter chips as one segmented control, hairline
  boxes for the triage note and paste evidence, a round ink play button in the
  replay viewer, and larger keycast chips.
- Replay viewer: the cursor trail is drawn as fading breadcrumb dots instead of
  a line.
- Live demo: restyled in the same aesthetic (fonts, neutrals, segmented tabs,
  square cards). The report and replay viewer embedded in the demo now get the
  report's fonts and the CLI's own replay CSS, replacing a hand-kept copy that
  had drifted.
- `.mono` in the report now defaults to Sora with tabular figures; form
  controls no longer fall back to the browser's default font.

## [0.9.0] — 2026-09-29

The report's triage-score weights are configurable from the CLI config. Default
output is unchanged; the browser library is unchanged apart from recognising
`scoreWeights` as a known config key.

### Added
- Report-score weights are configurable: `scoreWeights` in
  `cyborg-hunter.config.json` reweights the triage score's terms, gives a
  weight to any of 16 signals (e.g. `{"synthetic": 1}` for one point per
  synthetic insertion), and can cap a signal's count per participant with
  `{"weight": n, "max": m}`. Entries merge per key onto the defaults, which
  reproduce the 0.8.0 score exactly. The hard/soft/clean tier is unaffected.
- Every report writes `score-weights.json` with the weights its score used;
  the HTML top bar and `triage.md` state custom weights when they are set.

### Changed
- The CLI now warns when a config contains the browser library's
  `scoring.soft` / `scoring.hard` rules, which the report never read, and
  points to `scoreWeights`. Invalid or unknown `scoreWeights` entries warn
  (with a "did you mean") and fall back to the defaults.
- The HTML score breakdown draws the terms the ranking actually used.

## [0.8.0] — 2026-09-17

The session-replay recorder now writes SessionRecording v2 (`schema_version: 2`), the
format developed jointly with jsPsych; v1 recordings are converted on ingest.

### Added
- Replay recordings are self-contained for cross-origin stylesheets: the
  recorder fetches (CORS, no credentials) the text of any `<link>` sheet whose
  rules the browser refuses to expose and inlines it at session start. Sheets
  whose server refuses CORS stay href-only, as before.
- Report: when a recording still has href-only sheets, "Load replay" gains a
  ticked-by-default "also fetch N external stylesheet(s)" checkbox, and the
  viewer shows a banner ON the stage whenever it plays unstyled (a sheet
  skipped or failed to load). The in-viewer "Load external CSS" opt-in remains.
- Viewer shell declares `html{height:100%}` so a recorded `body{height:100%}`
  (jsPsych's display element) lays out as on the live page; without it a
  centred page rendered top-left and every alignment check failed.

### Changed
- `collectForPostHoc.rawMouseTrack` now defaults to **true**: the raw mouse
  track (`mouseTrack`) ships in every trial report, so the CLI's trajectory
  panels are populated out of the box. Set it to `false` to keep only the
  derived `mouseMetrics`. Rationale: adding CH to an experiment is already
  the decision to collect behavioural traces, and the off-by-default gate
  made the panels read "no mouse data" for anyone who never found the
  toggle.
- The SessionRecording v2 validator moved from the test tree into shipped
  code (`src/shared/schema-v2-validator.js`); the converter CLI no longer
  needs a repo checkout to strict-validate its output.

### Fixed
- Replay ingest (A3 review round): foreign v2 artifacts whose filename
  happens to match CH's `-replay-<epoch>` pattern no longer vanish; jsPsych
  v1 recordings are recognised by `schema_version`, so malformed ones reach
  the converter's remedy message; gzip is detected by magic bytes as well
  as suffix; unreadable candidates in an explicit `replayDir` are reported;
  converted recordings are strict-validated in memory and attach with a
  warning naming the malformed fields; converter exceptions that are not
  declared refusals are reported as internal failures instead of being
  blamed on the file.

### Docs
- Local testing in `autoSave.mode: 'download'`: Chromium-based browsers
  block the second automatic download (the CSV after the replay, or vice
  versa); use Firefox/Safari or allow automatic downloads for localhost.
  Remote (`datapipe`) saves are unaffected.
- README and integration guide now describe the shipped SessionRecording v2
  recorder, the v1 converter and the joint spec; the repo layout and the
  documentation index list `tools/convert/`, `bench/`, `demo/`, the v2 spec,
  the migration guide and `known-issues.md`.

## [0.7.5] — 2026-08-05

### Added
- `GuardFriction.exitFullscreen()`: prefix-aware counterpart to
  `requestFullscreen()`; a no-op when not fullscreen and while the guard is
  armed (call it after `stop()`).

### Changed
- Live demo: the report screen now leaves fullscreen through the plugin, and
  the live-session record gained a per-trial tab rail (`All` first) that
  filters the stream to one trial at a time.

## [0.7.4] — 2026-08-04

### Changed
- Repository moved to a GitHub organization: the canonical repo is now
  https://github.com/cyborg-hunter/cyborg-hunter and the live demo lives at
  https://cyborg-hunter.github.io/cyborg-hunter/. The old repo URL and git
  remotes redirect permanently; the old demo URL does not (GitHub Pages
  never redirects). All package links, the CLI's crash-footer issue URL,
  the demo's GitHub links, and citation metadata now point at the org.
  No functional changes.

## [0.7.3] — 2026-08-04

### Added
- `report` now nudges about newer releases: a zero-dependency check against
  the npm registry's `latest` dist-tag prints a short update notice after the
  report summary. At most one registry request per day (cache file in
  `~/.cache/cyborg-hunter/`), silent on any network failure, skipped under
  `CI` or `NO_UPDATE_NOTIFIER`, and CLI-only — the browser library still
  makes no network requests of its own.
- `report` prints an offline staleness note when ingested sessions were
  collected with a different library version than the CLI (payloads stamp
  `libraryVersion`). This catches the case the registry check can't: an
  experiment still serving an old bundle to participants.

## [0.7.2] — 2026-07-29

### Added
- Replay viewer: a keycast overlay at the bottom of the stage shows keys as
  they're pressed (chips appear on keydown, fade after keyup), including a
  redacted chip for keystrokes captured with `keys:'full'` inside a
  redacted field. Recordings made with `keys:'off'` show no keycast, since
  there's no key data to show.
- Replay viewer: the buffer-cap notice is now an expandable explanation
  (was a one-line chip) covering what `maxEventsPerTrial`/`maxCharsPerTrial`
  actually cap (per trial, not the whole session), what happens when a
  trial crosses one, and that both are configurable. Mirrored in
  `docs/using-cyborg-hunter.md`'s configuration table.
- Replay viewer: continuous whole-session playback, default on. Pressing
  play now rolls through every trial in the recording as one continuous
  video instead of stopping at each trial boundary; a "pause at trial
  boundaries" toggle restores the previous per-trial-stop behavior. A
  "Trial k of N" indicator tracks position across the session.

### Changed
- Internal refactor, no behavior change: the report index renderer and its
  three plot renderers (session-timeline, trajectories, typing-profile) are
  each split into a pure core (string- or canvas-returning) plus a thin fs
  wrapper; `buildViewerModel` and `getByPath` moved to pure shared modules.
  `renderIndexHtml` also gained optional demo-mode opts (`imageSources`,
  `inlineReplayModels`) for inline image/replay embedding, with a hash-sync
  guard for the opaque-origin iframe the demo renders reports inside. Together
  these let the live demo render reports and plots directly in the browser;
  default (CLI) output is byte-identical.
- The live demo (https://konukcan.github.io/cyborg-hunter/) was remodeled
  into a 13-step guided tour; not part of the npm package.

### Fixed
- Raw mouse coordinates were persisted in every trial report regardless of the
  documented off-by-default `collectForPostHoc.rawMouseTrack` toggle. Reports
  now omit the raw track unless the toggle is enabled, in which case it
  persists as `mouseTrack` (ingest maps it back to `mouseEvents`); the derived
  `mouseMetrics` signal is unaffected either way.

## [0.7.1] — 2026-07-29

### Fixed
- The npm package now includes `dist/` — 0.7.0 shipped without it, so every
  documented unpkg/script-tag URL returned 404.
- `cyborg-hunter --version` prints the version instead of "Unknown command".

## [0.7.0] — 2026-07-14

### Added
- Session replay recorder (`dist/cyborg-hunter-replay.js`, opt-in): captures pointer,
  keys, clipboard, scroll, touch, viewport, and (at the `dom` tier) DOM snapshots +
  mutations. Wire format is jsPsych's `SessionRecording v1` with a `ch_extensions`
  namespace.
- CLI report gains a per-participant replay viewer (scrub bar, cursor trail, event
  markers); `dom`-tier recordings reconstruct the page in a sandboxed iframe.
- Autosave and CLI ingest of replay artifacts, with ownership verification and
  reload-collision handling.
- Guard-honeypot and guard-friction events are captured in the replay stream.

### Changed
- Replay viewer uses a per-trial camera model for cursor/DOM alignment; legacy
  recordings fall back to a clearly-labeled reduced-alignment mode.
- Password inputs are redacted unconditionally in replay capture; clipboard events
  record lengths only, not content.

### Fixed
- `drop` listener was incorrectly gated on the `paste` signal flag.
- Idle-gap and element-trace timers leaked per session instead of being trial-scoped.
- Edge-exit analysis silently found nothing on modern payloads due to a mismatched
  time base.
- Shape-3 (top-level array) ingest dropped outer trial fields and skipped tab-away
  normalization.
- Malformed replay artifacts no longer abort the report; `autoSave()` no longer
  throws on circular/BigInt data.

## [0.6.2] — 2026-07-12

### Fixed
- Cut events now count toward the hard-copy screenout (previously recorded but
  never incremented the session copy count).
- Misconfigured scoring overrides (e.g. a nested typo) now warn instead of
  silently disabling a rule.
- Fullscreen detection is prefix-aware, fixing false violations on Safari <16.4
  and some iOS WebViews.
- Honeypot re-initialization no longer inherits a prior run's violations/state.
- `decoyAnswer: false` per-trial opt-out is now honored (was coerced to `null`).
- A payload with both `trials` and `responses` no longer loses its integrity trials.
- A non-array signal field no longer crashes the report; ingest now coerces and warns.
- A numeric `trialId`/`ruleId` no longer crashes the trajectory renderer.
- `findGuardViolations()` now scans all trials instead of locking onto the first.

### Added
- Warnings for an unresolved `participantIdField`, duplicate participant IDs, an
  unmatched `phaseScope` phase name, and a non-numeric `scoring.softScoreThreshold`.

## [0.6.1] — 2026-07-06

### Added
- `endTrial()` stamps a wall-clock ISO `timestamp` on the trial report.
- Session-level `tabAwayEvents[]` alongside `tabAwaySums`, preserving full timing
  for tab-aways outside `startTrial`/`endTrial`.
- `participantIdField` accepts dot-paths (e.g. `"metadata.sessionId"`).
- `sessionIntegrityPath`, `phaseScope`, and `trajectoryDisplayOrder` config options.
- `showPlatformId` flag (default off) to render a platform ID as a secondary line
  in the HTML report.
- `--config-file` accepted as an alias of `--config`.

### Changed
- `layoutShifts` renamed to `viewportWidthShifts` (old key kept as a deprecated
  alias); the signal measures viewport-width changes, not Web Vitals CLS.
- Viewport-shift logging is debounced (250ms default) instead of firing per
  animation frame.
- Trajectory panels are tinted by phase; `triage.md` carries an explicit Tier column.

### Fixed
- `sessionIntegrityPath` no longer accepts a wrong-shaped object at the resolved
  path, which had silently zeroed downstream signals.

## [0.6.0] — 2026-06-25

No public API was removed. Re-running the report on existing data may shift
triage scores/ordering (sidebar, tab-away, and hard-flag corrections); newly
collected data no longer saves raw per-keystroke timings by default.

### Changed
- Sidebar events are counted as distinct openings, not raw log entries.
- Hard-flag fallback now uses the cumulative session total against the count
  threshold, not per-trial hits.
- Tab-away binning matches the runtime's strict cutoff.
- Triage ranks tier-first (hard → soft → clean), then by score.
- The CLI honors each participant's own saved thresholds instead of generic defaults.

### Added
- Guard-honeypot self-disclosure surfaced in the report (`honeypot_ai_use`,
  `honeypot_ai_report` columns).
- `finalize()` persists the runtime config so the CLI can reconstruct each
  participant's screening settings.

### Privacy
- Raw per-keystroke timings are no longer persisted by default
  (`keystrokeDynamics` toggle); only derived typing speed is kept unless opted in.

### Fixed
- Restored the authoritative session score for two saved formats that had been
  dropped, causing over-flagging.
- Session-timeline offset estimation no longer drifts for legacy participants.

## [0.5.1] and earlier

See the git tags `v0.4.0`, `v0.5.0`, `v0.5.1` for prior releases (no changelog
was kept before 0.6.0).
