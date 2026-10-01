// The package's default entry point: everything a player or producer needs to
// run the SessionRecording v2 conformance corpus against itself.
//
// The subpath exports (`/validator`, `/invariants`, `/corpus`, `/fuzz/*`) are
// the stable seams; this barrel exists so a consumer that wants the whole
// surface writes one import.

export { detectGzip, validateTolerant, validateStrict, REDACTABLE_TYPES } from './validator.js';
export {
  INVARIANT_CHECKS, INVARIANT_NAMES, PRIVACY_INVARIANTS, REDACTED_SHAPES, keyframeSpans,
} from './invariants.js';
export {
  FIXTURES_DIR, EXPECTATIONS_DIR, FIXTURES_URL, EXPECTATIONS_URL,
  expNameFor, fixtureNames, expectationNames, readFixture, readExpectations,
} from './corpus.js';
