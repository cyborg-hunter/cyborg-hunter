// The analyzer's settings (demo/analyze/settings-panel.js) and the config it
// exports (demo/analyze/export-config.js): pure functions, no page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsFromConfig, configFromSettings, settingsKey, REINGEST_KEYS } from '../../demo/analyze/settings-panel.js';
import { exportConfig } from '../../demo/analyze/export-config.js';
import { mergeConfig } from '../../src/cli/config-core.js';
import { SCORE_SIGNALS } from '../../src/cli/analyzers/score-weights.js';

const merged = (file) => mergeConfig(file).config;

test('the panel\'s keys round-trip through a config unchanged', () => {
  const base = merged({ participantIdField: 'subject_ID', scoreWeights: { copy: { weight: 2, max: 3 } },
    scoring: { softScoreThreshold: 5 }, phaseScope: { exclude: ['practice'] }, showPlatformId: true, platformIdField: 'PROLIFIC' });
  const again = configFromSettings(base, settingsFromConfig(base));
  for (const k of ['scoreWeights', 'scoring', 'integrityField', 'sessionIntegrityPath', 'platformIdField', 'showPlatformId']) {
    assert.deepEqual(again[k], base[k], k);
  }
});

test('an empty threshold takes the saved ones', () => {
  const base = merged({ scoring: { softScoreThreshold: 5 } });
  const c = configFromSettings(base, { ...settingsFromConfig(base), softScoreThreshold: null });
  assert.equal(c.scoring, null);
});

// The phase scope and the trajectory order are the CLI's: the panel neither
// shows nor edits them, and a config that sets them keeps them through a
// change to the panel and into the export.
test('the panel holds neither the phase scope nor the trajectory order', () => {
  const s = settingsFromConfig(merged({ phaseScope: { include: ['game'], exclude: ['practice'] }, trajectoryDisplayOrder: 'time' }));
  for (const k of ['phaseInclude', 'phaseExclude', 'phaseScope', 'trajectoryDisplayOrder']) assert.equal(k in s, false, k);
});

test('a config\'s phase scope and trajectory order survive a change to the panel and reach the export', () => {
  const base = merged({ phaseScope: { exclude: ['practice'] }, trajectoryDisplayOrder: 'time' });
  // Values the analyst set in the panel, which say nothing of either key.
  const panel = { ...settingsFromConfig(merged(undefined)), softScoreThreshold: 4, scoreWeights: { paste: 9 } };
  const c = configFromSettings(base, panel);
  assert.deepEqual(c.phaseScope, { exclude: ['practice'] });
  assert.equal(c.trajectoryDisplayOrder, 'time');
  assert.deepEqual(exportConfig(c, { participantIdField: 'subject_ID' }), { scoreWeights: { paste: 9 }, scoring: { softScoreThreshold: 4 },
    phaseScope: { exclude: ['practice'] }, trajectoryDisplayOrder: 'time', participantIdField: 'subject_ID' });
});

// The page compares the settings a config stands for, not how the file
// spells them: each pair below puts the same values in the panel.
test('settingsKey reads the weights as the panel shows them: key order, a bare number and an explicit default compare equal', () => {
  const key = (file) => settingsKey(settingsFromConfig(merged(file)));
  const pasteDefault = SCORE_SIGNALS.find((s) => s.key === 'paste').weight;
  assert.equal(key({ scoreWeights: { paste: 1, copy: 2 } }), key({ scoreWeights: { copy: 2, paste: 1 } }), 'key order');
  assert.equal(key({ scoreWeights: { paste: 3 } }), key({ scoreWeights: { paste: { weight: 3 } } }), 'a bare number');
  assert.equal(key({ scoreWeights: { paste: pasteDefault } }), key({}), 'an explicit default');
  assert.notEqual(key({ scoreWeights: { paste: { weight: pasteDefault, max: 2 } } }), key({}), 'a cap differs');
  assert.notEqual(key({ scoring: { softScoreThreshold: 4 } }), key({}), 'a threshold differs');
  // The panel does not show these: a config that differs only in them puts
  // the same values in it.
  assert.equal(key({ phaseScope: { exclude: ['practice'] } }), key({}), 'a phase scope');
  assert.equal(key({ trajectoryDisplayOrder: 'time' }), key({}), 'a trajectory order');
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
