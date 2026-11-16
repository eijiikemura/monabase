// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const model = loadTypeScript('src/features/mysql/table/tableModel.ts');
const ddl = loadTypeScript('src/features/mysql/table/tableDdl.ts', { './tableModel': model });
const column = (name, type = 'varchar', extra = {}) => ({ COLUMN_NAME: name, DATA_TYPE: type, COLUMN_TYPE: type, IS_NULLABLE: 'YES', EXTRA: '', GENERATION_EXPRESSION: '', PK_POSITION: 0, ...extra });
const columns = [column('id', 'bigint', { PK_POSITION: 1, IS_NULLABLE: 'NO' }), column('label'), column('amount', 'decimal'), column('computed', 'int', { EXTRA: 'STORED GENERATED', GENERATION_EXPRESSION: '1+1' }), column('payload', 'json'), column('bytes', 'varbinary')];
const meta = { table: { ENGINE: 'InnoDB', TABLE_TYPE: 'BASE TABLE' }, columns };
const row = { id: '18446744073709551615', label: 'A', amount: '1.000000000000000001', computed: 2, payload: '{"a": 1}', bytes: '00ff' };
const input = action => ({ action, name: 'new_name', value: '', type: 'VARCHAR(40)', nullable: true, unique: false, columns: ['label'], targetSchema: 'demo', targetTable: 'parent', targetColumns: ['id'], deleteRule: 'RESTRICT', updateRule: 'CASCADE' });

