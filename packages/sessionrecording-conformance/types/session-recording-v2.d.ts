// SessionRecording v2 — TypeScript declarations.
//
// Hand-authored from docs/session-recording-v2.md §2–§7, the same source as
// `schema/session-recording-v2.schema.json`. Three statements of one format now
// exist — these types, that schema, and `src/validator.js` — and only two of
// them can be machine-compared: `test/schema-equivalence.test.js` holds the
// schema to the validator over every corpus fixture. These declarations are
// checked by a human reading them beside the schema, so keep the three in the
// same commit whenever one moves.
//
// Section numbers below are the spec's. Where the validator is stricter than
// the spec's prose reads, the comment says so and names the reason — the
// clipboard fields and `target` are the two places that matter.

export type JsonValue =
  | null | boolean | number | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** §9. Vendor keys are lowercase slugs: the namespace only works as an
 *  ignore-list if the names are predictable. */
export type Extensions = { [vendor: string]: JsonValue } | null;

// ── §2 top-level ───────────────────────────────────────────────────────────

export interface SessionRecording {
  schema_version: 2;
  recorder: NameVersion;
  /** The runtime the recorder was embedded in, if any. */
  host: NameVersion | null;
  participant_id: string | null;
  /** ISO 8601 wall clock. */
  recording_started_at: string;
  /** `performance.now()` at start; every event `t` is relative to this (§7). */
  recording_started_at_perf: number;
  user_agent: string;
  viewport: ViewportState;
  /** Selector of the observed subtree; null means `document.body`. */
  observed_root: string | null;
  stylesheets: StylesheetSnapshot[];
  stylesheet_events: StylesheetEvent[];
  /** Generalized trials (§3). */
  segments: SegmentRecording[];
  viewport_changes: ViewportChange[];
  rng: Rng | null;
  /** §7: non-null iff `rng` is non-null. `rng: null` means capture was off; a
   *  non-null `rng` with an empty array means it was on and nothing fired. */
  rng_calls: RngCall[] | null;
  ended_at_perf: number | null;
  end_reason: EndReason | null;
  /** §5.7: capture stopped early. Mirrors `recording.capture_stopped`. */
  truncated: boolean;
  extensions: Extensions;
}

export interface NameVersion { name: string; version: string }

export type EndReason = 'finished' | 'aborted' | 'unload';

export interface ViewportState {
  w: number; h: number; dpr: number;
  /** visualViewport pinch state. */
  scale: number; offset_x: number; offset_y: number;
}

export interface ViewportChange extends ViewportState { t: number }

export interface Rng { seed: string | null; math_random_patched: boolean }

export interface RngCall { t: number; fn: string; args: JsonValue; result: JsonValue }

export type StylesheetSnapshot =
  | { id: number; kind: 'inline'; css: string; media: string | null }
  | { id: number; kind: 'link'; href: string; css: string | null; media: string | null };

export type StylesheetEvent =
  | { type: 'stylesheet.add'; t: number; sheet: StylesheetSnapshot }
  | { type: 'stylesheet.remove'; t: number; id: number }
  | { type: 'stylesheet.update'; t: number; id: number; css: string };

// ── §3 segments ────────────────────────────────────────────────────────────

export interface SegmentRecording {
  /** §7: MUST equal the array position. */
  index: number;
  /** Host-assigned: a jsPsych trial id, or a researcher label standalone. */
  label: string | null;
  /** jsPsych plugin name; null outside jsPsych. */
  plugin: string | null;
  t_start: number | null;
  t_dom_ready: number | null;
  t_load: number | null;
  /** null when the segment is still open at recording end. */
  t_end: number | null;
  /** Present = keyframe (node numbering restarts at 1); null = continuation,
   *  carrying on from the previous segment's end state. */
  initial_dom: DomNode | null;
  /** Replay state established BEFORE this keyframe. A DOM tree carries none of
   *  it, so a keyframe is a full checkpoint only together with this. */
  initial_state: InitialState | null;
  events: RecordedEvent[];
  /** Was `trial_data` in v1. */
  host_data: JsonValue | null;
  extensions: Extensions;
}

export interface InitialState {
  /** Window scroll. */
  scroll: { x: number; y: number };
  /** Inner scrollers. */
  element_scroll: { node: number; x: number; y: number }[];
  /** Playback positions. */
  media: { node: number; current_time: number; paused: boolean }[];
  /** Form IDL state. */
  form: { node: number; value?: string; checked?: boolean; selected?: string[] }[];
}

// ── §4 DOM ─────────────────────────────────────────────────────────────────

export type DomNode = ElementNode | TextNode | CommentNode;

/**
 * §4's exclusion placeholder is why `attrs` and `children` are optional here
 * and checked as a PAIR by the validator: an element bearing
 * `data-record-exclude` appears with its id, kind and tag and NOTHING else, so
 * sibling positions and event targets stay coherent while the content never
 * enters the file. Both present is an ordinary element; both absent is the
 * placeholder; exactly one is a producer bug.
 */
export interface ElementNode {
  id: number;
  kind: 'element';
  tag: string;
  attrs?: Record<string, string>;
  children?: DomNode[];
  canvas_size?: { w: number; h: number };
  media_src?: string;
}

