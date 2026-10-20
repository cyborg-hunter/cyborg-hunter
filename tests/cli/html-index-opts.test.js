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

// The in-page report stacks both charts in one Session timeline block, with
// the hover numbers the script reads; DEMO-FIXT's trials carry start times.
test('the in-page report stacks both charts in one block with its hover numbers', async () => {
  const html = await renderIndexHtml(summaries, triage, [p], config, false, {
    imageSources: { [PID]: { typingProfile: 'data:image/png;base64,AAA1', sessionTimeline: 'data:image/png;base64,AAA2', trajectories: null } },
  });
  const stage = html.match(/<div class="tl-stage" data-timeline="([^"]*)">([\s\S]*?)<\/div>/);
  assert.ok(stage, 'one stage with its numbers');
  assert.deepEqual([...stage[2].matchAll(/src="([^"]+)"/g)].map((m) => m[1]), ['data:image/png;base64,AAA1', 'data:image/png;base64,AAA2']);
  const data = JSON.parse(stage[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  assert.deepEqual([data.w, data.left, data.chart], [1000, 90, 880]);
  assert.equal(data.trials.length, p.trials.length);
  assert.ok(html.includes('class="tl-enlarge"'));
  assert.ok(!html.includes('<h4 class="section-heading">Typing profile</h4>'), 'no separate typing block when the charts align');
});

test('trials without start times: the typing profile keeps its own block and the timeline block says why', async () => {
  const old = structuredClone(p);
  for (const t of old.trials) delete t.startTime;
  const html = await renderIndexHtml(summaries, triage, [old], config, true, {});
  assert.ok(html.includes('<h4 class="section-heading">Typing profile</h4>'));
  assert.match(html, /<div class="tl-stage"[^>]*>\s*<img src="images\/session_timeline_[^"]+"/);
  assert.ok(html.includes('class="muted note tl-note"'));
});

// Every trial carries its times, but they span no time (the session's own
// times do not parse and every trial starts and ends at 0): the charts do
// not align and no timeline is drawn, yet nothing is missing from the data,
// so the note, which says the times are missing, is not written.
test('timed trials on a domain of no length: no note that the times are missing, and no error', async () => {
  const z = { participantId: 'Z-0', session: {}, metadata: { startTime: 'not a time', endTime: 'not a time' },
    trials: [{ trialId: 'a', startTime: 0, duration_ms: 0, charsPerSec: 5 }, { trialId: 'b', startTime: 0, duration_ms: 0, charsPerSec: 6 }] };
  const zs = computeSummary([z], config);
  const html = await renderIndexHtml(zs, rankTriage(zs, detectEdgeExits([z], config), config), [z], config, true, {});
  assert.ok(html.includes('<h4 class="section-heading">Typing profile</h4>'), 'the typing chart is one bar per trial, in its own block');
  assert.ok(!html.includes('class="muted note tl-note"'), 'no note');
});

// The in-page report knows which charts were drawn: when the typing chart
// failed to draw (its entry is null), there is no typing profile above for
// the note to point at, although the trials have rates.
test('in the in-page report, the note shows only when the typing chart was drawn', async () => {
  const old = structuredClone(p);
  for (const t of old.trials) delete t.startTime;
  const TL = 'data:image/png;base64,AAA2';
  const drawn = await renderIndexHtml(summaries, triage, [old], config, false, {
    imageSources: { [PID]: { typingProfile: 'data:image/png;base64,AAA1', sessionTimeline: TL, trajectories: null } } });
  assert.ok(drawn.includes('<h4 class="section-heading">Typing profile</h4>'));
  assert.ok(drawn.includes('class="muted note tl-note"'));
  const failed = await renderIndexHtml(summaries, triage, [old], config, false, {
    imageSources: { [PID]: { typingProfile: null, sessionTimeline: TL, trajectories: null } } });
  assert.ok(!failed.includes('<h4 class="section-heading">Typing profile</h4>'));
  assert.match(failed, /<div class="tl-stage"[^>]*>\s*<img src="data:image\/png;base64,AAA2"/);
  assert.ok(!failed.includes('class="muted note tl-note"'), 'no note pointing at a chart that is not there');
});

// The note points at the typing profile above it: a session whose trials
// have no rate and no paste gets no typing chart (typing-profile-core.js),
// so there is nothing above for the note to point at.
test('trials without start times and with no typing chart: no note', async () => {
  const old = structuredClone(p);
  for (const t of old.trials) { delete t.startTime; delete t.charsPerSec; delete t.pasteEvents; }
  const html = await renderIndexHtml(summaries, triage, [old], config, true, {});
  assert.match(html, /<div class="tl-stage"[^>]*>\s*<img src="images\/session_timeline_[^"]+"/);
  assert.ok(!html.includes('class="muted note tl-note"'));
});
