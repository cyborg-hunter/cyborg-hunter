# Worked example: four sessions recorded on the demo

The repo bundles four sessions recorded on the project's demo tour at [`examples/demo-sessions/`](../examples/demo-sessions/), three by the project's author and one by a GPT agent driving Chrome from a browser sidebar: one session per triage tier, plus the agent's, which is hard-flagged too and which the pointer verdict reads as highly suspicious. Run the full pipeline on them and practice reading its outputs before your own data is on the line. Each section below walks one output in reading order (the triage table, the event log, the summary CSV, the plots), and the classic misreadings each come up: the tier-first order, a single paste that does not make a participant HARD, two different scores that are easy to conflate, and a clean participant whose reason column is not empty. The files are what the tour's last step saves (per-trial `integrity` objects, and the session report under `metadata`), as saved, except that one paste's text came from the author's clipboard and was removed ([the dataset's README](../examples/demo-sessions/README.md)). The CLI treats them as it treats any study's data.

## Run it

```bash
cd examples/demo-sessions
cyborg-hunter report
open report/index.html
```

(If you cloned this repo instead of installing the CLI from npm, `cyborg-hunter` won't be on your PATH — run `node ../../bin/cyborg-hunter.js report` from the same directory instead. It is the same entry point.)

The console prints the tier counts before rendering:

```
Found 4 participants

Analyzing...
  Hard-flagged (hard signal crossed its count threshold): 2
  Soft-flagged (library soft score >= its threshold):     1
  Clean:                                                  1
  Triage.md orders tier-first (hard > soft > clean), then by the CLI
  triage score (5xpaste + 5xcopy + 3xsidebar + 1xtab-away) within a tier.
```

and, while rendering, one line for the pointer verdicts:

```
  Pointer verdicts: 1 highly suspicious, 0 suspicious, 1 clean, 2 not assessed (4 sessions; 2 recorded without device facts)
```

No ingest warnings appear. On your own data, warnings at this point are the first thing to fix; the usual causes are a wrong `participantIdField` ([quickstart § 5](quickstart.md#5-generate-the-report)) or, in manual mode, a missing `finalize()` call ([advanced-integration.md → Manual mode](advanced-integration.md#manual-mode)).

## triage.md — where review starts

```
| Rank | Participant | Tier | Score | Reason |
|------|-------------|------|-------|--------|
| 1 | DEMO-9mop | **HARD** | 45 | 4 paste events; 4 copy events; 4 tab-aways ≥10s; 1 tab-away 3–10s; 1 layout shifts; 44 synthetic insertions |
| 2 | DEMO-bsq6 | **HARD** | 21 | 2 paste events; 2 copy events; 1 tab-away ≥10s; fast typing on 3 trials; 44 synthetic insertions; pointer verdict: highly suspicious (clicks without a path 12/12) |
| 3 | DEMO-681w | soft | 13 | 1 paste events; 1 copy events; fast typing on 2 trials; 1 sidebar event; 2 layout shifts; 44 synthetic insertions |
| 4 | DEMO-a3f3 | clean | 11 | 1 paste events; 3 tab-aways 3–10s; fast typing on 1 trials; 1 sidebar event; 3 layout shifts; 1 zoom changes; 44 synthetic insertions |
```

Four things this table teaches:

**The order is tier-first, then score.** The list orders HARD, then soft, then clean, with the score only ordering rows within a tier. Here the two HARD rows lead and the scores happen to fall in the same order (45, 21, 13, 11); they need not, and on other data a HARD participant ranks above a soft one with a higher score, because hard evidence outranks any accumulation of soft evidence. If you sort by score and review top-down, you can review the wrong participant first. With the default weights, Score = 5×paste + 5×copy + 3×sidebar + 1×(tab-aways longer than the participant's cutoff, 3 s for all four); `scoreWeights` in the config can change them ([configuration.md](configuration.md#report-score-weights-scoreweights)). Check the arithmetic against the reasons: DEMO-9mop is 4×5 + 4×5 + 5×1 = 45 (four tab-aways of 10 s or more and one of 3–10 s); DEMO-bsq6 is 2×5 + 2×5 + 1×1 = 21; DEMO-681w is 1×5 + 1×5 + 1×3 = 13; DEMO-a3f3 is 1×5 + 1×3 + 3×1 = 11. The fast typing, the layout shifts, the zoom change and the synthetic insertions contribute 0.

**One paste is not a hard flag.** The standard preset makes a participant HARD at the second paste (its paste threshold is 2). DEMO-681w and DEMO-a3f3, two of the author's sessions, pasted once each and read soft and clean; the agent's two pastes crossed the threshold, as DEMO-9mop's four did.

**The soft tier starts at the library's threshold, and clean rows still carry reasons.** DEMO-681w is soft because its library soft score is 6, which reaches the standard preset's threshold of 6; DEMO-a3f3's is 3, so it is clean ([summary.csv](#summarycsv--the-analysis-friendly-view) has both). That library score is a different number from the Score column, with different weights: 13 and 11 there, 6 and 3 in the library's; [interpreting-signals.md](interpreting-signals.md#two-scores-three-tiers) untangles the two. DEMO-a3f3's reason column is still full: a paste, three tab-aways of 3–10 s, a sidebar event, three viewport-width shifts and a zoom change. The reason column reports everything observed, scored or not, so "clean with notes" and "nothing observed" are distinguishable.

**The agent's pointer verdict is highly suspicious.** All 12 of DEMO-bsq6's first clicks with a known position before them arrived without a path: the pointer appeared at its target instead of travelling to it. The author's DEMO-681w, on the same tour, shows 0 of 22. None of the three browser-reported checks fired for the agent: its browser did not set the automation flag, no click was dispatched by the page's own scripts, and no trial was clicked without pointer movement. The verdict is in the rail cell, the tile, the triage reason and the `cursorVerdict` column, and it ranks nothing at the default weights; at a `cursor` weight of 1 (`{ "scoreWeights": { "cursor": 1 } }`) the verdict's level, 2, is added to DEMO-bsq6's score (21 + 2 = 23), and it still ranks second, behind DEMO-9mop's 45 in the same tier: the weight orders rows within a tier, never across tiers. What each tell records and its innocent causes: [interpreting-signals.md](interpreting-signals.md#two-scores-three-tiers).

**44 synthetic insertions on every row.** The tour's autotype step types an answer by script, which the library logs as synthetic insertion: text that arrives without keystrokes. It is in every reason column and scored by nothing; it is what a browser extension that fills a field looks like. The script's speed shows in the typing profiles too: the autotype trial reads about 29 characters a second for DEMO-bsq6, DEMO-681w and DEMO-a3f3, and is one of the trials in each of their "fast typing" counts.

## event-log.csv — read the actual evidence

For hard-flagged participants, go straight here and read what they pasted. DEMO-9mop pasted the tour's own sentences, four times. Its first paste and the tab-away before it:

```
DEMO-9mop,act1-paste,tabAway,927214,78438,windowBlur
DEMO-9mop,act1-paste,paste,1031765.7999997139,,Great question! 😊 Honestly? My day has been a rich tapestry of moments — both big and small — that have reminded me what it truly means to be human. It’s not just a day — it’s a journey.
```

The paste arrives 26 s after the second of two long tab-aways in the same trial (173 s, then 78 s), and the next trial's paste after two more (75 s and 88 s), all four in the log, timestamped. That co-occurrence pattern (tab away, come back, paste) distinguishes "consulted a chatbot in another tab" from "pasted a note to self". Here the text is the tour's, and each of its four pastes follows a copy on the page in its trial: read the copy rows too before deciding where a pasted text came from. DEMO-bsq6's two pastes, 13 ms apart, carry the same text, the tour's reply from mid-word on ("ch tapestry of moments…").

The log holds every clipboard, drop and synthetic-insertion event, and every tab-away a trial recorded, in chronological order, so you can reconstruct the sequence per participant. A tab-away outside every trial is counted in `summary.csv` and drawn on the session timeline, but has no row here: DEMO-9mop's one of 3–10 s, two of DEMO-a3f3's three, and DEMO-bsq6's only one, 54 s long.

## summary.csv — the analysis-friendly view

One row per participant, every signal a column. The columns to look at first:

| Column | DEMO-9mop | DEMO-bsq6 | DEMO-681w | DEMO-a3f3 |
|---|---|---|---|---|
| `hardTriggered` | YES | YES | no | no |
| `authoritative_soft_score` | 12 | 10 | 6 | 3 |
| `totalPasteEvents` / `totalCopyEvents` | 4 / 4 | 2 / 2 | 1 / 1 | 1 / 0 |
| `totalTabAways` (long/medium/flicker) | 5 (4/1/0) | 1 (1/0/0) | 0 (0/0/0) | 3 (0/3/0) |
| `sidebar_event_count` | 0 | 0 | 1 | 1 |
| `layout_shift_count` | 1 | 0 | 2 | 3 |
| `cursorVerdict` | not assessed | highly suspicious | clean | not assessed |
| `cursorTells` | (empty) | `clicks without a path 12/12` | (empty) | (empty) |
| `cursorChecksRecorded` / `cursorFactCount` | 0 / (empty) | 3 / 0 | 3 / 0 | 0 / (empty) |
| `cursorWebdriver` / `cursorUntrustedClicks` | (empty) | no / 0 | no / 0 | (empty) |
| `cursorZeroMoveTrials` | (empty) | 0/6 | 0/17 | (empty) |
| `cursorNoPathClicks` | 0/112 | 12/12 | 0/22 | 0/12 |
| `cursorJumpClicks` | 3/112 | 8/12 | 0/22 | 1/12 |
| `cursorClicks` / `cursorMovements` | 112 / 387 | 14 / 16 | 23 / 63 | 16 / 29 |
| `cursorSampleIntervalMs` | 56 | 2629 | 56 | 57 |
| `cursorEfficiencyMedian` | 0.970 | 0.967 | 0.986 | 0.951 |
| `cursorMaxDeviationPxMedian` | 9.5 | 62.3 | 5.4 | 14.3 |

`authoritative_soft_score` is the library's own accumulated soft score, read from the saved session report. DEMO-681w sits at 6 against the standard threshold of 6, hence the soft flag. Note both HARD sessions are *also* over the soft threshold (12 and 10 ≥ 6); the hard tier takes precedence. Columns are documented field-by-field in [cli-reference.md](cli-reference.md#summarycsv).

The nineteen `cursor…` columns (since 0.14) carry the cursor section's numbers. DEMO-9mop and DEMO-a3f3 were recorded before the device facts and click provenance existed, so `cursorChecksRecorded` is 0, the three browser-reported checks are empty and `cursorVerdict` is not assessed, with the `cursorReason` "device facts and click provenance not recorded (library before 0.14)" (the report's rail reads "pointer: not assessed"). Their movements are still measured, sampled 56 and 57 ms apart, and their clicks still counted (`cursorNoPathClicks` 0/112 and 0/12). DEMO-bsq6 and DEMO-681w carry the device facts, and no browser-reported check fired for either (`cursorFactCount` 0); what separates them is clicks without a path, 12 of 12 for the agent and 0 of 22 for the author. The agent's pointer moved only to click, which is why its `cursorSampleIntervalMs`, the median time between move samples within a trial, is 2629 ms against 56 ms for the author's. `cursorJumpClicks` counts clicks after a pointer jump of 100 px or more, 8 of 12 for the agent and 0 of 22 for the author; it is reported, not judged, because a pointer re-entering the window produces one too. The run output sums the verdicts up in one line: "Pointer verdicts: 1 highly suspicious, 0 suspicious, 1 clean, 2 not assessed (4 sessions; 2 recorded without device facts)".

## The images

`report/images/` holds three plots per participant. In this dataset:

- **`trajectories_*.png`** — per-trial mouse paths. DEMO-bsq6's is the instructive one: its six panels hold 1 to 9 move samples each, three of them a single dot where the pointer appeared and clicked, where DEMO-681w's panels on the same tour show paths of up to 97 samples. On your own data, compare flagged participants' paths against a few clean ones.
- **`session_timeline_*.png`** — the whole session on one time axis. DEMO-9mop's shows its tab-aways as bars color-binned by duration: four long ones in two pairs, one pair before each of its first two pastes, and a short one at the start. Off-trial events are placeable because the session report keeps timestamped session-level `tabAwayEvents[]`; the footer confirms "All 5 plotted from session-level events (incl. off-trial)".
- **`typing_profile_*.png`** — per-trial typing speed against the participant's own threshold. DEMO-bsq6's three fast-typing trials sit at 17.6, 157.5 and 29.2 chars/sec against a 10 chars/sec cutoff; the `P` over the second marks a trial that also has pastes.

One caveat that applies to these files: the timelines print "perfNow→session-rel offset not derivable", because the tour saves no wall-clock start time for the session (`metadata.startTime`) to anchor its events to; the plot counts from page load instead.

## Where the sessions came from

The tour is the project's [live demo](https://cyborg-hunter.github.io/cyborg-hunter/): ten steps that make a visitor paste an offered answer, leave the tab, open a browser sidebar, watch a script type, and enter the guard, while the library records. Its last step saves the session data these files are. The author recorded three: DEMO-9mop and DEMO-a3f3 on an earlier two-act version of the tour, whose trial ids read `act1-…` and `act2-…`, recorded before the device facts and click provenance existed (which is why their pointer verdict is not assessed), and DEMO-681w on the current ten-step tour, 17 trials because the author walked back and forth through the steps. The agent's, DEMO-bsq6, went through the current tour once. Nothing is generated: every number above comes from what the library recorded. Reading the trial ids in `event-log.csv` next to the tour's steps, with the triage table above, is the fastest way to internalize how raw events turn into tiers and scores. Run the tour yourself, predict your own row, then save its files and run the report on them.

## Next

- The same config reads a study's own data directory, with `participantIdField` set to the column that holds the ID (`participantId` under the one-line setup; this dataset uses it too): [quickstart § 5](quickstart.md#5-generate-the-report).
- Before making exclusion decisions, read [interpreting-signals.md](interpreting-signals.md).
