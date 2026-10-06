// build-targets.js — the one-line files build.js writes, one per framework,
// all from src/oneliner/entry.js. `hosts` are the host adapters a file
// carries; every file also runs pages without a framework. Each file keeps
// the checks that recognise the other hosts, so a page that runs one of them
// logs one error naming the file to load instead (src/oneliner/boot.js).
// tests/oneliner/build.test.js builds and checks every file here, and the
// "Which file" table in docs/quickstart.md lists the same files.
export const ONE_LINE_TARGETS = [
  { file: 'ch.js', hosts: ['jspsych'] },
  { file: 'ch-qualtrics.js', hosts: ['qualtrics'] },
  { file: 'ch-labjs.js', hosts: ['labjs'] }
];

// esbuild's `define` for one target (src/oneliner/build-flags.js): each
// identifier becomes a literal, so the code a host flag guards is dropped
// from the files that do not carry that host.
export function defineFor(target) {
  return {
    HAS_JSPSYCH: String(target.hosts.includes('jspsych')),
    HAS_QUALTRICS: String(target.hosts.includes('qualtrics')),
    HAS_LABJS: String(target.hosts.includes('labjs')),
    CH_FILE: JSON.stringify(target.file)
  };
}
