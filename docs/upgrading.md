# Upgrading cyborg-hunter

What each release changes in **collected data**, **configuration** and
**reports**: read the section for every version you cross before re-running
the CLI on data collected with an older version. The complete change list is
in [CHANGELOG.md](../CHANGELOG.md).

## 0.14.0 — from 0.13

### What changes on re-run over existing data

- **Every session gets a "Cursor dynamics" section**, read from the mouse track the monitor already saved: the pointer verdict (clean, suspicious, highly suspicious, or not assessed with the reason) and the tells behind it. A session recorded before 0.14 is not assessed; what the section shows depends on the version that recorded it:
  - Sessions recorded with 0.7.2–0.7.5 read "not collected (recorded with `<version>`)" when the raw mouse track was off, the default in those versions; recorded with it on, they get the section with the three checks "not recorded".
  - Sessions recorded with 0.8–0.13 (and before 0.7.2) get the section with the three checks "not recorded": those versions saved no device facts and no click provenance, so a tap cannot be told from a scripted click.
  - Sessions recorded with `collectForPostHoc.rawMouseTrack: false`, and Qualtrics sessions, whose payload leaves the mouse track out, read "not collected". Sessions recorded with `signals.mouseTracking: false` save an empty track and read "no cursor stream (no pointer events)".
- **Rankings are unchanged.** The new `cursor` weight is 0 by default, so tiers, scores and the order of `triage.md` are those 0.13 gave. With a weight above 0, only the verdict's level (suspicious 1, highly suspicious 2) ranks, so only the sessions that carry device facts move, and the CLI warns when some sessions do not.

### What changes for newly collected data

