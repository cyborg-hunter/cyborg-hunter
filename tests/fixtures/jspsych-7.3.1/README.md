# Vendored jsPsych 7.3.1 (test fixture)

Unmodified browser builds, used only by `tests/oneliner/jspsych-real.test.js`
to run the one-line setup against real jsPsych (under happy-dom) instead of
a fake:

- `jspsych.js`: the jsPsych 7.3.1 browser build (`jsPsychModule`; its
  `version` string reads `7.3.1`).
- `plugin-call-function.js`: the `@jspsych/plugin-call-function` browser
  build (`jsPsychCallFunction`) from the jsPsych 7 release line.
- `plugin-html-button-response.js`: the `@jspsych/plugin-html-button-response`
  browser build (`jsPsychHtmlButtonResponse`) from the same release line;
  `GuardFriction.createEntryTrial()` uses it.

Source: https://github.com/jspsych/jsPsych. License: MIT, copyright (c) 2014
Joshua R. de Leeuw. These files are not shipped in the npm package (`files` in
package.json does not include `tests/`).
