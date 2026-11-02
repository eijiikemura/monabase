// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { loadModule } = require('./helpers/loadModule.cjs');
const { createDdlEditor } = require('./helpers/ddlEditors.cjs');
const Client = loadModule('electron/postgres/postgresClient.js', { electron: { app: { isPackaged: true } } }, {}, { strict: false });
function batchClient({ status = 'I', fail, failRollback = false } = {}) {
  const client = new Client(), connection = new EventEmitter(), calls = [];
  connection.getTransactionStatus = () => status;
  connection.query = async query => {
    const text = typeof query === 'string' ? query : query.text;
    calls.push(text);
    if (text === fail || (failRollback && text === 'ROLLBACK')) throw new Error('Simulated SQL rejection');
    if (text === 'BEGIN') status = 'T';
    if (text === 'COMMIT' || text === 'ROLLBACK') status = 'I';
    if (typeof query === 'object') assert.equal(query.queryMode, 'extended');
    return { rows: [], fields: [] };
  };
  connection.end = async () => {};
  client.client = connection;
  return { client, calls };
}
test('DDL batch commits previous edits before beginning one atomic main-connection operation', async () => {
  const { client, calls } = batchClient({ status: 'T' });
  await client.executeDdlBatch(['CREATE TABLE demo(id int)', 'ALTER TABLE demo ADD label text']);
  assert.deepEqual(calls, ['COMMIT', 'BEGIN', 'CREATE TABLE demo(id int)', 'ALTER TABLE demo ADD label text', 'COMMIT']);
  assert.equal(client.isExecuting, false); assert.equal(client.getMainTransactionState(), false);
});
test('DDL batch rolls back every new change on failure and permits a subsequent retry', async () => {
  const { client, calls } = batchClient({ fail: 'CREATE TRIGGER invalid' });
  await assert.rejects(client.executeDdlBatch(['DROP TRIGGER demo ON items', 'CREATE TRIGGER invalid']), /Simulated SQL/);
  assert.deepEqual(calls, ['BEGIN', 'DROP TRIGGER demo ON items', 'CREATE TRIGGER invalid', 'ROLLBACK']);
  assert.equal(client.isExecuting, false);
  await client.executeDdlBatch(['CREATE TABLE retry(id int)']); assert.equal(calls.at(-1), 'COMMIT');
});
test('DDL batch refuses read-only mode, unknown state, transaction commands and multi-statement entries before changes', async () => {
  for (const statements of [[], ['COMMIT'], ['CREATE TABLE demo(id int); COMMIT'], ['CREATE TABLE demo(id int); DROP TABLE demo'], [null]]) {
    const { client, calls } = batchClient(); await assert.rejects(client.executeDdlBatch(statements)); assert.equal(calls.length, 0);
  }
  const readonly = batchClient(); readonly.client.isReadonly = true;
  await assert.rejects(readonly.client.executeDdlBatch(['DROP TABLE demo'])); assert.equal(readonly.calls.length, 0);
  const unknown = batchClient({ status: undefined }); unknown.client.client.getTransactionStatus = () => undefined;
  await assert.rejects(unknown.client.executeDdlBatch(['DROP TABLE demo'])); assert.equal(unknown.calls.length, 0);
});
test('DDL rollback failure retires the uncertain main connection instead of reusing it', async () => {
  const { client } = batchClient({ fail: 'DROP TABLE demo', failRollback: true });
  await assert.rejects(client.executeDdlBatch(['DROP TABLE demo']), /reconnect/);
  assert.equal(client.client, null); assert.equal(client.isExecuting, false);
});
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: actual CHECK editor preserves quoted names and semicolons inside a condition`, async () => {
    const calls = [];
    const h = await createDdlEditor('constraint', db, async (...args) => { calls.push(args); return { success: true, columns: [], rows: [] }; }, { tableName: 'Demo;Table' });
    try {
      h.find(h.render(), n => n.type === 'TextField' && n.props.label === 'constraint_name_required').props.onChange({ target: { value: 'Check;Case' } });
      h.find(h.render(), n => n.type === 'CodeMirror' && n.props.onChange).props.onChange(`"Label" <> 'a;b'`);
      calls.length = 0;
      await h.find(h.render(), n => n.type === 'Button' && n.children.includes('create')).props.onClick();
      const sql = calls.filter(c => c[0] === 'execute-sql');
      assert.equal(sql.length, 1); assert.match(sql[0][1], /"Demo;Table"/); assert.match(sql[0][1], db === 'oracle' ? /"CHECK;CASE"/ : /"Check;Case"/); assert.match(sql[0][1], /'a;b'/);
    } finally { h.unmount(); }
  });
  test(`${db}: actual index editor preserves exact column names and function literals`, async () => {
    const calls = [];
    const h = await createDdlEditor('index', db, async (...args) => { calls.push(args); return { success: true, columns: ['MiXeD;Col'], rows: [], objects: [] }; }, { indexName: 'Index;Case', initialTable: 'Demo;Table' });
    try {
      h.render().handleLeftDoubleClick('MiXeD;Col'); await h.flush();
      assert.match(h.render().createSql, /"MiXeD;Col"/);
      calls.length = 0; await h.render().handleExecute();
      assert.equal(calls.filter(c => c[0] === 'execute-sql').length, 1);
      h.render().updateFormField('indexType', 'FUNCTION'); await h.flush();
      h.render().updateFormField('functionExpression', `CASE WHEN "MiXeD;Col" = 'a;b' THEN 1 ELSE 0 END`); await h.flush();
      calls.length = 0; await h.render().handleExecute();
      const sql = calls.filter(c => c[0] === 'execute-sql'); assert.equal(sql.length, 1); assert.match(sql[0][1], /'a;b'/);
    } finally { h.unmount(); }
  });
}
test('Trigger editor submits one structured main request with the loaded definition and preserves errors', async () => {
  const calls = [], metadata = { trigger_oid: '42', trigger_name: 'Old;Trigger', table_name: 'Old;Table', schema_name: 'test',
    trigger_ddl: 'BEFORE INSERT FOR EACH ROW', function_ddl: 'AS $$BEGIN RETURN NEW; END;$$', function_body: 'BEGIN RETURN NEW; END;', tgtype: 7, language: 'plpgsql', enabled: 'O', function_schema: 'test', function_name: 'Handler', function_users: 1 };
  const h = await createDdlEditor('trigger', 'postgresql', async (...args) => {
    calls.push(args);
    if (args[0] === 'get-postgres-trigger') return { success: true, trigger: metadata };
    if (args[0] === 'save-postgres-trigger') return { success: false, error: 'Simulated trigger rejection' };
    return { success: true, rows: [] };
  }, { isNew: false, triggerName: 'Old;Trigger', initialTable: 'Old;Table' });
  try {
    h.render().setWizBody("BEGIN PERFORM '$$ $monabase$'; RETURN NEW; END;"); await h.flush();
    calls.length = 0; await h.render().handleCreateTrigger();
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'save-postgres-trigger');
    const request = calls[0][1]; assert.equal(request.expected.triggerOid, '42');
    assert.equal(request.tableName, 'Old;Table'); assert.equal(request.triggerName, 'Old;Trigger');
    assert.equal(request.body, "BEGIN PERFORM '$$ $monabase$'; RETURN NEW; END;");
    assert.ok(h.alerts.includes('an_error_occurred_please_check_the_console'));
    assert.equal(h.events.length, 0);
  } finally { h.unmount(); }
});
