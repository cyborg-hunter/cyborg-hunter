// tools/gen-analyze-load-fixture.mjs
// N dom-tier participants from the committed demo pair, for measuring how
// large a cohort the analyze page handles. Usage:
//   node tools/gen-analyze-load-fixture.mjs <N> <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [n, outDir] = process.argv.slice(2);
if (!n || !outDir) { console.error('usage: gen-analyze-load-fixture.mjs <N> <outDir>'); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const raw = readFileSync('tests/fixtures/demo/DEMO-FIXT.json', 'utf8');
const rec = readFileSync('tests/fixtures/demo/DEMO-FIXT-replay-1785352263344.json', 'utf8');
// Only the recording's own id is renamed: the id also appears in the
// captured page text, which stays as recorded.
const REC_ID = '"participant_id": "DEMO-FIXT"';
if (rec.split(REC_ID).length !== 2) { console.error('expected exactly one ' + REC_ID + ' in the demo recording'); process.exit(1); }
for (let i = 1; i <= Number(n); i++) {
  const pid = 'LOAD-' + String(i).padStart(4, '0');
  writeFileSync(join(outDir, pid + '.json'), raw.split('DEMO-FIXT').join(pid));
  writeFileSync(join(outDir, pid + '-replay-1785352263344.json'), rec.split(REC_ID).join('"participant_id": "' + pid + '"'));
}
writeFileSync(join(outDir, 'cyborg-hunter.config.json'), JSON.stringify({ filePattern: 'LOAD-*.json', participantIdField: 'participantId' }));
console.log('wrote ' + n + ' participants to ' + outDir);
