// build-targets.js — the one-line files build.js writes, one per framework,
// all from src/oneliner/entry.js. `hosts` are the host adapters a file
// carries; every file also runs pages without a framework. Each file keeps
// the checks that recognise the other hosts, so a page that runs one of them
// logs one error naming the file to load instead (src/oneliner/boot.js).
// tests/oneliner/build.test.js builds and checks every file here, and the
// "Which file" table in docs/quickstart.md lists the same files.
// `replay`: the file bundles the session recorder and records by default
// (data-replay="off" turns it off). Not ch-qualtrics.js: a survey field holds
// about 20 KB, so a recording there is never kept, and replay on a survey
// stays opt-in with the recorder loaded as its own script.
export const ONE_LINE_TARGETS = [
  { file: 'ch.js', hosts: ['jspsych'], replay: true },
  { file: 'ch-qualtrics.js', hosts: ['qualtrics'], replay: false },
  { file: 'ch-labjs.js', hosts: ['labjs'], replay: true }
];

// esbuild's `define` for one target (src/oneliner/build-flags.js): each
// identifier becomes a literal, so the code a host flag guards is dropped
// from the files that do not carry that host.
export function defineFor(target) {
  return {
    HAS_JSPSYCH: String(target.hosts.includes('jspsych')),
    HAS_QUALTRICS: String(target.hosts.includes('qualtrics')),
    HAS_LABJS: String(target.hosts.includes('labjs')),
    REPLAY_BUNDLED: String(!!target.replay),
    CH_FILE: JSON.stringify(target.file)
  };
}
