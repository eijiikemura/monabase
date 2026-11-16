// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const model = loadTypeScript('src/features/mysql/table/tableModel.ts');
const actions = loadTypeScript('src/features/mysql/sidebarTableActions.ts', { './table/tableModel': model });
const object = name => ({ key: JSON.stringify(['mysql', 'demo', 'TABLE', name]), dbType: 'mysql', schema: 'demo', category: 'TABLE', name, displayName: name });

function listing(category) {
  const h = createHookHarness(), calls = [], pending = [], timers = new Map(), window = new EventTarget();
  let serial = 0, result;
  const module = loadTypeScript('src/features/mysql/useSidebarTables.ts', { react: h.react, '@/features/objects/mysqlObjects': { listMysqlObjects: (...args) => { calls.push(args); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } } }, { window, Error,
    setTimeout: fn => { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  const render = () => { result = h.render(() => module.useSidebarTables(category)); h.commit(); return result; };
  const pump = async () => { render(); await h.settle(); return render(); };
  render();
  return { h, calls, pending, timers, window, render, pump, get result() { return result; }, flushTimers() { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()); } };
}
test('MySQL sidebar loads 100 tables only on first expansion, caches collapse/reopen and appends exactly once', async () => {
  const f = listing(); f.result.toggle('demo'); f.render(); assert.equal(f.calls.length, 1);
  f.pending.shift().resolve(Array.from({ length: 100 }, (_, i) => object('table_' + i))); await f.pump();
  assert.equal(f.result.pages.demo.rows.length, 100); assert.equal(f.result.pages.demo.more, true);
  f.result.toggle('demo'); f.render(); f.result.toggle('demo'); f.render(); assert.equal(f.calls.length, 1);
  f.result.more('demo'); f.result.more('demo'); assert.equal(f.calls.length, 2); assert.equal(f.calls[1][3], 100);
  f.pending.shift().resolve([object('last_table')]); await f.pump(); assert.equal(f.result.pages.demo.rows.length, 101); assert.equal(f.result.pages.demo.more, false); f.h.unmount();
});
test('MySQL sidebar debounces searches and rejects late rows or stale pagination after the filter changes', async () => {
  const f = listing(); f.result.toggle('demo'); f.render(); const initial = f.pending.shift();
  f.result.filter('demo', 'old'); f.render(); f.result.filter('demo', 'new%_'); f.render(); f.flushTimers(); f.render();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1][2], 'new%_');
  f.pending.shift().resolve([object('new%_table')]); await f.pump(); initial.resolve([object('stale')]); await f.pump();
  assert.equal(f.result.pages.demo.rows[0].name, 'new%_table'); assert.equal(f.result.pages.demo.applied, 'new%_');
  f.result.filter('demo', ''); f.render(); f.result.more('demo'); assert.equal(f.calls.length, 2); f.flushTimers(); assert.equal(f.calls[2][3], 0);
  f.pending.shift().resolve([]); await f.pump(); assert.equal(f.result.pages.demo.rows.length, 0); f.h.unmount();
});
test('MySQL sidebar retains earlier rows after append errors and retries the failed offset without background loops', async () => {
  const f = listing(); f.result.toggle('demo'); f.render(); f.pending.shift().resolve(Array.from({ length: 100 }, (_, i) => object('t' + i))); await f.pump();
  f.result.more('demo'); f.pending.shift().reject(new Error('metadata denied')); await f.pump();
  assert.equal(f.result.pages.demo.rows.length, 100); assert.equal(f.result.pages.demo.error, 'metadata denied'); assert.equal(f.result.pages.demo.loading, false);
  await f.pump(); assert.equal(f.calls.length, 2); f.result.retry('demo'); assert.equal(f.calls.at(-1)[3], 100);
  f.pending.shift().resolve([object('next')]); await f.pump(); assert.equal(f.result.pages.demo.rows.length, 101); assert.equal(f.result.pages.demo.error, ''); f.h.unmount();
});
test('MySQL table-created and refresh events reload matching lists and invalidate requests after unmount', async () => {
  const f = listing();
  f.window.dispatchEvent(new CustomEvent('table-created', { detail: { schema: 'a.b', tableName: 'new' } })); f.render();
  assert.ok(f.result.expanded.includes('a.b')); assert.equal(f.calls[0][0], 'a.b'); f.pending.shift().resolve([object('new')]); await f.pump();
  f.window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: 'a.b', objType: 'TABLE' } })); assert.equal(f.calls.length, 2);
  f.h.unmount(); f.pending.shift().resolve([object('too-late')]); await f.pump(); assert.equal(f.result.pages['a.b'].rows[0].name, 'new');
});
test('MySQL sidebar action builders quote exact names and emit native single-statement operations', () => {
  const columns = [{ COLUMN_NAME: 'id' }, { COLUMN_NAME: 'odd`name' }];
  assert.equal(actions.buildSidebarTableAction('rename', 'a.b', 'old', 'new`name', columns).sql, 'RENAME TABLE `a.b`.`old` TO `a.b`.`new``name`');
  assert.match(actions.buildSidebarTableAction('copy', 'demo', 'old', 'copy', columns).sql, /ENGINE=InnoDB AS SELECT `id`, `odd``name` FROM `demo`\.`old`$/);
  assert.equal(actions.buildSidebarTableAction('analyze', 'demo', 't', '', []).sql, 'ANALYZE TABLE `demo`.`t`');
  assert.match(actions.buildSidebarTableAction('truncate', 'demo', 't', '', []).sql, /^TRUNCATE TABLE/);
  assert.match(actions.buildSidebarTableAction('drop', 'demo', 't', '', []).sql, /^DROP TABLE/);
  assert.throws(() => actions.buildSidebarTableAction('rename', 'demo', 't', 't', []));
  assert.throws(() => actions.buildSidebarTableAction('copy', 'demo', 't', 'x', []));
});
test('MySQL create-table builder preserves literal defaults/comments, composite keys and native auto increment', () => {
  const id = { id: 1, name: 'id', type: 'BIGINT UNSIGNED', primary: true, nullable: false, autoIncrement: true, defaultMode: 'none', defaultValue: '', comment: 'Identifier' };
  const label = { ...id, id: 2, name: 'label', type: 'VARCHAR(100)', primary: false, nullable: true, autoIncrement: false, defaultMode: 'literal', defaultValue: "'; DROP TABLE x; --", comment: '日本語' };
  const result = actions.buildCreateMysqlTable('demo', 'odd`table', "Table's comment", [id, label]);
  assert.match(result.sql, /AUTO_INCREMENT/); assert.match(result.sql, /PRIMARY KEY \(`id`\)/); assert.ok(!result.sql.includes('DROP TABLE'));
  assert.equal(result.binds.default1, label.defaultValue); assert.equal(result.binds.tableComment, "Table's comment");
  assert.throws(() => actions.buildCreateMysqlTable('demo', 'x', '', [id, { ...label, name: 'ID' }]), /unique/);
  assert.throws(() => actions.buildCreateMysqlTable('demo', 'x', '', [{ ...label, autoIncrement: true }]), /AUTO_INCREMENT/);
  assert.throws(() => actions.buildCreateMysqlTable('demo', 'x', '', [{ ...label, type: 'INT); DROP TABLE x' }]), /type/);
  assert.throws(() => actions.buildCreateMysqlTable('demo', 'x', '', [{ ...id, defaultMode: 'literal', defaultValue: '1' }]), /default/);
});
test('MySQL native ANALYZE is accepted only for TABLE and is refused on readonly and background connections', () => {
  const { inspectSql, assertReadOnly } = require('../electron/mysql/sqlText');
  const statement = inspectSql('ANALYZE TABLE `demo`.`t`'); assert.equal(statement.command, 'ANALYZE'); assert.throws(() => assertReadOnly(statement), /read-only/);
  assert.throws(() => inspectSql('ANALYZE SELECT 1'), /ANALYZE TABLE/); assert.throws(() => inspectSql('ANALYZE TABLE t; DROP TABLE t'));
});

