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
});
