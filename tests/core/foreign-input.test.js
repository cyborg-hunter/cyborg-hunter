// tests/core/foreign-input.test.js
// Pins the onSignal payload of "typingOutsideExperiment" to the
// collectForPostHoc.foreignInputContent switch. The trial log already
// omitted the typed characters when the switch was off, but the payload
// handed to the researcher's onSignal callback carried them regardless.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { attachForeignInputSignals } from '../../src/core/signals/typing.js';

// The listener target is only handed to ctx.addTrialListener, so an empty
// object suffices for `document` in node (same harness as clipboard.test.js).
beforeEach(() => { globalThis.document = {}; });

function captureCtx(foreignInputContent) {
  const handlers = {};
  const fired = [];
  return {
    handlers,
    fired,
    config: { collectForPostHoc: { foreignInputContent } },
    trialData: { foreignInputEvents: [] },
    addTrialListener: (target, event, handler) => { handlers[event] = handler; },
    fireSignal: (type, e, data) => fired.push({ type, data }),
    // false = the target lies outside the experiment container
    isKnownInput: () => false,
  };
}

const inputEvent = {
  target: { tagName: 'TEXTAREA', id: 'sidebar-box', className: 'chat' },
  inputType: 'insertText',
  data: 'k',
};

describe('onSignal payload content switch (foreign input)', () => {
  it('omits typed data from the payload when foreignInputContent is off', () => {
    const ctx = captureCtx(false);
    attachForeignInputSignals(ctx);
    ctx.handlers.input(inputEvent);
    assert.strictEqual(ctx.fired[0].type, 'typingOutsideExperiment');
    const data = ctx.fired[0].data;
    assert.ok(!('data' in data), 'data key must be absent');
    assert.strictEqual(data.targetTag, 'TEXTAREA');
    assert.strictEqual(data.targetId, 'sidebar-box');
    assert.strictEqual(data.targetClass, 'chat');
    assert.ok(!('data' in ctx.trialData.foreignInputEvents[0]));
  });

  it('includes typed data in the payload when foreignInputContent is on', () => {
    const ctx = captureCtx(true);
    attachForeignInputSignals(ctx);
    ctx.handlers.input(inputEvent);
    assert.strictEqual(ctx.fired[0].data.data, 'k');
    assert.strictEqual(ctx.fired[0].data.targetTag, 'TEXTAREA');
  });
});
