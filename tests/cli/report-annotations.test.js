// Per-participant annotations: the export and import builders
// (annotations-core.js), the report's own copy of them (annotation-client.js,
// run here in a vm context, since an inline script cannot import), and where
// the report emits its controls; then the report's annotation script itself,
// run over real report markup in happy-dom (which label a key sets, what it
// reads from storage and how it writes there). The clicks, the browsers'
// storage and the downloads are tests/e2e/report/annotations.spec.js.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import * as core from '../../src/cli/renderers/annotations-core.js';
import { ANNOTATION_BUILDERS_JS, ANNOTATION_UI_JS } from '../../src/cli/renderers/annotation-client.js';
import { inlineSrcHazards } from '../../src/shared/inline-safe.js';
import { csvCell } from '../../src/shared/csv-cell.js';

const ROWS = [
  { participantId: 'P-hard', tier: 'hard', triageScore: 15 },
  { participantId: 'P "soft", two', tier: 'soft', triageScore: 2.5 },
  { participantId: 'P-clean', tier: 'clean', triageScore: 0 },
];
const IDS = ROWS.map((r) => r.participantId);
const STATE = {
  'P-hard': { label: 'exclude', note: 'pasted the answer,\nthen "typed" it', annotatedAt: '2026-10-05T10:00:00.000Z' },
  'P-clean': { label: null, note: 'look again', annotatedAt: '2026-10-05T10:01:00.000Z' },
};
const HEADER = 'participantId,tier,triageScore,label,note,annotatedAt,runId\n';
// An import with one entry this report has, one it does not, and one whose
// label is not one of the three.
const MIXED = JSON.stringify({ format: 'cyborg-hunter-annotations', runId: 'other', annotations: {
  'P-hard': { label: 'flag', note: '', annotatedAt: '2026-10-05T12:00:00.000Z' },
  'P-gone': { label: 'include', note: '', annotatedAt: '2026-10-05T12:00:00.000Z' },
  'P-clean': { label: 'reject', note: '', annotatedAt: '2026-10-05T12:00:00.000Z' } } });

