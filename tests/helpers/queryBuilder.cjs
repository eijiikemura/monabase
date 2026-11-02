// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');

async function createQueryBuilder(db, invoke, extra = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), calls = [], alerts = [], listeners = new Map();
  const t = key => key;
  const { useQueryBuilderWindow } = loadTypeScript(`src/features/${db}/windows/builder/useQueryBuilderWindow.ts`, {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) },
    '../common/ddlHelper': {}, '../common/schemaStorage': { getPgSelectSchema: () => '', savePgSelectSchema() {} },
    '@/features/ai/useQueryBuilderAi': { useQueryBuilderAi: () => ({ handleRequestAi() {}, review: null }) },
    '@/features/sql/sqlHistory': { invokeSqlHistory: async () => [] },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
      calls.push(args);
      if (args[0] === 'load-settings') return { sqlHistoryLimit: 100 };
      if (args[0] === 'get-schemas') return { success: true, schemas: ['test'] };
      return invoke(...args);
    } } }
  }, { crypto: require('node:crypto').webcrypto, localStorage: { getItem: () => null, setItem() {} },
    document: { body: { style: {} } }, alert: value => alerts.push(value),
    window: { innerHeight: 800, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name), confirm: () => true }, ...extra });
  let state;
  const render = () => state = hook.render(() => useQueryBuilderWindow({ tabId: 1, title: 'Builder', isActive: true, dateFormat: 'YYYY-MM-DD HH:mm:ss', userName: 'test', initialSchema: 'test' }));
  const flush = async () => { for (let i = 0; i < 5; i++) { render(); hook.commit(); await hook.settle(); } return render(); };
  await flush();
  return { get state() { return state; }, calls, alerts, listeners, flush, unmount: hook.unmount };
}
module.exports = { createQueryBuilder };
