// tests/replay/viewer-fit.test.js
// The stage's size: the recorded viewport scaled to fit the room the viewer
// has, on both axes; a 1:1 mode at the recorded pixel size, scrolling inside
// the fitted room; and fullscreen. happy-dom has no layout, so the room is
// stated (viewer-harness.js `env`): the mount's width and the window's
// height. The viewer's own controls measure 0 px here, so the whole height is
// the stage's; the browser test (tests/e2e/report/replay-fit.spec.js) has the
// real controls.
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { boot, baseRecording, segment, bodyKeyframe } from './support/viewer-harness.js';

// A one-segment dom-tier recording of a w×h CSS px page.
const recordedAt = (w, h) => baseRecording({
  viewport: { w, h, dpr: 1, scale: 1, offset_x: 0, offset_y: 0 },
  segments: [segment({ initial_dom: bodyKeyframe([]) })],
});
const stageSize = (v) => {
  const s = v.mount.querySelector('.replay-stage');
  return [parseFloat(s.style.width), parseFloat(s.style.height)];
};

describe('the stage fits the recorded viewport into the room on both axes', () => {
  it('a wide recording fills the width, and the height follows its shape', () => {
    const v = boot(recordedAt(1600, 900), {}, { mountWidth: 800, innerHeight: 1000 });
    assert.deepEqual(stageSize(v), [800, 450]);
    assert.equal(v.dbg.getCamera().k, 0.5);
  });

  it('a tall recording fits the window\'s height and keeps its shape', () => {
    const v = boot(recordedAt(400, 1000), {}, { mountWidth: 800, innerHeight: 600 });
    assert.deepEqual(stageSize(v), [240, 600]);
    assert.equal(v.dbg.getCamera().k, 0.6);
  });

  it('fitHeight is the room in place of the window: a number, or a function asked at each sizing', () => {
    assert.deepEqual(stageSize(boot(recordedAt(400, 1000), { fitHeight: 500 }, { mountWidth: 800, innerHeight: 2000 })), [200, 500]);
    let room = 300;
    const v = boot(recordedAt(400, 1000), { fitHeight: () => room }, { mountWidth: 800, innerHeight: 2000 });
    assert.deepEqual(stageSize(v), [120, 300]);
    room = 800;
    v.win.dispatchEvent(new v.win.Event('resize'));
    assert.deepEqual(stageSize(v), [320, 800]);
  });

  it('the width is capped at 960 px unless maxStageWidth says otherwise; null lifts the cap', () => {
    const env = { mountWidth: 1400, innerHeight: 2000 };
    assert.deepEqual(stageSize(boot(recordedAt(1600, 900), {}, env)), [960, 540]);
    assert.deepEqual(stageSize(boot(recordedAt(1600, 900), { maxStageWidth: 1200 }, env)), [1200, 675]);
    assert.deepEqual(stageSize(boot(recordedAt(1600, 900), { maxStageWidth: null }, env)), [1400, 788]);
  });

  it('the room\'s width is the mount\'s content box: padding (the fullscreen viewer has some) is not the stage\'s', () => {
    const v = boot(recordedAt(1600, 400), {}, { mountWidth: 832, innerHeight: 2000 });
    assert.deepEqual(stageSize(v), [832, 208]);
    v.mount.style.padding = '12px 16px';
    v.win.dispatchEvent(new v.win.Event('resize'));
    assert.deepEqual(stageSize(v), [800, 200]);
  });

  it('a header that grows during play (a chip shown) leaves the stage as it is until the room itself changes', () => {
    const env = { mountWidth: 800, innerHeight: 600 };
    const v = boot(recordedAt(400, 1000), {}, env);
    // happy-dom lays nothing out: the controls' height is stated through the
    // ticker's bottom edge (the header's top is 0, the stage's box 0 px).
    let controls = 100;
    v.mount.querySelector('.replay-ticker').getBoundingClientRect = () =>
      ({ top: controls, bottom: controls, left: 0, right: 0, width: 0, height: 0 });
    env.innerHeight = 700;
    v.win.dispatchEvent(new v.win.Event('resize'));
    assert.deepEqual(stageSize(v), [240, 600]);
    // A chip appears and wraps the header onto another row. The mount grows,
    // so its observer (and here the window's resize, which shares the check)
    // asks again; the room has not changed, so the stage holds.
    v.mount.querySelector('[data-ch-zoom-note]').style.display = '';
    controls = 124;
    v.win.dispatchEvent(new v.win.Event('resize'));
    assert.deepEqual(stageSize(v), [240, 600]);
    // The next real change of room measures the controls again.
    env.innerHeight = 800;
    v.win.dispatchEvent(new v.win.Event('resize'));
    assert.deepEqual(stageSize(v), [270, 675]);
  });

  it('a segment load measures the header as the segment opens, its view chips shown', () => {
    const env = { mountWidth: 800, innerHeight: 700 };
    const v = boot(recordedAt(400, 1000), {}, env);
    // The DPR advisory adds a header row; the controls' height follows it.
    const dprChip = v.mount.querySelector('[data-ch-dpr-note]');
    v.mount.querySelector('.replay-ticker').getBoundingClientRect = () => {
      const b = dprChip.style.display === 'none' ? 100 : 124;
      return { top: b, bottom: b, left: 0, right: 0, width: 0, height: 0 };
    };
    // Recorded at DPR 1, now viewed at DPR 2: the segment's opening shows the chip.
    Object.defineProperty(v.win, 'devicePixelRatio', { configurable: true, value: 2 });
    v.dbg.selectSegment(0);
    assert.equal(dprChip.style.display, '');
    assert.deepEqual(stageSize(v), [230, 575]);
  });

  it('a window that grows taller refits the stage: its height is watched, not only the mount\'s width', () => {
    const env = { mountWidth: 800, innerHeight: 500 };
    const v = boot(recordedAt(400, 1000), {}, env);
    assert.deepEqual(stageSize(v), [200, 500]);
    env.innerHeight = 900;
    v.win.dispatchEvent(new v.win.Event('resize'));
    assert.deepEqual(stageSize(v), [360, 900]);
    assert.equal(v.dbg.getCamera().k, 0.9);
  });
});

