// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { indexModules, mysqlIndex } = require('./helpers/mysqlIndex.cjs');
const { componentHarness: render } = require('./helpers/componentHarness.cjs');
const { model } = indexModules(async () => { throw new Error('Unexpected SQL.'); });
const column = name => ({ COLUMN_NAME: name, DATA_TYPE: 'varchar', COLUMN_TYPE: 'varchar(100)' });
const part = (column, extra = {}) => ({ column, expression: '', prefix: '', descending: false, ...extra });

test('MySQL index builders quote identifiers and preserve composite order, prefix, direction and expression semantics', () => {
  const form = { ...model.blankIndexForm('a.b'), table: 't`b', name: 'i`x', unique: true, visible: false, parts: [part('label', { prefix: '10', descending: true }), part('', { expression: 'LOWER(`email`)' })] };
  assert.equal(model.createIndexStatement(form, [column('label')]).sql, 'CREATE UNIQUE INDEX `i``x` ON `a.b`.`t``b` (`label`(10) DESC, (LOWER(`email`))) INVISIBLE');
  for (const parts of [[part('missing')], [part('label'), part('label')], [part('', { expression: 'LOWER(label)); DROP TABLE t' })], [part('', { expression: 'LOWER(label) /* comment */' })], [part('', { expression: 'LOWER(label))' })], [part('label', { prefix: '-1' })]]) assert.throws(() => model.createIndexStatement({ ...form, parts }, [column('label')]));
  assert.throws(() => model.createIndexStatement({ ...form, name: 'PRIMARY' }, [column('label')]));
  assert.throws(() => model.createIndexStatement({ ...form, type: 'SPATIAL' }, [column('label')]));
  assert.equal(model.changeIndexStatement('s', 't', 'old', 'new', true, true).sql, 'ALTER TABLE `s`.`t` RENAME INDEX `old` TO `new`');
  assert.equal(model.changeIndexStatement('s', 't', 'old', 'old', false, true).sql, 'ALTER TABLE `s`.`t` ALTER INDEX `old` INVISIBLE');
  assert.throws(() => model.changeIndexStatement('s', 't', 'old', 'new', false, true), /separately/);
  assert.throws(() => model.changeIndexStatement('s', 't', 'PRIMARY', 'p', true, true));
  assert.throws(() => model.changeIndexStatement('s', 't', 'i', 'i', true, true));
});

test('MySQL source extraction keeps functional expressions, comments and invisible/native parser options without including another index', () => {
  const ddl = "CREATE TABLE `t` (`id` int, `x` varchar(40) COMMENT 'a,b)', KEY `same` (`x`(4) DESC) COMMENT 'x,y', KEY `functional` ((lower(concat(`x`,_utf8mb4',')))) /*!80000 INVISIBLE */, PRIMARY KEY (`id`)) ENGINE=InnoDB";
  assert.equal(model.indexDefinition(ddl, 'same'), "KEY `same` (`x`(4) DESC) COMMENT 'x,y'");
  assert.equal(model.indexDefinition(ddl, 'functional'), "KEY `functional` ((lower(concat(`x`,_utf8mb4',')))) /*!80000 INVISIBLE */");
  assert.equal(model.indexDefinition(ddl, 'PRIMARY'), 'PRIMARY KEY (`id`)');
  assert.throws(() => model.indexDefinition(ddl, 'absent'));
  assert.throws(() => model.tableDefinitionParts('CREATE TABLE t (x INT'));
});