- **The session report carries the device facts**: `device: { maxTouchPoints, coarsePointer, webdriver }`, read once at `startSession`. The cursor section uses them to tell a touch device from a desktop and to show the automation flag set by the browser.
- **Mouse samples carry viewport coordinates** (`cx`, `cy`) beside the page ones (`x`, `y`), so scrolling no longer looks like a pointer jump.
- **Clicks, presses and releases carry their provenance**: `trusted` (the event's `isTrusted`), `detail` (0 for keyboard and assistive activation) and `pointerType` when the browser gives one. The report reads them in that order, so a trusted click with `detail` above 0 and `pointerType` `touch` is a touch tap, counted apart from pointer clicks.
- **Payload size:** one trial of 2,000 mouse moves goes from 84,878 to 119,978 bytes of JSON (+41%), and one of 2,000 clicks from 86,878 to 217,978 bytes. The per-trial cap (`mouseMaxEvents`) is unchanged. The Qualtrics write still leaves the mouse track out and adds 69 bytes for the device facts, so Qualtrics sessions read "not collected" in the cursor section while the automation flag still comes through.

### What changes in the report output

- **A "Cursor dynamics" section** in each session's detail: the pointer verdict and the tells that decided it, then, in a closed details block, the three browser-reported checks with counts, denominators and trial ids, clicks that arrived without a path, clicks after a pointer jump, and the movement shape as medians with n, with the stream, its median sample interval and the constants that judged it. What the numbers mean: [interpreting-signals.md](interpreting-signals.md#cursor-dynamics).
- **A "Pointer verdict" tile** in the signal grid (0 clean, 1 suspicious, 2 highly suspicious; "—" when not assessed), a `pointer: <verdict>` cell on each rail row with a "Pointer verdict" sort option, and a `pointer verdict: <verdict> (<tells>)` clause in the triage reason when the verdict is suspicious or highly suspicious.
- **Nineteen `summary.csv` columns**, all named `cursor…`, after `honeypot_ai_report`. No existing header changes ([cli-reference.md](cli-reference.md#summarycsv)).
- **`cursor-limits.json`**, a new file beside `score-weights.json`: the constants the section judged with, their meanings and the verdicts over the cohort ([cli-reference.md](cli-reference.md#cursor-limitsjson)).
- **One line in the run output**, "Pointer verdicts: H highly suspicious, S suspicious, C clean, U not assessed (T sessions; K recorded without device facts)", which `/analyze/` prints under its results summary.
- **A `scoreWeights` key, `cursor`** (default 0), shown in the analyzer's settings as "pointer verdict (cursor)" ([configuration.md](configuration.md#report-score-weights-scoreweights)).

## 0.7.0 (and the 0.6.2 patch) — from 0.6.1

### TL;DR

- **From 0.6.1:** the headline feature — session replay — is entirely opt-in; nothing changes for studies that don't load the recorder. The CLI upgrade is worth taking regardless: several crash-on-malformed-payload paths now warn and continue, and four new misconfiguration warnings catch silent setup errors.
- **Re-running the report on existing data can shift some verdicts.** Three corrections change what the CLI reads out of already-collected data: cut events now count toward the hard-copy screenout, edge-exit analysis works again on modern payloads (it had been silently finding nothing due to a mismatched time base), and Shape-3 (top-level array) payloads keep their outer trial fields. A participant's tier can change where those signals were load-bearing; the 0.7.0 numbers are the corrected ones.

### Session replay (the 0.7.0 feature)

An optional recorder (`dist/cyborg-hunter-replay.js`) captures pointer, keys, clipboard, scroll, touch, and viewport events — and, at the `dom` tier, DOM snapshots plus mutations — so a flagged session can be reviewed visually instead of adjudicated from counts alone. Recordings use jsPsych's `SessionRecording v1` wire format with a `ch_extensions` namespace.

What ships around it:

- **A per-participant replay viewer in the CLI report** (scrub bar, cursor trail, event markers). `dom`-tier recordings reconstruct the page in a sandboxed iframe.
- **Autosave and CLI ingest of replay artifacts**, with ownership verification and reload-collision handling. Malformed artifacts are skipped with a warning; they no longer abort the report.
- **Guard-honeypot and guard-friction events appear in the replay stream**, so deterrence violations can be watched in context.
- **A per-trial camera model** keeps cursor and DOM aligned; on `dom`-tier recordings the cursor is verified per interaction, and any click that can't be confirmed draws an explicit uncertain marker instead of a wrong one. Recordings made before this guarantee existed replay under a clearly-labeled reduced-alignment banner.
- **Privacy defaults:** password inputs are redacted unconditionally; clipboard events record lengths only, never content. Field-level redaction is controlled by `redactSelector`; the full privacy model is in [using-cyborg-hunter.md](using-cyborg-hunter.md).

Integration is one more extension (jsPsych) or one `attach()` call (standalone); see the [README](../README.md#session-replay) for the wiring and [known-issues.md](known-issues.md) for the feature's documented limitations.

### What changes on re-run over existing data (0.6.2 + 0.7.0)

- **Cut events count toward the hard-copy screenout.** They were recorded but never incremented the session copy count, under-flagging participants who cut rather than copy.
- **Edge-exit analysis works on modern payloads again.** A mismatched time base had it silently finding nothing; reports may now show edge-exit events that were absent before.
- **Shape-3 (top-level array) payloads keep their outer trial fields** and get tab-away normalization.
- **`findGuardViolations()` scans all trials** instead of locking onto the first (latent for the shipped producer, live for merged or per-trial producers).
- **Robustness:** a payload with both `trials` and `responses` keeps its integrity trials; a non-array signal field is coerced with a warning instead of crashing; a numeric `trialId`/`ruleId` no longer crashes the trajectory renderer.

### What changes for newly collected data

- **The `drop` listener is no longer gated on the `paste` signal flag** — drag-and-drop events are captured even when paste monitoring is configured off.
- **Idle-gap and element-trace timers are trial-scoped** instead of leaking per session.
- **Fullscreen detection is prefix-aware** (0.6.2), removing false guard violations on Safari <16.4 and some iOS WebViews.
- **Honeypot re-initialization starts clean** (0.6.2) — a prior run's violations/state are no longer inherited, and the `decoyAnswer: false` per-trial opt-out is honored.

### New warnings (0.6.2)

The CLI now warns on an unresolved `participantIdField`, duplicate participant IDs, an unmatched `phaseScope` phase name, and a non-numeric `scoring.softScoreThreshold`. Misconfigured scoring overrides (e.g. a nested typo) warn instead of silently disabling a rule.

### Known limitations

The replay feature's deliberate limitations (non-body capture roots, ID-less input resolution, and others) are documented in [known-issues.md](known-issues.md).

## 0.6.1 — from 0.6.0

### TL;DR

- **From 0.6.0:** drop-in. Re-running `cyborg-hunter report` on already-collected data produces the same scores and triage ordering as 0.6.0. A golden regression suite freezes the full ingest → summary → triage pipeline output across the upgrade. 0.6.1 adds better session timelines for newly collected data, several new config knobs, and a fix for one silent-misconfiguration bug.
- **From 0.5.x:** read [Upgrading from 0.5.x](#upgrading-from-05x). Triage scores and ordering on existing data will shift, because 0.6.0 fixed over- and under-counting. Newly collected data no longer saves raw per-keystroke timings by default.

### What changes for newly collected data (0.6.0 → 0.6.1)

These changes affect the browser library, so they apply to sessions recorded with 0.6.1. The CLI reads previously collected data exactly as before.

**Trial reports now carry a wall-clock `timestamp`.** `endTrial()` stamps an ISO 8601 timestamp on every trial report. Renderers use it to anchor per-rule phase bands. Before 0.6.1, when the app layer didn't stamp its own timestamp, those anchors were `NaN` and phase bands could be misplaced. When the app does stamp a trial timestamp, the library's stamp shadows it during ingest; both are trial-end wall-clocks and agree to within milliseconds.

**Off-trial tab-aways keep full timing.** Tab-aways outside `startTrial`/`endTrial` (consent, tutorial, comprehension checks) used to collapse to a bare duration in `tabAwaySums`. The session report now also keeps a timestamped `tabAwayEvents[]` with `{start, duration_ms, type, timestamp}`, so the session timeline can place them instead of only counting them. Pre-0.6.1 payloads still render; the timeline footer counts their off-trial events as unplaceable.

**`layoutShifts` is now `viewportWidthShifts`.** The signal measures viewport-width changes (a ResizeObserver on `<html>`, 20 px threshold). It never measured Web-Vitals cumulative layout shift, and the old name suggested it did. Session reports carry both keys with identical content. `layoutShifts` is a deprecated alias slated for removal in the next major version: downstream pipelines that read it keep working today and should plan to migrate. The CLI's `layout_shift_count` CSV column keeps its name so downstream parsers keep working.

**Viewport-shift logging is debounced.** One resize gesture now logs one event carrying the net old→new change (250 ms quiet period, `viewportShiftDebounceMs`), instead of 5+ per-frame events per drag. Expect lower raw viewport-shift counts in newly collected data.

### New CLI config knobs (all optional)

| Knob | What it does |
|---|---|
| `participantIdField` dot-paths | `"metadata.sessionId"` now walks nested objects. Plain names keep the historical top-level → `metadata` fallback; a literal flat key containing a dot wins over the dotted walk. |
| `sessionIntegrityPath` (+ `--session-integrity-path`) | Dotted path (e.g. `"payload.cyborgHunter"`) checked before the four built-in session-integrity locations, for pipelines that nest `getSessionReport()` output somewhere non-standard. Falls through to the built-ins when it resolves to nothing, or to something that isn't a session report (see the bug fix below). |
| `phaseScope` | `{"include": [...]}` / `{"exclude": [...]}` restricts which trial phases feed summary/triage scores, honoring pre-registered phase scoping. Scoped verdicts re-derive hard and soft flags from the scoped trials; ambient session signals (sidebar, shortcuts, viewport shifts, zoom) stay session-wide; renderers still show the full session. See [interpreting-signals.md](interpreting-signals.md#phase-scoping) before using this. |
| `trajectoryDisplayOrder` | Trajectory panels default to chronological-by-rule (`"rule"`); `"time"` and `"insertion"` (the pre-0.6.1 raw order) are available. |
| `showPlatformId` / `platformIdField` | Off by default. When on, renders the platform (Prolific/MTurk) ID as a secondary line in the HTML participant detail header. Off by default because reports circulate more freely than raw data, and the platform ID is what re-identifies a participant. |
| `--config-file` | Accepted as an alias of `--config`. |

### What changes in the report output

- **Trajectory panels are tinted by phase** (peach gallery, purple typing/post-gallery-query, blue classification, grey end-requery), matching the session-timeline strip. A third legend line documents the mapping.
- **`triage.md` has an explicit Tier column** (`HARD` / `soft` / `clean`, the library's screening verdict) replacing the boolean Hard column. Its header now states that Score is the CLI's ranking heuristic, a different number from the library soft score. The two are untangled in [interpreting-signals.md](interpreting-signals.md#two-scores-three-tiers).
- **The session-timeline lane "Layout shifts" is renamed "Viewport shifts"** (legend and HTML labels likewise). The `layout_shift_count` CSV column and the "N layout shifts" triage-reason wording are unchanged so downstream parsers keep working; both read `viewportWidthShifts` and fall back to the legacy key.

### Bug fix worth knowing about

**`sessionIntegrityPath` no longer accepts a wrong-shaped object.** Before 0.6.1, pointing `sessionIntegrityPath` at a near-miss path (e.g. `"metadata"` instead of `"metadata.integritySession"`) accepted the wrong object, zeroed every downstream session signal (tab-aways, hard/soft score, and the rest), and suppressed the "No session-level integrity data" warning. A HARD-triage participant could render as clean with no indication anything was wrong. 0.6.1 checks the resolved value for at least one recognizable session-report key (`tabAwaySums`, `hardScore`, `softScore`, `anyHardTriggered`, `trialsCompleted`) before accepting it; otherwise the built-in conventions run, with the warning intact. Configs that already used this knob with a correct path on 0.6.0 see no change.

### Version stamps in the data

The library stamps `cyborgHunterVersion` into every participant's data, so version mixing within a study is visible directly in the data (the CLI does not warn about it automatically). Mixing 0.6.0 and 0.6.1 participants in one report is safe; 0.6.1-only fields stay empty for the older sessions.

## Upgrading from 0.5.x

This upgrade crosses two releases; 0.6.0 is the one with behavioral consequences.

**Re-running the report on existing data will shift triage scores and ordering.** 0.6.0 corrected several counting errors:

- Sidebar events are counted as distinct openings (a state machine collapses the runtime's separate `opened`/`closed` log entries), so sidebar-heavy participants are no longer over-scored.
- A single below-threshold hard-signal hit no longer fabricates a hard flag when the saved session score is absent.
- Tab-away binning matches the runtime's strict `>` cutoff, and the CLI honors each participant's own saved thresholds (soft-score cutoff, tab-away cutoff, typing-speed cutoff) instead of generic defaults.
- Triage ranks tier-first (hard → soft → clean), then by score within a tier.

A study triaged on 0.5.x and re-run on 0.6.1 will see participants move. The 0.6.x numbers are the corrected ones.

**Newly collected data no longer saves raw per-keystroke timings by default.** The `keystrokeDynamics` toggle (off by default in `permissive` and `standard`) now gates persistence: only the derived `charsPerSec` is kept unless persistence is opted into via `signals.keystrokeDynamics` or `collectForPostHoc.fullKeystrokeTimestamps`. The typing-speed signal is unaffected. Analysis pipelines that consumed raw `editTimestamps` need that opt-in.

**`finalize()` now persists the runtime config** (preset and effective thresholds) in `integritySession`. The CLI uses it to reconstruct each participant's screening settings. Data collected on 0.5.x lacks this, and the CLI falls back to defaults for those participants.

**Honeypot self-disclosure is surfaced** in `summary.csv` (`honeypot_ai_use`, `honeypot_ai_report`) and in the triage reason, when the guard-honeypot extension is in use.

## Deprecations

| Deprecated | Replacement | Removal |
|---|---|---|
| `layoutShifts` session-report key | `viewportWidthShifts` (both currently written, identical content) | next major version |

