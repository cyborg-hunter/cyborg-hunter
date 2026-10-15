// Two browser behaviours happy-dom does not have, emulated on the nodes:
//
// 1. In a document served as application/xhtml+xml, tagName is lower case
//    ('input', not 'INPUT'). The password floor compared tagName with
//    'INPUT', so in such a page a password field was not one, and its keys
//    and value were recorded.
// 2. A <form> holding a field named "id" answers form.id with that field
//    (the form's named-property getter), so reading `.id` gave an element:
//    an anchor id of {} that fails strict validation, a root selector of
//    "#[object HTMLInputElement]". The id attribute is read instead.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { isPasswordField } from '../../src/replay/redaction.js';
import { serializeTree } from '../../src/replay/snapshot.js';
import { createSpan } from '../../src/replay/span.js';
import * as CHReplay from '../../src/replay/index.js';

describe('XHTML: lower-case tag names', () => {
  it('a password input is a password field whatever the case of its tagName', () => {
    const el = { tagName: 'input', type: 'password', getAttribute: (n) => (n === 'type' ? 'password' : null) };
    assert.equal(isPasswordField(el), true);
  });

  it('a keyframe withholds a lower-case password input\'s value', () => {
    const win = new Window({ url: 'https://example.org/' });
    win.document.body.innerHTML = '<div><input type="password" value="SECRETPW"></div>';
    const input = win.document.querySelector('input');
    Object.defineProperty(input, 'tagName', { get: () => 'input' });
    const tree = serializeTree(win.document.body.firstElementChild, createSpan(), {});
    assert.ok(!JSON.stringify(tree).includes('SECRETPW'));
  });
});

describe('a form whose field is named "id"', () => {
  it('the keyframe reads the id attribute, not the shadowing field', () => {
    const win = new Window({ url: 'https://example.org/' });
    win.document.body.innerHTML = '<div><form id="f"><input name="id"></form></div>';
    const form = win.document.querySelector('form');
    const field = form.querySelector('input');
    Object.defineProperty(form, 'id', { get: () => field });
    const tree = serializeTree(win.document.body.firstElementChild, createSpan(), {});
    assert.equal(tree.children[0].attrs.id, 'f');
    assert.ok(!JSON.stringify(tree).includes('[object'));
  });

  it('a click on it records the id attribute as the anchor id', async () => {
    const win = new Window({ url: 'https://example.org/' });
    globalThis.window = win; globalThis.document = win.document;
    globalThis.MutationObserver = win.MutationObserver;
    globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
    try {
      win.document.body.innerHTML = '<form id="f"><input name="id"></form>';
      const form = win.document.querySelector('form');
      const field = form.querySelector('input');
      Object.defineProperty(form, 'id', { get: () => field });
      const api = CHReplay.attach({ participantId: 'P', autoSave: { mode: 'none' } });
      api.startSession();
      api.startTrial({ trialId: 't' });
      form.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
      await new Promise((r) => setTimeout(r, 20));
      api.endTrial();
      api.stopSession('finished');
      const rec = api.getRecording();
      api.destroy();
      const click = rec.segments.flatMap((s) => s.events).find((e) => e.type === 'mouse.click');
      assert.ok(click, 'the click is recorded');
      assert.equal(click.anchor.id, 'f');
    } finally {
      win.close();
      delete globalThis.window; delete globalThis.document;
      delete globalThis.MutationObserver; delete globalThis.requestAnimationFrame;
    }
  });
});
