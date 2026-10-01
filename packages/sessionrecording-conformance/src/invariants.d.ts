import type { Expectations } from './corpus.js';
import type { SessionRecording } from '../types/session-recording-v2.js';

/** A check returns null when the invariant holds, or the message describing
 *  how it failed. */
export type InvariantCheck = (recording: SessionRecording, expectations: Expectations) => string | null;

export const INVARIANT_CHECKS: Record<string, InvariantCheck>;
export const INVARIANT_NAMES: string[];
/** The scans that may not fail by accident: a fixture expecting one to fail is
 *  declaring a deliberate leak and must say so. */
export const PRIVACY_INVARIANTS: string[];
export const REDACTED_SHAPES: Record<string, unknown>;
export function keyframeSpans(recording: SessionRecording): unknown;
