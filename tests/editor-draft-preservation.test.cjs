// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

function settingsFixture() {
  const hook = createHookHarness(), writes = [], t = key => key;
  const { useSettingsDialog } = loadTypeScript('src/components/useSettingsDialog.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) }, '../shared/api/desktop': { ipcRenderer: {} }
  }, { window: { confirm: () => true } });
  let props = { isOpen: true, language: 'en', maxTabs: 20, sqlHistoryLimit: 100, outputDateFormat: 'YYYY-MM-DD',
    inputDateFormat: 'YYYY-MM-DD', numberFormat: 'comma', timezone: '+09:00', theme: 'mona', onClose() {}, onSave: value => writes.push(value) };
  const render = () => hook.render(() => useSettingsDialog(props));
  const commit = () => { render(); hook.commit(); return render(); };
  commit();
  return { render, commit, writes, update: patch => { props = { ...props, ...patch }; } };
}

test('Equivalent parent props and changed callbacks preserve edited settings and selected tab', () => {
  const h = settingsFixture(), newest = [];
  h.render().setTempMaxTabs(42); h.render().setTempOracleClientPath('/mock/edited'); h.render().handleTabChange({}, 2);
  h.update({ onClose() {}, onSave: value => newest.push(value) }); h.commit();
  assert.equal(h.render().tempMaxTabs, 42);
  assert.equal(h.render().tempOracleClientPath, '/mock/edited');
  assert.equal(h.render().activeTab, 2);
  h.render().handleSaveClick();
  assert.equal(h.writes.length, 0);
  assert.equal(newest[0].maxTabs, 42);
});

test('External settings changes are applied on reopening, preserving the active draft until then', () => {
  const h = settingsFixture(); h.render().setTempMaxTabs(42); h.render().handleTabChange({}, 1);
  h.update({ maxTabs: 60, language: 'ja', queryTimeout: 10 }); h.commit();
  assert.equal(h.render().tempMaxTabs, 42);
  assert.equal(h.render().tempLanguage, 'en');
  assert.equal(h.render().activeTab, 1);
  h.update({ isOpen: false }); h.commit(); h.update({ isOpen: true }); h.commit();
  assert.equal(h.render().tempMaxTabs, 60);
  assert.equal(h.render().tempLanguage, 'ja');
  assert.equal(h.render().tempQueryTimeout, 10);
  assert.equal(h.render().activeTab, 0);
});

test('Reset values survive parent rendering and omitted optional fields keep their defaults', () => {
  const h = settingsFixture(); h.render().setTempMaxTabs(40); h.render().handleReset(); h.update({}); h.commit();
  assert.equal(h.render().tempMaxTabs, 20);
  assert.equal(h.render().tempQueryTimeout, 0);
  assert.equal(h.render().tempErNotation, 'ie');
  assert.equal(h.render().tempOracleClientPath, '');
});

const initialDdl = 'CREATE PROCEDURE TEST.P AS BEGIN NULL; END;';
function storedFixture(respond = () => ({ success: true, rows: [{ DDL: initialDdl }] })) {
  const hook = createHookHarness(), t = key => key;
  let failure = null;
  const ipc = { invoke: async (channel, sql) => {
    if (channel === 'execute-sql-bg' && /GET_DDL/.test(sql)) return failure ? failure('source') : respond();
    if (channel === 'execute-sql-bg' && /ALL_ARGUMENTS/.test(sql)) {
      const overridden = failure?.('arguments');
      return overridden || { success: true, rows: [{ ARGUMENT_NAME: 'A', DATA_TYPE: 'VARCHAR2', IN_OUT: 'IN', POSITION: 1 }] };
    }
    if (channel === 'execute-sql-bg' && /SELECT STATUS/.test(sql)) return failure?.('status') || { success: true, rows: [{ STATUS: 'VALID' }] };
    return { success: true, rows: [] };
  } };
  const common = loadTypeScript('src/features/stored/storedCommon.ts', { '@/shared/api/desktop': { ipcRenderer: ipc }, i18next: { t } });
  const { useStoredLogic } = loadTypeScript('src/features/oracle/windows/stored/useStoredLogic.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) }, i18next: { t },
    '@/features/stored/storedCommon': common, '@/shared/api/desktop': { ipcRenderer: ipc }
  }, { alert() {}, window: { confirm: () => true } });
  const simulator = { parseTraceLogs() {}, clearSimulation() {}, loadSimulation() {} };
  const render = () => hook.render(() => useStoredLogic('TEST', 'P', 'PROCEDURE', false, simulator, 'YYYY-MM-DD', 'YYYY-MM-DD', { isNew: true }));
  return { render, fail: value => { failure = value; } };
}

const invalidResults = {
  error: { success: false, error: 'Temporary metadata failure' },
  empty: { success: true, rows: [] },
  missing: { success: true, rows: [{}] },
  null: { success: true, rows: [{ DDL: null }] },
  numeric: { success: true, rows: [{ DDL: 123 }] },
  whitespace: { success: true, rows: [{ DDL: ' \n ' }] }
};
for (const [name, result] of Object.entries(invalidResults)) {
  test(`Oracle ${name} source response preserves the draft, saved baseline and arguments, then retries`, async () => {
    const h = storedFixture(); await h.render().loadObjectInfo();
    const original = h.render().sourceText, argumentsBefore = h.render().argumentsList;
    const draft = original + '\n-- Unsaved 日本語'; h.render().setSourceText(draft);
    h.fail(kind => kind === 'source' ? result : undefined);
    await h.render().loadObjectInfo();
    assert.equal(h.render().sourceText, draft);
    assert.equal(h.render().hasUnsavedChanges, true);
    assert.deepEqual(h.render().argumentsList, argumentsBefore);
    assert.ok(h.render().loadError);
    assert.equal(h.render().isLoading, false);
    h.render().setSourceText(original); assert.equal(h.render().hasUnsavedChanges, false);
    h.fail(null); await h.render().loadObjectInfo();
    assert.equal(h.render().sourceText, original);
    assert.equal(h.render().hasUnsavedChanges, false);
    assert.equal(h.render().loadError, '');
  });
}

for (const kind of ['arguments', 'status', 'rejection']) {
  test(`Oracle ${kind} metadata failure preserves edited source and reports the error`, async () => {
    const h = storedFixture(); await h.render().loadObjectInfo();
    const draft = h.render().sourceText + '\n-- Draft'; h.render().setSourceText(draft);
    h.fail(part => {
      if (kind === 'rejection' && part === 'source') throw Error('IPC unavailable');
      if (part === 'source') return { success: true, rows: [{ DDL: initialDdl }] };
      if (part === kind) return { success: false, error: 'Metadata unavailable' };
    });
    await h.render().loadObjectInfo();
    assert.equal(h.render().sourceText, draft);
    assert.equal(h.render().hasUnsavedChanges, true);
    assert.ok(h.render().loadError);
  });
}

test('An initial Oracle load failure does not mark an error message as saved source', async () => {
  const h = storedFixture(() => invalidResults.error);
  const before = h.render().sourceText; await h.render().loadObjectInfo();
  assert.equal(h.render().sourceText, before);
  assert.equal(h.render().hasUnsavedChanges, false);
  assert.equal(h.render().loadError, 'Temporary metadata failure');
});
