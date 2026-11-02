// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createSettingsStore } = require('../electron/services/settings');

function setup(t, saved) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-settings-'));
  const file = path.join(directory, 'settings.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (saved) fs.writeFileSync(file, JSON.stringify(saved), 'utf8');
  const store = createSettingsStore({
    app: { isReady: () => true, getLocale: () => 'en-US' },
    SETTINGS_FILE: file, t: key => key, setLanguage() {}
  });
  return { store, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('New settings persist an unlimited query timeout', t => {
  const { store, read } = setup(t);
  assert.equal(store.load().queryTimeout, 0);
  assert.equal(read().queryTimeout, 0);
});

test('Missing query timeout is added to existing settings without changing saved preferences', t => {
  const initial = setup(t).store.load();
  delete initial.queryTimeout;
  initial.theme = 'dark';
  const { store, read } = setup(t, initial);
  assert.equal(store.load().queryTimeout, 0);
  assert.equal(read().queryTimeout, 0);
  assert.equal(read().theme, 'dark');
});

test('Saved finite and unlimited timeouts are preserved', t => {
  for (const timeout of [0, 30, 60]) {
    const { store, read } = setup(t, { queryTimeout: timeout });
    assert.equal(store.load().queryTimeout, timeout);
    assert.equal(read().queryTimeout, timeout);
  }
});

test('Invalid query timeouts fall back to unlimited execution', t => {
  for (const timeout of [-1, '30', null]) {
    const { store, read } = setup(t, { queryTimeout: timeout });
    assert.equal(store.load().queryTimeout, 0);
    assert.equal(read().queryTimeout, 0);
  }
});

test('AI send key defaults, validation and restart preserve the chosen interaction mode', t => {
  for (const [value, expected] of [[undefined, 'enter'], [null, 'enter'], ['invalid', 'enter'], ['enter', 'enter'], ['modifier-enter', 'modifier-enter']]) {
    const { store, read } = setup(t, { aiSendKey: value, theme: 'dark' });
    assert.equal(store.load().aiSendKey, expected);
    assert.equal(read().aiSendKey, expected);
    assert.equal(store.load().theme, 'dark');
    store.save({ ...store.load(), aiSendKey: 'modifier-enter' });
    assert.equal(store.load().aiSendKey, 'modifier-enter');
    assert.equal(read().aiSendKey, 'modifier-enter');
  }
});

test('AI response limits persist valid settings and repair missing or unsafe limits', t => {
  const { AI_LIMITS } = require('../electron/ai/requestLimits');
  for (const [key, rule] of Object.entries(AI_LIMITS)) {
    for (const value of [undefined, null, 0, -1, 1.5, '10', rule.max + 1, rule.min, rule.max]) {
      const expected = Number.isInteger(value) && value >= rule.min && value <= rule.max ? value : rule.default;
      const { store, read } = setup(t, { [key]: value, theme: 'dark' });
      assert.equal(store.load()[key], expected); assert.equal(read()[key], expected);
      store.save({ ...store.load(), [key]: rule.min });
      assert.equal(store.load()[key], rule.min); assert.equal(read()[key], rule.min);
      assert.equal(read().theme, 'dark');
    }
  }
});

test('SQL and ER read limits repair missing or invalid values and preserve valid independent settings', t => {
  for (const key of ['sqlFileMaxMb', 'erFileMaxMb']) {
    for (const value of [undefined, null, 0, -1, 1.5, '12', 65, 1, 64]) {
      const { store, read } = setup(t, { [key]: value, theme: 'dark' });
      const expected = [1, 64].includes(value) ? value : 16;
      assert.equal(store.load()[key], expected); assert.equal(read()[key], expected);
      store.save({ ...store.load(), sqlFileMaxMb: 8, erFileMaxMb: 24 });
      assert.equal(store.load().sqlFileMaxMb, 8); assert.equal(read().erFileMaxMb, 24);
      assert.equal(read().theme, 'dark');
    }
  }
});

test('SQL history persistence defaults on, validates booleans and retains an explicit opt-out', t => {
  for (const value of [undefined, null, 'false', 0, true, false]) {
    const { store, read } = setup(t, { sqlHistoryEnabled: value });
    const expected = typeof value === 'boolean' ? value : true;
    assert.equal(store.load().sqlHistoryEnabled, expected); assert.equal(read().sqlHistoryEnabled, expected);
    store.save({ ...store.load(), sqlHistoryEnabled: false }); assert.equal(store.load().sqlHistoryEnabled, false);
  }
});

for (const [key, fallback, values] of [
  ['maxTabs', 20, [1.5, 0, 100, '20']],
  ['sqlHistoryLimit', 100, [2.5, 0, 1000, '100']],
  ['queryTimeout', 0, [0.5, -1, Number.MAX_SAFE_INTEGER + 1, '30']],
  ['theme', 'mona', ['unknown', null, 1]],
  ['numberFormat', 'comma', ['unknown', null, false]],
  ['language', 'en', ['unknown', null, 42]],
  ['erNotation', 'ie', ['unknown', null, 42]]
]) test(`Settings file repairs invalid ${key} without replacing other preferences`, t => {
  for (const value of values) {
    const { store, read } = setup(t, { [key]: value, sqlFileMaxMb: 24 });
    assert.equal(store.load()[key], fallback);
    assert.equal(read()[key], fallback);
    assert.equal(read().sqlFileMaxMb, 24);
  }
});

test('Timezone validation accepts legal fixed offsets and repairs invalid file values', t => {
  for (const offset of ['+00:00', '+05:45', '-07:00', '-12:00', '+14:00']) {
    const { store, read } = setup(t, { timezone: offset });
    assert.equal(store.load().timezone, offset); assert.equal(read().timezone, offset);
  }
  const expected = setup(t).store.load().timezone;
  for (const timezone of [null, 9, 'UTC', '+24:00', '+14:01', '-12:01', '+09:99', "'+09:00'"]) {
    const { store, read } = setup(t, { timezone });
    assert.equal(store.load().timezone, expected); assert.equal(read().timezone, expected);
  }
});

test('Settings reload all supported preferences and retain an isolated current-settings snapshot', t => {
  const { getCurrentSettings } = require('../electron/services/settings');
  const { store, read } = setup(t);
  const selected = { ...store.load(), language: 'ja', theme: 'simple', numberFormat: 'space', timezone: '+05:45',
    maxTabs: 7, sqlHistoryLimit: 9, sqlHistoryEnabled: false, queryTimeout: 3, outputDateFormat: 'DD-MMM-YY HH:mm:ss',
    inputDateFormat: 'DD/MM/YYYY HH:mm:ss', aiSendKey: 'modifier-enter', aiResponseMaxMb: 32,
    aiIdleTimeoutSeconds: 180, aiRequestTimeoutSeconds: 900, sqlFileMaxMb: 8, erFileMaxMb: 24,
    erNotation: 'barker', oracleClientPath: '/test-only/Oracle Client' };
  store.save(selected); assert.deepEqual(read(), selected); assert.deepEqual(store.load(), selected);
  const snapshot = getCurrentSettings(); snapshot.theme = 'dark';
  assert.equal(getCurrentSettings().theme, 'simple'); assert.equal(store.load().theme, 'simple');
});
