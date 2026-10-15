// src/oneliner/entry-replay.js — the entry of the one-line files that bundle
// the session recorder (build-targets.js `replay`: ch.js, ch-labjs.js). Those
// files record by default, so the recorder ships inside them: no second
// script to wait for before jsPsych's first trial, nothing that can fail to
// load, and one file for an integrity hash to cover. replay-loader.js finds
// the globals already defined and loads nothing.
//
// Import order is evaluation order in the bundle. rerun.js stays first (its
// top level must run before the guard cores; see there), then the recorder,
// then entry.js, whose own imports and body run last.
import './rerun.js';
import '../jspsych/extension-cyborg-hunter-replay.js';   // side effect: window.CyborgHunterReplay + window.jsPsychCyborgHunterReplay
import './entry.js';
