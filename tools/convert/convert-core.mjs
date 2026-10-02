// tools/convert/convert-core.mjs
//
// jsPsych `schema_version: 1` SessionRecording → SessionRecording v2
// (docs/session-recording-v2.md, §14 migration).
// This tool IS the migration path: players stay v2-only, there is no dual-read,
// and there is no v2 → v1 direction.
//
// v1 source of truth: the fork's pre-flip `src/schema/types.ts`
//   git -C <jspsych-replay-fork> show 06dfa08~1:src/schema/types.ts
// itself copied from jspsych/jsPsych packages/jspsych/src/modules/recording.ts.
// The key tables below are that interface, transcribed. They are the whole
// shape contract: a recording whose top-level or per-trial key set differs from
// them is REFUSED, in both directions (unknown keys and missing keys alike).
//
// Why refuse instead of coping. A converter that defaults a missing field is
// guessing about unrepeatable participant data, and a converter that renumbers
// a disagreeing `trial_index` silently rewrites the experiment's own record of
// what ran when. Both failures are invisible downstream — the output validates
// either way. So every deviation from the v1 shape stops the conversion and
// names itself, with a remedy attached. (Note the deliberate contrast with the
// v2 *loader*, which is tolerant by design, spec §11: tolerance protects an
// analyst opening a file; strictness protects a producer manufacturing one.
// This tool is BOTH — a producer when it cuts a fixture, and an archive's only
// door when a researcher points it at a 2025 recording, since §14 makes
// conversion the sole migration path. Hence the one concession below.)
//
// What the mapping does NOT touch: `initial_dom`, `events`, `trial_data`,
// stylesheets, viewport changes and RNG records are participant data and are
// copied through value-for-value. Their internal key order is theirs, not ours.
//
// Packaging: this core has no imports at all; the Node shell
// `jspsych-v1-to-v2.mjs` supplies `node:crypto` and the CLI. The provenance
// hash is the one step that needs a platform API, so it is injected: Node
// passes createHash, a browser passes crypto.subtle.

// Stamped into every converted file. Bump it deliberately: the goldens carry
// this string, so a bump fails the golden tests until they are regenerated,
// which is exactly the review moment a mapping change deserves.
// 1.1.0: stylesheets backfill + `backfilled` report, provenance moved under the
// `cyborg-hunter` vendor slug, `label` null instead of String(trial_index).
export const CONVERTER_VERSION = '1.1.0';
const CONVERTER_TOOL = 'jspsych-v1-to-v2';
// Spec §9 types `extensions` as { "<vendor>": JsonValue } with lowercase-slug
// vendor keys. "converter" is a role, not a vendor, so the stamp nests inside
// CH's existing namespace — the shape travels to the fork with the jspsych-full
// fixture, where a bare "converter" key would read as a second vendor.
const CH_VENDOR = 'cyborg-hunter';

// Transcribed from v1 `interface SessionRecording` / `interface TrialRecording`.
const V1_TOP_KEYS = [
  'schema_version', 'jspsych_version', 'recording_started_at',
  'recording_started_at_perf', 'user_agent', 'viewport', 'rng',
  'display_element_id', 'stylesheets', 'stylesheet_events', 'trials',
  'viewport_changes', 'rng_calls', 'ended_at_perf', 'end_reason',
];
const V1_TRIAL_KEYS = [
  'trial_index', 't_start', 't_dom_ready', 't_end', 'plugin',
  'initial_dom', 'events', 'trial_data',
];

// The ONLY concession to v1 history, mirroring the v1 reference validator
// (fork 06dfa08~1:src/schema/types.ts:219-224, "stylesheet fields were added
// later. Default to empty arrays so older recordings still load") — and those
// are its only two backfills, so this is a bounded concession, not the top of a
// slope. These two fields postdate the rest of the shape, so ABSENCE means the
// recorder had no stylesheet feature: `[]` records that fact rather than
// inventing one, which is why `viewport` or `rng_calls` cannot join the list.
// Absence only. A present-but-wrong-type value means something went wrong, and
// the converter has nothing true to say about it: it passes through and the
// strict profile stops it at the CLI boundary.
const V1_BACKFILL_KEYS = ['stylesheets', 'stylesheet_events'];

// ── conversion ──────────────────────────────────────────────────────────────

