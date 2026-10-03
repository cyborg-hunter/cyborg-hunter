// src/oneliner/adapters/labjs.js
// The lab.js host: window.lab (the UMD build the builder exports as lib/lab.js)
// exists at boot, and every component of a study runs through
// lab.core.Component.prototype.run and .end. Both are patched once:
//   run   after lab.js has inserted the component's content, a leaf component
//         (metadata.nestedComponents empty; a flow.Parallel counts as the
//         leaf and its descendants do not) opens a host trial (segmenter
//         rotate), named from, in order: options.cyborgHunter.trialId,
//         parameters.chTrialId, a [data-ch-trial] element in its content, its
//         own id (sender_id), 'trial-<n>';
//   end   BEFORE lab.js's own end() commits the row, the open trial is cut and
//         the segment, the trial report and the running totals go into
//         component.data, which that end() commits; the root component's end
//         also runs the final hook (last segment, honeypot summary, friction
//         stop, monitor teardown) and writes the *Final fields onto the last
//         trial row through datastore.update, before the researcher's own
//         on('end') handlers run.
// Containers (Sequence, Loop, Frame) commit rows too; they carry no columns.
// A component that ends inside its own run() (skip, Dummy) opened no trial.
//
// Two generations of lab.js share the hooks and differ in five places,
// detected by feature (Component.prototype.lock), never by version:
//   classic (20.x)   run(frameTimestamp, frameSynced); end(reason, …) once;
//                    options.datastore; options.el; options.id (the id
//                    getter throws when options.id is null: the root)
//   flip (22/23)     run({ controlled }): only a controlled run is a run (an
//                    uncontrolled study.run() delegates to the controller);
//                    end() twice (uncontrolled from a response or timeout,
//                    then controlled from the flip; the controlled pass
//                    commits); a skipped component rejects run() with
//                    AbortFlip; internals.controller.global.datastore;
//                    internals.context.el; the id getter
//
// Nothing here throws into lab.js: a hook failure becomes cyborgHunterError on
// that component's row and one catalogue error per page, and later components
// are still hooked. Guards and replay are the vanilla host's
// standalone ones (boot.js); the vanilla adapter is not installed on this
// host, so the friction start mark (data-ch-friction-start) is handled here.

import { VERSION } from '../../shared/constants.js';
import { MESSAGES } from '../errors.js';

function message(e) { return String((e && e.message) || e); }

export function detectLabJs(win) {
  try {
    var lab = win.lab;
    if (!lab || !lab.core || typeof lab.core.Component !== 'function') return null;
    var proto = lab.core.Component.prototype;
    if (!proto || typeof proto.run !== 'function' || typeof proto.end !== 'function') return null;
    return {
      lab: lab,
      version: typeof lab.version === 'string' ? lab.version : 'unknown',
      generation: typeof proto.lock === 'function' ? 'flip' : 'classic'
    };
  } catch (_) { return null; }   // a locked or throwing global: not lab.js
}

// Vanilla host only. The two diagnoses are decided once the DOM is parsed.
export function watchLabJsPlacement(opts) {
  var done = false;
  function check() {
    if (done) return;
    done = true;
    try {
      var ctx = opts.ctx, doc = opts.doc;
      if (ctx.bootError || ctx.host !== 'vanilla') return;
      if (detectLabJs(opts.win)) console.error(MESSAGES.loadedAboveLabJs());
      else if (doc.querySelector && doc.querySelector('[data-labjs-section]')) console.error(MESSAGES.labjsNotHookable());
    } catch (_) { /* a diagnosis only */ }
  }
  try {
    var doc = opts.doc;
    if (doc.readyState === 'loading' && doc.addEventListener) doc.addEventListener('DOMContentLoaded', check, { once: true });
    else check();
  } catch (_) { /* no document to watch */ }
}

var PATCHED = '__cyborgHunterLabJs';   // the handle, on the wrapped prototype methods

export function isContainer(c) {
  var m = c && c.constructor && c.constructor.metadata;
  return !!(m && Array.isArray(m.nestedComponents) && m.nestedComponents.length > 0);
}

function isParallel(c, lab) {
  var P = lab && lab.flow && lab.flow.Parallel;
  return typeof P === 'function' && c instanceof P;
}

// A Parallel runs its children at once and the monitor holds one trial at a
// time, so the outermost Parallel is the trial and nothing under it is (a
// Parallel inside one included). A component with datacommit: false commits
// no row to carry a segment, so it is no trial either: its span goes into the
// gap the next segment carries.
export function isTrial(c, lab) {
  if (!c || typeof c !== 'object') return false;
  if (c.options && c.options.datacommit === false) return false;
  for (var p = c.parent; p; p = p.parent) if (isParallel(p, lab)) return false;
  if (isParallel(c, lab)) return true;
  return !isContainer(c);
}

// options.id is what both generations' prepareNested writes ('0', '1_2');
// the id getter is the flip generation's own (and throws on the classic root).
export function idOf(c) {
  var id = c.options ? c.options.id : undefined;
  if (id === undefined || id === null) {
    try { id = c.id; } catch (_) { id = null; }
  }
  if (id === undefined || id === null) return null;
  return Array.isArray(id) ? id.join('_') : String(id);
}

