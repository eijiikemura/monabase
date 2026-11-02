// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
const { translate } = require('../../electron/i18n');

function createStoredHarness(invoke, options = {}) {
  const hook = createHookHarness(), calls = [], alerts = [];
  const t = (key, values) => translate(key, options.language || 'en', values);
  const desktop = { ipcRenderer: { invoke: async (...args) => { calls.push(args); return invoke(...args); } } };
  const common = loadTypeScript('src/features/stored/storedCommon.ts', { '@/shared/api/desktop': desktop, i18next: { t } });
  const { useLoadingCounter } = loadTypeScript('src/shared/hooks/useLoadingCounter.ts', { react: hook.react });
  const { useStoredLogic } = loadTypeScript(`src/features/${options.database || 'oracle'}/windows/stored/useStoredLogic.ts`, {
    './traceProgramBuilder': loadTypeScript('src/features/postgresql/windows/stored/traceProgramBuilder.ts'),
    react: hook.react, i18next: { t }, 'react-i18next': { useTranslation: () => ({ t }) },
    '@/shared/api/desktop': desktop, '@/features/stored/storedCommon': common,
    // Metadata loading is explicit in these tests; execution retains the production busy guard.
    '@/shared/hooks/useLoadingCounter': { useLoadingCounter: () => useLoadingCounter(false) }
  }, { alert: message => alerts.push(message), window: { confirm: () => true, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, CustomEvent: class {} });
  const simulator = { parseTraceLogs() {}, clearSimulation() {}, loadSimulation() {} };
  const render = () => hook.render(() => useStoredLogic(options.schema || 'TEST', options.objectName || 'A', options.objectType || 'PROCEDURE',
    false, simulator, 'YYYY-MM-DD', 'YYYY-MM-DD', { isNew: Boolean(options.isNew), signature: options.signature }));
  render(); hook.commit();
  const flush = async () => { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); };
  return { render, flush, calls, alerts, dispose: () => hook.unmount() };
}
module.exports = { createStoredHarness };
