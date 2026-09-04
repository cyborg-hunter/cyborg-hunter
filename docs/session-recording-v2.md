# SessionRecording v2 — specification draft

**Status:** draft **r2** (2026-08-09, post engineering review), published 2026-09-03 · proposed for joint ownership by jsPsych and Cyborg Hunter — the intended home for this document and its conformance corpus is the jsPsych replay repository.
**Implementations:** Cyborg Hunter 0.7.5+ (recorder, ingest, report viewer) and a patched jspsych/replay player; a 24-fixture conformance corpus with cross-player checkpoints lives in `tests/replay/schema-v2/`.
**Since r2:** two clusters of this text were sharpened by implementation and are the first agenda for r3 — segment time semantics (§3: origin order, continuation playback) and player duties (§11/§12: what a player owes a stylesheet it cannot read). See `docs/v2-player-migration.md`.
**Supersedes:** jsPsych's `schema_version: 1` (record_session branch) and Cyborg Hunter's `schema_version: 1` (CH 0.7.x) — two independently built formats that share a design but do not interoperate.
**Self-contained:** all inherited jsPsych-v1 definitions are inlined and tagged **[v1-unchanged]**. A delta-form version (changed sections in full, [v1-unchanged] sections collapsed to references) is derived from this document at transmission time for JdL's anchor point.
Changes relative to jsPsych v1 fall into three groups: generalizations for host neutrality, additions marked **[NEW]**, and open items marked **[REVIEW]** for JdL's call.

## 1. Replayer model

[v1-unchanged in spirit] A recording is **purely observational**. The DOM is the single source of truth; replay reconstructs what the participant saw and did by applying recorded snapshots and events. No experiment code is re-executed. A recording is one JSON object (optionally gzipped) that any conforming player can render with no access to the experiment that produced it, except for external assets (images, fonts) referenced by URL — see §13 on the limits of that exception.

## 2. Top-level shape

```ts
interface SessionRecording {
  schema_version: 2;
  recorder: { name: string; version: string };        // e.g. {name:"jspsych", version:"9.0.0"}
  host: { name: string; version: string } | null;     // runtime the recorder was embedded in, if any
  participant_id: string | null;                      // [NEW] optional
  recording_started_at: string;                       // [v1-unchanged] ISO 8601 wall clock
  recording_started_at_perf: number;                  // [v1-unchanged] performance.now() at start
  user_agent: string;                                 // [v1-unchanged]
  viewport: ViewportState;                            // [v1-unchanged]
  observed_root: string | null;                       // selector of observed subtree; null = document.body
  stylesheets: StylesheetSnapshot[];                  // [v1-unchanged]
  stylesheet_events: StylesheetEvent[];               // [v1-unchanged]
  segments: SegmentRecording[];                       // generalized trials, §3
  viewport_changes: ViewportChange[];                 // [v1-unchanged]
  rng: { seed: string | null; math_random_patched: boolean } | null;
  rng_calls: RngCall[] | null;                        // non-null iff rng is non-null (§7)
  ended_at_perf: number | null;                       // [v1-unchanged]
  end_reason: "finished" | "aborted" | "unload" | null;  // [v1-unchanged]
  truncated: boolean;                                 // [NEW] capture stopped early (§5.7)
  extensions: { [vendor: string]: JsonValue } | null; // [NEW] vendor namespace, §9
}

interface ViewportState {            // [v1-unchanged]
  w: number; h: number; dpr: number;
  scale: number; offset_x: number; offset_y: number;  // visualViewport pinch state
}
interface ViewportChange extends ViewportState { t: number }  // [v1-unchanged]

type StylesheetSnapshot =            // [v1-unchanged]
  | { id: number; kind: "inline"; css: string; media: string | null }
  | { id: number; kind: "link"; href: string; css: string | null; media: string | null };

type StylesheetEvent =               // [v1-unchanged]
  | { type: "stylesheet.add"; t: number; sheet: StylesheetSnapshot }
  | { type: "stylesheet.remove"; t: number; id: number }
  | { type: "stylesheet.update"; t: number; id: number; css: string };

interface RngCall { t: number; fn: string; args: JsonValue; result: JsonValue }  // [v1-unchanged]
```