test('MySQL sidebar cache treats prototype-like and dotted database names as independent identifiers', async () => {
  const f = listing();
  for (const name of ['__proto__', 'constructor', 'a.b']) { f.result.toggle(name); f.render(); f.pending.shift().resolve([object(name + '_table')]); await f.pump(); }
  assert.equal(f.result.pages['__proto__'].rows[0].name, '__proto___table'); assert.equal(f.result.pages.constructor.rows[0].name, 'constructor_table');
  assert.equal(f.result.pages['a.b'].rows[0].name, 'a.b_table'); f.h.unmount();
});

test('MySQL sidebar exports one immutable main-session snapshot, preserves NULL and never commits', async () => {
  const calls = [], states = [], busy = [];
  const rows = Array.from({ length: 5001 }, (_, id) => ({ id: String(id), amount: id === 0 ? null : '1.000000000000000001' }));
  const transfer = loadTypeScript('src/features/mysql/sidebarDataTransfer.ts', { react: require('react'), i18next: require('i18next'), './table/tableModel': model, './table/tableRepository': {}, '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, sql) => { calls.push([channel, sql]); return { success: true, rows, transactionStatus: 'active' }; } } } }, { Error });
  const metadata = { columns: [{ COLUMN_NAME: 'id', PK_POSITION: 1 }, { COLUMN_NAME: 'amount', PK_POSITION: 0 }] };
  const fetch = transfer.createMysqlSidebarExport('demo', 'orders', metadata, rows => rows.map(row => ({ ...row })), state => states.push(state), value => busy.push(value));
  const first = await fetch(0, 5000); rows[5000].amount = 'new value'; const second = await fetch(5000, 5000);
  assert.equal(first.length, 5000); assert.equal(first[0].amount, null); assert.equal(second[0].amount, '1.000000000000000001'); assert.equal(calls.length, 1);
  assert.equal(states[0].transactionStatus, 'active'); assert.deepEqual(busy, [true, false]); assert.ok(!/COMMIT|ROLLBACK|LIMIT/.test(calls[0][1])); await fetch.close();
});

test('MySQL sidebar import validates all records first and reports pending partial writes without replay', async () => {
  const calls = [], states = []; let failed = false;
  const transfer = loadTypeScript('src/features/mysql/sidebarDataTransfer.ts', { react: require('react'), i18next: require('i18next'), './table/tableModel': model, './table/tableRepository': {}, '@/shared/api/desktop': { ipcRenderer: { invoke: async (_channel, sql) => { calls.push(sql); return failed && calls.length === 2 ? { success: false, error: 'row denied', transactionStatus: 'active' } : { success: true, rowsAffected: 1, transactionStatus: 'active' }; } } } }, { Error });
  const metadata = { table: { ENGINE: 'InnoDB', TABLE_TYPE: 'BASE TABLE' }, columns: [{ COLUMN_NAME: 'amount', DATA_TYPE: 'decimal', PK_POSITION: 0, IS_NULLABLE: 'YES', GENERATION_EXPRESSION: '', EXTRA: '' }] };
  const t = (key, values) => key + ':' + values?.count;
  await assert.rejects(transfer.importMysqlSidebarRows('demo', 't', metadata, [['amount'], ['1'], ['bad']], true, () => {}, state => states.push(state), t)); assert.equal(calls.length, 0);
  failed = true;
  await assert.rejects(transfer.importMysqlSidebarRows('demo', 't', metadata, [['amount'], ['1'], ['2'], ['3']], true, () => {}, state => states.push(state), t), /mysql_table_import_partial:1.*row denied/);
  assert.equal(calls.length, 2); assert.ok(calls.every(sql => sql.startsWith('INSERT'))); assert.equal(states.at(-1).transactionStatus, 'active');
});

test('MySQL create-table screen requires columns and SQL review and prevents duplicate create requests', async () => {
  const { componentHarness } = require('./helpers/componentHarness.cjs');
  const requested = [], created = [], locale = { components: { MuiDataGrid: { defaultProps: { localeText: {} } } } };
  const props = { schema: 'demo', active: true, busy: false, readonly: false, setBusy: value => { props.busy = value; }, onState() {}, onCreated: value => created.push(value) };
  const f = componentHarness('src/features/mysql/CreateTableWindow.tsx', props, { dependencies: {
    '@/features/data-grid/GridViewport': { GridViewport: 'Viewport' }, './sidebarTableActions': actions, './sidebarDataTransfer': { mainTransferQuery: async (sql, binds) => { requested.push({ sql, binds }); return { success: true }; } },
    '@mui/x-data-grid': { DataGrid: 'DataGrid', enUS: locale, jaJP: locale }
  } });
  assert.equal(f.button('create_table').props.disabled, true);
  f.node('TextField', node => node.props.label==='table_name').props.onChange({ target: { value: 'orders' } }); f.render();
  await f.click('add_column_2'); f.node('TextField', node => node.props.label==='column_name').props.onChange({ target: { value: 'label' } }); f.render();
  await f.click('save'); assert.equal(f.node('DataGrid').props.rows.length, 1); assert.equal(requested.length, 0);
  await f.click('create_table'); assert.equal(requested.length, 0);
  const execute=f.button('execute'); execute.props.onClick(); execute.props.onClick(); await f.flush();
  assert.equal(requested.length, 1); assert.match(requested[0].sql, /^CREATE TABLE/); assert.deepEqual(created,['orders']);
  f.props.readonly=true; f.render(); assert.equal(f.button('create_table').props.disabled,true); f.unmount();
});

test('MySQL sidebar rename invalidates an old SQL preview and an attempted request cannot be resent', async () => {
  const { componentHarness } = require('./helpers/componentHarness.cjs'); const requests=[];
  const f=componentHarness('src/features/mysql/SidebarTableDialog.tsx',{ target:object('orders'), action:'rename', columns:[], busy:false, failureMessage:'', onClose(){}, onExecute:async(sql,name)=>{ requests.push({sql,name}); return false; } },{ dependencies:{ './sidebarTableActions':actions } });
  assert.equal(f.button('execute').props.disabled,true);
  const change=name=>{ f.node('TextField',node=>node.props.label==='new_table_name').props.onChange({target:{value:name}}); f.render(); };
  change('new_orders'); await f.click('preview'); assert.equal(f.button('execute').props.disabled,false);
  change('actual_orders'); assert.equal(f.button('execute').props.disabled,true); await f.click('preview');
  const execute=f.button('execute'); execute.props.onClick(); execute.props.onClick(); await f.flush();
  assert.equal(requests.length,1); assert.equal(requests[0].name,'actual_orders'); assert.ok(requests[0].sql.sql.includes('actual_orders')); assert.equal(f.button('execute').props.disabled,true); f.unmount();
});


test('MySQL index sidebar caches independently, refreshes for index or owning-table changes and preserves table-scoped keys', async () => {
  const f = listing('INDEX'); f.result.toggle('demo'); f.render(); assert.equal(f.calls[0][1], 'INDEX');
  const rows = ['a', 'b'].map(table => ({ ...object('shared'), category: 'INDEX', parentName: table, key: JSON.stringify(['mysql','demo','INDEX',table,'shared']) }));
  f.pending.shift().resolve(rows); await f.pump(); assert.equal(f.result.pages.demo.rows.length, 2);
  f.result.toggle('demo'); f.render(); f.result.toggle('demo'); f.render(); assert.equal(f.calls.length, 1);
  f.window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: 'demo', objType: 'VIEW' } })); assert.equal(f.calls.length, 1);
  f.window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: 'demo', objType: 'INDEX' } })); assert.equal(f.calls.length, 2);
  f.pending.shift().resolve(rows); await f.pump();
  f.window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: 'demo', objType: 'TABLE' } })); assert.equal(f.calls.length, 3);
  f.pending.shift().resolve(rows); await f.pump(); f.h.unmount();
});

