// demo/results.js
// Step 12's payoff: the full-fidelity in-browser report, built from the same
// pipeline the CLI runs (bundled as demo/preview-core.js — see
// src/cli/preview-entry.js) plus the demo-mode renderer opt from spec §7:
//   imageSources — visitor + two example participants' plots, drawn
//                  in-browser by demo/plot-adapter.js (data URIs)
// buildPayload assembles the SAME Shape-1 shape buildDownloadFile
// ('sessionData') in demo.js builds, from the same state fields.
//
// The report loads in a Blob-URL iframe, sandbox="allow-scripts" (opaque
// origin: scripts run, so the report's own row-click/legend JS works across
// the now-multiple participants, but it can't reach this page or storage,
// and any subresource it fetches is a cross-origin request — which is why
// its fonts are inlined, see loadFontFaceCss). Old blob URLs are revoked
// only AFTER the replacement loads (spec §7.3).
//
// The visitor's own session recording does NOT nest inside this report
// iframe (walkthrough item 12: nesting it there froze DOM-tier
// reconstruction at the first frame, since the report's opaque-origin
// sandbox blocks the replay viewer's inner same-origin frame). It instead
// renders in a separate same-origin viewer-host iframe, a sibling of this
// report iframe — see mountReplayHost/teardownReplayHost (replay-host.js),
// wired into buildResults below.
//
// Fallback to a CLI-instructions card on ANY failure — the pipeline erroring
// or exceeding PIPELINE_TIMEOUT_MS, OR the iframe itself firing `error` or
// never firing `load` within its own watchdog (report-frame.js) — so
// the payoff is never a blank screen or a silently broken frame.
//
// .results-mode (full-width) is toggled by demo.js's goTo(), not here — this
// module only owns the mount element goTo() hands it as `container`.
import { buildPayload } from './payload.js';
import { makePlotAdapter } from './plot-adapter.js';
import { FINISH_VARIANTS, REPLICATE } from './steps.js';
import { escHtml } from './util.js';
import { mountReplayHost, teardownReplayHost } from './replay-host.js';
import { swapIframe } from './report-frame.js';

// Re-exported so demo.js's goTo() can tear down the viewer-host iframe
// (item 12) through the SAME cached results.js import it already uses for
// buildResults — no separate lazy-load path needed.
export { teardownReplayHost };

var PIPELINE_TIMEOUT_MS = 8000;    // preview-core load + fetches + full pipeline run

// Pure: build the participant payload list + demo renderer opts. Visitor
// first (its detail pane is the one defaultVisible shows), examples appended
// after. Unit-tested in tests/demo/results-build.test.js.
export function assembleReportInputs(state, examples, replayModel) {
  var visitor = buildPayload({
    pid: state.participantId,
    trials: state.trialReports.map(function (r) { return { trialId: r.trialId, integrity: r }; }),
    sessionReport: state.sessionReport,
    violations: state.violations,
  });
  var payloads = [visitor].concat(examples || []);
  var inlineReplayModels = {};
  if (replayModel) inlineReplayModels[state.participantId] = replayModel;
  return { payloads: payloads, inlineReplayModels: inlineReplayModels };
}

// Picks the FINISH_VARIANTS branch: zeroLamp when no lamp ever lit this
// session, act2Skipped when Act 2 was skipped, otherwise the full walkthrough.
function pickVariant(state) {
  if (Object.keys(state.lampCounts).length === 0) return FINISH_VARIANTS.zeroLamp;
  if (state.act2Skipped) return FINISH_VARIANTS.act2Skipped;
  return FINISH_VARIANTS.full;
}

// tierHtml is omitted (undefined) in the build-failed path, where there's no
// computed tier to report truthfully. replayUnavailable appends an honest
// correction to the "Session replay panel below" bullet's claim when replay
// attach failed this session (state.replayUnavailable) — steps.js's copy
// stays untouched; this is the minimal adaptation needed.
function renderWalkthrough(variant, tierHtml, replayUnavailable) {
  var replayHint = replayUnavailable
    ? '<p class="hint">Replay recording wasn’t available in this browser this ' +
      'session, so there’s no replay panel below. Everything else in the ' +
      'report still reflects your real session.</p>'
    : '';
  return (
    '<div class="yourreport">' +
    '<h3>' + escHtml(variant.headline) + '</h3>' +
    '<p>' + escHtml(variant.body) + '</p>' +
    (tierHtml || '') +
    '<ul>' + variant.bullets.map(function (b) { return '<li>' + escHtml(b) + '</li>'; }).join('') + '</ul>' +
    replayHint +
    '</div>'
  );
}

