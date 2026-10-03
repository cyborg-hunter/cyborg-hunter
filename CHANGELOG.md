# Changelog

All notable changes to **cyborg-hunter** are documented here. This project follows
[Semantic Versioning](https://semver.org).

## [Unreleased]

### Changed
- Experiment assets (`assetsDir`, files dropped on `/analyze/`): a file whose
  path differs from the recorded URL only in upper/lower case now matches
  when no file matches exactly and only one such file fits; several are
  reported as ambiguous.

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
