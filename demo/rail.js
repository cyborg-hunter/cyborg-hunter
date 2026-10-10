// demo/rail.js
// Sticky signal-checklist rail. Module-scoped singleton (there is only ever
// one #rail on the page): renderRail() builds the signal box and the grouped
// list and remembers the list's rows; light() then updates that remembered
// state without needing the container passed back in each time.
// acknowledge() and clearSignalBox() take the box itself, which demo.js
// looks up once after renderRail().

import { RAIL } from './steps.js';

var rowsByKey = {};
var listEl = null;

function renderGroupRows(rows, rowClass) {
  return rows.map(function (r) {
    var isAlwaysOn = r.key === 'mousePaths' || r.key === 'replay';
    var cls = isAlwaysOn ? 'always' : (rowClass || '');
    var nText = isAlwaysOn ? 'always on' : '0';
    return '<li data-key="' + r.key + '"' + (cls ? ' class="' + cls + '"' : '') + '>' +
      '<span class="lamp"></span><span class="lbl">' + r.label + '</span>' +
      '<span class="n">' + nText + '</span></li>';
  }).join('');
}

// The signal box's placeholder, one place for both renderRail() and
// clearSignalBox() so the box reads the same when built and when reset.
function signalBoxEmptyHtml() {
  return '<p class="signal-box-empty">' + RAIL.signalBoxEmpty + '</p>';
}

/**
 * Builds the checklist inside `container` (#rail): the title, then the
 * signal box (what the current step detected, empty until it detects
 * something), then the detector lamps, then the Guard and Recording groups
 * under their heads. The lamps start dimmed (the .check list carries an
 * `awaiting` class) until the first lamp lights, which clears it.
 */
export function renderRail(container, opts) {
  var groups = opts.groups;

  var html = '<h3>Tracked signals</h3>';
  html += '<div class="signal-box" data-role="signal-box">' + signalBoxEmptyHtml() + '</div>';
  html += '<ul class="check awaiting">';
  html += renderGroupRows(groups.detectors);
  html += '<li class="hint">Guard</li>' + renderGroupRows(groups.guard, 'guardrow');
  html += '<li class="hint">Recording</li>' + renderGroupRows(groups.recording);
  html += '</ul>';
  container.innerHTML = html;

  rowsByKey = {};
  listEl = container.querySelector('.check');
  container.querySelectorAll('li[data-key]').forEach(function (li) {
    rowsByKey[li.dataset.key] = li;
  });

  return container;
}

/**
 * Lights a row: adds .lit (and .hardlit when opts.hard), updates the count
 * text, and re-triggers the one-shot lamp-pulse animation (remove, force
 * reflow, re-add — the standard way to restart a CSS animation on the same
 * element). Returns the row, or null if renderRail() hasn't run / key is
 * unknown.
 */
export function light(key, count, opts) {
  var row = rowsByKey[key];
  if (!row) return null;

  row.classList.add('lit');
  if (opts && opts.hard) row.classList.add('hardlit');

  var n = row.querySelector('.n');
  if (n) n.textContent = String(count);

  var lamp = row.querySelector('.lamp');
  if (lamp) {
    lamp.classList.remove('lamp-pulse');
    void lamp.offsetWidth; // force reflow so the animation can re-trigger
    lamp.classList.add('lamp-pulse');
  }

  if (listEl) listEl.classList.remove('awaiting');

  return row;
}

/**
 * Marks the replay row as recording (on) or not (off): demo.css pulses its
 * lamp in the live teal while the row carries .recording, the page's one cue
 * that the session records. Here rather than in demo.js because the rows are
 * this module's. Returns the row, or null if renderRail() hasn't run.
 */
export function setRecording(on) {
  var row = rowsByKey.replay;
  if (!row) return null;
  row.classList.toggle('recording', !!on);
  return row;
}

/**
 * Adds a "✓ detected — <label>" line to the signal box at the top of the
 * rail, and drops the box's placeholder. One line per label per step: a
 * second paste on the same step finds its line already there (the lamp
 * below keeps the count). clearSignalBox() empties the box on every
 * navigation, so the box only ever holds the current step's signals.
 */
export function acknowledge(boxEl, label) {
  if (!boxEl) return null;
  var text = '✓ detected — ' + label;
  var lines = boxEl.querySelectorAll('.detected-strip');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].textContent === text) return lines[i];
  }
  var empty = boxEl.querySelector('.signal-box-empty');
  if (empty) empty.remove();
  var line = document.createElement('p');
  line.className = 'detected-strip';
  line.textContent = text;
  boxEl.appendChild(line);
  return line;
}

/**
 * Empties the signal box back to its placeholder. renderStep() calls it on
 * every navigation: the box shows what the step on screen detected, while
 * the lamps keep the record across the whole session.
 */
export function clearSignalBox(boxEl) {
  if (boxEl) boxEl.innerHTML = signalBoxEmptyHtml();
}
