// src/replay/merge.js
// One participant's recordings from several pages, joined into one replay.
//
// On a study made of pages without a framework, every page load starts a new
// recording (the browser runs the page's scripts again), so a participant
// arrives as one recording per page. The report shows one replay per
// participant; showing only the latest page threw the others away. Merging
// lines them up by wall clock (`recording_started_at`), the way the CLI
// already lines up a multi-page session's integrity data, and moves every
// later page onto the first page's clock: its times are shifted by the
// difference between the two starts. Each page's first segment is a keyframe
// (on the dom tier), so the joins replay cleanly.
//
// Refused, so the caller can fall back to the latest recording: recordings of
// different participants, and recordings that overlap in time, which are two
// sessions (a duplicate upload, two tabs) rather than two pages of one.
//
// Known limit: stylesheets are concatenated (renumbered), so a dom-tier page
// is replayed with every page's sheets applied. The trace tier, the default,
// records none.

function wall(rec) {
  var t = Date.parse(rec.recording_started_at);
  if (!isFinite(t)) throw new Error('a recording has no readable recording_started_at');
  return t;
}

// The recording's last moment on its own wire clock.
function wireEnd(rec) {
  var end = typeof rec.ended_at_perf === 'number' && typeof rec.recording_started_at_perf === 'number'
    ? rec.ended_at_perf - rec.recording_started_at_perf : 0;
  (rec.segments || []).forEach(function (s) {
    if (typeof s.t_end === 'number' && s.t_end > end) end = s.t_end;
  });
  return end;
}

function shift(v, d) { return typeof v === 'number' ? v + d : v; }

function shiftEntries(list, d) {
  return (list || []).map(function (e) {
    var out = Object.assign({}, e);
    if (typeof out.t === 'number') out.t += d;
    if (typeof out.start === 'number') out.start += d;
    return out;
  });
}

function shiftSegment(seg, d) {
  return Object.assign({}, seg, {
    t_start: shift(seg.t_start, d),
    t_dom_ready: shift(seg.t_dom_ready, d),
    t_load: shift(seg.t_load, d),
    t_end: shift(seg.t_end, d),
    events: (seg.events || []).map(function (e) { return Object.assign({}, e, { t: shift(e.t, d) }); })
  });
}

/**
 * mergeRecordings(recordings) → one SessionRecording v2.
 * One recording comes back unchanged. Throws when they cannot be one session.
 */
export function mergeRecordings(recordings) {
  if (!Array.isArray(recordings) || recordings.length === 0) throw new Error('nothing to merge');
  if (recordings.length === 1) return recordings[0];
  var recs = recordings.slice().sort(function (a, b) { return wall(a) - wall(b); });
  var pid = recs[0].participant_id;
  recs.forEach(function (r) {
    if (r.participant_id !== pid) throw new Error('recordings of different participants cannot be merged');
  });
  for (var i = 1; i < recs.length; i++) {
    var prevEnd = wall(recs[i - 1]) + wireEnd(recs[i - 1]);
    if (wall(recs[i]) < prevEnd) {
      throw new Error('recordings overlap in time: two sessions, not two pages of one');
    }
  }

  var base = recs[0];
  var start = wall(base);
  var segments = [];
  var viewport = [], guard = [], rootAttrs = [], failures = [];
  var sheets = [];
  var pages = [];
  var end = 0;
  var truncated = false, inherited = false;
  recs.forEach(function (r, k) {
    var d = wall(r) - start;
    var ch = (r.extensions && r.extensions['cyborg-hunter']) || {};
    (r.segments || []).forEach(function (s) {
      segments.push(Object.assign(shiftSegment(s, d), { index: segments.length }));
    });
    // A later page starts with its own viewport: a change at its start.
    if (k > 0 && r.viewport) viewport.push(Object.assign({}, r.viewport, { t: d }));
    Array.prototype.push.apply(viewport, shiftEntries(r.viewport_changes, d));
    Array.prototype.push.apply(guard, shiftEntries(ch.guard_violations, d));
    Array.prototype.push.apply(rootAttrs, shiftEntries(ch.root_attr_events, d));
    Array.prototype.push.apply(failures, shiftEntries(ch.capture_failures, d));
    (r.stylesheets || []).forEach(function (sh) {
      sheets.push(Object.assign({}, sh, { id: sheets.length + 1 }));
    });
    var e = d + wireEnd(r);
    if (e > end) end = e;
    if (r.truncated) truncated = true;
    if (ch.inherited_redaction_taint) inherited = true;
    var page = { recording_started_at: r.recording_started_at, offset_ms: d,
      segments: (r.segments || []).length, end_reason: r.end_reason };
    if (ch.reassembly) page.reassembly = ch.reassembly;
    pages.push(page);
  });

  var last = recs[recs.length - 1];
  var baseCh = (base.extensions && base.extensions['cyborg-hunter']) || {};
  var chOut = Object.assign({}, baseCh, {
    guard_violations: guard,
    root_attr_events: rootAttrs,
    capture_failures: failures,
    capture_stopped: truncated,
    inherited_redaction_taint: inherited,
    merged_pages: pages
  });
  delete chOut.reassembly;   // per page, in merged_pages

  return Object.assign({}, base, {
    stylesheets: sheets,
    viewport_changes: viewport.sort(function (a, b) { return a.t - b.t; }),
    ended_at_perf: base.recording_started_at_perf + end,
    end_reason: last.end_reason,
    truncated: truncated,
    extensions: Object.assign({}, base.extensions, { 'cyborg-hunter': chOut }),
    segments: segments
  });
}
