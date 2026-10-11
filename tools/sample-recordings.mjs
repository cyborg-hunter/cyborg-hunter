// tools/sample-recordings.mjs
// The bundled dataset's replay recordings, by file name: `DEMO-<id>.replay.json`
// beside the trackers in examples/demo-sessions/data/. The analyze bundle
// bakes the names (the page fetches the files on the site); the site
// assembler copies the files to analyze/sample/.
import { readdirSync } from 'node:fs';

export function sampleRecordingNames(dataDir) {
  return readdirSync(dataDir).filter((f) => /\.replay\.json$/i.test(f)).sort();
}
