// tests/browser/replay/support/seek-support.mjs
// Helpers for seek-budget.battery.mjs, copied verbatim from the investigation
// probes (cyborg-hunter-lab: probes/investigate/probe-support.mjs and
// deep-span-model.mjs, as of CH 59e831f). A test suite must not depend on an
// investigation harness (same convention as viewer-canvas.battery.mjs:93).

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, sep } from 'node:path';
import { readFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
// Depth adjusted for this file's location (probe-support.mjs used '..', '..').
const repoRoot = resolve(here, '..', '..', '..', '..');

// ── Static server ──────────────────────────────────────────────────────────

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };

/**
 * Serve `files` (a Map of path -> string) plus, as a fallback, files under
 * repoRoot. `isolate` adds COOP+COEP so the renderer is crossOriginIsolated
 * and performance.now() loses its 100 us Spectre clamp (a standard trick).
 */
export async function serveFiles(files, { isolate = true } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const head = {
      'Content-Type': MIME[extname(url.pathname)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    };
    if (isolate) {
      head['Cross-Origin-Opener-Policy'] = 'same-origin';
      head['Cross-Origin-Embedder-Policy'] = 'require-corp';
      head['Cross-Origin-Resource-Policy'] = 'same-origin';
    }
    if (files.has(url.pathname)) {
      res.writeHead(200, head);
      res.end(files.get(url.pathname));
      return;
    }
    const abs = resolve(repoRoot, '.' + url.pathname);
    if (!abs.startsWith(repoRoot + sep)) { res.writeHead(403).end(); return; }
    let body = null;
    try { body = await readFile(abs); } catch { /* 404 below */ }
    if (body === null) { res.writeHead(404, head); res.end('not found'); return; }
    res.writeHead(200, head);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

// ── Stats ──────────────────────────────────────────────────────────────────

export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function p95(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
export const minOf = (xs) => (xs.length ? Math.min(...xs) : NaN);
export const fixed = (x, n = 3) => (Number.isFinite(x) ? x.toFixed(n) : 'n/a');

// ── Deep-span model (from deep-span-model.mjs) ─────────────────────────────

/** Node count of a DomNode tree. */
export const countNodes = (d) => (d ? 1 + (d.children || []).reduce((a, c) => a + countNodes(c), 0) : 0);

function collectElementIds(dom, out = []) {
  if (!dom) return out;
  if (dom.kind === 'element') out.push(dom.id);
  (dom.children || []).forEach((c) => collectElementIds(c, out));
  return out;
}

/**
 * Text-node ids. §5.1's dom.text addresses TEXT and COMMENT nodes, so aiming
 * it at element ids both misstates the vocabulary and no-ops on any element
 * without a text first child — 78 of jspsych-full segment 11's 215 elements,
 * 36%, which is a third of the model's patches dirtying nothing.
 */
function collectTextIds(dom, out = []) {
  if (!dom) return out;
  if (dom.kind === 'text') out.push(dom.id);
  (dom.children || []).forEach((c) => collectTextIds(c, out));
  return out;
}

/** Every element's parent id, so a dom.add can re-attach where a remove took it from. */
function parentMap(dom, parent = null, out = new Map()) {
  if (!dom) return out;
  if (parent !== null) out.set(dom.id, parent);
  (dom.children || []).forEach((c) => parentMap(c, dom.id, out));
  return out;
}

/** Real canvas.snapshot payloads from a recording: 1 full baseline + N regions. */
export function realCanvasSnapshots(recording) {
  const all = [];
  recording.segments.forEach((s) => (s.events || []).forEach((e) => {
    if (e.type === 'canvas.snapshot') all.push({ region: e.region || null, data_url: e.data_url });
  }));
  const baseline = all.find((e) => !e.region && e.data_url.length > 100000) || all.find((e) => !e.region);
  const regions = all.filter((e) => e.region);
  return { baseline, regions };
}

/**
 * Non-anchored event mix, sized from jspsych-full's own 909 events:
 * dom.attr 25.6%, dom.remove 15.0%, dom.add 11.0%, mouse.move 19.4%.
 * Structural total (add + remove) is 26% there and 30% here — conservative.
 * The EVEN split between add and remove is a modelling choice: at the
 * fixture's 1.36:1 remove:add ratio a 10-segment span empties the tree by
 * segment 9, and removes that resolve nothing measure nothing, which is the
 * bias this mix exists to remove.
 */
const NON_ANCHORED_MIX = [
  'dom.remove', 'dom.attr', 'dom.add', 'dom.text', 'mouse.move',
  'dom.remove', 'dom.attr', 'dom.add', 'mouse.move', 'dom.text',
  'dom.remove', 'dom.attr', 'dom.add', 'mouse.move', 'mouse.move', 'mouse.move',
];

/**
 * The synthetic deep-span-plus-canvas model.
 * Segment 0 is the keyframe; 1..N-1 are continuations. Every segment carries
 * `eventsPerSegment` events at the requested anchored fraction, plus one
 * canvas.snapshot (seg 0 = the real full baseline, the rest = real regions).
 *
 * @param {object}  o
 * @param {object}  o.tree              the keyframe DomNode tree
 * @param {number}  o.segments          span depth (10 = recorder.js keyframeEvery)
 * @param {number}  o.eventsPerSegment
 * @param {number}  o.anchoredFrac      fraction carrying §6 camera+anchor blocks
 * @param {boolean} o.canvas            emit canvas.snapshot events + the canvas node
 * @param {object}  o.snapshots         { baseline, regions } from realCanvasSnapshots()
 * @returns {{canvasId:number, segments:object[]}}
 */
export function buildDeepSpanModel({ tree, segments, eventsPerSegment, anchoredFrac, canvas, snapshots }) {
  const elementIds = collectElementIds(tree).filter((i) => i !== tree.id);
  const textIds = collectTextIds(tree);
  const parents = parentMap(tree);
  // Removable pool: LEAF elements only (no element children). dom.remove purges
  // the node and its whole subtree from the id map, so a pool of arbitrary
  // elements makes later patches on purged descendants unresolvable — and an
  // unresolvable patch costs nothing, which is the exact bias this pool exists
  // to remove. Leaves purge only themselves and their text, their parents survive,
  // so the paired dom.add always re-attaches. On jspsych-full segment 11 this
  // gives 76 removable leaves, 139 stable elements and 306 stable text nodes.
  const hasElementChild = new Set();
  (function scan(n) {
    if (!n) return;
    if ((n.children || []).some((c) => c.kind === 'element')) hasElementChild.add(n.id);
    (n.children || []).forEach(scan);
  })(tree);
  const pool = elementIds.filter((i) => parents.has(i) && !hasElementChild.has(i));
  const poolSet = new Set(pool);
  // Non-structural patches and anchors address nodes no remove ever purges, so
  // every event in the model does the work it names.
  const stableEls = elementIds.filter((i) => !poolSet.has(i));
  const stableTexts = textIds.filter((i) => !poolSet.has(parents.get(i)));
  let removeIdx = 0, addIdx = 0, freshId = 800000;
  const snaps = snapshots;
  const canvasId = 900001;
  const withCanvas = JSON.parse(JSON.stringify(tree));
  withCanvas.children.push({
    id: canvasId, kind: 'element', tag: 'canvas',
    attrs: { id: 'span-canvas', width: '400', height: '300', style: 'display:block;width:400px;height:300px' },
    children: [], canvas_size: { w: 400, h: 300 },
  });

  // A re-added subtree. jspsych-full's 100 dom.add payloads average 1.96 nodes
  // (element + text child), with a handful running 35, so the model uses the
  // small shape by default and the large one at the fixture's own frequency.
  function reAddPayload(id, big) {
    const kids = [{ id: freshId++, kind: 'text', text: 'readded ' + id }];
    if (big) {
      for (let k = 0; k < 16; k++) {
        kids.push({
          id: freshId++, kind: 'element', tag: 'span', attrs: { class: 'ra' + k },
          children: [{ id: freshId++, kind: 'text', text: 'x' + k }],
        });
      }
    }
    return { id, kind: 'element', tag: 'div', attrs: { class: 'readded' }, children: kids };
  }

  const out = [];
  let t = 0;
  let mixIdx = 0;
  for (let s = 0; s < segments; s++) {
    const events = [];
    // INTERLEAVED, not blocked: a real seek alternates patches and anchored
    // events, so layout is dirty at most checks. Blocking them would measure
    // one forced layout followed by 19 free reads.
    const anchoredEvery = Math.max(1, Math.round(1 / anchoredFrac));
    for (let i = 0; i < eventsPerSegment; i++) {
      t += 5;
      const target = stableEls[(s * 7 + i * 13) % stableEls.length];
      if (i % anchoredEvery === 0) {
        // A discrete interaction: CH's capture puts both alignment blocks on
        // these (capture-trace.js withAlignment) and on nothing else.
        events.push({
          type: i % 3 === 0 ? 'mouse.click' : (i % 3 === 1 ? 'mouse.down' : 'key.down'),
          t, x: 40 + (i % 300), y: 40 + (i % 200), button: 0,
          // 1280x1000 is the frame the baseline measurement model laid out in. A
          // real player sizes its frame from these fields, so leaving them at
          // some other box would make the real viewer force layout over a
          // SMALLER area than the model did and quietly flatter it (a first pass
          // used 800x600 and read ~15% under the model). Inert for
          // the baseline harness, which never reads the camera block.
          camera: { scroll_x: 0, scroll_y: 0, client_w: 1280, client_h: 1000, w: 1280, h: 1000, dpr: 1, vv_scale: 1, vv_offset_x: 0, vv_offset_y: 0 },
          anchor: { tag: 'div', id: null, node: target, rect: { x: 10, y: 10, w: 50, h: 20 } },
        });
        continue;
      }
      const kind = NON_ANCHORED_MIX[mixIdx++ % NON_ANCHORED_MIX.length];
      if (kind === 'dom.attr') {
        events.push({ type: 'dom.attr', t, node: target, name: 'class', value: 'c' + (i % 5) });
      } else if (kind === 'dom.text') {
        events.push({ type: 'dom.text', t, node: stableTexts[(s * 5 + i * 11) % stableTexts.length], text: 'v' + i });
      } else if (kind === 'dom.remove') {
        events.push({ type: 'dom.remove', t, node: pool[removeIdx++ % pool.length] });
      } else if (kind === 'dom.add') {
        // Puts back what a remove took, under the parent it came from, so the
        // patch resolves and pays instantiation + insertion for real.
        const id = pool[addIdx++ % pool.length];
        events.push({
          type: 'dom.add', t, parent: parents.get(id), before: null,
          node: reAddPayload(id, addIdx % 50 === 0),
        });
      } else {
        events.push({ type: 'mouse.move', t, x: 10 + (i % 700), y: 10 + (i % 500) });
      }
    }
    if (canvas) {
      const snap = s === 0 ? snaps.baseline : snaps.regions[(s - 1) % snaps.regions.length];
      events.push({ type: 'canvas.snapshot', t: t + 1, node: canvasId, data_url: snap.data_url, ...(snap.region ? { region: snap.region } : {}) });
    }
    out.push({
      index: s,
      t_start: s * eventsPerSegment * 5,
      // +10 ms of tail, so the segment WINDOW ends strictly after its last
      // event (the canvas.snapshot at `t + 1`). The baseline measurement model
      // applies every event of every segment unconditionally and never reads
      // `t_end`, so this is inert there; a real player does not. It bounds
      // `durMs`, and a backward seek can only replay events at or before its
      // target, so with `durMs === lastEventT` the deepest backward seek this
      // fixture can express is a no-op — which is fast, silent, and exactly the
      // "measured nothing" failure the coverage assertions exist to catch.
      // (They caught it.)
      t_end: (s + 1) * eventsPerSegment * 5 + 10,
      initial_dom: s === 0 ? (canvas ? withCanvas : tree) : null,
      initial_state: null, events,
    });
  }
  return { canvasId, segments: out };
}