/**
 * Everything the conversion needs except the provenance hash. Sync, so the
 * Node tool can stay sync; the hash is the one step that is async in a
 * browser (crypto.subtle), so it is injected and applied in build().
 *
 * Pure: the input is never mutated and the output shares no structure with it
 * (one clone up front), so a caller can keep using either independently. That
 * clone backs every build(), so call build() once per conversion.
 *
 * Throws on ANY deviation from the v1 shape. The Error carries `.reasons`
 * (string[]) with every problem found, not just the first.
 */
export function prepareConversion(input) {
  const reasons = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw refusal([
      `input must be a JSON object (got ${describe(input)}). ` +
      `Pass one jsPsych SessionRecording, not a list of them or a bare value.`,
    ]);
  }

  if (input.schema_version !== 1) {
    reasons.push(
      `schema_version must be the integer 1 (got ${describe(input.schema_version)}). ` +
      `Point this tool at a jsPsych v1 recording: a v2 file needs no conversion, and a ` +
      `Cyborg Hunter v1 file takes the separate CH migration path (spec §14).`
    );
  }

  const backfilled = V1_BACKFILL_KEYS.filter(k => !Object.keys(input).includes(k));
  const top = keySetDiff(input, V1_TOP_KEYS, backfilled);
  if (top.unknown.length) {
    reasons.push(
      `unknown top-level key(s): ${top.unknown.join(', ')}. ` +
      `Remove them from the recording, or extend V1_TOP_KEYS in this tool if jsPsych's ` +
      `v1 shape really grew a field.`
    );
  }
  if (top.missing.length) {
    reasons.push(
      `missing top-level key(s): ${top.missing.join(', ')}. ` +
      `Re-export the recording from its source; only ${V1_BACKFILL_KEYS.join('/')} have a ` +
      `safe default ([], applied automatically), so filling anything else in would invent data.`
    );
  }

  if (typeof input.jspsych_version !== 'string') {
    reasons.push(
      `jspsych_version must be a string (got ${describe(input.jspsych_version)}). ` +
      `Quote it ("8.2.1"): it becomes recorder.version and host.version.`
    );
  }
  if (typeof input.display_element_id !== 'string' || input.display_element_id === '') {
    reasons.push(
      `display_element_id must be a non-empty string (got ${describe(input.display_element_id)}). ` +
      `Name the element the session was recorded from; it becomes observed_root as "#"+id.`
    );
  }

  // Trial checks only run when there is an array to walk; otherwise every
  // per-trial message would be noise on top of the real problem.
  if (!Array.isArray(input.trials)) {
    reasons.push(
      `trials must be an array (got ${describe(input.trials)}). ` +
      `Pass the recording's own trials list, even when it is empty.`
    );
  } else {
    input.trials.forEach((t, i) => checkTrial(t, i, reasons));
  }

  // Nothing below runs for a refused recording, so a bad file costs neither the
  // clone nor the hash.
  if (reasons.length) throw refusal(reasons);

  const v1 = structuredClone(input);
  // Hashed canonically (see canonicalize) and BEFORE the backfill, so the stamp
  // identifies the source recording as it arrived; `backfilled` below says what
  // the converter added on top.
  const canonicalText = JSON.stringify(canonicalize(input));
  for (const k of backfilled) v1[k] = [];

  return {
    canonicalText,
    build(sourceHash) {
      return {
        schema_version: 2,
        // v1 states one version for the recorder and the runtime because in v1 they
        // are the same program. v2 splits the roles, so both get the same identity
        // here rather than one of them getting a guess.
        recorder: { name: 'jspsych', version: v1.jspsych_version },
        host: { name: 'jspsych', version: v1.jspsych_version },
        participant_id: null,          // v1 records none, so the converter invents none
        recording_started_at: v1.recording_started_at,
        recording_started_at_perf: v1.recording_started_at_perf,
        user_agent: v1.user_agent,
        viewport: v1.viewport,
        // v2 wants a selector (§2). Not CSS-escaped: an id starting with a digit or
        // holding a `.`/`:`/space yields a selector querySelector rejects. Left as
        // is deliberately — CH's own recorder builds observed_root the same way
        // (src/replay/capture-dom.js:251-253), so escaping is a repo-wide
        // convention to change in both places or neither.
        observed_root: '#' + v1.display_element_id,
        stylesheets: v1.stylesheets,
        stylesheet_events: v1.stylesheet_events,
        viewport_changes: v1.viewport_changes,
        rng: v1.rng,
        rng_calls: v1.rng_calls,
        ended_at_perf: v1.ended_at_perf,
        end_reason: v1.end_reason,
        truncated: false,              // v1 has no early-stop channel to report
        extensions: {
          [CH_VENDOR]: {
            converter: {
              tool: CONVERTER_TOOL,
              version: CONVERTER_VERSION,
              source_sha256: sourceHash,
              // Present only when something was filled in, so its presence alone is
              // the signal that this file is not purely what the recorder wrote.
              ...(backfilled.length ? { backfilled } : {}),
            },
          },
        },
        segments: v1.trials.map(convertTrial),
      };
    },
  };
}

