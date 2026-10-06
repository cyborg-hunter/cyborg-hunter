// The compile-time constants of another one-line file, for a node test
// (src/oneliner/build-flags.js). setBuild(flags) sets the given globals
// (HAS_JSPSYCH, HAS_QUALTRICS, HAS_LABJS, CH_FILE) and returns a function
// that puts the previous values back: call it in before() and the result in
// after(). buildOf(file) is a target's own set from build-targets.js.
import '../../../src/oneliner/build-flags.js';
import { ONE_LINE_TARGETS, defineFor } from '../../../build-targets.js';

const NAMES = ['HAS_JSPSYCH', 'HAS_QUALTRICS', 'HAS_LABJS', 'CH_FILE'];

export function setBuild(flags) {
  const saved = {};
  for (const n of NAMES) saved[n] = globalThis[n];
  Object.assign(globalThis, flags);
  return () => { Object.assign(globalThis, saved); };
}

export function buildOf(file) {
  const target = ONE_LINE_TARGETS.find((t) => t.file === file);
  if (!target) throw new Error('build-targets.js has no target ' + file);
  const d = defineFor(target);
  return { HAS_JSPSYCH: d.HAS_JSPSYCH === 'true', HAS_QUALTRICS: d.HAS_QUALTRICS === 'true', HAS_LABJS: d.HAS_LABJS === 'true', CH_FILE: JSON.parse(d.CH_FILE) };
}
