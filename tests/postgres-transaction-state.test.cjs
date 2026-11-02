// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');


// Use real client and IPC source, replacing only database responses.
function createHarness() {
  const PostgresClient = loadModule('electron/postgres/postgresClient.js', { '../i18n': { t: (key, values) => require('../electron/i18n').translate(key, 'ja', values) }, 'ssh2': {}, electron: { app: { isPackaged: true } }, 'pg': { Client: class {}, types: { setTypeParser() {} } } }, {}, { strict: false });
  const client = new PostgresClient();
  const executedSql = [];
  const steps = [];
  const connection = new EventEmitter();
  connection.status = 'I';
  connection.getTransactionStatus = () => connection.status;
  connection.query = async sql => {
    executedSql.push(sql);
    if (sql === 'BEGIN') connection.status = 'T';
    if (sql === 'COMMIT' || sql === 'ROLLBACK') connection.status = 'I';
    if (sql.startsWith('ROLLBACK TO SAVEPOINT')) connection.status = 'T';
    if (steps.length && steps[0].sql === sql) return steps.shift().run();
    return { command: 'SELECT', rows: [], fields: [] };
  };
  client.client = connection;
  const handlers = new Map();
  const context = {
    state: { client, type: 'postgresql' }, Buffer,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    t: (key, values) => require('../electron/i18n').translate(key, 'ja', values), traceCalls: 0,
    async executeTracePg() { context.traceCalls += 1; return { success: true }; }
  };
  const { registerDatabaseHandlers } = loadModule('electron/ipc/database.js', {
    '../oracle/traceDb': {}, '../postgres/traceDb': {},
    '../oracle/oracleClient': class {}, '../postgres/postgresClient': class {},
    '../oracle/traceExecutor': { executeTrace: () => Promise.resolve() },
    '../postgres/traceExecutorPg': { executeTracePg: (...args) => context.executeTracePg(...args) }
  }, {}, { strict: false });
  registerDatabaseHandlers({ ...context, getValidatedSettings: () => ({}) });
  return {
    client, connection, steps, executedSql, context,
    invoke: (channel, ...args) => handlers.get(channel)(null, ...args)
  };
}

test('Reports actual main connection state for BEGIN, SELECT, and ROLLBACK TO', async () => {
  const h = createHarness();
  for (const [sql, expected] of [
    ['SELECT 1', false], ['BEGIN', true], ['SELECT 1', true],
    ['SAVEPOINT S', true], ['ROLLBACK TO SAVEPOINT S', true], ['COMMIT', false]
  ]) {
    const result = await h.invoke('execute-sql', sql);
    assert.equal(result.success, true);
    assert.equal(result.hasUncommittedTx, expected, sql);
  }
  assert.equal(h.executedSql.filter(sql => !/^(?:SAVEPOINT|RELEASE SAVEPOINT) monabase_stmt_/.test(sql)).length, 6);
});

test('Automatic BEGIN follows connection state and does not repeat an explicit BEGIN', async () => {
  const h = createHarness();
  const inserted = await h.invoke('execute-sql', 'INSERT INTO T VALUES (1)');
  assert.equal(inserted.hasUncommittedTx, true);
  assert.deepEqual(h.executedSql.filter(sql => !/^(?:SAVEPOINT|RELEASE SAVEPOINT) monabase_stmt_/.test(sql)), ['BEGIN', 'INSERT INTO T VALUES (1)']);
  assert.match(h.executedSql[1], /^SAVEPOINT monabase_stmt_/);
  assert.equal(h.executedSql[3], `RELEASE ${h.executedSql[1]}`);
  await h.invoke('rollback-db');
  await h.invoke('execute-sql', 'BEGIN');
  // Use the connection state even when the cache is stale.
  h.client.hasUncommittedTx = false;
  const updated = await h.invoke('execute-sql', 'UPDATE T SET ID = 2');
  assert.equal(updated.hasUncommittedTx, true);
  assert.equal(h.executedSql.filter(sql => sql === 'BEGIN').length, 2);
});

test('Stored SELECT and CALL report transaction state through the same path', async () => {
  const h = createHarness();
  for (const sql of ['SELECT TEST_FUNC()', 'CALL TEST_PROC()']) {
    h.connection.status = 'I';
    assert.equal((await h.invoke('execute-sql', sql)).hasUncommittedTx, false);
    h.connection.status = 'T';
    assert.equal((await h.invoke('execute-sql', sql)).hasUncommittedTx, true);
  }
});

