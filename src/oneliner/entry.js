// src/oneliner/entry.js — dist/ch.js entry. Keep this file tiny: everything
// testable lives in boot.js. document.currentScript is only meaningful while
// this script runs, so it is captured here, synchronously, before anything else.
import '../jspsych/extension-guard-friction.js';   // side effect: window.GuardFriction + window.jsPsychGuardFriction
import '../jspsych/extension-guard-honeypot.js';   // side effect: window.GuardHoneypot + window.jsPsychGuardHoneypot
import { boot } from './boot.js';
var script = typeof document !== 'undefined' ? document.currentScript : null;
boot({ script: script, win: window });
