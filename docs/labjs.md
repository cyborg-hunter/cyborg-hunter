# lab.js

## Placement

The ch.js tag goes below `lib/lab.js` and above your study script (`script.js` in a builder export, or your own study code):

```html
<script src="lib/lab.js" data-labjs-script="library"></script>
<script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>
<script defer src="script.js"></script>
```

lab.js must be loaded from a script tag, so that it defines `window.lab` before ch.js loads.

| Console message | Cause | Fix |
|---|---|---|
| `Not monitoring lab.js components: ch.js was loaded before lib/lab.js` | the ch.js tag is above `lib/lab.js` | move it below `lib/lab.js` and above your study script |
| `Not monitoring lab.js components: the page has a data-labjs-section element but no window.lab` | `lib/lab.js` did not load (a wrong path, a 404, a blocked request), or lab.js is bundled (npm, ES modules) and never defines `window.lab` | load `lib/lab.js` from a script tag above the ch.js tag; a bundled build cannot be hooked |
| `The lab.js screen on display when ch.js started is not monitored` | the study started before ch.js loaded, so the screen on display then has no integrity columns in its row | move the ch.js tag below `lib/lab.js` and above your study script |
| `lab.js <version> is not supported yet` | the page loads a lab.js 23 pre-release | see [lab.js 23](#labjs-23) |
| `Cyborg Hunter could not hook a lab.js component` | a ch.js hook failed on a component; that component's row carries a `cyborgHunterError` column saying what failed, and the study runs on | open an issue with the message and your script tags |
| `A second lab.js study ran after the first ended` | ch.js records one session per page and ends it when the first study's root component ends, so components run after that have no integrity columns | run one study per page, or reload the page between studies |
| `CyborgHunterConfig.replay.autoSave is ignored` | the recorder saves itself only on a jsPsych page | save `CyborgHunter.replay()` in your own save code |

ch.js logs the hook failure once per page, however many components it affects.

## The end of the session

ch.js ends the session when the study's root component ends. It then writes the last segment (`integritySegmentFinal`), the `integrity*Final` totals and, with the honeypot on, the honeypot's session summary onto the last trial row and onto the root component's own row, before the study's own `on('end')` handlers run, so a save from such a handler includes them.

The study's last screen must end, by a response or a timeout, for these fields to be written. A last screen that stays on display until the participant closes the tab never ends the root component, and the session summary is not written.

With the Transmit plugin's full update switched off (`updates: { full: false }`), the last trial row may already have been sent before the study ended. The final fields then reach the server on the root component's row, which lab.js sends with its next incremental update, 2.5 seconds after the study ends. Keep the full update on (the default) so that every row, the final fields included, is sent when the study ends.

## lab.js 23

ch.js hooks lab.js 20.x, the version the lab.js builder exports as `lib/lab.js`. The lab.js 23 pre-releases (npm's `next` tag) are not supported yet. On a page that loads one, ch.js logs `lab.js <version> is not supported yet` and runs as on a page without jsPsych: it records the session, but lab.js's rows get no integrity columns. To monitor such a page, mark trials and save `CyborgHunter.data()` as described in [advanced-integration.md → Vanilla segmentation reference](advanced-integration.md#vanilla-segmentation-reference).
