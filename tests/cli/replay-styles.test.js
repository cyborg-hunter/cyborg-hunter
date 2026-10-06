// tests/cli/replay-styles.test.js
// The replay viewer's CSS lives in one module, shared by the CLI report and
// the demo's replay host. The report must carry it verbatim, and every token
// it references must be declared by the report's :root (a host document that
// reuses it must declare the same set).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { REPLAY_STYLES_CSS } from '../../src/cli/renderers/replay-styles.js';
import { reportCss, parseRules, rootVars } from './report-css-helpers.js';

describe('replay styles: one shared copy', () => {
  it('the report embeds REPLAY_STYLES_CSS verbatim', async () => {
    assert.ok((await reportCss()).includes(REPLAY_STYLES_CSS));
  });

  it('every var(--x) the replay rules use is declared in the report :root', async () => {
    const declared = rootVars(parseRules(await reportCss()));
    const used = [...new Set([...REPLAY_STYLES_CSS.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]))];
    assert.deepEqual(used.filter(v => !(v in declared)), []);
  });
});
