import type { SessionRecording } from '../types/session-recording-v2.js';

/** One segment as the PLAYER reads it (spec §3). The executor bounds every
 *  checkpoint against these and never re-derives the origin chain itself. */
export interface AdapterSegment {
  /** Session-relative start. */
  origin: number;
  /** Stated end, or null for a segment still open at recording end. */
  tEnd: number | null;
  durMs: number;
  /** Index of the keyframe segment the span opens at, or null when none. */
  spanStart: number | null;
  /** Why the span is unusable, or null. */
  defect?: string | null;
}

export interface ConformancePlayer {
  segments: AdapterSegment[];
  selectSegment(index: number): void;
  /** Seek `ms` into the SELECTED segment, measured from its `origin`. */
  seekTo(ms: number): void;
  getSegment(): number;
  getPlayhead(): number;
  /** null/undefined for an id the keyframe span never bound: tolerance is
   *  right here, and the executor supplies the loudness. */
  resolveNode(id: number): unknown;
  isConnected(node: unknown): boolean;
  /** `"text"`, `"value"` or `"attr:<name>"` off a RESOLVED node. `"exists"`
   *  never reaches here — the executor answers it from `resolveNode` and
   *  `isConnected`, so absence means the same thing to every implementation. */
  readProp(node: unknown, prop: string, id: number): unknown;
  dispose(): void;
}

export interface ConformanceAdapter {
  boot(recording: SessionRecording): ConformancePlayer;
}

export function assertAdapter<T extends ConformanceAdapter>(adapter: T): T;
export function assertPlayer<T extends ConformancePlayer>(player: T): T;
