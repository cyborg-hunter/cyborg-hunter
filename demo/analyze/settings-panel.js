// demo/analyze/settings-panel.js
// The analyzer's settings: only keys a report can apply after the data were
// collected. The score weights order participants; Hard at (hardAt) adds the
// report's own hard tier, shown as hard*; the soft threshold re-tiers them
// against the soft scores the data saved; the id, integrity and
// session-report fields say where the data are, so a change to one reads the
// files again; the platform id changes only the display, and pseudonymize
// swaps the ids the report shows for codes. The tier the library decided is
// kept and shown as hard, and the saved soft scores are the data's own: Hard
// at only adds hard* beside them (docs/configuration.md, "Which fields
// actually do something").
// The weights and Hard at are the shared panel (src/cli/renderers/
// weights-panel.js), the one the CLI report opens from "Weights…".
// The phase scope and the trajectory order are left to the CLI: the panel
// neither shows nor edits them, and a dropped config that sets them keeps
// them, in every run and in the export (configFromSettings).
import { SCORE_SIGNALS, resolveScoreWeights } from '../../src/cli/analyzers/score-weights.js';
import { panelSignals, weightsPanelHtml, wireWeightsPanel, weightsConfig, WEIGHTS_PANEL_CSS } from '../../src/cli/renderers/weights-panel.js';

// The keys whose change needs the files read again; the panel's others
// re-analyse the participants the last run read (worker-entry.js `reanalyze`).
export var REINGEST_KEYS = ['participantIdField', 'integrityField', 'sessionIntegrityPath'];

// The panel's rows, at the defaults: write() puts a config's values in.
var SIGNALS = panelSignals();
var numberOrNull = function (text) {
  if (String(text).trim() === '') return null;
  var n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The panel's values from a config (the dropped config merged over the CLI's
 * defaults, as the check returns it). A value added here must join
 * settingsKey, or a config that differs only in it never counts as changed.
 */
export function settingsFromConfig(config) {
  return {
    scoreWeights: config.scoreWeights || null,
    hardAt: config.hardAt || null,
    softScoreThreshold: config.scoring && typeof config.scoring.softScoreThreshold === 'number' ? config.scoring.softScoreThreshold : null,
    integrityField: config.integrityField || 'integrity',
    sessionIntegrityPath: config.sessionIntegrityPath || null,
    platformIdField: config.platformIdField || null,
    showPlatformId: !!config.showPlatformId,
    pseudonymize: !!config.pseudonymize,
  };
}

// Each signal's weight and cap as the panel shows them, in SCORE_SIGNALS
// order, from a config's scoreWeights resolved as the CLI resolves it
// (resolveScoreWeights): an entry the CLI ignores with a warning (a weight
// that is not a number ≥ 0, a cap that is not a whole number ≥ 0) shows the
// default the run then uses, so the box, the slider and the run agree.
function panelWeights(scoreWeights) {
  var resolved = resolveScoreWeights(scoreWeights).weights;
  return SCORE_SIGNALS.map(function (sig) { return { weight: resolved[sig.key].weight, max: resolved[sig.key].max }; });
}

// One signal's Hard at count as the panel shows it, from a config's hardAt:
// a whole number from 1, else none (resolveHardAt warns about the rest).
function resolveHardAtCount(hardAt, sig) {
  var h = hardAt && typeof hardAt === 'object' ? hardAt[sig.key] : null;
  return Number.isInteger(h) && h >= 1 ? h : null;
}

/**
 * The settings as the panel shows them, as a string two configs can be
 * compared by: the weights and the Hard at counts resolved per signal in
 * SCORE_SIGNALS order, so key order, a bare number against { weight }, an
 * explicit default against no entry, and an entry the CLI ignores against no
 * entry all compare equal. The phase scope and the trajectory order are not
 * in it: two configs that differ only in them put the same values in the
 * panel, so the page does not count the second as a change (the run still
 * takes the newer config's, through configFromSettings).
 */
export function settingsKey(s) {
  return JSON.stringify([panelWeights(s.scoreWeights),
    SCORE_SIGNALS.map(function (sig) { return resolveHardAtCount(s.hardAt, sig); }),
    s.softScoreThreshold, s.integrityField, s.sessionIntegrityPath, s.platformIdField, s.showPlatformId, s.pseudonymize]);
}

/**
 * The config a run uses: `base` (the merged config) with the panel's values
 * on top. A soft threshold left empty takes each participant's saved one.
 * The keys the panel does not hold, the phase scope and the trajectory order
 * among them, are base's own.
 */
export function configFromSettings(base, settings) {
  var c = Object.assign({}, base);
  c.scoreWeights = settings.scoreWeights;
  c.hardAt = settings.hardAt || null;
  var scoring = Object.assign({}, base.scoring || {});
  delete scoring.softScoreThreshold;
  if (settings.softScoreThreshold != null) scoring.softScoreThreshold = settings.softScoreThreshold;
  c.scoring = Object.keys(scoring).length ? scoring : null;
  c.integrityField = settings.integrityField || 'integrity';
  c.sessionIntegrityPath = settings.sessionIntegrityPath || null;
  c.platformIdField = settings.platformIdField || null;
  c.showPlatformId = !!settings.showPlatformId;
  c.pseudonymize = !!settings.pseudonymize;
  return c;
}

