// tests/cli/html-index-opts.test.js
// The opts the analyze page's in-page report passes (renderInPageHtml in
// report-core.js). Contract: ALL opts absent ⇒ byte-identical to the HTML
// snapshots (that test enforces it); each opt present ⇒ the specific
// emission below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'demo', 'DEMO-FIXT.json'), 'utf8'));
const config = { outputDir: '.', participantIdField: 'participantId' };
const p = extractIntegrityData(raw, config);
const summaries = computeSummary([p], config);
const triage = rankTriage(summaries, detectEdgeExits([p], config), config);
const PID = p.participantId;

test('imageSources swaps file paths for data URIs and shows those visuals', async () => {
  const html = await renderIndexHtml(summaries, triage, [p], config, false, {
    imageSources: { [PID]: {
      typingProfile: 'data:image/png;base64,AAA1',
      sessionTimeline: 'data:image/png;base64,AAA2',
      trajectories: 'data:image/png;base64,AAA3',
    } },
  });
  assert.ok(html.includes('data:image/png;base64,AAA2'));
  assert.ok(!html.includes('images/session_timeline_'));
});

test('imageSources with a missing plot omits that img entirely', async () => {
  const html = await renderIndexHtml(summaries, triage, [p], config, false, {
    imageSources: { [PID]: { sessionTimeline: 'data:image/png;base64,AAA2', typingProfile: null, trajectories: null } },
  });
  assert.ok(html.includes('data:image/png;base64,AAA2'));
  assert.ok(!html.includes('images/typing_profile_'));
});

// The report embeds no replay models: a replay loads from its own file
// (replay/<id>.replay.js) when the analyst asks for it, and the analyze page
// shows replays outside the report. An `inlineReplayModels` opt is not read.
test('an inlineReplayModels opt embeds nothing: the page is the default one', async () => {
  const model = { schemaVersion: 2, tier: 'dom', segments: [] };
  const html = await renderIndexHtml(summaries, triage, [p], config, false, {
    inlineReplayModels: { [PID]: model },
  });
  // The lazy loader reads window.__chReplay, which the replay file fills;
  // nothing in the page assigns it.
  assert.ok(!html.includes('window.__chReplay ='));
  assert.ok(!html.includes('data-replay-preloaded'));
  assert.ok(!html.includes('const preloaded'));
  assert.strictEqual(html, await renderIndexHtml(summaries, triage, [p], config, false, {}));
});

test('a triage row with no participant object renders without a replay section', async () => {
  // The participants array is caller-supplied, so a triage row can lack one;
  // the page still renders, with nothing said about a replay.
  const html = await renderIndexHtml(summaries, triage, [], config, false, {});
  assert.ok(html.includes('class="participant"'));
  assert.ok(!html.includes('Session replay'));
});

test('adversarial imageSources value cannot break out of the src/href attributes', async () => {
  const evil = 'data:image/png;base64,AAA2" onerror="alert(1)';
  const html = await renderIndexHtml(summaries, triage, [p], config, false, {
    imageSources: { [PID]: { sessionTimeline: evil, typingProfile: null, trajectories: null } },
  });
  assert.ok(!html.includes(evil), 'raw attribute-breakout string must not appear');
  assert.ok(html.includes('AAA2&quot; onerror=&quot;alert(1)'), 'quote escaped to &quot; in the emitted attribute');
});

test('replayShownExternally:true suppresses the replay section entirely; absent/false renders it as before', async () => {
  // Suppressed: no replay-block ELEMENT, no section heading, and no
  // absent-state fallback message (the demo shows the replay in its own
  // sibling viewer-host iframe — a "not enabled" message here would be
  // false). The bare 'replay-block' substring can't be asserted on: the
  // report's static lazy-loader script always contains
  // btn.closest('.replay-block') regardless of whether any section renders.
  const suppressed = await renderIndexHtml(summaries, triage, [p], config, false, {
    replayShownExternally: true,
  });
  assert.ok(!suppressed.includes('class="image-block replay-block"'));
  assert.ok(!suppressed.includes('Session replay'));
  assert.ok(!suppressed.includes('recording was not enabled'));

  // Guard the other direction — absent AND explicit false both render the
  // section exactly as the default path always has (the fixture has no
  // replay artifact, so that's the absent-state block + fallback message).
  for (const opts of [{}, { replayShownExternally: false }]) {
    const rendered = await renderIndexHtml(summaries, triage, [p], config, false, opts);
    assert.ok(rendered.includes('class="image-block replay-block"'));
    assert.ok(rendered.includes('Session replay'));
    assert.ok(rendered.includes('recording was not enabled'));
  }
});

test('the in-page report (imageSources) guards history.replaceState; default does not', async () => {
  const inPage = await renderIndexHtml(summaries, triage, [p], config, false,
    { imageSources: { [PID]: {} } });
  assert.ok(/try\s*\{[^}]*history\.replaceState/.test(inPage));
  const plain = await renderIndexHtml(summaries, triage, [p], config, false, {});
  assert.ok(!/try\s*\{[^}]*history\.replaceState/.test(plain));
  // The bare call must still be present on the default path — the guard is
  // additive in the in-page report, not a replacement for the underlying call.
  assert.ok(plain.includes("history.replaceState(null, '', `#p-${sanitized}`);"));
});
