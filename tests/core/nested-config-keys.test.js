// A typo inside a nested config section used to fail open with no warning:
// collectForPostHoc, signals and thresholds are merged over their defaults
// with Object.assign, and validateConfig() only checks top-level keys, so
// `collectForPostHoc: { pasteDropContents: false }` (an extra s) left paste
// text collection ON. init() now warns for every unknown key inside those
// three sections, naming the closest valid key; it never throws.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';

let win, monitor, init;

beforeEach(async () => {
  win = new Window();
  global.window = win;
  global.document = win.document;
  global.Node = win.Node;
  global.MutationObserver = win.MutationObserver;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  ({ init } = await import('../../src/core/monitor.js'));
});

afterEach(() => {
  if (monitor) { try { monitor.destroy(); } catch { /* already destroyed */ } }
  monitor = null;
  win.close();
  delete global.window;
  delete global.document;
  delete global.Node;
  delete global.MutationObserver;
  delete global.ResizeObserver;
});

function captureWarnings(fn) {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return warnings;
}

describe('unknown keys inside nested config sections', () => {
  it('warns for a privacy-switch typo in collectForPostHoc, naming the closest key', () => {
    const warnings = captureWarnings(() => {
      monitor = init({ participantId: 'N1', collectForPostHoc: { pasteDropContents: false } });
    });
    assert.deepStrictEqual(warnings, [
      '[cyborg-hunter] Unknown config key "collectForPostHoc.pasteDropContents" — did you mean "pasteDropContent"?'
    ]);
  });

  // responseText was a placeholder that no code ever read; it is gone, and a
  // config that still passes it is told so instead of being silently accepted.
  it('warns for collectForPostHoc.responseText, which does nothing', () => {
    const warnings = captureWarnings(() => {
      monitor = init({ participantId: 'N0', collectForPostHoc: { responseText: true } });
    });
    assert.deepStrictEqual(warnings, ['[cyborg-hunter] Unknown config key "collectForPostHoc.responseText"']);
  });

  it('warns for typos in signals and thresholds too', () => {
    const warnings = captureWarnings(() => {
      monitor = init({ participantId: 'N2', signals: { tabAWay: false }, thresholds: { typingSpeedCPS: 12, zzzz: 1 } });
    });
    assert.deepStrictEqual(warnings, [
      '[cyborg-hunter] Unknown config key "signals.tabAWay" — did you mean "tabAway"?',
      '[cyborg-hunter] Unknown config key "thresholds.typingSpeedCPS" — did you mean "typingSpeedCps"?',
      '[cyborg-hunter] Unknown config key "thresholds.zzzz"'
    ]);
  });

  it('stays silent for valid keys in every preset, and for a section that is not an object', () => {
    for (const preset of ['permissive', 'standard', 'strict']) {
      const warnings = captureWarnings(() => {
        monitor = init({
          participantId: 'N3', preset,
          collectForPostHoc: { pasteDropContent: false, rawMouseTrack: false, elementTrace: true,
            fullKeystrokeTimestamps: true, windowPositionLog: false, foreignInputContent: false },
          signals: { keystrokeDynamics: true, paste: true, mouseTracking: false },
          thresholds: { tabAwayDurationMs: 5000, maxWindowPositions: null, typingSpeedCps: 12 }
        });
      });
      assert.deepStrictEqual(warnings, [], preset);
    }
    assert.doesNotThrow(() => {
      const warnings = captureWarnings(() => { monitor = init({ participantId: 'N4', signals: null, thresholds: undefined }); });
      assert.deepStrictEqual(warnings, []);
    });
  });
});

// A privacy switch given anything but true or false used to fail open: the
// listeners test truthiness, so the string 'false' (from a JSON or URL
// config) kept pasted text. Now only true turns a collectForPostHoc switch
// on; any other non-boolean value turns it off and warns.
describe('collectForPostHoc switches fail closed', () => {
  function pasteOnce(cfg) {
    const warnings = captureWarnings(() => { monitor = init(Object.assign({ participantId: 'FC' }, cfg)); });
    monitor.startSession();
    monitor.startTrial({ trialId: 't1' });
    const ev = new win.Event('paste', { bubbles: true });
    ev.clipboardData = { getData: () => 'PASTED-MONITOR' };
    win.document.body.dispatchEvent(ev);
    const trial = monitor.endTrial();
    return { warnings, trial };
  }

  it("pasteDropContent: 'false' keeps the length only, with a warning", () => {
    const { warnings, trial } = pasteOnce({ collectForPostHoc: { pasteDropContent: 'false' } });
    assert.strictEqual(trial.pasteEvents.length, 1);
    assert.ok(!('text' in trial.pasteEvents[0]), 'no pasted text');
    assert.ok(warnings.some((w) => /collectForPostHoc\.pasteDropContent/.test(w) && /off/.test(w)), warnings.join('\n'));
  });

  it('true and false work as before, with no warning', () => {
    const on = pasteOnce({ collectForPostHoc: { pasteDropContent: true } });
    assert.strictEqual(on.trial.pasteEvents[0].text, 'PASTED-MONITOR');
    assert.deepStrictEqual(on.warnings, []);
    monitor.destroy(); monitor = null;
    const off = pasteOnce({ collectForPostHoc: { pasteDropContent: false } });
    assert.ok(!('text' in off.trial.pasteEvents[0]));
    assert.deepStrictEqual(off.warnings, []);
  });
});
