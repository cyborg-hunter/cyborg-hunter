// tests/cli/html-index-core.test.js
// Pins the pure render core: string return, injectable assets, no Node imports.
// The default fallback string is covered by tests/cli/html-index.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import { analyzeCursor } from '../../src/cli/analyzers/cursor.js';

describe('renderIndexHtml (pure core)', () => {
  it('returns an HTML string with the injected replay client', async () => {
    const html = await renderIndexHtml([], [], {}, { outputDir: '/unused', participantIdField: 'participantId' }, false,
      { replayClientSrc: '/*__MARKER__*/', visualsUnavailableNote: 'NOTE_MARKER' });
    assert.strictEqual(typeof html, 'string');
    assert.ok(html.length > 100);
    // With an empty triage array no detail panes render at all, so
    // NOTE_MARKER (only used inside renderDetail's visualsRendered=false
    // branch) has nowhere to appear — asserting it would test something
    // that isn't true. The replay client, by contrast, is embedded in the
    // page's trailing <script> block unconditionally, and the version
    // string always renders in the topbar meta line — both hold regardless
    // of triage content, so those are what we pin here.
    assert.ok(html.includes('/*__MARKER__*/'), 'injected replay client source appears');
    assert.ok(html.includes('v0.17.0'), 'version string appears in topbar meta');
  });
  it('renders the injected visualsUnavailableNote in a detail pane', async () => {
    // Unlike the empty-triage case above, a single triage row forces a detail
    // pane to render, and visualsRendered=false routes that pane through the
    // fallback branch where the injected note must appear.
    const triage = [{ participantId: 'p1', hardTriggered: false, softFlagged: false, score: 0, summary: {} }];
    const participants = [{ participantId: 'p1' }];
    const html = await renderIndexHtml([], triage, participants,
      { outputDir: '/unused', participantIdField: 'participantId' }, false,
      { replayClientSrc: '/*__MARKER__*/', visualsUnavailableNote: 'NOTE_MARKER' });
    assert.ok(html.includes('NOTE_MARKER'));
    assert.ok(html.includes('/*__MARKER__*/'));
  });
  it('offers the fetch-external-stylesheets checkbox only when the recording has href-only sheets', async () => {
    const triage = [{ participantId: 'p1', hardTriggered: false, softFlagged: false, score: 0, summary: {} }];
    const rec = (stylesheets) => ({
      schema_version: 2, recorder: { name: 'cyborg-hunter-replay', version: '0.7.5' }, participant_id: 'p1',
      viewport: { w: 1, h: 1, dpr: 1, scale: 1, offset_x: 0, offset_y: 0 }, stylesheets,
      stylesheet_events: [], viewport_changes: [], segments: [], extensions: { 'cyborg-hunter': { tier: 'dom' } },
    });
    const render = (stylesheets) => renderIndexHtml([], triage,
      [{ participantId: 'p1', replay: { recording: rec(stylesheets), file: 'p1-replay-1.json' } }],
      { outputDir: '/unused', participantIdField: 'participantId' }, false, { replayClientSrc: '' });
    const hrefOnly = await render([{ id: 1, kind: 'link', href: 'https://cdn.example/jspsych.css', css: null, media: null }]);
    assert.match(hrefOnly, /class="replay-fetch-css" checked/, 'checkbox, ticked by default');
    assert.match(hrefOnly, /fetch 1 external stylesheet from its origin/);
    const inlined = await render([{ id: 1, kind: 'link', href: 'https://cdn.example/jspsych.css', css: '.a{}', media: null }]);
    assert.doesNotMatch(inlined, /replay-fetch-css"/, 'nothing to fetch, nothing offered');
  });
  it('module source has no fs/path imports', () => {
    const src = readFileSync(new URL('../../src/cli/renderers/html-index-core.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from ['"](node:)?(fs|path)['"]/);
  });
});

// The cursor section's centered-clicks rows, from a real analysis of a
// desktop session of one trial (a short path, then a click), with or without
// a session recording.
describe('the cursor section: clicks at the exact centre of the control', () => {
  const mv = (x, y, t) => ({ x, y, cx: x, cy: y, t, type: 'move' });
  const session = (recording) => ({
    participantId: 'p1',
    trials: [{
      trialId: 'q1', startTime: 1000, duration_ms: 5000, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], libraryVersion: '0.16.0',
      mouseEvents: [mv(100, 100, 0), mv(150, 130, 50), mv(210, 150, 105), { ...mv(210, 150, 150), type: 'click', trusted: true, detail: 1, pointerType: 'mouse' }]
    }],
    session: { device: { maxTouchPoints: 0, coarsePointer: false, webdriver: false } },
    ...(recording ? { replay: { recording } } : {})
  });
  // Nine pointer clicks at the centre (150, 120) of a 100 × 40 button, each
  // pressed 80 ms before, in a v2 recording of one segment.
  const button = { x: 100, y: 100, w: 100, h: 40 };
  const centreClicks = Array.from({ length: 9 }, (_, i) => [
    { type: 'mouse.down', t: 920 + i * 2000, x: 150, y: 120 },
    { type: 'mouse.click', t: 1000 + i * 2000, x: 150, y: 120, anchor: { tag: 'button', rect: button } }
  ]).flat();
  const rec = (events) => ({ schema_version: 2, segments: [{ label: 'q1', events }] });
  // The rules table of the session's cursor section.
  const rulesOf = async (participant) => {
    const triage = [{ participantId: 'p1', hardTriggered: false, softFlagged: false, score: 0, summary: { cursorAnalysis: analyzeCursor([participant])[0] } }];
    const html = await renderIndexHtml([], triage, [participant],
      { outputDir: '/unused', participantIdField: 'participantId' }, false, { replayClientSrc: '' });
    return html.match(/<caption>rules and movement shape<\/caption>([\s\S]*?)<\/table>/)[1];
  };

  it('a recording gives the exact-centre row, then the near row, reported, not judged', async () => {
    const rules = await rulesOf(session(rec(centreClicks)));
    assert.match(rules, /clicks after a pointer jump<\/th>[\s\S]*<tr><th>clicks at the exact centre of the control<\/th><td>9 of 9 qualifying clicks \(q1\)<\/td><\/tr>\s*<tr><th>clicks within 5 px of the centre<\/th><td>9 of 9 <span class="muted">\(reported, not judged\)<\/span><\/td><\/tr>/);
  });
  it('a touch recording is not judged and has no near row', async () => {
    const rules = await rulesOf(session(rec([{ type: 'touch.start', t: 10 }, ...centreClicks])));
    assert.match(rules, /<tr><th>clicks at the exact centre of the control<\/th><td>not judged \(touch recording\)<\/td><\/tr>/);
    assert.doesNotMatch(rules, /clicks within 5 px/);
  });
  it('without a recording, the row says why and there is no near row', async () => {
    const rules = await rulesOf(session(null));
    assert.match(rules, /<tr><th>clicks at the exact centre of the control<\/th><td>no recording \(session replay off, or its file not found: see the replay section\)<\/td><\/tr>/);
    assert.doesNotMatch(rules, /clicks within 5 px/);
  });
});

