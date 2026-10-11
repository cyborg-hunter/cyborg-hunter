// The analyzer's settings (demo/analyze/settings-panel.js) and the config it
// exports (demo/analyze/export-config.js): pure functions, no page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsFromConfig, configFromSettings, REINGEST_KEYS } from '../../demo/analyze/settings-panel.js';
import { exportConfig } from '../../demo/analyze/export-config.js';
import { mergeConfig } from '../../src/cli/config-core.js';

const merged = (file) => mergeConfig(file).config;

test('the panel\'s keys round-trip through a config unchanged', () => {
  const base = merged({ participantIdField: 'subject_ID', scoreWeights: { copy: { weight: 2, max: 3 } },
    scoring: { softScoreThreshold: 5 }, phaseScope: { exclude: ['practice'] }, showPlatformId: true, platformIdField: 'PROLIFIC' });
  const again = configFromSettings(base, settingsFromConfig(base));
  for (const k of ['scoreWeights', 'scoring', 'phaseScope', 'integrityField', 'sessionIntegrityPath', 'platformIdField', 'showPlatformId', 'trajectoryDisplayOrder']) {
    assert.deepEqual(again[k], base[k], k);
  }
});

test('an empty threshold takes the saved ones, an empty scope scores every phase', () => {
  const base = merged({ scoring: { softScoreThreshold: 5 }, phaseScope: { include: ['game'] } });
  const s = { ...settingsFromConfig(base), softScoreThreshold: null, phaseInclude: [], phaseExclude: [] };
  const c = configFromSettings(base, s);
  assert.equal(c.scoring, null);
  assert.equal(c.phaseScope, null);
});

test('the id, integrity and session-report fields are the ones that read the files again', () => {
  assert.deepEqual(REINGEST_KEYS, ['participantIdField', 'integrityField', 'sessionIntegrityPath']);
});

test('the export holds what differs from the CLI defaults, and the id field', () => {
  const base = merged(undefined);
  assert.deepEqual(exportConfig(base, { participantIdField: 'participantId' }), { participantIdField: 'participantId' });
  const custom = { ...base, scoreWeights: { paste: 1 }, scoring: { softScoreThreshold: 4 } };
  assert.deepEqual(exportConfig(custom, { participantIdField: 'subject_ID' }),
    { scoreWeights: { paste: 1 }, scoring: { softScoreThreshold: 4 }, participantIdField: 'subject_ID' });
});

test('the analyst\'s own file-system keys stay; the CLI\'s defaults are not written', () => {
  const base = merged({ dataDir: './pilot-2', filePattern: '*.csv', outputDir: './cyborg-hunter-report' });
  assert.deepEqual(exportConfig(base, { participantIdField: 'subject_ID' }),
    { dataDir: './pilot-2', filePattern: '*.csv', participantIdField: 'subject_ID' });
});

test('dropped experiment files make assetsDir ./assets, unless the analyst named one', () => {
  const base = merged(undefined);
  assert.equal(exportConfig(base, { participantIdField: 'p', assetsDropped: true }).assetsDir, './assets');
  assert.equal(exportConfig({ ...base, assetsDir: './exp' }, { participantIdField: 'p', assetsDropped: true }).assetsDir, './exp');
  assert.equal('assetsDir' in exportConfig(base, { participantIdField: 'p' }), false);
});

test('a run-only key never reaches the file', () => {
  const base = { ...merged(undefined), noVisuals: true, singleParticipant: 'P1' };
  assert.deepEqual(exportConfig(base, { participantIdField: 'p' }), { participantIdField: 'p' });
});
