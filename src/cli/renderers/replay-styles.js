// src/cli/renderers/replay-styles.js
// The replay viewer's CSS (.replay-* rules), shared by the CLI report
// (html-index-core.js puts it in the report's second <style>) and the
// analyze page's replay host (demo/replay-host.js, which receives it from the
// page's worker). One copy: the demo used to keep a hand-synced duplicate,
// which had drifted. Rules reference the report's
// tokens (--ink, --surface, --line, --bg, --dim, --hard and the --ff-* font
// stacks); a host document must declare them.

export const REPLAY_STYLES_CSS = `    /* Replay viewer (see replay-viewer.client.js) — matches report house style */
    .replay-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 8px 0; }
    .replay-badge { font-family: var(--ff-sora); font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 0;
                    background: var(--ink); color: var(--surface); }
    .replay-badge[data-tier="trace"] { background: var(--surface); color: var(--ink);
                    border: 1px solid var(--line); }
    .replay-stage { position: relative; overflow: hidden; background: var(--surface);
                    border: 1px solid var(--line); border-radius: 0; }
    .replay-frame { position: absolute; top: 0; left: 0; border: 0; }
    .replay-overlay { position: absolute; top: 0; left: 0; pointer-events: none; }
    .replay-neutral { background: #e8e6e0; }
    .replay-neutral-label { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
                            font-family: var(--ff-recursive); color: var(--dim); font-size: 13px; }
    .replay-lane { display: block; margin-top: 6px; border-radius: 2px; }
    .replay-scrub { display: block; margin: 2px 0 4px; }
    .replay-ticker { font: 12px/1.3 var(--ff-majormono);
                     color: var(--dim); font-variant-numeric: tabular-nums;
                     height: 1.4em; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .replay-note { font-family: var(--ff-recursive); font-size: 12px; color: var(--dim); }
    .replay-warn { color: var(--hard); }
    .replay-pause-toggle { font-family: var(--ff-recursive); }
    /* Controls share the report's flat, line-bordered button style */
    .replay-play, .replay-load-btn, .replay-css-btn, .replay-segment-select, .replay-speed {
      padding: 4px 10px; border: 1px solid var(--line); background: var(--surface);
      color: var(--ink); border-radius: 4px; cursor: pointer;
      font-family: var(--ff-recursive); font-size: 13px; }
    /* Play is the transport's primary action: a round ink button. Its hover
       is its own (darker ink); the light shared hover below would leave a
       white ▶ on a light ground. */
    .replay-play { background: var(--ink); color: var(--surface); border-color: var(--ink);
                   width: 36px; height: 30px; padding: 0; border-radius: 50%; }
    .replay-play:hover { background: #2b2b2b; }
    .replay-load-btn:hover, .replay-css-btn:hover { background: var(--bg); }
    .replay-play:disabled, .replay-load-btn:disabled { opacity: 0.6; cursor: default; }
    .replay-fetch-css-label { font-family: var(--ff-recursive); margin-left: 10px; font-size: 12px; color: #555; }
    .replay-unstyled { position: absolute; left: 0; right: 0; top: 0; z-index: 3; background: #fff4dd; color: #7a4b00; border-bottom: 1px solid #e8b24a; padding: 6px 10px; font-family: var(--ff-recursive); font-size: 12px; line-height: 1.4; }
    .replay-css-btn { font-size: 12px; padding: 2px 8px; }
    .replay-clock { font: 12px/1.3 var(--ff-majormono);
                    font-variant-numeric: tabular-nums; }
    .replay-keycast { position: absolute; left: 0; right: 0; bottom: 0; display: flex;
                    gap: 4px; padding: 5px 6px; pointer-events: none; flex-wrap: wrap-reverse; }
    .replay-key-chip { font: 400 13px/1.2 var(--ff-tomorrow);
                    background: rgba(0,0,0,0.72); color: #fff; padding: 3px 9px;
                    border-radius: 2px; white-space: nowrap; }
    .replay-key-chip--redacted { background: rgba(0,0,0,0.5); font-style: italic; }
    /* Media is reported as state, never played (design §7): the badges say what
       the recorded element was doing, in the stage's top-left. */
    .replay-media { position: absolute; left: 0; top: 0; display: flex; gap: 4px;
                    padding: 5px 6px; pointer-events: none; flex-wrap: wrap; }
    .replay-media-badge { font: 11px/1.2 var(--ff-tomorrow);
                    background: rgba(0,137,123,0.85); color: #fff; padding: 2px 7px;
                    border-radius: 3px; white-space: nowrap; }`;