// The software renderer's row in the browser-reported checks table, from a
// real analysis of a desktop session of one trial with the device object
// varied: absent, without the key (before 0.17), or with each value.
describe('the cursor section: browser draws without a graphics card', () => {
  const mv = (x, y, t) => ({ x, y, cx: x, cy: y, t, type: 'move' });
  const desktop = { maxTouchPoints: 0, coarsePointer: false, webdriver: false };
  const session = (device) => ({
    participantId: 'p1',
    trials: [{
      trialId: 'q1', startTime: 1000, duration_ms: 5000, pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], libraryVersion: '0.17.0',
      mouseEvents: [mv(100, 100, 0), mv(150, 130, 50), mv(210, 150, 105), { ...mv(210, 150, 150), type: 'click', trusted: true, detail: 1, pointerType: 'mouse' }]
    }],
    session: device === undefined ? {} : { device }
  });
  // The checks table of the session's cursor section.
  const checksOf = async (participant) => {
    const triage = [{ participantId: 'p1', hardTriggered: false, softFlagged: false, score: 0, summary: { cursorAnalysis: analyzeCursor([participant])[0] } }];
    const html = await renderIndexHtml([], triage, [participant],
      { outputDir: '/unused', participantIdField: 'participantId' }, false, { replayClientSrc: '' });
    return html.match(/<caption>browser-reported checks<\/caption>([\s\S]*?)<\/table>/)[1];
  };
  const row = (cls, text) => new RegExp(`<tr class="${cls}"><th>browser draws without a graphics card</th><td>${text}</td></tr>`);

  it('a software family reads yes with its name, right after the automation flag', async () => {
    const checks = await checksOf(session({ ...desktop, softwareRenderer: 'swiftshader' }));
    assert.match(checks, /automation flag set by the browser<\/th><td>no<\/td><\/tr>\s*<tr class="fired"><th>browser draws without a graphics card<\/th>/);
    assert.match(checks, row('fired', 'yes \\(swiftshader\\)'));
  });
  it('a graphics card reads no; no WebGL reads no WebGL', async () => {
    assert.match(await checksOf(session({ ...desktop, softwareRenderer: false })), row('', 'no'));
    assert.match(await checksOf(session({ ...desktop, softwareRenderer: 'none' })), row('', 'no WebGL'));
  });
  it('a device object without the key, or no device object, is data from before 0.17', async () => {
    assert.match(await checksOf(session(desktop)), row('', 'not recorded \\(library before 0\\.17\\)'));
    assert.match(await checksOf(session(undefined)), row('', 'not recorded \\(library before 0\\.17\\)'));
  });
  it('null, or a value the analyzer does not record, reads not checked with its three causes', async () => {
    for (const v of [null, 7]) {
      assert.match(await checksOf(session({ ...desktop, softwareRenderer: v })), row('', 'not checked \\(switch off, no answer, or the first page or trial ended before the read\\)'), String(v));
    }
  });
  it('the family name is escaped', async () => {
    const checks = await checksOf(session({ ...desktop, softwareRenderer: '<img src=x onerror="alert(1)">' }));
    assert.match(checks, row('fired', 'yes \\(&lt;img src=x onerror=&quot;alert\\(1\\)&quot;&gt;\\)'));
    assert.doesNotMatch(checks, /<img/);
  });
});
