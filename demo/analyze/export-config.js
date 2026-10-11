// demo/analyze/export-config.js
// "Export config": the page's settings as a cyborg-hunter.config.json from
// which the CLI builds the same report. Only the keys that differ from the
// CLI's defaults (src/shared/schema.js DEFAULT_CLI_CONFIG) are written, plus
// participantIdField, always. The file-system keys are the analyst's own
// (from a dropped config) or the CLI's defaults: the config a run of this
// page uses (worker-entry.js runConfig: dataDir '(dropped files)' and the
// like) means nothing to the CLI and is never what reaches this function.
import { DEFAULT_CLI_CONFIG } from '../../src/shared/schema.js';

// Set per run, by the CLI's flags or by this page; never a config file's.
var RUN_ONLY = { noVisuals: true, singleParticipant: true };

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/**
 * @param {object} config  the settings' config (settings-panel.js configFromSettings)
 * @param {{participantIdField: string, assetsDropped: boolean}} opts
 * @returns {object} the file's content
 */
export function exportConfig(config, opts) {
  var out = {};
  Object.keys(config).forEach(function (key) {
    if (RUN_ONLY[key] || key === 'participantIdField' || config[key] === undefined) return;
    if (Object.prototype.hasOwnProperty.call(DEFAULT_CLI_CONFIG, key) && same(config[key], DEFAULT_CLI_CONFIG[key])) return;
    out[key] = config[key];
  });
  out.participantIdField = opts.participantIdField;
  // The experiment's files were dropped here; the CLI reads them from a
  // folder, which the analyst creates beside the config (the page says so).
  if (opts.assetsDropped && !out.assetsDir) out.assetsDir = './assets';
  return out;
}
