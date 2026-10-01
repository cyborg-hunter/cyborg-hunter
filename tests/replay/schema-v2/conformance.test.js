// CH's answer to the wire-level conformance corpus.
//
// The runner itself is not here any more. It lifted into
// `@cyborg-hunter/sessionrecording-conformance`, along with the corpus
// it walks, so that a second implementation can answer the same battery without
// vendoring CH's test tree — and so that CH cannot quietly become its own
// conformance definition by editing a runner nobody else runs.
//
// What CH gets from calling it here is what it always had: the same 87 tests,
// with the same names and the same failure messages, under
// `npm run test:schema`. What changed is that the fork, and any other producer,
// can get them too — from `npm test` inside the package, or from this same
// one-line call.
//
// The reconstruction-level half of the corpus — the `checkpoints` arrays, which
// need a player — stays in `checkpoints.test.js`, where CH's viewer binds.

import { registerWireConformanceSuite } from '@cyborg-hunter/sessionrecording-conformance/suite';

registerWireConformanceSuite();