function renderTierLine(t, manifest) {
  var label = t.hardTriggered ? 'hard' : (t.softFlagged ? 'soft' : 'clean');
  return (
    '<p>Your tier: <b class="t-' + label + '">' + label.toUpperCase() + '</b> · ' +
    escHtml(t.reason || '') +
    ' <span class="hint">(' + escHtml(manifest.preset || 'standard') + ' preset)</span></p>'
  );
}

function renderFallbackCard(version) {
  return (
    '<div class="task">' +
    '<p class="label">couldn’t build the report in this browser</p>' +
    '<p>The CLI builds the same report locally:</p>' +
    '<pre><code>' +
    REPLICATE.sections.filter(function (s) { return s.code; })
      .map(function (s) { return escHtml(s.code.replace('{{version}}', version)); }).join('\n') +
    '</code></pre>' +
    '</div>'
  );
}

async function fetchText(url) { var r = await fetch(url); if (!r.ok) throw new Error(url + ' → ' + r.status); return r.text(); }
async function fetchJson(url) { var r = await fetch(url); if (!r.ok) throw new Error(url + ' → ' + r.status); return r.json(); }

function identity(x) { return x; }

// One full pipeline run -> report HTML string + the triage it produced.
// configOverrides and transformPayloads both come from the playground;
// both absent means the base config/payloads (manifest defaults, real
// session data) untouched.
//
// transformPayloads is the seam the playground needs and the plain build didn't have: a config
// override alone can't flip a HARD tier (the analyzers trust data-carried
// fields — see demo/playground.js's recomputeSignals docblock), so the
// playground has to transform the PAYLOADS themselves, not just the config,
// before they reach the pipeline. Applied right after assembleReportInputs
// (which builds the visitor+examples payload list from `state`) and before
// extractIntegrityData, so every downstream step — summaries, triage,
// plots, the rendered HTML — sees the rewritten data.
export async function buildReportHtml(core, state, examples, replayModel, replayClientSrc, configOverrides, transformPayloads, fontFaceCss) {
  var config = Object.assign({ outputDir: '.', participantIdField: 'participantId' }, configOverrides || {});
  var inputs = assembleReportInputs(state, examples, replayModel);
  var payloads = (transformPayloads || identity)(inputs.payloads);
  var participants = payloads.map(function (p) { return core.extractIntegrityData(p, config); });
  var summaries = core.computeSummary(participants, config);
  var triage = core.rankTriage(summaries, core.detectEdgeExits(participants, config), config);
  // makePlotAdapter(core) wires the SAME cores the CLI draws with (core is
  // the dynamically-imported preview-core.js module, which re-exports them)
  // to the adapter's default DOM canvas factory — called with 3 args, no
  // injected createCanvas, per demo/plot-adapter.js's browser contract.
  var plotAdapter = makePlotAdapter(core);
  var imageSources = {};
  for (var i = 0; i < participants.length; i++) {
    var p = participants[i];
    var entry = triage.find(function (t) { return t.participantId === p.participantId; }) || {};
    imageSources[p.participantId] = await plotAdapter.renderPlotDataUris(p, entry, config);
  }
  // inlineReplayModels deliberately NOT forwarded (walkthrough item 12): the
  // report iframe is sandbox="allow-scripts" (opaque origin — see
  // swapIframe's docblock in report-frame.js), and the replay viewer's inner
  // reconstruction iframe needs same-origin contentDocument access that a
  // nested-sandbox intersection blocks, so DOM-tier reconstruction froze at
  // the first frame there. The demo instead builds the replay in its own
  // same-origin viewer-host iframe (see buildResults, below, and
  // replay-host.js) — a sibling of this report iframe, not nested inside
  // it. inputs.inlineReplayModels (still computed by assembleReportInputs,
  // above) stays unused here on purpose; the CLI's own report path keeps
  // nesting its replay the original way.
  //
  // replayShownExternally suppresses the report's per-participant "Session
  // replay" sections outright (all participants — the section has no job in
  // the demo once the real replay lives in the host iframe). Without it,
  // the visitor's pane would show the renderer's absent-state fallback
  // ("recording was not enabled"), which is false here: recording WAS
  // enabled, the replay just renders below the report instead of inside it.
  var html = await core.renderIndexHtml(summaries, triage, participants, config, false, {
    imageSources: imageSources,
    replayClientSrc: replayClientSrc,
    replayShownExternally: true,
    // The report's typefaces as base64 @font-face rules (loadFontFaceCss).
    fontFaceCss: fontFaceCss || '',
  });
  return { html: html, triage: triage };
}

