// tests/core/device-facts.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { init, readDeviceFacts, readSoftwareRenderer } from '../../src/core/monitor.js';
import { PRESETS } from '../../src/shared/constants.js';

const saved = { navigator: globalThis.navigator, matchMedia: globalThis.matchMedia };
afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: saved.navigator, configurable: true, writable: true });
  globalThis.matchMedia = saved.matchMedia;
});

function fakeBrowser({ maxTouchPoints = 0, webdriver = false, coarse = false, throwing = false } = {}) {
  Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints, webdriver }, configurable: true, writable: true });
  globalThis.matchMedia = throwing ? () => { throw new Error('no matchMedia'); } : (q) => ({ matches: q === '(pointer: coarse)' && coarse });
}

// readDeviceFacts() leaves softwareRenderer null: the renderer is read later,
// when the browser is idle (see 'the renderer read at startSession' below).
describe('readDeviceFacts', () => {
  it('reads a desktop', () => {
    fakeBrowser();
    assert.deepEqual(readDeviceFacts(), { maxTouchPoints: 0, coarsePointer: false, webdriver: false, softwareRenderer: null });
  });
  it('reads a phone', () => {
    fakeBrowser({ maxTouchPoints: 5, coarse: true });
    assert.deepEqual(readDeviceFacts(), { maxTouchPoints: 5, coarsePointer: true, webdriver: false, softwareRenderer: null });
  });
  it('reads a driver', () => {
    fakeBrowser({ webdriver: true });
    assert.equal(readDeviceFacts().webdriver, true);
  });
  it('leaves coarsePointer null when matchMedia throws', () => {
    fakeBrowser({ throwing: true });
    assert.deepEqual(readDeviceFacts(), { maxTouchPoints: 0, coarsePointer: null, webdriver: false, softwareRenderer: null });
  });
  it('returns nulls without a navigator', () => {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
    assert.deepEqual(readDeviceFacts(), { maxTouchPoints: null, coarsePointer: null, webdriver: null, softwareRenderer: null });
  });
});

// A document whose canvas gives a WebGL context naming `renderer`. RENDERER
// reads the name itself (as in Firefox) or, with `masked`, "WebKit WebGL" (as
// in Chrome and Safari), which leaves the name to WEBGL_debug_renderer_info;
// `debugExt: false` leaves that extension out. The spy records each
// extension asked for, the canvases made, and whether the context was lost.
function stubDoc(renderer, { masked = false, debugExt = true } = {}) {
  const spy = { asked: [], canvases: 0, lost: false };
  const gl = {
    RENDERER: 0x1F01,
    getExtension(name) {
      spy.asked.push(name);
      if (name === 'WEBGL_debug_renderer_info') return debugExt ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null;
      if (name === 'WEBGL_lose_context') return { loseContext() { spy.lost = true; } };
      return null;
    },
    getParameter(p) {
      if (p === 0x1F01) return masked ? 'WebKit WebGL' : renderer;
      if (p === 0x9246) return renderer;
      return null;
    },
  };
  spy.doc = { createElement: (tag) => { spy.canvases++; return tag === 'canvas' ? { getContext: (kind) => (kind === 'webgl' ? gl : null) } : null; } };
  return spy;
}

const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
const HARDWARE = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';

