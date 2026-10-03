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

If `ch.js` reports "The Qualtrics payload was reduced", the session's summary
was longer than the character cap the message names, and the level it names
was written instead. The message says that nothing needs fixing for that
participant.

## Replay

A session recording (`data-replay`) is far larger than an embedded-data field
can hold, so `ch.js` never writes it to Qualtrics. To keep recordings, save
what `CyborgHunter.replay()` returns to your own server from a script on the
survey's final page.

## Troubleshooting

If `ch.js` reports that it could not write to Qualtrics embedded data, open an
issue with the console message and your `<script>` tag.
