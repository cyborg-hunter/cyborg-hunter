import type { Expectations } from './corpus.js';
import type { SessionRecording } from '../types/session-recording-v2.js';
import type { StrictResult, TolerantResult } from './validator.js';

export interface PipelineResult {
  /** The stage that REFUSED the bytes, or null when they came all the way
   *  through. `strict` and `corpus` never refuse: they report. */
  stage: 'gunzip' | 'parse' | 'tolerant' | null;
  error: string | null;
  raw: string | null;
  rec: SessionRecording | null;
  loaded: TolerantResult | null;
  strict: StrictResult | null;
  invariantFailures?: Record<string, string>;
}

export const DECOMPRESSED_CEILING: number;
export const STAGES: readonly string[];
export const REFUSING_STAGES: readonly string[];

export function getPath(obj: unknown, path: string): unknown;
export function gunzipStage(bytes: Uint8Array, ceiling?: number):
  { ok: true; raw: Buffer } | { ok: false; error: string };
export function runPipeline(
  bytes: Uint8Array,
  expectations?: Expectations | Record<string, never>,
  opts?: { ceiling?: number },
): PipelineResult;
export function gzipRoundTrip(raw: Uint8Array): { gz: Buffer; raw: Uint8Array };
