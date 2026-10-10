# Signals Reference

Every signal cyborg-hunter records, the exact thresholds per preset, and how they enter the score. Ground truth lives in `src/shared/constants.js` and `src/core/scoring.js` — this document is hand-mirrored from there. If anything contradicts the code, the code wins.

## Signal types

| Signal | Category | How it's detected | Default behavior |
|---|---|---|---|
| Paste | Clipboard | `paste` event listener | Records every paste; text captured |
| Copy | Clipboard | `copy` event listener | Records every copy |
| Drop | Clipboard | `drop` event on inputs | Records every drop; text captured |
| Tab-away | Focus | Visibility API + window blur/focus | All tab-aways logged; soft score fires for durations **strictly greater than** `tabAwayDurationMs` (default 3s, 5s for strict). Reports bin durations as flicker (≤ cutoff, not scored) / medium (cutoff–10s) / long (≥10s) using that **per-participant** cutoff; the 10s line is a display split, not the soft cutoff. Since 0.6.1 the session report also carries timestamped `tabAwayEvents[]` (start, duration, type, wall-clock) for every tab-away **including off-trial ones** (consent, tutorial, comprehension); pre-0.6.1 payloads keep only durations (`tabAwaySums`) for those, so timelines can count but not place them |
| Idle gap | Focus | No input activity for N ms | Default 10s threshold |
| Typing speed | Typing | chars/sec from input edit timestamps | Default soft threshold 10 cps |
| Synthetic insertion | Typing | Text appears without preceding keystrokes | Default 100ms gap |
| Foreign input | Typing | Typing lands outside the experiment container | All occurrences logged |
| Mouse track | Mouse | `mousemove` sampled at `mouseThrottleMs` (50 ms by default); every `mousedown`/`mouseup`/`click` | Cap of 2000 events per trial. Since 0.14 each sample carries viewport coordinates (`cx`, `cy`) beside the page ones (`x`, `y`) |
| Mouse metrics | Mouse | Path efficiency, direction changes, speed variance | Computed from ≥3 move events |
| AI extensions | Browser | DOM scan for known extension content-script selectors | 30s rescan interval |
| Sidebar gap | Browser | `outerWidth − innerWidth` delta | 100px gap by default |
| Viewport-width shift | Browser | ResizeObserver on `<html>` (`innerWidth − clientWidth` delta) | 20px delta; debounced 250ms so one resize gesture logs one event. Recorded as `viewportWidthShifts` since 0.6.1, with `layoutShifts` kept as a deprecated alias (the signal never measured Web-Vitals CLS) |
| Keyboard shortcuts | Browser | `keydown` listener for DevTools hotkeys (Ctrl/Cmd+Shift+I/J/C, F12) | All occurrences logged in `keyboardShortcuts` |
| Window position | Browser | Polled `screenX`/`screenY` + resize event | 2s poll + on-resize sample |
| Zoom changes | Browser | Inferred from `devicePixelRatio` change | Diagnostic |
| DOM mutations | Browser | `MutationObserver` for injected custom elements | Skips known-benign extension tags |
| DevTools open | Browser | Inferred from the DevTools hotkeys above (no separate window-size heuristic) | Recorded under `keyboardShortcuts`; the `devToolsEvents` array is reserved and currently unpopulated |

## Pointer verdict

