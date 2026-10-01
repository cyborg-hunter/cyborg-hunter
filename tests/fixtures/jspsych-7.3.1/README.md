# Vendored jsPsych 7.3.1 (test fixture)

Unmodified browser builds, used only by tests: `tests/oneliner/jspsych-real.test.js`
runs the one-line setup against real jsPsych (under happy-dom) instead of a
fake, and the Playwright fixture pages in `tests/e2e/oneliner/fixtures/` load
them in a real browser:

- `jspsych.js`: the jsPsych 7.3.1 browser build (`jsPsychModule`; its
  `version` string reads `7.3.1`).
- `plugin-call-function.js`: the `@jspsych/plugin-call-function` browser
  build (`jsPsychCallFunction`) from the jsPsych 7 release line.
- `plugin-html-button-response.js`: the `@jspsych/plugin-html-button-response`
  browser build (`jsPsychHtmlButtonResponse`) from the same release line;
  `GuardFriction.createEntryTrial()` uses it.
- `plugin-html-keyboard-response.js` (`jsPsychHtmlKeyboardResponse`),
  `plugin-survey-text.js` (`jsPsychSurveyText`) and
  `extension-mouse-tracking.js` (`jsPsychExtensionMouseTracking`): the
  `@jspsych/plugin-html-keyboard-response`, `@jspsych/plugin-survey-text` and
  `@jspsych/extension-mouse-tracking` browser builds from the same release
  line, for the e2e fixtures.

`jspsych.css` is not vendored: it embeds its fonts (about 460 KB) and no test
depends on jsPsych's styling.

Source: https://github.com/jspsych/jsPsych. License: MIT (full text in LICENSE), copyright (c) 2014
Joshua R. de Leeuw. These files are not shipped in the npm package (`files` in
package.json does not include `tests/`).