export interface TextNode { id: number; kind: 'text'; text: string }
export interface CommentNode { id: number; kind: 'comment'; text: string }

// ── §6 alignment (optional on any discrete input event) ────────────────────

export interface Camera {
  scroll_x: number; scroll_y: number;
  viewport_w: number; viewport_h: number;
  client_w: number; client_h: number;
  dpr: number;
  vv_scale: number; vv_offset_x: number; vv_offset_y: number;
}

export interface Anchor {
  tag: string;
  /** Omitted — not null — for redacted targets (§8). An explicit null is the
   *  different claim that the element had no id. */
  id?: string | null;
  /** Client-frame rect at event time. Typed when present: a producer whose
   *  `getBoundingClientRect` was unreadable omits it (routed to spec r3). */
  rect?: { x: number; y: number; w: number; h: number };
  /** The target's node id in the current keyframe span. */
  node: number | null;
}

/** §6: an anchored event carries complete blocks or none — no delta encoding —
 *  and alignment fields never ride `mouse.move`. */
export interface Aligned {
  camera?: Camera;
  anchor?: Anchor;
}

/** Every event carries `t` (§7) and may carry vendor data (§9). */
export interface EventBase extends Aligned {
  t: number;
  extensions?: Extensions;
}

// ── §5 events ──────────────────────────────────────────────────────────────

export type RecordedEvent =
  | DomMutation | InputRecord | ClipboardRecord | MediaRecord | CanvasSnapshot
  | FocusRecord | VisibilityRecord | ScrollRecord | CaptureStopped;

// §5.1
export type DomMutation = EventBase & (
  | { type: 'dom.add'; parent: number; before: number | null; node: DomNode }
  | { type: 'dom.remove'; node: number }
  | { type: 'dom.attr'; node: number; name: string; value: string | null }
  | { type: 'dom.text'; node: number; text: string }
);

// §5.2. Coordinates are client (viewport) coordinates (§7).
//
// `target` is required-but-nullable on every mouse and key record, and that is
// load-bearing: §7 makes three cases distinguishable — null means no applicable
// target node, a placeholder id means the target was inside an excluded subtree
// (§4), and a live id whose anchor omits `id` means a redacted target (§8). An
// absent key would be a fourth state the spec does not define.
export type InputRecord = EventBase & (
  | { type: 'mouse.move'; x: number; y: number }
  | { type: 'mouse.down' | 'mouse.up' | 'mouse.click';
      x: number; y: number; button: number; target: number | null }
  | { type: 'touch.start' | 'touch.move' | 'touch.end';
      touches: { id: number; x: number; y: number }[] }
  | { type: 'key.down' | 'key.up';
      key: string; code: string;
      mods: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
      repeat: boolean; target: number | null }
  /** The redacted variant carries NO identity fields at all (§5.2/§8). */
  | { type: 'key.down' | 'key.up'; redacted: true }
  | { type: 'input.value'; node: number; value: string }
  /** The redacted variant carries a length and no content. A surviving `value`
   *  is the plaintext the redaction removed. */
  | { type: 'input.value'; node: number; redacted: true; value_len: number }
  | { type: 'input.checked'; node: number; checked: boolean }
  | { type: 'input.select'; node: number; values: string[] }
);

/**
 * §5.3. All four content fields are stated on every clipboard event; the
 * PRODUCER MODE is expressed by which of them are null — content mode sets
 * `text`/`html`, length-only sets `len`. An absent key is silence, not a mode,
 * and a player cannot tell it from a producer bug. Both modes are conforming.
 */
export interface ClipboardRecord extends EventBase {
  type: 'clipboard.copy' | 'clipboard.cut' | 'clipboard.paste' | 'clipboard.drop';
  target: number | null;
  text: string | null;
  html: string | null;
  len: number | null;
  /** Target inside a redacted subtree: `text`/`html` null, `len` allowed. */
  redacted?: true;
}

// §5.4
export interface MediaRecord extends EventBase {
  type: 'media.play' | 'media.pause' | 'media.ended' | 'media.seeked' | 'media.time';
  node: number;
  current_time: number;
}

export interface CanvasSnapshot extends EventBase {
  type: 'canvas.snapshot';
  node: number;
  data_url: string;
  /** A patch to composite; absent means a full baseline. */
  region?: { x: number; y: number; w: number; h: number };
}

// §5.5
export interface FocusRecord extends EventBase {
  type: 'focus' | 'blur' | 'fullscreen.enter' | 'fullscreen.exit';
}

/** Page Visibility API transitions — tab-away, distinct from window blur. */
export interface VisibilityRecord extends EventBase {
  type: 'visibility.hidden' | 'visibility.visible';
}

// §5.6
export type ScrollRecord = EventBase & (
  | { type: 'scroll.window'; x: number; y: number }
  | { type: 'scroll.element'; node: number; x: number; y: number }
);

/** §5.7. Emitted once, into the segment open at stop time. The top-level
 *  `truncated` flag mirrors it, and players MUST surface truncation rather than
 *  presenting a partial recording as complete. */
export interface CaptureStopped extends EventBase {
  type: 'recording.capture_stopped';
  reason: 'buffer_limit' | 'error';
}