Changes vs jsPsych v1: `jspsych_version` (required string) → `recorder` + optional `host`; `display_element_id` → `observed_root` (nullable); `trials` → `segments`; `rng` nullable; `participant_id`, `truncated`, `extensions` added. **[REVIEW]** naming: keeping the `trials`/`trial_data` keys with nullable fields is acceptable if adapter churn matters more than vocabulary.

## 3. Segments (generalized trials)

```ts
interface SegmentRecording {
  index: number;                       // MUST equal array position (§7)
  label: string | null;                // host-assigned (jsPsych: trial id; standalone: researcher label)
  plugin: string | null;               // jsPsych plugin name; null outside jsPsych
  t_start: number | null;
  t_dom_ready: number | null;
  t_load: number | null;
  t_end: number | null;                // null if segment open at recording end
  initial_dom: DomNode | null;         // keyframe (present) vs continuation (null), below
  initial_state: InitialState | null;  // [NEW, eng-review] replay-state seed, below
  events: RecordedEvent[];
  host_data: JsonValue | null;         // was trial_data
  extensions: { [vendor: string]: JsonValue } | null;
}

interface InitialState {               // [NEW] state established BEFORE this keyframe
  scroll: { x: number; y: number };                                   // window scroll
  element_scroll: { node: number; x: number; y: number }[];           // inner scrollers
  media: { node: number; current_time: number; paused: boolean }[];   // playback positions
  form: { node: number; value?: string; checked?: boolean; selected?: string[] }[];  // IDL state
}
```

- **Keyframes and continuations.** `initial_dom` present = **keyframe**: a complete fresh snapshot; node numbering restarts at 1. `initial_dom: null` = **continuation**: DOM and numbering carry on from the previous segment's end state (the video I-frame/delta pattern). Timeline rules: the first DOM-bearing segment of a recording MUST be a keyframe; null before any keyframe = the recording (so far) is trace-only; segments are ordered and non-overlapping (`t_end[n] ≤` next segment's origin); events always belong to exactly one segment (the recorder assigns to the open segment; unbracketed recordings are one whole-session segment).
- **A keyframe is a full replay checkpoint** only together with `initial_state`: a DOM tree does not carry window/element scroll, media playback positions, or form IDL state established earlier. Keyframe segments on persistent-DOM hosts MUST include `initial_state` whenever any of that state is non-default; hosts that rebuild the display each segment (jsPsych wipes between trials) may omit it. Stylesheet state at a keyframe is NOT seeded: it derives from replaying session-level `stylesheet_events` up to the keyframe's time (they are cheap and session-scoped by design).
- **Producer guidance.** Wiping hosts SHOULD keyframe every segment (jsPsych-v1 behavior, unchanged). Persistent-DOM hosts SHOULD keyframe periodically. Cadence guidance: the self-tuning trigger is *take a keyframe when the accumulated mutation volume since the last keyframe rivals a fresh snapshot's size* — at that point the keyframe is free in file size and resets both seek distance and corruption blast radius; the simple fallback is every ~10 segments. Too-frequent keyframes reintroduce serialization jank and file bloat; too-sparse ones make seeking slow and grow the damage radius of a corrupt event.
- **Player rule.** To seek into a continuation segment: restore the nearest earlier keyframe (`initial_dom` + `initial_state` + stylesheet state derived per above), then apply events forward. **[REVIEW]** Continuation support is the one v2 feature touching the player's core model (v1 players assume self-contained trials); fallback position: mandate keyframes everywhere, at the cost of snapshot duplication on persistent-DOM hosts.
- **Segment time origin** for per-segment clocks: first non-null of `t_load`, `t_dom_ready`, `t_start`; else the first event's `t`.

## 4. DOM representation

```ts
type DomNode = ElementNode | TextNode | CommentNode;   // [v1-unchanged]

interface ElementNode {
  id: number; kind: "element"; tag: string;
  attrs: Record<string, string>;
  children: DomNode[];
  canvas_size?: { w: number; h: number };
  media_src?: string;
}
interface TextNode    { id: number; kind: "text"; text: string }
interface CommentNode { id: number; kind: "comment"; text: string }
```

Mutations address nodes by integer ID (`dom.*` events, §5.1). Node IDs are scoped to a **keyframe span** (a keyframe plus its continuation segments), assigned in first-seen order; numbering restarts at each keyframe.