var PANEL_HTML =
  '<style>' + WEIGHTS_PANEL_CSS + '</style>' +
  '<form data-role="settings-form"><fieldset>' +
  '<legend>Settings</legend>' +
  '<p><label>Participant ID field: <select data-role="id-field" name="participantIdField"></select></label> <span class="hint" data-role="id-files"></span></p>' +
  '<p><label>Soft-score threshold <input type="number" min="0" step="any" name="softScoreThreshold" placeholder="each participant\'s saved one"></label> ' +
  '<span class="hint">The score at or above which a participant is flagged as suspicious in the triage list.</span></p>' +
  '<details open><summary>Score weights: choose how much importance to give to each of the potential signals in estimating the participant\'s suspiciousness score.</summary>' +
  weightsPanelHtml(SIGNALS) + '</details>' +
  '<p><label>Integrity field <input type="text" name="integrityField"></label> ' +
  '<label>Session report path <input type="text" name="sessionIntegrityPath" placeholder="found by convention"></label></p>' +
  '<p><label>Platform ID field <input type="text" name="platformIdField"></label> ' +
  '<label><input type="checkbox" name="showPlatformId"> show it in the report</label></p>' +
  '<p><label><input type="checkbox" name="pseudonymize"> Pseudonymize participant IDs</label> ' +
  '<span class="hint">The report and its zip show a code in place of each ID; the key that maps the codes back is a separate download, never in the zip. ' +
  'Codes replace IDs, not content: typed or pasted text and what a replay recorded can still identify a participant.</span></p>' +
  // The pseudonym key (pseudonym-key.js), which the page wires: not a
  // config value, so neither read nor written with the fields above.
  '<p><span data-role="key-status"></span> ' +
  '<button type="button" class="secondary" data-action="forget-key" hidden>Forget key</button> ' +
  '<label class="file-link">Use a key file…<input type="file" accept=".csv,text/csv" data-role="key-input"></label></p>' +
  '<div class="hint" data-role="key-note" role="status" hidden></div>' +
  '<p><button type="button" class="secondary" data-action="export-config">Export config</button> ' +
  '<span class="hint" data-role="assets-hint" hidden>The exported config sets assetsDir to ./assets: for the CLI, put the experiment\'s CSS and image files in an assets folder beside it.</span></p>' +
  '</fieldset></form>';

/**
 * Renders the panel into `container`; `onChange()` runs after any field
 * changes (a `change` event: on blur or Enter for a text field, at once for
 * a select or a checkbox, on release for a slider, and once for Reset to
 * defaults). A slider's drag fires no change until it is released: each
 * change re-analyses the cohort.
 */
export function createSettingsPanel(container, onChange) {
  container.innerHTML = PANEL_HTML;
  var form = container.querySelector('form');
  var field = function (name) { return form.elements.namedItem(name); };
  var weights = wireWeightsPanel(form.querySelector('.wp'), { signals: SIGNALS, onInput: null });
  // The panel's Copy config gives the scoreWeights and hardAt entries only;
  // Export config, below, writes the whole file with them, so the settings
  // offer that one. The shared panel keeps the button for the CLI report's
  // dialog, which has no Export config; here it goes once the panel is wired.
  form.querySelector('[data-action="weights-copy"]').remove();
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  // A key file picked is not a settings change (the page handles it).
  form.addEventListener('change', function (e) { if (!(e.target && e.target.dataset && e.target.dataset.role === 'key-input')) onChange(); });
  return {
    write: function (s) {
      field('softScoreThreshold').value = s.softScoreThreshold == null ? '' : String(s.softScoreThreshold);
      field('integrityField').value = s.integrityField || '';
      field('sessionIntegrityPath').value = s.sessionIntegrityPath || '';
      field('platformIdField').value = s.platformIdField || '';
      field('showPlatformId').checked = !!s.showPlatformId;
      field('pseudonymize').checked = !!s.pseudonymize;
      weights.write({
        weights: panelWeights(s.scoreWeights),
        hardAt: SCORE_SIGNALS.map(function (sig) { return resolveHardAtCount(s.hardAt, sig); }),
      });
    },
    read: function () {
      var c = weightsConfig(SIGNALS, weights.read());
      return {
        scoreWeights: c.scoreWeights || null,
        hardAt: c.hardAt || null,
        softScoreThreshold: numberOrNull(field('softScoreThreshold').value),
        integrityField: field('integrityField').value.trim() || 'integrity',
        sessionIntegrityPath: field('sessionIntegrityPath').value.trim() || null,
        platformIdField: field('platformIdField').value.trim() || null,
        showPlatformId: field('showPlatformId').checked,
        pseudonymize: field('pseudonymize').checked,
      };
    },
    setAssetsHint: function (shown) { container.querySelector('[data-role="assets-hint"]').hidden = !shown; },
    setDisabled: function (disabled) { form.querySelector('fieldset').disabled = !!disabled; },
  };
}
