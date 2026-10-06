// src/cli/renderers/annotation-client.js
// The report's annotation controls, emitted by html-index-core.js only when
// the report has a run id (report-core.js runIdOf): Include / Exclude / Flag
// and a note in each participant's header, a badge on its rail row, and a
// "N of M reviewed" line with the exports and the import in the rail footer.
// The annotations are kept in the report's own localStorage under
// ch-annot:<runId>, so a report opened again from disk shows them again; the
// JSON export is the durable copy (another browser, another machine).
//
// Inline script text, not a module: the report is one HTML file. Kept as
// String.raw so the code reads as it runs (its regexes and "\n" stay as
// written); it must hold no backtick and no dollar-brace. The builders are a
// copy of annotations-core.js's, which the analyze page imports;
// tests/cli/report-annotations.test.js runs both copies on the same inputs.
import { inlineSafeJson } from '../../shared/inline-safe.js';

export const ANNOTATION_CSS = `    .annot { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px; margin-top: 10px; }
    .annot-btn { padding: 3px 10px; border: 1px solid var(--line); background: var(--surface); color: var(--ink);
      border-radius: 0; cursor: pointer; font-family: var(--ff-recursive); font-size: 15px; }
    .annot-btn[aria-pressed="true"] { background: var(--ink); color: var(--surface); border-color: var(--ink); }
    .annot-note { flex: 1 1 240px; min-height: 30px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 0;
      background: var(--bg); color: var(--ink); font: 13px/1.3 var(--ff-recursive); resize: vertical; }
    .annot-badge { font-family: var(--ff-sora); font-size: 10px; padding: 1px 5px; border: 1px solid var(--ink); flex-shrink: 0; }
    .annot-badge[data-label="exclude"] { background: var(--ink); color: var(--surface); }
    .annot-badge[data-label="flag"] { border-style: dashed; }
    .annot-bar { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line);
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-family: var(--ff-sora); }
    .annot-bar .annot-count, .annot-bar .annot-msg { flex-basis: 100%; }
    .annot-bar .annot-msg { color: var(--dim); }
    .annot-bar button { padding: 2px 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink);
      border-radius: 0; cursor: pointer; font-family: var(--ff-recursive); font-size: 13px; }
    .annot-bar label { font-family: var(--ff-tomorrow); color: var(--dim); }
`;

// A copy of annotations-core.js's builders (see the header).
export const ANNOTATION_BUILDERS_JS = String.raw`
      var ANNOTATION_LABELS = ['include', 'exclude', 'flag'];
      var ANNOTATIONS_FORMAT = 'cyborg-hunter-annotations';
      function csvCell(value) {
        var s = String(value == null ? '' : value);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }
      function own(map, id) {
        return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
      }
      function annotationsCsv(rows, annotations, runId, unreviewedAsIncluded) {
        var lines = ['participantId,tier,triageScore,label,note,annotatedAt,runId'];
        rows.forEach(function (r) {
          var a = own(annotations, r.participantId) || {};
          var label = a.label || (unreviewedAsIncluded ? 'include' : '');
          lines.push([r.participantId, r.tier, r.triageScore, label, a.note, a.annotatedAt, runId].map(csvCell).join(','));
        });
        return lines.join('\n') + '\n';
      }
      function annotationsJson(runId, annotations, exportedAt) {
        return JSON.stringify({ format: ANNOTATIONS_FORMAT, runId: runId, exportedAt: exportedAt, annotations: annotations }, null, 2) + '\n';
      }
      function readAnnotationsImport(text, cohortIds, runId) {
        var data = JSON.parse(text);
        if (!data || data.format !== ANNOTATIONS_FORMAT || !data.annotations || typeof data.annotations !== 'object') {
          throw new Error('not a cyborg-hunter annotations file');
        }
        var known = Object.create(null);
        cohortIds.forEach(function (id) { known[id] = true; });
        var annotations = Object.create(null), unknown = [], skipped = [];
        Object.keys(data.annotations).forEach(function (id) {
          var a = data.annotations[id];
          if (!known[id]) { unknown.push(id); return; }
          if (!a || typeof a !== 'object' || (a.label != null && ANNOTATION_LABELS.indexOf(a.label) < 0) ||
              (a.note != null && typeof a.note !== 'string')) { skipped.push(id); return; }
          annotations[id] = { label: a.label || null, note: a.note || '', annotatedAt: typeof a.annotatedAt === 'string' ? a.annotatedAt : '' };
        });
        return { annotations: annotations, unknown: unknown, skipped: skipped, otherRun: data.runId !== runId };
      }
      function importMessage(result) {
        var n = Object.keys(result.annotations).length;
        var text = 'Imported ' + n + ' annotation' + (n === 1 ? '' : 's') + '.';
        if (result.unknown.length) text += ' Not in this report: ' + result.unknown.join(', ') + '.';
        if (result.skipped.length) text += ' Not read: ' + result.skipped.join(', ') + '.';
        if (result.otherRun) text += ' The file comes from another report.';
        return text;
      }
`;

