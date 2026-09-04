# cyborg-hunter bench

## Replay demo (for jsPsych)

This is the upstream jsPsych replay-test timeline (instructions, fullscreen,
keyboard / button / slider responses, canvas, sketchpad, free-sort,
survey-text), run under cyborg-hunter's session recorder. Playing it through
produces a SessionRecording v2 file — the format cyborg-hunter and jsPsych's
replay are converging on.

Run it from a fresh clone; no configuration of any kind is needed.

```
git clone https://github.com/cyborg-hunter/cyborg-hunter
cd cyborg-hunter
python3 -m http.server 8181
```

Then open <http://127.0.0.1:8181/bench/harness/index.html?demo=replay> and play
through to the end. Two downloads arrive when the timeline finishes: the jsPsych
data CSV, and `<runid>-replay-<epoch>.json` (the v2 recording).

Browsers: use Firefox or Safari, or allow automatic downloads for localhost in
Chrome — Chromium blocks the second automatic download from a page, so you get
the CSV and silently lose the recording.

Where the file plays:

- **jspsych/replay's player** — drop the JSON on it.
- **cyborg-hunter's triage report** — put both downloads in one directory and run

  ```
  node bin/cyborg-hunter.js report --data <dir> --file-pattern "*-ch.csv" \
    --participant-id-field integrity.participantId --output ./report
  ```

`?demo=replay` turns the guard extensions off, skips Roundtable, and drops the
microphone trial; the cyborg-hunter monitor and replay recorder stay on, since
they are the point.

## Roundtable comparison

Public pilot comparing Cyborg-Hunter (3-layer integrity stack) against Roundtable Proof-of-Human on a shared jsPsych harness.

The comparison needs a Roundtable site key in `bench/config.local.js` (copy `bench/config.example.js`); without it the harness runs cyborg-hunter only.

Status: v0.1 in progress.
