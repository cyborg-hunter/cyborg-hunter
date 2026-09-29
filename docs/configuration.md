# Configuration Reference

## Generating a starter config

```bash
cyborg-hunter init
```

Creates a `cyborg-hunter.config.json` in the current directory:

```json
{
  "dataDir": "./data",
  "filePattern": "*.{json,csv}",
  "outputDir": "./cyborg-hunter-report"
}
```

`init` writes `*.{json,csv}` because most jsPsych setups save CSV via `localSave('csv', ...)` and server-side-saving setups typically save JSON. The runtime *fallback* default (when no config file is present) is just `*.json` — broaden it with the config file or with the `--file-pattern` CLI flag.

## Config file fields

> **Which fields actually do something.** The current CLI consumes `dataDir`,
> `filePattern`, `participantIdField`, `integrityField`, `sessionIntegrityPath`,
> `phaseScope`, `trajectoryDisplayOrder`, `outputDir`,
> `typingSpeedThreshold_cps`, `thresholds.tabAwayDurationMs` (the tab-away
> display/soft-bin cutoff), `scoring.softScoreThreshold` (an optional analyst
> override for the soft-flag cutoff — by default the CLI uses each participant's
> own saved threshold), and `scoreWeights` (the triage-score weights, since
> 0.9.0), plus `platformIdField`/`showPlatformId` for the HTML detail header. The remaining fields below — `trialIdField`, `trialOrderField`,
> `trialsPerParticipant`, `conditionField`, `groupField`,
> `tabAwayMinDuration_ms`, `idleGapThreshold_ms`, `suspiciouslyFastRT_ms`,
> `trajectoryGrid`, `trajectoryTrialLabel`, `trajectoryResponseField`,
> `outputFormat`, and the rest of `signals` — are **accepted but not yet consumed**
> (placeholders for planned features). They are kept as known keys so existing
> configs don't trigger "unknown key" warnings; setting them has no effect today.
> Note: the tab-away soft-scoring cutoff is the *library* threshold
> `thresholds.tabAwayDurationMs` (default 3000 ms), applied at collection time —
> not the reserved CLI field `tabAwayMinDuration_ms`.
>
> The CLI's "did you mean?" validator shares one key list with the browser library,
> so a CLI config file can also carry browser-only keys (`preset`, `participantId`,
> `signals`, `domProtection`, etc.) without a warning. Those keys configure the
> *runtime* (in your experiment page), not the report; placing them in the CLI
> config has no effect on `cyborg-hunter report`.

### Data source

| Field | Type | Default | Description |
|---|---|---|---|
| `dataDir` | string | `"./data"` | Directory containing participant data files |
| `filePattern` | string | `"*.json"` (runtime) / `"*.{json,csv}"` (init) | Glob pattern for data files |
| `participantIdField` | string | `"participantId"` | Field name holding the participant ID. **For jsPsych output, this is usually `"subject_ID"`.** Supports dot-paths since 0.6.1 (`"metadata.sessionId"`); plain names keep the historical top-level → `metadata` fallback. |
| `trialIdField` | string | `"trialId"` | Field for trial ID |
| `trialOrderField` | string | `"trialIndex"` | Field for trial order |
| `integrityField` | string | `"integrity"` | Per-trial field that holds the integrity sub-object |
| `sessionIntegrityPath` | string | `null` | Dotted path to the session-level integrity object (`"payload.cyborgHunter"`) for pipelines that nest `getSessionReport()` output somewhere non-standard. Checked before the built-in locations; falls through to them when it resolves to nothing **or to an object that doesn't look like a session report** (no `tabAwaySums`/`hardScore`/`softScore`/`anyHardTriggered`/`trialsCompleted` key — e.g. a near-miss path landing one level up the tree). Added 0.6.1. |
| `trialsPerParticipant` | number | `null` | Expected trial count (`null` skips the check) |
| `platformIdField` | string | `null` | Prolific/MTurk ID field (dot-paths supported). Read by the HTML report only when `showPlatformId` is true |
| `showPlatformId` | boolean | `false` | Render the platform ID as a secondary line in the participant detail header. Off by default: reports circulate more freely than raw data, and the platform ID is what re-identifies a participant (added 0.6.1) |
| `conditionField` | string | `null` | Experimental condition field |
| `groupField` | string | `null` | Group/block field |

### Thresholds

