// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
function indexModules(invoke, extra = {}) {
  const dependencies = { '@/shared/api/desktop': { ipcRenderer: { invoke } }, ...extra };
  const model = loadTypeScript('src/features/mysql/index/indexModel.ts', dependencies, { Error });
  const repository = loadTypeScript('src/features/mysql/index/indexRepository.ts', dependencies, { Error });
  return { dependencies, model, repository };
}
async function mysqlIndex(invoke, overrides = {}) {
  const h = createHookHarness({ doubleUpdates: true }), events = new EventTarget(), calls = [], changes = [], states = [];
  const { dependencies, model, repository } = indexModules(async (...args) => { calls.push(args); return invoke(...args); });
  const transfer = loadTypeScript('src/features/mysql/sidebarDataTransfer.ts', { ...dependencies, '@/features/data-grid/dataGridHelper': {}, '@/features/table/importData': {}, './table/tableRepository': {}, './table/tableModel': {} }, { Error });
  const tables = loadTypeScript('src/features/mysql/table/tableRepository.ts', dependencies);
  const controller = loadTypeScript('src/features/mysql/index/useMysqlIndex.ts', {
    ...dependencies, react: h.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '../table/tableRepository': tables, './indexModel': model, './indexRepository': repository, '../sidebarDataTransfer': transfer
  }, { window: events, CustomEvent, Event, Error });
  const props = { schema: 'mb_test', active: true, busy: false, readonly: false, theme: 'light', setBusy() {}, onState: value => states.push(value), onChanged: value => changes.push(value), onDropped: () => changes.push('drop'), ...overrides }; let state;
  const render = () => state = h.render(() => controller.useMysqlIndex(props));
  const flush = async () => { for (let i = 0; i < 5; i++) { render(); h.commit(); await h.settle(); } return render(); };
  const waitFor = async predicate => { const end = Date.now() + 12000; do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 5)); } while (Date.now() < end); throw new Error('MySQL index state did not settle: ' + state.error); };
  await flush(); return { get state() { return state; }, props, calls, changes, states, events, flush, waitFor, unmount: h.unmount, model, repository };
}
module.exports = { indexModules, mysqlIndex };
