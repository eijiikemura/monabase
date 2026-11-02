// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRelationHarness } = require('./helpers/relationData.cjs');

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: relationships keep ordered column pairs and bind exact object names`, async () => {
    const calls = [];
    const h = await createRelationHarness(db, async (...args) => {
      calls.push(args);
      return { success: true, rows: ['x', 'y'].map((SOURCE_COLUMN, i) => ({ CONSTRAINT_NAME: 'constructor', SOURCE_COLUMN, TARGET_COLUMN: ['b', 'a'][i], TARGET_TABLE: 'Parent', DELETE_RULE: 'CASCADE' })) };
    }, { schema: "Team's Data", tableName: 'Child"Mix' });
    try {
      const row = h.state.relationsRows[0];
      assert.equal(row.SOURCE_COLUMNS, 'x, y'); assert.equal(row.TARGET_COLUMNS, 'b, a'); assert.equal(row.DELETE_RULE, 'CASCADE');
      assert.equal(calls.length, 1); assert.equal(calls[0][0], 'execute-sql-bg');
      assert.equal(calls[0][2].schema, "Team's Data"); assert.equal(calls[0][2].tableName, 'Child"Mix');
      assert.ok(!calls[0][1].includes("Team's Data")); assert.ok(!calls[0][1].includes('Child"Mix'));
      if (db === 'postgresql') {
        assert.match(calls[0][1], /child\.oid = fk\.conrelid/);
        assert.match(calls[0][1], /fk\.confkey\[key_position\.ordinal\]/);
        assert.match(calls[0][1], /ORDER BY fk\.oid, key_position\.ordinal/);
      }
    } finally { h.unmount(); }
  });
  test(`${db}: relation choices preserve case and quotes and failed lookups clear old choices`, async () => {
    const calls = []; let fail = false;
    const h = await createRelationHarness(db, async (...args) => {
      calls.push(args);
      return fail ? { success: false, error: 'Column lookup failed' } : { success: true, rows: [{ COLUMN_NAME: 'Key Value', column_name: 'Key Value' }] };
    }, { isActive: false, schema: "Team's Data" });
    try {
      await h.state.handleTargetTableChange('Parent\'s"Mix'); await h.flush();
      assert.equal(calls[0][2].tableName, 'Parent\'s"Mix');
      assert.equal(calls[0][2].schema, "Team's Data");
      assert.ok(!calls[0][1].includes('Parent')); assert.deepEqual(Array.from(h.state.targetTableCols), ['Key Value']);
      fail = true; await h.state.handleTargetTableChange('Another'); await h.flush();
      assert.equal(h.state.targetTableCols.length, 0); assert.equal(h.state.targetColumns.length, 0);
      assert.equal(h.alerts.length, 1); assert.match(h.alerts[0], /Column lookup failed/); assert.equal(h.state.isDialogLoading, false);
    } finally { h.unmount(); }
  });
  test(`${db}: relation creation and deletion quote table, column and constraint identifiers`, async () => {
    const calls = [];
    const h = await createRelationHarness(db, async (...args) => { calls.push(args); return { success: true, rows: [] }; }, { isActive: false, schema: "Team's Data", tableName: 'Child"Mix' });
    try {
      h.state.setFkName('Mixed "FK'); h.state.setSourceColumns(['Key "Value']); h.state.setTargetColumns(['Ref "ID']); h.state.setTargetTable('Parent"Mix'); await h.flush();
      await h.state.submitRelation(); await h.flush();
      const added = calls.find(call => call[0] === 'execute-sql')[1];
      assert.equal(added, 'ALTER TABLE "Team\'s Data"."Child""Mix" ADD CONSTRAINT "Mixed ""FK" FOREIGN KEY ("Key ""Value") REFERENCES "Team\'s Data"."Parent""Mix" ("Ref ""ID")');
      await h.state.handleDropRelation('Mixed "FK');
      assert.equal(calls.filter(call => call[0] === 'execute-sql').at(-1)[1], 'ALTER TABLE "Team\'s Data"."Child""Mix" DROP CONSTRAINT "Mixed ""FK"');
    } finally { h.unmount(); }
  });
  test(`${db}: late relation choices cannot replace a newer target or keep an empty target loading`, async () => {
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const h = await createRelationHarness(db, async (_channel, _sql, binds) => binds.tableName === 'Old' ? delayed : { success: true, rows: [{ COLUMN_NAME: 'new', column_name: 'new' }] }, { isActive: false });
    try {
      const old = h.state.handleTargetTableChange('Old'); await h.flush();
      await h.state.handleTargetTableChange('New'); await h.flush();
      release({ success: true, rows: [{ COLUMN_NAME: 'old', column_name: 'old' }] }); await old; await h.flush();
      assert.deepEqual(Array.from(h.state.targetTableCols), ['new']);
      await h.state.handleTargetTableChange(''); await h.flush();
      assert.equal(h.state.targetTableCols.length, 0); assert.equal(h.state.isDialogLoading, false);
    } finally { release({ success: true, rows: [] }); h.unmount(); }
  });
}
