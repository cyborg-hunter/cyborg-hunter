# Playing SessionRecording v2: a migration guide for v1 players

> **Provenance note.** This document was drafted by an AI coding agent (Claude, working in the cyborg-hunter repository on 2026-09-03) from the code, tests and fixtures it cites, and has not yet been rewritten by a human author. Facts were machine-checked against the repository where a fixture or test is named; the prose style is the agent's. Treat it as an accurate but unedited technical summary until this note is removed.

A player written for jsPsych's `schema_version: 1` (the `record_session` line) is correct for every recording jsPsych's own recorder produces. SessionRecording v2 (`docs/session-recording-v2.md`) generalizes that format so that other recorders can produce it too, and a v1 player meeting its first v2 file from another producer runs into three things it never had to handle. Each one below was found by playing a real capture, not by reading the spec; each has a fixture that pins it and a patch that closes it. The patches are in the `sessionrecording-v2` branch of the jspsych/replay fork.

The three deltas are small in code and large in effect: without them a v2 file from a non-jsPsych recorder plays as zero-length segments, then as a blank stage with a wandering cursor, then unstyled with every cursor position off its target.

---

## 1. Segment time origin

**What v1 assumed.** Every segment has `t_dom_ready`, because jsPsych records one, so the player rebases everything by `t_dom_ready ?? 0` and computes a segment's duration as `t_end - t_dom_ready`.

**What v2 says** (§3, last bullet). A segment's time origin is the first non-null of `t_load`, `t_dom_ready`, `t_start`; else the first event's `t`. A recorder that has no DOM-ready hook (any standalone recorder attached to an already-loaded page) states `t_load` only, and stating a `t_dom_ready` it never observed would be fabrication.

**What breaks visibly.** `t_dom_ready == null` makes the duration 0. Play jumps straight to the end, the scrub bar is inert, and the stage stays at `0.0s / 0.0s`. Every segment of a Cyborg Hunter standalone capture looks like this in an unpatched v1 player.

**The patch.** One helper, `segmentOrigin(segment)`, implementing §3's order, and every rebase, duration and anchor site reading it instead of `t_dom_ready`. Eight call sites in the player; the test suite's own `segmentOrigin()` helper had implemented the same order since the corpus was first authored, which is where the divergence was visible before it was fixed.

**What pins it.** `tests/segment-origin.test.ts` (fork): the both-stated case decides for `t_load`; the `t_load`-only case has a real origin; 0 is an origin, not "missing". CH side: every recording in the conformance corpus produced by CH's recorder is `t_load`-only.

---

## 2. Continuation segments (the keyframe-span walk)

**What v1 assumed.** Every segment is self-contained: it carries its own full DOM snapshot, because jsPsych wipes the display between trials and snapshots each one. A player restores a segment by mounting its `initial_dom`.

**What v2 says** (§3). `initial_dom` present = keyframe; `initial_dom: null` = **continuation**: DOM and node numbering carry on from the previous segment's end state. Persistent-DOM hosts keyframe periodically (size-aware cadence), not per segment. Player rule: to seek into a continuation, restore the nearest earlier keyframe (`initial_dom` + `initial_state` + derived stylesheet state), then apply events forward.

**What breaks visibly.** A v1 player mounts nothing for `initial_dom: null`. The cursor overlay still animates (it needs no DOM), while every `dom.*` patch references nodes that were never mounted and is dropped with a console warning. The result is a cursor moving over an empty stage, in half the segments of a typical CH capture (a real one: 4 continuations out of 6 segments).

**The patch.** In the player's segment restore: if `initial_dom` is null, walk back to the nearest keyframe, mount *its* snapshot and `initial_state` seed, then replay the span's events up to the target segment's opening through the engine (`applyEventsImmediate`); then schedule the segment's own events as before. A continuation with no keyframe before it is a §3 violation: warn, play over an empty stage. Both restore entry points (select and seek) share the code, so the walk applies to both.

**What pins it.** The canonical-core fixture's segment 1 is a continuation; its checkpoints now run against the *unstaged* player (previously a test-side helper synthesized a merged segment for it, which is exactly why a player without the walk still passed). Plus a populated-stage witness on a real CH capture.

**The §15 question this answers.** Open question 4 asks whether players should learn keyframe-seek or whether the spec should mandate keyframes everywhere. The patch is ~40 lines and the alternative costs a full snapshot per segment on persistent-DOM hosts. Evidence favours "players learn the walk".

---

## 3. Stylesheets a player cannot read

**What v1 assumed.** Nothing explicit. The recorder copies each stylesheet's rules into the file when the browser lets it read them; a cross-origin `<link>` (jspsych.css from a CDN is the common case) is unreadable under the same-origin policy and ships href-only. The v1 player, running with network access, simply fetches the href. That works for it.

**What v2 says.** §2 allows `css: null` on a link sheet. §12 says players SHOULD apply a network policy for external assets: block, allow, or ask. Between the two, the spec is silent on what a player *owes* an href-only sheet, and a player that blocks (Cyborg Hunter's report frame, by design: recordings are untrusted input) renders the DOM unstyled.

**What breaks visibly.** Unstyled means default fonts, no layout, content top-left. Every recorded cursor position still refers to the real, styled layout, so the cursor lands nowhere near its targets, and the player cannot tell the analyst why.

**What changed on the CH side** (both are producer/player behaviours, neither changes the format):
- *Producer:* at session start the recorder `fetch`es each href-only sheet over CORS (credentials omitted) and inlines the text; CDNs such as jsdelivr permit this, and the recording becomes self-contained. Servers that refuse CORS leave the sheet href-only, as before.
- *Player:* the fetch decision is made once, up front, beside the load button (ticked by default), and an unstyled stage carries a banner saying which sheets are missing. Silence was the actual defect.

**Proposed r3 text.** Producers SHOULD inline the text of every stylesheet they can obtain, including by a CORS fetch of an unreadable sheet. Players that apply a blocking network policy MUST make an unstyled reconstruction visible as such (a banner or equivalent), and SHOULD offer the fetch as an explicit choice. A player MUST NOT present an unstyled reconstruction as faithful.

**What pins it.** CH: `fillCrossOriginSheets` tests (inlined on 2xx, null on refusal, http(s) only); viewer tests for the fetch option and the banner; the conformance corpus's strict profile already type-checks `stylesheets[].css`.

---

## For the r3 conversation

These three deltas touch two clusters of the open ledger and nothing else:

- **Time semantics (§3):** the origin order is now implemented identically in both players; does the sentence stand as written, and does §15 Q4 close as "players learn the walk"?
- **Player duties (§11/§12):** adopt the stylesheet wording above, and decide whether "make unstyled visible" belongs in §12 as a MUST.

Everything else in the ledger (privacy wording, DOM fidelity) is untouched by these findings and can wait.