test('MySQL index listing uses table-scoped identity and bound search/offset with exact database filtering', async () => {
  const calls = [];
  const objects = loadTypeScript('src/features/objects/mysqlObjects.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { calls.push(args); return { success: true, rows: [{ name: 'PRIMARY', parentName: 'one' }, { name: 'PRIMARY', parentName: 'two' }] }; } } } });
  const rows = await objects.listMysqlObjects('a.b', 'INDEX', 'x%_', 100);
  assert.notEqual(rows[0].key, rows[1].key); assert.equal(rows[1].displayName, 'PRIMARY (two)');
  assert.equal(calls[0][0], 'execute-sql-bg'); assert.equal(calls[0][2].pattern, '%x!%!_%'); assert.equal(calls[0][2].offset, 100); assert.match(calls[0][1], /GROUP BY/);
  await assert.rejects(() => objects.listMysqlObjects('a.b', 'INDEX', '', -1));
  const { repository } = indexModules(async () => { throw new Error('No request without table identity.'); });
  await assert.rejects(() => repository.loadMysqlIndex({ ...rows[0], parentName: undefined }), /exact/);
});

test('MySQL index creation preview does not execute SQL and failures never auto-retry; native transaction state reaches the toolbar', async () => {
  let executions = 0;
  const f = await mysqlIndex(async (channel, sql) => {
    if (channel === 'execute-sql') { executions++; return { success: false, error: 'native DDL denied', transactionStatus: 'idle', hasUncommittedTx: false }; }
    return { success: true, rows: /FROM information_schema.TABLES /.test(sql) ? [{ TABLE_NAME: 't', ENGINE: 'InnoDB', TABLE_TYPE: 'BASE TABLE' }] : /FROM information_schema.COLUMNS c/.test(sql) ? [column('label')] : [] };
  });
  f.state.prepare(); await f.flush(); assert.equal(f.state.review, undefined); assert.equal(executions, 0);
  f.state.update({ table: 't', name: 'idx' }); await f.waitFor(s => !s.loading && s.columns.length);
  f.state.update({ parts: [part('label')] }); await f.flush(); f.state.prepare(); await f.flush();
  assert.ok(f.state.review); assert.equal(executions, 0); assert.equal(f.states.length, 0);
  await f.state.execute(); await f.flush(); assert.equal(executions, 1); assert.equal(f.state.attempted, true); assert.equal(f.state.error, 'native DDL denied'); assert.equal(f.states[0].hasUncommittedTx, false);
  await f.state.execute(); await f.flush(); assert.equal(executions, 1);
  f.state.closeReview(); await f.flush(); f.props.readonly = true; await f.flush(); f.state.prepare(); await f.flush(); assert.equal(f.state.review, undefined); f.unmount();
});

test('MySQL index category follows Oracle selection, double-click opening, filtering, pagination and read-only guards', () => {
  const object = { key: 'exact', category: 'INDEX', name: 'shared', parentName: 'orders', displayName: 'shared (orders)', schema: 'demo' }, calls = [];
  const indexes = { expanded: ['demo'], pages: { demo: { rows: [object], filter: '', applied: '', more: true, loading: false } }, toggle: value => calls.push(['toggle', value]), filter: (...args) => calls.push(['filter', ...args]), refresh() {}, retry() {}, more: value => calls.push(['more', value]) };
  const f = render('src/features/mysql/index/IndexSidebarCategory.tsx', { indexes, schema: 'demo', busy: false, readonly: false, canOpen: true, selected: '', onSelect: value => calls.push(['select', value]), onOpen: value => calls.push(['open', value]), onCreate: value => calls.push(['create', value]) });
  const row = f.node('ListItemButton', node => node.props['data-sidebar-object']); row.props.onClick(); assert.deepEqual(calls.pop(), ['select', 'exact']); row.props.onDoubleClick(); assert.deepEqual(calls.pop(), ['open', object]);
  f.node('TextField').props.onChange({ target: { value: 'order' } }); assert.deepEqual(calls.pop(), ['filter', 'demo', 'order']);
  f.button('create_index_index').props.onClick(); assert.deepEqual(calls.pop(), ['create', 'demo']);
  f.node('ListItemButton', node => node.children.some(child => child?.props?.primary === 'show_100_more')).props.onClick(); assert.deepEqual(calls.pop(), ['more', 'demo']);
  f.props.readonly = true; f.render(); assert.equal(f.button('create_index_index').props.disabled, true);
  f.props.busy = true; f.render(); f.node('ListItemButton', node => node.props['data-sidebar-object']).props.onDoubleClick(); assert.equal(calls.length, 0); f.unmount();
});

test('MySQL index window exposes edit/statistics/source, ordered columns, reviewed deletion and native dependency guards', async () => {
  const form = { ...model.blankIndexForm('demo'), table: 'orders', name: 'shared', parts: [part('label')] }, calls = [];
  const c = { form, columns: [column('label')], details: { ddl: 'ALTER TABLE `demo`.`orders` ADD KEY `shared` (`label`);', visible: true, unique: false, primary: false, references: [], keys: [{ SEQ_IN_INDEX: 1, COLUMN_NAME: 'label', CARDINALITY: '42' }] }, blocked: false, loading: false, error: '', logs: [], attempted: false, prepare: drop => calls.push(['prepare', drop]), update: value => calls.push(['update', value]), load: async () => calls.push('reload'), clearLogs() {}, closeReview() {}, execute: async () => calls.push('execute') };
  const object = { key: 'orders-shared', schema: 'demo', category: 'INDEX', parentName: 'orders', name: 'shared' };
  const props = { schema: 'demo', object, active: true, busy: false, readonly: false, theme: 'light' };
  const f = render('src/features/mysql/index/IndexWindow.tsx', props, { dependencies: {
    './useMysqlIndex': { useMysqlIndex: () => c }, './indexModel': model,
    '@/features/index/IndexTablePicker': { IndexTablePicker: 'TablePicker' }, '@/features/index/IndexColumnOrder': { IndexColumnOrder: 'ColumnOrder' },
    '@/features/data-grid/GridViewport': { GridViewport: 'GridViewport' }, '@/components/navigation/WorkspaceDivider': 'WorkspaceDivider',
    '@mui/x-data-grid': { DataGrid: 'DataGrid', enUS: { components: { MuiDataGrid: { defaultProps: { localeText: {} } } } } },
    '@codemirror/lang-sql': { sql: () => 'mysql-sql-extension', MySQL: 'mysql' }, '@uiw/react-codemirror': 'CodeMirror'
  }, globals: { window: { innerWidth: 1400 } } });
  assert.equal(f.node('Tabs').children[0].length, 3); assert.equal(f.node('TablePicker').props.disabled, true);
  await f.click('change'); assert.deepEqual(calls.pop(), ['prepare', undefined]);
  await f.click('delete'); assert.deepEqual(calls.pop(), ['prepare', true]);
  c.details.references = ['demo.child.fk']; f.render(); assert.equal(f.button('delete').props.disabled, true); assert.ok(f.text().includes('mysql_index_foreign_keys'));
  c.details.primary = true; f.render(); assert.equal(f.button('change').props.disabled, true);
  c.details.primary = false; c.details.references = []; c.review = { drop: true, statement: { sql: 'DROP INDEX shared ON demo.orders' } }; f.render(); assert.equal(f.button('execute').props.disabled, true);
  f.node('TextField', node => node.props.helperText === 'mysql_index_confirm_name').props.onChange({ target: { value: 'shared' } }); f.render(); await f.click('execute'); assert.equal(calls.pop(), 'execute');
  f.node('Tabs').props.onChange(null, 1); f.render(); assert.equal(f.node('DataGrid').props.rows[0].CARDINALITY, '42');
  f.node('Tabs').props.onChange(null, 2); f.render(); assert.equal(f.node('CodeMirror').props.readOnly, true); assert.equal(f.node('CodeMirror').props.value, c.details.ddl);
  f.props.object = undefined; c.details = undefined; c.columns.push(column('a'),column('b'),column('c')); f.node('Tabs').props.onChange(null,0); f.render();
  const availableRow = name => f.node('ListItemButton', node => node.children.some(child => child?.props?.primary === name));
  availableRow('a').props.onClick({ shiftKey:false,ctrlKey:false,metaKey:false }); f.render(); availableRow('c').props.onClick({ shiftKey:true,ctrlKey:false,metaKey:false }); f.render();
  await f.click('mysql_index_add_selected'); const added = calls.pop(); assert.equal(added[0],'update'); assert.equal(added[1].parts.map(part=>part.column).join(','),'label,a,b,c');
  f.unmount();
});
