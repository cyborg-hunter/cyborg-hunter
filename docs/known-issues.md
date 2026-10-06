# Known Issues

Issues we've identified but not yet fixed. Filed here rather than dropped in commit messages so they're easy to find and revisit.

## One-line setup

Every console error from a one-line file (`ch.js`, `ch-qualtrics.js`, `ch-labjs.js`) links here or to the page that explains its fix. Each one starts with `[cyborg-hunter]`, then names the problem, its cause and the fix. In every case the experiment keeps running.

| Message starts with | What it means | What to do |
|---|---|---|
| `Cyborg Hunter did not start`, `could not hook initJsPsych`, `could not hook a lab.js component`, `could not instrument the timeline`, `could not write the end-of-session data`, `could not record a page boundary`, `The … guard is not running` | An unexpected failure inside the one-line file. Data recorded before it is kept, and the affected rows or saved object carry `cyborgHunterError`. | [Open an issue](https://github.com/cyborg-hunter/cyborg-hunter/issues) with the console message and your `<script>` tag. Never attach participant data. |
| `Cyborg Hunter is not running on this page` | A `CyborgHunter` call ran after ch.js failed to start (see the error above it), so the call did nothing. `CyborgHunter.data()` returns an empty session that names the failure. | Fix the earlier error. |
| `This page runs …, which … does not monitor` | The page runs a framework whose one-line file is not the one loaded: `ch.js` or `ch-labjs.js` on a Qualtrics survey (load `ch-qualtrics.js`), `ch-qualtrics.js` or `ch-labjs.js` on a jsPsych page (load `ch.js`), or `ch.js` or `ch-qualtrics.js` on a lab.js page (load `ch-labjs.js`). The loaded file records the page as a page without a framework, so the framework's own data gets nothing: no integrity columns in jsPsych's or lab.js's rows, nothing in Qualtrics' embedded data. With `data-debug` the badge ends with `wrong file: …`. | Load the file the message names ([Which file](quickstart.md#which-file)). |
| `A second jsPsych instance was created` | ch.js records one session per page and ends it when the first instance finishes. Later trials are not monitored. | Use one `initJsPsych()` and one timeline, or [manual mode](advanced-integration.md#manual-mode) with `cyborg-hunter.min.js`. |
| `A second lab.js study ran after the first ended` | ch-labjs.js records one session per page and ends it when the first lab.js study's root component ends. Components run after that get no integrity columns. A component run on its own, outside the study's root, counts as a study. | Run one study per page, or reload the page between studies; keep every component inside the study's root ([lab.js](labjs.md#the-end-of-the-session)). |
| `Friction is only partly set up` | The page has a friction start (the entry trial, `data-ch-friction-start` or `CyborgHunter.startFriction()`) but `data-guards` does not list `friction`. Enforcement still starts, without the AI refusal notices. | Add `friction` to `data-guards`, or remove the start ([Friction](advanced-integration.md#friction)). |
| `The saved session is approaching the sessionStorage limit` / `The session could not be carried to the next page` | Pages without jsPsych: the session kept for the next page is over 4 MB, or storage refused it. | Set `CyborgHunterConfig.collectForPostHoc.rawMouseTrack = false`, or save `CyborgHunter.data()` on every page ([Vanilla segmentation reference](advanced-integration.md#vanilla-segmentation-reference)). |
| `Session replay is not recording` | `cyborg-hunter-replay.js` did not load: missing file, network error, Content-Security-Policy, or more than 15 s. | Put it next to `ch.js` or set `data-replay-src`, and allow its URL in `script-src` ([Replay with the one-liner](advanced-integration.md#replay-with-the-one-liner)). |
| `Qualtrics legacy layout detected` | The survey runs the older layout (New Survey Taking Experience off), so the payload goes to the field `cyborg_hunter`. | Declare `cyborg_hunter` in Survey Flow, or switch to the New Survey Taking Experience ([Legacy layout](qualtrics.md#legacy-layout)). |
| `The jsPsych trials on this survey are not recorded one by one` | `ch-qualtrics.js` found a survey whose page also runs jsPsych: it writes a row per page to embedded data and none per jsPsych trial. | Nothing for the page rows; for rows per trial see [jsPsych inside a survey](qualtrics.md#jspsych-inside-a-survey). |
| `The Qualtrics payload was reduced` | The session's summary was over the embedded-data cap, so a reduced level was written. The report's counts, scores and tier stay those of the whole session; the page rows and event lists cover only what was kept. | Nothing for that participant ([Payload size](qualtrics.md#payload-size)). |
| `Cyborg Hunter could not write to Qualtrics embedded data` | Qualtrics' embedded-data setter failed (nothing was written at that submit; the next write carries a note), or the payload failed its check (an error record was written in its place). The survey goes on. | [Open an issue](https://github.com/cyborg-hunter/cyborg-hunter/issues) with the console message and your `<script>` tag ([Troubleshooting](qualtrics.md#troubleshooting)). |
| `data-replay is on under Qualtrics` | A recording never fits in embedded data, so `ch-qualtrics.js` does not write it. | Save `CyborgHunter.replay()` to your own server from the final page ([Replay](qualtrics.md#replay)). |

Known limits of the one-line setup:

- **Bundled jsPsych cannot be hooked.** A build that calls `jsPsychModule.initJsPsych` or `new JsPsych` directly (npm, ES modules) never goes through `window.initJsPsych`. ch.js logs the placement error when jsPsych starts and records the page as one without jsPsych. Use [manual mode](advanced-integration.md#manual-mode) with `cyborg-hunter.min.js`. jsPsych 8 is not supported yet.
- **`<head>` placement misses the first moments.** With ch.js in `<head>`, monitoring and the first segment start at `DOMContentLoaded`, so a paste before then is not recorded and a mark before then writes nothing.
- **Some programmatic submits are not covered.** `form.submit()` on a form inside another frame, or through a reference taken before ch.js ran, does not get the `cyborgHunterData` field. GET forms never get it.
- **lab.js: a Parallel is one trial.** `flow.Parallel` runs its children at once and the monitor holds one trial at a time, so the Parallel is the trial and the components under it get no integrity columns ([lab.js](labjs.md#what-counts-as-a-trial)).
- **lab.js: `lib/lab.fallback.js` can replace the hooked library.** The lab.js 20.x starterkit's `index.html` also loads `lib/lab.fallback.js`, which adds `lib/lab.legacy.js` to the page when the browser cannot evaluate an async generator (an old browser, or a page whose Content-Security-Policy blocks `eval`). That build replaces `window.lab` after ch-labjs.js has hooked the first one, so the study's rows may get no integrity columns in such a browser. The builder's own exports do not load it.
- **lab.js 23 is not supported yet.** On a lab.js 23 pre-release, ch-labjs.js warns once and records the page as one without jsPsych or lab.js ([lab.js 23](labjs.md#labjs-23)).
- **A save trial cannot hold the end of the session.** A save-as-a-trial plugin (DataPipe) saves before the session ends, so that file has no `integritySegmentFinal` and nothing from the save trial itself ([loss bound](advanced-integration.md#data-format-the-rolling-snapshot)).
- **Qualtrics.** On a survey whose page also runs jsPsych (`initJsPsych`), `ch-qualtrics.js` writes a row per page to embedded data and none per jsPsych trial ([jsPsych inside a survey](qualtrics.md#jspsych-inside-a-survey)); `ch.js` there runs as on any jsPsych page: it does not look for Qualtrics, writes nothing to embedded data, and when Qualtrics runs the header again on the next page, that second `ch.js` logs the double-load error, which can be ignored there. A second tag of the same one-line file and version in a survey (a second `ch-qualtrics.js` tag beside the header's, say) is taken for the header's re-run and ignored without a message; a different one-line file beside it (a `ch.js` tag next to `ch-qualtrics.js`) logs the double-load error. Under the legacy layout the saved session is not kept per survey, so two surveys on one Qualtrics domain in the same tab, under the same participant ID, continue one session. A survey of more than about eight pages (fewer with many events) is written at a reduced level (per-page detail for the newest five pages; counts and scores cover the whole session). Qualtrics drops page-submit callbacks after each page, so if the participant presses Next on the final page before the header runs again, that page is written only by the [final-page line](qualtrics.md#the-final-page). `ch-qualtrics.js` cannot tell whether `__js_cyborg_hunter` is declared (the badge says `unknown`); check View Response after a preview ([Declare the field](qualtrics.md#declare-the-field)). If a participant closes the tab and later continues the same response, `ch-qualtrics.js` starts a new session and its next write replaces the earlier pages' data ([Closing the tab and resuming a response](qualtrics.md#closing-the-tab-and-resuming-a-response)). Details: [qualtrics.md](qualtrics.md).
- **A file without the jsPsych adapter above `jspsych.js`.** `ch-qualtrics.js` and `ch-labjs.js` look for jsPsych when they load, find none above `jspsych.js`, and look once more at `DOMContentLoaded`: then they log the wrong-file error naming `ch.js` (`ch-qualtrics.js` on a Qualtrics survey logs the warning that the jsPsych trials are not recorded one by one instead). The page stays as the file found it at load: a page without a framework, a Qualtrics page or a lab.js page.
- **`ch.js` above `jspsych.js` on a survey.** On a survey page that is still loading, it logs the wrong-file error (load `ch-qualtrics.js`) at load and `Not monitoring jsPsych trials: ch.js was loaded before jspsych.js` at `DOMContentLoaded`. Follow the second: a file with the jsPsych adapter takes a jsPsych page as jsPsych, so `ch.js` belongs below `jspsych.js` there.
- **`jsPsychCyborgHunter` in a file without the jsPsych adapter.** The extension does not exist in `ch-qualtrics.js` or `ch-labjs.js`, so a timeline that lists `jsPsychCyborgHunter` by hand throws a `ReferenceError`. Off a survey the wrong-file error comes before the throw when the tag is below `jspsych.js`, and after it, at `DOMContentLoaded`, when the tag is above; on a survey the warning from `ch-qualtrics.js` that the jsPsych trials are not recorded one by one takes its place.
- **Bundled jsPsych and a file without the jsPsych adapter.** On a page whose jsPsych is bundled or an ES module (no global `initJsPsych`), `ch-qualtrics.js` and `ch-labjs.js` see no jsPsych and stay silent. As with `ch.js` and bundled jsPsych above, the trials get no rows of their own, but no message says so.
- **lab.js that `ch.js` and `ch-qualtrics.js` do not see.** They look for lab.js (`window.lab`) only when they load, and if it is there on a page without jsPsych or Qualtrics, log the wrong-file error naming `ch-labjs.js`. A lab.js loaded after their tag, or bundled so that it never defines `window.lab`, gets no message, and its rows get no integrity columns.
- **`ch-labjs.js` on a lab.js page that also runs jsPsych.** A page with both frameworks counts as a jsPsych page: with jsPsych there when `ch-labjs.js` loads, it logs the wrong-file error naming `ch.js` and does not hook lab.js. With `lib/lab.js` above its tag and jsPsych loaded after it, it logs the same error once, at `DOMContentLoaded`, while lab.js stays hooked and its rows keep their integrity columns; the jsPsych trials get none.

## Session replay (0.7.0 feature)

The items below are known limitations of the replay feature, kept open deliberately.

### Viewer for the replay resolves mutation paths against `document.body`, not the capture root

**Symptom:** `src/cli/renderers/replay-viewer.client.js` `applyMutation()` resolves each patch path from `doc.body`, but capture paths (`capture-dom.js` `nodePath`) are relative to the configured `root`. With the default `root` (document.body) this works — the serialized `<body>` collapses when re-inserted, aligning the root's children with the viewer body's children. With a **non-body root** (e.g. `root: '#experiment'`), the serialized root element becomes a child of the viewer body, so every path is shifted one level and mutations apply to the wrong node — the replay diverges from what the participant saw.

**Fix (deferred — format-level):** make capture and viewer agree on the root anchor. Cleanest is to serialize the root's *children* (innerHTML semantics) for `initial_dom` so the viewer body holds exactly the root-relative children for both cases; alternatively record the root path in the model and anchor `resolvePath` there. Deferred because it changes the recording format and touches the DOM-snapshot tests + guard-violation snapshots.

**Severity:** Major for studies that set a non-body capture root; the default is unaffected.

### ID-less input elements are resolved by first tag match in the viewer

**Symptom:** An input/textarea with no `id` is described only by tag name in the trace (`capture-trace.js`, `describeEl`); the viewer selects the first element of that tag (`replay-viewer.client.js`). Typing into the second of two ID-less textareas updates the first textarea in the replay.

**Fix (deferred):** capture an nth-of-type index or a child-index path for ID-less targets, and resolve it in the viewer. Minor fidelity issue; most experiment fields carry ids.

**Severity:** Minor.

## Client-side authority limits (inherent, not patchable)

### The guard-friction stop token is not a security boundary

**Symptom:** `GuardFriction.start()` returns a 256-bit stop token and stashes it on `window._guardFrictionToken` (non-enumerable). A participant who reads the (public, npm-published) source can run `GuardFriction.stop(window._guardFrictionToken)` to cleanly tear down monitoring. After the stop, leaving fullscreen or opening a sidebar produces no new violations, and because `stop()` also clears the tamper interval, no tamper marker is recorded. The early stop is indistinguishable from the legitimate end-of-session `finalize()` stop.

**Why it can't be fixed by hiding the token better:** the property name is in the shipped source, and `GuardFriction` is itself on `window`; a non-enumerable property is trivially readable by name. Any client-side secret is readable by client-side code. The token only stops accidental/naive calls, not a motivated cheater.

**Improvement worth considering (not a fix):** make an early stop *observable* rather than trying to prevent it — e.g. record the guard's active-state per trial (so a stopped guard shows as "guard inactive" instead of "no violations"), or emit a distinct marker into the honeypot log when `stop()` runs while trials are still ongoing. That converts a silent bypass into a visible one without pretending the token is a lock.

**Severity:** Bounded by design. The active guard raises the cost of evasion (friction) and the honeypot bait surfaces provide an independent, non-listener detection path; neither depends on the token being secret.

## Signal-layer edge cases

### Core sidebar detection is blind to a sidebar opened before `startSession()`

(Same class as the guard-extension entry "Sidebar opened before fullscreen entry is not detected," but for the core `browser.js` signal.)

**Symptom:** `attachBrowserSignals()` captures `_baselineIW = window.innerWidth` (and the ResizeObserver's `baselineWidth = document.documentElement.clientWidth`) at `startSession()`. If an AI browser sidebar is already open at that moment, the shrunk viewport is baked into the baseline, so `sidebarEvents` and `viewportWidthShifts` stay empty for the whole session — the sidebar contributes no soft score.

**Root cause:** sidebar detection is a *delta-from-baseline* detector with no absolute expected-width reference. It can only see a sidebar that opens (or closes) after the baseline is captured.

**Why it isn't patched here:** the obvious absolute check (`screen.availWidth - innerWidth > threshold`) is unreliable across multi-monitor and OS-scaled configurations and across browser zoom (the guard extension deliberately dropped exactly this comparison for that reason — see `extension-guard-friction.js:499-507`). A robust fix would capture a pre-experiment baseline before any sidebar could be open, which is an experiment-flow change, not a library-internal one.

**Severity:** Medium for a participant who opens the sidebar before the experiment loads and never resizes it. Partially covered by the foreign-input and AI-extension-DOM signals if the participant interacts with an extension-based assistant.

### An open tab-away is lost if the participant never returns

**Symptom:** `focus.js` records a tab-away only on `_onReturn()`. If a participant switches away (blur / tab hidden) during a trial and the trial ends while they are still away — or they never return before the session finalizes or navigates away — the event is absent from both the trial report and `getSessionReport()` (`tabAwayEvents=[]`, `tabAwaySums=[]`). A tab-away that spans a trial boundary is also attributed to whichever trial is active at *return* time, not the trial it began in.

**Root cause:** the leave sets a pending start; only the matching return materializes the `{start, duration_ms, type, timestamp}` record. There is no flush of an in-progress interval at `endTrial()` / `getSessionReport()`, and a true navigation-away exit gives no return event at all.

**Partial remediation (deferred, would change emitted data → a future minor version):** flush any pending tab-away at `endTrial()` and `getSessionReport()` as a partial-duration event (kept open so the eventual return can finalize it), and add a `pagehide`/`visibilitychange→hidden` handler that records the open interval before unload. The abrupt-navigation case is only recoverable if the adopter's save path runs on unload; the trial-end/never-return-before-finalize case is fully recoverable and is the higher-value half.

**Severity:** Medium, and a genuine evasion vector: leave during a trial to consult an assistant, return after the trial has advanced, and the tab-away is misattributed or invisible.

### `charsPerSec` counts input *events*, not characters

**Symptom:** `computeTypingSpeed()` uses `editTimestamps.length` (one entry per `input` event) as the character count, so the "chars per second" metric is really *edits* per second. For normal keystroke-by-keystroke typing the two coincide, but a single `input` event that inserts a long string counts as one "char." An automation that sets a long answer via one `input` event (paired with one `keydown` inside `syntheticGapMs` so the synthetic-insertion detector also stays quiet) produces `editTimestamps.length` of 1, so `computeTypingSpeed` returns `null` and no typing-speed signal fires — while also leaving `pasteEvents` and `syntheticInsertions` empty.

**Why the naming isn't simply renamed:** the metric works for its intended job (flag implausibly fast human typing); burst insertions are meant to be caught by the paste and synthetic-insertion detectors, not the speed metric. The evasion above is the sharper issue and is a known limitation of the synthetic-insertion heuristic: pairing a real `keydown` with the programmatic `input` defeats the keydown-gap test. Closing it requires deeper input-provenance fingerprinting (e.g. `isTrusted`, cadence entropy) rather than a rename.

**Severity:** Low-to-medium. Requires DOM-automation authority (the adversarial-participant threat model), and is one of several signals such an adversary can suppress (see the client-side-authority limits above).

## CLI ingest / analysis

### Malformed `tabAwaySums` values are coerced with `Number(d) || 0`

**Symptom:** `computeTabAwayCounts()` (`src/cli/analyzers/summary.js`) maps the session-level `tabAwaySums` array with `Number(d) || 0`. A non-numeric string (`"12000ms"`) becomes `NaN → 0` and is mislabeled as a flicker; `null` becomes a fabricated 0-duration event; `"Infinity"` passes through and poisons `totalTabAwayDuration_ms`. So `tabAwaySums = ["12000ms", null, "Infinity"]` yields `totalTabAways=3`, one long, one flicker, and an infinite total.

**Why it isn't patched here:** `tabAwaySums` is produced by the library as `Math.round(duration)` — always finite numbers — so this only bites on hand-edited or corrupted payloads, and the fix (filter to `Number.isFinite`, drop non-finite entries) changes the tab-away *count* semantics, which existing cohorts' pinned pipeline output depends on. A future minor version can filter non-finite durations behind the same versioned-behavior rule the cut-counting fix used.

**Severity:** Minor. Producer-controlled; affects only malformed session payloads.

## Guard / friction

### Sidebar opened before fullscreen entry is not detected

**Symptom:** A participant who opens a browser sidebar (Chrome Gemini, Edge Copilot, docked DevTools, reading panes, etc.) *before* clicking "Enter fullscreen and continue" on the entry trial does not get a `sidebar_open` violation, even though the sidebar remains visible alongside the experiment for the rest of the session. They are caught by the `window_blurred` check the moment they click into the sidebar — but if they only read from it (no focus shift), they are never flagged by the sidebar check at all.

**Root cause:** Baseline capture in `extension-guard-friction.js:567-587` runs once `fullscreenchange` fires:

```javascript
state.baselineWidth = window.innerWidth * dpr;
```

If a sidebar is already open at that moment, `window.innerWidth` already reflects the shrunk viewport. The "baseline" silently bakes in the sidebar's compression. Subsequent `check()` calls compare current innerWidth against that already-compressed baseline, find no delta, and pass the sidebar test.

The sidebar check (`extension-guard-friction.js:487-498`) only triggers on a shrink *relative to baseline* — it has no notion of an absolute "expected viewport size."

**Why it follows from the model's logic:** The DPR-stable baseline approach (`innerWidth × devicePixelRatio`) is designed to be invariant under browser zoom, which is correct. It assumes the comparison reference (baseline) was captured in a "clean" no-sidebar state. The fullscreen-entry event is the only opportunity to capture that reference, and at that moment the sidebar may already be open.

**Possible remediations** (not yet implemented, ranked by robustness):

1. **Capture pre-fullscreen baseline.** In the entry trial's `on_finish`, snapshot `window.innerWidth` *before* calling `requestFullscreen()`, then compare to the post-fullscreen value. A non-trivial shrink (or no growth into fullscreen) implies a sidebar was already eating space. Most robust because it doesn't rely on `screen.availWidth` reliability.
2. **Pre-entry sidebar check via `screen.availWidth`.** Compute `screen.availWidth - innerWidth` at the moment the user clicks "Enter fullscreen." If > 80 CSS px, refuse entry with a "please close any sidebars first" message. Has the `availWidth` reliability caveat (multi-monitor + scaled-OS configs can produce surprising values).
3. **Continuous `availWidth` sanity check.** After baseline capture, also assert `baseline_css_px > screen.availWidth - 80px`. If not, treat baseline as poisoned and re-baseline. Lower confidence — `availWidth` doesn't always match what you'd expect.

**Severity:** Medium. Defeated by the `window_blurred` check the moment the participant interacts with the sidebar. Concerning for participants who use the sidebar in read-only mode (e.g., an LLM analyzing screenshots they take separately, or a sidebar that streams content without requiring focus).

**Worth noting alongside this:** The visible bait surfaces (`extension-guard-honeypot.js:191-226`) provide an independent detection path for agentic browsers that fill DOM elements regardless of fullscreen / focus state. The sidebar-detection gap doesn't subvert the bait surfaces.