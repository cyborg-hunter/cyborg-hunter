// run-meta.js
//
// Shared canonical run identifier for a bench session.
//
// Why this module exists: both CH (which threads runId through `participantId`)
// and the Roundtable wrapper (which threads it through `data-tags` and
// `data-user-id`) need to agree on a *single* identifier per run. An earlier
// draft had each side call `Date.now()` independently, which would have
// produced two different IDs and broken cross-source joins downstream. This
// module centralizes ID resolution so both sides read the same value.
//
// Resolution order:
//   1. If the URL has `?runId=...`, use it verbatim (lets the harness pin a
//      specific ID — e.g. for replay or for a scripted multi-tab run).
//   2. Otherwise synthesize `${scenario}--${guards}--${ts}`, where `ts` is
//      an ISO timestamp with `:` and `.` replaced by `-` so the result is
//      filesystem-safe. The double-hyphen separator is intentional: ISO
//      timestamps already contain single hyphens (`2026-05-13T...`), so we
//      need a separator that doesn't collide with them.
//
// Testability: the three exported helpers all accept a `search` string with a
// default that reads `window.location.search` only when `window` exists. This
// matches the dependency-injection pattern in `bench/pipeline/check-vendor.js`
// and keeps tests fully synchronous and globals-free under `node --test`.

function defaultSearch() {
  return typeof window !== 'undefined' && window.location
    ? window.location.search
    : '';
}

/**
 * Resolve the canonical runId for this session.
 *
 * @param {string} [search]  URL query string (defaults to window.location.search).
 * @returns {string}
 */
export function getOrMakeRunId(search = defaultSearch()) {
  const params = new URLSearchParams(search);
  const fromUrl = params.get('runId');
  if (fromUrl) return fromUrl;
  const scenario = params.get('scenario') || 'unspecified';
  // Via the resolver, so `?demo=replay` (which forces guards off) is reflected
  // in the ID rather than the raw param the run didn't honour.
  const guardConfig = getGuardConfigFromUrl(search);
  // ISO timestamp with `:` and `.` replaced — both are problematic in
  // filenames on at least one mainstream OS, and the resulting string is
  // still trivially sortable lexicographically.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${scenario}--${guardConfig}--${ts}`;
}

/**
 * Read the `scenario` URL param, defaulting to `'unspecified'`.
 *
 * @param {string} [search]
 * @returns {string}
 */
export function getScenarioFromUrl(search = defaultSearch()) {
  const params = new URLSearchParams(search);
  return params.get('scenario') || 'unspecified';
}

/**
 * Read the `demo` URL param. Returns `true` ONLY when the value is exactly
 * `'replay'`.
 *
 * Why this exists: `?demo=replay` is the one-URL preset for the session-replay
 * demo we hand to jsPsych. It means "no guards, no Roundtable, no microphone
 * trial" — the upstream replay-test timeline recorded by cyborg-hunter and
 * nothing else. Each of those three effects is applied by the module that owns
 * it (guards here, Roundtable in index.html, the mic trial in trial-filter.js),
 * so this stays a single boolean read.
 *
 * @param {string} [search]
 * @returns {boolean}
 */
export function isReplayDemo(search = defaultSearch()) {
  const params = new URLSearchParams(search);
  return params.get('demo') === 'replay';
}

/**
 * Read the `guards` URL param, defaulting to `'full'`.
 *
 * `?demo=replay` forces `'none'`: the replay demo shows the recorder, not the
 * deterrence layers. Resolving it here rather than at the call sites keeps the
 * synthesized runId (which embeds the guard config) honest about what actually
 * ran.
 *
 * @param {string} [search]
 * @returns {string}
 */
export function getGuardConfigFromUrl(search = defaultSearch()) {
  if (isReplayDemo(search)) return 'none';
  const params = new URLSearchParams(search);
  return params.get('guards') || 'full';
}

/**
 * Read the `bot-mode` URL param. Returns `true` ONLY when the value is exactly
 * `'1'`. Any other value (including `'true'`, `'0'`, absent) returns `false`.
 *
 * Why this exists: Browser Use bots cannot complete trials that require canvas
 * drawing, sketchpad strokes, or drag-and-drop (free-sort). When this flag is
 * set, the harness filters those trial types out of the timeline so bot sweeps
 * actually reach completion. Humans/cyborgs omit the param; their timeline is
 * unchanged.
 *
 * @param {string} [search]
 * @returns {boolean}
 */
export function getBotModeFromUrl(search = defaultSearch()) {
  const params = new URLSearchParams(search);
  return params.get('bot-mode') === '1';
}
