import type { Checkpoint } from './corpus.js';
import type { AdapterSegment, ConformanceAdapter, ConformancePlayer } from './adapter.js';
import type { SessionRecording } from '../types/session-recording-v2.js';

export interface Reading {
  node: number;
  prop: string;
  actual: unknown;
}

/** The wire's own 0.1 ms grid (spec §7), and the rebasing rule. */
export function round1(v: number): number;
export function where(cp: Pick<Checkpoint, 't' | 'segment'>): string;

export function placeCheckpoint(
  player: Pick<ConformancePlayer, 'segments'>,
  cp: Checkpoint,
): { seg: AdapterSegment; tRel: number; segEnd: number };

export function readCheckpointProp(
  player: ConformancePlayer, id: number, prop: string, cp: Checkpoint,
): unknown;

export function runCheckpoint(
  recording: SessionRecording, cp: Checkpoint, adapter: ConformanceAdapter,
): { readings: Reading[] };

export function runCheckpoints(
  recording: SessionRecording, checkpoints: Checkpoint[], adapter: ConformanceAdapter,
): { cp: Checkpoint; readings: Reading[] }[];

export function placementProblems(
  recording: SessionRecording, checkpoints: Checkpoint[],
  adapter: ConformanceAdapter, label?: string,
): string[];
