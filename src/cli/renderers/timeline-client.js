// src/cli/renderers/timeline-client.js
// The report's hover and pin line over a participant's "Session timeline"
// block (html-index-core.js renderTimelineBlock): one vertical line through
// both images where the pointer is, a label in the block's header row (the
// time, the trial and its phase, its typing rate, "events not kept" over a
// page a Qualtrics payload trimmed, and "tabbed away" / "sidebar open" when
// the session was), and a dashed red line where a click placed it; a click
// elsewhere moves it and a click within 6 px of it removes it. Nothing but the
// lines is drawn over the images, so no text covers a chart's title or legend.
// The placed line lives in the open page only: not saved, not in the PNGs. The
// line also opens the mouse plot of the trial under it, under the block, and a
// click on a plot in the grid opens that plot alone in the overlay. It runs
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

import { inlineSrcHazards } from '../../shared/inline-safe.js';

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

// One panel's box in the mouse plot grid, in fractions of the image; null when
// the image has not loaded or cannot hold it. The grid's layout, in its own
// units (trajectories-core.js): panels 400 x 300 under a 40 title, 40 apart,
// five to a row, under a header whose height is what the image's height leaves.
// The image's width gives its pixels per unit. The box takes in the panel's
// title and frame, and stops short of its neighbours.
export function chPanelBox(panel, count, imgW, imgH) {
  if (!(imgW > 0) || !(imgH > 0) || !(count > 0) || !(panel >= 0) || panel >= count) return null;
  var cols = Math.min(5, count);
  var rows = Math.ceil(count / cols);
  var scale = imgW / (cols * 440 + 40);
  var head = imgH / scale - rows * 380 - 40;
  if (!(head >= 0)) return null;
  var x = 40 + (panel % cols) * 440 - 12;
  var y = head + 40 + Math.floor(panel / cols) * 380 - 6;
  return { left: (x * scale) / imgW, top: (y * scale) / imgH, width: (424 * scale) / imgW, height: (352 * scale) / imgH };
}

// The panel under a point given in fractions of the image; null over the
// header and margins, or before the image has loaded.
export function chPanelAt(fx, fy, count, imgW, imgH) {
  for (var i = 0; i < count; i++) {
    var b = chPanelBox(i, count, imgW, imgH);
    if (!b) return null;
    if (fx >= b.left && fx < b.left + b.width && fy >= b.top && fy < b.top + b.height) return i;
  }
  return null;
}

// Places the grid image behind its window so the box fills the window. Left
// and width resolve against the window's width, top against its height.
export function chPlaceCrop(crop, box) {
  crop.style.width = (100 / box.width) + '%';
  crop.style.left = (-100 * box.left / box.width) + '%';
  crop.style.top = (-100 * box.top / box.height) + '%';
}

// A click on a plot in the grid opens that plot alone in the report's overlay,
// in the slot "enlarge" uses, which closing the overlay empties. Over the
// header or margins, or from the keyboard, the click stays the link's: the
// whole grid.
export function chWirePlotGrid(img) {
  var doc = img.ownerDocument;
  var overlay = doc.getElementById('lightbox');
  var stack = doc.getElementById('lightbox-stack');
  var single = doc.getElementById('lightbox-img');
  var count = parseInt(img.getAttribute('data-panel-count'), 10);
  if (!overlay || !stack || !single || !(count > 0)) return;
  img.addEventListener('click', function (e) {
    var r = img.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return;
    var panel = chPanelAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, count, img.naturalWidth, img.naturalHeight);
    if (panel === null) return;
    e.preventDefault();
    e.stopPropagation();
    var box = chPanelBox(panel, count, img.naturalWidth, img.naturalHeight);
    var frame = doc.createElement('div');
    frame.className = 'tl-plot-frame';
    frame.style.setProperty('--plot-w', (box.width * img.naturalWidth) + 'px');
    var crop = doc.createElement('img');
    crop.setAttribute('src', img.getAttribute('src'));
    crop.setAttribute('alt', 'Mouse plot');
    chPlaceCrop(crop, box);
    frame.appendChild(crop);
    stack.textContent = '';
    stack.appendChild(frame);
    single.hidden = true;
    stack.hidden = false;
    overlay.classList.add('open');
  });
}

