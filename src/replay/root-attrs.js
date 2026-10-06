// src/replay/root-attrs.js
// <html>'s own attributes, which no observed root contains. The recorder
// observes <body> (or a configured root) and below, so a page that keeps its
// layout on <html> (CSS custom properties set on document.documentElement.style,
// jsPsych's `height: 100%`) used to replay without it. They are recorded in the
// vendor slot (spec §9): a snapshot on every keyframe segment,
// `segments[i].extensions["cyborg-hunter"].root_attrs`, and the changes,
// `extensions["cyborg-hunter"].root_attr_events`, one entry per attribute per
// observer batch. Both pass through the attribute policy every body element
// gets (snapshot.js: no `on*`; `value` withheld under redaction), so <html>
// cannot carry what a body element may not.
import { emittedAttrs, attrPatchValue, ATTR_WITHHELD, isExcluded } from './snapshot.js';
import { isRedacted } from './redaction.js';

// <html>'s own attributes and nothing below it, on the capture's one observer
// (capture-dom.js): the observed root's registration covers the subtree, and
// the stylesheet capture covers <head>.
export var ROOT_OBSERVER_INIT = { attributes: true, attributeOldValue: true };

function redactedRoot(el, opts) {
  return isRedacted(el, opts && opts.redactSelector);
}

/**
 * The attributes a keyframe records for `el` (document.documentElement), as a
 * null-prototype map of strings. An excluded <html> records none.
 */
export function rootAttrsSnapshot(el, opts) {
  var out = Object.create(null);
  if (!el || isExcluded(el, opts)) return out;
  var attrs = emittedAttrs(el, redactedRoot(el, opts));
  for (var name in attrs) {
    if (Object.prototype.hasOwnProperty.call(attrs, name)) out[name] = attrs[name];
  }
  return out;
}

/**
 * One observer batch on `el` → the changes the file does not hold yet: one per
 * attribute, with the attribute's value now (null when it was removed), in the
 * order the batch first named them. The batch is the capture observer's
 * whole batch, so records about any other node are skipped here. `held` is
 * what the file says <html> carries (the last keyframe's snapshot plus every
 * change since) and is updated in place. A namespaced attribute is skipped: a
 * MutationRecord names it by its local name, and <html> carries none in
 * practice.
 */
export function rootAttrChanges(records, el, opts, held) {
  var out = [];
  if (!el || isExcluded(el, opts)) return out;
  var seen = Object.create(null);
  var redacted = redactedRoot(el, opts);
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (!r || r.target !== el || r.type !== 'attributes' || r.attributeNamespace || !r.attributeName) continue;
    var name = r.attributeName;
    if (seen[name]) continue;
    seen[name] = true;
    var value = attrPatchValue(el, name, redacted);
    if (value === ATTR_WITHHELD) continue;
    var before = Object.prototype.hasOwnProperty.call(held, name) ? held[name] : null;
    if (before === value) continue;
    if (value === null) delete held[name]; else held[name] = value;
    out.push({ name: name, value: value });
  }
  return out;
}
