# lab.js

The one-line setup on a [lab.js](https://lab.js.org) study: one tag, every screen a trial, and the integrity data in the rows lab.js already saves. ch.js hooks lab.js 20.x, the version the lab.js builder exports as `lib/lab.js` ([lab.js 23](#labjs-23) is not supported yet).

## Setup

**Builder export.** Export your study (to any target) and open its `index.html`. Put the ch.js tag below `lib/lab.js` and above `script.js`, the study script:

```html
<script src="lib/lab.js" data-labjs-script="library"></script>
<link rel="stylesheet" href="lib/lab.css">
<script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>
<script defer src="script.js"></script>
```

The builder writes a new `index.html` on every export, so add the tag again after each export.

**Study written in code.** The same order: `lib/lab.js` from a script tag, then ch.js, then the script that builds the study and calls `study.run()`. ch.js hooks lab.js when it loads: if the study is already running then, the screen on display is not monitored ([Placement](#placement)).

The participant ID comes from the study URL, `data-participant-id` or `CyborgHunterConfig.participantId`, as on any page ([quickstart → Participant ID](quickstart.md#participant-id)). The tag's other attributes (`data-preset`, `data-guards`, `data-replay`, `data-debug`) work as described in [quickstart → Configuration](quickstart.md#configuration). With `data-debug`, the badge reads `lab.js <version> detected` and counts the trials as they run.

The honeypot is on by default, as everywhere ([ethics and IRB note](advanced-integration.md#honeypot-ethics-and-irb-note)). Friction, with `data-guards="honeypot,friction"`, starts enforcing when the participant clicks an element with `data-ch-friction-start` in a screen's content, or when your code calls `CyborgHunter.startFriction()` ([Friction](advanced-integration.md#friction)). `CyborgHunter.frictionEntryTrial()` is a jsPsych trial and has no use here.

## Placement

lab.js must be loaded from a script tag, so that it defines `window.lab` before ch.js loads, and the study must start after ch.js has loaded. These console messages say when that is not the case:

| Console message | Cause | Fix |
|---|---|---|
| `Not monitoring lab.js components: ch.js was loaded before lib/lab.js` | the ch.js tag is above `lib/lab.js` | move it below `lib/lab.js` and above your study script |
| `Not monitoring lab.js components: the page has a data-labjs-section element but no window.lab` | `lib/lab.js` did not load (a wrong path, a 404, a blocked request), or lab.js is bundled (npm, ES modules) and never defines `window.lab` | load `lib/lab.js` from a script tag above the ch.js tag; a bundled build cannot be hooked |
| `The lab.js screen on display when ch.js started is not monitored` | the study started before ch.js loaded, so the screen on display then has no integrity columns in its row | move the ch.js tag below `lib/lab.js` and above your study script |
| `lab.js <version> is not supported yet` | the page loads a lab.js 23 pre-release | see [lab.js 23](#labjs-23) |
| `Cyborg Hunter could not hook a lab.js component` | a ch.js hook failed on a component; that component's row carries a `cyborgHunterError` column saying what failed, and the study runs on | open an issue with the message and your script tags |
| `A second lab.js study ran after the first ended` | ch.js records one session per page and ends it when the first study's root component ends, so components run after that have no integrity columns | run one study per page, or reload the page between studies |
| `CyborgHunterConfig.replay.autoSave is ignored` | the recorder saves itself only on a jsPsych page ([Replay and canvas](#replay-and-canvas)) | save `CyborgHunter.replay()` in your own save code |

ch.js logs the hook failure once per page, however many components it affects.

After either `Not monitoring lab.js components` error, ch.js runs as on a page without lab.js: it records the session but writes nothing into lab.js's rows, and `CyborgHunter.data()` returns what it recorded ([Vanilla segmentation reference](advanced-integration.md#vanilla-segmentation-reference)).

## What counts as a trial

Every component that is shown is one trial, with one segment in the data: `html.Screen`, `html.Form`, `html.Page`, `canvas.Screen`, and any other component without children. Containers (`flow.Sequence`, `flow.Loop`, `html.Frame`, `canvas.Frame`) still commit their own row, but it gets no integrity columns. A `flow.Parallel` runs its children at once and is one trial; the components under it are not trials.

Three kinds of component are not trials: a skipped one (`skip`), a `core.Dummy`, and one with `datacommit: false`, which commits no row. What happens while one runs, like the time between two trials (a Frame drawing its context, a Loop preparing its next iteration), goes into the next trial's segment as its gap: a paste there counts, and the segment's `gap` shows it ([Data format: the rolling snapshot](advanced-integration.md#data-format-the-rolling-snapshot)).

`CyborgHunter.mark()` and `CyborgHunter.data()` are calls for pages without lab.js or jsPsych. Here they log a warning and do nothing, because lab.js's components are the trial boundaries.

## Naming trials

A trial's segment is named from the first of these that is set:

1. the component option `cyborgHunter`: `new lab.html.Form({ cyborgHunter: { trialId: 'recall-1', phase: 'test' } })`. It takes the keys of the jsPsych extension's per-trial params: `trialId`, `phase`, `decoyAnswer`, `experimentContainer`;
2. the component parameter `chTrialId`, which the builder can set. `chPhase` and `chDecoyAnswer` set the phase and the decoy answer the same way;
3. a `data-ch-trial="recall-1"` attribute on an element of the component's content, on an `html.Screen`, `html.Form` or `html.Page`;
4. the component's `sender_id`, the id lab.js writes into its row (`0`, `1_2`, …);
5. `trial-<n>`, for a component without one.

lab.js passes parameters down to every component inside a container. A `chPhase` on a Sequence or Loop sets the phase of every trial inside it. In a Loop, a `chTrialId` column in the loop's parameters names each iteration (`item-1`, `item-2`, …). A `chTrialId` set on a container gives every trial inside it the same name, so set it on the screen itself, or per iteration of a Loop.

A component without a name of its own that runs a second time gets `#2` after its `sender_id` (`3#2`).

## Where the data goes

ch.js writes into the data lab.js already collects. Each trial's row gets:

- `integrity`: the trial report;
- `integritySegment`: what happened since the previous trial, with the trial's name in its `trialId` ([Data format: the rolling snapshot](advanced-integration.md#data-format-the-rolling-snapshot));
- `integrityPasteCount`, `integrityCopyCount`, `integrityDropCount`, `integritySoftScore`, `integrityAnyHardTriggered`: running totals up to this row;
- `cyborgHunterParticipantId` (the participant ID ch.js found) and `cyborgHunterVersion`;
- `cyborgHunterError`, only when something went wrong on that row.

**Participant ID.** ch.js never overwrites a `participantId` your study sets (in a component's `data`, its parameters, or lab.js's state). It writes `participantId` onto one row only, the first row lab.js commits, and only when the study has set none by then. Every trial row carries ch.js's ID as `cyborgHunterParticipantId`. The CLI keys each participant by the study's own `participantId`, even one first set on a later screen, and otherwise by `cyborgHunterParticipantId`; when the two differ, the participant's metadata keeps ch.js's ID as `cyborgHunterParticipantId`. So `participantIdField` stays `participantId`, the CLI's default.

**Reserved column names.** The names above, the `*Final` fields and the honeypot summary below are ch.js's columns. A study must not use them for its own data, because one of the two values is lost. On a trial row, ch.js's value replaces one the study gives the component through its `data` option or its parameters, while a value the study's own `end` handler writes replaces ch.js's (lab.js runs those handlers after ch.js's hook and commits the row after both). The end-of-session fields replace whatever the last trial row holds under their names.

## The end of the session

ch.js ends the session when the study's root component ends. It then writes the last segment (`integritySegmentFinal`), the `integrity*Final` totals (`integrityPasteCountFinal`, `integrityCopyCountFinal`, `integrityDropCountFinal`, `integritySoftScoreFinal`, `integrityAnyHardTriggeredFinal`) and, with the honeypot on, the honeypot's session summary (`ai_use_session`, `ai_report_session`, `guard_assistance_violations_session`, `guard_assistance_violation_count_session`) onto the last trial row and onto the root component's own row, before the study's own `on('end')` handlers run, so a save from such a handler includes them. On the root row, a column the study has already set there is kept.

The study's last screen must end, by a response or a timeout, for these fields to be written. A last screen that stays on display until the participant closes the tab never ends the root component, and the session summary is not written.

With the Transmit plugin's full update switched off (`updates: { full: false }`), the last trial row may already have been sent before the study ended. The final fields then reach the server on the root component's row, which lab.js sends with its next incremental update, 2.5 seconds after the study ends. Keep the full update on (the default) so that every row, the final fields included, is sent when the study ends.

## Saving and reading the data

The CLI reads what lab.js saves, one file per participant:

| How the study saves | File | CLI config |
|---|---|---|
| the Download plugin, or `study.options.datastore.exportCsv()` (with `fileType: 'json'`, the plugin saves a JSON array as in the next row) | CSV, one row per component, objects as JSON cells | `"filePattern": "*.csv"` |
| `study.options.datastore.exportJson()`, also what a JATOS export submits | a JSON array of rows | `"filePattern": "*.json"` |
| the PostMessage plugin (Open Lab and other hosts that embed the study): its message carries `json` and `csv`, both complete | store `json` as the JSON array above, or `csv` as the CSV | as for that file |
| the Transmit plugin, or `datastore.transmit(url)`, with the body stored as it arrives | `{ "metadata": {…}, "url": "…", "data": [rows] }` | `"filePattern": "*.json"` |

In every case, keep `participantIdField` at its default, `participantId` (see [Where the data goes](#where-the-data-goes)).

**Transmit.** The plugin posts a slice of new rows to your server from time to time while the study runs (`metadata.payload: "incremental"`), and all rows once at the end (`"full"`). Give the CLI only the final `full` body of each session. A slice is read too, with a warning, and appears as a participant with part of the data. Two more limits:

- `metadata.id` is lab.js's own ID for one upload session, not the participant's. Do not set `participantIdField` to `id` or `metadata.id`.
- Only JSON bodies are read (the plugin's default). A body sent with `encoding: 'form'` arrives as form fields, which the CLI does not read.

**The analyze page.** It suggests the participant ID field from a file's first row, for a Transmit body as for an `exportJson()` array, so it offers `participantId`. Keep that choice; `metadata.id` is not offered.

**Replay files.** The recording carries ch.js's participant ID. When your study keys its rows by its own `participantId`, the CLI still attaches the recording, through the participant's `cyborgHunterParticipantId`, as long as no other participant in the data carries or is keyed by that ID. Giving ch.js the same ID as your study (`data-participant-id` or `CyborgHunterConfig.participantId`) keeps the recording and the data under one name.

**Storage.** ch.js makes rows larger: about 1,900 characters of JSON for a trial without events, more with pastes, keystrokes and the raw mouse trace. lab.js 20.x keeps a study's rows in memory: every study gets the datastore lab.js creates, which has no `persistence`. Only if you replace that datastore with a `lab.data.Store` of your own with `persistence` set does every row also go to `sessionStorage` or `localStorage` on each commit, where browsers cap the total at about 5 MB. For such a store on a long study, set `window.CyborgHunterConfig = { collectForPostHoc: { rawMouseTrack: false } }` above the ch.js tag to leave the raw mouse trace out; the derived mouse metrics stay.

## Replay and canvas

`data-replay` records the session as on any page; `data-replay="dom"` records the visual DOM tier ([Replay with the one-liner](advanced-integration.md#replay-with-the-one-liner)). The recorder starts when the page has loaded, and its segments follow the trials and take their names. ch.js records but does not save: call `CyborgHunter.replay()` in an `on('end')` handler or your save code, and save what it returns as `<participantId>-replay-<epoch>.json` next to the data. `CyborgHunterConfig.replay.autoSave` works only on jsPsych pages; here it is ignored with a warning.

A `canvas.Screen` is recorded as a canvas element of the right size, not its drawing: the recorder records the DOM, so the replay shows a placeholder where the canvas was. Paste, copy, tab-away, mouse and typing signals work on canvas screens as on HTML ones.

## lab.js 23

ch.js hooks lab.js 20.x, the version the lab.js builder exports as `lib/lab.js`. The lab.js 23 pre-releases (npm's `next` tag) are not supported yet. On a page that loads one, ch.js logs `lab.js <version> is not supported yet` and runs as on a page without jsPsych: it records the session, but lab.js's rows get no integrity columns. To monitor such a page, mark trials and save `CyborgHunter.data()` as described in [advanced-integration.md → Vanilla segmentation reference](advanced-integration.md#vanilla-segmentation-reference).
