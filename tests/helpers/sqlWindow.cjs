// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
const { translate } = require('../../electron/i18n');
const t = (key, values) => translate(key, 'en', values);

// Exercise actual execution and tuning hooks with a replaceable desktop boundary.
async function createSqlWindowHarness(db, initialSql, invoke, { realBatches = false, inspectPrivacy, schema = 'test', getSettings = () => ({}), dateFormat = 'YYYY-MM-DD', buildGridColumns = metadata => metadata.map(column => ({ field: column.name })) } = {}) {
  const hook = createHookHarness(), calls = [], alerts = [], historyCalls = [];
  let now = Date.now();
  class Clock extends Date { static now() { now += 300; return now; } }
  const desktop = { ipcRenderer: { invoke: async (...args) => {
    calls.push(args);
    if (args[0] === 'inspect-sql-privacy') return inspectPrivacy ? inspectPrivacy(args[1], args[2]) : args[1].map(sql => require('../../electron/services/sqlPrivacy').inspectSqlPrivacy(sql, args[2]));
    if (args[0] === 'load-settings') return getSettings();
    if (!realBatches && ['begin-sql-batch', 'end-sql-batch', 'cancel-execution'].includes(args[0])) return { success: true };
    return invoke(...args);
  } } };
  const { useSqlWindow } = loadTypeScript(`src/features/${db}/windows/sql/useSqlWindow.ts`, {
    './sqlScript': loadTypeScript('src/features/sql/sqlScript.ts'), react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) },
    'sql-formatter': { format: value => value }, '@codemirror/view': { EditorView: { scrollIntoView: position => ({ scrollPosition: position }) } },
    '../common/schemaStorage': { savePgSelectSchema() {}, getPgSelectSchema: () => null },
    '@/features/sql/sqlHistory': { invokeSqlHistory: async (...args) => { historyCalls.push(args); return []; }, invokeSqlHistoryWhen: async (...args) => { historyCalls.push(args); return []; } },
    '@/features/data-grid/dataGridHelper': { buildGridColumns },
    '@/shared/api/desktop': desktop
  }, { crypto: require('node:crypto').webcrypto, Date: Clock, alert: message => alerts.push(message),
    window: { innerHeight: 900, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, CustomEvent: class {} });
  let state;
  const render = () => (state = hook.render(() => useSqlWindow({ initialSql, isActive: false, dateFormat, schemas: [schema, 'other'] })));
  async function flush() { for (let index = 0; index < 3; index++) { render(); hook.commit(); await hook.settle(); } return render(); }
  await flush();
  if (db === 'postgresql') { state.setSelectedSchema(schema); await flush(); }

  async function requestTuning(extra = {}) {
    const contexts = [], tuningAlerts = [];
    const { useSqlWindowBottom } = loadTypeScript('src/features/sql/useSqlWindowBottom.ts', {
      './explainIdentity': loadTypeScript('src/features/sql/explainIdentity.ts'),
      react: { useMemo: callback => callback(), useState: value => [value, () => {}] },
      'react-i18next': { useTranslation: () => ({ t, i18n: { language: 'en' } }) },
      '../data-grid/dataGridHelper': { buildTransposedColumns: () => [] },
      '@/shared/api/desktop': desktop
    }, { alert: message => tuningAlerts.push(message) });
    await useSqlWindowBottom({ rows: state.rows, columns: state.columns, isExplainResult: state.isExplainResult,
      explainSnapshot: state.explainSnapshot, sqlText: state.sqlText, selectedSchema: state.selectedSchema,
      dbType: db, dateFormat: 'YYYY-MM-DD', title: 'Snapshot test', isAiEnabled: true,
      onOpenAiSidebar: context => contexts.push(context), ...extra }).handleExportForAI();
    return { contexts, alerts: tuningAlerts };
  }
  return { get state() { return state; }, calls, alerts, historyCalls, flush, requestTuning, unmount: () => hook.unmount() };
}
module.exports = { createSqlWindowHarness };
