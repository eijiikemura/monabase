// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { loadModule } = require('./helpers/loadModule.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const PostgresClient = loadModule('electron/postgres/postgresClient.js', { electron: { app: { isPackaged: true } } }, {}, { strict: false });
const cases = [
  ['SHOW server_version', 'SHOW', false], ['EXPLAIN SELECT 1', 'EXPLAIN', false],
  ['INSERT INTO demo VALUES (1) RETURNING value', 'INSERT', true],
  ['UPDATE demo SET value = 1 RETURNING value', 'UPDATE', true],
  ['DELETE FROM demo RETURNING value', 'DELETE', true]
];
async function execute(sql, response) {
  const client = new PostgresClient(), connection = new EventEmitter(), calls = [];
  let status = 'I'; connection.getTransactionStatus = () => status;
  connection.query = async text => {
    calls.push(text); if (text === 'BEGIN') status = 'T';
    return text === sql ? response : { command: '', rows: [], fields: [], rowCount: 0 };
  };
  client.client = connection;
  return { result: await client.execute(sql), calls, status };
}
for (const [sql, command, affected] of cases) {
  test(`PostgreSQL ${command} retains returned rows, column metadata and affected count independently`, async () => {
    const source = [{ value: '9007199254740993' }];
    const { result, calls } = await execute(sql, { command, rows: source, fields: [{ name: 'value', dataTypeID: 1700 }], rowCount: 1 });
    assert.equal(result.command, command); assert.equal(result.rows[0].value, source[0].value);
    assert.equal(result.metaData[0].name, 'value'); assert.equal(result.metaData[0].dbTypeName, 'NUMBER');
    assert.equal(result.rowsAffected, affected ? 1 : 0);
    assert.equal(calls.filter(text => text === sql).length, 1);
    assert.ok(!calls.includes('COMMIT'));
  });
}
test('Zero-row RETURNING retains column definitions and a zero affected count', async () => {
  const { result } = await execute('UPDATE demo SET value = 1 WHERE false RETURNING value', {
    command: 'UPDATE', rows: [], fields: [{ name: 'value', dataTypeID: 23 }], rowCount: 0
  });
  assert.equal(result.rows.length, 0); assert.equal(result.metaData.length, 1); assert.equal(result.rowsAffected, 0);
});
test('DML without returned fields retains its affected count without inventing result columns', async () => {
  const { result } = await execute('UPDATE demo SET value = 1', { command: 'UPDATE', rows: [], fields: [], rowCount: 3 });
  assert.equal(result.rowsAffected, 3); assert.equal(result.rows.length, 0); assert.equal(result.metaData.length, 0);
});
function renderer(sql, response) {
  const h = createHookHarness(), history = [], requests = [], alerts = [], t = key => key;
  const { useSqlWindow } = loadTypeScript('src/features/postgresql/windows/sql/useSqlWindow.ts', {
    './sqlScript': loadTypeScript('src/features/sql/sqlScript.ts'), react: h.react, 'react-i18next': { useTranslation: () => ({ t }) }, 'sql-formatter': {}, '@codemirror/view': {},
    '../common/schemaStorage': { savePgSelectSchema() {} },
    '@/features/data-grid/dataGridHelper': { buildGridColumns: metadata => metadata.map(column => ({ field: column.name })) },
    '@/features/sql/sqlHistory': { invokeSqlHistoryWhen: async (_current, _t, channel, entry) => { history.push([channel, entry]); return []; } },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { if (args[0] === 'inspect-sql-privacy') return args[1].map(sql => require('../electron/services/sqlPrivacy').inspectSqlPrivacy(sql, args[2])); if (['begin-sql-batch', 'end-sql-batch'].includes(args[0])) return { success: true }; requests.push(args); return response; } } }
  }, { crypto: require('node:crypto').webcrypto, window: { innerHeight: 900, dispatchEvent() {} }, CustomEvent: class {}, alert: message => alerts.push(message) });
  const render = () => h.render(() => useSqlWindow({ initialSql: sql, isActive: false, dateFormat: 'YYYY-MM-DD', inputDateFormat: 'YYYY-MM-DD' }));
  render().setSelectedSchema('test'); render().setBottomTab(1);
  return { render, history, requests, alerts };
}
for (const [sql, command, affected] of cases) {
  test(`PostgreSQL renderer opens the result tab for ${command} and records the correct count`, async () => {
    const h = renderer(sql, { success: true, command, rows: [{ value: '9007199254740993' }], metaData: [{ name: 'value' }], rowsAffected: affected ? 1 : 0, executionTime: 1 });
    await h.render().handleExecuteSql();
    assert.equal(h.render().bottomTab, 0); assert.equal(h.render().columns[0].field, 'value');
    assert.equal(h.render().rows[0].value, '9007199254740993');
    assert.equal(h.history[0][1].rowCount, 1);
    assert.match(h.render().logs[0].resultMsg, affected ? /1row_processed/ : /1row_fetched/);
    assert.equal(h.requests[0][0], 'execute-sql'); assert.equal(h.alerts.length, 0);
  });
}
test('Renderer shows zero-row RETURNING columns and uses the console for DML without results', async () => {
  for (const fields of [[], [{ name: 'value' }]]) {
    const h = renderer('UPDATE demo SET value = 1 WHERE false RETURNING value', {
      success: true, command: 'UPDATE', rows: [], metaData: fields, rowsAffected: 0, executionTime: 1
    });
    h.render().setBottomTab(0); await h.render().handleExecuteSql();
    assert.equal(h.render().bottomTab, fields.length ? 0 : 1);
    assert.equal(h.history[0][1].rowCount, 0);
    assert.match(h.render().logs[0].resultMsg, /0row_processed/);
  }
});
test('Renderer chooses the final statement result and keeps SQL failures on the console', async () => {
  const h = renderer('SELECT 1; SHOW server_version;', { success: true, command: 'SHOW', rows: [{ server_version: '16' }], metaData: [{ name: 'server_version' }], executionTime: 1 });
  await h.render().handleExecuteSql(); assert.equal(h.requests.length, 2); assert.equal(h.render().bottomTab, 0);
  const failed = renderer('SHOW server_version', { success: false, error: 'Simulated SQL failure' });
  await failed.render().handleExecuteSql(); assert.equal(failed.render().bottomTab, 1); assert.equal(failed.alerts.length, 1);
});
