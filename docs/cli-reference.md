# CLI Reference
What a successful run looks like — the HTML report for the bundled four-participant synthetic dataset ([worked-example.md](worked-example.md)):

![HTML report: tier-sorted participant list on the left; per-signal counts, score breakdown, paste evidence, and typing profile for the selected participant.](assets/report-example.png)

## Commands

### `cyborg-hunter report`

Generate the integrity report from a directory of participant data files.

```bash
cyborg-hunter report [options]
```

Running `cyborg-hunter` with no subcommand defaults to `report`.

**Options:**

| Flag | Description |
|---|---|
| `--config <path>` / `--config-file <path>` | Config file path (default: `./cyborg-hunter.config.json`) |
| `--data <path>` / `--data-dir <path>` | Override `dataDir` |
| `--output <path>` / `--output-dir <path>` | Override `outputDir` |
| `--participant-id-field <name>` | Override `participantIdField` (e.g. `subject_ID` for jsPsych; dot-paths like `metadata.sessionId` supported; lab.js data keeps the default, see [labjs.md](labjs.md#saving-and-reading-the-data)) |
| `--file-pattern <glob>` | Override `filePattern` |
| `--integrity-field <name>` | Override `integrityField` |
| `--session-integrity-path <path>` | Dotted path to the session-level integrity object (e.g. `payload.cyborgHunter`) |
| `--qualtrics-field <name>` | Override `qualtricsField`, the Qualtrics export column holding the payload (default `__js_cyborg_hunter`) |
| `--participant <id>` | Filter to a single participant, by the key the report shows (for lab.js data keyed by the study's own `participantId`, that id, not ch-labjs.js's) |
| `--no-visuals` | Skip image generation (no `canvas` package required) |

Unknown flags exit with an error rather than silently falling back to whatever config file is in cwd (fixed in v0.3.0).

Qualtrics exports are detected by their header rows; one participant per response. A `.csv` whose first header row has `ResponseId` (`ResponseID` in a legacy export) and `__js_cyborg_hunter` (or `cyborg_hunter`, or the column named by `qualtricsField`), plus one sign that Qualtrics wrote it (a second Qualtrics column such as `StartDate` or `RecordedDate`, the `ImportId` header row, or a first non-empty payload cell written by `ch-qualtrics.js`), is read row by row, each response's payload cell as one participant. Rows with an empty cell are counted in one warning, a cell that is not JSON is reported under its response, and a payload with no linkable participant ID takes the row's `ResponseId`. Every other CSV is still one participant per file.

Warnings found while reading the data (a file without session data, an unresolved participant ID, a Qualtrics export's empty or malformed responses) are printed to stderr after the `Found N participants` line: one line per warning, file-level ones first, at most 20, then a count of the rest. stdout and the output files do not include them.

### `cyborg-hunter init`

Generate a starter config file in the current directory.

```bash
cyborg-hunter init
```

Refuses to overwrite an existing `cyborg-hunter.config.json`.

### Replay artifacts

`<pid>-replay-<epoch>.json[.gz]` files are picked up automatically from
`dataDir` (or `replayDir` when set) and rendered as per-participant
**Session replay** sections. Ownership is verified against the recording's
embedded `participant_id`; corrupt artifacts are reported, never fatal;
`report` prints the total size of emitted `replay/` assets.

Recordings from other producers are accepted too, since SessionRecording v2 is
not a Cyborg Hunter format:

- **Any filename.** A file that is structurally a v2 recording is recognised by
  its contents, whatever it is called (`session.json`, a dated download). Those
  attach **only** by the `participant_id` inside them — there is no filename to
  verify against, so one naming no participant in the dataset is reported and
  left unattached rather than guessed at.
- **jsPsych v1 recordings convert on the way in.** The player is v2-only, so a
  `schema_version: 1` jsPsych recording is converted in memory by
  `tools/convert/jspsych-v1-to-v2.mjs` before it reaches the report. The file on
  disk is never modified, and the notice names the tool version and the source
  hash that reproduce the conversion. A recording the converter refuses (it
  never fills in a missing field or renumbers a trial) is reported with the
  refusal's own remedy, and the rest of the cohort still renders. jsPsych v1
  records no `participant_id`, so these must use the `<pid>-replay-<epoch>.json`
  name to attach.

**Styled replays from your experiment's files.** A dom-tier recording keeps
the URL of every external stylesheet and image; when the experiment server
is gone (or the report must not fetch anything), point `assetsDir` (or
`--assets-dir <path>`) at a folder with those files. They are matched by URL
path suffix, then filename, and inlined into `replay/*.replay.js`; the replay
section states, for example, "Experiment assets: 2 of 3 stylesheets matched
(missing: fonts.css)". A missing or unreadable folder is an error. See
[docs/configuration.md → Data source](configuration.md#data-source).

## Output structure

```
cyborg-hunter-report/
├── index.html           # landing page (open this)
├── summary.csv          # one row per participant, every signal as a column
├── triage.md            # ranked markdown table with a one-line "why flagged"
├── event-log.csv        # chronological events (copy/paste/drop/synthetic/tabAway)
├── extensions.csv       # AI-extension + sidebar detections, one row per participant × detection
├── score-weights.json   # the triage-score weights this report used (defaults or scoreWeights)
├── cursor-limits.json   # the constants the cursor section judged with, their meanings, and the verdicts over the cohort
└── images/              # canvas-rendered visuals (skipped if canvas missing)
    ├── trajectories_<participantId>.png      # per-trial mouse paths
    ├── session_timeline_<participantId>.png  # session-wide tab-away / sidebar / guard timeline
    └── typing_profile_<participantId>.png    # per-trial typing-speed distributions
```

## Output files

### `index.html`

Self-contained landing page:

- Dashboard with hard/soft/clean participant counts
- Sortable triage table (click a column header to sort)
- Per-participant detail sections with linked images and signal summaries

Images are linked from `images/`, not base64-embedded — keeps the HTML readable and the page lightweight.

### `summary.csv`

One row per participant:

| Column | Description |
|---|---|
| `participantId` | Participant identifier |
| `trialCount` | Number of monitored trials |
| `triageScore` | Combined triage score (see [Triage scoring](#triage-scoring) below) |
| `hardTriggered` | `YES` / `no` — did any hard signal fire |
| `triageReason` | One-line summary of why this participant ranked where they did |
| `totalPasteEvents` | Total paste events across all trials |
| `totalCopyEvents` | Total copy events across all trials |
| `totalTabAways` | Total tab-away events |
| `meanTypingSpeed` | Mean chars/sec across trials |
| `meanMouseEvents` | Mean mouse events per trial |
| `totalSoftScore` | Accumulated soft score |
| `sidebar_event_count` | Sidebar-gap detections (session-level) |
| `ai_extensions` | AI-extension selectors matched (semicolon-joined) |
| `keyboard_shortcut_count` | DevTools-hotkey presses (Ctrl/Cmd+Shift+I/J/C, F12) |
| `layout_shift_count` | Layout-compression events |
| `zoom_change_count` | Inferred zoom level changes |
| `dev_tools_event_count` | Reserved column; currently always 0 (DevTools-open is recorded under `keyboard_shortcut_count`) |
| `authoritative_soft_score` | Soft score from `getSessionReport()` (preferred over the per-trial sum) |
| `honeypot_ai_use` | Three states: `YES` = participant ticked the visible-bait "I used AI" checkbox; `no` = the honeypot was present but the box was left unticked (negative evidence); empty = the honeypot extension wasn't used for this participant at all |
| `honeypot_ai_report` | Free-text the participant typed into the honeypot's "what did you use?" box (empty if none) |
| `cursorReason` | Why the session's pointer verdict is `not assessed`: `not collected` (with `(recorded with <version>)` when the data names one), `no cursor stream (touch device)`, `no cursor stream (no pointer events)`, `device facts and click provenance not recorded (library before 0.14)`, or `only N first pointer clicks (the pointer-pattern tells need 4)` (`click` when N is 1); empty when the session is assessed, including a session with no cursor stream that its automation flag makes highly suspicious (since 0.14, like every `cursor…` column) |
| `cursorVerdict` | The pointer verdict: `clean`, `suspicious`, `highly suspicious` or `not assessed` |
| `cursorTells` | The tells that decided a suspicious or highly suspicious verdict, `; `-separated: `automation flag`, `untrusted clicks n/N`, `clicks without a path n/N`, `trials clicked without movement n/N`; empty otherwise |
| `cursorChecksRecorded` | How many of the three browser-reported checks the data supports: 3 (a cursor stream and the session's device facts), 1 (device facts and no cursor stream: the automation flag only), 0 (no device facts: recorded before 0.14) |
| `cursorFactCount` | Browser-reported checks that fired, 0–3 (one per check, not per event); empty without device facts |
| `cursorWebdriver` | `YES` / `no`: the automation flag set by the browser; empty without device facts |
| `cursorUntrustedClicks` | Clicks the page's own scripts dispatched; empty unless the session has a cursor stream and device facts |
| `cursorZeroMoveTrials` | Trials clicked without pointer movement, as `count/trials`; empty unless the session has a cursor stream and device facts |
| `cursorJumpClicks` | Clicks after a pointer jump, as `count/first pointer clicks`; reported, not a tell |
| `cursorNoPathClicks` | Clicks that arrived without a path, as `count/first pointer clicks` (a double-click's later clicks are not first clicks) |
| `cursorCoordinates` | `viewport` (every sample has `cx`, `cy`) or `page` (older data; scrolling can then look like a jump) |
| `cursorStream` | The stream the section read: `core`, the monitor's mouse track |
| `cursorSampleIntervalMs` | Median time between consecutive move samples within a trial, in ms; empty when the track has no such pair |
| `cursorClicks` | Clicks in the mouse track |
| `cursorMovements` | Movements: runs of move samples, ended by a gap longer than 400 ms or by a click; a click with no move before it counts as a movement of its own |
| `cursorMovesPerTrialMedian` | Median number of move samples per trial (depends on the sampling interval) |
| `cursorEfficiencyMedian` | Median efficiency per movement (displacement over path length, 1 for a straight line), three decimals |
| `cursorMaxDeviationPxMedian` | Median of each movement's largest distance from the straight line between its ends, in px, one decimal |
| `cursorCenteredClicks` | Reserved for clicks at the centre of their target, read from a replay recording by a later release; empty |
| ... | (See the actual file for the full column set; the schema may grow.) |

> Note: the early per-participant columns are camelCase (`totalPasteEvents`, …)
> while the session-derived columns are snake_case (`sidebar_event_count`, …).
> The header names above match the emitted CSV exactly.

A text cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return
is written with a leading apostrophe (`'`), so a spreadsheet reads it as text
rather than running it as a formula; numbers, negative ones included, are
written unchanged.

For a Qualtrics response written at a reduced level ([Payload size](qualtrics.md#payload-size)),
the counts, `trialCount` and `totalSoftScore` cover the whole session, while `meanTypingSpeed`,
`meanMouseEvents` and `meanPathEfficiency` average only the pages the payload kept; the CLI's
note for that response says so.

### `triage.md`

Ranked markdown table sorted **tier-first** (hard-triggered, then soft-flagged, then
clean), and by triage score (descending) within each tier. Hard-triggered
participants always lead the list even when a soft-only participant has a higher
numeric score, so the "start here" review order surfaces the most actionable cases
first.

```
| Rank | Participant | Tier | Score | Reason |
|------|-------------|------|-------|--------|
| 1    | P023        | HARD | 17    | 3 paste events; 2 tab-aways ≥10s; ChatGPT detected |
| 2    | P045        | soft | 9     | 3 sidebar events; fast typing on 4 trials |
```

The Tier column (added 0.6.1) shows the library's screening verdict
(`HARD` / `soft` / `clean`), the same classification behind the console's
hard/soft/clean counts. Score is the CLI ranking heuristic described under
[Triage scoring](#triage-scoring): it orders rows within a tier and is not
the library soft score.

(`P023`'s score is 3 paste × 5 + 2 tab-away × 1 = 17; the "ChatGPT detected"
note is shown in the reason but no longer contributes to the score — see
[Triage scoring](#triage-scoring). `P023` leads because it is hard-triggered, not
because of its score.) Designed to be readable as plain text or pasted into a
Slack/Notion review.

### `score-weights.json`

The weights the triage score was computed with, written by every run:
`{ "isDefault": true|false, "weights": { "<signal>": { "weight": n, "max": m|null } } }`.
`isDefault` is `false` when `scoreWeights` in the config changed anything; the
HTML top bar then also names the changed weights. Use it to check that two
reports' scores are comparable. Config warnings are printed to the console,
not written here.

### `cursor-limits.json`

The constants the cursor section judged with, written by every run:
`{ "cliVersion": "<version>", "recordedWith": "<version>, …"|null, "limits": { "<constant>": { "value": n, "meaning": "<text>" } }, "sampleIntervalMs": { "core": { "median": ms|null, "n": k } }, "sessions": { "total": n, "withDeviceFacts": k, "verdicts": { "highlySuspicious": h, "suspicious": s, "clean": c, "notAssessed": u } } }`.
`cliVersion` is the version of the CLI that holds the constants and
`recordedWith` the library versions the data carries, each once, in version
order and joined by ", " (`"0.6.1, 0.14.0"`; null when the data names none),
so a report rebuilt by a later CLI shows which constants decided it. Each
constant comes with a sentence saying what it does (for example,
`movementGapMs`, 400: two move samples further apart belong to different
movements); the cursor section prints the same values on its stream line.
Three constants decide the pointer verdict: `minClicksForVerdict`, 4 first
pointer clicks before the pattern tells are judged; `shareSuspicious`, 0.2,
the share of first pointer clicks or of trials at or above which a pattern
tell makes the session suspicious; and `shareHighlySuspicious`, 0.5, the share
at or above which a pattern tell, or clicks the page's own scripts dispatched,
make it highly suspicious. All three are provisional, set from a small number
of sessions.
`sampleIntervalMs` is the median of the sessions' own median intervals between
move samples, over the `n` sessions that have one, and `withDeviceFacts`
counts the sessions with device facts. The run prints "Pointer verdicts: H
highly suspicious, S suspicious, C clean, U not assessed (T sessions; K
recorded without device facts)", and the file's `sessions.verdicts` holds the
same four counts; T is `total` and K is `total` minus `withDeviceFacts`.

### `event-log.csv`

Every clipboard, drop, synthetic-insertion, and tab-away event in chronological order:

| Column | Description |
|---|---|
| `participantId` | Who |
| `trialId` | Which trial |
| `eventType` | `paste`, `copy`, `drop`, `synthetic`, or `tabAway` |
| `timestamp` | When (session-absolute `performance.now()` ms — same scale across all rows) |
| `duration_ms` | Populated for `tabAway` (the duration); empty for instantaneous events |
| `text` | Pasted/dropped text if available; for `tabAway` carries the trigger type (`windowBlur`, `visibilityChange`, etc.) |

A text cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return
is written with a leading apostrophe (`'`), so a spreadsheet reads it as text
rather than running it as a formula; numbers, negative ones included, are
written unchanged.

### `images/trajectories_*.png`, `session_timeline_*.png`, `typing_profile_*.png`

Per-participant visualizations rendered with `node-canvas`. Trajectory panels show the mouse path with start/end markers, click events, tab-away markers placed at trial-relative timing, and (when window-position data is present) a nested screen → window outline showing where the browser was on the user's display. Panels are ordered chronologically by rule by default (`trajectoryDisplayOrder` picks `"rule"` / `"time"` / `"insertion"`) and tinted by phase — peach gallery, purple typing/query, blue classification, grey re-query — matching the session-timeline strip. Plots are zoom-aware: if the participant adjusted CSS-level browser zoom, mouse coords are scaled to the outline correctly. The session timeline lays tab-away, sidebar, layout-shift, and guard-friction events on one session-wide time axis with phase bands. In the report, a click on a figure enlarges it to fit the window; **1:1** (or a click on the enlarged figure) shows it at the size it was drawn, scrolling, and **Fullscreen** gives it the whole screen.

If `canvas` is unavailable (Cairo not installed), images are skipped with platform-specific install hints. Text outputs still render.

## Triage scoring

The triage **score** is a deliberately small, transparent weighted sum. It is
*not* the library's soft score — it is a ranking heuristic computed by the CLI in
`src/cli/analyzers/triage.js`. By default (policy fixed 2026-06-01) it sums four
signals:

| Component | Default contribution |
|---|---|
| Paste events | `× 5` |
| Copy events | `× 5` |
| Sidebar events (open cycles) | `× 3` (uncapped) |
| Tab-aways longer than the participant's tab-away threshold (medium + long bins; 3s by default, 5s for strict) | `× 1` |

Under the default weights no other signal affects the score; each of them,
`cursor` (the pointer verdict's level, since 0.14) among them, can be given a weight
(below). Hard-trigger status, AI-extension detections, keyboard shortcuts,
layout shifts, zoom changes, edge-exit patterns, synthetic insertions, foreign
inputs, and the pointer verdict are all still surfaced — in the per-participant detail panes and the one-line triage
reason — but they do not change the number. (Earlier versions added a `+100`
hard-trigger term and several other bonuses; those were removed.)

**Changing the weights.** Since 0.9.0, `scoreWeights` in the config file can
reweight any of these terms, give a weight to any of the other signals (for
example one point per synthetic insertion), and cap a signal's count. See
[configuration.md → Report-score weights](configuration.md#report-score-weights-scoreweights).
The weights used are recorded in `score-weights.json`, and `triage.md` states the
applied formula. Custom weights change the score and the order *within* a tier
only; the hard/soft/clean tier never depends on them.

**Hard-triggered participants are surfaced by ordering, not by the score.** The
ranked list (both `triage.md` and the HTML index's default "Tier" sort) sorts
tier-first — hard-triggered, then soft-flagged, then clean — and by score within
each tier. So a hard-triggered participant always appears above soft-only ones
even when its score is lower.

- **Soft-flag threshold:** a participant is soft-flagged when
  `(authoritative soft score from getSessionReport() ?? summed per-trial soft
  score) ≥ the preset's `softScoreThreshold`` (6 for `standard`).

### Decision categories

The dashboard groups participants three ways:

- **Hard-flagged** (any hard signal fired) — count thresholds crossed; review the pasted text in `event-log.csv`.
- **Soft-flagged** (soft score ≥ preset threshold) — multiple behavioral indicators; check trajectories and the session timeline for patterns.
- **Clean** (soft score below threshold, no hard signals) — spot-check a sample for calibration.

### How to read the report

The tool produces evidence, not verdicts. Practical heuristics:

1. **Hard signals — read the pasted text.** A pasted block of AI prose looks different from copied notes from the participant's own document.
2. **Tab-aways — check the durations.** Brief flickers are often benign (system notifications, accidental Cmd-Tab). 30s+ tab-aways during a response are harder to explain away.
3. **Extensions — installed ≠ used.** A participant having Sider installed in Chrome doesn't prove they used it during your study.
4. **Edge-exits — look for a pattern.** A consistent right-edge-exit-then-tab-away is more telling than a single edge-exit.
5. **Compare against a clean baseline.** Pick a few participants with low scores and look at their trajectories side-by-side. The tool's job is to surface ANOMALIES; you decide what's normal for your population.
