// tests/core/clipboard.test.js
// Pins independent gating of the drop signal.
//
// Fresh-eyes fix (2026-07-04): the drop listener was attached under
// `if (config.signals.paste)` — a copy-paste error. Disabling paste
// silently disabled drop (a separately hard-scored signal). Presets now
// declare `drop` explicitly and the listener is gated on it.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { attachClipboardSignals } from '../../src/core/signals/clipboard.js';
import { PRESETS } from '../../src/shared/constants.js';

// attachClipboardSignals references the global `document` only as a listener
// target handed to ctx.addTrialListener, so an empty object suffices in node.
beforeEach(() => { globalThis.document = {}; });

function fakeCtx(signals) {
  const attached = [];
  return {
    attached,
    config: {
      signals,
      thresholds: { pasteMinChars: 0, dropMinChars: 0 },
      collectForPostHoc: { pasteDropContent: false },
    },
    trialData: { pasteEvents: [], copyEvents: [], dropEvents: [] },
    sessionData: { pasteCount: 0, copyCount: 0, dropCount: 0 },
    addTrialListener: (target, event, handler) => attached.push(event),
    fireSignal: () => {},
    isKnownInput: () => null,
  };
}

describe('drop signal gating', () => {
  it('attaches the drop listener when drop is enabled and paste is disabled', () => {
    const ctx = fakeCtx({ paste: false, copy: false, drop: true });
    attachClipboardSignals(ctx);
    assert.ok(ctx.attached.includes('drop'),
      'drop must be attachable independently of paste');
    assert.ok(!ctx.attached.includes('paste'));
  });

  it('does not attach the drop listener when drop is explicitly disabled', () => {
    const ctx = fakeCtx({ paste: true, copy: false, drop: false });
    attachClipboardSignals(ctx);
    assert.ok(!ctx.attached.includes('drop'),
      'explicit drop:false must win even when paste is on');
    assert.ok(ctx.attached.includes('paste'));
  });

  it('every preset declares drop explicitly', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      assert.strictEqual(preset.signals.drop, true,
        `preset "${name}" must declare drop: true`);
    }
  });
});

// ── onSignal payload respects collectForPostHoc.pasteDropContent ──
// The trial log already omitted pasted/dropped text when the switch was off,
// but the onSignal payload carried it regardless. These pin the payload to the
// same switch: `text` is present only when pasteDropContent is true.

function captureCtx(pasteDropContent) {
  const handlers = {};
  const fired = [];
  return {
    handlers,
    fired,
    config: {
      signals: { paste: true, copy: false, drop: true },
      thresholds: { pasteMinChars: 0, dropMinChars: 0 },
      collectForPostHoc: { pasteDropContent },
    },
    trialData: { pasteEvents: [], copyEvents: [], dropEvents: [] },
    sessionData: { pasteCount: 0, copyCount: 0, dropCount: 0 },
    addTrialListener: (target, event, handler) => { handlers[event] = handler; },
    fireSignal: (type, e, data) => fired.push({ type, data }),
    isKnownInput: () => null,
  };
}

const pasteEvent = { target: {}, clipboardData: { getData: () => 'secret answer' } };
const dropEvent = { target: {}, dataTransfer: { getData: () => 'dropped words' } };

describe('onSignal payload content switch (paste/drop)', () => {
  it('omits pasted text from the payload when pasteDropContent is off', () => {
    const ctx = captureCtx(false);
    attachClipboardSignals(ctx);
    ctx.handlers.paste(pasteEvent);
    const data = ctx.fired[0].data;
    assert.strictEqual(ctx.fired[0].type, 'paste');
    assert.ok(!('text' in data), 'text key must be absent');
    assert.strictEqual(data.pastedLength, 13);
    assert.ok(!('text' in ctx.trialData.pasteEvents[0]));
  });

  it('includes pasted text in the payload when pasteDropContent is on', () => {
    const ctx = captureCtx(true);
    attachClipboardSignals(ctx);
    ctx.handlers.paste(pasteEvent);
    assert.strictEqual(ctx.fired[0].data.text, 'secret answer');
    assert.strictEqual(ctx.fired[0].data.pastedLength, 13);
  });

  it('omits dropped text from the payload when pasteDropContent is off', () => {
    const ctx = captureCtx(false);
    attachClipboardSignals(ctx);
    ctx.handlers.drop(dropEvent);
    const data = ctx.fired[0].data;
    assert.strictEqual(ctx.fired[0].type, 'drop');
    assert.ok(!('text' in data), 'text key must be absent');
    assert.strictEqual(data.droppedLength, 13);
  });

  it('includes dropped text in the payload when pasteDropContent is on', () => {
    const ctx = captureCtx(true);
    attachClipboardSignals(ctx);
    ctx.handlers.drop(dropEvent);
    assert.strictEqual(ctx.fired[0].data.text, 'dropped words');
    assert.strictEqual(ctx.fired[0].data.droppedLength, 13);
  });
});
