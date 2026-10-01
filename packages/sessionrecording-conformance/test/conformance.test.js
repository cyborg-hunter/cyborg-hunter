// The wire-level conformance suite, run against the package's own corpus.
//
// There is nothing else in this file on purpose. The suite is a LIBRARY
// (`src/suite.js`) rather than a test script, because CH runs the identical
// suite from `tests/replay/schema-v2/conformance.test.js` and a corpus runner
// that exists in two copies is two readings of what conformance means — the
// exact failure the whole package exists to remove. Both callers register the
// same tests, with the same names and the same messages, because there is only
// one of each.

import { registerWireConformanceSuite } from '../src/suite.js';

registerWireConformanceSuite();
