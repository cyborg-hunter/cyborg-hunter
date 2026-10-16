// ch.js with the recorder bundled, on a page without a framework: replay is
// on by default and every POST carries the page's recording so far in a
// second hidden input, cyborgHunterReplay (src/oneliner/adapters/vanilla.js,
// src/replay/pieces.js). Never in sessionStorage, which could not hold it.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { setBuild, buildOf } from './support/build-flags.js';
import { attach as attachRecorder } from '../../src/replay/index.js';
import { CyborgHunterReplayExtension } from '../../src/jspsych/extension-cyborg-hunter-replay.js';
import { groupPieces, reassemblePieces } from '../../src/replay/pieces.js';
import { validateStrict } from '../../src/shared/schema-v2-validator.js';

class StubResizeObserver { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} }
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

let restoreBuild;
before(() => { restoreBuild = setBuild(buildOf('ch.js')); });
after(() => restoreBuild());

let win, boot, errors, orig, ctx, nativeFormSubmit;
beforeEach(async () => {
  win = new Window({ url: 'https://lab.example/page1.html' });
  global.window = win; global.document = win.document; global.Node = win.Node;
  global.MutationObserver = win.MutationObserver; global.ResizeObserver = StubResizeObserver;
  ({ boot } = await import('../../src/oneliner/boot.js'));
  nativeFormSubmit = win.HTMLFormElement.prototype.submit;
  errors = [];
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (m) => errors.push(String(m)); console.warn = () => {}; console.info = () => {};
  // What entry-replay.js bundles: both globals, defined before boot.
  win.CyborgHunterReplay = { attach: attachRecorder };
  win.jsPsychCyborgHunterReplay = CyborgHunterReplayExtension;
  ctx = null;
});
afterEach(() => {
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  if (ctx && ctx.vanilla) ctx.vanilla.teardown();
  if (ctx && ctx.monitor) { try { ctx.monitor.destroy(); } catch { /* destroyed */ } }
  if (ctx && ctx.replay && ctx.replay.api) { try { ctx.replay.api.destroy(); } catch { /* destroyed */ } }
  win.HTMLFormElement.prototype.submit = nativeFormSubmit;
  win.close();
  delete global.window; delete global.document; delete global.Node; delete global.MutationObserver; delete global.ResizeObserver;
});

async function start(dataset) {
  ctx = boot({ script: { dataset: Object.assign({ participantId: 'P-PAGE', guards: 'none' }, dataset || {}), src: 'https://cdn/x/ch.js' }, win });
  assert.ok(ctx);
  await tick();   // the standalone recorder starts on a microtask
  return ctx;
}

function el(html) {
  const host = win.document.createElement('div');
  host.innerHTML = html;
  win.document.body.appendChild(host);
  return host.firstElementChild;
}

// A form whose submit stays on the page (no navigation in happy-dom).
function form(method) {
  const f = el('<form method="' + (method || 'post') + '" action="/submit"><textarea name="answer"></textarea></form>');
  f.addEventListener('submit', (e) => e.preventDefault());
  return f;
}
const submit = (f) => f.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
const click = (node) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const fieldOf = (f) => f.querySelector('input[name="cyborgHunterReplay"]');

function rebuild(pieces) {
  const groups = groupPieces(pieces);
  assert.equal(groups.size, 1, 'one recording');
  const rec = reassemblePieces([...groups.values()][0]);
  assert.deepStrictEqual(validateStrict(rec).errors, []);
  return rec;
}

