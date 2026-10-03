# lab.js

## Placement

The ch.js tag goes below `lib/lab.js` and above your study script (`script.js` in a builder export, or your own study code):

```html
<script src="lib/lab.js" data-labjs-script="library"></script>
<script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>
<script defer src="script.js"></script>
```

lab.js must be loaded from a script tag, so that it defines `window.lab` before ch.js loads.

## The end of the session

ch.js ends the session when the study's root component ends. It then writes the last segment (`integritySegmentFinal`), the `integrity*Final` totals and, with the honeypot on, the honeypot's session summary onto the last trial row and onto the root component's own row, before the study's own `on('end')` handlers run, so a save from such a handler includes them.

The study's last screen must end, by a response or a timeout, for these fields to be written. A last screen that stays on display until the participant closes the tab never ends the root component, and the session summary is not written.

With the Transmit plugin's full update switched off (`updates: { full: false }`), the last trial row may already have been sent before the study ended. The final fields then reach the server on the root component's row, which lab.js sends with its next incremental update, 2.5 seconds after the study ends. Keep the full update on (the default) so that every row, the final fields included, is sent when the study ends.
