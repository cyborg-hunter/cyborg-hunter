# Worked example: the synthetic-pilot dataset

The repo bundles a four-participant synthetic dataset at [`examples/synthetic-pilot/`](../examples/synthetic-pilot/) — one participant per triage tier, plus a generated session that sets off the pointer checks — so you can run the full pipeline and practice reading its outputs before your own data is on the line. Each section below walks one output in reading order (the triage table, the event log, the summary CSV, the plots), and the dataset is built so the classic misreadings each show up once: a hard-flagged participant who ranks above a higher-scoring soft one, two different scores that are easy to conflate, and a clean participant whose reason column is not empty. Every number is hand-authored by `generate-fixture.mjs`; **no real participant, anonymized or otherwise, is behind any of it**. The files are shaped exactly like what the jsPsych extension saves (per-trial `integrity` cells, `integritySession` + `integrityScore` on the last row): with v0.6.1 for the three tier sessions, and with 0.14.0 for the generated one, which adds the session's device facts and the viewport coordinates and provenance of each click. The CLI treats them like real data.

## Run it

```bash
cd examples/synthetic-pilot
cyborg-hunter report
open report/index.html
```

(If you cloned this repo instead of installing the CLI from npm, `cyborg-hunter` won't be on your PATH — run `node ../../bin/cyborg-hunter.js report` from the same directory instead. It is the same entry point.)

The console prints the tier counts before rendering:

```
Found 4 participants

Analyzing...
  Hard-flagged (hard signal crossed its count threshold): 1
  Soft-flagged (library soft score >= its threshold):     1
  Clean:                                                  2
```

No ingest warnings appear. On your own data, warnings at this point are the first thing to fix; the usual causes are a wrong `participantIdField` ([quickstart § 5](quickstart.md#5-generate-the-report)) or, in manual mode, a missing `finalize()` call ([advanced-integration.md → Manual mode](advanced-integration.md#manual-mode)).

## triage.md — where review starts

```
| Rank | Participant      | Tier     | Score | Reason |
|------|------------------|----------|-------|--------|
| 1    | SYN-HARD-03      | **HARD** | 18    | 2 paste events; 1 copy events; 3 tab-aways ≥10s; 2 flickers ≤3s; fast typing on 1 trials |
| 2    | SYN-SOFT-02      | soft     | 21    | 3 copy events; 1 tab-away ≥10s; 2 tab-aways 3–10s; 1 sidebar event |
| 3    | SYN-CLEAN-01     | clean    | 0     | 1 flicker ≤3s; 1 layout shifts |
| 4    | SYN-GENERATED-04 | clean    | 0     | pointer checks: automation flag; trials clicked without pointer movement 3/3 |
```

Four things this table teaches:

**Rank 1 has a *lower* score than rank 2.** The list orders tier-first: HARD, then soft, then clean, with the score only breaking ties within a tier. SYN-HARD-03 crossed a hard count threshold (2 pastes ≥ the standard preset's paste threshold of 2), and hard evidence outranks any accumulation of soft evidence. If you sort by score and review top-down, you will review the wrong participant first.

**The Score is the CLI's ranking heuristic, not the library's soft score.** With the default weights, Score = 5×paste + 5×copy + 3×sidebar + 1×(tab-aways longer than the participant's cutoff); `scoreWeights` in the config can change them ([configuration.md](configuration.md#report-score-weights-scoreweights)). Check the arithmetic against the reasons: SYN-HARD-03 is 2×5 + 1×5 + 3×1 = 18 (the two flickers and the fast typing contribute 0); SYN-SOFT-02 is 3×5 + 3×1 + 1×3 = 21. The library's soft score is a different number with different weights; [interpreting-signals.md](interpreting-signals.md#two-scores-three-tiers) untangles the two.

**Clean rows still carry reasons.** SYN-CLEAN-01's 800 ms flicker and single viewport-width shift are ordinary behavior (a notification, a window resize). The reason column reports everything observed, scored or not, so "clean with minor notes" and "nothing at all" are distinguishable.

**A session the pointer checks single out can still be clean.** SYN-GENERATED-04 is a generated session: its browser set its automation flag, and each of its three trials was clicked with no pointer movement, so two of the three pointer checks fired. It has no paste, copy or long tab-away, so it is clean and scores 0, and it ranks after SYN-CLEAN-01 because the two tie. The checks rank nothing at the default weights; `{ "scoreWeights": { "cursor": 1 } }` adds one point per check that fired and moves it to the top of the clean tier, never out of it. What each check records and its innocent causes: [interpreting-signals.md](interpreting-signals.md#two-scores-three-tiers).

## event-log.csv — read the actual evidence

For hard-flagged participants, go straight here and read what they pasted:

```
SYN-HARD-03,t3,paste,86500,,"The rule appears to be: the hand wins whenever it
    contains at least two cards of the same suit and no card lower than a five.
    Both examples shown satisfy this condition."
SYN-HARD-03,t5,paste,148000,,"Yes — this hand also fits the rule, since the two
    clubs count as a same-suit pair and every card is five or higher."
```

Fluent, over-complete prose arriving via the clipboard mid-trial, right after 15 s and 11 s tab-aways (also in the log, timestamped). That co-occurrence pattern (tab away, come back, paste polished text) distinguishes "consulted ChatGPT in another tab" from "pasted a note to self". The log holds every clipboard, drop, synthetic-insertion, and tab-away event in chronological order, so you can reconstruct the sequence per participant.

## summary.csv — the analysis-friendly view

One row per participant, every signal a column. The columns to look at first:

| Column | SYN-CLEAN-01 | SYN-SOFT-02 | SYN-HARD-03 | SYN-GENERATED-04 |
|---|---|---|---|---|
| `hardTriggered` | no | no | YES | no |
| `authoritative_soft_score` | 0 | 11 | 7 | 0 |
| `totalPasteEvents` / `totalCopyEvents` | 0 / 0 | 0 / 3 | 2 / 1 | 0 / 0 |
| `totalTabAways` (long/medium/flicker) | 1 (0/0/1) | 3 (1/2/0) | 5 (3/0/2) | 0 (0/0/0) |
| `sidebar_event_count` | 0 | 1 | 0 | 0 |
| `layout_shift_count` | 1 | 0 | 0 | 0 |
| `cursorChecksRecorded` / `cursorFactCount` | 0 / (empty) | 0 / (empty) | 0 / (empty) | 3 / 2 |
| `cursorWebdriver` | (empty) | (empty) | (empty) | YES |
| `cursorZeroMoveTrials` | (empty) | (empty) | (empty) | 3/3 |
| `cursorClicks` / `cursorMovements` | 0 / 6 | 0 / 6 | 0 / 6 | 3 / 3 |
| `cursorSampleIntervalMs` | 287.5 | 300 | 312.5 | (empty) |
| `cursorEfficiencyMedian` | 0.898 | 0.900 | 0.883 | (empty) |

`authoritative_soft_score` is the library's own accumulated soft score, read from the saved session report. SYN-SOFT-02 sits at 11 against the standard threshold of 6, hence the soft flag. Note SYN-HARD-03 is *also* over the soft threshold (7 ≥ 6); the hard tier simply takes precedence. Columns are documented field-by-field in [cli-reference.md](cli-reference.md#summarycsv).

The `cursor…` columns (since 0.14) carry the cursor section's numbers. The three tier sessions are 0.6.1 data: they carry no device facts and no click provenance, so `cursorChecksRecorded` is 0 and the three checks are empty, as on any session recorded before 0.14 (the report's rail reads "pointer checks: not recorded"). Their movements are still measured, one per trial, sampled about 300 ms apart. SYN-GENERATED-04 is 0.14.0 data: its `cursorFactCount` of 2 is the automation flag (`cursorWebdriver` YES) and its three trials clicked without pointer movement (`cursorZeroMoveTrials` 3/3); its three clicks are its only movements, so it has no interval or efficiency to report. The run output sums the checks up in one line: "Pointer checks: fired in 1 of 1 sessions with device facts (3 recorded without them; 0 without a cursor stream)".

## The images

`report/images/` holds three plots per participant. In this dataset:

- **`session_timeline_*.png`** — the whole session on one time axis. SYN-SOFT-02's is the instructive one: three tab-away bars (color-binned by duration) plus a purple sidebar-open span, including a 6.4 s tab-away *before the first trial* (during "consent"). Off-trial events are placeable because 0.6.1 keeps timestamped session-level `tabAwayEvents[]`; the footer confirms "All 3 plotted from session-level events (incl. off-trial)".
- **`trajectories_*.png`** — per-trial mouse paths. Synthetic paths here are smooth and regular; on real data you'd compare flagged participants' paths against a few clean ones.
- **`typing_profile_*.png`** — per-trial typing speed against the participant's own threshold. SYN-HARD-03's t3 sits at 14.2 cps against a 10 cps cutoff.

One caveat specific to this fixture: the timelines print "perfNow→session-rel offset not derivable", because the synthetic files don't carry the wall-clock anchors a real jsPsych run has on every row. On real data that header line disappears.

## Where the numbers came from

`generate-fixture.mjs` builds each participant from a short trial-by-trial script and computes `trialSoftScore`/`trialSignals` with the standard preset's actual weights (copy 2 capped at 2/trial, tab-away 1 capped at 2/trial, fast typing 2, sidebar 3, soft threshold 6, paste hard threshold 2). Reading the four participant definitions at the bottom of that file, next to the triage table above, is the fastest way to internalize how raw events turn into tiers and scores. Edit the definitions, `node generate-fixture.mjs`, re-run the report, and check your prediction.

## Next

- The same config reads a study's own data directory, with `participantIdField` set to the column that holds the ID (`participantId` under the one-line setup; this dataset uses `subject_ID`): [quickstart § 5](quickstart.md#5-generate-the-report).
- Before making exclusion decisions, read [interpreting-signals.md](interpreting-signals.md).
