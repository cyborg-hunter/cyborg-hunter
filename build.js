// build.js — esbuild configuration for cyborg-hunter.
// Produces these build targets:
//   1. IIFE for <script> tag users (dist/cyborg-hunter.min.js)
//   2. ESM for bundler users (dist/cyborg-hunter.esm.js)
//   3. cyborg-hunter jsPsych extension (dist/extension-cyborg-hunter.js)
//   4. guard-friction extension — deterrence (dist/extension-guard-friction.js)
//   5. guard-honeypot extension — detection  (dist/extension-guard-honeypot.js)
//   6. replay recorder + jsPsych adapter (dist/cyborg-hunter-replay.js)
//   7. the one-line setup, one file per framework (dist/ch.js and the
//      others in build-targets.js)
//
// The two guard-extension files are SELF-CONTAINED — each bundles its
// core IIFE plus the jsPsych extension adapter, so a study only loads
// one script per concern. The cyborg-hunter extension still references
// window.CyborgHunter at runtime, so jsPsych users load both
// cyborg-hunter.min.js AND extension-cyborg-hunter.js (keeps the
// standalone core useful for non-jsPsych studies).
//
// BUILD_OUTDIR (default dist) writes every file to another directory;
// tests/oneliner/build.test.js uses it to build without touching dist/.

import esbuild from 'esbuild';
import { readFileSync } from 'fs';
import { MESSAGES } from './src/oneliner/errors.js';
import { ONE_LINE_TARGETS, defineFor } from './build-targets.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const OUT = process.env.BUILD_OUTDIR || 'dist';

// The min.js footer's double-load text after a one-line file, as a JS
// expression: the catalogue's text cut where the first file's name goes,
// joined at run time with the name that file left in
// window.__cyborgHunterFile (src/oneliner/boot.js). A one-line file of an
// earlier release left no mark and is ch.js, so that page gets the text
// MESSAGES.doubleLoad('ch.js', 'cyborg-hunter.min.js') returns.
const NAME = '\u0000';   // a placeholder no message contains
const doubleLoadAfterOneLine = '[' +
  MESSAGES.doubleLoad(NAME, 'cyborg-hunter.min.js').split(NAME).map((part) => JSON.stringify(part)).join(',') +
  '].join(typeof window.__cyborgHunterFile==="string"?window.__cyborgHunterFile:"ch.js")';

async function build() {
  // Browser IIFE — self-contained, exposes window.CyborgHunter.
  // Do NOT manually assign window.CyborgHunter in src/core/index.js;
  // esbuild's globalName handles the global. The footer adds the
  // backward-compat IntegrityMonitor alias and the double-load sentinel
  // shared with dist/ch.js (window.__cyborgHunterLoaded): if ch.js already
  // ran, it logs the catalogue's double-load error, naming the one-line file
  // that ran (doubleLoadAfterOneLine above); if another copy of this
  // bundle set it, the neutral loaded-twice error (src/oneliner/errors.js).
  // After ch.js the bundle must not take the namespace either: globalName's
  // top-level `var CyborgHunter = ...` replaces ch.js's window.CyborgHunter
  // before the footer runs, so the banner keeps ch.js's namespace in
  // __cyborgHunterPrevNS and the footer puts it back (IntegrityMonitor then
  // points at it too). A manual-mode extension's CyborgHunter.init() reaches
  // ch.js's init(), which hands out a core monitor once ch.js has handed over
  // (src/oneliner/api.js).
  await esbuild.build({
    entryPoints: ['src/core/index.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'CyborgHunter',
    outfile: OUT + '/cyborg-hunter.min.js',
    platform: 'browser',
    banner: { js: `// cyborg-hunter v${pkg.version} — https://github.com/cyborg-hunter/cyborg-hunter\n` +
      'var __cyborgHunterPrevNS=typeof window!=="undefined"&&window.__cyborgHunterLoaded==="ch.js"?window.CyborgHunter:void 0;' },
    footer: { js: 'if(typeof window!=="undefined"){if(window.__cyborgHunterLoaded==="ch.js"){console.error(' +
      doubleLoadAfterOneLine +
      ');if(__cyborgHunterPrevNS)CyborgHunter=__cyborgHunterPrevNS}else if(window.__cyborgHunterLoaded){console.error(' +
      JSON.stringify(MESSAGES.coreLoadedTwice()) +
      ')}else{window.__cyborgHunterLoaded="cyborg-hunter.min.js"}window.IntegrityMonitor=CyborgHunter;__cyborgHunterPrevNS=void 0}' }
  });

  // ESM module
  await esbuild.build({
    entryPoints: ['src/core/index.js'],
    bundle: true,
    format: 'esm',
    outfile: OUT + '/cyborg-hunter.esm.js',
    platform: 'browser'
  });

  // cyborg-hunter jsPsych extension — references window.CyborgHunter
  // at runtime, so researcher must load cyborg-hunter.min.js first.
  await esbuild.build({
    entryPoints: ['src/jspsych/extension-cyborg-hunter.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    outfile: OUT + '/extension-cyborg-hunter.js',
    platform: 'browser'
  });

  // guard-friction extension — self-contained: core IIFE attaches
  // window.GuardFriction; trailing extension class attaches
  // window.jsPsychGuardFriction. Pairs with the honeypot extension.
  await esbuild.build({
    entryPoints: ['src/jspsych/extension-guard-friction.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    outfile: OUT + '/extension-guard-friction.js',
    platform: 'browser'
  });

  // guard-honeypot extension — self-contained: core IIFE attaches
  // window.GuardHoneypot; trailing extension class attaches
  // window.jsPsychGuardHoneypot. Subscribes to window.GuardFriction
  // .onViolation() if friction is loaded; otherwise still functions
  // as a pure honeypot (empty violation log).
  await esbuild.build({
    entryPoints: ['src/jspsych/extension-guard-honeypot.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    outfile: OUT + '/extension-guard-honeypot.js',
    platform: 'browser'
  });

  // cyborg-hunter-replay extension — self-contained: bundles the replay
  // core (window.CyborgHunterReplay, standalone-usable) plus the jsPsych
  // adapter (window.jsPsychCyborgHunterReplay). Guard-extension precedent:
  // one script per concern, no load-order dependency on the core dist file.
  await esbuild.build({
    entryPoints: ['src/jspsych/extension-cyborg-hunter-replay.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    outfile: OUT + '/cyborg-hunter-replay.js',
    platform: 'browser',
    banner: { js: `// cyborg-hunter-replay v${pkg.version} — https://github.com/cyborg-hunter/cyborg-hunter` }
  });

  // The one-line setup, one file per framework (build-targets.js). Each
  // bundles the core, the guard cores and its own host adapters: `define`
  // turns the host flags into literals (src/oneliner/build-flags.js), so the
  // other hosts' adapters are dropped. NO globalName: entry.js assigns
  // window.CyborgHunter itself after the double-load check, so a second load
  // never clobbers the first.
  for (const target of ONE_LINE_TARGETS) {
    await esbuild.build({
      entryPoints: ['src/oneliner/entry.js'],
      bundle: true, minify: true, format: 'iife', platform: 'browser',
      define: defineFor(target),
      outfile: OUT + '/' + target.file,
      banner: { js: `// cyborg-hunter one-line setup v${pkg.version} — https://github.com/cyborg-hunter/cyborg-hunter` }
    });
  }

  console.log('Build complete: ' + OUT + '/');
}

build().catch((e) => { console.error(e); process.exit(1); });
