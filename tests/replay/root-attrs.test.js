// tests/replay/root-attrs.test.js
// <html>'s attributes in a recording (src/replay/root-attrs.js): the keyframe
// snapshot `segments[i].extensions["cyborg-hunter"].root_attrs`, the change
// stream `extensions["cyborg-hunter"].root_attr_events`, and the viewer that
// applies both to the reconstruction's <html>. The hand-authored fixture
// tests/fixtures/replay/root-attrs.recording.json is the contract: it was
// written before the capture or the viewer could produce or read it.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

import * as CHReplay from '../../src/replay/index.js';
import { validateStrict } from '../../src/shared/schema-v2-validator.js';
import { boot } from './support/viewer-harness.js';
import { rootAttrsSnapshot, rootAttrChanges } from '../../src/replay/root-attrs.js';
import { buildViewerModel } from '../../src/replay/viewer-model.js';
import { applyRootAttrs } from '../../src/replay/dom-instantiate.js';

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/replay/root-attrs.recording.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

describe('the fixture', () => {
  it('passes the strict profile: the two keys live in the vendor slot', () => {
    assert.equal(validateStrict(clone(FIXTURE)).ok, true);
  });
});

describe('the viewer applies <html> attributes from the recording', () => {
  // [segment, segment-relative t] → what the reconstruction's <html> carries.
  const at = (v, seg, t) => {
    v.dbg.selectSegment(seg);
    v.dbg.seek(t);
    const html = v.doc().documentElement;
    const out = {};
    for (const a of html.attributes) out[a.name] = a.value;
    return out;
  };

  it('the keyframe snapshot, minus on* handlers', () => {
    const v = boot(clone(FIXTURE));
    assert.deepEqual(at(v, 0, 100), { lang: 'en', style: '--card-w: 120px;' });
  });

  it('the changes, at their times; a later seek back restores the snapshot', () => {
    const v = boot(clone(FIXTURE));
    assert.equal(at(v, 0, 1000).style, '--card-w: 120px;');
    assert.equal(at(v, 0, 2000).style, '--card-w: 80px;');
    assert.deepEqual(at(v, 0, 2900), { lang: 'en', style: '--card-w: 80px;', 'data-theme': 'dark' });
    assert.deepEqual(at(v, 1, 600), { style: '--card-w: 80px;', 'data-theme': 'dark' });
    assert.deepEqual(at(v, 0, 100), { lang: 'en', style: '--card-w: 120px;' });
  });

  it('the walk carries the change stream beside the events, after the sheets at an equal t', () => {
    const v = boot(clone(FIXTURE));
    v.dbg.selectSegment(1);
    v.dbg.seek(2000);
    assert.deepEqual(v.dbg.getWalk().map((w) => [w.seg, w.t, w.stream]),
      [[0, 1500, 'root-attr'], [0, 2500, 'root-attr'], [1, 500, 'root-attr'], [1, 1000, 'event']]);
  });

  it('a recording without the snapshot keeps the height pin and applies no stream', () => {
    const rec = clone(FIXTURE);
    delete rec.segments[0].extensions;
    rec.segments[0].initial_dom.attrs = { style: 'height: 100%;' };
    const v = boot(rec);
    const html = at(v, 0, 2000);
    assert.deepEqual(html, { style: 'height: 100%;' }, 'syncRootHeight, and nothing from root_attr_events');
  });

  it('a body patch to a percentage height pins <html> only in a recording without the snapshot', () => {
    const patch = { type: 'dom.attr', t: 500, node: 1, name: 'style', value: 'height: 100%;' };
    const without = clone(FIXTURE);
    delete without.segments[0].extensions;
    without.segments[0].events = [patch];
    const v = boot(without);
    assert.deepEqual(at(v, 0, 100), {}, 'nothing to pin before the patch');
    assert.deepEqual(at(v, 0, 1000), { style: 'height: 100%;' }, 'the patch re-runs syncRootHeight');
    const withSnapshot = clone(FIXTURE);
    withSnapshot.segments[0].events = [patch];
    assert.deepEqual(at(boot(withSnapshot), 0, 1000), { lang: 'en', style: '--card-w: 120px;' },
      'the recording states <html>, so the patch adds no pin');
  });

  it('neither the snapshot nor the stream sets an on* handler or xmlns', () => {
    const rec = clone(FIXTURE);
    rec.segments[0].extensions['cyborg-hunter'].root_attrs.xmlns = 'http://example.org/ns';
    rec.extensions['cyborg-hunter'].root_attr_events.push(
      { t: 1600, name: 'onclick', value: 'alert(1)' },
      { t: 1700, name: 'xmlns', value: 'http://example.org/ns' });
    const v = boot(rec);
    assert.deepEqual(at(v, 0, 100), { lang: 'en', style: '--card-w: 120px;' });
    assert.deepEqual(at(v, 0, 2000), { lang: 'en', style: '--card-w: 80px;' });
  });

  it('the model keeps only changes whose value is a string or null', () => {
    const rec = clone(FIXTURE);
    rec.extensions['cyborg-hunter'].root_attr_events.push(
      { t: 1600, name: 'data-n', value: 5 },
      { t: 1700, name: 'data-o', value: { a: 1 } },
      { t: 1800, name: 'data-u' });
    assert.deepEqual(buildViewerModel(rec).rootAttrEvents.map((e) => [e.name, e.value]),
      [['style', '--card-w: 80px;'], ['data-theme', 'dark'], ['lang', null]]);
  });

  it('a keyframe mount removes what the set lacks, but never the shell\'s xmlns', () => {
    const doc = new Window({ url: 'https://report.test/' }).document;
    doc.documentElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    doc.documentElement.setAttribute('data-theme', 'dark');
    applyRootAttrs(doc, { lang: 'en' });
    const out = {};
    for (const a of doc.documentElement.attributes) out[a.name] = a.value;
    assert.deepEqual(out, { xmlns: 'http://www.w3.org/1999/xhtml', lang: 'en' });
  });

  it('the shell\'s own <html> rule outranks a recorded inline style', () => {
    const v = boot(clone(FIXTURE));
    const rules = v.doc().querySelector('style[data-ch-shell-rules]').textContent;
    assert.ok(rules.includes('html{scrollbar-width:none!important}'), rules);
  });
});

