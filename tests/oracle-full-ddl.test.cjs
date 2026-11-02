// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const ddlModule = loadTypeScript('src/features/oracle/windows/common/loadOracleDdl.ts');
const { getFullTableDDL } = loadTypeScript('src/features/oracle/windows/common/ddlHelper.ts', { './loadOracleDdl': ddlModule });

test('Oracle definitions preserve long Unicode CLOB results and bind quoted names', async () => {
  const source = `CREATE VIEW "注文" AS SELECT '${'長い定義'.repeat(3000)}' AS value FROM dual`;
  const client = { invoke: async (channel, sql, binds) => {
    assert.equal(channel, 'execute-sql-bg');
    assert.ok(!sql.includes('SUBSTR'));
    assert.deepEqual(JSON.parse(JSON.stringify(binds)), { ddlType: 'VIEW', name: "O'rders", owner: 'Mixed"Schema' });
    return { success: true, rows: [{ DDL: source }] };
  } };
  assert.equal(await ddlModule.loadOracleDdl(client, 'VIEW', "O'rders", 'Mixed"Schema'), source);
});

test('Full table definitions include complete indexes and triggers and escape comment identifiers', async () => {
  const marker = 'x'.repeat(9000);
  const client = { invoke: async (channel, sql, binds) => {
    if (binds.ddlType) return { success: true, rows: [{ DDL: `${binds.ddlType} ${marker} END` }] };
    if (sql.includes('ALL_TAB_COMMENTS')) return { success: true, rows: [{ COMMENTS: "owner's note" }] };
    if (sql.includes('ALL_COL_COMMENTS')) return { success: true, rows: [{ COLUMN_NAME: 'a"b', COMMENTS: 'note' }] };
    if (sql.includes('ALL_INDEXES')) return { success: true, rows: [{ OWNER: 's"x', INDEX_NAME: 'idx' }] };
    return { success: true, rows: [{ OWNER: 's"x', TRIGGER_NAME: 'trg' }] };
  } };
  const result = await getFullTableDDL(client, 's"x', 't"x', key => key);
  for (const type of ['TABLE', 'INDEX', 'TRIGGER']) assert.ok(result.includes(`${type} ${marker} END`));
  assert.ok(result.includes('"s""x"."t""x"."a""b"'));
  assert.ok(result.includes("owner''s note"));
});

test('DDL retrieval failures never return a partial source as a successful definition', async () => {
  await assert.rejects(ddlModule.loadOracleDdl({ invoke: async () => ({ success: true, rows: [] }) }, 'VIEW', 'v', 's'), /empty DDL/);
  await assert.rejects(getFullTableDDL({ invoke: async () => ({ success: false, error: 'permission denied' }) }, 's', 't', key => key), /permission denied/);
});

test('Oracle table DDL uses each index and trigger owner instead of the table owner', async () => {
  const calls = [];
  const client = { invoke: async (_channel, sql, binds) => {
    if (binds.ddlType) {
      calls.push([binds.ddlType, binds.owner, binds.name]);
      return { success: true, rows: [{ DDL: `CREATE ${binds.ddlType} "${binds.owner}"."${binds.name}"` }] };
    }
    if (/FROM ALL_INDEXES|FROM ALL_TRIGGERS/.test(sql)) {
      assert.match(sql, /SELECT OWNER,/);
      assert.match(sql, /TABLE_OWNER = :owner/);
      const key = sql.includes('ALL_INDEXES') ? 'INDEX_NAME' : 'TRIGGER_NAME';
      return { success: true, rows: ['Owner A', 'Owner B'].map(OWNER => ({ OWNER, [key]: 'Same Name' })) };
    }
    return { success: true, rows: [] };
  } };
  const result = await getFullTableDDL(client, 'Table Owner', 'Table', key => key);
  assert.deepEqual(calls, [['TABLE', 'Table Owner', 'Table'], ['INDEX', 'Owner A', 'Same Name'], ['INDEX', 'Owner B', 'Same Name'], ['TRIGGER', 'Owner A', 'Same Name'], ['TRIGGER', 'Owner B', 'Same Name']]);
  assert.ok(result.includes('INDEX "Owner B"."Same Name"'));
  assert.ok(result.includes('TRIGGER "Owner A"."Same Name"'));
});