test('A failed statement rolls back to its savepoint while earlier edits remain pending', async () => {
  const h = createHarness();
  h.steps.push({
    sql: 'INSERT INTO T VALUES (1)',
    run() {
      h.connection.status = 'E';
      throw Object.assign(new Error('Test unique constraint violation'), { code: '23505' });
    }
  });
  const result = await h.invoke('execute-sql', 'INSERT INTO T VALUES (1)');
  assert.equal(result.success, false);
  assert.equal(result.hasUncommittedTx, true);
  assert.equal(h.client.hasUncommittedTx, true);
  assert.equal(h.client.isExecuting, false);
  assert.equal(h.connection.status, 'T');
  assert.ok(h.executedSql.some(sql => sql.startsWith('ROLLBACK TO SAVEPOINT monabase_stmt_')));
  assert.equal(h.executedSql.includes('ROLLBACK'), false);
  assert.equal(h.executedSql.filter(sql => sql === 'INSERT INTO T VALUES (1)').length, 1);
  assert.equal((await h.invoke('execute-sql', 'SELECT 1')).success, true);
  assert.equal((await h.invoke('rollback-db')).hasUncommittedTx, false);
});

test('Background state never overwrites the main transaction indicator', async () => {
  const h = createHarness();
  h.connection.status = 'T';
  h.client.getMainTransactionState();
  const background = new EventEmitter();
  background.getTransactionStatus = () => 'I';
  background.query = async () => ({ command: 'SELECT', rows: [], fields: [] });
  h.client.bgPool = [{ id: 1, isExecuting: false, client: background }];
  const result = await h.invoke('execute-sql-bg', 'SELECT 1');
  assert.equal(result.success, true);
  assert.equal('hasUncommittedTx' in result, false);
  assert.equal(h.client.hasUncommittedTx, true);
  assert.equal(h.executedSql.length, 0);
});

test('Waits for response completion after an error instead of reporting stale idle state', async () => {
  const h = createHarness();
  h.steps.push({
    sql: 'BEGIN; SELECT ERROR',
    run() {
      h.connection.readyForQuery = false;
      setImmediate(() => {
        h.connection.status = 'E';
        h.connection.readyForQuery = true;
        h.connection.emit('drain');
      });
      throw new Error('Test multi-statement error');
    }
  });
  const result = await h.invoke('execute-sql', 'BEGIN; SELECT ERROR');
  assert.equal(result.success, false);
  assert.equal(result.hasUncommittedTx, true);
  assert.equal(h.connection.listenerCount('drain'), 0);
  assert.equal(h.connection.listenerCount('end'), 0);
  assert.equal(h.client.isExecuting, false);
});

test('Disconnection before response completion preserves the unknown transaction state', async () => {
  const h = createHarness();
  h.client.hasUncommittedTx = true;
  h.steps.push({
    sql: 'SELECT ERROR',
    run() {
      h.connection.readyForQuery = false;
      setImmediate(() => h.connection.emit('end'));
      throw new Error('Test disconnection error');
    }
  });
  const result = await h.invoke('execute-sql', 'SELECT ERROR');
  assert.equal(result.success, false);
  assert.equal('hasUncommittedTx' in result, false);
  assert.equal(h.client.hasUncommittedTx, true);
});

test('Commit and rollback report actual state on success and failure', async () => {
  for (const [channel, sql] of [['commit-db', 'COMMIT'], ['rollback-db', 'ROLLBACK']]) {
    const h = createHarness();
    h.connection.status = 'T';
    h.steps.push({
      sql, run() { h.connection.status = 'T'; throw new Error('Test commit or rollback error'); }
    });
    const failure = await h.invoke(channel);
    assert.equal(failure.success, false);
    assert.equal(failure.hasUncommittedTx, true);
    const success = await h.invoke(channel);
    assert.equal(success.success, true);
    assert.equal(success.hasUncommittedTx, false);
  }
});

test('Unknown state preserves the original execution error and pending indicator', async () => {
  const h = createHarness();
  h.connection.status = null;
  h.client.hasUncommittedTx = true;
  const result = await h.invoke('execute-sql', 'SELECT 1');
  assert.equal(result.success, true);
  assert.equal('hasUncommittedTx' in result, false);
  assert.equal(h.client.hasUncommittedTx, true);
  h.steps.push({ sql: 'SELECT ERROR', run() { throw new Error('Original SQL error'); } });
  const failure = await h.invoke('execute-sql', 'SELECT ERROR');
  assert.equal(failure.error, 'Original SQL error');
  assert.equal('hasUncommittedTx' in failure, false);
});

