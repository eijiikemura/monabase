// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDdlEditor } = require('./helpers/ddlEditors.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

function boundary(db) {
  const calls = [], state = { fail: false, columnFail: false, references: 0, constraint: false,
    ddl: db === 'postgresql' ? 'CREATE INDEX "Ix.Case" ON "A"."T" USING btree (lower("Text") DESC) INCLUDE ("Payload") WHERE "Active" = true' : 'CREATE INDEX "A"."Ix.Case" ON "A"."T" (LOWER("Text") DESC) TABLESPACE "USERS"' };
  return { calls, state, invoke: async (...args) => {
    calls.push(args); const [channel, sql] = args;
    if (channel === 'get-columns') return state.columnFail ? { success: false, error: 'Denied' } : { success: true, columns: ['A', 'B', 'C'] };
    if (channel === 'execute-sql') return { success: true };
    if (channel !== 'execute-sql-bg') return { success: true };
    if (state.fail) return { success: false, error: 'Denied' };
    let rows = [];
    if (/pg_get_indexdef\(i.indexrelid\) AS ddl/.test(sql)) rows = [{ table_schema: 'A', table_name: 'T', ddl: state.ddl, expression: 'lower("Text")', indisunique: true }];
    else if (/generate_series/.test(sql)) rows = [{ column_name: null, key_expression: 'lower("Text") DESC' }];
    else if (/FROM pg_constraint con/.test(sql)) rows = state.constraint ? [{ constraint_name: 'Actual"PK', kind: 'p', references: state.references }] : [];
    else if (/SELECT TABLE_OWNER/.test(sql)) rows = [{ TABLE_OWNER: 'A', TABLE_NAME: 'T', INDEX_TYPE: 'FUNCTION-BASED NORMAL', UNIQUENESS: 'UNIQUE', VISIBILITY: 'VISIBLE' }];
    else if (/GET_DDL/.test(sql)) rows = [{ DDL: state.ddl }];
    else if (/ALL_IND_COLUMNS/.test(sql)) rows = [{ COLUMN_NAME: 'SYS_NC0001' }];
    else if (/ALL_IND_EXPRESSIONS/.test(sql)) rows = [{ COLUMN_EXPRESSION: 'LOWER("Text")' }];
    else if (/FROM ALL_CONSTRAINTS c/.test(sql)) rows = state.constraint ? [{ CONSTRAINT_NAME: 'Actual"PK', CONSTRAINT_TYPE: 'P', OWNER: 'A', TABLE_NAME: 'T', REFERENCE_COUNT: state.references }] : [];
    else rows = db === 'oracle' ? [{ BLEVEL: 1 }] : [{ idx_scan: 2 }];
    return { success: true, rows };
  } };
}
for (const db of ['oracle', 'postgresql']) {
  const props = { isNew: false, schema: 'A', indexName: 'Ix.Case', initialTable: 'T' };
  test(`${db}: existing source retains native clauses and all metadata requests bind exact names`, async () => {
    const b = boundary(db), h = await createDdlEditor('index', db, b.invoke, props);
    try {
      assert.equal(h.render().canExecute, true); assert.equal(h.render().sourceSql, b.state.ddl);
      h.render().updateFormField('indexName', 'Renamed'); await h.flush(); assert.equal(h.render().sourceSql, b.state.ddl);
      assert.ok(b.calls.every(([channel]) => channel === 'execute-sql-bg'));
      for (const call of b.calls) { assert.equal(call[2].schema, 'A'); assert.equal(call[2].name, 'Ix.Case'); }
    } finally { h.unmount(); }
  });
  test(`${db}: initial failure blocks actions and explicit retry loads a complete definition`, async () => {
    const b = boundary(db); b.state.fail = true;
    const h = await createDdlEditor('index', db, b.invoke, props);
    try {
      assert.equal(h.render().loadError, true); assert.equal(h.render().canExecute, false);
      await h.render().handleExecute(); await h.render().handleDelete(); assert.ok(!b.calls.some(([channel]) => channel === 'execute-sql'));
      b.state.fail = false; h.render().retryLoad(); await h.flush();
      assert.equal(h.render().loadError, false); assert.equal(h.render().canExecute, true);
    } finally { h.unmount(); }
  });
  test(`${db}: refresh failure retains native source and retry unlocks actions`, async () => {
    const b = boundary(db), h = await createDdlEditor('index', db, b.invoke, props);
    try {
      b.state.fail = true; h.render().retryLoad(); await h.flush();
      assert.equal(h.render().sourceSql, b.state.ddl); assert.equal(h.render().canExecute, false);
      b.state.fail = false; h.render().retryLoad(); await h.flush(); assert.equal(h.render().canExecute, true);
    } finally { h.unmount(); }
  });
  test(`${db}: changing tables clears old columns and column failure cannot execute stale configuration`, async () => {
    const b = boundary(db), h = await createDdlEditor('index', db, b.invoke, { ...props, isNew: true });
    try {
      h.render().handleLeftDoubleClick('A'); await h.flush(); assert.deepEqual(Array.from(h.render().selectedColumns), ['A']);
      h.render().updateFormField('targetTable', 'T'); await h.flush(); assert.deepEqual(Array.from(h.render().selectedColumns), ['A']);
      b.state.columnFail = true; h.render().updateFormField('targetTable', 'Another'); await h.flush();
      assert.equal(h.render().selectedColumns.length, 0); assert.equal(h.render().tableColumns.length, 0);
      await h.render().handleExecute(); assert.ok(!b.calls.some(([channel]) => channel === 'execute-sql'));
      b.state.columnFail = false; h.render().retryLoad(); await h.flush(); assert.equal(h.render().canExecute, true);
      assert.ok(!b.calls.some(([channel]) => channel === 'get-objects'));
    } finally { h.unmount(); }
  });
  test(`${db}: column selection remains unique and reordering changes generated SQL in the same order`, async () => {
    const b = boundary(db), h = await createDdlEditor('index', db, b.invoke, { ...props, isNew: true });
    try {
      for (const column of ['A', 'B', 'C']) { h.render().handleLeftDoubleClick(column); await h.flush(); }
      h.render().handleLeftDoubleClick('A'); await h.flush(); assert.equal(h.render().selectedColumns.length, 3);
      h.render().handleRightMouseDown({ ctrlKey: false, metaKey: false, shiftKey: false, detail: 0 }, 'C'); await h.flush();
      h.render().moveColumn(-1); await h.flush(); assert.deepEqual(Array.from(h.render().selectedColumns), ['A', 'C', 'B']);
      assert.ok(h.render().createSql.indexOf('"C"') < h.render().createSql.indexOf('"B"'));
      h.render().moveColumn(1); await h.flush(); assert.deepEqual(Array.from(h.render().selectedColumns), ['A', 'B', 'C']);
    } finally { h.unmount(); }
  });
  test(`${db}: deletion checks fresh dependencies and uses the actual constraint identity or refuses the operation`, async () => {
    const b = boundary(db); b.state.constraint = true;
    const h = await createDdlEditor('index', db, b.invoke, props); let confirms = 0;
    h.setConfirm(() => { confirms++; return true; });
    try {
      b.calls.length = 0; await h.render().handleDelete(); await h.flush();
      const writes = b.calls.filter(([channel]) => channel === 'execute-sql');
      if (db === 'oracle') { assert.equal(writes.length, 0); assert.equal(confirms, 0); assert.ok(h.alerts.includes('index_oracle_constraint_blocked')); }
      else { assert.equal(writes.length, 1); assert.equal(writes[0][1], 'ALTER TABLE "A"."T" DROP CONSTRAINT "Actual""PK"'); assert.equal(confirms, 1); }
    } finally { h.unmount(); }
  });
  test(`${db}: changed DDL and referenced constraints never reach a DROP`, async () => {
    const b = boundary(db), h = await createDdlEditor('index', db, b.invoke, props); h.setConfirm(() => true);
    try {
      b.state.ddl += ' /* changed */'; await h.render().handleDelete(); await h.flush();
      assert.equal(h.render().loadError, true); assert.ok(!b.calls.some(([channel]) => channel === 'execute-sql'));
      b.state.constraint = true; b.state.references = 1; h.render().retryLoad(); await h.flush();
      await h.render().handleDelete(); assert.ok(!b.calls.some(([channel]) => channel === 'execute-sql'));
    } finally { h.unmount(); }
  });
}

test('Unknown reference counts fail closed instead of authorizing constraint deletion', () => {
  const { indexDropPlan } = loadTypeScript('src/features/index/indexMetadata.ts', { '@/shared/api/desktop': { ipcRenderer: {} } });
  assert.throws(() => indexDropPlan('postgresql', 'A', 'I', { constraints: [{ name: 'C', schema: 'A', table: 'T', references: NaN }] }), /incomplete/);
});