describe('1:1', () => {
  it('shows the recorded page at its own pixel size, scrolling inside a box the size of the room', () => {
    const v = boot(recordedAt(1600, 900), {}, { mountWidth: 800, innerHeight: 1000 });
    const btn = v.mount.querySelector('.replay-size');
    assert.equal(btn.textContent, '1:1');
    btn.click();
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
    // The control keeps its name; aria-pressed and its pressed styling show
    // the state (the report's figure control does the same).
    assert.equal(btn.textContent, '1:1');
    assert.deepEqual(stageSize(v), [1600, 900]);
    assert.equal(v.dbg.getCamera().k, 1);
    const wrap = v.mount.querySelector('.replay-stage-wrap');
    assert.ok(wrap.classList.contains('replay-actual'));
    assert.deepEqual([wrap.style.width, wrap.style.height], ['800px', '900px']);
    btn.click();
    assert.deepEqual(stageSize(v), [800, 450]);
    assert.deepEqual([wrap.style.width, wrap.style.height], ['', '']);
    assert.equal(v.dbg.getCamera().k, 0.5);
  });
});

describe('fullscreen', () => {
  it('is offered only where the document may go fullscreen', () => {
    assert.equal(boot(recordedAt(1000, 800), {}, { fullscreenEnabled: false }).mount.querySelector('.replay-fullscreen'), null);
    assert.ok(boot(recordedAt(1000, 800), {}, { fullscreenEnabled: true }).mount.querySelector('.replay-fullscreen'));
  });

  it('asks for the whole viewer, then fits the screen with no width cap, and fits the page again after', () => {
    const env = { mountWidth: 800, innerHeight: 600, fullscreenEnabled: true, fullscreenElement: null };
    const v = boot(recordedAt(1600, 900), {}, env);
    assert.deepEqual(stageSize(v), [800, 450]);
    let asked = 0;
    v.mount.requestFullscreen = () => { asked++; return Promise.resolve(); };
    const btn = v.mount.querySelector('.replay-fullscreen');
    btn.click();
    assert.equal(asked, 1);
    // The browser's part: the viewer now fills a 1920×1080 screen.
    Object.assign(env, { fullscreenElement: v.mount, mountWidth: 1920, innerHeight: 1080 });
    v.win.document.dispatchEvent(new v.win.Event('fullscreenchange'));
    assert.deepEqual(stageSize(v), [1920, 1080]);
    assert.equal(btn.textContent, 'Exit fullscreen');
    Object.assign(env, { fullscreenElement: null, mountWidth: 800, innerHeight: 600 });
    v.win.document.dispatchEvent(new v.win.Event('fullscreenchange'));
    assert.deepEqual(stageSize(v), [800, 450]);
    assert.equal(btn.textContent, 'Fullscreen');
  });
});
