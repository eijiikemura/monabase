// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');


// Load real clients and IPC handlers, replacing only database connections.
function createHarness() {
  const OracleClient = loadModule('electron/oracle/oracleClient.js', { '../i18n': { t: (key, values) => require('../electron/i18n').translate(key, 'ja', values) }, 'ssh2': {}, electron: { app: { isPackaged: true } }, 'oracledb': { OUT_FORMAT_OBJECT: 1 }, './traceExecutor': {} }, {}, { strict: false });
  const client = new OracleClient();
  const steps = [];
  const executedSql = [];
  const connection = {
    transactionInProgress: false,
    async execute(sql) {
      executedSql.push(sql);
      return steps.length ? steps.shift()(sql) : { rows: [], metaData: [], outBinds: { lines: [] } };
    },
    async commit() { connection.transactionInProgress = false; },
    async rollback() { connection.transactionInProgress = false; }
  };
  client.connection = connection;

  const handlers = new Map();
  const context = {
    state: { client, type: 'oracle' },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    t: (key, values) => require('../electron/i18n').translate(key, 'ja', values), Buffer,
    traceCalls: 0,
    async executeOracleTrace() { context.traceCalls += 1; return { success: true }; }
  };
  const { registerDatabaseHandlers } = loadModule('electron/ipc/database.js', {
    '../oracle/traceDb': {}, '../postgres/traceDb': {},
    '../oracle/oracleClient': class {}, '../postgres/postgresClient': class {},
    '../oracle/traceExecutor': { executeTrace: (...args) => context.executeOracleTrace(...args) },
    '../postgres/traceExecutorPg': { executeTracePg: () => Promise.resolve() }
  }, {}, { strict: false });
  registerDatabaseHandlers({ ...context, getValidatedSettings: () => ({}) });
  return {
    client, connection, steps, executedSql, context,
    invoke: (channel, ...args) => handlers.get(channel)(null, ...args),
    nextState(state) {
      steps.push(() => {
        connection.transactionInProgress = state;
        return { rows: [], metaData: [], rowsAffected: 1 };
      });
    }
  };
}

test('Reports actual state after any SQL without additional queries', async () => {
  const h = createHarness();
  for (const [sql, state] of [
    ['SELECT 1 FROM DUAL', false],
    ['INSERT ALL INTO T (ID) VALUES (1) SELECT 1 FROM DUAL', true],
    ['SELECT * FROM T', true],
    ['SELECT * FROM T FOR UPDATE', true],
    ['BEGIN NULL; END;', false],
    ['BEGIN UPDATE T SET ID = 2; END;', true],
    ['ROLLBACK TO SAVEPOINT S', true],
    ['COMMIT', false],
    ['INSERT INTO T SELECT 1 FROM DUAL WHERE 1 = 0', false]
  ]) {
    h.nextState(state);
    const result = await h.invoke('execute-sql', sql);
    assert.equal(result.success, true);
    assert.equal(result.hasUncommittedTx, state, sql);
  }
  assert.equal(h.executedSql.length, 9);
});

test('Reports actual transaction state after execution failures', async () => {
  const h = createHarness();
  for (const state of [false, true]) {
    h.steps.push(() => {
      h.connection.transactionInProgress = state;
      throw new Error('Test SQL error');
    });
    const result = await h.invoke('execute-sql', 'INSERT INTO T VALUES (1)');
    assert.equal(result.success, false);
    assert.equal(result.error, 'Test SQL error');
    assert.equal(result.hasUncommittedTx, state);
    assert.equal(h.client.isExecuting, false);
  }
});

test('Background results do not report the main transaction state', async () => {
  const h = createHarness();
  h.connection.transactionInProgress = true;
  h.client.getMainTransactionState();
  h.client.bgPool = [{ id: 0, isExecuting: false, conn: { execute: async () => ({ rows: [], metaData: [] }) } }];
  const result = await h.invoke('execute-sql-bg', 'ALTER USER TEST_USER QUOTA 100M ON USERS');
  assert.equal(result.success, true);
  assert.equal('hasUncommittedTx' in result, false);
  assert.equal(h.client.hasUncommittedTx, true);
  assert.equal(h.client.bgPool[0].isExecuting, false);
  assert.equal(h.executedSql.length, 0);
});

test('Stored execution reports pending transactions on success and failure', async () => {
  for (const fails of [false, true]) {
    const h = createHarness();
    h.steps.push(() => ({ rows: [] }));
    h.steps.push(() => {
      h.connection.transactionInProgress = true;
      if (fails) throw new Error('Test stored execution error');
      return { outBinds: {} };
    });
    const result = await h.invoke('execute-stored', { schema: 'TEST_USER', objectName: 'TEST_PROC', objectType: 'PROCEDURE' });
    assert.equal(result.success, !fails);
    assert.equal(result.hasUncommittedTx, true);
    assert.equal(h.client.isExecuting, false);
  }
});

