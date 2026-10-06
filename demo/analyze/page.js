// demo/analyze/page.js
// The page's steps over one worker: files (each drop or file choice adds to
// the list and checks it again; or the sample) → run → results. All
// participant data stays in the worker (File handles go over,
// the worker reads the bytes one file at a time); this module only holds
// what the page shows: counts, warnings, the report HTML, the zip chunks.
// One exception, opts.transferBytes (main.js sets it for a page opened from
// file:): WebKit's worker cannot read a File there, so the page reads each
// dropped file itself and transfers the bytes, for every check and run.
//
// The worker's messages carry no run id (worker-entry.js), so the page runs
// ONE operation at a time: while a check or a run is in flight the controls
// that would start another are disabled, and a run that fails throws away
// the zip chunks it had already streamed before a retry is offered.
import { swapIframe } from '../report-frame.js';
import { collectDropped, filesFromInput } from './drop.js';
import { createReplayCard } from './replay-card.js';
import { mergeEntries, removeEntry } from './files-panel.js';

var ZIP_NAME = 'cyborg-hunter-report.zip';

function q(root, role) { return root.querySelector('[data-role="' + role + '"]'); }
function download(name, blobOrText, type) {
  var blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: type || 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  // Revoked later, not now: the browser may still be reading the blob.
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
}
// What the check read each file as (worker-entry.js's `files[].kind`), in
// the file table.
var KIND_LABELS = { data: 'participant data', recording: 'replay recording', asset: 'experiment asset',
  config: 'settings', ignored: 'ignored', unreadable: 'unreadable' };
function countSpan(n, one, many) { return '<span><b>' + n + '</b> ' + (n === 1 ? one : many) + '</span>'; }

// What the id suggestion was read from: the data files peeked, and the
// replay recordings among the dropped JSON files, which the peek leaves out.
function filesInspectedText(sampled, recordings) {
  var text = sampled + ' data file' + (sampled === 1 ? '' : 's') + ' inspected';
  if (recordings) text += '; ' + recordings + ' replay recording' + (recordings === 1 ? '' : 's') + ' skipped';
  return text;
}
function listWarnings(ul, items) {
  ul.innerHTML = '';
  (items || []).forEach(function (w) {
    var li = document.createElement('li');
    li.textContent = typeof w === 'string' ? w : w.file + ': ' + w.warnings.join(' ');
    ul.appendChild(li);
  });
}

