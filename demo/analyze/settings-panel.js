// demo/analyze/settings-panel.js
// The analyzer's settings: only keys a report can apply after the data were
// collected. The score weights order participants within a tier; the soft
// threshold re-tiers them against the soft scores the data saved; the id,
// integrity and session-report fields say where the data are, so a change to
// one reads the files again; the platform id changes only the display. Nothing
// here re-screens a participant: the hard tier and the saved soft scores are
// the data's own (docs/configuration.md, "Which fields actually do something").
// The phase scope and the trajectory order are left to the CLI: the panel
// neither shows nor edits them, and a dropped config that sets them keeps
// them, in every run and in the export (configFromSettings).
import { SCORE_SIGNALS } from '../../src/cli/analyzers/score-weights.js';

// The keys whose change needs the files read again; the panel's others
// re-analyse the participants the last run read (worker-entry.js `reanalyze`).
export var REINGEST_KEYS = ['participantIdField', 'integrityField', 'sessionIntegrityPath'];

var DEFAULT_WEIGHT = Object.fromEntries(SCORE_SIGNALS.map(function (s) { return [s.key, s.weight]; }));
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
    softScoreThreshold: config.scoring && typeof config.scoring.softScoreThreshold === 'number' ? config.scoring.softScoreThreshold : null,
    integrityField: config.integrityField || 'integrity',
    sessionIntegrityPath: config.sessionIntegrityPath || null,
    platformIdField: config.platformIdField || null,
    showPlatformId: !!config.showPlatformId,
  };
}

// One signal's weight and cap as the panel shows them, from a config's
// scoreWeights entry: a bare number is the weight, an object may give the
// weight and a cap, and no entry is the signal's default weight, uncapped.
function resolveWeight(user, sig) {
  var u = user[sig.key];
  var weight = u == null ? sig.weight : (typeof u === 'object' ? (u.weight != null ? u.weight : sig.weight) : u);
  var max = u != null && typeof u === 'object' && u.max != null ? u.max : null;
  return [weight, max];
}

/**
 * The settings as the panel shows them, as a string two configs can be
 * compared by: the weights resolved per signal in SCORE_SIGNALS order, so
 * key order, a bare number against { weight }, and an explicit default
 * against no entry all compare equal. The phase scope and the trajectory
 * order are not in it: two configs that differ only in them put the same
 * values in the panel, so the page does not count the second as a change
 * (the run still takes the newer config's, through configFromSettings).
 */
export function settingsKey(s) {
  var user = s.scoreWeights || {};
  return JSON.stringify([SCORE_SIGNALS.map(function (sig) { return resolveWeight(user, sig); }),
    s.softScoreThreshold, s.integrityField, s.sessionIntegrityPath, s.platformIdField, s.showPlatformId]);
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
  var scoring = Object.assign({}, base.scoring || {});
  delete scoring.softScoreThreshold;
  if (settings.softScoreThreshold != null) scoring.softScoreThreshold = settings.softScoreThreshold;
  c.scoring = Object.keys(scoring).length ? scoring : null;
  c.integrityField = settings.integrityField || 'integrity';
  c.sessionIntegrityPath = settings.sessionIntegrityPath || null;
  c.platformIdField = settings.platformIdField || null;
  c.showPlatformId = !!settings.showPlatformId;
  return c;
}

// One weights row per report-score signal (src/cli/analyzers/score-weights.js).
function weightRows() {
  return SCORE_SIGNALS.map(function (s) {
    return '<tr><td><code>' + s.key + '</code></td>' +
      '<td><input type="number" min="0" step="any" data-weight="' + s.key + '" aria-label="' + s.key + ' weight"></td>' +
      '<td><input type="number" min="0" step="1" data-max="' + s.key + '" placeholder="none" aria-label="' + s.key + ' cap"></td></tr>';
  }).join('');
}

