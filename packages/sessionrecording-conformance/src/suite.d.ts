import type { ConformanceAdapter } from './adapter.js';

/** Anything with node:test's `(name, fn)` shape. */
export type TestRegistrar = (name: string, fn: () => void) => unknown;

export function registerWireConformanceSuite(opts?: { test?: TestRegistrar }): void;
export function registerCheckpointSuite(
  opts: { adapter: ConformanceAdapter; test?: TestRegistrar },
): void;
