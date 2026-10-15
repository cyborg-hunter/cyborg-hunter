// Participant ids come from participant data, so the report must keep two
// ids apart however they are spelled, and must not let one act as markup.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sanitize } from '../../src/cli/renderers/report-id.js';
import { sanitize as trajectoryName } from '../../src/cli/renderers/trajectories-core.js';
import { sanitize as timelineName } from '../../src/cli/renderers/session-timeline-core.js';
import { sanitize as typingName } from '../../src/cli/renderers/typing-profile-core.js';
import { buildTriageMd } from '../../src/cli/renderers/triage-md-core.js';
import { buildReport } from '../../src/cli/report-core.js';
import { mergeConfig } from '../../src/cli/config-core.js';
import { ingest } from '../../src/cli/ingest.js';
import { makeRecordingCanvasFactory } from './recording-canvas.js';

describe('report ids', () => {
  it('an id that is already clean keeps its name', () => {
    assert.strictEqual(sanitize('P-001_a'), 'P-001_a');
  });

  it('ids that clean up alike get different names (plots no longer overwrite each other)', () => {
    assert.notStrictEqual(sanitize('a.b'), sanitize('a_b'));
    assert.notStrictEqual(sanitize('a.b'), sanitize('a/b'));
    const long = 'x'.repeat(40);
    assert.notStrictEqual(sanitize(long + 'one'), sanitize(long + 'two'));
    assert.match(sanitize('a.b'), /^a_b-[0-9a-f]{8}$/);
  });

  it('the plot file names follow the page rule', () => {
    for (const id of ['a.b', 'P1', 'x'.repeat(60)]) {
      assert.strictEqual(trajectoryName(id), sanitize(id));
      assert.strictEqual(timelineName(id), sanitize(id));
      assert.strictEqual(typingName(id), sanitize(id));
    }
  });

  it('triage.md writes an id as text: no table break, link, image or tag', () => {
    const md = buildTriageMd([{ participantId: 'x](http://evil.example)|<img src=y>', score: 1, reason: 'r', hardTriggered: false, softFlagged: false }], {});
    const row = md.split('\n').find((l) => l.startsWith('| 1 |'));
    assert.ok(row.includes('x\\](http://evil.example)\\|\\<img src=y\\>'), row);
    assert.strictEqual(row.split(/(?<!\\)\|/).length, 7, 'still five cells');
  });

  it('a participant id of __proto__ keeps its own plots (analyzer keepImages)', async () => {
    const CLI = { dataDir: 'tests/cli/fixtures', filePattern: '*_participant.json', participantIdField: 'participantId', integrityField: 'integrity' };
    const { participants } = await ingest(CLI);
    const evil = Object.assign({}, participants[0], { participantId: '__proto__' });
    const built = await buildReport([evil, participants[1]], mergeConfig(CLI).config,
      { sink: () => {}, createCanvas: makeRecordingCanvasFactory([]), encodePng: async () => new Uint8Array([7]), keepImages: true, replayClientSrc: '', fontFaceCss: '' });
    assert.strictEqual(Object.getPrototypeOf({}).trajectories, undefined, 'Object.prototype untouched');
    assert.ok(Object.prototype.hasOwnProperty.call(built.images, '__proto__'));
    const other = built.images[participants[1].participantId];
    assert.ok(other && other.trajectories, 'the other participant keeps its own plots');
  });
});