test('Commit and rollback report actual state on success and failure', async () => {
  for (const [channel, method] of [['commit-db', 'commit'], ['rollback-db', 'rollback']]) {
    const h = createHarness();
    h.connection.transactionInProgress = true;
    h.connection[method] = async () => { throw new Error('Test commit or rollback error'); };
    const failure = await h.invoke(channel);
    assert.equal(failure.success, false);
    assert.equal(failure.hasUncommittedTx, true);
    assert.equal(h.client.isExecuting, false);
    h.connection[method] = async () => { h.connection.transactionInProgress = false; };
    const success = await h.invoke(channel);
    assert.equal(success.success, true);
    assert.equal(success.hasUncommittedTx, false);
  }
});

test('Unknown state preserves the original error without clearing pending transactions', async () => {
  const h = createHarness();
  h.client.hasUncommittedTx = true;
  Object.defineProperty(h.connection, 'transactionInProgress', { get() { throw new Error('Test transaction state error'); } });
  const success = await h.invoke('execute-sql', 'SELECT 1 FROM DUAL');
  assert.equal(success.success, true);
  assert.equal('hasUncommittedTx' in success, false);
  assert.equal(h.client.hasUncommittedTx, true);
  h.steps.push(() => { throw new Error('Original SQL error'); });
  const failure = await h.invoke('execute-sql', 'BEGIN NULL; END;');
  assert.equal(failure.error, 'Original SQL error');
  assert.equal('hasUncommittedTx' in failure, false);
});

test('Trace startup checks the connection rather than cached state', async () => {
  const h = createHarness();
  h.client.hasUncommittedTx = false;
  h.connection.transactionInProgress = true;
  const pending = await h.invoke('execute-trace', { schema: 'APP', objectName: 'PROGRAM', objectType: 'PROCEDURE' });
  assert.equal(pending.errorCode, 'TRACE_MAIN_TRANSACTION_PENDING');
  assert.equal(pending.hasUncommittedTx, true);
  assert.equal(h.context.traceCalls, 0);
  h.connection.transactionInProgress = undefined;
  const unknown = await h.invoke('execute-trace', { schema: 'APP', objectName: 'PROGRAM', objectType: 'PROCEDURE' });
  assert.equal(unknown.success, false);
  assert.equal(h.context.traceCalls, 0);
  h.connection.transactionInProgress = false;
  const ready = await h.invoke('execute-trace', { schema: 'APP', objectName: 'PROGRAM', objectType: 'PROCEDURE' });
  assert.equal(ready.success, true);
  assert.equal(ready.hasUncommittedTx, false);
  assert.equal(h.context.traceCalls, 1);
  assert.equal(h.client.isExecuting, false);
});

test('Reconnection updates current subscribers while background and unknown states leave them unchanged', async () => {
  const { createDesktopClient } = loadTypeScript('src/shared/api/createDesktopClient.ts');
  let response = { success: true, hasUncommittedTx: true };
  const transport = { invoke: async () => response, on() {}, removeListener() {} };
  const originalInvoke = transport.invoke;
  const client = createDesktopClient(transport, () => {});
  const first = [], current = [];
  const unsubscribe = client.subscribeTransactionState(state => first.push(state));
  await client.invoke('execute-sql', 'INSERT ...');
  unsubscribe();
  client.subscribeTransactionState(state => current.push(state));
  await client.invoke('execute-sql', 'INSERT ...');
  response = { success: false, hasUncommittedTx: true };
  await client.invoke('execute-sql', 'BEGIN ... END;');
  response = { success: true, hasUncommittedTx: false };
  await client.invoke('execute-sql-bg', 'SELECT ...');
  response = { success: true };
  await client.invoke('execute-sql', 'SELECT ...');
  response = { success: true, hasUncommittedTx: false };
  await client.invoke('rollback-db');
  assert.deepEqual(first, [true]);
  assert.deepEqual(current, [true, true, false]);
  assert.equal(transport.invoke, originalInvoke);
});

