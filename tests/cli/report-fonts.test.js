// tests/cli/report-fonts.test.js
// The report's embedded fonts: committed WOFF2 bytes match their manifest,
// every family ships its OFL licence, and report-fonts.js turns them into one
// @font-face block of base64 data URIs.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildFontFaceCss, FONTS_DIR } from '../../src/cli/renderers/report-fonts.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', 'src', 'cli', 'renderers', 'fonts');
const manifest = JSON.parse(readFileSync(join(dir, 'FONTS_MANIFEST.json'), 'utf8'));

const FAMILIES = ['Space Grotesk', 'Tomorrow', 'Sofia Sans', 'Sora', 'Recursive', 'Major Mono Display'];

describe('report fonts: assets', () => {
  it('the manifest lists exactly the six picked families', () => {
    assert.deepEqual([...new Set(manifest.files.map(f => f.family))].sort(), [...FAMILIES].sort());
  });

  it('every manifest file exists with the recorded size and sha256', () => {
    for (const f of manifest.files) {
      const bytes = readFileSync(join(dir, f.path));
      assert.equal(bytes.length, f.bytes, f.path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256, f.path);
    }
  });

  it('every family directory ships its OFL licence', () => {
    for (const slug of new Set(manifest.files.map(f => f.path.split('/')[0]))) {
      const lic = join(dir, slug, 'OFL.txt');
      assert.ok(existsSync(lic), lic);
      assert.match(readFileSync(lic, 'utf8'), /SIL OPEN FONT LICENSE/i, lic);
    }
  });

  it('FONTS_DIR points at the committed fonts directory', () => {
    assert.equal(FONTS_DIR, dir);
  });
});

describe('report fonts: @font-face CSS', () => {
  const css = buildFontFaceCss();

  it('emits one @font-face per file, with its family, weight and woff2 data URI', () => {
    assert.equal((css.match(/@font-face/g) || []).length, manifest.files.length);
    for (const f of manifest.files) {
      const b64 = readFileSync(join(dir, f.path)).toString('base64');
      assert.ok(css.includes(`font-family: "${f.family}"`), f.family);
      assert.ok(css.includes(`font-weight: ${f.weight}`), `${f.family} ${f.weight}`);
      assert.ok(css.includes(`url(data:font/woff2;base64,${b64}) format("woff2")`), f.path);
    }
  });

  it('uses font-display: block, so a face never swaps in after a fallback flash', () => {
    assert.equal((css.match(/font-display: block/g) || []).length, manifest.files.length);
  });

  it('stays within the 240 KB per-report budget', () => {
    assert.ok(css.length <= 240 * 1024, `${css.length} bytes`);
  });
});

describe('report fonts: the shared pure formatter', () => {
  it('fontFaceCss formats manifest files the same way the CLI does', async () => {
    const { fontFaceCss } = await import('../../src/cli/renderers/font-face-css.js');
    const b64 = Object.fromEntries(manifest.files.map(f => [f.path, readFileSync(join(dir, f.path)).toString('base64')]));
    assert.equal(fontFaceCss(manifest.files, p => b64[p]), buildFontFaceCss());
  });

  it('formats a face with font-display: block and its weight range', async () => {
    const { fontFaceCss } = await import('../../src/cli/renderers/font-face-css.js');
    const css = fontFaceCss([{ family: 'Sora', weight: '100 800', path: 'x' }], () => 'AAAA');
    assert.match(css, /font-display: block/);
    assert.match(css, /font-weight: 100 800/);
  });
});

describe('report fonts: plumbing into index.html', () => {
  const tiny = () => {
    const s = { participantId: 'P1', trialCount: 0, totalPasteEvents: 0, totalCopyEvents: 0, hardTriggered: false,
      totalSoftScore: 0, authoritativeSoftScore: null, sidebarEventCount: 0, aiExtensionsFound: [], metadata: {} };
    return {
      summaries: [s],
      triage: [{ participantId: 'P1', score: 0, terms: [], reason: 'clean', hardTriggered: false, softFlagged: false, summary: s, edgeExitCount: 0 }],
      participants: [{ participantId: 'P1', trials: [], session: {} }],
    };
  };

  // buildReport with the fontFaceCss report.js hands it; analyze-parity.test.js
  // pins the CLI's index.html byte-equal to this same call.
  it('the CLI report (buildReport) embeds the @font-face block once, inside the first <style>', async () => {
    const { buildReport } = await import('../../src/cli/report-core.js');
    const { mergeConfig } = await import('../../src/cli/config-core.js');
    const files = new Map();
    const { config } = mergeConfig({});
    await buildReport(tiny().participants, config, { sink: (path, data) => files.set(path, data), fontFaceCss: buildFontFaceCss() });
    const html = files.get('index.html');
    const fontCss = buildFontFaceCss();
    assert.equal(html.split(fontCss).length - 1, 1, 'embedded exactly once');
    const firstStyle = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.ok(firstStyle.includes(fontCss), 'inside the report <style>');
  });

  it('renderIndexHtml without opts.fontFaceCss emits no @font-face (demo and snapshot path)', async () => {
    const { renderIndexHtml } = await import('../../src/cli/renderers/html-index-core.js');
    const { summaries, triage, participants } = tiny();
    const html = await renderIndexHtml(summaries, triage, participants, { outputDir: '.' }, false);
    assert.doesNotMatch(html, /@font-face/);
  });
});