| Field | Type | Default | Description |
|---|---|---|---|
| `typingSpeedThreshold_cps` | number | `10` | Chars/sec above this counts as fast typing (used unless the participant's saved runtime `typingSpeedCps` is present) |
| `tabAwayMinDuration_ms` | number | `3000` | **Reserved — not consumed.** The live tab-away cutoff is the *library* threshold `thresholds.tabAwayDurationMs` (saved per participant), with this CLI value never read |
| `idleGapThreshold_ms` | number | `10000` | **Reserved — not consumed** by the current CLI |
| `suspiciouslyFastRT_ms` | number | `2000` | **Reserved — not consumed** by the current CLI |

### Scoring and signals

| Field | Type | Default | Description |
|---|---|---|---|
| `scoring` | object | `null` | The CLI reads only `scoring.softScoreThreshold`. The browser library's `scoring.soft` / `scoring.hard` rules have no effect on the report; since 0.9.0 the CLI warns when it sees them and points to `scoreWeights` |
| `scoreWeights` | object | `null` | Weights for the report's triage score, merged per key onto the defaults (added 0.9.0). See [Report-score weights](#report-score-weights-scoreweights) |
| `signals` | object | `null` | Per-signal enable/disable (overrides preset) |
| `phaseScope` | object | `null` | `{"include": [...]}` and/or `{"exclude": [...]}` — restrict which trial phases feed the summary/triage scores (added 0.6.1) |

See [`signals-reference.md`](signals-reference.md) for preset values and the full signal toggle list.

### Report-score weights (`scoreWeights`)

The report ranks participants within a tier by a triage score (see
[cli-reference.md → Triage scoring](cli-reference.md#triage-scoring)). By default
it is `5×paste + 5×copy + 3×sidebar + 1×tab-away`. `scoreWeights` changes that
formula. Write only the signals you want to change; every other signal keeps its
default. For example, to count one point per synthetic insertion:

```json
{ "scoreWeights": { "synthetic": 1 } }
```

Each entry is either a number (the weight) or `{ "weight": n, "max": m }`, where
`max` caps the signal's count per participant before it is weighted:

```json
{ "scoreWeights": { "copy": { "weight": 5, "max": 3 }, "paste": 0 } }
```

Setting a weight to `0` removes that term. **The hard/soft/clean tier is not
affected**: weights change the score and the order within a tier, never which
tier a participant is in (the tier comes from the browser library's screening
and `scoring.softScoreThreshold`).

| Key | Counts | Default weight |
|---|---|---|
| `paste` | paste events | 5 |
| `copy` | copy events | 5 |
| `sidebar` | sidebar events (open cycles) | 3 |
| `tabaway` | tab-aways longer than the participant's threshold (medium + long) | 1 |
| `tabawayLong` | tab-aways ≥ 10 s | 0 |
| `tabawayMedium` | tab-aways between the threshold and 10 s | 0 |
| `flicker` | tab-aways at or below the threshold | 0 |
| `drop` | drag-and-drop events | 0 |
| `fastTyping` | trials typed faster than the preset's cps threshold | 0 |
| `synthetic` | synthetic insertions (text without preceding keystrokes) | 0 |
| `foreignInput` | keystrokes outside the response field | 0 |
| `aiExtensions` | AI extensions detected | 0 |
| `kbShortcuts` | DevTools hotkeys | 0 |
| `viewportShifts` | viewport-width changes | 0 |
| `zoom` | browser zoom changes | 0 |
| `edgeExits` | mouse edge-exit patterns | 0 |

Notes:

- `tabaway` already counts the medium and long bins. To weight them separately,
  set `"tabaway": 0` and use `tabawayLong` / `tabawayMedium`; weighting both
  double counts, and the CLI warns.
- Keys are case-sensitive. An unknown key (for example `Synthetic` or `synthetc`)
  is ignored with a "did you mean" warning. `devTools` is ignored with a warning
  because that count is always 0; DevTools hotkeys are counted under `kbShortcuts`.
- Weights must be finite numbers ≥ 0. An invalid weight is warned about and the
  key keeps its default weight. `max` must be a whole number ≥ 0; an invalid
  `max` is warned about and dropped, keeping the weight. `"max": null` means no
  cap, so the `weights` object from a report's `score-weights.json` (not the
  whole file, which also holds `isDefault`) can be pasted in as `scoreWeights`
  to reproduce that report's scoring.
  Fields other than `weight` and `max` in the object form are warned about.
- Fractional weights are allowed; scores are then shown to one decimal in the
  report and `summary.csv`, while ranking uses the exact values.
- Every report writes the weights it used to `score-weights.json`, and the HTML
  top bar names any weights that differ from the defaults. `triage.md` states
  the applied formula.
- The signal legend and tile hints in the HTML report ("not scored") describe
  the default weights.

### Phase scoping (`phaseScope`)

Studies that pre-register integrity scoring over a subset of phases (e.g. counting
classification-phase signals only) can enforce that in the report:

```json
{ "phaseScope": { "include": ["classification"] } }
{ "phaseScope": { "exclude": ["gallery", "post_gallery_query", "end_requery"] } }
```

`include` (when non-empty) keeps only the listed phases; `exclude` then removes
its phases. A trial without a `phase` field counts as `"default"`, so data with
unlabeled trials should scope with `exclude`. When a scope is active:

- Per-trial signals (paste/copy/drop/tab-away/typing/soft score) count only
  inside the scope; hard and soft flags are re-derived from the scoped trials
  instead of the whole-session score.
- Ambient session signals with no phase attribution (sidebar events, keyboard
  shortcuts, viewport-width shifts, zoom changes) stay session-wide.
- Renderers still show the full session — only the scores are scoped.

### Visual renderers

| Field | Type | Default | Description |
|---|---|---|---|
| `trajectoryGrid` | string | `"auto"` | Per-participant grid layout: `"auto"`, `"3x5"`, `"4x4"`, etc. |
| `trajectoryTrialLabel` | string | `"trialId"` | Field used for per-panel titles |
| `trajectoryResponseField` | string | `null` | Optional response field shown in the panel |
| `trajectoryDisplayOrder` | string | `"rule"` | Panel order: `"rule"` = chronological by rule (rulePosition → phase → trialNumber), `"time"` = wall-clock timestamps, `"insertion"` = raw ingest order (pre-0.6.1 behavior) |

### Output

| Field | Type | Default | Description |
|---|---|---|---|
| `outputDir` | string | `"./cyborg-hunter-report"` | Where the report goes |
| `outputFormat` | string | `"html"` | Currently only `"html"` is supported |

## CLI flags

CLI flags override config-file values. Unknown flags now exit with an error rather than silently falling back to whatever config file happens to be in cwd (a footgun fixed in v0.3.0).

| Flag | Description |
|---|---|
| `--config <path>` / `--config-file <path>` | Use a specific config file (default: `./cyborg-hunter.config.json`) |
| `--data <path>` / `--data-dir <path>` | Override `dataDir` |
| `--output <path>` / `--output-dir <path>` | Override `outputDir` |
| `--participant-id-field <name>` | Override `participantIdField` (e.g. `subject_ID` for jsPsych data) |
| `--file-pattern <glob>` | Override `filePattern` |
| `--integrity-field <name>` | Override `integrityField` |
| `--session-integrity-path <path>` | Override `sessionIntegrityPath` (dotted, e.g. `payload.cyborgHunter`) |
| `--participant <id>` | Generate report for a single participant |
| `--no-visuals` | Skip image generation (no `canvas` package needed) |

## Examples

### Minimal

```json
{
  "dataDir": "./data",
  "filePattern": "*.json",
  "outputDir": "./report"
}
```

### Shape-2 (legacy JSON format)

```json
{
  "dataDir": "./pilot_data",
  "filePattern": "*.json",
  "participantIdField": "subjectId",
  "trialIdField": "ruleId",
  "conditionField": "groupId",
  "trialsPerParticipant": 15
}
```

### jsPsych CSV (most common)

```json
{
  "dataDir": "./jatos-results",
  "filePattern": "*.csv",
  "integrityField": "integrity",
  "participantIdField": "subject_ID"
}
```

## Browser library config

When using `CyborgHunter.init()` directly (not through the jsPsych extension), pass config inline:

```javascript
const monitor = CyborgHunter.init({
  participantId: 'P001',
  preset: 'standard',
  thresholds: { typingSpeedCps: 12 },                       // override one threshold
  scoring: { hard: { paste: { countThreshold: 3 } } },      // override scoring
  signals: { keystrokeDynamics: false }                     // turn one signal off
});
```

See [`signals-reference.md`](signals-reference.md) for the full signal toggle list and the per-preset scoring values.
