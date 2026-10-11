// tests/core/mouse-provenance.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attachMouseSignals } from '../../src/core/signals/mouse.js';

// attachMouseSignals names document and window as the listeners' targets;
// Node has neither, and the ctx below never touches the target.
globalThis.document = globalThis.document || {};
globalThis.window = globalThis.window || {};

// A ctx the way monitor.js builds it, with the listeners captured instead of
// attached, so a synthetic event object can be fed to each handler.
function makeCtx() {
  const handlers = {};
  const trialData = { startTime: performance.now() - 1000, mouseEvents: [] };
  const ctx = {
    config: { signals: { mouseTracking: true }, thresholds: { mouseThrottleMs: 50, mouseMaxEvents: 2000 } },
    trialData,
    addTrialListener(target, type, handler) { handlers[type] = handler; }
  };
  attachMouseSignals(ctx);
  return { handlers, trialData };
}

const move = (over) => ({ pageX: 120, pageY: 340, clientX: 120, clientY: 40, ...over });
const click = (over) => ({ pageX: 120, pageY: 340, clientX: 120, clientY: 40, isTrusted: true, detail: 1, pointerType: 'mouse', ...over });

describe('mouse samples carry viewport coordinates', () => {
  it('a move records cx, cy beside x, y', () => {
    const { handlers, trialData } = makeCtx();
    handlers.mousemove(move({ pageY: 340, clientY: 40 }));
    const s = trialData.mouseEvents[0];
    assert.equal(s.type, 'move');
    assert.deepEqual([s.x, s.y, s.cx, s.cy], [120, 340, 120, 40]);
  });
});

describe('clicks carry their provenance', () => {
  it('a trusted pointer click records trusted, detail and pointerType', () => {
    const { handlers, trialData } = makeCtx();
    handlers.click(click());
    const s = trialData.mouseEvents[0];
    assert.equal(s.type, 'click');
    assert.equal(s.trusted, true);
    assert.equal(s.detail, 1);
    assert.equal(s.pointerType, 'mouse');
    assert.deepEqual([s.cx, s.cy], [120, 40]);
  });
  it('a scripted click records trusted false and detail 0', () => {
    const { handlers, trialData } = makeCtx();
    handlers.click(click({ isTrusted: false, detail: 0, pointerType: undefined }));
    const s = trialData.mouseEvents[0];
    assert.equal(s.trusted, false);
    assert.equal(s.detail, 0);
    assert.equal('pointerType' in s, false);
  });
  it('a keyboard-activated click records trusted true and detail 0', () => {
    const { handlers, trialData } = makeCtx();
    handlers.click(click({ detail: 0, pointerType: undefined }));
    assert.equal(trialData.mouseEvents[0].trusted, true);
    assert.equal(trialData.mouseEvents[0].detail, 0);
  });
  it('down and up carry the same fields', () => {
    const { handlers, trialData } = makeCtx();
    handlers.mousedown(click({ pointerType: 'pen' }));
    handlers.mouseup(click({ pointerType: 'pen' }));
    assert.deepEqual(trialData.mouseEvents.map(e => [e.type, e.trusted, e.detail, e.pointerType]),
      [['down', true, 1, 'pen'], ['up', true, 1, 'pen']]);
  });
  it('the cap still holds with the extra fields', () => {
    const { handlers, trialData } = makeCtx();
    for (let i = 0; i < 2005; i++) handlers.click(click());
    assert.equal(trialData.mouseEvents.length, 2000);
  });
});