**[NEW] Exclusion attribute.** An element bearing `data-record-exclude` (name open to bikeshed; "record" rather than "replay" because the content never enters the file) is represented as an **empty placeholder node**: its `id`, `kind`, and `tag` appear in the tree; its attributes, children, and content do not. This keeps sibling positions and event targets coherent (eng-review OV-3): events whose target lies inside an excluded subtree reference the placeholder's `id` and carry no anchor identity. **Dynamic toggling:** adding the attribute to an already-recorded element emits `dom.remove` of its children and attribute clearing, leaving the placeholder; removing the attribute emits `dom.add` of a freshly numbered subtree. Producers MAY additionally support configurable exclusion selectors with identical semantics. Useful for consent text and sensitive UI; CH uses it for guard bait.

## 5. Event types

All events carry `t` (§7). Every array is time-sorted.

### 5.1 DOM mutations [v1-unchanged]

```ts
type DomMutation =
  | { type: "dom.add";    t: number; parent: number; before: number | null; node: DomNode }
  | { type: "dom.remove"; t: number; node: number }
  | { type: "dom.attr";   t: number; node: number; name: string; value: string | null }
  | { type: "dom.text";   t: number; node: number; text: string };
```

### 5.2 Input events

```ts
type InputRecord =
  | { type: "mouse.move"; t: number; x: number; y: number }                       // [v1-unchanged]
  | { type: "mouse.down" | "mouse.up" | "mouse.click";                            // [v1-unchanged]
      t: number; x: number; y: number; button: number; target: number | null }
  | { type: "touch.start" | "touch.move" | "touch.end";                           // [v1-unchanged]
      t: number; touches: { id: number; x: number; y: number }[] }
  | { type: "key.down" | "key.up";                                                // [v1-unchanged]
      t: number; key: string; code: string;
      mods: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
      repeat: boolean; target: number | null }
  | { type: "key.down" | "key.up"; t: number; redacted: true }                    // [NEW] redacted variant: NO other fields
  | { type: "input.value";   t: number; node: number; value: string }             // [v1-unchanged]
  | { type: "input.value";   t: number; node: number; redacted: true; value_len: number }  // [NEW]
  | { type: "input.checked"; t: number; node: number; checked: boolean }          // [v1-unchanged]
  | { type: "input.select";  t: number; node: number; values: string[] };         // [v1-unchanged]
```

Coordinate frame is normative: **client (viewport) coordinates** (§7). Non-move input events MAY carry alignment fields (§6).

### 5.3 Clipboard events

```ts
interface ClipboardRecord {
  type: "clipboard.copy" | "clipboard.cut" | "clipboard.paste" | "clipboard.drop";  // drop is [NEW]
  t: number;
  target: number | null;
  text: string | null;    // content mode
  html: string | null;    // content mode
  len: number | null;     // length-only mode
  redacted?: true;        // [NEW] target inside a redacted subtree: text/html null, len allowed
}
```

Two conforming producer modes: **content** (`text`/`html` set — jsPsych-v1 behavior) and **length-only** (`len` set, content withheld — CH-v1 behavior, on privacy grounds: pasted text routinely contains identifying material from outside the page). Both are valid v2; players must render sensibly with either. Regardless of mode, clipboard events targeting redacted subtrees MUST use the redacted variant. **Proposed default for the shared engine: content mode** — the current jsPsych-recorder behavior, kept deliberately rather than inherited: flagged for explicit sign-off, since the default propagates to every v9 recording. CH's own adapter defaults to length-only, matching its documented behavior.

### 5.4 Media and canvas [v1-unchanged]

```ts
type MediaRecord = {
  type: "media.play" | "media.pause" | "media.ended" | "media.seeked" | "media.time";
  t: number; node: number; current_time: number;
};
interface CanvasSnapshot {
  type: "canvas.snapshot"; t: number; node: number; data_url: string;
  region?: { x: number; y: number; w: number; h: number };  // patch to composite; absent = full baseline
}
```

### 5.5 Focus and visibility

```ts
interface FocusRecord { type: "focus" | "blur" | "fullscreen.enter" | "fullscreen.exit"; t: number }  // [v1-unchanged]
// [NEW]:
{ type: "visibility.hidden" | "visibility.visible"; t: number }
```

`visibility.*` records Page Visibility API transitions — tab-away, distinct from window blur.

