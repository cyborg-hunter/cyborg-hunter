# Advanced integration

This page covers what goes beyond the single `<script>` tag of the [quickstart](quickstart.md): wiring the jsPsych extension by hand (manual mode), moving an existing experiment to the one-line setup, double loads, the honeypot's ethics note, friction, pages without jsPsych, session replay, configuration, and the data format.

## Manual mode

In manual mode you load `cyborg-hunter.min.js` and `extension-cyborg-hunter.js` and wire the extension yourself. `finalize()` is still required. Experiments set up before the one-line setup existed work this way, and their data format is unchanged.

Three things to know before the step-by-step below:

- **ch.js can stand in for `cyborg-hunter.min.js`.** Load `ch.js` and then `extension-cyborg-hunter.js`, and list `jsPsychCyborgHunter` in `initJsPsych` as below. ch.js sees the extension, injects nothing (no monitoring extension, no guards) and writes nothing. The console says `manual mode: initJsPsych lists a cyborg-hunter extension, so ch.js injects nothing; finalize() is still required.` ch.js already defines `jsPsychGuardFriction` and `jsPsychGuardHoneypot`, so list those yourself if you want them, but do not load `extension-guard-friction.js` or `extension-guard-honeypot.js` next to ch.js ([Double load](#double-load)). This works only with a jsPsych that defines `window.initJsPsych` (the `jspsych.js` script); for a bundled or ES-module jsPsych, use `cyborg-hunter.min.js` instead of ch.js.
- **One jsPsych instance per page.** The one-line setup records one session per page and ends it when the first instance finishes. A second `initJsPsych()` gets a console warning, and trials that run after the first instance finishes are not monitored. For several instances on one page, use manual mode with `cyborg-hunter.min.js`.
- **Manual mode is detected by the extension's class, not its name.** It applies when `initJsPsych` lists the class from `extension-cyborg-hunter.js`. With that file removed, `jsPsychCyborgHunter` is ch.js's own class, and a leftover entry is treated as the one-line setup ([Switching to the one-liner](#switching-to-the-one-liner)).

### jsPsych integration

#### 1. Load the two scripts

In your experiment HTML, after jsPsych itself but before your own `script.js`:

```html
<script src="path/to/cyborg-hunter.min.js"></script>
<script src="path/to/extension-cyborg-hunter.js"></script>
```

Order matters — `extension-cyborg-hunter.js` references `window.CyborgHunter`, which the first file defines.

#### 2. Set the participant ID before `initJsPsych`

The wrapper reads `participantId` at extension `initialize()` time, which is BEFORE any trial runs. If you assign `subject.id` after `initJsPsych`, the extension will record an empty participant ID.

```javascript
let subject = {};
subject.id = jsPsych.randomization.randomID(10);  // or your own ID source

const jsPsych = initJsPsych({
  extensions: [
    { type: jsPsychCyborgHunter, params: {
        participantId: subject.id,
        preset: 'standard',
    }}
  ],
  ...
});
```

If you must use `jsPsych.randomization.randomID` (which only exists after `initJsPsych`), use `Math.random().toString(36).slice(2, 12)` instead, or assign a stand-in ID and overwrite later.

#### 3. Call `finalize()` before saving

This is the most common cause of "session data missing." jsPsych 7's extension API has no `on_finish_experiment` hook — the wrapper exposes `finalize()` instead, which you call manually from the experiment-level `on_finish` callback:

```javascript
const jsPsych = initJsPsych({
  ...
  on_finish: async function () {
    jsPsych.extensions['guard-friction'].finalize();   // the guards first, if you listed them
    jsPsych.extensions['guard-honeypot'].finalize();
    jsPsych.extensions['cyborg-hunter'].finalize();
    await jsPsych.extensions['cyborg-hunter-replay'].finalize();   // replay LAST, if you listed it
    jsPsych.data.get().localSave('csv', 'data.csv');
    // or: SaveData('your-experiment', subject.id, jsPsych.data.get().csv());
  }
});
```

The order matters: the guards' `finalize()` first, then `cyborg-hunter`'s, then the replay recorder's last. Replay's is async, so `await` it (the `on_finish` must be `async`); it folds the finalized cyborg-hunter report into the recording. Call only the ones whose extensions you listed.

`finalize()` attaches:

- Per-row scalars (paste count, copy count, soft score, etc.) — added via `addProperties`, so every trial row gets these columns.
- Session arrays and nested objects (`integritySession`, `integrityScore`) — added via `addDataToLastTrial`, so they appear once on the final row.

Forgetting `finalize()` means you'll lose all of the above, and the CLI will warn "No session-level integrity data."

**If you save with DataPipe (`jsPsychPipe`) — or any "save-as-a-trial" plugin — `on_finish` is too late.** The example above works because `localSave` is a *function call* inside the experiment-level `on_finish`, so `finalize()` runs first and the save sees its output. `jsPsychPipe` is different: it's a **trial** in your timeline, and its `data_string` callback snapshots `jsPsych.data` the moment that trial *starts* — which is *before* the experiment-level `on_finish` runs. So `finalize()` placed in `on_finish` never makes it into the saved data, even though it's in the right order and runs without error. The same applies to `jsPsychSavePavlovia` or any plugin whose `data_string`/`data` snapshots mid-timeline. (If you also use the replay extension, its `finalize()` is async and so cannot run inside a save trial's `data_string`; use the async `jsPsychCallFunction`-before-save pattern in [Saving the replay to your own server](using-cyborg-hunter.md#saving-the-replay-to-your-own-server).)

The rule: **whatever must land in saved data has to run before the save trial.** Two ways to do that —

```javascript
// Option A — finalize() inside the save trial's data_string, before the snapshot:
const save_data = {
  type: jsPsychPipe,
  action: 'save',
  experiment_id: EXPERIMENT_ID,
  filename: filename,
  data_string: () => {
    jsPsych.extensions['guard-friction'].finalize();   // if you use the guard layers,
    jsPsych.extensions['guard-honeypot'].finalize();   // finalize them first, then
    jsPsych.extensions['cyborg-hunter'].finalize();    // cyborg-hunter last
    return jsPsych.data.get().json();
  },
  on_success: () => window.location.replace(REDIRECT_URL)
};
timeline.push(save_data);
```

```javascript
// Option B — a bookkeeping trial pushed BEFORE the save trial:
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: getCompletionHTML(),
  choices: ['Finish'],
  on_finish: () => {
    jsPsych.extensions['guard-friction'].finalize();
    jsPsych.extensions['guard-honeypot'].finalize();
    jsPsych.extensions['cyborg-hunter'].finalize();
  }
  // no navigation here — let the save trial's on_success redirect
});
timeline.push(save_data);   // save runs after the bookkeeping trial's on_finish
```

Either way, the navigation away (e.g. `window.location.replace(REDIRECT_URL)`) must live in the save trial's `on_success`, not in a trial before it — if an earlier trial navigates, the save trial never runs.

#### 4. Opt trials in to monitoring

jsPsych extensions only fire for trials whose `extensions: [...]` array lists them. There are two ways to opt in:

**Recommended for most experiments — opt all trials in via a single forEach** (works even with 100+ trials):

```javascript
// After all timeline.push() calls, just before jsPsych.run:
timeline.forEach(t => {
  t.extensions = (t.extensions || []).concat([{ type: jsPsychCyborgHunter }]);
});

jsPsych.run(timeline);
```

**Per-trial opt-in** (when you want to monitor only some trials and pass per-trial parameters like `trialId`, `phase`, or `decoyAnswer`): give each of those trials its own entry, as in [using-cyborg-hunter.md → Per-trial parameters](using-cyborg-hunter.md#per-trial-parameters). The wrapper falls back to `trial-{index}` if you don't provide a `trialId`.

#### 5. Verify

Run the experiment locally (e.g. `python3 -m http.server 8080`), click through, save the CSV. Open it and confirm:

- Each trial row has columns `integrityPasteCount`, `integritySoftScore`, `cyborgHunterVersion`, etc.
- The last row has columns `integritySession` (a JSON object with arrays of events) and `integrityScore`.
- The `integrity` cell on each row contains a JSON object with `pasteEvents`, `mouseTrack`, `tabAwayEvents`, etc.

If `integritySession` is missing on the last row, `finalize()` either wasn't called or ran too late (see the DataPipe note in section 3).

### Standalone (non-jsPsych) usage

If your experiment isn't jsPsych, use the library directly:

```html
<script src="path/to/cyborg-hunter.min.js"></script>
<script>
  const monitor = CyborgHunter.init({
    participantId: 'P001',
    preset: 'standard'
  });

  // Session-scoped listeners (tab-away, sidebar, extension scan):
  monitor.startSession();

  // For each trial:
  monitor.startTrial({ trialId: 'rule-3' });
  // ... participant responds ...
  const trialReport = monitor.endTrial();
  // Save trialReport with your own data persistence layer.

  // At the end of the experiment:
  const sessionReport = monitor.getSessionReport();
  // Save sessionReport too — the CLI looks for it under metadata.integritySession
  // OR the last trial's integritySession field.

  monitor.destroy();
</script>
```

The library exports `window.CyborgHunter` for forward use; `window.IntegrityMonitor` is a backward-compatible alias.

## Switching to the one-liner

To move a manual-mode experiment to `ch.js`:

1. Delete the five `<script>` tags for the old files: `cyborg-hunter.min.js`, `extension-cyborg-hunter.js`, `extension-guard-friction.js`, `extension-guard-honeypot.js` and `cyborg-hunter-replay.js`.
2. Add the one tag below `jspsych.js` and above your experiment code:

   ```html
   <script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>
   ```

   For production studies pin an exact version (see [README § Install](../README.md#install)).
3. In `initJsPsych`, delete the `extensions:` entries for `jsPsychCyborgHunter`, `jsPsychGuardFriction`, `jsPsychGuardHoneypot` and `jsPsychCyborgHunterReplay`. The guards are `data-guards` on the tag; replay is `data-replay` ([Replay with the one-liner](#replay-with-the-one-liner)).
4. Delete the per-trial `forEach` that adds the extensions to every trial. ch.js walks the whole timeline itself, nested timelines included. A per-trial entry with params ([Per-trial parameters](using-cyborg-hunter.md#per-trial-parameters)) can stay: ch.js uses its params and adds no second entry.
5. Delete every `finalize()` call: in `on_finish`, in a save trial's `data_string`, in a bookkeeping trial.
6. Keep your own save code: `localSave`, DataPipe's `data_string`, your `fetch`. ch.js writes into the data that code already saves.
7. Move the participant ID and the preset to the tag (`data-participant-id`, `data-preset`), or let ch.js read the ID from the study URL ([quickstart § Participant ID](quickstart.md#participant-id)).
8. With friction, add `data-guards="honeypot,friction"` and keep the entry trial (`jsPsychGuardFriction.entryTrial()` and `CyborgHunter.frictionEntryTrial()` build the same trial; see [Friction](#friction)).
9. On a page without jsPsych ([Standalone usage](#standalone-non-jspsych-usage)), delete `CyborgHunter.init()` and every call on the monitor it returned (`monitor.startSession()`, `startTrial()`, `endTrial()`, `getSessionReport()`, `shouldScreenout()`, `destroy()`). Under ch.js, `init()` returns an inert object, so those calls record nothing and the saved reports come out empty. Its `shouldScreenout()` returns `false` for the whole session, so a study that screened participants out mid-session has to decide from the saved CH data and score instead. Mark trial boundaries with `CyborgHunter.mark('rule-3')` (or `data-ch-trial`) instead, and where you saved the trial and session reports, save `CyborgHunter.data()`: each of its rows carries that trial's report in `integrity` ([Vanilla segmentation reference](#vanilla-segmentation-reference)).

Delete the guard and replay `finalize()` calls without fail: `jsPsych.extensions['guard-friction']`, `['guard-honeypot']` and `['cyborg-hunter-replay']`. When that guard or replay is off, the extension does not exist on the page, the call throws a `TypeError`, and your save code after it never runs.

The other leftovers are harmless, and each one says so in the console:

- A `jsPsych.extensions['cyborg-hunter'].finalize()` call left in `on_finish` warns once (`finalize() is not needed with ch.js`) and does nothing. Your save code after it still runs.
- `participantId` or `preset` left in an `initJsPsych` entry's params warn once and are ignored. ch.js reads both from its tag.
- `CyborgHunter.init()` left from standalone code logs an error and returns a no-op object shaped like a monitor (`startSession`, `startTrial`, `endTrial`, `getSessionReport`, …), so the old code runs without throwing, but its calls record nothing (step 9). It does not start a second monitor. In manual mode it returns a real core monitor.
- If `extension-cyborg-hunter.js` is still loaded and listed in `initJsPsych`, ch.js detects manual mode and injects nothing (see [Manual mode](#manual-mode)). The console says so.

Your existing data still reads in the CLI. Files saved in manual mode are unchanged, and the one-line setup's rolling snapshot ([Data format](#data-format-the-rolling-snapshot)) is a fifth session-lookup convention next to the four the CLI already reads. A file that has both (a dumped `integritySession` and `integritySegment` rows, from a page that mixed the two setups) makes the CLI warn and use the dumped `integritySession`.

## Double load

`ch.js` contains the monitor and both guards, so it never shares a page with `cyborg-hunter.min.js` or the guard files. A page loads `ch.js` (plus `extension-cyborg-hunter.js` in [manual mode](#manual-mode)), or manual mode's files without `ch.js`. When both are on the page, the later one logs an error in the console:

```
[cyborg-hunter] Not starting a second monitor: cyborg-hunter.min.js was loaded after ch.js. Fix: load only one of ch.js and cyborg-hunter.min.js (the one-liner already contains the monitor). …#double-load
```

| The page loads | What happens | Remove |
|---|---|---|
| `ch.js`, then `cyborg-hunter.min.js` | One error. ch.js keeps monitoring, and `CyborgHunter` and `IntegrityMonitor` still point at ch.js's namespace. | the `cyborg-hunter.min.js` tag |
| `cyborg-hunter.min.js`, then `ch.js` | One error. ch.js stands down: nothing is monitored; `cyborg-hunter.min.js` keeps the namespace for your manual wiring. | the `ch.js` tag to stay in manual mode; the old tags and the manual wiring to switch ([Switching to the one-liner](#switching-to-the-one-liner)) |
| `ch.js`, then `extension-guard-friction.js` or `extension-guard-honeypot.js` | `Not redefining GuardFriction` / `Not redefining GuardHoneypot`; ch.js's copy stays. | the guard tags |
| `cyborg-hunter.min.js` twice | `cyborg-hunter.min.js is loaded twice`. | one of the two tags |
| `ch.js` twice, same version | Nothing is logged. The second run is treated as the host re-running the page header (Qualtrics does this on every page), and the first copy keeps monitoring. | one of the two tags, if the second was a mistake |
| `ch.js` twice, different versions | `ch.js was loaded after ch.js`; the first copy keeps monitoring. | one of the two tags |

## Honeypot: ethics and IRB note

Under the one-line setup the honeypot is **on by default**. (In manual mode it runs only when you list `jsPsychGuardHoneypot`.) It adds two things to every page:

- **Bait DOM that participants do not see**: two hidden form fields, `fg-ai-use` (a checkbox) and `fg-ai-report` (a text input), with instructions addressed to AI agents. The instructions tell an agent acting for the participant to tick the box and describe what it was asked to do, and not to mention the fields to the participant.
- **A visible bait question**: a 4×4 px, almost transparent button and text input fixed in a corner of the page, each labelled with an AI-assistance disclosure request ("click this button" / "type ai-agent into this field"). A browser-control agent that reads the page can act on them. A human practically never sees them.

Participants normally never notice either. The page still carries text written for AI agents and records whether one answered it, so mention it in your protocol and IRB application. For example: "The experiment page contains hidden fields and a near-invisible (4×4 px) disclosure control that detect AI agents acting on a participant's behalf; participants do not see them."

To turn it off, set `data-guards="none"` (no guards) or `data-guards="friction"` (friction only).

What it records:

- **jsPsych:** every row gets `ai_use` (true once an agent ticked the hidden box or used the visible bait) and `ai_report` (what an agent wrote), plus the per-trial guard violation columns. At the end of the session every row also gets `ai_use_session`, `ai_report_session`, `guard_assistance_violations_session` and `guard_assistance_violation_count_session`.
- **Pages without jsPsych:** the saved session object carries the `*_session` fields at its root, merged across pages.

The report surfaces them in `summary.csv` as `honeypot_ai_use` / `honeypot_ai_report`, with a "self-reported AI use" note in the triage reason.

## Friction

Friction is **off by default**. Enable it with `data-guards="honeypot,friction"` (list `honeypot` too, or the honeypot turns off). It enforces fullscreen, watches for sidebars and focus changes, scrambles the content behind a curtain during a violation, and adds AI refusal notices to the page.

Enforcement starts at a mark you place:

- **jsPsych:** push `CyborgHunter.frictionEntryTrial()` into the timeline where enforcement should begin. It is a button trial that asks the participant to enter fullscreen (the click is the user gesture fullscreen needs). It uses `jsPsychHtmlButtonResponse`, so load `plugin-html-button-response.js`. Pass `{ message: '<p>…</p>' }` to replace the default text.
- **Pages without jsPsych:** put `data-ch-friction-start` on a clickable element, or call `CyborgHunter.startFriction()` from a click handler.

Without a mark, friction observes only: it logs violations and shows no curtain.

To add your own data to the entry trial, spread its `data` instead of replacing it:

```javascript
var entry = CyborgHunter.frictionEntryTrial();
entry.data = Object.assign({}, entry.data, { name: 'fullscreen-entry' });
timeline.push(entry);
```

ch.js finds the entry trial by its `data.trial_type_label`. If you replace `data` wholesale and erase the label, friction starts observe-only when the experiment starts and logs a `not_fullscreen` violation for every participant before they reach the entry trial. The same applies to `jsPsychGuardFriction.entryTrial()`.

If the timeline has an entry trial (or the page has a friction start) but `data-guards` does not enable friction, the console warns that friction is only partly set up.

## Vanilla segmentation reference

On a page without jsPsych, ch.js cuts the session into segments at two kinds of boundary. Manual marks take precedence over page loads:

- **Boot.** The first segment, `span-0`, opens when the page loads. Unnamed segments are called `span-<index>`.
- **Manual marks.** A click on (or inside) an element with `data-ch-trial="q1"` closes the current segment as a `manual` one and opens the next, named `q1`. `CyborgHunter.mark('q1')` does the same from code; `CyborgHunter.mark()` opens an unnamed one. `CyborgHunter.startTrial({ trialId })` and `CyborgHunter.endTrial()` are aliases of `mark(trialId)` and `mark()`, so calls on the `CyborgHunter` namespace keep working. Calls on the monitor `CyborgHunter.init()` returned do not ([Switching to the one-liner](#switching-to-the-one-liner), step 9).
- **Page loads.** A `<form>` submit and `pagehide` close the current segment as a `page` one. A `method="dialog"` submit only closes its `<dialog>`, so it is not a page load. A submit into another window or a frame (`target="_blank"`, a named target) closes the segment and posts the data, but the page stays, so its `pagehide` closes the next one. So does a same-window submit after which the page stays (a 204 answer, a download, a `javascript:` action, a "leave this page?" prompt answered with Stay): what the participant does after it is closed as its own segment when they leave, or posted by the next submit.

`CyborgHunter.data()` closes the current segment and returns the whole session so far (every page), ready for `JSON.stringify`. Save it with your own code:

```javascript
fetch('/save', { method: 'POST', body: JSON.stringify(CyborgHunter.data()) });
```

**The hidden form field.** When a POST form is submitted, ch.js adds a hidden input named `cyborgHunterData` holding the same object as JSON. It covers a submit button, `form.requestSubmit()` (both fire the submit event) and `form.submit()` (ch.js wraps `HTMLFormElement.prototype.submit`). It does not cover `submit()` on a form inside another frame, or a reference to `submit` your code took before ch.js ran. The input is added at submit time, so a `FormData` your code builds from the form beforehand does not contain it: for a `fetch` save, send `CyborgHunter.data()`. GET forms get no field, because the value would land in the URL; ch.js logs a note and keeps the session for the next page. The method and target count as your own submit handler leaves them: a handler that switches a GET form to POST gets the field, one that switches a POST form to GET does not.

**Server limits.** The field can be several megabytes (the raw mouse trace takes most of it). Raise your server's form-body limit. Express's `express.urlencoded()` defaults to 100 kb, for example, so use `express.urlencoded({ extended: false, limit: '10mb' })`.

**Saving.** Each POST carries the whole session so far, so the last page's value is complete. Save it as `<participantId>.json` (a later page overwrites an earlier one), then point the CLI at those files with `"filePattern": "*.json"`. The participant ID sits at the object's root as `participantId`, the CLI's default `participantIdField`.

**Several pages.** The session is kept in `sessionStorage`, per browser tab, until the tab closes. A new tab starts a new session. Segment numbers continue from page to page, and the CLI moves each page's times onto the first page's clock. A random participant ID (when none was found) is kept per tab too, so later pages continue the same session.

**Size.** Browsers cap `sessionStorage` at about 5 MB per origin. Above 4 MB ch.js warns once. Set `CyborgHunterConfig = { collectForPostHoc: { rawMouseTrack: false } }` to drop the raw mouse trace; the derived mouse metrics stay. If storage fails, ch.js logs an error. The current page's form and `CyborgHunter.data()` still carry everything, and the next page's object records the gap in `cyborgHunterError`.

**`<head>` placement.** With ch.js in `<head>`, monitoring and the first segment start at `DOMContentLoaded`. A paste before then is not recorded, and a mark before then (a `data-ch-trial` click or `CyborgHunter.mark()`) writes nothing.

The saved object:

```json
{
  "participantId": "P001",
  "libraryVersion": "…",
  "cyborgHunterOneLiner": { "version": "…", "host": "vanilla", "pageCount": 2 },
  "trials": [
    {
      "trialId": "span-0",
      "integrity": { "pasteEvents": [], "…": "the trial report" },
      "integritySegment": { "segmentIndex": 0, "source": "page", "…": "see Data format" },
      "integrityPasteCount": 0,
      "integrityCopyCount": 0,
      "integrityDropCount": 0,
      "integritySoftScore": 0,
      "integrityAnyHardTriggered": false
    }
  ],
  "ai_use_session": false,
  "ai_report_session": ""
}
```

## Replay with the one-liner

Add `data-replay` to the tag to record a session replay (`data-replay="dom"` for the visual DOM tier; the default is the trace tier). ch.js does not bundle the recorder. It loads `cyborg-hunter-replay.js` only when `data-replay` is set, from the directory `ch.js` came from. `data-replay-src="…"` points it somewhere else.

- **Self-hosting:** copy `cyborg-hunter-replay.js` from `dist/` next to `ch.js`.
- **CDN URLs:** use the full path, `https://unpkg.com/cyborg-hunter/dist/ch.js`, never the bare package URL `https://unpkg.com/cyborg-hunter`. The bare URL serves `cyborg-hunter.min.js` (manual mode's file, not ch.js), and ch.js finds the replay file relative to its own URL.
- **Loading:** if the file fails to load (missing, network error, Content-Security-Policy) or has not arrived after 15 s, ch.js logs an error and the experiment runs on without replay. On jsPsych the first trial waits for it, up to that limit. Allow the file's URL in your page's `script-src`. A `nonce` on the ch.js tag is copied to the replay script.
- **Subresource Integrity:** an `integrity` attribute on the ch.js tag covers ch.js only, not the replay file ch.js loads later. To pin that file too, load it yourself with its own `<script src="…/cyborg-hunter-replay.js" integrity="…" crossorigin="anonymous">` above the ch.js tag. ch.js then uses it and fetches nothing.

**Saving the recording.** ch.js records but does not save. Call `CyborgHunter.replay()` in your save code. It stops the recorder and returns the recording (a SessionRecording v2 object); later calls return the same recording. With jsPsych and a save trial such as DataPipe's, call it inside the replay save trial's `data_string`:

```javascript
timeline.push({
  type: jsPsychPipe,
  action: 'save',
  experiment_id: EXPERIMENT_ID,
  filename: participantId + '-replay-' + Date.now() + '.json',   // your variable holding the ID ch.js records
  data_string: () => JSON.stringify(CyborgHunter.replay())
});
```

The recorder stops there, so the save trial itself is not in the recording. The file name follows the `<pid>-replay-<epoch>.json` convention the CLI matches ([Saving the replay to your own server](using-cyborg-hunter.md#saving-the-replay-to-your-own-server) has the naming rule and an upload example). At load, ch.js reminds you in the console to save `CyborgHunter.replay()`; with `data-debug` the reminder is part of the summary line instead.

**Recorder autoSave (jsPsych only).** `window.CyborgHunterConfig = { replay: { tier: 'dom', autoSave: { mode: 'datapipe', experimentId: 'ABC123' } } }` lets the recorder save itself to DataPipe when the session ends. ch.js waits up to 15 s for that save before your `on_finish` runs. On pages without jsPsych, `autoSave` is ignored with a warning: save `CyborgHunter.replay()` yourself.

**Segment names.** On jsPsych the recording's trials are labelled `trial-<n>` (jsPsych's trial index), the name an integrity segment also gets by default. They differ when you set `trialId` in a trial's params: the integrity segment takes it, while the recording keeps `trial-<n>`, because ch.js does not pass `trialId` to the recorder. The CLI does not join the two by name. A synchronous trial (`jsPsychCallFunction` without `async`) finishes before jsPsych loads it, so its integrity segment keeps the name of the span it ran in (`gap-<n>`, after the trial before it; `span-0` if it is the first trial) unless you set `trialId`; a `trialId` or `phase` you set is carried on its row. On pages without jsPsych the recorder's trials follow the integrity segments (`span-<n>` and your marks).

**One recording per page (no jsPsych).** The recorder starts when the page loads and stops at `pagehide`. Call `CyborgHunter.replay()` and save what it returns before the participant leaves each page, for example in your submit handler. Otherwise that page's replay is lost. If the participant comes back with Back and the browser restores the page from its back/forward cache, recording goes on in the same recording, from a keyframe segment whose `extensions["cyborg-hunter"].restored_from` is `"bfcache"`; if `CyborgHunter.replay()` had already been called on that page, it returns a new recording of the restored visit instead.

## Configuration beyond data-*

The tag attributes ([quickstart § Configuration](quickstart.md#configuration)) cover the common settings. Everything else goes in `window.CyborgHunterConfig`, set in a script above the ch.js tag (ch.js reads it once, when it loads):

```html
<script>
  window.CyborgHunterConfig = {
    preset: 'strict',
    collectForPostHoc: { rawMouseTrack: false },
    replay: { tier: 'dom', autoSave: { mode: 'datapipe', experimentId: 'ABC123' } }
  };
</script>
<script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>
```

For production studies pin an exact version (see [README § Install](../README.md#install)).

- Every option `CyborgHunter.init()` takes in manual mode (`collectForPostHoc`, …) is passed to ch.js's monitor as is, and a misspelled key gets the monitor's own warning. `participantId` and `preset` follow the quickstart's rules: a URL parameter or `data-participant-id` wins over `participantId` ([Participant ID](quickstart.md#participant-id)), and an unknown preset falls back to `standard`.
- The one-line setup's own keys: `guards` (`'honeypot,friction'` or an array), `replay` (`true`, `'trace'`, `'dom'`, or `{ tier, autoSave }`), `replaySrc`, `debug`.
- A tag attribute wins over the same key here.
- Two keys are ignored with a warning, because the one-line setup monitors every trial: `autoMonitor` and `excludeTrialTypes`.

In manual mode these four keys go in the `jsPsychCyborgHunter` entry in `initJsPsych` (once, for all trials):

| Param | Type | Purpose |
|---|---|---|
| `participantId` | string | Tagged onto every trial report. |
| `preset` | `'permissive' \| 'standard' \| 'strict'` | Threshold preset. See `docs/signals-reference.md`. |
| `excludeTrialTypes` | string[] | Plugin type names to skip (e.g. `['html-keyboard-response', 'instructions']`). |
| `autoMonitor` | boolean | Default `true`. Set `false` to require an explicit `trialId` per-trial as the opt-in signal. |

## Data format: the rolling snapshot

Manual mode writes the session once, at `finalize()`. The one-line setup writes it a piece at a time instead, so whatever your experiment saves already carries the session up to that point.

On jsPsych, each trial's row gets:

- `integrity`: the trial report, as in manual mode.
- `integritySegment`: what happened since the previous row:
  - `segmentIndex` (0, 1, 2, …), `source` (`host` for a jsPsych trial, `manual` for a mark, `page` for a page load, `final` for the end of the session), `trialId`, `pageOrigin` (the page's `performance.timeOrigin`);
  - `deltas`: for every array in the session report, the entries added since the last segment;
  - `counters`: `pasteCount`, `copyCount` and `dropCount` so far;
  - `score`: the session score at that moment (`hardScore`, `softScore`, `softScoreThreshold`, `anyHardTriggered`, `trialsCompleted`);
  - `gap`: paste, copy, drop or synthetic-insertion evidence from between two trials, when there was any;
  - the first segment only: `config` and `libraryVersion`.
- `integrityPasteCount`, `integrityCopyCount`, `integrityDropCount`, `integritySoftScore`, `integrityAnyHardTriggered`: running totals up to this row. Manual mode writes the same names with the end-of-session totals on every row.
- `participantId` and `cyborgHunterVersion`.

When the session ends (in `initJsPsych`'s `on_finish`, before yours), the last row gets `integritySegmentFinal`: the segment after the last trial. Every row gets the end-of-session totals under separate names, so no per-row value is overwritten: `integrityPasteCountFinal`, `integrityCopyCountFinal`, `integrityDropCountFinal`, `integritySoftScoreFinal`, `integrityAnyHardTriggeredFinal`. Pages without jsPsych carry the same segment objects on the rows of their saved object ([Vanilla segmentation reference](#vanilla-segmentation-reference)).

The CLI joins the segments in `segmentIndex` order into the session report `finalize()` would have written and takes the score from the last segment. On several pages, where each page load runs its own monitor, it sums the pages instead: the counters and the hard-signal counts (and `softScore`, `trialsCompleted`) are added up over each page's last segment. There are no `integritySession` / `integrityScore` cells under the one-line setup.

**The whole page, not only the trials.** ch.js monitors the whole page, so events before the first trial and between trials count toward the counters and the soft score: a paste before the first trial raises `pasteCount`, and a tab-away between two trials can raise `softScore`. Manual mode counted only events inside trials, so the same behaviour can score higher under ch.js. `trialsCompleted` counts spans, not jsPsych trials: about 2N+1 for N trials (the span before the first trial, each trial, and the span after each).

**Loss bound.** Only events after the last saved boundary can be lost. A save-as-a-trial plugin such as DataPipe snapshots the data when the save trial starts, so the saved file has every earlier row with its segment. The save trial's own row and `integritySegmentFinal` come later and are missing from that file, and the CLI reads it without them. On a page without jsPsych, the same holds for anything after the last form submit or `CyborgHunter.data()` call.

**`cyborgHunterError`.** When ch.js hits a failure it logs an error in the console and writes a short `cyborgHunterError` message onto the affected row (jsPsych) or into the saved object (no jsPsych). The data before the failure is intact, and the CLI warns that the participant's data may be incomplete after that point.