test('Execution plans use one background connection and roll back only that connection', async () => {
  for (const pending of [false, true]) {
    const h = createHarness();
    h.connection.transactionInProgress = pending;
    h.client.getMainTransactionState();
    // Never use the busy main connection for analysis.
    h.client.isExecuting = true;
    const calls = [];
    let rollbackCount = 0;
    const bg = { id: 1, isExecuting: false, conn: {
      async execute(sql, binds) {
        calls.push({ sql, binds });
        if (sql.includes('AS EXECUTION_SCHEMA')) return { rows: [{ EXECUTION_SCHEMA: 'Actual.Schema' }] };
        if (sql.startsWith('SELECT ID,')) return { rows: [{ ID: 1, OBJECT_OWNER: 'Other.Schema', OBJECT_NAME: 'Table.Name', OBJECT_TYPE: 'TABLE' }, { ID: 2, OBJECT_OWNER: 'Other.Schema', OBJECT_NAME: 'Index.Name', OBJECT_TYPE: 'INDEX' }] };
        if (sql.includes('DBMS_XPLAN')) return { rows: [{ PLAN_TABLE_OUTPUT: '|* 1 | TABLE ACCESS FULL | Table.Name | 1 | 1 | 1 | 1 |' }, { PLAN_TABLE_OUTPUT: '| 2 | INDEX RANGE SCAN | Index.Name | 1 | 1 | 1 | 1 |' }, { PLAN_TABLE_OUTPUT: '検証用実行計画' }], metaData: [] };
        return { rows: [{ PLAN_TABLE_OUTPUT: '検証用実行計画' }], metaData: [] };
      },
      async rollback() { rollbackCount += 1; }
    } };
    h.client.bgPool = [bg];
    const result = await h.invoke('explain-sql', 'SELECT * FROM TEST_USER.AREA_SALES;  ');
    assert.equal(result.success, true);
    assert.equal(result.rows[0].PLAN_OBJECT_OWNER, 'Other.Schema');
    assert.equal(result.rows[0].PLAN_OBJECT_NAME, 'Table.Name');
    assert.equal(result.rows[1].PLAN_OBJECT_TYPE, 'INDEX');
    assert.equal(result.rows[2].PLAN_TABLE_OUTPUT, '検証用実行計画');
    assert.equal(result.rows[2].PLAN_OBJECT_NAME, undefined);
    assert.equal(calls.length, 4);
    assert.equal(result.executionSchema, 'Actual.Schema');
    const statementId = calls[0].sql.match(/SET STATEMENT_ID = '(MB_[a-f0-9]{24})'/)?.[1];
    assert.ok(statementId);
    assert.equal(calls[0].sql, `EXPLAIN PLAN SET STATEMENT_ID = '${statementId}' FOR SELECT * FROM TEST_USER.AREA_SALES`);
    assert.equal(calls[1].sql, "SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', :statementId))");
    assert.ok(calls[2].sql.includes('WHERE STATEMENT_ID = :statementId'));
    assert.equal(calls[1].binds.statementId, statementId); assert.equal(calls[2].binds.statementId, statementId);
    assert.equal(rollbackCount, 1);
    assert.equal(bg.isExecuting, false);
    assert.equal(h.executedSql.length, 0);
    assert.equal(h.connection.transactionInProgress, pending);
    assert.equal(h.client.hasUncommittedTx, pending);
    assert.equal(h.client.isExecuting, true);
    assert.equal('hasUncommittedTx' in result, false);
  }
});

test('Plan failures roll back the background connection and discard it if cleanup fails', async () => {
  for (const failsDuringPlan of [false, true]) {
    const h = createHarness();
    h.connection.transactionInProgress = true;
    let closed = false;
    let rollbackCount = 0;
    const bg = { id: 1, isExecuting: false, conn: {
      async execute(sql) {
        if (failsDuringPlan) throw new Error('Original plan error');
        return { rows: sql.includes('AS EXECUTION_SCHEMA') ? [{ EXECUTION_SCHEMA: 'TEST' }] : [], metaData: [] };
      },
      async rollback() { rollbackCount += 1; throw new Error('Cleanup error'); },
      async close() { closed = true; }
    } };
    h.client.bgPool = [bg];
    const result = await h.invoke('explain-sql', 'SELECT 1 FROM DUAL');
    assert.equal(result.success, false);
    assert.equal(result.error, failsDuringPlan ? 'Original plan error' : 'Cleanup error');
    assert.equal(rollbackCount, 1);
    assert.equal(closed, true);
    assert.equal(bg.isExecuting, false);
    assert.equal(h.client.bgPool.length, 0);
    assert.equal(h.executedSql.length, 0);
    assert.equal(h.connection.transactionInProgress, true);
  }
});

test('Execution plans never fall back to the main connection', async () => {
  const h = createHarness();
  const result = await h.invoke('explain-sql', 'SELECT 1 FROM DUAL');
  assert.equal(result.success, false);
  assert.ok(result.error.includes('バックグラウンド接続'));
  assert.equal(h.executedSql.length, 0);
  assert.equal('hasUncommittedTx' in result, false);
});