### 5.6 Scroll [v1-unchanged]

```ts
type ScrollRecord =
  | { type: "scroll.window";  t: number; x: number; y: number }
  | { type: "scroll.element"; t: number; node: number; x: number; y: number };
```

### 5.7 Recording lifecycle [NEW]

`recording.capture_stopped {t, reason: "buffer_limit" | "error"}` — emitted once, into the segment open at stop time (or a final label-less segment if none is open), if the producer stops capturing before session end. The top-level `truncated` flag mirrors it. Players MUST surface truncation rather than presenting a partial recording as complete.

### 5.8 Unknown event types

Players MUST skip event types they don't recognize (forward compatibility within the major). Producers MAY emit vendor events only inside `extensions` (§9), never as top-level unknown types.

## 6. Alignment fields [NEW, optional]

Any discrete (non-move) input event MAY carry:

```ts
camera: {
  scroll_x: number; scroll_y: number;        // window scroll at event time
  viewport_w: number; viewport_h: number;    // layout viewport
  client_w: number; client_h: number;        // documentElement client box
  dpr: number;                               // devicePixelRatio at event time
  vv_scale: number;                          // visualViewport.scale (pinch zoom)
  vv_offset_x: number; vv_offset_y: number;  // visualViewport offsets (pinch pan)
}
anchor: {
  tag: string;
  id: string | null;                         // omitted for redacted targets (§8)
  rect: { x: number; y: number; w: number; h: number };  // client-frame rect at event time
  node: number | null;                       // target's node ID in the current keyframe span
}
```