test('MySQL table queries bind literal filters, retain exact numbers and quote every identifier', () => {
  const conditions = model.defaultConditions(columns);
  conditions.label.value = "50%_!' OR 1=1"; conditions.label.operator = 'LIKE'; conditions.label.sort = '2 DESC';
  conditions.amount.value = '12345678901234567890.000000000000000001'; conditions.amount.sort = '1';
  const result = model.tableQuery('str`ange', 'a.b', columns, conditions, 2, 100);
  assert.match(result.sql, /`str``ange`\.`a.b`/); assert.match(result.sql, /LIMIT 100 OFFSET 200/);
  assert.match(result.sql, /ORDER BY `amount` ASC, `label` DESC, `id`/);
  assert.equal(result.binds.f0, "%50!%!_!!' OR 1=1%"); assert.equal(result.binds.f1, conditions.amount.value);
  assert.ok(!result.sql.includes('OR 1=1'));
  assert.throws(() => model.tableQuery('demo', 't', columns, conditions, -1, 100));
  conditions.amount.sort = '1; DROP TABLE x'; assert.throws(() => model.tableQuery('demo', 't', columns, conditions, 0, 100));
});
test('MySQL table count uses the same applied filters without pagination or sorting', () => {
  const conditions = model.defaultConditions(columns); conditions.label.value = 'zero';
  const result = model.tableQuery('demo', 't', columns, conditions, 0, 100, true);
  assert.match(result.sql, /^SELECT COUNT\(\*\) AS total/); assert.ok(!/LIMIT|ORDER BY/.test(result.sql)); assert.equal(result.binds.f0, 'zero');
});
test('MySQL single-row writes use original PK and byte-exact complete row images, never a grid ID', () => {
  const result = model.updateStatement('demo', 't', meta, row, { label: "';DELETE FROM t;--" });
  assert.match(result.sql, /`id` <=> :pk0/); assert.match(result.sql, /CAST\(`label` AS BINARY\)/); assert.match(result.sql, /LIMIT 1$/);
  assert.equal(result.binds.pk0, row.id); assert.equal(result.binds.old2, row.amount); assert.equal(result.binds.v0, "';DELETE FROM t;--");
  assert.match(result.sql, /`bytes` <=> UNHEX\(:old5\)/);
  const deleted = model.deleteStatement('demo', 't', meta, row); assert.match(deleted.sql, /^DELETE/); assert.equal(deleted.binds.pk0, row.id);
  assert.throws(() => model.updateStatement('demo', 't', meta, row, { id: '2' }), /cannot be edited/);
  assert.throws(() => model.updateStatement('demo', 't', meta, row, { computed: 4 }), /cannot be edited/);
  assert.throws(() => model.deleteStatement('demo', 't', meta, { id: row.id }), /incomplete/);
});
test('MySQL mutations refuse missing PKs, nontransactional engines, unknown columns and unsupported images', () => {
  assert.equal(model.canEditTable(meta), true);
  for (const invalid of [{ ...meta, columns: [column('label')] }, { ...meta, table: { ENGINE: 'MyISAM', TABLE_TYPE: 'BASE TABLE' } }, { ...meta, table: { ENGINE: null, TABLE_TYPE: 'VIEW' } }]) assert.throws(() => model.deleteStatement('demo', 't', invalid, row), /InnoDB/);
  assert.throws(() => model.updateStatement('demo', 't', meta, row, { missing: 'value' }));
  assert.throws(() => model.deleteStatement('demo', 't', { ...meta, columns: [...columns, column('shape', 'geometry')] }, { ...row, shape: '00' }), /safely/);
});
test('MySQL inserts distinguish DEFAULT, empty text, NULL, hexadecimal bytes and exact decimals', () => {
  const result = model.insertStatement('demo', 't', meta, { id: { mode: 'value', value: row.id }, label: { mode: 'value', value: '' }, amount: { mode: 'value', value: row.amount }, payload: { mode: 'null', value: '' }, bytes: { mode: 'value', value: '00ff' } });
  assert.equal(result.binds.v0, row.id); assert.equal(result.binds.v1, ''); assert.equal(result.binds.v2, row.amount); assert.equal(result.binds.v3, null); assert.match(result.sql, /UNHEX\(:v4\)/);
  assert.match(model.insertStatement('demo', 't', meta, {}).sql, /\(\) VALUES \(\)$/);
  assert.throws(() => model.insertStatement('demo', 't', meta, { id: { mode: 'null' } }), /NULL/);
  assert.throws(() => model.insertStatement('demo', 't', meta, { payload: { mode: 'value', value: '{bad}' } }));
  assert.throws(() => model.insertStatement('demo', 't', meta, { bytes: { mode: 'value', value: 'fff' } }), /hexadecimal/);
  assert.throws(() => model.insertStatement('demo', 't', meta, { computed: { mode: 'value', value: '3' } }), /inserted/);
});
test('MySQL structural builders preserve identifiers and literals and restrict interpolated column types', () => {
  const comment = ddl.buildTableDdl('demo', 'x`y', { ...input('comment'), value: "it's a comment" });
  assert.equal(comment.sql, 'ALTER TABLE `demo`.`x``y` COMMENT = :comment'); assert.equal(comment.binds.comment, "it's a comment");
  assert.match(ddl.buildTableDdl('demo', 't', input('add-column')).sql, /ADD COLUMN `new_name` VARCHAR\(40\) NULL/);
  assert.throws(() => ddl.buildTableDdl('demo', 't', { ...input('add-column'), type: 'INT; DROP TABLE x' }));
  assert.match(ddl.buildTableDdl('demo', 't', { ...input('add-index'), unique: true, columns: ['id', 'label'] }).sql, /UNIQUE INDEX.*\(`id`, `label`\)/);
  assert.throws(() => ddl.buildTableDdl('demo', 't', { ...input('drop-index'), name: 'PRIMARY' }));
  assert.throws(() => ddl.buildTableDdl('demo', 't', { ...input('add-index'), columns: ['id', 'id'] }));
  assert.throws(() => ddl.buildTableDdl('demo', 't', { ...input('add-relation'), targetColumns: [] }));
  assert.match(ddl.buildTableDdl('demo', 't', input('add-relation')).sql, /ON DELETE RESTRICT ON UPDATE CASCADE$/);
});

test('MySQL DDL dialog requires preview and exact table name, and cannot resend an attempted request', async () => {
  const { componentHarness } = require('./helpers/componentHarness.cjs');
  const requested = [];
  const f = componentHarness('src/features/mysql/table/TableDdlDialog.tsx', { schema: 'demo', table: 'ExactTable', metadata: meta, initial: input('drop-table'), busy: false, failureMessage: '', onExecute: async statement => { requested.push(statement); return false; }, onClose() {} }, { dependencies: { './tableModel':model,'./tableDdl': ddl, './tableRepository': {} } });
  assert.equal(f.button('execute').props.disabled, true);
  await f.click('preview'); assert.equal(f.button('execute').props.disabled, true);
  const confirmation = f.node('TextField', node => node.props.label === 'mysql_table_confirm_name');
  confirmation.props.onChange({ target: { value: 'exacttable' } }); f.render(); assert.equal(f.button('execute').props.disabled, true);
  confirmation.props.onChange({ target: { value: 'ExactTable' } }); f.render();
  const execute = f.button('execute'); assert.equal(execute.props.disabled, false);
  execute.props.onClick(); execute.props.onClick(); await f.flush();
  assert.equal(requested.length, 1); assert.match(requested[0].sql, /^DROP TABLE `demo`\.`ExactTable`$/); assert.equal(f.button('execute').props.disabled, true);
  f.unmount();
});
