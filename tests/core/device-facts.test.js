// tests/core/device-facts.test.js
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readDeviceFacts } from '../../src/core/monitor.js';

const saved = { navigator: globalThis.navigator, matchMedia: globalThis.matchMedia };
afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: saved.navigator, configurable: true, writable: true });
  globalThis.matchMedia = saved.matchMedia;
});

function fakeBrowser({ maxTouchPoints = 0, webdriver = false, coarse = false, throwing = false } = {}) {
  Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints, webdriver }, configurable: true, writable: true });
  globalThis.matchMedia = throwing ? () => { throw new Error('no matchMedia'); } : (q) => ({ matches: q === '(pointer: coarse)' && coarse });
}

describe('readDeviceFacts', () => {
  it('reads a desktop', () => {
    fakeBrowser();
    assert.deepEqual(readDeviceFacts(), { maxTouchPoints: 0, coarsePointer: false, webdriver: false });
  });
  it('reads a phone', () => {
    fakeBrowser({ maxTouchPoints: 5, coarse: true });
    assert.deepEqual(readDeviceFacts(), { maxTouchPoints: 5, coarsePointer: true, webdriver: false });
  });
  it('reads a driver', () => {
    fakeBrowser({ webdriver: true });
    assert.equal(readDeviceFacts().webdriver, true);
  });
  it('leaves coarsePointer null when matchMedia throws', () => {
    fakeBrowser({ throwing: true });
    assert.deepEqual(readDeviceFacts(), { maxTouchPoints: 0, coarsePointer: null, webdriver: false });
  });
  it('returns nulls without a navigator', () => {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
    assert.deepEqual(readDeviceFacts(), { maxTouchPoints: null, coarsePointer: null, webdriver: null });
  });
});