describe('readSoftwareRenderer', () => {
  it('names the software family, never the renderer string', () => {
    const cases = [
      [SWIFTSHADER, 'swiftshader'],
      ['llvmpipe (LLVM 15.0.7, 256 bits)', 'llvmpipe'],
      ['Gallium 0.4 on softpipe', 'softpipe'],
      ['Microsoft Basic Render Driver', 'microsoft-basic-render'],
      ['Mesa OffScreen', 'mesa-offscreen'],
    ];
    for (const [renderer, family] of cases) {
      for (const masked of [false, true]) {
        const r = readSoftwareRenderer(stubDoc(renderer, { masked }).doc);
        assert.equal(r, family, renderer + (masked ? ' (masked)' : ''));
        assert.notEqual(r, renderer);
      }
    }
  });

  it('a hardware renderer is false', () => {
    assert.equal(readSoftwareRenderer(stubDoc(HARDWARE).doc), false);
    assert.equal(readSoftwareRenderer(stubDoc('Apple GPU', { masked: true }).doc), false);
  });

  it("no WebGL context is 'none'", () => {
    assert.equal(readSoftwareRenderer({ createElement: () => ({ getContext: () => null }) }), 'none');
  });

  it('an exception, or a name that cannot be read, is null', () => {
    assert.equal(readSoftwareRenderer({ createElement: () => { throw new Error('x'); } }), null);
    assert.equal(readSoftwareRenderer({ createElement: () => ({}) }), null);   // no getContext
    const lost = { createElement: () => ({ getContext: () => ({ getParameter() { throw new Error('lost'); } }) }) };
    assert.equal(readSoftwareRenderer(lost), null);
    assert.equal(readSoftwareRenderer(stubDoc(42).doc), null);   // not a string
    // Masked, and the extension that would unmask it is missing: "WebKit
    // WebGL" says nothing about the hardware.
    assert.equal(readSoftwareRenderer(stubDoc(SWIFTSHADER, { masked: true, debugExt: false }).doc), null);
  });

  it('reads RENDERER first, and asks for the debug extension only when RENDERER is masked', () => {
    const plain = stubDoc('Google SwiftShader');
    assert.equal(readSoftwareRenderer(plain.doc), 'swiftshader');
    assert.ok(!plain.asked.includes('WEBGL_debug_renderer_info'), plain.asked.join());
    const masked = stubDoc(SWIFTSHADER, { masked: true });
    assert.equal(readSoftwareRenderer(masked.doc), 'swiftshader');
    assert.ok(masked.asked.includes('WEBGL_debug_renderer_info'), masked.asked.join());
  });

  it('releases the context either way', () => {
    for (const masked of [false, true]) {
      const s = stubDoc(HARDWARE, { masked });
      readSoftwareRenderer(s.doc);
      assert.ok(s.lost, 'masked: ' + masked);
    }
  });
});

describe('signals.softwareRenderer', () => {
  it('every preset declares the switch, on', () => {
    for (const [name, p] of Object.entries(PRESETS)) assert.equal(p.signals.softwareRenderer, true, name);
  });
});

