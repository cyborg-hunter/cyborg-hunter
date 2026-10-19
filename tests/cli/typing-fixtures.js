// tests/cli/typing-fixtures.js
// Synthetic typing for the typing tests: no real participant's keystrokes.
// keyRecording builds a SessionRecording v2 whose segments hold key presses
// (and the input events they cause) at given gaps; traceTier turns it into
// what the trace tier records of the same keys; participantFromRecording
// gives it trials that start on the recording's clock, as the library's do.

const NO_MODS = { ctrl: false, shift: false, alt: false, meta: false };
// Distinct keys in a row, so the same-key filter leaves every gap in.
export const LETTERS = 'etaoinshrdlucmfwypvbgk';

// A seeded generator (mulberry32): the same numbers on every run.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A person: gaps log-normal around a 170 ms median (sigma 0.6), and a pause
// of 0.8 to 3 s after every twelfth key.
export function humanGaps(n, seed) {
  const rnd = seeded(seed);
  return Array.from({ length: n }, (_, i) => {
    const z = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    return i % 12 === 11 ? 800 + 2200 * rnd() : 170 * Math.exp(0.6 * z);
  });
}

// Software typing: 40, 41, 42 ms apart, over and over.
export const botGaps = (n) => Array.from({ length: n }, (_, i) => 40 + (i % 3));

// fields: [[label, tLoad, gaps]], one segment per entry with one textarea
// (node 5 + its index); each key press is followed 1 ms later by the input
// event it causes.
export function keyRecording(fields, base = 1000) {
  return {
    schema_version: 2, recording_started_at_perf: base,
    segments: fields.map(([label, tLoad, gaps], i) => {
      const node = 5 + i, events = [];
      let t = tLoad + 100;
      for (let k = 0; k <= gaps.length; k++) {
        const key = LETTERS[k % LETTERS.length];
        events.push({ type: 'key.down', t, key, code: 'Key' + key.toUpperCase(), mods: NO_MODS, repeat: false, target: node,
          anchor: { tag: 'textarea', id: null, rect: { x: 0, y: 0, w: 300, h: 80 }, node } });
        events.push({ type: 'input.value', t: t + 1, node, value: key });
        if (k < gaps.length) t += gaps[k];
      }
      return { index: i, label, t_load: tLoad, events };
    })
  };
}

// The same recording as the recorder writes it at the trace tier (no DOM,
// src/replay/capture-trace.js): its key presses keep their field's tag but
// name no node, and it holds no input event, since an input event needs a
// node (§5.2). Changes the recording in place and returns it.
export function traceTier(recording) {
  for (const s of recording.segments) {
    s.events = s.events.filter((e) => e.type !== 'input.value');
    for (const e of s.events) { e.target = null; e.anchor.node = null; }
  }
  return recording;
}

// A participant whose trials are the recording's segments, each starting
// where its segment starts on the recording's clock (data recorded before
// 0.17: no typingEdits, no typingRhythm).
export function participantFromRecording(participantId, recording) {
  return {
    participantId,
    trials: recording.segments.map((s) => ({ trialId: s.label, startTime: recording.recording_started_at_perf + s.t_load, duration_ms: 1000,
      pasteEvents: [], copyEvents: [], dropEvents: [], tabAwayEvents: [], trialSoftScore: 0, libraryVersion: '0.16.0' })),
    replay: { recording }
  };
}
