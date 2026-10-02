// tests/cli/report-shapes.test.js
// The shape picks from the 2026-09 report palette, read from the
// report's own CSS. Unchanged elements (severity colours, frame, tier dot,
// fields, tiles, score readout, bars' shape, lane, click markers) are pinned
// by the HTML snapshots instead.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { reportCss, parseRules, lastProp } from './report-css-helpers.js';

let rulesP = null;
const rules = () => (rulesP ??= reportCss().then(parseRules));

const EXPECT = [
  // Ground & neutrals: "High-contrast lines"
  [':root', '--ink', '#0f0f0f'], [':root', '--dim', '#4f4a40'], [':root', '--line', '#b9b2a2'],
  [':root', '--bg', '#fafafa'], [':root', '--surface', '#fff'],
  // Corner radius: 2px marks, 4px controls, 0 boxes (element picks override)
  ['.score-term .bar', 'border-radius', '2px'], ['.replay-key-chip', 'border-radius', '2px'],
  ['.tier-badge', 'border-radius', '0'], ['.tier-pill', 'border-radius', '0'], ['.replay-badge', 'border-radius', '0'],
  ['.topbar button', 'border-radius', '4px'], ['.search-wrap input', 'border-radius', '4px'],
  ['.sort-wrap select', 'border-radius', '4px'], ['.replay-segment-select', 'border-radius', '4px'],
  ['.replay-speed', 'border-radius', '4px'], ['.replay-load-btn', 'border-radius', '4px'], ['.replay-css-btn', 'border-radius', '4px'],
  ['.signal-tile', 'border-radius', '0'], ['.sig-cell', 'border-radius', '0'], ['.paste-preview', 'border-radius', '0'],
  ['.detail img', 'border-radius', '0'], ['.replay-stage', 'border-radius', '0'], ['.modal-card', 'border-radius', '0'],
  // Dividers: double rule under the page header
  ['.topbar', 'border-bottom', '3px double var(--ink)'], ['.detail-header', 'border-bottom', '1px solid var(--ink)'],
  // Shadows: soft, on cells and plots
  ['.sig-cell', 'box-shadow', '0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.05)'],
  ['.detail img', 'box-shadow', '0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.05)'],
  // Participant rows: selected = outline
  ['.cohort-row.selected', 'border-left', '0'], ['.cohort-row.selected', 'padding-left', '12px'],
  ['.cohort-row.selected', 'background', 'transparent'], ['.cohort-row.selected', 'box-shadow', 'inset 0 0 0 2px var(--ink)'],
  // Filter chips: segmented control at 15px, padding 4px 8px (Can, §8a)
  ['.filter-chips', 'gap', '0'], ['.filter-chip', 'border-radius', '0'], ['.filter-chip', 'margin-left', '-1px'],
  ['.filter-chip', 'padding', '4px 8px'], ['.filter-chip:first-child', 'border-radius', '4px 0 0 4px'],
  ['.filter-chip:first-child', 'margin-left', '0'], ['.filter-chip:last-child', 'border-radius', '0 4px 4px 0'],
  ['.filter-chip.active', 'position', 'relative'], ['.filter-chip.active', 'z-index', '1'],
  // Triage note & evidence: hairline box (the 3px left rule goes, §6a.4)
  ['.reason', 'background', 'var(--surface)'], ['.reason', 'border', '1px solid var(--line)'], ['.reason', 'border-radius', '4px'],
  ['.paste-preview', 'background', 'var(--surface)'], ['.paste-preview', 'border', '1px solid var(--line)'],
  // Playback: prominent round ink play, with its own hover (§6a.1)
  ['.replay-play', 'background', 'var(--ink)'], ['.replay-play', 'color', 'var(--surface)'],
  ['.replay-play', 'border-color', 'var(--ink)'], ['.replay-play', 'width', '36px'], ['.replay-play', 'height', '30px'],
  ['.replay-play', 'padding', '0'], ['.replay-play', 'border-radius', '50%'],
  ['.replay-play:hover', 'background', '#2b2b2b'],
  // Keycast chips: larger
  ['.replay-key-chip', 'padding', '3px 9px'],
];

describe('report shapes: the picked variants', () => {
  for (const [sel, prop, want] of EXPECT) {
    it(`${sel} { ${prop}: ${want} }`, async () => {
      assert.equal(lastProp(await rules(), sel, prop), want);
    });
  }
});

describe('report shapes: things that must not come back', () => {
  it('.reason has no left rule after its hairline box', async () => {
    const r = await rules();
    const idx = r.map((x, i) => (x.selectors.includes('.reason') && x.decls.border ? i : -1)).filter(i => i >= 0).pop();
    for (const later of r.slice(idx + 1)) {
      if (later.selectors.includes('.reason')) assert.equal(later.decls['border-left'], undefined);
    }
    assert.equal(r[idx].decls['border-left'], undefined, 'no border-left in the box rule itself');
  });

  it('the warm #f5f1e8 tint is gone from the report CSS', async () => {
    assert.doesNotMatch(await reportCss(), /#f5f1e8/i);
  });

  it('.replay-play is not in the shared light hover rule that would blank it', async () => {
    const shared = (await rules()).find(x => x.selectors.includes('.replay-load-btn:hover'));
    assert.ok(shared, 'shared hover rule still exists for the other buttons');
    assert.ok(!shared.selectors.includes('.replay-play:hover'));
  });
});
