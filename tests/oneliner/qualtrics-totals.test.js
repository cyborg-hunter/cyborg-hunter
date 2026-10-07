// tests/oneliner/qualtrics-totals.test.js
// A Qualtrics payload reduced to fit the embedded-data cap still reports the
// whole session. ch.js runs under happy-dom with the fake SurveyEngine
// (support/fake-qualtrics.js), a session goes over the cap, and the CLI's
// tier, triage score, reason and counts from the payload ch.js wrote equal
// those from the full session it summarizes (the vanilla blob). Three
// sessions reach the reduced levels: few pages with many tab-aways, a long
// survey with a few events per page, and a long survey with heavy switching.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { fakeSurveyEngine } from './support/fake-qualtrics.js';
import { MAX_CHARS, STORED_FIELD } from '../../src/oneliner/adapters/qualtrics.js';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';

class StubResizeObserver { observe() {} disconnect() {} }
let win, boot, clock, orig, ctx;

beforeEach(async () => {
  win = new Window({ url: 'https://survey.example/jfe/form/SV_test' });
  global.window = win; global.document = win.document; global.Node = win.Node;
  global.MutationObserver = win.MutationObserver; global.ResizeObserver = StubResizeObserver;
  ({ boot } = await import('../../src/oneliner/boot.js'));
  clock = 1000;
  Object.defineProperty(performance, 'now', { value: () => clock, configurable: true });
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.warn = () => {}; console.info = () => {};
  ctx = null;
});

afterEach(() => {
  if (ctx) {
    ctx.qualtrics.teardown();
    ctx.vanilla.teardown();
    try { ctx.monitor.destroy(); } catch { /* already destroyed */ }
  }
  delete performance.now;
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  win.close();
  delete global.window; delete global.document; delete global.Node; delete global.MutationObserver; delete global.ResizeObserver;
});

const tick = () => new Promise((r) => setTimeout(r, 2));

function paste(text) {
  const ta = win.document.createElement('textarea');
  win.document.body.appendChild(ta);
  ta.focus();
  const ev = new win.Event('paste', { bubbles: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
  ta.dispatchEvent(ev);
}

function tabAway(ms) {
  win.dispatchEvent(new win.Event('blur'));
  clock += ms;
  win.dispatchEvent(new win.Event('focus'));
  clock += 50;
}

// pages pages, each with `away` tab-aways (every third 12 s, the others 4 s)
// and one paste, each page submitted and the header run again for the next.
// → { payload, bytes, full }: what ch.js wrote at the last submit, and the
// vanilla blob it was built from.
async function survey(pages, away) {
  const fake = fakeSurveyEngine();
  win.Qualtrics = { SurveyEngine: fake.SE };
  ctx = fake.runHeader(() => boot({ script: { dataset: { participantId: 'P1', guards: 'none' }, src: 'https://cdn/x/ch.js' }, win }));
  for (let p = 0; p < pages; p++) {
    for (let i = 0; i < away; i++) tabAway(i % 3 === 0 ? 12000 : 4000);
    paste('pasted text');
    fake.submit('next');
    await tick();
    if (p < pages - 1) fake.rerunHeader(win, null);
  }
  const json = fake.store[STORED_FIELD];
  return { payload: JSON.parse(json), bytes: Buffer.byteLength(json, 'utf8'), full: ctx.vanilla.blob() };
}

// What the report shows for one participant file: the tier, the triage
// score and reason, and every count in the summary.
const COUNTS = ['trialCount', 'totalSoftScore', 'totalTabAways', 'tabAwayFlickerCount', 'tabAwayMediumCount', 'tabAwayLongCount', 'totalTabAwayDuration_ms',
  'tabAwayCutoffMs', 'trialsWithTabAway', 'trialsWithFastTyping', 'totalIdleGaps', 'totalSyntheticInsertions',
  'totalForeignInputEvents', 'sidebarEventCount', 'keyboardShortcutCount', 'layoutShiftCount', 'zoomChangeCount',
  'extensionInjectionCount', 'devToolsEventCount', 'totalPasteEvents', 'totalCopyEvents', 'totalDropEvents',
  'authoritativeSoftScore', 'softScoreThreshold'];
function report(raw) {
  const participants = [extractIntegrityData(JSON.parse(JSON.stringify(raw)), {})];
  const [row] = rankTriage(computeSummary(participants, {}), detectEdgeExits(participants, {}), {});
  const out = { tier: row.hardTriggered ? 'hard' : row.softFlagged ? 'soft' : 'clean', score: row.score, reason: row.reason };
  for (const k of COUNTS) out[k] = row.summary[k];
  return out;
}

describe('a reduced Qualtrics payload reports the whole session', () => {
  it('3 pages, 40 tab-aways and a paste on each: the report equals the full session\'s', async () => {
    const { payload, bytes, full } = await survey(3, 40);
    assert.ok(payload.cyborgHunterOneLiner.truncated.level >= 1, 'reduced');
    assert.ok(bytes <= MAX_CHARS, bytes + ' bytes');
    const truth = report(full);
    assert.deepStrictEqual([truth.totalTabAways, truth.tabAwayLongCount, truth.totalPasteEvents, truth.tier], [120, 42, 3, 'hard']);
    assert.deepStrictEqual(report(payload), truth);
  });

  it('20 pages, 2 tab-aways and a paste on each (level 3): the report equals the full session\'s', async () => {
    const { payload, bytes, full } = await survey(20, 2);
    assert.strictEqual(payload.cyborgHunterOneLiner.truncated.level, 3);
    assert.ok(bytes <= MAX_CHARS, bytes + ' bytes');
    const truth = report(full);
    assert.deepStrictEqual([truth.totalTabAways, truth.totalTabAwayDuration_ms, truth.totalPasteEvents], [40, 320000, 20]);
    assert.deepStrictEqual(report(payload), truth);
  });

  it('20 pages, 100 tab-aways and a paste on each (level 4): the report equals the full session\'s', async () => {
    const { payload, bytes, full } = await survey(20, 100);
    assert.strictEqual(payload.cyborgHunterOneLiner.truncated.level, 4);
    assert.ok(bytes <= MAX_CHARS, bytes + ' bytes');
    const truth = report(full);
    assert.deepStrictEqual([truth.totalTabAways, truth.tabAwayLongCount, truth.tabAwayMediumCount], [2000, 680, 1320]);
    assert.deepStrictEqual(report(payload), truth);
  });
});