// Wires one stage: the line follows the pointer over the plotted area and
// the header's readout (renderTimelineBlock's .tl-readout, between the
// heading and "enlarge") says what is under it; both clear when the pointer
// leaves the plotted area. A click places the dashed line there, moving it if
// it is elsewhere and removing it within 6 px. It is kept as a fraction of the
// stage's width, so it stays on its time when the window is resized.
export function chWireTimelineStage(stage) {
  var data;
  try { data = JSON.parse(stage.getAttribute('data-timeline')); } catch (e) { return; }
  if (!data || !(data.domain > 0) || !Array.isArray(data.trials)) return;
  var block = stage.closest('.tl-block');
  var readout = block ? block.querySelector('.tl-head .tl-readout') : null;
  // renderTimelineBlock always writes the readout; a stage without one is
  // not the report's, and is left alone.
  if (!readout) return;
  var doc = stage.ownerDocument;
  var line = doc.createElement('div');
  line.className = 'tl-line';
  line.hidden = true;
  stage.appendChild(line);
  var pin = null;
  // The clicked trial's mouse plot, under the block: nothing when the report
  // has no grid image or the line is not over a trial with a panel. Its image
  // is made when first shown: the block hides when it holds no image.
  var plot = doc.createElement('div');
  plot.className = 'tl-plot';
  plot.hidden = true;
  var frame = doc.createElement('div');
  frame.className = 'tl-plot-frame';
  plot.appendChild(frame);
  block.appendChild(plot);
  var part = stage.closest('.participant');
  var grid = part ? part.querySelector('img[alt="Mouse trajectories"]') : null;
  var crop = null;
  function showPlot(sec) {
    plot.hidden = true;
    if (sec === null || !grid || !data.panels) return;
    for (var i = 0; i < data.trials.length; i++) {
      var t = data.trials[i];
      if (sec >= t[2] && sec < t[3]) {
        var at = data.panels.at[i];
        var box = at === null || at === undefined ? null : chPanelBox(at, data.panels.count, grid.naturalWidth, grid.naturalHeight);
        if (!box) return;
        if (!crop) { crop = doc.createElement('img'); frame.appendChild(crop); }
        crop.setAttribute('src', grid.getAttribute('src'));
        crop.setAttribute('alt', 'Mouse plot of trial ' + t[0]);
        chPlaceCrop(crop, box);
        plot.hidden = false;
        return;
      }
    }
  }
  // A click can come before the grid image has loaded.
  if (grid) grid.addEventListener('load', function () { if (pin) showPlot(pin.sec); });
  function clear() { line.hidden = true; readout.textContent = ''; }
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
    if (!a) { clear(); return; }
    line.hidden = false;
    line.style.left = (100 * a.f) + '%';
    readout.textContent = chTimelineLabel(data, a.sec);
  });
  stage.addEventListener('mouseleave', clear);
  stage.addEventListener('click', function (e) {
    var a = at(e.clientX);
    if (!a) return;
    var onLine = pin && Math.abs(pin.f - a.f) * a.width < 6;
    if (pin) { pin.el.remove(); pin = null; }
    showPlot(null);
    if (onLine) return;
    var el = doc.createElement('div');
    el.className = 'tl-pin';
    el.style.left = (100 * a.f) + '%';
    stage.appendChild(el);
    pin = { f: a.f, sec: a.sec, el: el };
    showPlot(a.sec);
  });
}

// The script the report inlines (html-index-core.js wraps it in an IIFE and
// inlineSafeSrc): the three functions, then the call on every stage. The
// analyzer does not call this in its bundle, where a function's text is
// esbuild's reprint: it inlines this text as node gives it, baked at build
// time (tools/build-analyze.mjs), so its report is the CLI's byte for byte.
// The call names the function by its `.name`, so a text built from renamed
// functions would still call the one it defines.
// inlineSafeSrc cannot neutralise a sequence that opens the HTML parser's
// escaped state (src/shared/inline-safe.js): the page's own closing tag
// would no longer close the script and the hover would silently never run.
// So the text is checked here, where every report and the analyzer's build
// take it, as readReplayClientSrc checks the replay viewer's.
export function timelineScript() {
  const src = [chClock, chTimelineLabel, chPanelBox, chPanelAt, chPlaceCrop, chWirePlotGrid, chWireTimelineStage].map(String).join('\n') +
    '\ndocument.querySelectorAll(".tl-stage").forEach(function (stage) { ' + chWireTimelineStage.name + '(stage); });\n' +
    'document.querySelectorAll("img[data-panel-count]").forEach(function (img) { ' + chWirePlotGrid.name + '(img); });\n';
  const hazards = inlineSrcHazards(src);
  if (hazards.length) {
    throw new Error('timeline-client: the hover script cannot be inlined into the report: it ' + hazards.join('; and it ') +
      '. Reword the source (a comment that mentions HTML is the usual cause); do not widen the escape.');
  }
  return src;
}