describe('annotation exports and imports', () => {
  it('the CSV has one row per participant in report order, quoted as summary.csv quotes', () => {
    assert.equal(core.annotationsCsv(ROWS, STATE, 'abc', false), HEADER +
      'P-hard,hard,15,exclude,"pasted the answer,\nthen ""typed"" it",2026-10-05T10:00:00.000Z,abc\n' +
      '"P ""soft"", two",soft,2.5,,,,abc\n' +
      'P-clean,clean,0,,look again,2026-10-05T10:01:00.000Z,abc\n');
  });

  it('a note a spreadsheet would run as a formula is exported as text, by the module and by the report\'s copy', () => {
    const copy = runInNewContext(ANNOTATION_BUILDERS_JS + '\n;({ annotationsCsv })');
    const state = { 'P-hard': { label: 'flag', note: '=HYPERLINK("x")', annotatedAt: 't' } };
    const row = 'P-hard,hard,15,flag,"\'=HYPERLINK(""x"")",t,abc';
    assert.equal(core.annotationsCsv(ROWS, state, 'abc', false).split('\n')[1], row);
    assert.equal(copy.annotationsCsv(ROWS, state, 'abc', false).split('\n')[1], row);
  });

  it('the CSV can count the unreviewed as included; a chosen label stays', () => {
    assert.equal(core.annotationsCsv(ROWS, STATE, 'abc', true), HEADER +
      'P-hard,hard,15,exclude,"pasted the answer,\nthen ""typed"" it",2026-10-05T10:00:00.000Z,abc\n' +
      '"P ""soft"", two",soft,2.5,include,,,abc\n' +
      'P-clean,clean,0,include,look again,2026-10-05T10:01:00.000Z,abc\n');
  });

  it('the JSON export reads back as the same annotations', () => {
    const text = core.annotationsJson('abc', STATE, '2026-10-05T11:00:00.000Z');
    assert.deepEqual(JSON.parse(text), { format: 'cyborg-hunter-annotations', runId: 'abc', exportedAt: '2026-10-05T11:00:00.000Z', annotations: STATE });
    const back = core.readAnnotationsImport(text, IDS, 'abc');
    assert.deepEqual({ ...back.annotations }, STATE);
    assert.deepEqual([back.unknown, back.skipped, back.otherRun], [[], [], false]);
  });

  it('an import applies what this report has, names what it does not, and says when it comes from another report', () => {
    const r = core.readAnnotationsImport(MIXED, IDS, 'abc');
    assert.deepEqual({ ...r.annotations }, { 'P-hard': { label: 'flag', note: '', annotatedAt: '2026-10-05T12:00:00.000Z' } });
    assert.deepEqual(r.unknown, ['P-gone']);
    assert.deepEqual(r.skipped, ['P-clean']);
    assert.equal(r.otherRun, true);
    assert.equal(core.importMessage(r), 'Imported 1 annotation. Not in this report: P-gone. Not read: P-clean. The file comes from another report.');
    assert.throws(() => core.readAnnotationsImport('{"annotations":{}}', IDS, 'abc'), /not a cyborg-hunter annotations file/);
  });

  it('a note longer than NOTE_MAX_LENGTH is not read; the message names ten ids of a kind, then counts the rest', () => {
    assert.equal(core.NOTE_MAX_LENGTH, 2000);
    const annotations = { 'P-hard': { label: 'flag', note: 'x'.repeat(2001), annotatedAt: '' }, 'P-clean': { label: 'include', note: 'x'.repeat(2000), annotatedAt: '' } };
    for (let i = 1; i <= 12; i++) annotations['P-gone-' + i] = { label: 'include', note: '', annotatedAt: '' };
    const r = core.readAnnotationsImport(JSON.stringify({ format: 'cyborg-hunter-annotations', runId: 'abc', annotations }), IDS, 'abc');
    assert.deepEqual(Object.keys(r.annotations), ['P-clean']);
    assert.deepEqual(r.skipped, ['P-hard']);
    assert.equal(r.unknown.length, 12);
    assert.equal(core.importMessage(r), 'Imported 1 annotation. Not in this report: P-gone-1, P-gone-2, P-gone-3, P-gone-4, P-gone-5, ' +
      'P-gone-6, P-gone-7, P-gone-8, P-gone-9, P-gone-10 … and 2 more. Not read: P-hard.');
  });

  it('a stored state is read as an import is: ids of this report, one of the three labels or none, a text note', () => {
    const stored = { 'P-hard': STATE['P-hard'], 'P-clean': { label: 'exclude', note: 42 }, 'P-gone': { label: 'flag', note: '', annotatedAt: 't' } };
    const r = core.checkAnnotations(stored, IDS);
    assert.deepEqual({ ...r.annotations }, { 'P-hard': STATE['P-hard'] });
    assert.deepEqual([r.unknown, r.skipped], [['P-gone'], ['P-clean']]);
    // Without the report's ids, only the entries are checked.
    assert.deepEqual(Object.keys(core.checkAnnotations(stored).annotations), ['P-hard', 'P-gone']);
  });

  it('the report\'s own copy gives the same results as the module', () => {
    const copy = runInNewContext(ANNOTATION_BUILDERS_JS + '\n;({ csvCell, annotationsCsv, annotationsJson, readAnnotationsImport, importMessage, checkAnnotations, NOTE_MAX_LENGTH })');
    // The copy's csvCell is src/shared/csv-cell.js's, word for word.
    const words = (f) => f.toString().replace(/\s+/g, ' ');
    assert.equal(words(copy.csvCell), words(csvCell));
    for (const unreviewed of [false, true]) {
      assert.equal(copy.annotationsCsv(ROWS, STATE, 'abc', unreviewed), core.annotationsCsv(ROWS, STATE, 'abc', unreviewed));
    }
    assert.equal(copy.annotationsJson('abc', STATE, 't'), core.annotationsJson('abc', STATE, 't'));
    // Compared as JSON: objects made in the vm context have its prototypes.
    assert.equal(JSON.stringify(copy.readAnnotationsImport(MIXED, IDS, 'abc')), JSON.stringify(core.readAnnotationsImport(MIXED, IDS, 'abc')));
    const r = core.readAnnotationsImport(MIXED, IDS, 'abc');
    assert.equal(copy.importMessage(r), core.importMessage(r));
    assert.throws(() => copy.readAnnotationsImport('{}', IDS, 'abc'), /not a cyborg-hunter annotations file/);
    assert.equal(copy.NOTE_MAX_LENGTH, core.NOTE_MAX_LENGTH);
    const stored = { ...STATE, 'P-gone': STATE['P-hard'], 'P-hard': { label: 'flag', note: 'x'.repeat(2001) } };
    for (const ids of [IDS, undefined]) {
      assert.equal(JSON.stringify(copy.checkAnnotations(stored, ids)), JSON.stringify(core.checkAnnotations(stored, ids)));
    }
    const many = { annotations: {}, unknown: Array.from({ length: 11 }, (_, i) => 'u' + i), skipped: Array.from({ length: 12 }, (_, i) => 's' + i), otherRun: false };
    assert.equal(copy.importMessage(many), core.importMessage(many));
  });
});

