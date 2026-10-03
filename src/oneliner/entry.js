// src/oneliner/entry.js — dist/ch.js entry. Keep this file tiny: everything
// testable lives in boot.js. document.currentScript is only meaningful while
// this script runs, so it is captured here, synchronously, before anything else.
import { noteRerun } from './rerun.js';                 // FIRST import: its top level marks a same-file re-run before the guard cores evaluate
import '../jspsych/extension-guard-friction.js';   // side effect: window.GuardFriction + window.jsPsychGuardFriction
import '../jspsych/extension-guard-honeypot.js';   // side effect: window.GuardHoneypot + window.jsPsychGuardHoneypot
import { boot } from './boot.js';
var script = typeof document !== 'undefined' ? document.currentScript : null;
if (window.__cyborgHunterRerun) {
  window.__cyborgHunterRerun = false;                   // a guard file loaded later must stay loud
  noteRerun(window, script);
} else boot({ script: script, win: window });
