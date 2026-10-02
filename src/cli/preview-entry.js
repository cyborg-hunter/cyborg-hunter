// src/cli/preview-entry.js
// Browser-preview surface (0.7.2): the pure subset of the CLI pipeline the
// in-browser results screen (demo/results.js) needs to run the same
// ingest → analyze → render steps the real CLI runs, without any Node APIs.
// Bundled by tools/build-preview-core.mjs into demo/preview-core.js (esbuild,
// platform: browser) — every re-export below must resolve to a module with
// no fs/path/zlib/papaparse imports, or the bundle step fails with an
// unresolved-import error (the empirical gate the 0.7.2 scope relies on).
//
// extractIntegrityData is NOT re-exported from src/cli/ingest.js here even
// though that's its public home — ingest.js imports Node's `fs`/`zlib` at
// module scope for the file-discovery/CSV/replay-artifact machinery that
// surrounds it, so bundling ingest.js itself pulls those in. extract-core.js
// is the pure extraction the ingest.js module re-exports from (0.7.2), and
// is what this entry point bundles instead.

export { renderIndexHtml } from './renderers/html-index-core.js';
// The replay viewer's CSS, shared with the demo's replay-host iframe so it
// no longer keeps its own hand-synced copy (results.js passes it down).
export { REPLAY_STYLES_CSS } from './renderers/replay-styles.js';
// The pure @font-face formatter: the demo fetches the report's WOFF2 files
// and formats them exactly as the CLI's report-fonts.js does.
export { fontFaceCss } from './renderers/font-face-css.js';
export { computeSummary } from './analyzers/summary.js';
export { detectEdgeExits } from './analyzers/edge-exit.js';
export { rankTriage } from './analyzers/triage.js';
export { extractIntegrityData } from './extract-core.js';
// buildViewerModel: pure wire->viewer conversion (src/replay/viewer-model.js,
// see that file's docblock) — the demo's results build needs it to construct
// the visitor's replay viewer-model in-browser (demo/results.js) without
// re-implementing the time-conversion logic. No Node APIs, so it bundles
// cleanly here.
export { buildViewerModel } from '../replay/viewer-model.js';

// The three pure plot cores (0.7.2-style extraction — see each file's own
// docblock): drawSessionTimeline, drawTrajectoryGrid, drawTypingProfile.
// Each takes an injected createCanvas factory instead of importing the
// `canvas` package directly, so they bundle cleanly here too. Consumed by
// demo/plot-adapter.js to render the visitor's own plots in-browser.
export { drawSessionTimeline } from './renderers/session-timeline-core.js';
export { drawTrajectoryGrid } from './renderers/trajectories-core.js';
export { drawTypingProfile } from './renderers/typing-profile-core.js';

// The analyze page's worker bundles these; keeping them here keeps the
// platform-browser build the gate against a Node-only import creeping into a core.
export { ingestFiles, migrateArtifact, artifactKind, parseCsvToRaw } from './ingest-core.js';
export { mergeConfig } from './config-core.js';
export { buildReport, renderInPageHtml, REPORT_FILES } from './report-core.js';
export { buildAssetMap, applyAssetMap, assetMatchSummary, assetNoteText, collectAssetUrls, matchAssets, ASSET_EXTENSIONS } from './asset-match.js';
