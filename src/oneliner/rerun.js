// src/oneliner/rerun.js
// A host that re-renders its header re-executes the ch.js tag in the same
// window (Qualtrics does it on every page). That second evaluation is the
// same library, not a second one: it must not log the double-load error,
// start a monitor, guards, a badge or listeners. The first copy keeps running
// and gets a call on its hook (boot.js installs win.__cyborgHunterOnRerun).
//
// Identity is by one-line file and version, not by script.src: a host that
// evaluates header scripts through an eval path leaves document.currentScript
// null. The file is the one the first copy named in win.__cyborgHunterFile
// (boot.js), against this copy's CH_FILE; a window without that mark ran a
// one-line file of an earlier release, which is ch.js. A different version,
// another one-line file (ch.js where ch-qualtrics.js runs), or
// cyborg-hunter.min.js, is still the loud double load (boot.js step 1). So is
// a second tag of the same file and version on any page where the first copy
// found no Qualtrics survey: only Qualtrics re-runs its header, and boot
// marks the window when it finds one (win.__cyborgHunterRerunHost).
//
// This file is entry.js's FIRST import, so its top level runs before the
// bundled guard cores evaluate: their "Not redefining" else-branches read
// win.__cyborgHunterRerun, and esbuild evaluates bundled modules in import
// order. build-flags.js comes first here: this top level reads CH_FILE before
// boot.js imports it (in a bundle it is a literal and the import is empty).

import './build-flags.js';
import { VERSION } from '../shared/constants.js';

// markRerun(win) → boolean: true when this one-line file, at this version,
// already runs in win and found a host that re-runs its header. Side effect:
// win.__cyborgHunterRerun = that boolean.
export function markRerun(win) {
  var rerun = win.__cyborgHunterLoaded === 'ch.js' && !!win.__cyborgHunterRerunHost &&
    !!win.CyborgHunter && win.CyborgHunter.VERSION === VERSION &&
    (typeof win.__cyborgHunterFile === 'string' ? win.__cyborgHunterFile : 'ch.js') === CH_FILE;
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