describe('ch.js with the bundled recorder on a page without a framework', () => {
  it('a POST carries the page recording so far; nothing of it goes into sessionStorage', async () => {
    const c = await start();
    assert.deepStrictEqual(c.config.replay, { tier: 'trace' });
    assert.equal(c.host, 'vanilla');
    click(el('<button>one</button>'));
    const f = form();
    submit(f);
    const input = fieldOf(f);
    assert.ok(input, 'the replay input is there');
    const rec = rebuild(JSON.parse(input.value));
    assert.equal(rec.participant_id, 'P-PAGE');
    assert.ok(rec.segments.some((s) => s.events.some((e) => e.type === 'mouse.click')), 'the click is recorded');
    for (let i = 0; i < win.sessionStorage.length; i++) {
      const v = win.sessionStorage.getItem(win.sessionStorage.key(i));
      assert.ok(!v.includes('ch-replay-piece'), 'no piece in sessionStorage');
    }
    assert.equal(win.document.querySelectorAll('script[src*="cyborg-hunter-replay"]').length, 0);
    assert.deepStrictEqual(errors, []);
  });

  it('a later submit on the same page carries the earlier pieces too (a cancelled submit loses nothing)', async () => {
    await start();
    const f = form();
    click(el('<button>first</button>'));
    submit(f);
    const first = JSON.parse(fieldOf(f).value);
    click(el('<button>second</button>'));
    submit(f);
    const second = JSON.parse(fieldOf(f).value);
    assert.deepStrictEqual(second.slice(0, first.length), first);
    assert.ok(second.length > first.length);
    const rec = rebuild(second);
    assert.equal(rec.segments.filter((s) => s.events.some((e) => e.type === 'mouse.click')).length, 2);
    assert.deepStrictEqual(errors, []);
  });

  // ch.js writes the session (pasted text included) and the pieces so far
  // into hidden inputs at submit time. When the page stays (a cancelled
  // submit), the dom tier's keyframes used to record those inputs' values:
  // every later piece carried the earlier pieces and the pasted text, and
  // the recording grew geometrically. The inputs are not participant
  // content and must stay out of the recording on every tier.
  it('dom tier: the hidden inputs ch.js adds never enter the recording', async () => {
    await start({ replay: 'dom' });
    const f = form();
    const ta = f.querySelector('textarea');
    const paste = new win.Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = { getData: () => 'PASTE-SENTINEL-7' };
    ta.dispatchEvent(paste);
    for (let i = 0; i < 12; i++) {   // past keyframeEvery (10): keyframes follow
      click(el('<button>b' + i + '</button>'));
      submit(f);
    }
    assert.ok(win.document.querySelector('input[name="cyborgHunterData"]').value.includes('PASTE-SENTINEL-7'),
      'sanity: the session field holds the pasted text');
    const pieces = JSON.parse(fieldOf(f).value);
    const rec = rebuild(pieces);
    assert.ok(rec.segments.filter((s) => s.initial_dom).length >= 2, 'sanity: a second keyframe was taken');
    const json = JSON.stringify(pieces);
    assert.equal(json.split('PASTE-SENTINEL-7').length - 1, 0, 'the pasted text is not in the recording');
    assert.ok(!json.includes('cyborgHunterReplay') && !json.includes('cyborgHunterData'),
      'the hidden inputs are not in the recording');
    assert.deepStrictEqual(errors, []);
  });

  it('dom tier: a page\'s own cyborgHunterData input is kept out of the recording too', async () => {
    await start({ replay: 'dom' });
    const f = form();
    f.insertAdjacentHTML('beforeend', '<input type="hidden" name="cyborgHunterData">');
    submit(f);
    assert.equal(f.querySelector('input[name="cyborgHunterData"]').getAttribute('data-record-exclude'), '');
  });

  it('a recorder the page started before ch.js goes on; ch.js saves no pieces and logs no error', async () => {
    const own = attachRecorder({ participantId: 'P-PAGE', autoSave: { mode: 'none' } });
    own.startSession();
    await start();
    click(el('<button>x</button>'));
    const f = form();
    submit(f);
    assert.equal(fieldOf(f), null, 'no replay field');
    assert.equal(win.CyborgHunter.data().cyborgHunterReplay, undefined);
    assert.ok(own.getRecording().segments.some((s) => s.events.some((e) => e.type === 'mouse.click')), 'the page recorder recorded the click');
    assert.deepStrictEqual(errors, []);
    own.destroy();
  });

  it('a GET form gets no replay input', async () => {
    await start();
    click(el('<button>x</button>'));
    const f = form('get');
    submit(f);
    assert.equal(fieldOf(f), null);
  });

  it('CyborgHunter.data() returns the pieces as cyborgHunterReplay', async () => {
    await start();
    click(el('<button>x</button>'));
    const out = win.CyborgHunter.data();
    assert.ok(Array.isArray(out.cyborgHunterReplay));
    rebuild(out.cyborgHunterReplay);
  });

  it('data-replay="off": no replay input and nothing in data()', async () => {
    await start({ replay: 'off' });
    click(el('<button>x</button>'));
    const f = form();
    submit(f);
    assert.equal(fieldOf(f), null);
    assert.equal(win.CyborgHunter.data().cyborgHunterReplay, undefined);
  });
});