test('Trace execution checks actual state and rejects active or failed transactions', async () => {
  const h = createHarness();
  for (const status of ['T', 'E']) {
    h.connection.status = status;
    h.client.hasUncommittedTx = false;
    const rejected = await h.invoke('execute-trace', { schema: 'APP', objectName: 'PROGRAM', objectType: 'PROCEDURE' });
    assert.equal(rejected.errorCode, 'TRACE_MAIN_TRANSACTION_PENDING');
    assert.equal(rejected.hasUncommittedTx, true);
    assert.equal(h.context.traceCalls, 0);
  }
  h.connection.status = null;
  assert.equal((await h.invoke('execute-trace', { schema: 'APP', objectName: 'PROGRAM', objectType: 'PROCEDURE' })).success, false);
  assert.equal(h.context.traceCalls, 0);
  h.connection.status = 'I';
  const allowed = await h.invoke('execute-trace', { schema: 'APP', objectName: 'PROGRAM', objectType: 'PROCEDURE' });
  assert.equal(allowed.success, true);
  assert.equal(allowed.hasUncommittedTx, false);
  assert.equal(h.context.traceCalls, 1);
  assert.equal(h.executedSql.length, 0);
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

test('Execution plans and temporary schema settings use a background connection', async () => {
  for (const status of ['I', 'T', 'E']) {
    const h = createHarness();
    h.connection.status = status;
    h.client.getMainTransactionState();
    h.client.isExecuting = true;
    const calls = [];
    const bg = { id: 1, isExecuting: false, client: {
      async query(sql) {
        calls.push(sql);
        return { rows: [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan' } }] }] };
      }
    } };
    h.client.bgPool = [bg];
    const result = await h.invoke('explain-sql', 'SELECT * FROM AREA_SALES; ', {}, 'Te"st');
    assert.equal(result.success, true);
    assert.ok(result.rows[0].PLAN_TABLE_OUTPUT.includes('Seq Scan'));
    assert.deepEqual(calls, [
      'BEGIN', 'SET LOCAL search_path TO "Te""st"',
      'EXPLAIN (VERBOSE, FORMAT JSON) SELECT * FROM AREA_SALES', 'ROLLBACK'
    ]);
    assert.equal(bg.isExecuting, false);
    assert.equal(h.executedSql.length, 0);
    assert.equal(h.connection.status, status);
    assert.equal(h.client.hasUncommittedTx, status !== 'I');
    assert.equal(h.client.isExecuting, true);
    assert.equal('hasUncommittedTx' in result, false);
  }
});

test('Plan failures roll back the background connection and discard it if cleanup fails', async () => {
  for (const rollbackFails of [false, true]) {
    const h = createHarness();
    h.connection.status = 'T';
    const calls = [];
    let ended = false;
    const bg = { id: 1, isExecuting: false, client: {
      async query(sql) {
        calls.push(sql);
        if (sql.startsWith('EXPLAIN')) throw new Error('Original plan error');
        if (sql === 'ROLLBACK' && rollbackFails) throw new Error('Cleanup error');
        return { rows: [] };
      },
      async end() { ended = true; }
    } };
    h.client.bgPool = [bg];
    const result = await h.invoke('explain-sql', 'SELECT ERROR');
    assert.equal(result.success, false);
    assert.equal(result.error, 'Original plan error');
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.equal(ended, rollbackFails);
    assert.equal(h.client.bgPool.length, rollbackFails ? 0 : 1);
    assert.equal(bg.isExecuting, false);
    assert.equal(h.executedSql.length, 0);
    assert.equal(h.connection.status, 'T');
    assert.equal('hasUncommittedTx' in result, false);
  }
});

test('Execution plans never fall back to the main connection', async () => {
  const h = createHarness();
  const result = await h.invoke('explain-sql', 'SELECT 1');
  assert.equal(result.success, false);
  assert.ok(result.error.includes('バックグラウンド接続'));
  assert.equal(h.executedSql.length, 0);
  assert.equal('hasUncommittedTx' in result, false);
});

test('DDL still commits pending main edits before execution and never uses a statement savepoint', async () => {
  const h = createHarness();
  h.connection.status = 'T';
  const result = await h.invoke('execute-sql', '/* comment */ CREATE TABLE test_table(id integer)');
  assert.equal(result.success, true);
  assert.deepEqual(h.executedSql, ['COMMIT', '/* comment */ CREATE TABLE test_table(id integer)']);
  assert.equal(result.hasUncommittedTx, false);
});

test('Existing aborted transactions never trigger a full rollback or an automatic retry', async () => {
  const h = createHarness();
  h.connection.status = 'E';
  h.steps.push({ sql: 'SELECT 1', run() { throw Object.assign(new Error('Original aborted transaction'), { code:'25P02' }); } });
  const result = await h.invoke('execute-sql', 'SELECT 1');
  assert.equal(result.success, false);
  assert.equal(result.error, 'Original aborted transaction');
  assert.equal(result.hasUncommittedTx, true);
  assert.deepEqual(h.executedSql, ['SELECT 1']);
});

test('Savepoint recovery failure preserves the original error and pending transaction', async () => {
  const h = createHarness();
  h.connection.status = 'T';
  const original = h.connection.query;
  h.connection.query = async sql => {
    if (sql.startsWith('ROLLBACK TO SAVEPOINT monabase_stmt_')) {
      h.executedSql.push(sql);
      throw new Error('Recovery failed');
    }
    return original(sql);
  };
  h.steps.push({ sql: 'SELECT ERROR', run() { h.connection.status = 'E'; throw new Error('Original statement failure'); } });
  const result = await h.invoke('execute-sql', 'SELECT ERROR');
  assert.equal(result.error, 'Original statement failure');
  assert.equal(result.hasUncommittedTx, true);
  assert.equal(h.connection.status, 'E');
  assert.equal(h.executedSql.includes('ROLLBACK'), false);
  assert.equal(h.executedSql.filter(sql => sql === 'SELECT ERROR').length, 1);
});

test('Cancellation recovers the statement savepoint before reporting the timeout', async () => {
  const h = createHarness();
  h.connection.status = 'T';
  h.steps.push({ sql:'SELECT pg_sleep(10)', run() { h.connection.status = 'E'; throw Object.assign(new Error('cancelled'), {code:'57014'}); } });
  const result = await h.invoke('execute-sql', 'SELECT pg_sleep(10)');
  assert.equal(result.success, false);
  assert.equal(result.hasUncommittedTx, true);
  assert.equal(h.connection.status, 'T');
  assert.ok(h.executedSql.some(sql => sql.startsWith('ROLLBACK TO SAVEPOINT monabase_stmt_')));
});

test('User transaction commands and procedures are never wrapped in an application savepoint', async () => {
  const h = createHarness();
  h.connection.status = 'T';
  for (const sql of ['SAVEPOINT user_mark', 'ROLLBACK TO SAVEPOINT user_mark', 'RELEASE SAVEPOINT user_mark',
    'CALL procedure_with_commit()', 'DO $$ BEGIN COMMIT; END $$', 'COMMIT', 'BEGIN', 'ROLLBACK']) {
    assert.equal((await h.invoke('execute-sql', sql)).success, true);
  }
  assert.equal(h.executedSql.some(sql => sql.includes('monabase_stmt_')), false);
});

test('Background statement recovery leaves the main connection and its pending state intact', async () => {
  const h = createHarness();
  h.connection.status = 'T';
  h.client.getMainTransactionState();
  const calls = [], background = new EventEmitter();
  let status = 'T';
  background.getTransactionStatus = () => status;
  background.query = async sql => {
    calls.push(sql);
    if (sql === 'SELECT ERROR') { status = 'E'; throw new Error('Background failure'); }
    if (sql.startsWith('ROLLBACK TO SAVEPOINT')) status = 'T';
    return { rows:[], fields:[], command:'SELECT' };
  };
  h.client.bgPool = [{id:1,isExecuting:false,client:background}];
  const result = await h.invoke('execute-sql-bg', 'SELECT ERROR');
  assert.equal(result.error, 'Background failure');
  assert.equal('hasUncommittedTx' in result, false);
  assert.equal(h.client.hasUncommittedTx, true);
  assert.equal(h.connection.status, 'T');
  assert.equal(status, 'T');
  assert.deepEqual(h.executedSql, []);
  assert.equal(calls.includes('ROLLBACK'), false);
});

test('Execution plan binds preserve quoted literals and use the background connection', async () => {
  const h = createHarness(), calls = [];
  const bg = {id:1,isExecuting:false,client:{query:async(sql,binds)=>{
    calls.push({sql,binds});
    return {rows:[{'QUERY PLAN':[]}]};
  }}};
  h.client.bgPool=[bg];
  const result=await h.invoke('explain-sql', "SELECT :value::integer, ':value'", {value:'42'});
  assert.equal(result.success,true);
  assert.equal(calls[1].sql,"EXPLAIN (VERBOSE, FORMAT JSON) SELECT $1::integer, ':value'");
  assert.deepEqual(Array.from(calls[1].binds),['42']);
  assert.deepEqual(h.executedSql,[]);
});

test('Read-only connections reject trace execution before calling either database executor', async () => {
  for (const database of ['oracle', 'postgresql']) {
    const h = createHarness();
    h.context.state.type = database;
    h.client.isReadonly = true;
    const result = await h.invoke('execute-trace', {});
    assert.equal(result.success, false);
    assert.equal(h.context.traceCalls, 0);
    assert.equal(h.executedSql.length, 0);
    assert.equal(h.client.isExecuting, false);
  }
});