export function datastoreOf(c) {
  var ds = c.options && c.options.datastore;
  if (!ds && c.internals && c.internals.controller && c.internals.controller.global) ds = c.internals.controller.global.datastore;
  return ds && typeof ds.commit === 'function' ? ds : null;
}

function elOf(c, generation) {
  if (generation === 'flip') return (c.internals && c.internals.context && c.internals.context.el) || null;
  return (c.options && c.options.el) || null;
}

function paramsOf(c) {
  try {
    var a = c.aggregateParameters;
    if (a && typeof a === 'object') return a;
  } catch (_) { /* a component outside a tree */ }
  return (c.options && c.options.parameters) || {};
}

function markIn(el) {
  if (!el || typeof el.querySelector !== 'function') return null;
  var m = el.querySelector('[data-ch-trial]');
  return m ? m.getAttribute('data-ch-trial') : null;
}

function given(v) { return v !== undefined && v !== null && v !== ''; }

// Classic components share options.el, and only an html.Screen (Form and Page
// are Screens) replaces its content; any other leaf (a core.Component pause)
// would read the mark the previous screen left there.
function readsMark(c, o) {
  var S = o.lab && o.lab.html && o.lab.html.Screen;
  return o.generation !== 'classic' || typeof S !== 'function' || c instanceof S;
}

// What the host trial opens with. o: { generation, index, rerun, lab? }.
export function trialOptions(c, o) {
  var own = c.options && c.options.cyborgHunter && typeof c.options.cyborgHunter === 'object' ? c.options.cyborgHunter : {};
  var params = paramsOf(c);
  var named = given(own.trialId) ? own.trialId
    : (given(params.chTrialId) ? params.chTrialId : (readsMark(c, o) ? markIn(elOf(c, o.generation)) : null));
  var trialId = given(named) ? String(named) : (idOf(c) || ('trial-' + o.index));
  if (!given(named) && o.rerun > 1) trialId += '#' + o.rerun;
  var decoy = given(own.decoyAnswer) || own.decoyAnswer === false ? own.decoyAnswer
    : (given(params.chDecoyAnswer) || params.chDecoyAnswer === false ? params.chDecoyAnswer : null);
  return {
    trialId: trialId,
    phase: given(own.phase) ? own.phase : (given(params.chPhase) ? params.chPhase : null),
    decoyAnswer: decoy,
    experimentContainer: given(own.experimentContainer) ? own.experimentContainer : null
  };
}

