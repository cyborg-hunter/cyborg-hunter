# Interpreting the signals

The report surfaces evidence; you make the exclusion decisions. This page covers the three places where readers most often misread that evidence: the two different "scores", the viewport-width-shift signal, and phase scoping. Thresholds and per-preset values live in [signals-reference.md](signals-reference.md); this page is about meaning.

## Two scores, three tiers

Cyborg-hunter computes **two unrelated numbers**, and conflating them is the most common misreading of the report.

| | Library soft score | CLI triage score |
|---|---|---|
| Computed | in the participant's browser, during the study | on your machine, at report time |
| Formula | weighted sum of soft events (copy, tab-away, fast typing, sidebar, DevTools, foreign input), with per-trial caps | by default `5×paste + 5×copy + 3×sidebar + 1×tab-away` (tab-aways longer than the participant's cutoff); adjustable with `scoreWeights` in the CLI config |
| Compared against | the preset's `softScoreThreshold` (6 for `standard`) | nothing; it only orders rows |
| Purpose | screening verdict: is this participant soft-flagged? | review ordering within a tier |
| Where you see it | `authoritative_soft_score` in `summary.csv` | the `Score` column in `triage.md` |

The **tier** (`HARD` / `soft` / `clean`) is the screening verdict:

- **HARD** — a hard signal (paste, drop, or copy-in-strict) reached its count threshold. Count-based, no weighting: with the standard preset, the second paste makes a participant HARD no matter what else happened.
- **soft** — no hard trigger, but the library soft score reached its threshold.
- **clean** — neither.

`triage.md` sorts tier-first, then by triage score within a tier. Three consequences worth internalizing:

1. **A HARD participant can rank above a soft participant with a higher score.** In the bundled [worked example](worked-example.md), the HARD row scores 18 and the soft row below it scores 21. That ordering is intentional: hard evidence (something crossed a count threshold) outranks any accumulation of soft evidence. Don't re-sort by score.
2. **The triage score is blind to most signals.** Synthetic insertions, AI-extension detections, keyboard shortcuts, viewport shifts, zoom changes, and foreign inputs appear in the reason column but add zero to the score. A participant with "1015 synthetic insertions" and no clipboard/tab-away/sidebar activity scores 0. If a diagnostic signal matters for your study, filter `summary.csv` on its column; don't expect the ranking to do it.
3. **Thresholds are per-participant.** Since 0.6.0 the library saves each participant's effective config, and the CLI scores each participant against their *own* saved cutoffs (tab-away duration, typing speed, soft threshold). Two participants with identical behavior can bin differently if they ran under different presets. The bin labels in the triage reason ("≤5s / 5–10s" for a strict-preset participant) reflect this.

A useful mental model: **the tier decides *whether* to review someone, the triage score decides *in what order*, and neither decides *what you conclude*.** For hard flags, read the pasted text in `event-log.csv`; for soft flags, look at the session timeline and trajectories before judging.

**Pointer verdict.** Since 0.14 the report's [cursor section](#cursor-dynamics) opens with one verdict per session: `clean`, `suspicious`, `highly suspicious` or `not assessed`, followed by the tells that decided it (a clean session states the counts it was judged on, a session not assessed the reason). Four tells count against a session. The *automation flag set by the browser* is `navigator.webdriver`, which a browser driven through WebDriver sets and the monitor reads once at session start; on its own it makes the session highly suspicious. *Clicks the page's own scripts dispatched* are recorded clicks whose event the browser marks as untrusted (`isTrusted` false); any makes the session suspicious, half of the session's clicks or more highly suspicious. *Clicks that arrived without a path* are first pointer clicks (the later clicks of a double- or triple-click are not counted) whose movement has at most one recorded sample and starts 20 px or more from where the pointer was last seen: the pointer appears at its target instead of travelling to it, which is how a scripted cursor moves. This rule and clicks after a pointer jump (reported, not a tell) both compare a click's movement with where the pointer was last seen, so they judge only first clicks with a known position before them. The position is unknown until the pointer is first seen in the session, and again after more than 2 s with nothing recorded (`staleGapMs`), after a tab-away and, in data without viewport coordinates, at the start of every trial; a click whose movement is the first seen since then has none and is left out of their denominators. *Trials clicked without pointer movement* are trials with no recorded movement and a pointer click 20 px or more from where the pointer was last seen (or with no position known). Clicks that arrived without a path is judged as a share of the first pointer clicks with a known position, from 4 such clicks; trials clicked without pointer movement as a share of trials, from 4 first pointer clicks of any kind: a share of 20% or more makes the session suspicious, 50% or more highly suspicious. Where the report prints a tell's share, it is a whole percentage rounded down, so a printed share reaches a threshold only when the share itself does. A session is not assessed when it has fewer than 4 first pointer clicks with a known position and no tell against it, when it was recorded before 0.14 (no device facts, no click provenance), or when it has no cursor stream (the mouse track not collected, a touch device, or no pointer events) and its browser did not set the automation flag; the section gives the reason, with the counts when there are too few clicks with a known position. The thresholds (`minClicksForVerdict`, `shareSuspicious`, `shareHighlySuspicious` in `cursor-limits.json`) were set from a small number of sessions and are provisional. The verdict never changes the tier; the `cursor` ranking weight in `scoreWeights` (default 0) adds the weight times the verdict's level (suspicious 1, highly suspicious 2) to the triage score.

Each tell has innocent causes. A page that dispatches its own clicks (a script that calls `element.click()`, or a page that answers the Enter key by clicking its button) produces untrusted clicks for every participant, and a whole cohort carrying that tell is the sign of it. A Continue button that appears under a pointer resting since before the trial, and is clicked without a move, produces a trial clicked without pointer movement when the report has lost the pointer's position: nothing recorded for more than 2 s between trials (`staleGapMs`), a tab-away, samples without viewport coordinates (data before 0.14, whose position is forgotten at every trial), or no position recorded yet in the session. A pointer moved while nothing was recorded (between monitored trials 2 s or less apart, or outside the window without a tab-away) is next seen where it stopped. A movement that starts there and ends in a first pointer click is a click after a pointer jump when it starts 100 px or more from the last known position, and arrived without a path when it has at most one sample and starts 20 px or more from it. While the position is known, a click with no movement before it that lands closer than 20 px to it (`samePositionPx`) counts for neither pattern tell. The report sorts each click by what the browser recorded, in this order: an untrusted click is one the page's own scripts dispatched; else a click with `detail` 0 is keyboard activation of a focused button (Enter or Space); else a click with `pointerType` `touch` is a touch tap (on a touchscreen laptop, which the report otherwise treats as a desktop); any other click is a pointer click. Keyboard activations and touch taps are counted apart and count toward no tell, nor toward clicks after a pointer jump. A touch tap moves the last known position as a pointer click does; a keyboard activation or a click the page's own scripts dispatched carries no pointer position and leaves it where it was. Sessions recorded before 0.14 show the three browser-reported checks as "not recorded" ([upgrading.md](upgrading.md#0140--from-013)).

## Viewport-width shifts

**What it measures:** the `viewportWidthShifts` signal records changes in the viewport's width, via a ResizeObserver on `<html>` with a 20 px threshold. Since 0.6.1 the events are debounced (250 ms quiet period), so one resize gesture logs one event with the net old→new change.

**What it is not:** Web-Vitals "layout shift" (CLS). The signal was named `layoutShifts` before 0.6.1 and that name suggested content-jump instrumentation; it never measured that. The session report currently carries both keys with identical content (`layoutShifts` is a deprecated alias), and the CSV column is still called `layout_shift_count` so existing pipelines keep parsing.

**How to read it:** a viewport-width shift means *the usable width changed*: the participant resized the window, docked something, or a sidebar-style panel opened or closed. That makes it a **diagnostic** signal, useful context but never scored, because window resizing is ordinary behavior. The scored sibling is the **sidebar** signal (`sidebarGap`), which uses different evidence (the `outerWidth − innerWidth` gap and layout compression) specific to a panel eating space *inside* the window. In practice:

- Viewport shifts alone, without sidebar events: usually the participant adjusting their window. The clean participant in the worked example has exactly this pattern.
- Sidebar events (they score 3× in triage and weigh into the soft score) corroborated by viewport shifts around the same timestamps: consistent with a browser AI panel opening. Check the session timeline, where both lanes share one time axis.
- Counts on pre-0.6.1 data run higher for the same behavior, because un-debounced dragging logged one event per frame. Don't compare raw counts across library versions.

## Phase scoping

Studies sometimes pre-register that integrity screening counts only certain experiment phases (e.g. "signals during the classification phase only"). The `phaseScope` config option enforces that in the report:

```json
{ "phaseScope": { "include": ["classification"] } }
{ "phaseScope": { "exclude": ["gallery", "post_gallery_query", "end_requery"] } }
```

`include` (when non-empty) keeps only the listed phases; `exclude` then removes its phases. Phases are whatever your experiment wrote into each trial's `phase` field (a per-trial extension param).

What a scope does and does not change:

- **Scoped:** per-trial signal counts (paste, copy, drop, tab-away, typing, soft score), and the hard/soft *flags*, which are re-derived from the scoped trials rather than read from the whole-session saved score. A participant whose only pastes happened during an excluded practice phase is not hard-flagged.
- **Not scoped:** ambient session signals that have no phase attribution (sidebar events, keyboard shortcuts, viewport shifts, zoom changes). These stay session-wide because the library records them outside any trial.
- **Not scoped:** the renderers. Timelines and trajectory grids still show the full session, so you can see what happened in excluded phases even though it doesn't count.

Two footguns:

1. **Trials without a `phase` field count as `"default"`.** An `include` list that doesn't contain `"default"` silently drops those trials from scoring. If your data has unlabeled trials, scope with `exclude`.
2. **Scoping changes flags, so decide it before you look.** Running unscoped, peeking at the tiers, then adding a scope that de-flags participants is the analysis-degrees-of-freedom problem pre-registration exists to prevent. Set `phaseScope` to match your pre-registration text and keep it fixed.

## Signals that never score

Collected-but-unscored signals, and what they're for:

| Signal | Why it's diagnostic-only |
|---|---|
| Synthetic insertions | Text appearing without keystrokes catches automation, but also autofill and some IMEs/dictation. High counts flag *review*, not exclusion. |
| AI-extension detections | Installed ≠ used. A participant with Sider in Chrome may never have opened it during your study. |
| Idle gaps | Long pauses have many causes. Context for tab-away patterns. |
| Mouse metrics | Path efficiency and speed variance support bot detection, but need baselines from your own population. |
| Zoom changes, window geometry | Environment context for reading the trajectory plots. |
| Clicks after a pointer jump | A movement ending in a first pointer click that starts 100 px or more from where the pointer was last seen; reported with its denominator, not a tell (a pointer re-entering the window produces one). |
| Cursor shape features | Per-movement duration, path, displacement, speed, efficiency and deviation, as medians with n; they depend on the sampling interval and the task, so compare within one study. |

The `honeypot_ai_use` column (if you run the guard-honeypot extension) is three-state: `YES` means the participant ticked the visible bait "I used AI" checkbox, `no` means the bait was shown and left unticked, and empty means the honeypot wasn't active for that participant. Only `YES` is evidence; don't read `no` as exoneration or empty as `no`.

## Cursor dynamics

The report's "Cursor dynamics" section gives each session's pointer verdict and the tells behind it, with every check, rule and movement-shape number in a closed details block beneath; the verdict and the tells are described under [Two scores, three tiers](#two-scores-three-tiers), clicks after a pointer jump and the shape features under [Signals that never score](#signals-that-never-score). The constants behind each count (the 400 ms gap that ends a movement, the 100 px that makes a jump, the 20 px, the 4 first clicks and the two shares behind the verdict, and the rest) are printed with their values at the end of the details block and written with their meanings to `cursor-limits.json` beside the report ([cli-reference.md](cli-reference.md#cursor-limitsjson)). To check a trial against its recording, the section in the CLI report links to the session's replay when it has one; on the analyze page, for a session with a recording, it points to the replay card beside the report, which follows the selected participant.

The shape features come from the bot-detection literature. Chu, Gianvecchio and Wang ("Bot or Human? A Behavior-Based Online Bot Detection System", 2018) split mouse streams into movements at 0.4 s gaps, as the section does, and compared blog visitors with bots the authors configured themselves. Bot point-and-click movements averaged 1,521 px/s against 427 px/s for humans, and efficiency (displacement over path length, 1 for a straight line) was above 0.94 in 59% of bot movements against 29% of human ones. Those figures come from the operating system's pointer events at 125 Hz. The monitor samples at `mouseThrottleMs` (50 ms by default), and a throttled stream joins its samples with straight lines, so it undercounts path length and reads efficiency higher than the same movement recorded at 125 Hz. The published figures are therefore context, not thresholds: they show which direction a difference points, and the section sets no cut-off on them.

## Deciding what to do

1. Review HARD participants first, and read their `event-log.csv` text before excluding anyone. Pasted AI prose reads differently from a pasted note-to-self.
2. For soft flags, open the session timeline. A cluster of long tab-aways during response trials tells a different story than scattered flickers.
3. Calibrate against your own clean participants. Pull up two or three low-score trajectory grids side-by-side with a flagged one; the tool surfaces anomalies relative to nothing, you supply the baseline.
4. Pre-register your exclusion rule (which tiers, which thresholds, which phases) and let the report execute it, rather than deciding per-participant after seeing the data.

Related: [signals-reference.md](signals-reference.md) for every threshold, [cli-reference.md](cli-reference.md#triage-scoring) for the scoring implementation notes, [README § What it doesn't detect](../README.md#what-it-doesnt-detect) for the honest limits.