/**
 * Convert a jsPsych-v1 SessionRecording to v2 with an injected hash function:
 * sha256(text) → hex string, or a Promise of one. Pure and async-capable.
 */
export async function convertRecording(input, { sha256 }) {
  const prep = prepareConversion(input);
  return prep.build(await sha256(prep.canonicalText));
}

// jsPsych wipes the display between trials, so every v1 trial is a v2 keyframe:
// `initial_dom` is always a fresh snapshot and node numbering always restarts.
// That is why `initial_state` is null (spec §3 exempts wiping hosts) and why no
// continuation bookkeeping is needed here.
function convertTrial(t) {
  return {
    index: t.trial_index,
    // null, not String(trial_index): spec §3 calls `label` host-assigned, and
    // jsPsych assigns none. Stringifying the index would duplicate `index` while
    // asserting a label the recording never carried.
    label: null,
    plugin: t.plugin,
    t_start: t.t_start,
    t_dom_ready: t.t_dom_ready,
    t_load: null,                  // v1 never recorded a load milestone
    t_end: t.t_end,
    initial_dom: t.initial_dom,    // v1's DomNode encoding IS v2's (§4)
    initial_state: null,
    events: t.events,              // v1's dotted event vocabulary IS v2's (§5)
    host_data: t.trial_data,
    extensions: null,
  };
}

// ── refusals ────────────────────────────────────────────────────────────────

function checkTrial(t, i, reasons) {
  const at = `trials[${i}]`;
  if (typeof t !== 'object' || t === null || Array.isArray(t)) {
    reasons.push(
      `${at} must be a JSON object (got ${describe(t)}). ` +
      `Drop the entry or restore the trial record; the converter will not invent one.`
    );
    return;
  }

  const keys = keySetDiff(t, V1_TRIAL_KEYS);
  if (keys.unknown.length) {
    reasons.push(
      `${at}: unknown trial-level key(s): ${keys.unknown.join(', ')}. ` +
      `Remove them, or extend V1_TRIAL_KEYS in this tool if the v1 trial shape really grew a field.`
    );
  }
  if (keys.missing.length) {
    reasons.push(
      `${at}: missing trial-level key(s): ${keys.missing.join(', ')}. ` +
      `Re-export the recording from its source; no trial-level field has a safe default.`
    );
  }

  if (!Number.isInteger(t.trial_index)) {
    reasons.push(
      `${at}.trial_index must be an integer (got ${describe(t.trial_index)}). ` +
      `Fix it at the source: it becomes the segment index, which v2 §7 requires to equal ` +
      `the array position.`
    );
  } else if (t.trial_index !== i) {
    // Never renumbered. v2 §7 requires index === array position, and the only
    // safe way to satisfy it is to make a human decide which one is wrong.
    reasons.push(
      `${at}.trial_index (${t.trial_index}) must equal its array position (${i}). ` +
      `Reorder the trials to match their own indices, or fix the indices at the source; ` +
      `this tool never renumbers, because that would rewrite the experiment's record of ` +
      `what ran when.`
    );
  }
}

// `exempt` names keys whose absence is being handled elsewhere (the stylesheets
// backfill), so they are not also reported as missing.
function keySetDiff(obj, known, exempt = []) {
  const present = Object.keys(obj);
  return {
    unknown: present.filter(k => !known.includes(k)).sort(),
    missing: known.filter(k => !present.includes(k) && !exempt.includes(k)).sort(),
  };
}

function refusal(reasons) {
  const err = new Error(
    `${CONVERTER_TOOL} refused this recording (${reasons.length} problem` +
    `${reasons.length === 1 ? '' : 's'}):\n` +
    reasons.map(r => '  - ' + r).join('\n')
  );
  err.reasons = reasons;
  return err;
}

function describe(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'object') return 'an object';
  return JSON.stringify(v);
}

// ── provenance hash ─────────────────────────────────────────────────────────

// Recursively key-sorted copy. Hashing THIS rather than the raw bytes makes the
// provenance stamp identify the recording's content, not its formatting: the
// same recording re-serialized with different key order or indentation gets the
// same hash, and any change to a value gets a different one.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}
