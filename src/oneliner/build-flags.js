// src/oneliner/build-flags.js
// The compile-time constants of a one-line file (build-targets.js):
//   HAS_JSPSYCH, HAS_QUALTRICS, HAS_LABJS   whether the file carries that
//                                           host's adapter
//   CH_FILE                                 the file's own name, for the
//                                           messages that name it
// build.js gives esbuild a `define` per file, which replaces each bare
// identifier with a literal: `if (HAS_LABJS && …)` folds to `if (false)` in
// a file without lab.js, and the code only that branch reaches is dropped.
// So a guard reads the bare identifier itself. A constant imported from a
// module is inlined too late to drop anything.
// Unbundled (the node tests) nothing replaces them, so this module sets them
// on globalThis: every host in and CH_FILE 'ch.js', a combination no built
// file has. A test of another file sets other values before boot() and puts
// these back (tests/oneliner/support/build-flags.js). In a bundle each line
// folds to `if (false)` and nothing of this module is left.
/* global HAS_JSPSYCH, HAS_QUALTRICS, HAS_LABJS, CH_FILE */
if (typeof HAS_JSPSYCH === 'undefined') globalThis.HAS_JSPSYCH = true;
if (typeof HAS_QUALTRICS === 'undefined') globalThis.HAS_QUALTRICS = true;
if (typeof HAS_LABJS === 'undefined') globalThis.HAS_LABJS = true;
if (typeof CH_FILE === 'undefined') globalThis.CH_FILE = 'ch.js';