Purpose: replay reconstructions drift (fonts, images, layout), and without capture-time geometry a player cannot *detect* that it is drawing the cursor on the wrong element — it fails confidently. With these fields a player can cross-check the reconstruction against what was actually under the pointer and flag disagreement instead of guessing (CH's viewer runs five such checks per anchored event; the checks themselves are player behavior, not spec). The `dpr`/`vv_*` fields exist so zoom and pinch states are classifiable per event, independent of the debounced `viewport_changes` stream.

Cost honesty (eng-review): alignment fields never ride `mouse.move`, but typing-heavy studies emit many key events; producers MAY omit alignment fields on `key.up` and on `repeat: true` key events to bound cost, and each anchored event carries complete blocks or none (no delta encoding).

## 7. Semantics

- **Time**: every `t` is a float in milliseconds relative to `recording_started_at_perf`. Producers MAY round (CH rounds to 0.1 ms). Consumers MUST NOT assume fixed sampling rates: moves, scrolls, and input events may be throttled or coalesced.
- **Total event order [NEW]**: each array (segment `events`, `stylesheet_events`, `viewport_changes`) is time-sorted; the session-wide order is the merge of all streams by `t`. At equal `t`, precedence is `stylesheet_events` → `viewport_changes` → segment events; within one array, array order is authoritative. Two conforming players MUST reconstruct identical state from the same file.
- **Coordinates**: all event `x`/`y` and all `rect` values are **client (viewport) coordinates**. Page positions derive from scroll state (scroll events, `initial_state.scroll`, `camera.scroll_*`).
- **Node IDs**: integers, scoped to keyframe spans (§3), first-seen order.
- **`target: null` disambiguation [NEW]**: null means "no applicable target node" (e.g., outside the observed root). Excluded targets reference their placeholder node's id (§4); redacted targets keep their node reference while anchors omit identity (§8). The three cases are therefore distinguishable.
- **`index`**: MUST equal the segment's array position. Strict validation (§11) rejects disagreement; tolerant loaders trust array order.
- **RNG states**: `rng_calls` is non-null iff `rng` is non-null. `rng: null` means RNG capture was off; `rng` present with an empty `rng_calls` means capture was on and nothing fired.

## 8. Privacy and redaction

**Scope [strengthened, eng-review]: redaction is a property of the FILE, not of event capture.** A redacted subtree's content must not appear anywhere in the serialized recording: not in `initial_dom` attributes or text, not in `initial_state.form`, not in `dom.text`/`dom.attr` mutations, not in key identities, not in clipboard payloads, not in anchor identity. The conformance leak-scan fixture verifies exactly this property (a typed sentinel and its per-character keystrokes appear nowhere in the JSON).

Floor (MUST): values of `<input type="password">` are never recorded, in any channel.

Standard mechanism: producers MAY accept a redaction selector; any event or serialization touching a matched subtree emits the redacted variants — `key.* {t, type, redacted: true}` (no key, code, mods, repeat, or target identity), `input.value {t, node, redacted: true, value_len}`, clipboard events with `redacted: true` (§5.3) — and anchors on redacted targets omit `id`. Detection is declarative (`type="password"` or explicit designation), never heuristic.

**Known limitation — timing side channel**: redacted key events keep exact timestamps, and inter-keystroke timing carries information about content. Producers who need to close this channel MAY quantize redacted-event timestamps (e.g., to 100 ms); the spec does not mandate it. Analysts should treat redaction as protecting content, not typing rhythm.

## 9. Extensions

`extensions: { "<vendor>": JsonValue }` at session, segment, and event level. Vendor keys are lowercase slugs (`"cyborg-hunter"`). Players MUST ignore vendors they don't recognize and MUST preserve extension data when re-serializing (§11). CH-v1's `ch_extensions` moves to `extensions["cyborg-hunter"]` unchanged in content.

## 10. File format

UTF-8 JSON; optionally gzip-compressed. Consumers detect gzip by extension (`.json.gz`), MIME type, or magic bytes [v1-unchanged player behavior, now normative]. Players SHOULD enforce a decompressed-size ceiling before parsing (protection against decompression bombs; a configurable limit with a generous default).

## 11. Validation — two profiles [refined, eng-review]

- **Strict conformance profile** (fixtures, CI, producer development): full-schema validation — every declared field type-checked, `index` agreement, time-sortedness, keyframe/continuation legality, redaction leak-scan on designated fixtures. Producers prove themselves here.
- **Tolerant loader profile** (runtime, opening files): reject only `schema_version !== 2`, missing `recorder` identity, missing `segments` array, or segments without `events[]`. Everything else loads with warnings and documented defaults. Rationale: recordings are unrepeatable participant data; rejection at runtime is data loss, and strictness lives in CI where it hits the developer instead of the analyst.
- **Preservation rule**: unknown fields and unknown event types MUST survive load → save **semantically intact** — every key and value preserved; formatting, key order, and numeric spelling are free. (Byte-identity is not required; JSON round-trips don't preserve it.)

## 12. Player requirements [NEW section]

- **Security**: recording content is untrusted input — attacker-controlled DOM, CSS, URLs, and (content-mode) clipboard HTML. Players MUST NOT execute scripts or event handlers from recording content; MUST render navigation and form submission inert; SHOULD isolate reconstruction (sandboxed iframe or equivalent); SHOULD apply a network policy for external assets (block, allow, or ask); and SHOULD bound decompression (§10). Both existing players already behave this way; v2 makes it normative.
- **Truncation**: surface `truncated` recordings visibly (§5.7).
- **Unrecordable regions**: render placeholders for content the format cannot carry (§13) — e.g., a labeled box where an iframe was — rather than silent emptiness.

## 13. Known capture limitations [NEW section]

The format does not capture: **shadow DOM** (web-component internals), **iframes** (embedded surveys/videos: only the frame element itself is recorded), **`<input type="file">`** (file names/contents never recorded), **CSSOM-bypass style changes** (rules edited via the CSSOM API without DOM mutation, common in CSS-in-JS — the stylesheet observer misses them), **media/WebGL pixel content** (canvas 2D snapshots excepted), and **DOM outside the observed root** (including extension-injected UI). For analysts: absence of evidence in these channels is not evidence of absence — e.g., "no paste event" cannot distinguish "didn't paste" from "pasted into an embedded iframe." Players render placeholders per §12.

**Asset rot**: reconstruction loads images/fonts/linked CSS from their original URLs; recordings replayed years later may show a different page than the participant saw as hosting decays. Recordings used as adjudication evidence should be replayed near collection time, or their assets archived alongside (asset inlining is a possible future extension, out of scope for v2.0).

## 14. Migration notes

**From jsPsych v1** (mechanical, plus one player feature): renames — `jspsych_version` → `recorder`+`host`; `display_element_id` → `observed_root`; `trials` → `segments`; `trial_index` → `index` (+ new `label`); `trial_data` → `host_data`; add `truncated: false`. DOM encoding, event vocabulary, stylesheets, viewport, RNG, and timestamps are unchanged. Player: validator + property paths, the skip-unknown-events rule, and **continuation-segment support (§3) — the one change touching the player's core replay model**; jsPsych's own recordings never contain continuations, so it only matters when opening files from persistent-DOM producers. jsPsych-v1 *recordings* migrate by **conversion** (a v1→v2 converter tool; players stay v2-only; no dual-read).

**From CH v1** (large, absorbed by CH): node-tree DOM + `dom.*` mutations replace HTML-string snapshots + nonce markers + `mutation` patches; dotted `type` names replace flat `kind`; the page-coordinate pair is dropped (client frame is normative); `metadata` dissolves into the top level; stylesheets object → two arrays with IDs (CH gains stylesheet-change expression); `view_state` returns generalized as `initial_state`; `ch_extensions` → `extensions["cyborg-hunter"]`; `capture_failures` → vendor extension (with `recording.capture_stopped` as the standard total-stop signal); `tier`/`keys` config echo → vendor extension.

## 15. Open questions for review

1. **Clipboard default** (§5.3): content or length-only as the shared engine's default? (Drafted: content, per current jsPsych behavior — sign off deliberately.)
2. **Redaction as standard** (§8): adopt the full mechanism, or only the password floor?
3. **Alignment fields** (§6): accept as standard-optional, or push to `extensions`?
4. **Keyframes/continuations** (§3): accept continuation segments + `initial_state` (player learns keyframe-seek), or mandate keyframes everywhere?
5. **Naming** (rename freely): `segments` (fallback: keep `trials`/`trial_data`); `host_data`; `observed_root`; `data-record-exclude`; `visibility.*`.
6. **`recording.capture_stopped` + `truncated`** (§5.7): accept as standard?
7. **Merge-order rule** (§7): accept the cross-array precedence as stated?

## Appendix — conformance fixture matrix

Fixture discipline: **hand-authored canonical fixtures** (consumer contract — small, reviewed, stable) are kept separate from **generated producer recordings** (integration evidence — recorded by real recorders). Expectations include **checkpoint oracles** — expected DOM/form/style/viewport state at marked times — not just event counts.

| Fixture | Kind | Producer | Exercises |
|---|---|---|---|
| `canonical-core` | hand-authored | — | minimal valid v2: keyframed segments, dom.*, input events, oracle checkpoints |
| `jspsych-full` | generated | jsPsych demo timeline via the v1→v2 converter | DOM mutations, mouse/keyboard, canvas region-diff, media, form state, clipboard (content mode), fullscreen, RNG, stylesheets |
| `plain-html-bracketed` | generated | CH standalone | `host: null`, nullable `plugin`, explicit bracketing, camera/anchor fields |
| `plain-html-unbracketed` | generated | CH standalone | single whole-session segment, null segment fields |
| `scroll-stress` | generated | CH standalone, scripted | rapid scroll→click, mid-segment resize/zoom: camera under stale-state pressure, `viewport_changes`, alignment-uncertainty flagging |
| `keyframe-continuation` | generated | CH standalone, persistent DOM | keyframes every Nth segment, `initial_state` seeds, node-ID span scoping, seek-to-keyframe |
| `redacted` | generated | either | password + redaction selector; **whole-file sentinel leak-scan**: typed sentinel and its keystrokes appear nowhere |
| `length-only-clipboard` | generated | CH standalone | clipboard length-only mode |
| `forward-compat` | hand-authored | — | unknown event type + unknown fields at every level + foreign vendor extension: renders without error; load→save preserves all semantically |
| `aborted` | generated | either | `end_reason: "aborted"`, open segment (`t_end: null`) |
| `truncated` | generated | CH standalone, tiny buffer cap | `recording.capture_stopped`, `truncated: true` |
| `negative-*` | hand-authored | — | rejection/warning behavior: duplicate node IDs, invalid references, unsorted/tied events, illegal continuation chains (continuation before any keyframe), `index` mismatch, corrupted gzip, decompression bomb |
| `gzip` | generated | any of the above, compressed | gzip detection path |

Both projects' CIs load every fixture through the strict conformance profile; players load and replay every positive fixture. The two `plain-html` fixtures are the structural guarantee of host neutrality: a jsPsych-ism in the shared engine breaks them.
