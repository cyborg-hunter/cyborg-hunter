/** The producer capture path `generateSession` drives. This package holds no
 *  recorder, so the five symbols are supplied by whoever is being fuzzed. */
export interface CaptureBinding {
  mapMutations: (records: unknown[], ctx: unknown) => unknown[];
  MUTATION_OBSERVER_INIT: unknown;
  serializeTree: (root: unknown, span: unknown, opts: unknown) => unknown;
  createSpan: () => unknown;
  createDelivery: () => unknown;
}

/** Op mixes, named for what they stress. */
export const MIXES: Record<string, string[]>;
/** Fixed seeds, so a failure is reproducible from the message alone. */
export const SEEDS: number[];
export const BATCHES: number;
export const OPS_PER_BATCH: number;

export function generateSession(opts: {
  mix: string;
  seed: number;
  capture: CaptureBinding;
  batches?: number;
  opsPerBatch?: number;
}): {
  keyframe: unknown;
  batches: { events: unknown[]; expected: unknown; log: string[]; where: string }[];
};
