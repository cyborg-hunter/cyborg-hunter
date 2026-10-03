# Qualtrics

Qualtrics support for the one-line setup (`ch.js` in a survey's Look & Feel
header) is in development. This page will hold the setup guide; for now it
explains the console messages `ch.js` prints when it runs inside a Qualtrics
survey.

## Declare the field

Qualtrics drops values written to an embedded-data field that Survey Flow does
not declare, without an error. Add an Embedded Data element named
`__js_cyborg_hunter` at the top of Survey Flow.

## Legacy layout

If `ch.js` reports "Qualtrics legacy layout detected", it found
`setEmbeddedData` on the page but no `setJSEmbeddedData`. The message names
the field to declare in Survey Flow for that case: `cyborg_hunter`, not
`__js_cyborg_hunter`.

## Payload size

The payload `ch.js` writes to Qualtrics is a summary of the session: it never
contains text the participant typed or pasted, mouse or element traces, or
window positions.

If `ch.js` reports "The Qualtrics payload was reduced", the session's summary
was longer than the cap the message names (counted in UTF-8 bytes), and the
level it names was written instead. The message says that nothing needs
fixing for that participant.

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

## Replay

A session recording (`data-replay`) is far larger than an embedded-data field
can hold, so `ch.js` never writes it to Qualtrics. To keep recordings, save
what `CyborgHunter.replay()` returns to your own server from a script on the
survey's final page.

## Troubleshooting

If `ch.js` reports that it could not write to Qualtrics embedded data, open an
issue with the console message and your `<script>` tag.
