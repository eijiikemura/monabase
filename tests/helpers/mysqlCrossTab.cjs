// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function mysqlCrossTab(invoke, overrides = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), calls = [], alerts = [], states = [], busy = [], readers = [];
  const t = (key, values) => values?.count ? key + ':' + values.count : key, listeners = new Map();
  const globals = { alert: message => alerts.push(message),
    FileReader: class { constructor() { readers.push(this); } readAsText() {} },
    window: { innerHeight: 1000, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) },
    document: { getElementById: () => ({}) }, navigator: { clipboard: { write: async items => { calls.push(['clipboard',items]); } } }, ClipboardItem: class { constructor(data) { this.data = data; } }, fetch: async () => ({ blob: async () => ({ type: 'image/png' }) }) };
  const dependencies = { react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) }, 'html-to-image': { toPng: async () => 'data:image/png;base64,fixture' },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { calls.push(args); return invoke(...args); } } } };
  dependencies['./crossTabModel'] = loadTypeScript('src/features/mysql/bi/crossTabModel.ts', dependencies, globals);
  dependencies['./crossTabRepository'] = loadTypeScript('src/features/mysql/bi/crossTabRepository.ts', dependencies, globals);
  const { useCrossTabWindow } = loadTypeScript('src/features/mysql/bi/useCrossTabWindow.ts', dependencies, globals);
  const props = { tabId: 1, isActive: true, schemas: ['mb_test'], initialSchema: 'mb_test', inputDateFormat: 'YYYY/MM/DD', numberFormat: 'comma', language: 'en', disabled: false, onState: state => states.push(state), onBusyChange: value => busy.push(value), ...overrides };
  let state;
  const render = () => state = hook.render(() => useCrossTabWindow(props));
  const flush = async () => { for (let i = 0; i < 6; i++) { render(); hook.commit(); await hook.settle(); } return render(); };
  const waitFor = async predicate => { const end = Date.now() + 10000; do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve,10)); } while (Date.now()<end); throw new Error('MySQL cross-tab state did not settle: ' + state.error); };
  await flush(); return { get state() { return state; }, props, calls, alerts, states, busy, readers, listeners, flush, waitFor, unmount: hook.unmount };
}
module.exports = { mysqlCrossTab };
