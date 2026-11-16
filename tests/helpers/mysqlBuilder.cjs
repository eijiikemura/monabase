// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function mysqlBuilder(invoke, overrides = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), calls = [], alerts = [], contexts = [], states = [], readers = [], busy = [];
  const t = key => key, listeners = new Map();
  const globals = { alert: message => alerts.push(message), crypto: require('node:crypto').webcrypto,
    FileReader: class { constructor() { readers.push(this); } readAsText() {} },
    window: { innerHeight: 1000, confirm: () => true, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    document: { body: { style: {} } } };
  const dependencies = { react: hook.react, 'react-i18next': { useTranslation: () => ({ t, i18n: { resolvedLanguage: 'en' } }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
      calls.push(args);
      if (args[0] === 'load-settings') return { sqlHistoryLimit: 100 };
      if (args[0] === 'get-sql-history') return [];
      if (args[0] === 'add-sql-history') return [args[1]];
      return invoke(...args);
    } } } };
  dependencies['./builderRepository'] = loadTypeScript('src/features/mysql/builder/builderRepository.ts', dependencies, globals);
  const { useQueryBuilderWindow } = loadTypeScript('src/features/mysql/builder/useQueryBuilderWindow.ts', dependencies, globals);
  const props = { tabId: 1, title: 'Builder', isActive: true, dateFormat: 'DD/MM/YYYY HH:mm:ss', schema: 'mb_test', disabled: false, isAiEnabled: true, onOpenAiSidebar: c => contexts.push(c), onState: s => states.push(s), onBusyChange: value => busy.push(value), ...overrides };
  let state;
  const render = () => state = hook.render(() => useQueryBuilderWindow(props));
  const flush = async () => { for (let i = 0; i < 5; i++) { render(); hook.commit(); await hook.settle(); } return render(); };
  await flush();
  return { get state() { return state; }, props, calls, alerts, contexts, states, readers, busy, listeners, flush, unmount: () => hook.unmount() };
}
module.exports = { mysqlBuilder };
