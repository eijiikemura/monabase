// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');

for (const packaged of [false, true]) {
  test(`Oracle ${packaged ? 'package' : 'standalone'} execution and trace preserve exact numeric input strings`, async () => {
    const h = createHookHarness(), requests = [], alerts = [];
    const argument = { ARGUMENT_NAME: 'AMOUNT', DATA_TYPE: 'NUMBER', IN_OUT: 'IN/OUT', POSITION: 1, DEFAULT_LENGTH: 0 };
    const ipc = { invoke: async (channel, sqlOrRequest) => {
      if (channel === 'execute-stored' || channel === 'execute-trace') {
        requests.push([channel, sqlOrRequest]); return { success: true, returnValues: [], dbmsOutput: [] };
      }
      if (channel === 'execute-sql-bg' && /SELECT STATUS/.test(sqlOrRequest)) return { success: true, rows: [{STATUS:'VALID'}] };
      if (channel === 'execute-sql-bg' && /FROM ALL_OBJECTS o/.test(sqlOrRequest)) return { success: true, rows: [{ OBJECT_TYPE: 'PACKAGE', STATUS: 'VALID' }, { OBJECT_TYPE: 'PACKAGE BODY', STATUS: 'VALID' }] };
      if (channel === 'execute-sql-bg' && /FROM ALL_PROCEDURES p/.test(sqlOrRequest)) return { success: true, rows: [{ PROCEDURE_NAME: 'ECHO', SUBPROGRAM_ID: 1, SIGNATURE: 'NUMBER' }] };
      if (channel === 'execute-sql-bg' && /ALL_ARGUMENTS/.test(sqlOrRequest)) return { success: true, rows: [argument] };
      if (channel === 'execute-sql-bg' && /GET_DDL/.test(sqlOrRequest)) return { success: true, rows: [{ DDL: 'CREATE PROCEDURE TEST.P AS BEGIN NULL; END;' }] };
      return { success: true, rows: [], metaData: [] };
    } };
    const common = loadTypeScript('src/features/stored/storedCommon.ts', {
      '@/shared/api/desktop': { ipcRenderer: ipc }, i18next: { t: key => key }
    });
    const file = packaged ? 'package/usePackageLogic' : 'stored/useStoredLogic';
    const module = loadTypeScript(`src/features/oracle/windows/${file}.ts`, {
      react: h.react, i18next: { t: key => key }, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
      '@/features/stored/storedCommon': common, '@/shared/api/desktop': { ipcRenderer: ipc },
      '@/shared/hooks/useLoadingCounter': { useLoadingCounter: () => ({ isLoading: false, beginLoading() {}, endLoading() {}, isBusy: () => false }) }
    }, { alert: message => alerts.push(message), window: { confirm: () => true } });
    const simulator = { parseTraceLogs() {}, clearSimulation() {}, loadSimulation() {} };
    const render = () => h.render(() => packaged ? module.usePackageLogic('TEST', 'P', 'PACKAGE BODY', false, simulator, 'YYYY-MM-DD') :
      module.useStoredLogic('TEST', 'P', 'PROCEDURE', false, simulator, 'YYYY-MM-DD', 'YYYY-MM-DD'));
    await render().loadObjectInfo();
    for (const input of ['9007199254740993', '0.1234567890123456789012345', '0', '-9007199254740993']) {
      render().setArgValues({ AMOUNT: input });
      await render().handleExecute(() => {});
      await render().handleTraceExecute(false, () => {});
      assert.equal(requests.at(-2)[1].args.AMOUNT, input);
      assert.equal(requests.at(-1)[1].args.AMOUNT, input);
    }
    assert.equal(alerts.length, 0);
  });
}
