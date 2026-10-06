// Per-participant annotations: the export and import builders
// (annotations-core.js), the report's own copy of them (annotation-client.js,
// run here in a vm context, since an inline script cannot import), and where
// the report emits its controls. The clicks, the storage and the downloads
// are tests/e2e/report/annotations.spec.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { extractIntegrityData } from '../../src/cli/extract-core.js';
import { computeSummary } from '../../src/cli/analyzers/summary.js';
import { detectEdgeExits } from '../../src/cli/analyzers/edge-exit.js';
import { rankTriage } from '../../src/cli/analyzers/triage.js';
import { renderIndexHtml } from '../../src/cli/renderers/html-index-core.js';
import * as core from '../../src/cli/renderers/annotations-core.js';
import { ANNOTATION_BUILDERS_JS, ANNOTATION_UI_JS } from '../../src/cli/renderers/annotation-client.js';

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

  it('the report\'s own copy gives the same results as the module', () => {
    const copy = runInNewContext(ANNOTATION_BUILDERS_JS + '\n;({ annotationsCsv, annotationsJson, readAnnotationsImport, importMessage })');
    for (const unreviewed of [false, true]) {
      assert.equal(copy.annotationsCsv(ROWS, STATE, 'abc', unreviewed), core.annotationsCsv(ROWS, STATE, 'abc', unreviewed));
    }
    assert.equal(copy.annotationsJson('abc', STATE, 't'), core.annotationsJson('abc', STATE, 't'));
    // Compared as JSON: objects made in the vm context have its prototypes.
    assert.equal(JSON.stringify(copy.readAnnotationsImport(MIXED, IDS, 'abc')), JSON.stringify(core.readAnnotationsImport(MIXED, IDS, 'abc')));
    const r = core.readAnnotationsImport(MIXED, IDS, 'abc');
    assert.equal(copy.importMessage(r), core.importMessage(r));
    assert.throws(() => copy.readAnnotationsImport('{}', IDS, 'abc'), /not a cyborg-hunter annotations file/);
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

  it('none without one (html-index-snapshot.test.js pins the whole page)', async () => {
    const html = await renderIndexHtml(summaries, triage, [p], config, false, {});
    assert.equal(html.includes('ch-annot:'), false);
    assert.equal(html.includes('annot-'), false);
  });

  it('the inlined script holds no script-end tag', () => {
    assert.equal(/<\/script/i.test(ANNOTATION_BUILDERS_JS + ANNOTATION_UI_JS), false);
  });
});
