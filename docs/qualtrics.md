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

A survey that does not use the New Survey Taking Experience has
`setEmbeddedData` but no `setJSEmbeddedData`. There the field to declare in
Survey Flow is `cyborg_hunter`, not `__js_cyborg_hunter`.

## Payload size

An embedded-data field holds a limited number of characters per page submit,
so the payload `ch.js` writes is capped. When a session's summary is longer
than the cap, a reduced version is written and the report notes what was
left out.

## Replay

A session recording (`data-replay`) is far larger than an embedded-data field
can hold, so `ch.js` never writes it to Qualtrics. To keep recordings, save
what `CyborgHunter.replay()` returns to your own server from a script on the
survey's final page.

## Troubleshooting

If `ch.js` reports that it could not write to Qualtrics embedded data, open an
issue with the console message and your `<script>` tag.
