// src/core/state-machine.js
// Lifecycle state machine enforcing correct call order:
// init → startSession → startTrial/endTrial → destroy
// States: "created", "session", "trial", "destroyed"

// Valid state transitions. Each state maps to an array of states it can
// transition to. Any other transition is rejected with a warning.
export const VALID_TRANSITIONS = {
  created:   ["session", "destroyed"],
  session:   ["trial", "destroyed"],
  trial:     ["session", "destroyed"],  // endTrial returns to session
  destroyed: []
};

/**
 * Creates a state machine instance.
 * Returns an object with a `current` getter and a `transition(to)` method.
 * transition() returns true on success, false on invalid transition.
 */
export function createStateMachine() {
  let state = "created";
  return {
    get current() { return state; },
    transition(to) {
      if (VALID_TRANSITIONS[state] && VALID_TRANSITIONS[state].indexOf(to) !== -1) {
        state = to;
        return true;
      }
      console.warn("[cyborg-hunter] invalid transition: " + state + " → " + to);
      return false;
    }
  };
}

/**
 * Deep copy utility — prevents external mutation of internal state.
 * Uses JSON round-trip for simplicity. Falls back to identity for
 * non-serializable objects (shouldn't happen in practice).
 */
export function deepCopy(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  try { return JSON.parse(JSON.stringify(obj)); }
  catch (e) { return obj; }
}