describe('capture', () => {
  let win;
  const saved = {};
  beforeEach(() => {
    win = new Window({ url: 'https://example.org/exp/' });
    win.document.body.innerHTML = '<div id="stage"><div class="card">A</div></div>';
    for (const k of ['window', 'document', 'MutationObserver']) saved[k] = globalThis[k];
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.MutationObserver = win.MutationObserver;
  });
  afterEach(() => { for (const k of Object.keys(saved)) globalThis[k] = saved[k]; });
  const settle = () => new Promise((r) => setImmediate(r));

  it('a snapshot keeps the policy: no on* handler, nothing from an excluded <html>', () => {
    const html = win.document.documentElement;
    html.setAttribute('style', '--k: 1.5;');
    html.setAttribute('onclick', 'x()');
    assert.deepEqual({ ...rootAttrsSnapshot(html, {}) }, { style: '--k: 1.5;' });
    html.setAttribute('data-record-exclude', '');
    assert.deepEqual({ ...rootAttrsSnapshot(html, {}) }, {});
  });

  it('one batch gives one change per attribute, with its final value; a change the file holds gives none', () => {
    const html = win.document.documentElement;
    html.setAttribute('style', 'a');
    html.setAttribute('data-x', '1');
    const body = win.document.body;
    const records = [
      { type: 'attributes', target: html, attributeName: 'style' },
      { type: 'attributes', target: body, attributeName: 'class' },
      { type: 'attributes', target: html, attributeName: 'style' },
      { type: 'attributes', target: html, attributeName: 'data-x' },
      { type: 'attributes', target: html, attributeName: 'lang' },
    ];
    const held = Object.assign(Object.create(null), { style: 'b', lang: 'en' });
    assert.deepEqual(rootAttrChanges(records, html, {}, held),
      [{ name: 'style', value: 'a' }, { name: 'data-x', value: '1' }, { name: 'lang', value: null }]);
    assert.deepEqual({ ...held }, { style: 'a', 'data-x': '1' });
    assert.deepEqual(rootAttrChanges(records, html, {}, held), []);
  });

  it('a recording carries <html>\'s attributes at the keyframe and its changes, coalesced per batch', async () => {
    const html = win.document.documentElement;
    html.style.setProperty('--card-w', '120px');
    const api = CHReplay.attach({ participantId: 'P', tier: 'dom', autoSave: { mode: 'none' } });
    api.startSession();
    api.startTrial({ trialId: 't1' });
    // One task, three writes to one attribute and one new attribute: two entries.
    html.style.setProperty('--card-w', '80px');
    html.style.setProperty('--card-h', '112px');
    html.style.setProperty('--card-w', '90px');
    html.setAttribute('data-theme', 'dark');
    await settle();
    api.endTrial();
    api.stopSession('finished');
    const recording = api.getRecording();
    api.destroy();
    assert.equal(validateStrict(recording).ok, true);
    assert.deepEqual(recording.segments[0].extensions['cyborg-hunter'].root_attrs, { style: '--card-w: 120px;' });
    const events = recording.extensions['cyborg-hunter'].root_attr_events;
    assert.deepEqual(events.map((e) => [e.name, e.value]),
      [['style', '--card-w: 90px; --card-h: 112px;'], ['data-theme', 'dark']]);
    assert.ok(events.every((e) => typeof e.t === 'number' && e.t >= 0), 'wire time');
  });

  // The viewer drops a change stamped at or before its span's origin, so a
  // change made just before a keyframe has to reach the file in the snapshot.
  it('a change made in the same task just before startTrial is in that keyframe\'s snapshot, not in the stream', async () => {
    const html = win.document.documentElement;
    const api = CHReplay.attach({ participantId: 'P', tier: 'dom', autoSave: { mode: 'none' }, keyframeEvery: 1 });
    api.startSession();
    html.setAttribute('data-theme', 'dark');
    api.startTrial({ trialId: 't1' });
    await settle();
    html.setAttribute('data-theme', 'light');
    html.setAttribute('lang', 'en');
    api.endTrial();
    api.startTrial({ trialId: 't2' });
    await settle();
    api.endTrial();
    api.stopSession('finished');
    const recording = api.getRecording();
    api.destroy();
    assert.deepEqual(recording.segments.map((s) => s.extensions['cyborg-hunter'].root_attrs),
      [{ 'data-theme': 'dark' }, { 'data-theme': 'light', lang: 'en' }]);
    assert.deepEqual(recording.extensions['cyborg-hunter'].root_attr_events, []);
    assert.deepEqual(recording.segments.flatMap((s) => s.events).filter((e) => e.type.startsWith('dom.')), [],
      '<html> is outside the observed root: no patch names it');
  });
});

