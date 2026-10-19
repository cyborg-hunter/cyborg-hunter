// tests/cli/device-line.test.js
// The device line, first in the cursor section: graphics, the screen facts,
// the automation flag and the kind of pointer, in each of their states,
// built from the analyzers' own results. Red marks a software renderer or
// screen facts that contradict each other. Every row here is made up.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCursorForParticipant } from '../../src/cli/analyzers/cursor.js';
import { analyzeDeviceMasking } from '../../src/cli/analyzers/device-masking.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderDeviceLine, renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';

const config = { outputDir: '.', participantIdField: 'participantId' };
const desktop = { maxTouchPoints: 0, coarsePointer: false, webdriver: false };
// One window-log row that agrees with its screen.
const row = (over = {}) => ({ x: 0, y: 0, w: 1600, h: 1000, iw: 1600, ih: 900, sw: 1920, sh: 1080, dpr: 1, vvScale: 1, t: 0, ...over });
// A participant with no trials (the line needs no pointer stream), the given
// device object (undefined: none) and window rows.
const part = (device, rows = [row()]) => ({ participantId: 'P', trials: [], session: { ...(device === undefined ? {} : { device }), windowPositions: rows } });
const summaryOf = (p) => ({ cursorAnalysis: analyzeCursorForParticipant(p), deviceMasking: analyzeDeviceMasking(p) });
const line = (p) => renderDeviceLine(summaryOf(p), p);
const text = (html) => html.replace(/<[^>]+>/g, '');
const AGREE_OFF_MOUSE = ' · screen facts agree · automation flag off · mouse or trackpad';

describe('renderDeviceLine', () => {
  it('graphics: a software renderer in red, a graphics card, no WebGL, not checked, not recorded', () => {
    assert.match(line(part({ ...desktop, softwareRenderer: 'swiftshader' })),
      /^<p class="muted note device-line">device: <b class="device-flag">software renderer \(swiftshader\), as on cloud machines that run browser agents<\/b> · screen facts agree · /);
    assert.equal(text(line(part({ ...desktop, softwareRenderer: false }))), 'device: graphics card' + AGREE_OFF_MOUSE);
    assert.equal(text(line(part({ ...desktop, softwareRenderer: 'none' }))), 'device: no WebGL' + AGREE_OFF_MOUSE);
    assert.equal(text(line(part({ ...desktop, softwareRenderer: null }))), 'device: graphics card not checked (switch off, no answer, or the first page or trial ended before the read)' + AGREE_OFF_MOUSE);
    assert.equal(text(line(part(desktop))), 'device: graphics card not recorded (library before 0.17)' + AGREE_OFF_MOUSE);
  });
  it('a session recorded before 0.14 (no device object): the automation flag not recorded, no pointer', () => {
    assert.equal(text(line(part(undefined))), 'device: graphics card not recorded (library before 0.17) · screen facts agree · automation flag not recorded');
  });
  it('screen facts: a contradiction in red with its detail, or not recorded without a window log', () => {
    assert.match(line(part({ ...desktop, softwareRenderer: false }, [row({ dpr: 1.00000001 })])),
      /<b class="device-flag">screen facts contradict: pixel ratio 1\.00000001 \(a fingerprint-masking tool; not evidence of AI use\)<\/b>/);
    assert.equal(text(line(part({ ...desktop, softwareRenderer: false }, []))), 'device: graphics card · screen facts not recorded · automation flag off · mouse or trackpad');
  });
  it('the automation flag on, and a touch screen', () => {
    assert.equal(text(line(part({ maxTouchPoints: 5, coarsePointer: true, webdriver: true, softwareRenderer: false }))),
      'device: graphics card · screen facts agree · automation flag on · touch screen');
  });
  it('a pointer the browser did not describe is left out', () => {
    assert.equal(text(line(part({ maxTouchPoints: 0, coarsePointer: null, webdriver: false, softwareRenderer: false }))),
      'device: graphics card · screen facts agree · automation flag off');
  });
  it('escapes what the data says', () => {
    const html = line(part({ ...desktop, softwareRenderer: '<img src=x onerror=alert(1)>' }));
    assert.ok(html.includes('software renderer (&lt;img src=x onerror=alert(1)&gt;)'));
    assert.ok(!html.includes('<img'));
  });
  it('is the first line inside the cursor section, above the verdict', async () => {
    const p = part({ ...desktop, softwareRenderer: 'swiftshader' });
    const summaries = computeSummary([p], config);
    Object.assign(summaries[0], summaryOf(p));
    const triage = rankTriage(summaries, detectEdgeExits([p], config), config);
    const html = await renderIndexHtml(summaries, triage, [p], config, false);
    assert.ok(html.includes('<h4 class="section-heading">Cursor dynamics</h4><p class="muted note device-line">device: '));
    assert.ok(html.indexOf('class="muted note device-line"') < html.indexOf('class="cursor-verdict"'));
  });
});
