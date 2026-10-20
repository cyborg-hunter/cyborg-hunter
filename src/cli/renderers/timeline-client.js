// src/cli/renderers/timeline-client.js
// The report's hover and pin line over a participant's "Session timeline"
// block (html-index-core.js renderTimelineBlock): one vertical line through
// both images where the pointer is, with a label (the time, the trial and its
// phase, its typing rate, "events not kept" over a page a Qualtrics payload
// trimmed, and "tabbed away" / "sidebar open" when the session was), and a
// dashed red line pinned on a click; a click within 6 px of a pin removes
// it. Pins live in the open page only: not saved, not in the PNGs. It runs
// in the CLI report and in the analyzer's sandboxed report frame alike: it
// needs no storage and no network.
//
// The numbers come from the stage's data-timeline attribute
// (timeline-layout.js hoverData): the images' width, left margin and chart
// width in the charts' own pixels, the domain in seconds, and the trials
// ([id, phase, startSec, endSec, cps, truncated]), tab-aways and sidebar
// spans. The images fill the stage's width, so a fraction of the stage's
// width is the same fraction of each image.
//
// Real functions, inlined into the report by their source text
// (timelineScript): the report is one HTML file and cannot import, and the
// tests call the functions the page runs. So each function here is
// self-contained (its arguments, its locals, the browser's globals and the
// other functions timelineScript lists, nothing else from this module), and
// written in ES5 like the report's other inline code.

// Seconds as m:ss.
export function chClock(sec) {
  var m = Math.floor(sec / 60);
  var s = Math.round(sec - m * 60);
  if (s === 60) { m += 1; s = 0; }
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// The label at a time: m:ss · trial id (phase) · rate cps · events not kept
// · tabbed away · sidebar open. "between trials" when no trial runs then;
// nothing about trials when the block has none (data that cannot align).
export function chTimelineLabel(data, sec) {
  var parts = [chClock(sec)];
  var trial = null;
  for (var i = 0; i < data.trials.length; i++) {
    var t = data.trials[i];
    if (sec >= t[2] && sec < t[3]) { trial = t; break; }
  }
  if (trial) {
    parts.push('trial ' + trial[0] + (trial[1] ? ' (' + trial[1] + ')' : '') + (trial[4] != null ? ' · ' + trial[4] + ' cps' : ''));
    // A page whose events the payload did not keep (integrityTruncated):
    // no paste or copy on it can be seen, which is not the same as none.
    if (trial[5] === true) parts.push('events not kept');
  } else if (data.trials.length) parts.push('between trials');
  if (data.tabs.some(function (x) { return sec >= x[0] && sec <= x[1]; })) parts.push('tabbed away');
  if (data.sidebars.some(function (x) { return sec >= x[0] && sec <= x[1]; })) parts.push('sidebar open');
  return parts.join(' · ');
}

// Wires one stage: the line and its label follow the pointer over the
// plotted area; a click pins a line there or removes the pin within 6 px.
// Pins are kept as fractions of the stage's width, so they stay on their
// time when the window is resized.
export function chWireTimelineStage(stage) {
  var data;
  try { data = JSON.parse(stage.getAttribute('data-timeline')); } catch (e) { return; }
  if (!data || !(data.domain > 0) || !Array.isArray(data.trials)) return;
  var doc = stage.ownerDocument;
  var line = doc.createElement('div');
  line.className = 'tl-line';
  line.hidden = true;
  var label = doc.createElement('div');
  label.className = 'tl-readout';
  label.hidden = true;
  stage.appendChild(line);
  stage.appendChild(label);
  var pins = [];
  // Where the pointer is, as a fraction of the stage's width, and the time
  // there; null over the margins.
  function at(clientX) {
    var r = stage.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    var f = (clientX - r.left) / r.width;
    var u = f * data.w;
    if (u < data.left || u > data.left + data.chart) return null;
    return { f: f, sec: ((u - data.left) / data.chart) * data.domain, width: r.width };
  }
  stage.addEventListener('mousemove', function (e) {
    var a = at(e.clientX);
    if (!a) { line.hidden = true; label.hidden = true; return; }
    line.hidden = false;
    label.hidden = false;
    line.style.left = (100 * a.f) + '%';
    label.textContent = chTimelineLabel(data, a.sec);
    label.style.left = (100 * a.f) + '%';
    // Past 60 % of the width the label goes left of the line, to stay inside.
    label.style.transform = a.f > 0.6 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)';
  });
  stage.addEventListener('mouseleave', function () { line.hidden = true; label.hidden = true; });
  stage.addEventListener('click', function (e) {
    var a = at(e.clientX);
    if (!a) return;
    for (var i = 0; i < pins.length; i++) {
      if (Math.abs(pins[i].f - a.f) * a.width < 6) {
        pins[i].el.remove();
        pins.splice(i, 1);
        return;
      }
    }
    var pin = doc.createElement('div');
    pin.className = 'tl-pin';
    pin.style.left = (100 * a.f) + '%';
    pin.title = chTimelineLabel(data, a.sec);
    stage.appendChild(pin);
    pins.push({ f: a.f, el: pin });
  });
}

// The script the report inlines (html-index-core.js wraps it in an IIFE and
// inlineSafeSrc): the three functions, then the call on every stage. The
// call names the function by its `.name`: the analyzer bundle may rename it.
export function timelineScript() {
  return [chClock, chTimelineLabel, chWireTimelineStage].map(String).join('\n') +
    '\ndocument.querySelectorAll(".tl-stage").forEach(function (stage) { ' + chWireTimelineStage.name + '(stage); });\n';
}
