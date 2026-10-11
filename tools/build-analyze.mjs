// tools/build-analyze.mjs
// Builds the analyze page's one bundle, demo/analyze/analyze.bundle.js, in two
// esbuild passes. Pass 1 bundles the worker (worker-entry.js + the CLI cores +
// papaparse + fflate) to a string; pass 2 bundles the page (main.js) with that
// string as a virtual module, so the page creates its worker from a blob URL
// and never loads a second file. The replay viewer client, the report fonts
// and the bundled sessions (examples/demo-sessions) are baked in the same
// way: the page's policy forbids fetching them. platform 'browser' is the
// gate against a Node-only import creeping into a core.
// Run via `npm run demo:analyze`; ANALYZE_OUTDIR redirects the output (tests).
import esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readReplayClientSrc } from '../src/cli/renderers/replay-client-source.js';
import { buildFontFaceCss } from '../src/cli/renderers/report-fonts.js';
import { inlineSafeJson, inlineSrcHazards } from '../src/shared/inline-safe.js';

const OUT = process.env.ANALYZE_OUTDIR || 'demo/analyze';
const SAMPLE_DIR = 'examples/demo-sessions';

// The bundled sessions, minified (the committed files are pretty-printed, as
// the demo saves them), each under its own file name: the page lists them
// as files beside what the analyst dropped.
function sampleData() {
  const files = readdirSync(join(SAMPLE_DIR, 'data')).filter((f) => /\.json$/i.test(f)).sort()
    .map((f) => ({ path: f, text: JSON.stringify(JSON.parse(readFileSync(join(SAMPLE_DIR, 'data', f), 'utf8'))) }));
  files.push({ path: 'cyborg-hunter.config.json', text: readFileSync(join(SAMPLE_DIR, 'cyborg-hunter.config.json'), 'utf8') });
  return { files };
}

// Virtual modules: `import x from 'virtual:name'` resolves to a baked default
// export. esbuild re-prints every string literal it bundles (a `\u003c` escape
// comes out as a bare `<`), so a value is not written into the module itself:
// the module exports a placeholder string, and fill() swaps the value in as
// inlineSafeJson text after the build. Every `<` in a baked value stays
// escaped that way, which is what keeps the page bundle inlinable although the
// worker it carries holds the report's own <script> templates.
function virtual(modules) {
  const token = (name) => '__ch_baked_' + name.slice('virtual:'.length).replace(/[^A-Za-z0-9]/g, '_') + '__';
  return {
    plugin: {
      name: 'virtual',
      setup(build) {
        build.onResolve({ filter: /^virtual:/ }, (args) => ({ path: args.path, namespace: 'virtual' }));
        build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
          if (!(args.path in modules)) throw new Error('unknown virtual module ' + args.path);
          return { contents: 'export default ' + JSON.stringify(token(args.path)) + ';', loader: 'js' };
        });
      },
    },
    fill(text) {
      for (const name of Object.keys(modules)) text = text.split(JSON.stringify(token(name))).join(inlineSafeJson(modules[name]));
      if (text.includes('__ch_baked_')) throw new Error('a baked module placeholder was printed in an unexpected form');
      return text;
    },
  };
}

function sharedModules() {
  return {
    'virtual:replay-client-src': readReplayClientSrc(),
    'virtual:font-face-css': buildFontFaceCss(),
    'virtual:sample-data': sampleData(),
  };
}

// Pass 1 on its own: the worker's source, exactly as the page embeds it (the
// worker protocol test runs this same string).
export async function buildWorkerSrc(shared = sharedModules()) {
  const baked = virtual(shared);
  const worker = await esbuild.build({
    entryPoints: ['demo/analyze/worker-entry.js'], bundle: true, format: 'iife', platform: 'browser',
    write: false, logLevel: 'silent', plugins: [baked.plugin],
  });
  return baked.fill(worker.outputFiles[0].text);
}

export async function buildAnalyze() {
  const shared = sharedModules();
  const baked = virtual({ ...shared, 'virtual:worker-src': await buildWorkerSrc(shared) });
  const page = await esbuild.build({
    entryPoints: ['demo/analyze/main.js'], bundle: true, format: 'esm', platform: 'browser',
    write: false, logLevel: 'silent', plugins: [baked.plugin],
    banner: { js: '// cyborg-hunter analyze page bundle — https://github.com/cyborg-hunter/cyborg-hunter\n// Bundles fflate (MIT, https://github.com/101arrowz/fflate) and papaparse (MIT).' },
  });
  const bundle = baked.fill(page.outputFiles[0].text);
  // The offline single file inlines this bundle into a <script>; a sequence
  // that puts the HTML parser into script-data-escaped state would make that
  // file boot silently to nothing (src/shared/inline-safe.js).
  const hazards = inlineSrcHazards(bundle);
  if (hazards.length) throw new Error('analyze bundle cannot be inlined safely: it ' + hazards.join('; and it '));
  const outfile = join(OUT, 'analyze.bundle.js');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(outfile, bundle);
  console.log('Build complete: ' + outfile + ' (' + Math.round(Buffer.byteLength(bundle) / 1024) + ' KB)');
}

if (process.argv[1] && process.argv[1].endsWith('build-analyze.mjs')) {
  buildAnalyze().catch((e) => {
    console.error('demo:analyze build failed — likely a Node-only import reachable from a core, or an inline hazard:');
    console.error(e);
    process.exit(1);
  });
}
