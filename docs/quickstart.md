# Quickstart

From zero to a triage report, for a jsPsych 7 experiment.

**Not using jsPsych?** The same tag works on any page. Mark trials with `data-ch-trial="q1"` on a clickable element or with `CyborgHunter.mark('q1')`, and save `CyborgHunter.data()` with your own save code (a POST form gets it automatically, as a hidden `cyborgHunterData` field). The details are in [advanced-integration.md → Vanilla segmentation reference](advanced-integration.md#vanilla-segmentation-reference). Steps 1 and 4–6 apply unchanged.

**You need:** a jsPsych 7 experiment, Node.js ≥ 18 on the machine where you'll analyze data, and a way to save each participant's data to a file (CSV or JSON). You almost certainly have all three already.

## 1. Install the CLI

```bash
npm install -g cyborg-hunter
cyborg-hunter --version
```

The CLI runs on your machine after data collection. Nothing about it touches the participant's browser.

## 2. Add one script tag

In your experiment HTML, put one tag below `jspsych.js` (and its plugins) and above your own experiment code:

```html
<script src="jspsych/jspsych.js"></script>
<script src="jspsych/plugin-html-button-response.js"></script>
<script src="https://unpkg.com/cyborg-hunter@0.11.0/dist/ch.js"></script>
<script src="experiment.js"></script>
```

For production studies pin an exact version (see [README § Install](../README.md#install)). You can also copy `dist/ch.js` into your project and serve it yourself.

On Qualtrics: see [qualtrics.md](qualtrics.md).

That is the whole integration. ch.js monitors every trial, nested timelines included, records each trial as its own segment, turns the honeypot on, and writes the integrity data into the rows your experiment already saves (`localSave`, DataPipe, your own server). You don't add an extension list, a per-trial loop or a `finalize()` call. It monitors the whole page, the trials and the time between them ([what that means for the scores](advanced-integration.md#data-format-the-rolling-snapshot)). The honeypot adds hidden bait to the page: read the [ethics and IRB note](advanced-integration.md#honeypot-ethics-and-irb-note) before launching. Already wiring the jsPsych extension by hand? See [Switching to the one-liner](advanced-integration.md#switching-to-the-one-liner).

### Which file

`ch.js` is the one-line file for jsPsych 7 experiments and for pages without a framework. Each one-line file is built from the same source, with the same API and the same `data-*` attributes, and carries the code for its own framework only; the table lists the files this version ships.

| File | Use it for |
|---|---|
| `ch.js` | jsPsych 7 experiments, and pages without a framework |
| `ch-qualtrics.js` | Qualtrics surveys, in the survey's header ([Qualtrics](qualtrics.md)), and pages without a framework |

### Placement

ch.js has to wrap `initJsPsych` before your code calls it, so the tag goes after `jspsych.js` and before the code that calls `initJsPsych`, in `<head>` or `<body>`. A misplaced tag logs one of two console errors:

| Console error | Cause | Fix |
|---|---|---|
| `Not monitoring jsPsych trials: ch.js was loaded before jspsych.js` | the tag is above `jspsych.js` | move it below `jspsych.js` and above your experiment code |
| `Not monitoring jsPsych trials: ch.js loaded after initJsPsych() ran, or the page calls jsPsychModule.initJsPsych / new JsPsych directly` | the tag is below your experiment code, or jsPsych is bundled (npm, ES modules) and never goes through `window.initJsPsych`; for a bundled build the error appears when jsPsych starts | move the tag above your experiment code; a bundled build cannot be hooked, so use [manual mode](advanced-integration.md#manual-mode) with `cyborg-hunter.min.js` |

After either error ch.js runs as it would on a page without jsPsych. It still records the session, but writes nothing into the jsPsych data.

### Participant ID

ch.js takes the participant ID from the first of these it finds:

1. a URL parameter: `PROLIFIC_PID`, then `workerId` (MTurk), then `participant`. Recruitment platforms append these to your study URL;
2. `data-participant-id="…"` on the ch.js tag;
3. `window.CyborgHunterConfig.participantId`, set in a script above the tag;
4. otherwise a random `ch-` + 12 hex characters, with a console warning: rows saved under it cannot be linked to the platform's records. The random ID is kept for the browser tab, so later pages of a multi-page study continue with it.

One participant per tab: do not hard-code one ID for several participants (a session in the same tab with the same ID continues the previous one).

On jsPsych, ch.js adds the ID to every row as `participantId`. If your study passes the ID under another URL parameter, hand it over yourself:

```html
<script>
  window.CyborgHunterConfig = { participantId: new URLSearchParams(location.search).get('PID') };
</script>
<script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>
```

### Configuration

Attributes on the ch.js tag:

| Attribute | Values | Default |
|---|---|---|
| `data-preset` | `permissive`, `standard`, `strict` ([thresholds](signals-reference.md)) | `standard`; an unknown value warns and falls back to it |
| `data-guards` | comma list of `honeypot`, `friction`; or `none` | `honeypot` |
| `data-participant-id` | the participant's ID | see [Participant ID](#participant-id) |
| `data-replay` | present (trace tier) or `dom` | off; see [Replay with the one-liner](advanced-integration.md#replay-with-the-one-liner) |
| `data-replay-src` | URL of `cyborg-hunter-replay.js` | next to `ch.js` |
| `data-debug` | present | off; see step 3 |

Friction needs a start mark as well as `data-guards="honeypot,friction"` ([Friction](advanced-integration.md#friction)). Anything else, such as monitor options or the replay recorder's DataPipe save, goes in `window.CyborgHunterConfig` ([Configuration beyond data-*](advanced-integration.md#configuration-beyond-data-)).

## 3. Smoke-test with `data-debug`

While piloting, add `data-debug` to the tag:

```html
<script src="https://unpkg.com/cyborg-hunter/dist/ch.js" data-debug></script>
```

A small badge in the bottom-left corner and one console line confirm that ch.js is running and what it found:

```
Cyborg Hunter active · jsPsych detected · 14 trials instrumented · ID from data-participant-id · honeypot on · friction off
```

The badge counts trials as they are written (`3/14 trials`). `ID from random id (not linkable)` means no participant ID was found ([Participant ID](#participant-id)).

Run the experiment locally, click through it, save the file:

```bash
python3 -m http.server 8080     # then open http://localhost:8080
```

Open the saved CSV and check three things:

1. Every trial row has an `integritySegment` cell holding a JSON object, and `participantId`, `integrityPasteCount` and `integritySoftScore` columns.
2. The **last** row has a non-empty `integritySegmentFinal` cell. If you save with DataPipe or another save-as-a-trial plugin, it is missing from that file: the save trial runs before the session ends. That is expected, and the CLI reads the file without it.
3. There is no `cyborgHunterError` column. If there is one, the console says what went wrong.

While testing, paste something into a response box and switch tabs for a few seconds. You'll see those events in the report in step 5, which tells you the wiring works end to end.

**Remove `data-debug` before launch.** Participants can see the badge.

## 4. Collect data

Run your study as usual. Put every participant's saved file in one directory, e.g. `./data/`.

## 5. Generate the report

```bash
cd <your-study-dir>
cyborg-hunter init          # writes a starter cyborg-hunter.config.json
```

Edit the config to match your data. For jsPsych CSV output the usual working config is:

```json
{
  "dataDir": "./data",
  "filePattern": "*.csv",
  "participantIdField": "participantId",
  "outputDir": "./cyborg-hunter-report"
}
```

`participantIdField` is the column holding your participant ID. ch.js writes it as `participantId` on every row, which is also the CLI's default. If you match files on an ID column of your own (`subject_ID` in many jsPsych setups), use that name instead. Then:

```bash
cyborg-hunter report
open cyborg-hunter-report/index.html
```

The console prints hard/soft/clean counts and any ingest warnings. Take warnings seriously on the first run; the common ones are a wrong `participantIdField` or, in manual mode, a missing `finalize()`.

If image rendering complains about the optional `canvas` package, add `--no-visuals` to get the text outputs (`summary.csv`, `triage.md`, `event-log.csv`) without plots, or install Cairo per the printed hints.

## 6. Read the report

Start with `triage.md`: participants ranked tier-first (HARD, then soft, then clean), each with a one-line reason. Review hard-flagged participants first, and read what they pasted in `event-log.csv` before deciding anything. The tool produces evidence, not verdicts.

Two pages take you the rest of the way:

- [worked-example.md](worked-example.md) — a full run on a bundled synthetic dataset, with the outputs interpreted line by line.
- [interpreting-signals.md](interpreting-signals.md) — what the scores and tiers mean, and the three most common misreadings.

## Where to go deeper

| Topic | Page |
|---|---|
| Per-trial params, session replay, common pitfalls | [using-cyborg-hunter.md](using-cyborg-hunter.md) |
| Manual mode, migration, honeypot/IRB note, friction, replay with the one-liner | [advanced-integration.md](advanced-integration.md) |
| Every signal, every threshold, per preset | [signals-reference.md](signals-reference.md) |
| Every config field and CLI flag | [configuration.md](configuration.md) |
| Output file formats | [cli-reference.md](cli-reference.md) |
| Deterrence add-ons (guard-friction, guard-honeypot) | [advanced-integration.md](advanced-integration.md#friction) and [signals-reference.md](signals-reference.md) |