// The controls. `cfg` is { runId }.
export const ANNOTATION_UI_JS = String.raw`
      var RUN_ID = cfg.runId;
      var KEY = 'ch-annot:' + RUN_ID;
      var TEXT = { include: 'Include', exclude: 'Exclude', flag: 'Flag' };
      // Rail rows and detail panes are emitted in the same (triage) order, so
      // the i-th pane belongs to the i-th row, whose data-pid is the raw id.
      var rows = [].slice.call(document.querySelectorAll('.cohort-row'));
      var panes = [].slice.call(document.querySelectorAll('.participant'));
      var ids = rows.map(function (r) { return r.dataset.pid; });

      function toMap(obj) {
        var m = Object.create(null);
        if (obj && typeof obj === 'object') Object.keys(obj).forEach(function (k) { m[k] = obj[k]; });
        return m;
      }
      function load() {
        try { return toMap(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.create(null); }
      }
      // Storage can be refused (a private window, a blocked file: origin): the
      // annotations then last as long as the page, and Export JSON keeps them.
      function save() {
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* see above */ }
      }
      var state = load();

      function setAnnotation(id, label, note) {
        if (!label && !note) delete state[id];
        else state[id] = { label: label || null, note: note || '', annotatedAt: new Date().toISOString() };
        save();
        render();
      }

      // In each pane's header: the three labels (the pressed one pressed
      // again clears it) and a note, saved when the field loses focus.
      var controls = panes.map(function (pane, i) {
        var id = ids[i];
        var header = pane.querySelector('.detail-header');
        if (id === undefined || !header) return null;
        var box = document.createElement('div');
        box.className = 'annot';
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', 'Annotation');
        var note = document.createElement('textarea');
        note.className = 'annot-note';
        note.rows = 1;
        note.placeholder = 'Note';
        note.setAttribute('aria-label', 'Note on this participant');
        note.addEventListener('change', function () {
          var a = own(state, id);
          setAnnotation(id, a ? a.label : null, note.value);
        });
        var buttons = ANNOTATION_LABELS.map(function (label) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'annot-btn';
          b.dataset.label = label;
          b.textContent = TEXT[label];
          b.addEventListener('click', function () {
            var a = own(state, id);
            setAnnotation(id, a && a.label === label ? null : label, note.value);
          });
          box.appendChild(b);
          return b;
        });
        box.appendChild(note);
        header.appendChild(box);
        return { buttons: buttons, note: note };
      });

      // A badge on each rail row, before its score.
      var badges = rows.map(function (row) {
        var top = row.querySelector('.cohort-row-top');
        var badge = document.createElement('span');
        badge.className = 'annot-badge';
        badge.hidden = true;
        top.insertBefore(badge, top.querySelector('.score'));
        return badge;
      });

      // The rail footer: how many are reviewed, then the exports and the import.
      var bar = document.createElement('div');
      bar.className = 'annot-bar';
      var count = document.createElement('span');
      count.className = 'annot-count';
      count.setAttribute('role', 'status');
      bar.appendChild(count);
      document.querySelector('.rail-footer').appendChild(bar);
      addTools();

      function addTools() {
        function tool(text, onClick) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = text;
          b.addEventListener('click', onClick);
          bar.appendChild(b);
        }
        function download(name, text, type) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text], { type: type }));
          a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
        }
        var unreviewed = document.createElement('input');
        unreviewed.type = 'checkbox';
        tool('Export CSV', function () {
          // In triage order, whatever the rail's sort.
          var exportRows = rows.map(function (r) { return { participantId: r.dataset.pid, tier: r.dataset.tier, triageScore: r.dataset.score }; });
          download('annotations-' + RUN_ID + '.csv', annotationsCsv(exportRows, state, RUN_ID, unreviewed.checked), 'text/csv');
        });
        tool('Export JSON', function () {
          download('annotations-' + RUN_ID + '.json', annotationsJson(RUN_ID, state, new Date().toISOString()), 'application/json');
        });
        var unreviewedLabel = document.createElement('label');
        unreviewedLabel.appendChild(unreviewed);
        unreviewedLabel.appendChild(document.createTextNode(' count unreviewed as included'));
        bar.appendChild(unreviewedLabel);
        var file = document.createElement('input');
        file.type = 'file';
        file.accept = '.json,application/json';
        file.hidden = true;
        bar.appendChild(file);
        tool('Import…', function () { file.click(); });
        var message = document.createElement('span');
        message.className = 'annot-msg';
        message.setAttribute('role', 'status');
        bar.appendChild(message);
        file.addEventListener('change', function () {
          var chosen = file.files && file.files[0];
          if (!chosen) return;
          chosen.text().then(function (text) {
            var result = readAnnotationsImport(text, ids, RUN_ID);
            Object.keys(result.annotations).forEach(function (id) { state[id] = result.annotations[id]; });
            save();
            render();
            message.textContent = importMessage(result);
          }).catch(function (e) {
            message.textContent = 'Import failed: ' + (e && e.message ? e.message : String(e));
          }).then(function () { file.value = ''; });
        });
      }

      // i, e and f set the label of the participant on screen; not while
      // typing in a field, and not with a modifier key.
      document.addEventListener('keydown', function (e) {
        var label = e.key === 'i' ? 'include' : e.key === 'e' ? 'exclude' : e.key === 'f' ? 'flag' : null;
        if (!label || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        var i = panes.findIndex(function (p) { return !p.hasAttribute('hidden'); });
        if (i < 0 || ids[i] === undefined) return;
        var a = own(state, ids[i]);
        setAnnotation(ids[i], a && a.label === label ? null : label, a ? a.note : '');
      });

      function render() {
        var reviewed = 0;
        ids.forEach(function (id, i) {
          var a = own(state, id);
          var label = a ? a.label : null;
          if (label) reviewed++;
          badges[i].hidden = !label;
          badges[i].textContent = label || '';
          badges[i].dataset.label = label || '';
          var c = controls[i];
          if (!c) return;
          c.buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.label === label)); });
          // A note being typed is not overwritten.
          if (document.activeElement !== c.note) c.note.value = a ? a.note : '';
        });
        count.textContent = reviewed + ' of ' + ids.length + ' reviewed';
      }
      render();
`;

/**
 * The style and script blocks html-index-core.js emits before </body>, with
 * their own leading newline (the page without them is unchanged).
 * @param {{ runId: string }} cfg
 */
export function annotationBlock(cfg) {
  return '\n  <style>\n' + ANNOTATION_CSS + '  </style>\n  <script>\n    (function (cfg) {' +
    ANNOTATION_BUILDERS_JS + ANNOTATION_UI_JS + '    })(' + inlineSafeJson(cfg) + ');\n  </script>';
}