test('MySQL view category caches separately and refreshes only matching schema/view events',async()=>{
  const f=listing('VIEW');f.result.toggle('demo');f.render();assert.equal(f.calls[0][1],'VIEW');f.pending.shift().resolve([{...object('summary'),category:'VIEW'}]);await f.pump();
  f.result.toggle('demo');f.render();f.result.toggle('demo');f.render();assert.equal(f.calls.length,1);
  f.window.dispatchEvent(new CustomEvent('refresh-sidebar',{detail:{schema:'demo',objType:'INDEX'}}));assert.equal(f.calls.length,1);
  f.window.dispatchEvent(new CustomEvent('refresh-sidebar',{detail:{schema:'other',objType:'VIEW'}}));assert.equal(f.calls.length,1);
  f.window.dispatchEvent(new CustomEvent('refresh-sidebar',{detail:{schema:'demo',objType:'VIEW'}}));assert.equal(f.calls.length,2);f.pending.shift().resolve([]);await f.pump();assert.equal(f.result.pages.demo.rows.length,0);f.h.unmount();
});

test('MySQL trigger category has an independent cached list and matching refresh events',async()=>{
  const f=listing('TRIGGER');f.result.toggle('demo');f.render();assert.equal(f.calls[0][1],'TRIGGER');f.pending.shift().resolve([{...object('audit'),category:'TRIGGER',parentName:'orders'}]);await f.pump();f.result.toggle('demo');f.render();f.result.toggle('demo');f.render();assert.equal(f.calls.length,1);
  f.window.dispatchEvent(new CustomEvent('refresh-sidebar',{detail:{schema:'demo',objType:'TRIGGER'}}));assert.equal(f.calls.length,2);f.pending.shift().resolve([]);await f.pump();assert.equal(f.result.pages.demo.rows.length,0);f.h.unmount();
});
