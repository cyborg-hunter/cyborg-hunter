// demo/analyze/participant-id-suggest.js
// Which column or key holds the participant id. Known names first (the
// CLI's default, jsPsych's usual column, the recruitment platforms' URL
// parameters the one-line setup reads), then any field whose value is the
// same on every row of a file and differs between files — the shape of an
// id and of nothing else in trial data. The researcher confirms in a dropdown.
import { DEFAULT_PARAMS } from '../../src/oneliner/participant-id.js';

export var KNOWN_ID_NAMES = ['participant_id', 'participantId', 'subject_ID', 'subject_id', 'subject'].concat(DEFAULT_PARAMS);

// cyborg-hunter's own per-trial columns (the jsPsych extension's integrity*
// fields, the one-line setup's cyborgHunter* fields) are constant within a
// participant's file and, on a small cohort, can be unique across files: they
// look like an id to the fallback rule below and must never be offered as one.
var OWN_COLUMN = /^(integrity|cyborgHunter)/;

function constantUniqueAcross(field, peeks) {
  var seen = Object.create(null);
  for (var i = 0; i < peeks.length; i++) {
    var vals = (peeks[i].values && peeks[i].values[field]) || [];
    if (vals.length === 0) return false;
    for (var j = 1; j < vals.length; j++) if (vals[j] !== vals[0]) return false;
    if (seen[vals[0]]) return false;
    seen[vals[0]] = true;
  }
  return true;
}

export function suggestIdField(peeks) {
  var candidates = [];
  var counted = Object.create(null);
  for (var i = 0; i < peeks.length; i++) {
    var keys = peeks[i].keys || [];
    for (var j = 0; j < keys.length; j++) counted[keys[j]] = (counted[keys[j]] || 0) + 1;
  }
  // A field must exist in every file to identify every participant.
  var everywhere = Object.keys(counted).filter(function (k) { return counted[k] === peeks.length; });
  for (var k = 0; k < KNOWN_ID_NAMES.length; k++) {
    if (everywhere.indexOf(KNOWN_ID_NAMES[k]) >= 0) candidates.push({ field: KNOWN_ID_NAMES[k], reason: 'known name' });
  }
  for (var m = 0; m < everywhere.length; m++) {
    var f = everywhere[m];
    if (KNOWN_ID_NAMES.indexOf(f) >= 0 || OWN_COLUMN.test(f)) continue;
    if (constantUniqueAcross(f, peeks)) candidates.push({ field: f, reason: 'constant within each file, unique across files' });
  }
  return { suggested: candidates.length ? candidates[0].field : null, candidates: candidates };
}
