# lab.js

The one-line setup on a [lab.js](https://lab.js.org) study.

## Placement

The ch.js tag goes below `lib/lab.js` and above your study script (`script.js` in a builder export, or your own study code):

```html
<script src="lib/lab.js" data-labjs-script="library"></script>
<script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>
<script defer src="script.js"></script>
```

lab.js must be loaded from a script tag, so that it defines `window.lab` before ch.js loads.

| Console error | Cause | Fix |
|---|---|---|
| `Not monitoring lab.js components: ch.js was loaded before lib/lab.js` | the ch.js tag is above `lib/lab.js` | move it below `lib/lab.js` and above your study script |
| `Not monitoring lab.js components: the page has a data-labjs-section element but no window.lab` | lab.js is bundled (npm, ES modules) and never defines `window.lab` | load `lib/lab.js` from a script tag above the ch.js tag; a bundled build cannot be hooked |