// What recording <html> costs, against the pilot-1 measurement
// (cyborg-hunter-lab probes/pilot1-replay-rendering.md §5.1: about 15 KB per
// session, 0.6 % of the 2.33 MB mean recording). Modelled on that session:
// a ~540-character layout style, six keyframes, fifteen layout passes of a few
// setProperty calls each (59 records in all).
describe('cost', () => {
  let win;
  const saved = {};
  beforeEach(() => {
    win = new Window({ url: 'https://example.org/exp/' });
    win.document.body.innerHTML = '<div id="board"></div>';
    for (const k of ['window', 'document', 'MutationObserver']) saved[k] = globalThis[k];
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.MutationObserver = win.MutationObserver;
  });
  afterEach(() => { for (const k of Object.keys(saved)) globalThis[k] = saved[k]; });
  const settle = () => new Promise((r) => setImmediate(r));
  const VARS = ['--pad', '--card-w', '--card-h', '--gap-cards', '--fan-strip', '--gap-x', '--gap-y', '--label-h',
    '--chrome-gap', '--group-w', '--board-w', '--board-h', '--col-count', '--col-w', '--test-gap', '--flank-gap',
    '--test-card-w', '--test-card-h'];

  it('one entry per layout pass, and the whole addition under 16 KB', async () => {
    const style = win.document.documentElement.style;
    style.setProperty('--k', '1.125');
    VARS.forEach((v, i) => style.setProperty(v, 'calc(' + (20 + i) + ' * var(--u))'));
    const api = CHReplay.attach({ participantId: 'P', tier: 'dom', autoSave: { mode: 'none' }, keyframeEvery: 1 });
    api.startSession();
    let records = 0;
    for (let pass = 0; pass < 15; pass++) {
      if (pass % 3 === 0) { if (pass) api.endTrial(); api.startTrial({ trialId: 'g' + pass }); }
      const writes = pass < 14 ? 4 : 3;
      for (let w = 0; w < writes; w++) { style.setProperty(VARS[(pass + w) % VARS.length], 'calc(' + (40 + pass) + ' * var(--u))'); records++; }
      await settle();
    }
    api.startTrial({ trialId: 'end' });
    api.endTrial();
    api.stopSession('finished');
    const recording = api.getRecording();
    api.destroy();
    const ext = recording.extensions['cyborg-hunter'];
    const snapshots = recording.segments.filter((s) => s.initial_dom).map((s) => s.extensions['cyborg-hunter'].root_attrs);
    assert.equal(records, 59);
    assert.equal(snapshots.length, 6);
    assert.equal(ext.root_attr_events.length, 15, 'one entry per batch, whatever the number of writes in it');
    const bytes = JSON.stringify(snapshots).length + JSON.stringify(ext.root_attr_events).length;
    assert.ok(snapshots[0].style.length > 500, 'a pilot-sized style: ' + snapshots[0].style.length);
    assert.ok(bytes <= 16 * 1024, bytes + ' bytes');
  });
});
