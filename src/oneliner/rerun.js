// src/oneliner/rerun.js
// A host that re-renders its header re-executes the ch.js tag in the same
// window (Qualtrics does it on every page). That second evaluation is the
// same library, not a second one: it must not log the double-load error,
// start a monitor, guards, a badge or listeners. The first copy keeps running
// and gets a call on its hook (boot.js installs win.__cyborgHunterOnRerun).
//
// Identity is by version, not by script.src: a host that evaluates header
// scripts through an eval path leaves document.currentScript null. A
// different ch.js version, or cyborg-hunter.min.js, is still the loud double
// load (boot.js step 1).
//
// This file is entry.js's FIRST import, so its top level runs before the
// bundled guard cores evaluate: their "Not redefining" else-branches read
// win.__cyborgHunterRerun, and esbuild evaluates bundled modules in import
// order.

import { VERSION } from '../shared/constants.js';

// markRerun(win) → boolean: true when this version of ch.js already runs in
// win. Side effect: win.__cyborgHunterRerun = that boolean.
export function markRerun(win) {
  var rerun = win.__cyborgHunterLoaded === 'ch.js' &&
    !!win.CyborgHunter && win.CyborgHunter.VERSION === VERSION;
  win.__cyborgHunterRerun = rerun;
  return rerun;
}

// noteRerun(win, script): tells the running copy about the re-run. The hook
// is boot's; a page without it (boot failed, or never ran) needs nothing.
export function noteRerun(win, script) {
  try {
    if (typeof win.__cyborgHunterOnRerun === 'function') {
      win.__cyborgHunterOnRerun({ src: (script && script.src) || null });
    }
  } catch (_) { /* the hook reports its own failures */ }
}

if (typeof window !== 'undefined') markRerun(window);
