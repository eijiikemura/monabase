// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const tokens = loadTypeScript('src/features/postgresql/sqlTokens.ts');
const traceBuilder = loadTypeScript('src/features/postgresql/windows/stored/traceProgramBuilder.ts', {
  '../../sqlTokens': tokens,
  '@/features/stored/traceBlockEnd': loadTypeScript('src/features/stored/traceBlockEnd.ts'),
  '@/shared/utils/dateFormatter': { getPostgresFormatForValue: value => value }
});

for (const value of [230.4, 0, null, 'quoted "text"', { unsupported: true }]) {
  test(`PostgreSQL trace preserves the function return value ${JSON.stringify(value)}`, async () => {
    const compiled = [], states = [];
    let cursor = 0, requests = 0, ended = 0;
    const alerts = [];
    const unsupported = value?.unsupported === true;
    class TraceDatabase {
      static deleteDatabase() {}
      async init() {}
      async insertSteps() {}
      async saveTraceInfo() {}
      close() {}
    }
    const { executeTracePg } = loadModule('electron/postgres/traceExecutorPg.js', {
      '../services/traceProgram': require('../electron/services/traceProgram'),
      '../i18n': { t: key => key }, './traceDb': { TraceDatabase }
    });
    const connection = { async execute(sql) {
      if (sql.startsWith('SELECT COUNT')) return { success: true, rows: [{ cnt: 0 }] };
      if (sql.startsWith('CREATE')) compiled.push(sql);
      if (sql.startsWith('CALL')) return { success: true, rows: [], notices: [
        '[TRACE LINE] 5', `[TRACE RETURN] ${JSON.stringify({ name: 'RETURN', value })}`
      ] };
      return { success: true, rows: [] };
    } };
    let source = 'CREATE OR REPLACE FUNCTION demo.total()\nRETURNS numeric\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  RETURN 230.4;\nEND;\n$$;';
    if (unsupported) source = source.replace('RETURNS numeric', 'RETURNS SETOF numeric');
    const { useStoredLogic } = loadTypeScript('src/features/postgresql/windows/stored/useStoredLogic.ts', {
      './traceProgramBuilder': traceBuilder,
      '../../sqlTokens': tokens,
      '../../routineIdentity': loadTypeScript('src/features/postgresql/routineIdentity.ts'),
      react: {
        useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
          return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
        useRef(initial) { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index]; }, useLayoutEffect() {}, useEffect() {}, useCallback: callback => callback
      },
      'react-i18next': { useTranslation: () => ({ t: key => key }) },
      '@/features/stored/storedCreation': { createStoredTemplate: () => source },
      '@/shared/hooks/useLoadingCounter': { useLoadingCounter: () => ({ isLoading: false, beginLoading() {}, endLoading() { ended++; }, isBusy: () => false }) },
      '@/features/stored/traceBlockEnd': loadTypeScript('src/features/stored/traceBlockEnd.ts'),
      '@/shared/utils/errorUtils': { getErrorMessage: error => error.message },
      '@/features/stored/storedCommon': {
        validateArguments: () => '', buildFinalArgs: () => ({}), buildArgTypes: () => ({}), buildArgDirections: () => ({}), parseLocalCompletions: () => []
      },
      '@/shared/utils/dateFormatter': { formatDbmsOutputLog: line => line },
      '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, params) => {
        if (channel === 'get-trace-data') return {success:true};
        if (channel === 'execute-sql-bg') return {success:true,rows: typeof params === 'string' && params.includes('AS signature') ? [{oid:'42',signature:'',ddl:source}] : []};
        requests++;
        assert.equal(channel, 'execute-trace');
        return executeTracePg(connection, params);
      } } }
    }, { alert: message => alerts.push(message) });
    const simulator = { parseTraceLogs() {}, clearSimulation() {}, loadSimulation() {} };
    const render = () => { cursor = 0; return useStoredLogic('demo', 'total', 'FUNCTION', true, simulator, '', '', { isNew: false, signature: '' }); };
    let completed;
    await render().loadObjectInfo(); requests = 0; ended = 0;
    await render().handleTraceExecute(false, success => { completed = success; });
    if (unsupported) {
      assert.equal(completed, false);
      assert.equal(requests, 0);
      assert.equal(ended, 1);
      assert.deepEqual(alerts, ['trace_unsupported_source']);
      assert.equal(render().isExecuting, false);
      return;
    }
    assert.equal(completed, true);
    assert.match(compiled[0], /RAISE NOTICE '\[TRACE RETURN\] %', json_build_object\('name', 'RETURN', 'value', \(230.4\)\)::text;/);
    assert.deepEqual(JSON.parse(JSON.stringify(render().returnValues)), [{ name: 'RETURN', value }]);
  });
}
