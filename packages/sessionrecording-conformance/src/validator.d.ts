import type { SessionRecording } from '../types/session-recording-v2.js';

export interface TolerantResult {
  ok: boolean;
  /** null when the four fatal defects of §11 refused the input. */
  recording: SessionRecording | null;
  errors: string[];
  warnings: string[];
}

export interface StrictResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** RFC 1952 magic bytes. */
export function detectGzip(bytes: Uint8Array | null | undefined): boolean;

/** Spec §11's runtime profile: only four defects are fatal, because recordings
 *  are unrepeatable participant data and rejection is data loss. */
export function validateTolerant(input: string | object): TolerantResult;

/** Spec §11's conformance profile: full checks, exhaustive error list. */
export function validateStrict(input: string | object): StrictResult;

/** The event types §5.2 gives a redacted variant. */
export const REDACTABLE_TYPES: Set<string>;
