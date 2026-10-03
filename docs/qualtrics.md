# Qualtrics

`ch.js`, the one-line setup, runs in a Qualtrics survey from the survey's
Look & Feel header. At every page submit it writes a summary of the session
(scores, counts and event timings, never text the participant typed) into one
embedded-data field. The CLI and the [browser analyzer](https://cyborg-hunter.github.io/cyborg-hunter/analyze/)
read the Qualtrics CSV export directly, one participant per response.

Some details below depend on how Qualtrics behaves on a live survey and are
written as conditions ("if …"). They are being checked on a licensed account.

## Requirements

- **A Qualtrics licence with custom JavaScript.** Free and trial accounts
  strip `<script>` from the Look & Feel header when you save it, and offer no
  question JavaScript. On an institutional licence the brand administrator
  must allow JavaScript.
- **The New Survey Taking Experience**, the default layout. The older layout
  works for counts and scores with a different field name: see
  [Legacy layout](#legacy-layout).

## Setup

1. **Paste the tag into the header.** Look & Feel → General → Header, switch
   the editor to its source view, paste, and save:

   ```html
   <script src="https://unpkg.com/cyborg-hunter/dist/ch.js" data-participant-id="${e://Field/ResponseID}" data-debug></script>
   ```

   Open the header source again after saving: if the tag is gone, the
   licence strips scripts (see [Requirements](#requirements)). For a launched
   study, pin an exact version (see [README § Install](../README.md#install)).
   The tag takes the same attributes as on any page
   ([Configuration](quickstart.md#configuration)). The honeypot is on by
   default and adds hidden bait to every survey page: read the
   [ethics and IRB note](advanced-integration.md#honeypot-ethics-and-irb-note),
   or turn it off with `data-guards="none"`.
2. **Declare the field** `__js_cyborg_hunter` at the top of Survey Flow
   ([Declare the field](#declare-the-field)).
3. **Add the final-page line** (recommended): one line of question
   JavaScript on the survey's last page ([The final page](#the-final-page)).
4. **Smoke-test in Preview**, then remove `data-debug` before launch
   ([Smoke test](#smoke-test)).

## Declare the field

Qualtrics drops values written to an embedded-data field that Survey Flow
does not declare, without an error. In Survey Flow, choose Add a New Element
Here → Embedded Data, type the field name exactly `__js_cyborg_hunter`, leave
its value as "Value will be set from Panel or URL", move the element to the
top of the flow, and save the flow.

`ch.js` writes with `Qualtrics.SurveyEngine.setJSEmbeddedData('cyborg_hunter', …)`;
the New Survey Taking Experience stores that value in the field
`__js_cyborg_hunter`, and the export has a column of that name. Under the
legacy layout the field is `cyborg_hunter` instead
([Legacy layout](#legacy-layout)).

After writing, `ch.js` reads the field back (once per page). If Qualtrics
returns nothing, `ch.js` logs "The Qualtrics field
__js_cyborg_hunter is not declared" and the `data-debug` badge shows
`NOT DECLARED`. `unknown` means the read-back gave no answer either way.
Whether Qualtrics' read-back tells an undeclared field apart is being checked
on a live survey, so the export (step 3 of the [smoke test](#smoke-test)) is
the check that counts.

## Participant ID

The tag above sets the participant ID to the response's own ID through
Qualtrics piped text, `${e://Field/ResponseID}` (an `R_…` ID). Every response
gets a new ID, so each payload links to its row and a retake in the same tab
starts a new session. Qualtrics fills piped text into the header before the
browser runs the tag; this is being checked on a live survey.

`ch.js` takes the first ID it finds, in this order (the same order as on
[any page](quickstart.md#participant-id)):

1. a recruitment platform's parameter in the survey's address:
   `PROLIFIC_PID`, then `workerId`, then `participant`. If Prolific appends
   `PROLIFIC_PID` to your survey link and it is still in the address when
   the header first runs, this wins over the tag's attribute;
2. `data-participant-id` on the tag;
3. `window.CyborgHunterConfig.participantId`, from a script above the tag;
4. a random `ch-…` ID, with a console warning.

To use the recruitment platform's ID explicitly, declare `PROLIFIC_PID` in
Survey Flow (Embedded Data, "Value will be set from Panel or URL") and pipe
it: `data-participant-id="${e://Field/PROLIFIC_PID}"`. With such an ID a retake
in the same tab continues the first response's session
([Sessions and surveys in one tab](#sessions-and-surveys-in-one-tab)).

If Qualtrics does not fill piped text inside the attribute, the same pipe in
a script above the tag is the other form:

```html
<script>window.CyborgHunterConfig = { participantId: "${e://Field/ResponseID}" };</script>
<script src="https://unpkg.com/cyborg-hunter/dist/ch.js" data-debug></script>
```

`ch.js` does not recognise an unfilled pipe: if Qualtrics leaves
`${e://Field/ResponseID}` as it is, every response carries that literal text
as its ID. The smoke test checks for this.

In the export, the CLI records each row's `ResponseId` as
`metadata.qualtricsResponseId`, whatever ID the payload carries. When the
payload has no linkable ID (none, or a random `ch-…` one), the CLI uses the
row's `ResponseId` as the participant ID and warns: "participantId taken from
the ResponseId column". A payload with a linkable ID keeps it.

## The final page

`ch.js` writes each page from a page-submit callback
(`Qualtrics.SurveyEngine.addOnPageSubmit`) registered from the header.
Qualtrics shows the next page at once and runs the header script again a
moment later, which registers the callback for that page. If Qualtrics drops
the earlier page's callbacks and the participant presses Next before the
header has run again, nothing writes that page at its submit. On a middle
page `ch.js` notices at the next header run, writes the missed page then (the
next submit carries it), and notes the gap. After the final page no header
run follows, so its activity would be lost.

This line, in the JavaScript of any question on the final page (the
question's JavaScript editor), covers that case:

```js
Qualtrics.SurveyEngine.addOnPageSubmit(function () { try { if (window.CyborgHunter) CyborgHunter.data(); } catch (e) {} });
```

The question's script is in place as soon as the page renders. When ch.js's
own callback also runs at that submit, the two share one write, so the line
never adds a row. The line never throws: if `ch.js` did not load (a network
failure, a blocker), it does nothing, so it cannot stop the participant's
submit. Keep it in this form. We recommend it for every survey. Whether a survey without
it can lose its final page depends on whether Qualtrics drops page-submit
callbacks between pages and enables Next before the header has run again; if
the live check finds that it does, the line is required.

## Smoke test

1. **Preview** the survey. A badge in the bottom-left corner and one console
   line confirm that `ch.js` runs:

   ```
   Cyborg Hunter active · Qualtrics detected · page 1 · field __js_cyborg_hunter unknown · ID from data-participant-id · honeypot on · friction off
   ```

   No badge: `ch.js` did not run ([Troubleshooting](#troubleshooting)).
2. **Paste into a text box, switch tabs for a few seconds, press Next.** On
   the second page the badge reads
   `… page 2 · field __js_cyborg_hunter declared · … · header re-run ×1 · last write N/12000 chars`.
   `NOT DECLARED`: [declare the field](#declare-the-field). `last write`
   gives the payload's size and the cap, both in UTF-8 bytes.
3. **Finish the preview response and export it** ([Reading the data](#reading-the-data)).
   The `__js_cyborg_hunter` column holds a JSON object, its `participantId`
   is the response's `R_…` ID (not the text `${e://Field/ResponseID}`), and
   the report shows the paste and the tab switch.

**Remove `data-debug` before launch.** Participants can see the badge.

## Payload size

The payload `ch.js` writes to Qualtrics is a summary of the session: scores,
counters, one row per survey page with that page's counts and mouse metrics,
and events as times, durations and lengths (pastes, copies, drops, tab
switches, idle gaps, keyboard shortcuts, sidebar and developer-tools
openings). It never contains text the participant typed or pasted (a paste
is kept as its length), the honeypot's free-text answer (only its length),
mouse or element traces, keystroke timings, or window positions.

Qualtrics refuses a page submit whose embedded data is too long: the
participant sees "Something went wrong" and cannot continue. In tests a
submit with about 20,000 characters of embedded data was stored and one with
25,000 was refused, and the limit is shared with the survey's own embedded
data. So `ch.js` caps its payload at 12,000 UTF-8 bytes (a safe bound whether
Qualtrics counts characters or bytes) and never writes a longer string.

When the summary is over the cap, `ch.js` writes the first level of this
ladder that fits. The levels are cumulative:

| Level | What is dropped |
|---|---|
| 0 | nothing: the full summary |
| 1 | the session's event lists keep their newest 25 entries each |
| 2 | every page row but the newest loses its event lists (its counts stay) |
| 3 | only the newest 5 page rows are kept |
| 4 | only the newest page row, with the required fields |
| 5 | everything but the participant ID: only when the session could not be read, or for a cap far below the default |

Session totals, scores and hard triggers come from the monitor's counters,
which the newest row carries, so they stay exact at levels 0 to 4. The
payload's `cyborgHunterOneLiner.truncated` is `false` at level 0; otherwise
it names the level and what was dropped. The browser console shows "The
Qualtrics payload was reduced" (once per page), and the CLI notes it for that
participant: "Qualtrics payload was reduced to fit the embedded-data cap".

A page without events adds about 1.3 KB, so at the default cap a quiet survey
of more than about eight pages (fewer with many events) is written at level
3: totals and scores stay exact, and per-page detail is kept for the newest
five pages.

If the payload cannot be built or fails its check, `ch.js` writes a short
error record in its place (the participant ID and
`cyborgHunterError: "the Qualtrics payload could not be written (…)"`), logs
"Cyborg Hunter could not write to Qualtrics embedded data", and the survey
goes on.

## Sessions and surveys in one tab

`ch.js` keeps the session in the browser tab's `sessionStorage`, so a reload
of the survey would continue the same session instead of starting over.
Every survey on your Qualtrics domain shares that storage. Under the New
Survey Taking Experience `ch.js` therefore keeps one session per survey,
named by the survey ID in the page address (`/jfe/form/SV_…`, or
`/jfe/preview/…/SV_…` in preview). A second survey opened in the same tab
starts a session of its own, even under the same participant ID.

If your survey's address does not show its ID (for example a custom link that
does not redirect), add `data-qualtrics-survey-id="${e://Field/SurveyID}"` to
the `ch.js` tag. Without an ID, every survey in the tab would share one
session, and the `data-debug` summary says so. The legacy layout does not keep
a session per survey yet.

One case stays shared: the same participant ID taking the same survey again
in the same tab (a retake) would continue the first response's session. With
the participant ID set to the response's own ID (`${e://Field/ResponseID}`)
this cannot happen, because every response has a different ID; with an ID
from a recruitment platform it can.

For the same reason, `cyborgHunterOneLiner.pageCount` in the payload counts
page loads, not survey pages. Under the New Survey Taking Experience a whole
response is one page load, so `pageCount` is 1 plus the number of reloads.

## Reading the data

In Qualtrics, export the responses as CSV (Data & Analysis → Export & Import
→ Export Data → CSV). Put the file in a directory of its own and point the
CLI at it. The default `filePattern` is `*.json`, so set it:

```json
{
  "dataDir": "./qualtrics-export",
  "filePattern": "*.csv",
  "participantIdField": "participantId",
  "outputDir": "./cyborg-hunter-report"
}
```

```bash
cyborg-hunter report
```

The CLI recognises a Qualtrics export by its header row (`ResponseId` and
`__js_cyborg_hunter`, or `cyborg_hunter`) and reads one participant per
response. It reports responses with an empty cell in one warning, and a cell
that is not JSON under its response. The
[browser analyzer](https://cyborg-hunter.github.io/cyborg-hunter/analyze/)
accepts the same file. If the column has another name in your file, set
`qualtricsField` ([configuration.md](configuration.md)).

## Replay

A session recording (`data-replay`) is far larger than an embedded-data field
can hold, so `ch.js` never writes it to Qualtrics. To keep recordings, save
what `CyborgHunter.replay()` returns to your own server from the survey's
final page. This needs a server of your own that accepts the upload (and
answers cross-origin requests from your Qualtrics domain). The script below
is tested in a simulated survey, not on Qualtrics itself.

Add it to the JavaScript of a question on the final page, and change
`UPLOAD_URL` to your server's address:

```js
Qualtrics.SurveyEngine.addOnload(function () {
  var UPLOAD_URL = '/upload';   // your server's address
  var question = this;
  var shown = false;
  function showNext() {
    if (shown) return;
    shown = true;
    try { question.showNextButton(); } catch (e) {}
  }
  try {
    var recording = window.CyborgHunter ? window.CyborgHunter.replay() : null;
    if (!recording) return;
    question.hideNextButton();
    setTimeout(showNext, 10000);
    fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: recording.participant_id, data: recording })
    }).then(showNext, showNext);
  } catch (e) {
    showNext();
  }
});
```

When the final page loads, the script hides Next, stops the recorder and
posts the recording. It shows Next again when the upload has finished,
failed, or taken longer than ten seconds, so a slow server never keeps the
participant on the page. Without `ch.js` it never hides Next, and if
anything in it fails, it shows Next again at once and throws nothing into
Qualtrics. It does not press Next: the participant's own Next submits the
page, and that submit writes the last Cyborg Hunter payload.
`CyborgHunter.replay()` stops the recorder, so the recording ends when the
final page loads; put the script on a closing page with little to do. It can
share the question's JavaScript with the [final-page line](#the-final-page).

## Legacy layout

With the New Survey Taking Experience switched off, every survey page is a
full page load. `ch.js` carries the session from page to page in the tab's
`sessionStorage`, as on any page without jsPsych, and writes with
`setEmbeddedData` to the field `cyborg_hunter`: declare `cyborg_hunter` (not
`__js_cyborg_hunter`) in Survey Flow. On every page load `ch.js` logs
"Qualtrics legacy layout detected", naming that field. Counts, scores and
hard triggers are kept, and `pageCount` counts page loads, which here are the
survey's pages (plus any reloads). This layout is
tested in a simulated survey, not on a live one.

Two differences from the default layout: the session is not kept per survey
(two surveys on your Qualtrics domain in the same tab, under the same
participant ID, continue one session), and the CLI reads the
`cyborg_hunter` column.

## Troubleshooting

| What you see | Cause | What to do |
|---|---|---|
| No badge in Preview with `data-debug` | `ch.js` did not run: the licence strips scripts, the tag was not saved, or the script could not load | Check the saved header source ([Requirements](#requirements)) and the browser console |
| Badge: `NOT DECLARED`; console: "The Qualtrics field … is not declared" | The field is missing from Survey Flow | [Declare the field](#declare-the-field) |
| CLI: "N of M responses carry no Cyborg Hunter data" | Those responses have an empty payload cell: `ch.js` never ran on them (licence without custom JavaScript, header script removed, preview before the tag was added), or the field was not declared | Check the header and Survey Flow; responses collected before the fix have no data |
| CLI: "participantId taken from the ResponseId column" | The payload had no linkable participant ID | Set `data-participant-id` to piped text ([Participant ID](#participant-id)) |
| Every response has the participant ID `${e://Field/ResponseID}` | Qualtrics did not fill the pipe | Use the script form in [Participant ID](#participant-id); `metadata.qualtricsResponseId` still links each row |
| Console: "The Qualtrics payload was reduced"; CLI: "Qualtrics payload was reduced" | The summary was over the cap | Nothing to fix ([Payload size](#payload-size)) |
| Console: "Cyborg Hunter could not write to Qualtrics embedded data" | The setter failed, or the payload could not be built within the cap; an error record was written in its place | [Open an issue](https://github.com/cyborg-hunter/cyborg-hunter/issues) with the console message and your `<script>` tag; never attach participant data |
| Badge: `submits missed ×n`; CLI: "a Qualtrics page was submitted before Cyborg Hunter's page-submit hook was in place" | A page was submitted before the header ran again; `ch.js` wrote it at the next header run, so nothing was lost | Nothing to fix; add the [final-page line](#the-final-page) so the last page is covered too |
| Console summary: "no survey id in the address or data-qualtrics-survey-id" | The page address has no `SV_…` ID | Add `data-qualtrics-survey-id="${e://Field/SurveyID}"` ([Sessions and surveys in one tab](#sessions-and-surveys-in-one-tab)) |
| Badge: `page 1` on a later page | The page was reloaded: the badge counts pages since the last load | Nothing to fix; the payload keeps the earlier pages |