var PANEL_HTML =
  '<form data-role="settings-form"><fieldset>' +
  '<legend>Settings</legend>' +
  '<p><label>Participant ID field: <select data-role="id-field" name="participantIdField"></select></label> <span class="hint" data-role="id-files"></span></p>' +
  '<p class="hint">Settings a report applies after the data were collected. Each participant\'s tier comes from the scores their session saved: the weights order participants within a tier, the threshold re-tiers them against the saved soft scores. A change to the ID, integrity or session-report field reads the files again.</p>' +
  '<p><label>Soft-score threshold <input type="number" min="0" step="any" name="softScoreThreshold" placeholder="each participant\'s saved one"></label> ' +
  '<span class="hint">The score at or above which a participant is flagged as suspicious in the triage list.</span></p>' +
  '<details open><summary>Score weights: choose how much importance to give to each of the potential signals in estimating the participant\'s suspiciousness score.</summary>' +
  '<table class="weights"><thead><tr><th>Signal</th><th>Weight</th><th>Cap</th></tr></thead><tbody>' + weightRows() + '</tbody></table></details>' +
  '<p><label>Integrity field <input type="text" name="integrityField"></label> ' +
  '<label>Session report path <input type="text" name="sessionIntegrityPath" placeholder="found by convention"></label></p>' +
  '<p><label>Platform ID field <input type="text" name="platformIdField"></label> ' +
  '<label><input type="checkbox" name="showPlatformId"> show it in the report</label></p>' +
  '<p><button type="button" class="secondary" data-action="export-config">Export config</button> ' +
  '<span class="hint" data-role="assets-hint" hidden>The exported config sets assetsDir to ./assets: for the CLI, put the experiment\'s CSS and image files in an assets folder beside it.</span></p>' +
  '</fieldset></form>';

/**
 * Renders the panel into `container`; `onChange()` runs after any field
 * changes (a `change` event: on blur or Enter for a text field, at once for
 * a select or a checkbox).
 */
export function createSettingsPanel(container, onChange) {
  container.innerHTML = PANEL_HTML;
  var form = container.querySelector('form');
  var field = function (name) { return form.elements.namedItem(name); };
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  form.addEventListener('change', function () { onChange(); });
  return {
    write: function (s) {
      field('softScoreThreshold').value = s.softScoreThreshold == null ? '' : String(s.softScoreThreshold);
      field('integrityField').value = s.integrityField || '';
      field('sessionIntegrityPath').value = s.sessionIntegrityPath || '';
      field('platformIdField').value = s.platformIdField || '';
      field('showPlatformId').checked = !!s.showPlatformId;
      var user = s.scoreWeights || {};
      SCORE_SIGNALS.forEach(function (sig) {
        var resolved = resolveWeight(user, sig), weight = resolved[0], max = resolved[1];
        form.querySelector('[data-weight="' + sig.key + '"]').value = String(weight);
        form.querySelector('[data-max="' + sig.key + '"]').value = max == null ? '' : String(max);
      });
    },
    read: function () {
      var weights = {};
      SCORE_SIGNALS.forEach(function (sig) {
        var w = numberOrNull(form.querySelector('[data-weight="' + sig.key + '"]').value);
        var max = numberOrNull(form.querySelector('[data-max="' + sig.key + '"]').value);
        var weight = w == null ? DEFAULT_WEIGHT[sig.key] : w;
        if (weight === DEFAULT_WEIGHT[sig.key] && max == null) return;
        weights[sig.key] = max == null ? weight : { weight: weight, max: Math.floor(max) };
      });
      return {
        scoreWeights: Object.keys(weights).length ? weights : null,
        softScoreThreshold: numberOrNull(field('softScoreThreshold').value),
        integrityField: field('integrityField').value.trim() || 'integrity',
        sessionIntegrityPath: field('sessionIntegrityPath').value.trim() || null,
        platformIdField: field('platformIdField').value.trim() || null,
        showPlatformId: field('showPlatformId').checked,
      };
    },
    setAssetsHint: function (shown) { container.querySelector('[data-role="assets-hint"]').hidden = !shown; },
    setDisabled: function (disabled) { form.querySelector('fieldset').disabled = !!disabled; },
  };
}