// startSession reads the renderer once the browser is idle (creating a WebGL
// context can hold up the page), so the fact is null until then. A fake
// requestIdleCallback holds the callback until the test runs it.
describe('the renderer read at startSession', () => {
  let win, monitor, idle, canvas;
  const saved = { ric: globalThis.requestIdleCallback, cic: globalThis.cancelIdleCallback };

  function fakeIdle() {
    const fake = { calls: [], cancelled: [], pending: new Map(), next: 1 };
    fake.run = () => {
      const fns = [...fake.pending.values()];
      fake.pending.clear();
      fns.forEach((fn) => fn({ didTimeout: false, timeRemaining: () => 0 }));
    };
    globalThis.requestIdleCallback = (fn, opts) => {
      const id = fake.next++;
      fake.calls.push({ fn, opts, id });
      fake.pending.set(id, fn);
      return id;
    };
    globalThis.cancelIdleCallback = (id) => { fake.cancelled.push(id); fake.pending.delete(id); };
    return fake;
  }

  // Canvases made by the page's document come from the stub; null leaves
  // happy-dom's own canvas, which gives no WebGL context.
  function useCanvas(renderer) {
    delete win.document.createElement;   // back to happy-dom's own
    if (renderer === null) return null;
    const stub = stubDoc(renderer);
    const create = win.document.createElement.bind(win.document);
    win.document.createElement = (tag, o) => (tag === 'canvas' ? stub.doc.createElement(tag) : create(tag, o));
    return stub;
  }

  const device = () => monitor.getSessionReport().device;

  beforeEach(() => {
    win = new Window();
    Object.assign(globalThis, { window: win, document: win.document, Node: win.Node, MutationObserver: win.MutationObserver,
      ResizeObserver: class { observe() {} disconnect() {} } });
    idle = fakeIdle();
    canvas = null;
  });

  afterEach(() => {
    if (monitor) { try { monitor.destroy(); } catch { /* already destroyed */ } }
    monitor = null;
    win.close();
    for (const k of ['window', 'document', 'Node', 'MutationObserver', 'ResizeObserver']) delete globalThis[k];
    for (const [k, v] of [['requestIdleCallback', saved.ric], ['cancelIdleCallback', saved.cic]]) {
      if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
    }
  });

  it('is null until the browser is idle, then the family, and the report never holds the renderer string', () => {
    canvas = useCanvas(SWIFTSHADER);
    monitor = init({ participantId: 'P1' });
    monitor.startSession();
    assert.equal(idle.calls.length, 1);
    assert.deepEqual(idle.calls[0].opts, { timeout: 1000 });
    assert.equal(device().softwareRenderer, null);
    assert.equal(canvas.canvases, 0, 'nothing read before the callback');
    idle.run();
    assert.equal(device().softwareRenderer, 'swiftshader');
    assert.equal(device().webdriver !== undefined, true, 'the other facts stay');
    assert.ok(!JSON.stringify(monitor.getSessionReport()).includes('SwiftShader'));
    assert.ok(!JSON.stringify(monitor.getRawData()).includes('SwiftShader'));
  });

  it("is false on a graphics card and 'none' without WebGL", () => {
    for (const [renderer, expected] of [[HARDWARE, false], [null, 'none']]) {
      useCanvas(renderer);
      monitor = init({ participantId: 'P1' });
      monitor.startSession();
      assert.equal(device().softwareRenderer, null);
      idle.run();
      assert.equal(device().softwareRenderer, expected, String(renderer));
      monitor.destroy();
    }
  });

  it('destroy() cancels a pending read, and a callback that runs anyway reads nothing', () => {
    canvas = useCanvas(SWIFTSHADER);
    monitor = init({ participantId: 'P1' });
    monitor.startSession();
    const { fn, id } = idle.calls[0];
    monitor.destroy();
    assert.deepEqual(idle.cancelled, [id]);
    idle.run();
    fn({ didTimeout: true, timeRemaining: () => 0 });   // a host scheduler that ignored the cancel
    assert.equal(canvas.canvases, 0);
    assert.equal(monitor.getSessionReport().device.softwareRenderer, null);
  });

  it('nothing is scheduled with the switch off, or with a value that is not true', () => {
    const warnings = [];
    const warn = console.warn;
    console.warn = (m) => warnings.push(String(m));
    try {
      for (const off of [false, 'false']) {
        monitor = init({ participantId: 'P1', signals: { softwareRenderer: off } });
        monitor.startSession();
        assert.equal(idle.calls.length, 0, JSON.stringify(off));
        assert.equal(device().softwareRenderer, null);
        monitor.destroy();
      }
    } finally {
      console.warn = warn;
    }
    assert.ok(warnings.some((w) => w.includes('signals.softwareRenderer must be true or false')), warnings.join('\n'));
  });

  it('falls back to a one-second timer where requestIdleCallback is missing', () => {
    delete globalThis.requestIdleCallback;
    delete globalThis.cancelIdleCallback;
    canvas = useCanvas(SWIFTSHADER);
    const timers = [];
    const cleared = [];
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    // Only the one-second timers are held; any other passes through. Nothing
    // here awaits, so the stubs are back before the runner needs a timer.
    globalThis.setTimeout = (fn, ms, ...rest) => {
      if (ms !== 1000) return realSet(fn, ms, ...rest);
      const id = { fake: timers.length };
      timers.push({ fn, id });
      return id;
    };
    globalThis.clearTimeout = (id) => (id && id.fake !== undefined ? cleared.push(id) : realClear(id));
    try {
      monitor = init({ participantId: 'P1' });
      monitor.startSession();
      assert.equal(timers.length, 1);
      assert.equal(device().softwareRenderer, null);
      timers[0].fn();
      assert.equal(device().softwareRenderer, 'swiftshader');
      // A pending timer goes with destroy().
      monitor = init({ participantId: 'P2' });
      monitor.startSession();
      monitor.destroy();
      assert.deepEqual(cleared, [timers[1].id]);
      assert.equal(canvas.canvases, 1, 'only the first monitor read');
    } finally {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    }
  });
});