One verdict per session (`clean`, `suspicious`, `highly suspicious` or `not assessed`), read by the report's cursor section from what the monitor records, with the tells that decided it. None of it enters the library's soft score or the tier; `scoreWeights.cursor` can add the verdict's level, times its weight, to the CLI's triage score ([configuration.md](configuration.md#report-score-weights-scoreweights)). What each tell means, its thresholds and its innocent causes: [interpreting-signals.md](interpreting-signals.md#two-scores-three-tiers).

| Tell | What is recorded | Since |
|---|---|---|
| Automation flag set by the browser | `navigator.webdriver`, read once at `startSession` into the session report's `device` object, beside `maxTouchPoints` and whether `(pointer: coarse)` matches (`coarsePointer`) | 0.14 |
| Clicks the page's own scripts dispatched | On every recorded `click`, `down` and `up` sample: `trusted` (the event's `isTrusted`) and `detail` (0 for keyboard and assistive activation), and `pointerType` when the browser gives one. The report counts the clicks whose `trusted` is false, whatever their `detail` | 0.14 |
| Trials clicked without pointer movement | Nothing beyond the mouse track. The report sorts each click by what the browser recorded, in this order: `trusted` false is a click the page's own scripts dispatched; else `detail` 0 is keyboard activation; else `pointerType` `touch` is a touch tap, counted apart and never a pointer click; any other click is a pointer click. A trial counts when it has no `move` sample and at least one pointer click lands 20 px (`samePositionPx`) or more from the pointer's last known position, or when no position is known. The session's `device` leaves touch devices out | 0.14 |
| Clicks that arrived without a path | Nothing beyond the mouse track: a first pointer click (`detail` 1, or none recorded) whose movement has at most one move sample and starts 20 px or more from the last known position, judged only when the click has a known position before it | 0.14 |

Sessions recorded before 0.14 carry no `device` object and no click provenance, so the report shows the three browser-reported checks as "not recorded" and the session as not assessed.

## Two-tier scoring

The library combines two independent screening mechanisms.

### Hard signals — count thresholds, immediate screenout

If a hard signal's count **reaches or exceeds** its threshold (`count >= countThreshold`) for the active preset, the participant is flagged immediately (no grace period). So a `paste` threshold of 2 fires on the 2nd paste, not the 3rd.

| Signal | Permissive | Standard | Strict |
|---|---|---|---|
| Paste | 3 events | 2 events | 1 event |
| Drop | 3 events | 2 events | 1 event |
| Copy | — | — | 2 events (promoted to hard in strict) |

### Soft signals — weighted accumulation, screenout after grace period

Each soft event adds its weight to the running soft score. When the score crosses the preset threshold AND the participant has completed the grace-period number of trials, screenout fires.

| Signal | Permissive (wt) | Standard (wt) | Strict (wt) |
|---|---|---|---|
| Copy | 1 (cap 2/trial) | 2 (cap 2/trial) | — (hard in strict) |
| Tab-away | 1 (cap 2/trial) | 1 (cap 2/trial) | 2 (cap 1/trial) |
| Typing speed (fast) | 1 | 2 | 3 |
| Sidebar event | 1 | 3 | 2 |
| DevTools open | 1 | 1 | 2 |
| Foreign input | 1 | 2 | 3 |
| **Threshold** | **10** | **6** | **4** |

### Screenout settings

| Setting | Permissive | Standard | Strict |
|---|---|---|---|
| Screenout enabled | No (collect only) | Yes | Yes |
| Grace period (trials before screenout can fire) | 5 | 3 | 2 |

## Default thresholds

Numeric defaults that apply across presets unless overridden:

| Parameter | Default | Notes |
|---|---|---|
| `pasteMinChars` | 0 | Records every paste regardless of length |
| `dropMinChars` | 0 | Records every drop regardless of length |
| `sidebarGapPx` | 100 | Detection threshold for sidebar opening |
| `layoutCompressionPx` | 20 | Threshold for a viewport-width shift |
| `viewportShiftDebounceMs` | 250 | Quiet period before a viewport-width shift is logged — one gesture = one event (added 0.6.1) |
| `syntheticGapMs` | 100 | Keystroke-to-input time below which an insertion is treated as synthetic |
| `idleGapMs` | 10000 | Period of input inactivity that counts as idle |
| `mouseThrottleMs` | 50 | Minimum time between two recorded `mousemove` samples (at most 20 a second by default) |
| `mouseMaxEvents` | 2000 | Per-trial cap on mouse events captured |
| `mouseBotMinEvents` | 3 | Minimum events needed to compute mouse metrics |
| `tabAwayDurationMs` | 3000 | Tab-away durations longer than this add to the soft score (the `strict` preset raises it to 5000) |
| `typingSpeedCps` | 10 | chars/sec above which typing is "fast" |

The `strict` preset overrides several of these (`typingSpeedCps: 8`, `tabAwayDurationMs: 5000`, `mouseMaxEvents: 5000`).

## Enabling and disabling signals

All signals are on by default except `keystrokeDynamics`, which is off by default in `permissive` and `standard` presets and on in `strict`. Override per signal, with the one-line setup in `window.CyborgHunterConfig` above the ch.js tag ([Configuration beyond data-*](advanced-integration.md#configuration-beyond-data-)):

```javascript
window.CyborgHunterConfig = {
  preset: 'standard',
  signals: {
    keystrokeDynamics: false,  // off by default; see note below
    mouseTracking: false       // disable to reduce data volume
  }
};
```

In manual mode, pass the same options to `CyborgHunter.init()`:

```javascript
CyborgHunter.init({
  preset: 'standard',
  signals: {
    keystrokeDynamics: false,  // off by default; see note below
    mouseTracking: false       // disable to reduce data volume
  }
});
```

**`keystrokeDynamics`** controls whether the **raw per-edit timestamps** are
persisted in each trial report. When off (the default in `permissive`/`standard`),
the typing-speed signal still works — only the derived `charsPerSec` is saved, and
the raw timings never leave the browser. Turn it on (or set
`collectForPostHoc.fullKeystrokeTimestamps: true`) to keep the full timestamp array
for keystroke-dynamics analysis.

**`devTools` and `keyboardShortcuts`** both control the same detector: a `keydown`
listener for DevTools hotkeys (Ctrl/Cmd+Shift+I/J/C, F12). Enabling **either** signal
turns the listener on; the soft `devTools` scoring weight then scores the captured
hotkeys (recorded in `keyboardShortcuts`). There is no separate viewport-based
DevTools detector.

The full set of toggles (matching `PRESETS.standard.signals` in `constants.js`):

`paste`, `copy`, `tabAway`, `typingSpeed`, `devTools`, `aiExtensions`, `sidebarGap`, `keyboardShortcuts`, `mouseTracking`, `idleGaps`, `windowPosition`, `clipboardManager`, `keystrokeDynamics`.

## AI-extension detector

The DOM scanner looks for content scripts injected by known third-party AI extensions. Current selector list (from `AI_SELECTORS` in `constants.js`):

| Extension | CSS selector |
|---|---|
| ChatGPT sidebar | `chatgpt-sidebar` |
| ChatGPT extension | `[data-chatgpt]` |
| Copilot extension | `copilot-suggestions`, `[data-copilot]` |
| Gemini extension | `gemini-panel` |
| Claude extension | `[data-claude-extension]` |
| Monica AI | `monica-root` |
| Merlin AI | `merlin-root` |
| Sider AI | `[data-sider-extension]` |
| MaxAI | `[data-maxai]` |
| Generic AI marker | `[data-ai-assistant]` |
| AI iframes | `iframe[src*="chat.openai.com"]` (and similar) |

**Important: native browser AI panels do NOT show up here.** Chrome's built-in Gemini side panel, Edge's built-in Copilot, etc. are not extensions — they leave no content scripts in the DOM. The viewport-shrink heuristic (`sidebarGap` signal) catches them as generic sidebar events instead, so the screening still works; they just won't appear in the named-extension column of the report.

Benign tags (Grammarly, LastPass, 1Password, etc.) are filtered out of the `MutationObserver` alerts so they don't pollute the signal.

## Report CSV columns from session-level data

`cyborg-hunter report` emits per-trial signal counts AND aggregates derived from session-level data. The session columns need session-level data: the one-line setup writes it on every row as it goes, and manual mode needs `finalize()` to have been called before the save (see [`advanced-integration.md`](advanced-integration.md#manual-mode)). If only per-trial `data.integrity` records are present, these columns are zero/empty and the CLI prints a warning.

| Column | Source | Description |
|---|---|---|
| `sidebar_event_count` | session | Sidebar-gap detections during the session |
| `ai_extensions` | session | Distinct AI-extension selectors matched (semicolon-joined) |
| `keyboard_shortcut_count` | session | DevTools-hotkey presses (Ctrl/Cmd+Shift+I/J/C, F12) |
| `layout_shift_count` | session | Viewport-width shift events. Column name kept for pipeline stability; reads `viewportWidthShifts` with fallback to the pre-0.6.1 `layoutShifts` key |
| `zoom_change_count` | session | Inferred zoom level changes |
| `dev_tools_event_count` | session | Reserved column; currently always 0 (DevTools-open is counted under `keyboard_shortcut_count`) |
| `authoritative_soft_score` | session | Soft score from `getSessionReport()` (preferred over summed per-trial) |

### Scoring behavior

- Participant-level `hardTriggered` reads the session's `anyHardTriggered` when available. If no session score was saved, it falls back to the per-trial signals — a participant is hard only if some trial's cumulative `trialSignals.hard.*.sessionTotal` reached that signal's `countThreshold` (a single hit below the threshold is **not** hard). When that data is absent the participant is left un-flagged rather than promoted to hard.
- Triage soft-flag check uses `(authoritativeSoftScore ?? totalSoftScore) >= threshold`, where `threshold` is an explicit analyst CLI override if set, otherwise the participant's own saved `softScoreThreshold`, otherwise 6.
- The CLI **triage score** is a separate ranking heuristic (not the library soft score): by default `5 × paste + 5 × copy + 3 × sidebar-open + 1 × tab-away`, where a counted tab-away is one **longer than the participant's tab-away threshold** (3s by default, 5s for the strict preset — the same cutoff the runtime soft-scores against). Under the default weights no hard-trigger term, AI-extension, keyboard-shortcut, layout, zoom, edge-exit, synthetic, or foreign-input bonus, and, since 0.14, `cursor` (the pointer verdict's level), contributes to it; `scoreWeights` in the CLI config can weight any of them ([configuration.md → Report-score weights](configuration.md#report-score-weights-scoreweights)). The ranked list is then ordered tier-first (hard → soft → clean), score-desc within tier, so hard-triggered participants lead regardless of score. See [cli-reference.md → Triage scoring](cli-reference.md#triage-scoring).
