// demo/analyze/settings-panel.js
// The analyzer's settings: only keys a report can apply after the data were
// collected. The score weights order participants within a tier; the soft
// threshold re-tiers them against the soft scores the data saved; the phase
// scope rescopes those scores; the id, integrity and session-report fields
// say where the data are, so a change to one reads the files again; the
// platform id and the trajectory order change only the display. Nothing here
// re-screens a participant: the hard tier and the saved soft scores are the
// data's own (docs/configuration.md, "Which fields actually do something").
import { SCORE_SIGNALS } from '../../src/cli/analyzers/score-weights.js';

// The keys whose change needs the files read again; the panel's others
// re-analyse the participants the last run read (worker-entry.js `reanalyze`).
export var REINGEST_KEYS = ['participantIdField', 'integrityField', 'sessionIntegrityPath'];

var DEFAULT_WEIGHT = Object.fromEntries(SCORE_SIGNALS.map(function (s) { return [s.key, s.weight]; }));
var commaList = function (text) {
  return String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
};
var numberOrNull = function (text) {
  if (String(text).trim() === '') return null;
  var n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The panel's values from a config (the dropped config merged over the CLI's
 * defaults, as the check returns it).
 */
export function settingsFromConfig(config) {
  var scope = config.phaseScope || {};
  return {
    scoreWeights: config.scoreWeights || null,
    softScoreThreshold: config.scoring && typeof config.scoring.softScoreThreshold === 'number' ? config.scoring.softScoreThreshold : null,
    phaseInclude: Array.isArray(scope.include) ? scope.include.slice() : [],
    phaseExclude: Array.isArray(scope.exclude) ? scope.exclude.slice() : [],
    integrityField: config.integrityField || 'integrity',
    sessionIntegrityPath: config.sessionIntegrityPath || null,
    platformIdField: config.platformIdField || null,
    showPlatformId: !!config.showPlatformId,
    trajectoryDisplayOrder: config.trajectoryDisplayOrder || 'rule',
  };
}

/**
 * The config a run uses: `base` (the merged config) with the panel's values
 * on top. A soft threshold left empty takes each participant's saved one, a
 * scope left empty scores every phase.
 */
export function configFromSettings(base, settings) {
  var c = Object.assign({}, base);
  c.scoreWeights = settings.scoreWeights;
  var scoring = Object.assign({}, base.scoring || {});
  delete scoring.softScoreThreshold;
  if (settings.softScoreThreshold != null) scoring.softScoreThreshold = settings.softScoreThreshold;
  c.scoring = Object.keys(scoring).length ? scoring : null;
  var scope = {};
  if (settings.phaseInclude.length) scope.include = settings.phaseInclude.slice();
  if (settings.phaseExclude.length) scope.exclude = settings.phaseExclude.slice();
  c.phaseScope = Object.keys(scope).length ? scope : null;
  c.integrityField = settings.integrityField || 'integrity';
  c.sessionIntegrityPath = settings.sessionIntegrityPath || null;
  c.platformIdField = settings.platformIdField || null;
  c.showPlatformId = !!settings.showPlatformId;
  c.trajectoryDisplayOrder = settings.trajectoryDisplayOrder || 'rule';
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
  '<p class="hint">Settings a report applies after the data were collected. Each participant\'s tier comes from the scores their session saved: the weights order participants within a tier, the threshold re-tiers them against the saved soft scores, the phases rescope them. A change to the ID, integrity or session-report field reads the files again.</p>' +
  '<p><label>Soft-score threshold <input type="number" min="0" step="any" name="softScoreThreshold" placeholder="each participant\'s saved one"></label></p>' +
  '<p><label>Phases to include <input type="text" name="phaseInclude" placeholder="all"></label> ' +
  '<label>Phases to exclude <input type="text" name="phaseExclude" placeholder="none"></label> <span class="hint" data-role="phase-hint"></span></p>' +
  '<details><summary>Score weights (the order within a tier)</summary>' +
  '<table class="weights"><thead><tr><th>Signal</th><th>Weight</th><th>Cap</th></tr></thead><tbody>' + weightRows() + '</tbody></table></details>' +
  '<p><label>Integrity field <input type="text" name="integrityField"></label> ' +
  '<label>Session report path <input type="text" name="sessionIntegrityPath" placeholder="found by convention"></label></p>' +
  '<p><label>Platform ID field <input type="text" name="platformIdField"></label> ' +
  '<label><input type="checkbox" name="showPlatformId"> show it in the report</label></p>' +
  '<p><label>Trajectory order <select name="trajectoryDisplayOrder"><option value="rule">rule</option><option value="time">time</option><option value="insertion">insertion</option></select></label></p>' +
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
      field('phaseInclude').value = s.phaseInclude.join(', ');
      field('phaseExclude').value = s.phaseExclude.join(', ');
      field('integrityField').value = s.integrityField || '';
      field('sessionIntegrityPath').value = s.sessionIntegrityPath || '';
      field('platformIdField').value = s.platformIdField || '';
      field('showPlatformId').checked = !!s.showPlatformId;
      field('trajectoryDisplayOrder').value = s.trajectoryDisplayOrder || 'rule';
      var user = s.scoreWeights || {};
      SCORE_SIGNALS.forEach(function (sig) {
        var u = user[sig.key];
        var weight = u == null ? sig.weight : (typeof u === 'object' ? (u.weight != null ? u.weight : sig.weight) : u);
        var max = u != null && typeof u === 'object' && u.max != null ? u.max : null;
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
        phaseInclude: commaList(field('phaseInclude').value),
        phaseExclude: commaList(field('phaseExclude').value),
        integrityField: field('integrityField').value.trim() || 'integrity',
        sessionIntegrityPath: field('sessionIntegrityPath').value.trim() || null,
        platformIdField: field('platformIdField').value.trim() || null,
        showPlatformId: field('showPlatformId').checked,
        trajectoryDisplayOrder: field('trajectoryDisplayOrder').value,
      };
    },
    // The phases the last run found (worker-entry.js `done.phases`). Phase
    // scope reads a trial without a phase as "default", and the worker lists
    // that name when such a trial exists: the hint says what it stands for.
    setPhases: function (phases) {
      var list = phases || [];
      container.querySelector('[data-role="phase-hint"]').textContent = list.length
        ? 'Phases in the data: ' + list.join(', ') + (list.indexOf('default') >= 0 ? ' (default: the trials with no phase)' : '')
        : '';
    },
    setAssetsHint: function (shown) { container.querySelector('[data-role="assets-hint"]').hidden = !shown; },
    setDisabled: function (disabled) { form.querySelector('fieldset').disabled = !!disabled; },
  };
}
