// The five-stage pipeline, as a function.
//
// THE STAGES, AND WHY THEY ARE NAMED. A recording's bytes go through five
// stages in order — gunzip → parse → tolerant → strict → corpus — and an
// expectations file says where the file is expected to come out. Without the
// names the negative half of the spec's Appendix table is unbuildable: a
// corrupt gzip cannot be JSON.parsed for an events_by_type histogram, and a
// fixture whose only job is to be REFUSED has nothing to spot check. Naming the
// stage is what keeps a negative fixture honest — a rejection test that passes
// for the wrong reason (a typo'd fixture refused at `parse` when it was written
// to be refused at `strict`) is worse than no test.
//
// STRICT IS NOT A STOP. A strict-invalid recording still loads (spec §11: the
// runtime profile accepts what CI refuses, because recordings are unrepeatable
// participant data), so `strict` runs and reports and the walk continues into
// the corpus invariants.
//
// Extracted from CH's `tests/replay/schema-v2/conformance.test.js`,
// unchanged in behaviour: any player or producer can now run the same walk over
// its own bytes without a test runner.

import { gzipSync, gunzipSync } from 'node:zlib';

import { validateStrict, validateTolerant, detectGzip } from './validator.js';
import { INVARIANT_CHECKS, INVARIANT_NAMES } from './invariants.js';

// Spec §10: "Players SHOULD enforce a decompressed-size ceiling before parsing
// (protection against decompression bombs; a configurable limit with a generous
// default)." Generous relative to this corpus — jspsych-full is 1.2 MB — and
// small enough that the bomb fixture stays a few hundred bytes on disk.
export const DECOMPRESSED_CEILING = 16 * 1024 * 1024;

export const STAGES = ['gunzip', 'parse', 'tolerant', 'strict', 'corpus'];

/** The stages that can REFUSE a file. `strict` reports; `corpus` annotates. */
export const REFUSING_STAGES = ['gunzip', 'parse', 'tolerant'];

/** Resolve a dotted path, treating an all-digits segment as an array index. */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
}

/**
 * Decompress if the magic bytes say to, honouring the §10 ceiling.
 * @returns {{ok: true, raw: Buffer} | {ok: false, error: string}}
 */
export function gunzipStage(bytes, ceiling = DECOMPRESSED_CEILING) {
  if (!detectGzip(bytes)) return { ok: true, raw: bytes };
  try {
    return { ok: true, raw: gunzipSync(bytes, { maxOutputLength: ceiling }) };
  } catch (e) {
    return { ok: false, error: `gunzip refused the fixture: ${e.message}` };
  }
}

/**
 * Run a recording's bytes through the five stages, stopping at the first
 * refusal.
 *
 * @param {Buffer} bytes  the file as it sits on disk, compressed or not
 * @param {object} [exp]  the expectations twin; the corpus invariants read
 *                        declarations off it (`perf_frame`, `expect_leak`, …)
 * @param {object} [opts]
 * @param {number} [opts.ceiling]  the §10 decompressed-size ceiling
 * @returns {{stage: string|null, error: string|null, raw: string|null,
 *            rec: object|null, loaded: object|null, strict: object|null,
 *            invariantFailures: object|undefined}}
 *          `stage` is the stage that REFUSED, or null when the file came all
 *          the way through.
 */
export function runPipeline(bytes, exp, opts = {}) {
  const ceiling = opts.ceiling ?? DECOMPRESSED_CEILING;
  const out = { stage: null, error: null, raw: null, rec: null, loaded: null, strict: null };

  // gunzip — §10's magic-byte detection plus the decompressed-size ceiling.
  const gz = gunzipStage(bytes, ceiling);
  if (!gz.ok) {
    out.stage = 'gunzip';
    out.error = gz.error;
    return out;
  }
  const text = gz.raw.toString('utf8');
  out.raw = text;

  // parse — separated from `tolerant` even though validateTolerant would parse
  // it, because "this is not JSON" and "this is JSON that is not a recording"
  // are different fixture claims and a negative fixture pins which one it is.
  try { out.rec = JSON.parse(text); }
  catch (e) { out.stage = 'parse'; out.error = `invalid JSON: ${e.message}`; return out; }

  // tolerant (spec §11) — the runtime profile. Four fatal defects, everything
  // else loads with warnings.
  out.loaded = validateTolerant(text);
  if (!out.loaded.ok) {
    out.stage = 'tolerant';
    out.error = out.loaded.errors.join('; ');
    return out;
  }

  // strict (spec §11) — the conformance profile. NOT a pipeline stop: a
  // strict-invalid recording still loads, and `strict_valid`/`strict_errors`
  // carry that verdict independently of `expect`.
  out.strict = validateStrict(text);

  // corpus — the whole-recording invariants, run in a fixed order so a file
  // that violates two of them names the same one every run.
  out.invariantFailures = {};
  for (const name of INVARIANT_NAMES) {
    const failure = INVARIANT_CHECKS[name](out.rec, exp);
    if (failure != null) out.invariantFailures[name] = failure;
  }
  return out;
}

/**
 * The §10 round trip, as the corpus asserts it: compressing a recording's
 * decompressed bytes must produce something `detectGzip` recognises and
 * `gunzipSync` returns intact.
 * @returns {{gz: Buffer, raw: Buffer}}
 */
export function gzipRoundTrip(raw) {
  return { gz: gzipSync(raw), raw };
}