// installLabJsAdapter({ win, ctx, lab, version, generation }) → { restore(), state() }
export function installLabJsAdapter(opts) {
  var win = opts.win, ctx = opts.ctx, lab = opts.lab, generation = opts.generation;
  var proto = lab.core.Component.prototype;
  if (proto.run && proto.run[PATCHED]) return proto.run[PATCHED];
  var origRun = proto.run, origEnd = proto.end;
  var state = { version: opts.version, generation: generation, trialsRun: 0, segmentsWritten: 0, finalized: false, lastTrial: null, stamped: false, warnedSecond: false, warnedRunning: false, loggedHookError: false };
  ctx.labjs = state;

  function hookError(e) {
    if (state.loggedHookError) return;
    state.loggedHookError = true;
    console.error(MESSAGES.labjsHookFailed(message(e)));
  }

  // A hook failure: one catalogue error per page, and the component's row
  // (lab.js commits data in its end()) says what failed.
  function markFailed(c, e) {
    hookError(e);
    try { (c.data || (c.data = {})).cyborgHunterError = message(e); } catch (_) { /* the error is logged */ }
  }

  // The researcher's own participantId (in the component's data, a
  // parameter, or the datastore's state) is never overwritten: ch.js's id
  // always goes into cyborgHunterParticipantId, and into participantId only
  // where the study sets none. lab.js's commit() copies every row into the
  // datastore's state, so a state value equal to ch.js's id is the one an
  // earlier row of ch.js's put there.
  function researcherSetsId(c, ds) {
    if (c.data && given(c.data.participantId)) return true;
    if (given(paramsOf(c).participantId)) return true;
    var st = ds && ds.state;
    return !!(st && given(st.participantId) && st.participantId !== ctx.participantId);
  }
  function idFields(c, ds, into) {
    into.cyborgHunterParticipantId = ctx.participantId;
    if (!researcherSetsId(c, ds)) into.participantId = ctx.participantId;
    into.cyborgHunterVersion = VERSION;
    return into;
  }

  // data-replay: the standalone recorder follows the segmenter (set by
  // replay-loader.js once it has started; its calls never throw).
  function followReplay() {
    if (!ctx.replay) return;
    ctx.replay.endTrial();
    var s = ctx.segmenter.state();
    if (s.open) ctx.replay.startTrial(s.currentTrialId);
  }

  // Once per page, from the first end() of any component: datastore.set()
  // stages its fields into the next commit only, and every row (a skipped
  // component's and a Dummy's included) is committed inside its own end(), so
  // the first end() puts the participant id on row 0 (the CLI's CSV reader
  // hoists the id from row 0).
  function stamp(c) {
    var ds = datastoreOf(c);
    if (state.stamped || !ds || typeof ds.set !== 'function') return;
    state.stamped = true;
    try { ds.set(idFields(c, ds, {})); } catch (_) { /* the rows carry it too */ }
  }

  // A trial that ends without its run() having passed through the hook was
  // already on screen when ch.js installed: its events go into the next
  // segment's gap, and its row gets no columns.
  function warnIfRunningBeforeInstall(c) {
    if (state.warnedRunning || state.finalized || (c.internals && c.internals.chRunSeen) || !isTrial(c, lab)) return;
    state.warnedRunning = true;
    console.warn(MESSAGES.labjsStudyAlreadyRunning());
  }

  function afterRun(c, controlled) {
    if (!controlled || !isTrial(c, lab)) return;
    // Ended inside its own run(): skip, Dummy. No trial was on screen.
    if (c.data && c.data.ended_on !== undefined && c.data.ended_on !== null) return;
    var internals = c.internals || (c.internals = {});
    if (ctx.bootError) {
      (c.data || (c.data = {})).cyborgHunterError = 'Cyborg Hunter did not start: ' + ctx.bootError;
      return;
    }
    if (state.finalized) {
      if (!state.warnedSecond) { state.warnedSecond = true; console.warn(MESSAGES.secondLabJsStudy()); }
      return;
    }
    internals.chRuns = (internals.chRuns || 0) + 1;
    internals.chError = null;
    var o = trialOptions(c, { generation: generation, index: state.trialsRun, rerun: internals.chRuns, lab: lab });
    state.trialsRun += 1;
    internals.chStart = performance.now();   // same anchor as the jsPsych extension's on_load
    var r = ctx.segmenter.rotate(o);
    internals.chOpen = true;
    if (r && r.error) internals.chError = r.error;
    followReplay();
    try { if (ctx.debug && ctx.debug.refresh) ctx.debug.refresh(); } catch (_) { /* a debug aid */ }
  }

  // Before lab.js's own end() commits this component's row.
  function beforeEnd(c) {
    if (ctx.bootError) return;
    stamp(c);
    warnIfRunningBeforeInstall(c);
    var internals = c.internals;
    if (!internals || !internals.chOpen) return;
    internals.chOpen = false;
    var t0 = ctx.debug ? performance.now() : 0;
    var data = c.data || (c.data = {});
    var r = ctx.segmenter.cut({ source: 'host', nextTrialId: 'gap-' + state.trialsRun });
    if (r && r.segment) {
      var report = r.trialReport || {};
      report.trialStart_perfNow = internals.chStart;
      data.integrity = report;
      data.integritySegment = r.segment;
      data.integrityPasteCount = r.segment.counters.pasteCount;
      data.integrityCopyCount = r.segment.counters.copyCount;
      data.integrityDropCount = r.segment.counters.dropCount;
      data.integritySoftScore = r.segment.score.softScore;
      data.integrityAnyHardTriggered = r.segment.score.anyHardTriggered;
      state.segmentsWritten += 1;
      state.lastTrial = c;
      // A segment that comes with an error is complete; only the next span
      // failed to open. Save it, and mark the row.
      var err = r.error || internals.chError;
      if (err) data.cyborgHunterError = err;
    } else {
      data.cyborgHunterError = (r && r.error) || internals.chError || 'no segment';
    }
    idFields(c, datastoreOf(c), data);
    followReplay();
    try {
      if (ctx.debug && ctx.debug.stats) ctx.debug.stats().segmentWriteMs.push(performance.now() - t0);
      if (ctx.debug && ctx.debug.refresh) ctx.debug.refresh();
    } catch (_) { /* debug counters are optional */ }
  }

  // Both generations' run() is async; a synchronous throw (not seen in
  // either) is passed through as it is. A rejection (23's AbortFlip for a
  // skipped component) opens nothing.
  function wrappedRun() {
    var self = this;
    var controlled = generation === 'flip' ? !!(arguments[0] && arguments[0].controlled) : true;
    try { if (self.internals) self.internals.chRunSeen = true; } catch (_) { /* only the running-before-install warning reads it */ }
    var result = origRun.apply(self, arguments);
    if (!result || typeof result.then !== 'function') {
      try { afterRun(self, controlled); } catch (e) { markFailed(self, e); }
      return result;
    }
    return result.then(function (v) {
      try { afterRun(self, controlled); } catch (e) { markFailed(self, e); }
      return v;
    });
  }

  function wrappedEnd() {
    var self = this;
    try { beforeEnd(self); } catch (e) { markFailed(self, e); }
    return origEnd.apply(self, arguments);
  }

  var handle = {
    restore: function () {
      if (proto.run === wrappedRun) proto.run = origRun;
      if (proto.end === wrappedEnd) proto.end = origEnd;
    },
    state: function () { return state; }
  };
  wrappedRun[PATCHED] = handle;
  wrappedEnd[PATCHED] = handle;
  proto.run = wrappedRun;
  proto.end = wrappedEnd;
  return handle;
}
