// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { saveTrigger, replaceFunctionBody } = require('../electron/postgres/triggerDefinition');
const { createDdlEditor } = require('./helpers/ddlEditors.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { finiteNumericSqlLiteral } = loadTypeScript('src/shared/utils/numberValues.ts');
function metadata(overrides = {}) {
  return { trigger_oid: '42', trigger_name: 'Audit', schema_name: 'test', table_name: 'Demo', tgtype: 19,
    trigger_ddl: 'CREATE TRIGGER "Audit" BEFORE UPDATE OF "amount" ON "test"."Demo" FOR EACH ROW WHEN (NEW.amount > 0) EXECUTE FUNCTION "test"."ActualHandler"()',
    function_name: 'ActualHandler', function_schema: 'test', function_body: 'BEGIN RETURN NEW; END;',
    function_ddl: 'CREATE OR REPLACE FUNCTION "test"."ActualHandler"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $fn$BEGIN RETURN NEW; END;$fn$',
    function_users: '1', language: 'plpgsql', enabled: 'D', complex: true, relkind: 'r', ...overrides };
}
function request(row, changes = {}) {
  return { schema: row.schema_name, tableName: row.table_name, triggerName: row.trigger_name, isNew: false,
    body: row.function_body, timing: 'BEFORE', events: ['UPDATE'], forEachRow: true,
    expected: { triggerOid: row.trigger_oid, triggerDefinition: row.trigger_ddl, functionDefinition: row.function_ddl, enabled: row.enabled }, ...changes };
}
function connection(row) {
  const writes = [];
  return { writes, async query(sql) { if (typeof sql === 'string') return { rows: row ? [row] : [] }; writes.push(sql.text); return { rows: [] }; } };
}
test('Unchanged complex triggers issue no DDL and keep UPDATE OF, WHEN and disabled state intact', async () => {
  const row = metadata(), c = connection(row);
  await saveTrigger(c, request(row)); assert.deepEqual(c.writes, []);
});
test('Editing an unshared function body keeps its actual identity, security and settings without recreating the trigger', async () => {
  const row = metadata(), c = connection(row);
  await saveTrigger(c, request(row, { body: "BEGIN PERFORM '$fn$ $monabase$'; RETURN NEW; END;" }));
  assert.equal(c.writes.length, 1);
  assert.match(c.writes[0], /^CREATE OR REPLACE FUNCTION "test"."ActualHandler"/);
  assert.match(c.writes[0], /SECURITY DEFINER SET search_path TO pg_catalog/);
  assert.match(c.writes[0], /AS \$monabase_\$/);
});
test('New same-named triggers on separate tables use distinct functions and cannot replace an existing function', async () => {
  const c = connection(), row = metadata();
  for (const tableName of ['First', 'Second']) await saveTrigger(c, request(row, { isNew: true, tableName }));
  assert.equal(c.writes.length, 4); assert.match(c.writes[0], /^CREATE FUNCTION "test"."mb_trg_[a-f0-9]+"/);
  assert.notEqual(c.writes[0], c.writes[2]); assert.ok(c.writes.every(sql => !sql.includes('OR REPLACE')));
});
test('A shared function refuses body edits before any DDL but permits an unchanged save', async () => {
  const row = metadata({ function_users: '2' }), c = connection(row);
  await assert.rejects(saveTrigger(c, request(row, { body: 'BEGIN RETURN NULL; END;' })), /shared/);
  assert.deepEqual(c.writes, []); await saveTrigger(c, request(row)); assert.deepEqual(c.writes, []);
});
test('Complex setting changes, stale definitions and unsupported languages stop before writes', async () => {
  for (const [row, changes] of [
    [metadata(), { events: ['INSERT'] }], [metadata(), { expected: {} }],
    [metadata({ language: 'c' }), {}], [metadata(), { expected: { ...request(metadata()).expected, enabled: 'O' } }]
  ]) { const c = connection(row); await assert.rejects(saveTrigger(c, request(row, changes))); assert.deepEqual(c.writes, []); }
});
test('Simple setting changes preserve the real function identity and replica/disabled enable modes', async () => {
  for (const [enabled, sql] of [['D', 'DISABLE'], ['R', 'ENABLE REPLICA'], ['A', 'ENABLE ALWAYS'], ['O', 'ENABLE']]) {
    const row = metadata({ complex: false, enabled }), c = connection(row);
    await saveTrigger(c, request(row, { events: ['INSERT'] }));
    assert.equal(c.writes.length, 3); assert.match(c.writes[1], /EXECUTE FUNCTION "test"."ActualHandler"\(\)/);
    assert.equal(c.writes[2], `ALTER TABLE "test"."Demo" ${sql} TRIGGER "Audit"`);
  }
});
test('Function source replacement refuses an unsupported source rather than rewriting an arbitrary literal', () => {
  assert.throws(() => replaceFunctionBody('not a function', 'BEGIN END;'), /Unsupported/);
});
test('Finite trace numeric literals preserve exact integers, decimals and exponents and reject invalid inputs', () => {
  for (const input of ['9007199254740993', '-9007199254740993', '0.1234567890123456789', '.5', '1.234567890123456789e-20']) assert.equal(finiteNumericSqlLiteral(input), input);
  for (const input of ['', 'NaN', 'Infinity', '-Infinity', '0x10', '1; DROP TABLE demo', '1_000']) assert.throws(() => finiteNumericSqlLiteral(input));
});
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: the actual trigger trace handler generates exact numeric values and refuses invalid input`, async () => {
    const calls = [], columnType = db === 'oracle' ? 'NUMBER' : 'numeric';
    const h = await createDdlEditor('trigger', db, async (...args) => {
      calls.push(args);
      if (args[0] === 'execute-trace') return { success: false, errorCode: 'TRACE_MAIN_CONNECTION_BUSY', error: 'Stopped before trace execution' };
      if (/AS "COLUMN_NAME"|SELECT c.COLUMN_NAME/.test(args[1])) return { success: true, rows: ['ExactInt', 'ExactDecimal'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: columnType, NULLABLE: 'Y' })) };
      return { success: true, rows: [] };
    });
    try {
      await h.render().handleTraceExecuteClick(); await h.flush();
      h.render().setTraceInputData({ ExactInt: '9007199254740993', ExactDecimal: '0.1234567890123456789' }); await h.flush();
      calls.length = 0; await h.render().handleStartTrace();
      const trace = calls.find(call => call[0] === 'execute-trace'); assert.ok(trace);
      assert.match(trace[1].sourceText, /9007199254740993/); assert.match(trace[1].sourceText, /0\.1234567890123456789/);
      assert.doesNotMatch(trace[1].sourceText, /9007199254740992/);
      for (const value of ['Infinity', '0x10', 'NaN', '1; DROP TABLE demo']) {
        h.render().setTraceInputData({ ExactInt: value }); await h.flush(); calls.length = 0;
        await h.render().handleStartTrace(); assert.equal(calls.some(call => call[0] === 'execute-trace'), false);
      }
    } finally { h.unmount(); }
  });
}
test('Existing trigger metadata uses catalog flags instead of words inside identifiers or conditions', async () => {
  const row = metadata({ trigger_ddl: 'CREATE TRIGGER "AFTER_DELETE" BEFORE UPDATE ON test."INSERT" FOR EACH ROW EXECUTE FUNCTION test.handler()', tgtype: 19 });
  const h = await createDdlEditor('trigger', 'postgresql', async channel => channel === 'get-postgres-trigger' ? { success: true, trigger: row } : { success: true, rows: [] }, { isNew: false });
  try { assert.equal(h.render().wizTiming, 'BEFORE'); assert.deepEqual(Array.from(h.render().wizEvents), ['UPDATE']); assert.equal(h.render().wizBody, row.function_body); }
  finally { h.unmount(); }
});
