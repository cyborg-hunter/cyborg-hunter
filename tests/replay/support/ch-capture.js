// tests/replay/support/ch-capture.js
// CH's recorder bound to the conformance package's fuzz seam.
//
// `generateSession` (packages/sessionrecording-conformance/src/fuzz/mutation-fuzz.js)
// used to import these five symbols directly, which is what kept the generator
// inside CH's test tree. The generator is producer-agnostic now, so the binding
// has to live on the producer's side — this file is CH's, and the fork's
// equivalent binds its own recorder at the same seam.
//
// Nothing is wrapped or adapted here: these are the shipped capture symbols, so
// what the differential suites fuzz is still the real capture path.

import { mapMutations, MUTATION_OBSERVER_INIT } from '../../../src/replay/mutations.js';
import { serializeTree } from '../../../src/replay/snapshot.js';
import { createSpan } from '../../../src/replay/span.js';
import { createDelivery } from '../../../src/replay/delivery.js';

export const CH_CAPTURE = {
  mapMutations, MUTATION_OBSERVER_INIT, serializeTree, createSpan, createDelivery,
};
