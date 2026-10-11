// demo/participant-id.js — the visitor's participant id: DEMO- and four
// base-36 characters, never one of the bundled sessions' ids.
import { BUNDLED_IDS } from './steps.js';

// Four base-36 characters from one random number. Math.random() === 0
// renders as the 1-char string '0' (no decimal point), which would slice
// down to only 3 characters without padding: padEnd to 6 first so the slice
// always has 4 to take.
export function drawSuffix(random) {
  return random().toString(36).padEnd(6, '0').slice(2, 6);
}

export function randomParticipantId(draw, taken) {
  var next = draw || function () { return drawSuffix(Math.random); };
  var avoid = taken || BUNDLED_IDS;
  var id;
  do { id = 'DEMO-' + next(); } while (avoid.indexOf(id) !== -1);
  return id;
}