describe('the report emits its annotation controls only with a run id', () => {
  const config = { outputDir: '.', participantIdField: 'participantId' };
  const p = extractIntegrityData(JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT.json', 'utf8')), config);
  const summaries = computeSummary([p], config);
  const triage = rankTriage(summaries, detectEdgeExits([p], config), config);

  it('one style and one script block, keyed by the run id, after the report\'s own scripts', async () => {
    const html = await renderIndexHtml(summaries, triage, [p], config, false, { runId: '0123456789abcdef' });
    assert.equal(html.split("'ch-annot:'").length - 1, 1);
    assert.ok(html.includes('"runId":"0123456789abcdef"'));
    const block = html.slice(html.lastIndexOf('<style>'));
    assert.ok(block.includes('.annot-btn') && block.includes('ch-annot:'), 'the styles travel with the script, after the lazy loader');
    assert.ok(html.endsWith('</script>\n</body>\n</html>'));
  });

  it('none without one, only each rail row\'s empty mark and its slot\'s style (html-index-snapshot.test.js holds the whole page)', async () => {
    const html = await renderIndexHtml(summaries, triage, [p], config, false, {});
    assert.equal(html.split('<span class="annot-mark" data-label=""></span>').length - 1, 1, 'one row, one mark');
    assert.equal(html.includes('ch-annot:'), false);
    assert.deepEqual([...new Set(html.match(/annot-[\w-]+/g))], ['annot-mark']);
  });

  it('the in-page report hands its annotations to the page; the CLI report keeps its own', async () => {
    const inPage = await renderIndexHtml(summaries, triage, [p], config, false, { runId: '0123456789abcdef', annotationPostMessage: true });
    assert.ok(inPage.includes('{"runId":"0123456789abcdef","parent":true}'));
    const cli = await renderIndexHtml(summaries, triage, [p], config, false, { runId: '0123456789abcdef' });
    assert.ok(cli.includes('{"runId":"0123456789abcdef","parent":false}'));
  });

  it('the inlined script holds no script-end tag', () => {
    assert.equal(/<\/script/i.test(ANNOTATION_BUILDERS_JS + ANNOTATION_UI_JS), false);
    // Nor what would make the page's own script-end tag close nothing.
    assert.deepEqual(inlineSrcHazards(ANNOTATION_BUILDERS_JS + ANNOTATION_UI_JS), []);
  });
});

// The annotation script over the real report markup of two participants whose
// ids sanitize alike: 'a_b' and 'a b' share the pane id p-a_b, so selecting
// either shows both panes. The page is loaded without its own scripts; only
// the annotation script runs, in a vm context, over a stand-in storage.
describe('the report\'s annotation script', () => {
  const RUN = '0123456789abcdef';
  const KEY = 'ch-annot:' + RUN;
  const REFUSED = 'This browser does not let the report store annotations: they last until the page is closed. Export JSON keeps them.';
  const config = { outputDir: '.', participantIdField: 'participantId' };
  let html;
  before(async () => {
    const p = extractIntegrityData(JSON.parse(readFileSync('tests/fixtures/demo/DEMO-FIXT.json', 'utf8')), config);
    const ps = [{ ...p, participantId: 'a_b' }, { ...p, participantId: 'a b' }];
    const summaries = computeSummary(ps, config);
    html = await renderIndexHtml(summaries, rankTriage(summaries, detectEdgeExits(ps, config), config), ps, config, false, {});
  });

  // A storage like the browser's. refuse: every call throws, as in a private
  // window or a blocked file: origin.
  function memoryStorage(refuse) {
    const items = new Map();
    const check = () => { if (refuse) throw new Error('SecurityError'); };
    return { items, getItem: (k) => { check(); return items.has(k) ? items.get(k) : null; }, setItem: (k, v) => { check(); items.set(k, String(v)); } };
  }
  // cfg.parent: the window's parent is a stand-in that records what the
  // script posts to it.
  function mount(storage, cfg) {
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    const doc = win.document;
    doc.write(html);
    const posted = [];
    const parent = { postMessage: (m, target) => posted.push([m, target]) };
    if (cfg && cfg.parent) Object.defineProperty(win, 'parent', { configurable: true, value: parent });
    runInNewContext('(function (cfg) {' + ANNOTATION_BUILDERS_JS + ANNOTATION_UI_JS + '})(cfg);',
      { cfg: { runId: RUN, ...cfg }, window: win, document: doc, localStorage: storage, setTimeout, clearTimeout, URL, Blob });
    const rows = [...doc.querySelectorAll('.cohort-row')];
    const paneOf = (pid) => doc.querySelectorAll('.participant')[rows.findIndex((r) => r.dataset.pid === pid)];
    return {
      win, doc, posted, parent,
      stored: () => JSON.parse(storage.items.get(KEY) || '{}'),
      labels: () => Object.fromEntries(Object.entries(JSON.parse(storage.items.get(KEY) || '{}')).map(([k, v]) => [k, v.label])),
      // What the report's selectById does for an id of p-a_b: its row
      // selected, and both panes shown.
      select: (pid) => {
        rows.forEach((r) => r.classList.toggle('selected', r.dataset.pid === pid));
        doc.querySelectorAll('.participant').forEach((pane) => pane.removeAttribute('hidden'));
      },
      key: (key, over) => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, ...over })),
      mark: (pid) => doc.querySelector('.cohort-row[data-pid="' + pid + '"] .annot-mark'),
      note: (pid) => paneOf(pid).querySelector('.annot-note'),
    };
  }

  it('i, e and f label the selected row\'s participant, though both panes of its pane id show', () => {
    const r = mount(memoryStorage());
    assert.equal(r.doc.querySelectorAll('.participant[id="p-a_b"]').length, 2, 'the two ids share a pane id');
    r.select('a b');
    r.key('e');
    assert.deepEqual(r.labels(), { 'a b': 'exclude' });
    assert.equal(r.mark('a b').dataset.label, 'exclude');
    assert.equal(r.mark('a_b').dataset.label, '');
  });

  it('the header buttons carry the rail\'s glyphs before their words; the mark is named by its label\'s word', () => {
    const r = mount(memoryStorage());
    const buttons = [...r.note('a b').closest('.annot').querySelectorAll('.annot-btn')];
    assert.deepEqual(buttons.map((b) => b.textContent), ['✓ Include', '✗ Exclude', '⚑ Flag']);
    assert.deepEqual(buttons.map((b) => b.querySelector('span').getAttribute('aria-hidden')), ['true', 'true', 'true'],
      'the glyph is not read: each button is named by its word');
    const mark = r.mark('a b');
    const said = () => [mark.dataset.label, mark.getAttribute('role'), mark.getAttribute('aria-label')];
    assert.deepEqual(said(), ['', null, null], 'unreviewed: no glyph, no name');
    r.select('a b');
    r.key('f');
    assert.deepEqual(said(), ['flag', 'img', 'Flag']);
    r.key('f');
    assert.deepEqual(said(), ['', null, null], 'cleared: the name goes with the glyph');
  });

  it('a held key\'s repeats, and the keys while the legend or an enlarged image is open, label nothing', () => {
    const storage = memoryStorage();
    const r = mount(storage);
    r.select('a b');
    r.key('e', { repeat: true });
    r.doc.getElementById('legend-modal').removeAttribute('hidden');
    r.key('e');
    r.doc.getElementById('legend-modal').setAttribute('hidden', '');
    r.doc.getElementById('lightbox').classList.add('open');
    r.key('e');
    assert.equal(storage.items.has(KEY), false);
    r.doc.getElementById('lightbox').classList.remove('open');
    r.key('e');
    assert.deepEqual(r.labels(), { 'a b': 'exclude' });
  });

  // A replay viewer in fullscreen covers the report, as the report's own
  // navigation keys already allow for: the selected row is behind it.
  it('the keys while anything is in fullscreen (a replay viewer) label nothing', () => {
    const storage = memoryStorage();
    const r = mount(storage);
    r.select('a b');
    Object.defineProperty(r.doc, 'fullscreenElement', { configurable: true, value: r.doc.body });
    r.key('f');
    assert.equal(storage.items.has(KEY), false);
    Object.defineProperty(r.doc, 'fullscreenElement', { configurable: true, value: null });
    r.key('f');
    assert.deepEqual(r.labels(), { 'a b': 'flag' });
  });

  it('each change is written over what storage holds now, and another tab\'s change shows here', () => {
    const storage = memoryStorage();
    const r = mount(storage);
    // Another tab of the report writes after this one has loaded.
    storage.items.set(KEY, JSON.stringify({ a_b: { label: 'exclude', note: '', annotatedAt: 't' } }));
    r.select('a b');
    r.key('f');
    assert.deepEqual(r.labels(), { a_b: 'exclude', 'a b': 'flag' });
    assert.equal(r.mark('a_b').dataset.label, 'exclude', 'the page shows what it wrote');
    // A change in another tab, with none here: the storage event.
    storage.items.set(KEY, JSON.stringify({ a_b: { label: 'include', note: '', annotatedAt: 't' } }));
    r.win.dispatchEvent(new r.win.StorageEvent('storage', { key: KEY }));
    assert.equal(r.mark('a_b').dataset.label, 'include');
    assert.equal(r.mark('a b').dataset.label, '');
    assert.equal(r.doc.querySelector('.annot-count').textContent, '1 of 2 reviewed');
  });

  it('what storage holds is read as an import is: an id of this report, one of the three labels', () => {
    const storage = memoryStorage();
    storage.items.set(KEY, JSON.stringify({ a_b: { label: 'exclude', note: 'ok', annotatedAt: 't' }, 'a b': { label: 'reject', note: '' },
      zz: { label: 'flag', note: '', annotatedAt: 't' } }));
    const r = mount(storage);
    assert.equal(r.doc.querySelector('.annot-count').textContent, '1 of 2 reviewed');
    assert.equal(r.mark('a b').dataset.label, '');
    r.select('a_b');
    r.key('f');
    assert.deepEqual(r.labels(), { a_b: 'flag' }, 'the next write drops what was not read');
  });

  it('a refused save keeps the change on the page and says so, once', () => {
    const r = mount(memoryStorage(true));
    const msg = r.doc.querySelector('.annot-msg');
    r.select('a b');
    r.key('e');
    assert.equal(r.mark('a b').dataset.label, 'exclude');
    assert.equal(msg.textContent, REFUSED);
    msg.textContent = '';
    r.key('f');
    assert.equal(r.mark('a b').dataset.label, 'flag');
    assert.equal(msg.textContent, '', 'only on the first failure');
  });

  it('a note is saved as it is typed, when the field is left, and when the page goes away; it has a length limit', () => {
    const r = mount(memoryStorage());
    const note = r.note('a b');
    assert.equal(note.maxLength, 2000);
    note.value = 'first';
    note.dispatchEvent(new r.win.Event('input'));
    r.win.dispatchEvent(new r.win.Event('pagehide'));
    assert.equal(r.stored()['a b'].note, 'first');
    note.value = 'second';
    note.dispatchEvent(new r.win.Event('input'));
    note.dispatchEvent(new r.win.Event('change'));
    assert.equal(r.stored()['a b'].note, 'second');
    assert.equal(r.stored()['a b'].label, null);
  });

  it('in the analyze page it posts each change to the page, stores nothing, and shows the state only the page posts', () => {
    const storage = memoryStorage();
    const r = mount(storage, { parent: true });
    assert.equal(r.doc.querySelector('.annot-bar').querySelectorAll('button').length, 0, 'no exports: the page has them');
    r.select('a b');
    r.key('e');
    // Through JSON: objects made in the vm context have its prototypes.
    assert.deepEqual(JSON.parse(JSON.stringify(r.posted)), [[{ type: 'cyborg-hunter:annotate', runId: RUN, participantId: 'a b', label: 'exclude', note: '' }, '*']]);
    assert.equal(storage.items.has(KEY), false);
    const state = { type: 'cyborg-hunter:annotations', runId: RUN, annotations: { a_b: { label: 'flag', note: '', annotatedAt: 't' } } };
    const message = (data, source) => r.win.dispatchEvent(new r.win.MessageEvent('message', { data, source }));
    message(state, {});
    message({ ...state, runId: 'ffffffffffffffff' }, r.parent);
    assert.equal(r.mark('a_b').dataset.label, '', 'not from the page, or not for this run');
    message(state, r.parent);
    assert.equal(r.mark('a_b').dataset.label, 'flag');
    assert.equal(r.mark('a b').dataset.label, '', 'the page\'s state replaces the report\'s');
  });
});
