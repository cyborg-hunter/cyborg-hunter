# lab.js

## Placement

The ch.js tag goes below `lib/lab.js` and above your study script (`script.js` in a builder export, or your own study code):

```html
<script src="lib/lab.js" data-labjs-script="library"></script>
<script src="https://unpkg.com/cyborg-hunter/dist/ch.js"></script>
<script defer src="script.js"></script>
```

lab.js must be loaded from a script tag, so that it defines `window.lab` before ch.js loads.