// The report's typefaces for the in-browser report and the replay host.
// Fetched same-origin from the TOP document (assembled from
// src/cli/renderers/fonts/ by tools/assemble-demo-site.mjs) and inlined as
// base64, exactly as the CLI's report-fonts.js does: the report iframe is an
// opaque origin (sandbox="allow-scripts"), and font loads are CORS requests,
// so it could not load them by URL. Any failure returns '' and the report
// renders in each role's fallback stack.
export async function loadFontFaceCss(core, fetchImpl, base) {
  var get = fetchImpl || fetch;
  var dir = base || './assets/fonts/';
  try {
    var mres = await get(dir + 'FONTS_MANIFEST.json');
    if (!mres.ok) return '';
    var manifest = await mres.json();
    var b64 = {};
    for (var i = 0; i < manifest.files.length; i++) {
      var f = manifest.files[i];
      var r = await get(dir + f.path);
      if (!r.ok) return '';
      b64[f.path] = toBase64(new Uint8Array(await r.arrayBuffer()));
    }
    return core.fontFaceCss(manifest.files, function (p) { return b64[p]; });
  } catch (e) {
    console.warn('cyborg-hunter demo: report fonts unavailable', e);
    return '';
  }
}

// Bytes → base64 in chunks (String.fromCharCode on a whole font would blow
// the argument limit).
function toBase64(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// swapIframe (the Blob-URL report swap with its load watchdog) lives in
// report-frame.js, shared with the analyze page; re-exported here for the
// demo's existing importers.
export { swapIframe };

// Resolves the args for buildResults's very FIRST run() call: the
// caller-supplied `initial` (buildResults's optional 5th param — demo.js's
// persistence seam for state.scoringOverrides, walkthrough item 7) when
// present, else the untouched baseline every call before this seam existed
// used (null config, identity payloads). Without this, a step-11 weight
// edit would only ever reach a LATER playground rerun, never the report's
// first render. Exported so the decision is unit-testable without
// buildResults's DOM-dependent orchestration (iframe load, blob swap — see
// this file's top docblock).
export function resolveInitialRun(initial) {
  return {
    configOverrides: (initial && initial.configOverrides) || null,
    transformPayloads: initial ? initial.transformPayloads : undefined,
  };
}

// `initial` (5th, optional): { configOverrides, transformPayloads } to
// apply on the FIRST report build — same shape every later playground
// rerun already accepted via run(), just threaded to the first call too
// (see resolveInitialRun above). Omitted (or state.scoringOverrides never
// touched — see demo.js) preserves the exact prior behavior.
export function buildResults(container, state, manifest, hooks, initial) {
  if (!container) return;
  var version = (window.CyborgHunter && window.CyborgHunter.VERSION) || 'unknown';
  container.innerHTML = '<p class="hint" data-role="results-status">Building your report…</p>';

  var settled = false;
  // gaveUp is distinct from settled: settled stays true forever once the
  // FIRST run succeeds (playground reruns all happen with settled
  // already true) — gaveUp only ever becomes true if the pipeline watchdog
  // fires before that first run finishes, so a late-arriving first result
  // knows the DOM was already replaced by the fallback card and skips
  // touching it (see run(), below).
  var gaveUp = false;
  var timeoutId = setTimeout(function () { fail(); }, PIPELINE_TIMEOUT_MS);
  function fail(err) {
    if (settled) return;
    settled = true;
    gaveUp = true;
    clearTimeout(timeoutId);
    if (err) console.warn('cyborg-hunter demo: results build failed', err);
    container.innerHTML =
      renderWalkthrough(pickVariant(state), null, state.replayUnavailable) + renderFallbackCard(version);
  }

  (async function () {
    var core = await import('./preview-core.js');
    var examples = await fetchJson('./assets/example-participants.json').catch(function () { return []; });
    var replayClientSrc = await fetchText('./replay-viewer.client.js').catch(function () { return ''; });
    var fontFaceCss = await loadFontFaceCss(core);
    var replayModel = null;
    if (state.replayRecording && core.buildViewerModel) {
      try { replayModel = core.buildViewerModel(state.replayRecording); }
      catch (e) { console.warn('cyborg-hunter demo: viewer model build failed', e); }
    }

    // Back-reentry blob-URL orphan (known, accepted): each buildResults()
    // call creates a fresh closure with its own currentUrl starting at null,
    // so when the visitor navigates Back out of the results step and returns
    // (goTo() calls buildResults() again), the PRIOR invocation's last blob
    // URL is never revoked by the new one — it stays alive until document
    // unload reclaims it. Tab-lifetime-bounded (one orphaned report string
    // per re-entry); revisit with an explicit revoke handoff only if
    // re-entering results turns out to be a common path.
    var currentUrl = null;
    // Resolves once the swap's iframe actually loads; rejects on any swap
    // failure (error event or its own load watchdog). The FIRST call is what
    // buildResults awaits before declaring success below — a blob that never
    // loads falls back instead of silently "succeeding" with a broken frame.
    // transformPayloads: the playground's recomputeSignals pre-pass;
    // omitted on every call this file makes itself (the real session data,
    // untouched) and on any caller that doesn't pass one.
    function run(configOverrides, transformPayloads) {
      return buildReportHtml(core, state, examples, replayModel, replayClientSrc, configOverrides, transformPayloads, fontFaceCss).then(function (built) {
        if (gaveUp) return built; // pipeline watchdog already replaced the DOM; don't resurrect a report into it
        var t = built.triage.find(function (x) { return x.participantId === state.participantId; }) ||
          { hardTriggered: false, softFlagged: false, reason: 'no trials this session' };
        var walk = container.querySelector('[data-role="walkthrough"]');
        if (!walk) {
          container.innerHTML = '<div data-role="walkthrough"></div><div data-role="playground"></div>';
          walk = container.querySelector('[data-role="walkthrough"]');
        }
        walk.innerHTML = renderWalkthrough(pickVariant(state), renderTierLine(t, manifest), state.replayUnavailable);
        return new Promise(function (resolve, reject) {
          currentUrl = swapIframe(container, built.html, currentUrl,
            function onload() { resolve(built); },
            function onFail(err) { reject(err || new Error('report iframe failed to load')); });
        });
      });
    }

    var firstRun = resolveInitialRun(initial);
    await run(firstRun.configOverrides, firstRun.transformPayloads);
    if (settled) return; // gaveUp === true: the watchdog already fired, nothing left to finish
    settled = true;
    clearTimeout(timeoutId);
    // Viewer-host iframe (item 12): built ONCE, here, after the first
    // successful report render — never inside run() itself, so a LATER
    // playground rerun (which only re-calls run()) never touches it. The
    // recording it shows doesn't change on a rerun, only the report does,
    // so the host stays mounted and untouched across every rerun. Skipped
    // entirely when there's no replayModel (state.replayRecording never
    // existed, or core.buildViewerModel threw, above) — the walkthrough's
    // existing replayUnavailable hint covers that case; no host is the
    // honest state, not a broken one.
    if (replayModel) mountReplayHost(container, replayModel, replayClientSrc,
      { replayCss: core.REPLAY_STYLES_CSS || '', fontFaceCss: fontFaceCss });
    if (hooks && hooks.onReady) {
      hooks.onReady({ rerun: run, container: container, manifest: manifest });
    }
  })().catch(fail);
}
