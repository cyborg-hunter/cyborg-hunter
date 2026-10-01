import type { SessionRecording } from '../types/session-recording-v2.js';

/** One expectations file, as it sits on disk. Deliberately loose beyond the
 *  keys every entry states: the format grows a key per corpus decision, and a
 *  closed type here would make adding one a breaking change for consumers. */
export interface Expectations {
  fixture: string;
  expect?: 'accept' | 'warn' | 'reject';
  reject_stage?: 'gunzip' | 'parse' | 'tolerant';
  expect_error?: string;
  expect_warning?: string;
  strict_valid?: boolean;
  strict_errors?: string[];
  invariants?: string[];
  expected_failures?: Record<string, string>;
  expect_leak?: boolean;
  perf_frame?: 'absolute' | 'relative' | 'undiscriminating';
  counts?: {
    segments: number; events_total: number; keyframes: number; continuations: number;
    events_by_type: Record<string, number>;
  };
  spot_checks?: { path: string; equals: unknown }[];
  leak_scan?: { absent?: string[]; absent_patterns?: string[]; present?: string[] };
  checkpoints?: Checkpoint[];
  notes?: Record<string, string>;
  [key: string]: unknown;
}

/** One reconstruction oracle. `t` is SESSION-relative ms (spec §7); `node` is a
 *  recorded node id in the segment's keyframe span (spec §4). */
export interface Checkpoint {
  t: number;
  segment: number;
  assert: {
    node: number;
    prop: 'text' | 'exists' | 'value' | `attr:${string}`;
    equals: string | number | boolean | null;
  }[];
}

export const FIXTURES_DIR: string;
export const EXPECTATIONS_DIR: string;
export const FIXTURES_URL: URL;
export const EXPECTATIONS_URL: URL;

export function expNameFor(file: string): string;
export function fixtureNames(): string[];
export function expectationNames(): string[];
export function readFixture(file: string): Buffer;
export function readExpectations(file: string): Expectations;

export function loadCorpus(): {
  file: string; expFile: string; bytes: Buffer; expectations: Expectations;
}[];
export function loadExpectations(): { file: string; exp: Expectations }[];
export function enrollmentProblems(): string[];
export function unwitnessedInvariants(invariantNames: readonly string[]): string[];
export function declaredPerfFrames(): (string | undefined)[];

export type { SessionRecording };
