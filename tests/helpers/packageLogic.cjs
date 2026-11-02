// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
const { translate } = require('../../electron/i18n');

function createPackageHarness(invoke, options = {}) {
  const hook = createHookHarness(), calls = [], alerts = [];
  const t = (key, values) => translate(key, options.language || 'en', values);
  const desktop = { ipcRenderer: { invoke: async (...args) => { calls.push(args); return invoke(...args); } } };
  const common = loadTypeScript('src/features/stored/storedCommon.ts', { '@/shared/api/desktop': desktop, i18next: { t } });
  const { useLoadingCounter } = loadTypeScript('src/shared/hooks/useLoadingCounter.ts', { react: hook.react });
  const { usePackageLogic } = loadTypeScript('src/features/oracle/windows/package/usePackageLogic.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) }, i18next: { t },
    '@/shared/api/desktop': desktop, '@/features/stored/storedCommon': common,
    // Tests explicitly load metadata, while retaining the production counter for overlapping requests.
    '@/shared/hooks/useLoadingCounter': { useLoadingCounter: () => useLoadingCounter(false) }
  }, { alert: message => alerts.push(message), window: { confirm: () => true, dispatchEvent() {} }, CustomEvent: class {} });
  const simulator = { parseTraceLogs() {}, clearSimulation() {}, loadSimulation() {} };
  const render = () => hook.render(() => usePackageLogic(options.schema || 'TEST', options.objectName || 'PKG', options.objectType || 'PACKAGE BODY',
    false, simulator, 'YYYY-MM-DD', { isNew: Boolean(options.isNew) }));
  render(); hook.commit();
  const flush = async () => { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); };
  return { render, flush, calls, alerts, dispose: () => hook.unmount() };
}
module.exports = { createPackageHarness };
