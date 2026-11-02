// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');

// Exercise the production table hook with either real database IPC or a deterministic boundary.
async function createTableHarness(db, invoke, props = {}) {
  const hook = createHookHarness(), alerts = [], listeners = new Map();
  const { translate } = require('../../electron/i18n');
  const t = (key, values) => translate(key, 'en', values);
  const dependencies = {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) },
    '@/features/data-grid/tableResultHeaders': { decorateTableResultColumns: columns => columns },
    '@/shared/api/desktop': { ipcRenderer: { invoke }, beginGlobalLoading: props.beginGlobalLoading ?? (() => () => {}) },
    '@/features/table/useTableOpening': { waitForTablePaint: props.waitForTablePaint ?? (async () => {}) },
    '@/features/data-grid/dataGridHelper': {
      buildGridColumns: columns => columns.map(column => ({ field: column.name, headerName: column.name })),
      buildTransposedColumns: () => []
    }
  };
  const globals = { alert: message => alerts.push(message), window: { confirm: () => true, addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: type => listeners.delete(type) } };
  for (const file of ['tableQueryBuilder', 'tableRecordEditor', 'tableDataTransfer']) {
    dependencies[`./${file}`] = loadTypeScript(`src/features/${db}/windows/table/${file}.ts`, dependencies, globals);
  }
  if (db === 'postgresql') dependencies['./tableResultRows'] = loadTypeScript('src/features/postgresql/windows/table/tableResultRows.ts', dependencies, globals);
  const { useTableDataTab } = loadTypeScript(`src/features/${db}/windows/table/useTableDataTab.ts`, dependencies, globals);
  let state;
  const render = () => (state = hook.render(() => useTableDataTab({ schema: 'test', tableName: 'Items', isActive: true, inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD', ...props })));
  async function flush() {
    for (let i = 0; i < 3; i++) { render(); hook.commit(); await hook.settle(); }
    // Expose only a committed snapshot so event callbacks see the same metadata.
    const result = render();
    hook.commit();
    return result;
  }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do {
      await flush();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error('Table state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, render, flush, waitFor, alerts, emit: (type, detail) => listeners.get(type)?.({ detail }), unmount: () => hook.unmount() };
}
async function createStructureHarness(db, invoke, props = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), alerts = [], events = [];
  const { translate } = require('../../electron/i18n');
  const globals = {
    alert: message => alerts.push(message),
    window: { confirm: () => true, dispatchEvent: event => events.push(event), addEventListener() {}, removeEventListener() {} },
    document: { body: { style: {} } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  };
  const { useTableStructureTab } = loadTypeScript(`src/features/${db}/windows/table/useTableStructureTab.ts`, {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: (key, values) => translate(key, 'en', values) }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke } },
    '@/features/git/gitOperation': { runGitOperation: (_t, channel, payload) => invoke(channel, payload) }
  }, globals);
  let state;
  const render = () => (state = hook.render(() => useTableStructureTab({ schema: 'test', tableName: 'Items', isActive: true, ...props })));
  async function flush() {
    for (let i = 0; i < 3; i++) { render(); hook.commit(); await hook.settle(); }
    // Expose only a committed snapshot so event callbacks see the same metadata.
    const result = render();
    hook.commit();
    return result;
  }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do {
      await flush();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error('Table structure did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, flush, waitFor, alerts, events, unmount: () => hook.unmount() };
}
module.exports = { createTableHarness, createStructureHarness };