export function createPage(root, worker, opts) {
  var state = { step: 'files', entries: [], dropCount: 0, sample: false, checked: null, idField: null, result: null,
    zipParts: [], zipUrl: null, selected: null, assets: null, limits: null };
  var pending = {};        // the awaited 'checked' or 'done' reply: { resolve, reject }
  var replayWaiters = [];  // replay requests in the order sent; the worker answers in order
  var replayCard = null;
  var reportUrl = null;
  // True from a run's results until the new report's first selection message:
  // that one is the report's own load-time pick of its first row.
  var reportFirstSelection = false;
  // The report posts a selection message when its script runs. One that has
  // not arrived reportWatchdogMs after the frame loaded means the report did
  // not render (seen in Firefox with a few hundred participants).
  // opts.timers ({ set, clear }) lets a test drive the clock by hand.
  var reportWatchdogMs = opts && opts.reportWatchdogMs ? opts.reportWatchdogMs : 10000;
  var timers = (opts && opts.timers) || { set: function (fn, ms) { return setTimeout(fn, ms); }, clear: function (id) { clearTimeout(id); } };
  var reportWatchdog = null;
  var reportPosted = false;
  // A check or run that has sent no progress for stallHintMs gets a hint
  // that it is still going (the stall-hint element, outside the steps so it
  // shows under the check as under the run). A hint only: nothing is
  // cancelled or restarted, since a large cohort can be slow and still finish.
  var stallHintMs = opts && opts.stallHintMs ? opts.stallHintMs : 60000;
  var stallTimer = null;
  // True while the error on screen is the watchdog's: a selection that
  // arrives late proves the report rendered after all, and clears it.
  var watchdogErrorShown = false;
  // The report frame's own load timeout (report-frame.js). The demo's 5 s
  // default was sized for a few participants; at the tested cohort size the
  // report is tens of MB. "Loaded but never rendered" is the render
  // watchdog's job, not this one's.
  var REPORT_LOAD_TIMEOUT_MS = 60000;
  var runButton = root.querySelector('[data-action="run"]');
  var resetButtons = root.querySelectorAll('[data-action="reset"]');

  function send(msg, transfer) { worker.postMessage(msg, transfer || []); }
  function waitFor(type) { return new Promise(function (resolve, reject) { pending[type] = { resolve: resolve, reject: reject }; }); }
  function busy() { return !!(pending.checked || pending.done); }
  function goTo(name) {
    state.step = name;
    root.querySelectorAll('section.step').forEach(function (s) { s.hidden = s.dataset.step !== name; });
  }
  function updateControls() {
    // A file the check read as data, as the counts line says: the classifier's
    // participant list also holds every JSON recording.
    runButton.disabled = busy() || !state.checked || kindCount(state.checked, 'data') === 0;
    resetButtons.forEach(function (b) { b.disabled = busy(); });
  }
  function showError(message) { var el = q(root, 'error'); el.textContent = message; el.hidden = false; watchdogErrorShown = false; }
  function clearError() { var el = q(root, 'error'); el.textContent = ''; el.hidden = true; watchdogErrorShown = false; }
  function stopWatchdog() { if (reportWatchdog) { timers.clear(reportWatchdog); reportWatchdog = null; } }
  function armWatchdog() {
    stopWatchdog();
    // No participants, no row to select, no message to wait for.
    if (reportPosted || !state.result || !state.result.participants.length) return;
    reportWatchdog = timers.set(function () {
      reportWatchdog = null;
      showError('The report did not finish rendering in this browser. The zip download still contains the full report: open its index.html directly, or use the CLI.');
      watchdogErrorShown = true;
    }, reportWatchdogMs);
  }
  function hideStallHint() {
    if (stallTimer) { timers.clear(stallTimer); stallTimer = null; }
    q(root, 'stall-hint').hidden = true;
  }
  // (Re)starts the wait: called when a check or run is sent, and on each of
  // its progress messages.
  function armStallHint() {
    hideStallHint();
    stallTimer = timers.set(function () { stallTimer = null; q(root, 'stall-hint').hidden = false; }, stallHintMs);
  }
  function discardZip() {
    state.zipParts = [];
    if (state.zipUrl) { URL.revokeObjectURL(state.zipUrl); state.zipUrl = null; }
  }

  // Every failure lands here, from the worker ({ type: 'error', phase }) or
  // from the page's own code. A replay failure leaves the results alone; a
  // check failure goes back to an empty files step; a run failure goes back
  // to the file list with its partial zip discarded and the run control
  // enabled for a retry.
  function recover(phase, message, warnings) {
    showError(message);
    if (phase === 'replay') {
      var w = replayWaiters.shift();
      if (w) w.reject(handled(message));
      return;
    }
    hideStallHint();
    for (var k in pending) { pending[k].reject(handled(message)); delete pending[k]; }
    // A failed run goes back to the files step, whose list already holds the
    // config warnings: the run's own go under them.
    if (warnings) listWarnings(q(root, 'check-warnings'), (state.checked && phase !== 'check' ? state.checked.configWarnings || [] : []).concat(warnings));
    // A check that fails empties the list: drops add to it now, and a file
    // that cannot be read would fail every later check while the table that
    // offers Remove is not shown.
    if (phase === 'check' || !state.checked) {
      state.checked = null; state.entries = []; state.dropCount = 0;
      q(root, 'files-panel').hidden = true; goTo('files');
    }
    else { discardZip(); goTo('files'); }
    updateControls();
  }
  // A rejection recover() already reported: the caller's catch must not
  // report (and re-route) it a second time.
  function handled(message) { var e = new Error(message); e.handled = true; return e; }
  function onFailure(phase) {
    return function (err) { if (!err || !err.handled) recover(phase, err && err.message ? err.message : String(err)); };
  }

  // A failure of the worker itself (a script error outside a job, a message
  // that cannot be read, a worker the browser killed) carries no phase: it is
  // charged to whatever is in flight, so a pending check or run cannot leave
  // the page busy for good. The worker is then replaced by a fresh one from
  // opts.createWorker, since a dead worker would swallow the retry. The new
  // one holds no run, so replays need the report built again.
  function inFlight() { return pending.done ? 'run' : pending.checked ? 'check' : replayWaiters.length ? 'replay' : null; }
  function workerFailed(message) {
    var phase = inFlight();
    var restarted = replaceWorker();
    var text = 'The analysis worker failed' + (message ? ': ' + message : '') + '. ' +
      (restarted ? (state.result ? 'It was restarted; build the report again to load replays.' : 'It was restarted; try again.') + ' If it fails again, use the CLI.'
        : 'Reload the page to try again, or use the CLI.');
    if (phase) recover(phase, text); else showError(text);
    // The new worker answers none of the old requests: settle every replay
    // still waiting, or the next answer would pair with a stale waiter.
    while (replayWaiters.length) replayWaiters.shift().reject(handled(text));
  }
  function replaceWorker() {
    if (!opts || !opts.createWorker) return false;
    try { worker.terminate(); } catch (e) { /* already gone */ }
    attach(opts.createWorker());
    return true;
  }
  // Messages count only from the current worker: one that failed may still
  // have had messages queued.
  function attach(w) {
    worker = w;
    w.onmessage = function (ev) { if (w === worker) onMessage(ev); };
    w.onerror = function (e) { if (w === worker) workerFailed(e && e.message); };
    w.onmessageerror = function () { if (w === worker) workerFailed('a message from it could not be read'); };
  }

  var fontsInstalled = false;
  function onMessage(ev) {
    var msg = ev.data || {};
    if (msg.type === 'ready') {
      state.assets = msg.assets; state.limits = msg.limits;
      q(root, 'tested-size').textContent = String(msg.limits.testedParticipants);
      // The report's fonts for the page itself, from the bundle (font-src data:
      // only: nothing is fetched). The report and the replay host inline them too.
      if (!fontsInstalled) { var style = document.createElement('style'); style.textContent = msg.assets.fontFaceCss; document.head.appendChild(style); fontsInstalled = true; }
      if (opts && opts.onReady) opts.onReady();
    } else if (msg.type === 'progress') {
      if (busy()) armStallHint();
      var bar = q(root, 'progress');
      if (msg.total > 0) { bar.max = msg.total; bar.value = msg.done; } else { bar.removeAttribute('value'); }
      q(root, 'progress-label').textContent = msg.phase + (msg.label ? ': ' + msg.label : '') + (msg.total ? ' (' + msg.done + '/' + msg.total + ')' : '');
    } else if (msg.type === 'zip') {
      state.zipParts.push(msg.chunk);
    } else if (msg.type === 'error') {
      recover(msg.phase, msg.message, msg.warnings);
    } else if (msg.type === 'replay-model') {
      var w = replayWaiters.shift();
      if (w) w.resolve(msg.model);
    } else if (pending[msg.type]) {
      hideStallHint();
      var p = pending[msg.type]; delete pending[msg.type]; p.resolve(msg);
    }
  }
  attach(worker);

  // Sends a check or run with the dropped files attached: File handles, or
  // with opts.transferBytes each file's bytes, read afresh for every message
  // (a transferred buffer is gone from this side). A file that cannot be read
  // fails the step like a worker error would.
  function sendWithFiles(msg) {
    if (state.sample || !(opts && opts.transferBytes)) {
      msg.files = state.sample ? [] : state.entries.map(function (e) { return { path: e.path, file: e.file }; });
      send(msg);
      return;
    }
    Promise.all(state.entries.map(function (e) { return e.file.arrayBuffer(); })).then(function (buffers) {
      msg.files = state.entries.map(function (e, i) { return { path: e.path, bytes: buffers[i] }; });
      send(msg, buffers);
    }).catch(function (err) {
      recover(msg.type, 'A dropped file could not be read: ' + (err && err.message ? err.message : String(err)));
    });
  }

  async function check() {
    if (busy()) return;
    clearError();
    state.checked = null;
    goTo('files');
    q(root, 'files-panel').hidden = false;
    q(root, 'file-rows').innerHTML = '';
    q(root, 'config-source').textContent = '';
    q(root, 'counts').innerHTML = '<span class="hint">Reading the files…</span>';
    listWarnings(q(root, 'check-warnings'), []);
    q(root, 'size-warning').hidden = true;
    var reply = waitFor('checked');
    updateControls();
    armStallHint();
    sendWithFiles({ type: 'check', sample: state.sample });
    var checked = await reply;
    state.checked = checked;
    renderFiles(checked);
    var sel = q(root, 'id-field'); sel.innerHTML = '';
    var offered = {};
    checked.idSuggestion.candidates.forEach(function (cand) {
      // The config's field is also a known name more often than not: list it once.
      if (offered[cand.field]) return;
      offered[cand.field] = true;
      var o = document.createElement('option'); o.value = cand.field; o.textContent = cand.field + ' — ' + cand.reason; sel.appendChild(o);
    });
    if (!checked.idSuggestion.candidates.length) {
      var o2 = document.createElement('option'); o2.value = checked.config.participantIdField; o2.textContent = checked.config.participantIdField + ' — CLI default'; sel.appendChild(o2);
    }
    if (checked.idSuggestion.suggested && offered[checked.idSuggestion.suggested]) sel.value = checked.idSuggestion.suggested;
    state.idField = sel.value;
    q(root, 'id-files').textContent = filesInspectedText(checked.sampled, checked.recordings);
    listWarnings(q(root, 'check-warnings'), checked.configWarnings);
    var tested = state.limits && state.limits.testedParticipants;
    var dataFiles = kindCount(checked, 'data');
    if (tested && dataFiles > tested) {
      q(root, 'size-warning-text').textContent = 'This cohort has ' + dataFiles + ' data files, more than the ' + tested +
        ' participants this page was tested with. It may be slow or fail in some browsers. You can still build the report here, or use the CLI, which is not limited by browser memory.';
      q(root, 'size-warning').hidden = false;
    }
    updateControls();
  }

  function kindCount(checked, kind) {
    return (checked.files || []).filter(function (f) { return f.kind === kind; }).length;
  }

  // The recognised-files table (one row per file, what it was read as, and
  // a Remove control; the sample has no file list of its own to edit), the
  // counts by kind, and where the settings came from.
  function renderFiles(checked) {
    var rows = q(root, 'file-rows');
    rows.innerHTML = '';
    (checked.files || []).forEach(function (f) {
      var tr = document.createElement('tr');
      var name = document.createElement('td');
      var code = document.createElement('code');
      code.textContent = f.path;
      name.appendChild(code);
      var kind = document.createElement('td');
      kind.textContent = KIND_LABELS[f.kind] || f.kind;
      var act = document.createElement('td');
      if (!state.sample) {
        var b = document.createElement('button');
        b.className = 'secondary';
        b.dataset.action = 'remove-file';
        b.dataset.path = f.path;
        b.textContent = 'Remove';
        b.setAttribute('aria-label', 'Remove ' + f.path);
        act.appendChild(b);
      }
      tr.appendChild(name); tr.appendChild(kind); tr.appendChild(act);
      rows.appendChild(tr);
    });
    var ignored = kindCount(checked, 'ignored'), unreadable = kindCount(checked, 'unreadable');
    q(root, 'counts').innerHTML =
      countSpan(kindCount(checked, 'data'), 'data file', 'data files') +
      countSpan(kindCount(checked, 'recording'), 'replay recording', 'replay recordings') +
      countSpan(kindCount(checked, 'asset'), 'experiment asset', 'experiment assets') +
      countSpan(checked.configFound ? 1 : 0, 'config file', 'config files') +
      (ignored ? countSpan(ignored, 'ignored', 'ignored') : '') +
      (unreadable ? countSpan(unreadable, 'unreadable', 'unreadable') : '');
    q(root, 'config-source').textContent = checked.configPath
      ? 'Settings from ' + checked.configPath + ', over the defaults.'
      : 'Settings: the defaults (no cyborg-hunter.config.json among the files).';
  }

  async function run() {
    if (busy() || !state.checked) return;
    clearError();
    stopWatchdog();
    discardZip();
    goTo('run');
    var bar = q(root, 'progress'); bar.max = 1; bar.value = 0;
    q(root, 'progress-label').textContent = '';
    var reply = waitFor('done');
    updateControls();
    armStallHint();
    sendWithFiles({ type: 'run', sample: state.sample, config: state.checked.config, participantIdField: state.idField });
    var done = await reply;
    updateControls();
    state.result = done;
    state.zipUrl = URL.createObjectURL(new Blob(state.zipParts, { type: 'application/zip' }));
    goTo('results');
    q(root, 'summary').textContent = done.triageOrder.length + ' participants: ' + done.counts.flaggedHard + ' hard, ' +
      done.counts.flaggedSoft + ' soft, ' + done.counts.clean + ' clean. Zip: ' + Math.round(done.zipBytes / 1024) + ' KB.';
    listWarnings(q(root, 'run-warnings'), done.warnings.concat(done.reportWarnings));
    root.querySelectorAll('[data-action="download"]').forEach(function (b) { b.disabled = typeof done.files[b.dataset.file] !== 'string'; });
    // reportUrl moves to the new document only once it has loaded: a failed
    // swap has already revoked its own url, and the old one is still showing.
    var fresh = swapIframe(q(root, 'report'), done.html, reportUrl, function () { reportUrl = fresh; armWatchdog(); },
      function () { showError('The report frame did not load.'); }, { className: 'analyze-report', title: 'Report', loadTimeoutMs: REPORT_LOAD_TIMEOUT_MS });
    if (!replayCard) {
      replayCard = createReplayCard(q(root, 'replay'), state.assets, function (pid) {
        clearError();
        var model = new Promise(function (resolve, reject) { replayWaiters.push({ resolve: resolve, reject: reject }); });
        send({ type: 'replay', participantId: pid });
        return model;
      });
    }
    replayCard.setParticipants(done.participants);
    reportFirstSelection = true;
    reportPosted = false;
  }

  function reset() {
    if (busy()) return;
    state.entries = []; state.sample = false; state.checked = null; state.result = null; state.selected = null;
    stopWatchdog();
    hideStallHint();
    discardZip();
    if (replayCard) replayCard.teardown();
    // The previous cohort's report leaves page memory with it.
    var frame = root.querySelector('iframe.analyze-report');
    if (frame) frame.remove();
    if (reportUrl) { URL.revokeObjectURL(reportUrl); reportUrl = null; }
    // The worker holds every participant and recording of the run for the
    // replay requests; nothing asks for one now.
    send({ type: 'reset' });
    listWarnings(q(root, 'run-warnings'), []);
    // Cleared so choosing the same files again still fires `change`.
    q(root, 'file-input').value = ''; q(root, 'dir-input').value = '';
    q(root, 'files-panel').hidden = true;
    state.dropCount = 0;
    goTo('files');
    clearError();
    updateControls();
  }

  // Each drop or file choice ADDS to the list (files-panel.js), and the list
  // is checked again. Files added after the sample replace it: the sample is
  // not a file list.
  function addFiles(entries) {
    if (busy()) return Promise.resolve();
    if (state.sample) { state.sample = false; state.entries = []; }
    state.dropCount++;
    state.entries = mergeEntries(state.entries, entries, state.dropCount);
    return check();
  }
  function removeFile(path) {
    if (busy()) return Promise.resolve();
    state.entries = removeEntry(state.entries, path);
    if (!state.entries.length) { reset(); return Promise.resolve(); }
    return check();
  }
  function loadSample() { if (busy()) return Promise.resolve(); state.sample = true; state.entries = []; return check(); }

  // Wiring
  var zone = q(root, 'dropzone');
  function onDrop(e) {
    e.preventDefault(); zone.classList.remove('over');
    if (state.step !== 'files' || busy()) return;
    // collectDropped reads every entry synchronously, before its first await.
    collectDropped(e.dataTransfer).then(addFiles).catch(onFailure('check'));
  }
  zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
  zone.addEventListener('drop', onDrop);
  // A drop that misses the zone would otherwise make the browser open the
  // file in place of this page: take it as a drop on the zone instead.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { if (!zone.contains(e.target)) onDrop(e); else e.preventDefault(); });
  // Cleared after reading, so choosing the same file again still fires `change`.
  ['file-input', 'dir-input'].forEach(function (r) {
    q(root, r).addEventListener('change', function (e) {
      var entries = filesFromInput(e.target);
      e.target.value = '';
      addFiles(entries).catch(onFailure('check'));
    });
  });
  q(root, 'file-rows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-action="remove-file"]');
    if (b) removeFile(b.dataset.path).catch(onFailure('check'));
  });
  root.querySelector('[data-action="sample"]').addEventListener('click', function () { loadSample().catch(onFailure('check')); });
  q(root, 'id-field').addEventListener('change', function (e) { state.idField = e.target.value; });
  runButton.addEventListener('click', function () { run().catch(onFailure('run')); });
  resetButtons.forEach(function (b) { b.addEventListener('click', reset); });
  root.querySelector('[data-action="download-zip"]').addEventListener('click', function () {
    if (!state.zipUrl) return;
    var a = document.createElement('a'); a.href = state.zipUrl; a.download = ZIP_NAME; document.body.appendChild(a); a.click(); a.remove();
  });
  root.querySelectorAll('[data-action="download"]').forEach(function (b) {
    b.addEventListener('click', function () {
      var name = b.dataset.file;
      download(name, state.result.files[name], name.endsWith('.md') ? 'text/markdown' : 'text/csv');
    });
  });
  root.querySelector('[data-action="export-config"]').addEventListener('click', function () {
    // CLI-ready: what this run used, with the file-system fields a CLI run needs.
    var cfg = Object.assign({}, state.result.configUsed, { dataDir: './data', filePattern: '*.{json,csv}', outputDir: './cyborg-hunter-report' });
    delete cfg.replayDir; delete cfg.noVisuals;
    download('cyborg-hunter.config.json', JSON.stringify(cfg, null, 2) + '\n', 'application/json');
  });
  // The report posts the selected participant (the report renderer's
  // selectionPostMessage option); only messages from the report frame count.
  window.addEventListener('message', function (e) {
    var frame = root.querySelector('iframe.analyze-report');
    if (!frame || e.source !== frame.contentWindow) return;
    if (!e.data || e.data.type !== 'cyborg-hunter:select') return;
    reportPosted = true;       // the report's script ran, whatever the id says
    stopWatchdog();
    if (watchdogErrorShown) clearError();
    if (!replayCard || !state.result) return;
    var pid = e.data.participantId;
    var known = typeof pid === 'string' && state.result.participants.some(function (p) { return p.participantId === pid; });
    if (!known) return;
    state.selected = pid;
    // The report's load-time pick must not undo a replay the analyst chose
    // (or loaded) while the report frame was still loading; every later
    // message is a row click and moves the dropdown.
    var first = reportFirstSelection;
    reportFirstSelection = false;
    if (first && replayCard.userChose()) return;
    replayCard.select(pid);
  });

  return { state: state, addFiles: addFiles, removeFile: removeFile, loadSample: loadSample, run: run, reset: reset,
    selectParticipant: function (pid) { if (replayCard) replayCard.select(pid); },
    loadReplay: function () { return replayCard ? replayCard.load() : Promise.resolve(); } };
}
