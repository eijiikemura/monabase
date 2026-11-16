// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const model = loadTypeScript('src/features/mysql/table/tableModel.ts');
const identities = loadTypeScript('src/features/data-grid/rowIdentity.ts');
const columns = [{ COLUMN_NAME: 'id', DATA_TYPE: 'int', COLUMN_TYPE: 'int', PK_POSITION: 1, IS_NULLABLE: 'NO', EXTRA: '', GENERATION_EXPRESSION: '' }, { COLUMN_NAME: 'label', DATA_TYPE: 'varchar', COLUMN_TYPE: 'varchar(50)', PK_POSITION: 0, IS_NULLABLE: 'YES', EXTRA: '', GENERATION_EXPRESSION: '' }];
function fixture() {
  const hooks = createHookHarness(), calls = [], states = [], eventWindow = new EventTarget();
  const t = key => key;
  let data = [{ id: 1, label: 'original' }], failRead = false, failMetadata = false, writes = 0, metadataReads = 0, releaseWrite;
  const props = { schema: 'demo', table: 't', active: true, readonly: false, disabled: false, busy: false, settings: {}, setBusy: value => { props.busy = value; }, onState: state => states.push(state) };
  const module = loadTypeScript('src/features/mysql/table/useMysqlTable.ts', { react: hooks.react,
    'react-i18next': { useTranslation: () => ({ t }) },
    '@/features/table/useTableOpening': { waitForTablePaint: async () => {} },
    '@/features/data-grid/rowIdentity': identities, './tableModel': model,
    './tableRepository': {
      loadTableMetadata: async () => { metadataReads++; if (failMetadata) throw new Error('metadata denied'); return { table: { ENGINE: 'InnoDB', TABLE_TYPE: 'BASE TABLE' }, columns }; },
      executeTableStatement: async statement => {
        calls.push(statement);
        if (/^UPDATE/.test(statement.sql)) { writes++; if (releaseWrite) await releaseWrite.promise; data = [{ id: 1, label: statement.binds.v0 }]; return { success: true, rows: [], rowsAffected: 1, transactionStatus: 'active' }; }
        if (failRead) throw new Error('transport disconnected');
        return { success: true, rows: /COUNT\(/.test(statement.sql) ? [{ total: String(data.length) }] : data.map(row => ({ ...row })), transactionStatus: 'active' };
      }
    }
  }, { window: eventWindow, Error, Event, CustomEvent, structuredClone });
  let current;
  const render = () => { current = hooks.render(() => module.useMysqlTable(props, true)); hooks.commit(); return current; };
  const pump = async () => { for (let i = 0; i < 6; i++) { render(); await hooks.settle(); } return current; };
  return { props, calls, states, eventWindow, render, pump, hooks, get current() { return current; }, setData: value => { data = value; }, failRead: value => { failRead = value; }, failMetadata: value => { failMetadata = value; }, writes: () => writes, metadataReads: () => metadataReads, deferWrite: () => { let resolve; const promise = new Promise(done => { resolve = done; }); releaseWrite = { promise }; return resolve; } };
}
test('MySQL table controller loads once, refreshes after Rollback and retains the native transaction state', async () => {
  const f = fixture(); await f.pump(); assert.equal(f.current.rows[0].label, 'original'); assert.equal(f.props.busy, false);
  const count = f.calls.length; await f.pump(); assert.equal(f.calls.length, count);
  f.setData([{ id: 1, label: 'rolled-back' }]); f.eventWindow.dispatchEvent(new Event('mysql-transaction-finished'));
  await f.pump(); assert.equal(f.current.rows[0].label, 'rolled-back'); assert.equal(f.states.at(-1).transactionStatus, 'active'); f.hooks.unmount();
});
test('MySQL inline editing rejects repeated writes and refetches the canonical stored row before releasing the guard', async () => {
  const f = fixture(); await f.pump(); const original = f.current.rows[0], release = f.deferWrite();
  const first = f.current.updateCell({ ...original, label: 'edited' }, original);
  await assert.rejects(f.current.updateCell({ ...original, label: 'second' }, original), /unavailable/);
  assert.equal(f.writes(), 1); release(); const saved = await first; await f.pump(); assert.equal(saved.label, 'edited'); assert.equal(f.current.rows[0].label, 'edited'); assert.equal(f.writes(), 1); f.hooks.unmount();
});
test('MySQL read failures preserve displayed rows, mark unknown transport state and do not retry in a loop', async () => {
  const f = fixture(); await f.pump(); f.failRead(true); f.eventWindow.dispatchEvent(new Event('mysql-transaction-finished'));
  await f.pump(); const count = f.calls.length;
  assert.match(f.current.error, /transport disconnected/); assert.equal(f.current.rows[0].label, 'original'); assert.equal(f.states.at(-1).transactionStatus, 'unknown');
  await f.pump(); assert.equal(f.calls.length, count); assert.equal(f.props.busy, false); f.hooks.unmount();
});
test('MySQL metadata errors allow explicit retry and readonly inline writes never reach IPC', async () => {
  const f = fixture(); f.failMetadata(true); await f.pump(); assert.equal(f.current.metadata, undefined); assert.match(f.current.error, /metadata denied/);
  f.failMetadata(false); await f.current.refresh(); await f.pump(); assert.equal(f.current.rows.length, 1);
  f.props.readonly = true; f.render(); const before = f.calls.length;
  await assert.rejects(f.current.updateCell({ ...f.current.rows[0], label: 'blocked' }, f.current.rows[0])); assert.equal(f.calls.length, before); f.hooks.unmount();
});

test('MySQL DDL refreshes metadata before releasing the operation guard and closes only the dropped table', async () => {
  const f = fixture(); await f.pump(); const before = f.metadataReads();
  assert.equal(await f.current.executeDdl({ sql: "ALTER TABLE `demo`.`t` COMMENT = :comment", binds: { comment: 'new' } }), true);
  assert.equal(f.metadataReads(), before + 1); assert.equal(f.props.busy, false);
  await f.pump(); let dropped = 0; f.props.onDropped = () => dropped++; f.render();
  assert.equal(await f.current.executeDdl({ sql: 'DROP TABLE `demo`.`t`', binds: {} }), true); assert.equal(dropped, 1); f.hooks.unmount();
});

test('MySQL partial-delete errors remain visible after the automatic data refresh', async () => {
  const f = fixture(); await f.pump(); await f.current.deleteRows(f.current.rows); await f.pump();
  assert.match(f.current.error, /mysql_table_delete_partial/); assert.equal(f.current.rows.length, 1); f.hooks.unmount();
});

test('MySQL result header clicks match Oracle single-column ascending/descending and preserve filters', async () => {
  const f = fixture(); await f.pump();
  f.current.setConditions(previous => ({ ...previous, label: { ...previous.label, value: 'original', sort: '2 DESC' } })); await f.pump();
  await f.current.sortByColumn('id'); await f.pump();
  assert.equal(f.current.conditions.id.sort, '1'); assert.equal(f.current.conditions.label.sort, '');
  assert.equal(f.current.applied.label.value, 'original'); assert.equal(f.current.applied.id.sort, '1');
  assert.match(f.calls.at(-1).sql, /ORDER BY `id` ASC/);
  await f.current.sortByColumn('id'); await f.pump();
  assert.equal(f.current.applied.id.sort, '1 DESC'); assert.match(f.calls.at(-1).sql, /ORDER BY `id` DESC/);
  await f.current.sortByColumn('label'); await f.pump();
  assert.equal(f.current.applied.id.sort, ''); assert.equal(f.current.applied.label.sort, '1');
  const count = f.calls.length;
  f.props.busy = true; f.render(); f.current.sortByColumn('id'); await f.pump(); assert.equal(f.calls.length, count);
  f.props.busy = false; f.current.setConditions(previous => ({ ...previous, label: { ...previous.label, type: 'DISABLED' } })); await f.pump();
  f.current.sortByColumn('label'); f.current.sortByColumn('__check__'); await f.pump(); assert.equal(f.calls.length, count);
  f.hooks.unmount();
});

test('MySQL table metadata refreshes after a matching trigger change and waits while its window is inactive',async()=>{
  const f=fixture();await f.pump();const before=f.metadataReads();f.props.active=false;f.render();
  f.eventWindow.dispatchEvent(new CustomEvent('reload-statistics',{detail:{schema:'demo',tableName:'other'}}));await f.pump();assert.equal(f.metadataReads(),before);
  f.eventWindow.dispatchEvent(new CustomEvent('reload-statistics',{detail:{schema:'demo',tableName:'t'}}));await f.pump();assert.equal(f.metadataReads(),before);
  f.props.active=true;await f.pump();assert.equal(f.metadataReads(),before+1);assert.equal(f.writes(),0);f.hooks.unmount();
});

test('MySQL applied AUTO_INCREMENT DDL reports refresh failure without resending the committing statement',async()=>{
  const f=fixture();await f.pump();f.failMetadata(true);assert.equal(await f.current.executeDdl({sql:'ALTER TABLE `demo`.`t` AUTO_INCREMENT = 100',binds:{}}),true);await f.pump();assert.match(f.current.error,/mysql_table_ddl_applied_refresh_failed/);assert.equal(f.calls.filter(c=>c.sql.includes('AUTO_INCREMENT')).length,1);f.failMetadata(false);await f.current.refresh(false);await f.pump();assert.equal(f.current.error,'');assert.equal(f.calls.filter(c=>c.sql.includes('AUTO_INCREMENT')).length,1);f.hooks.unmount();
});
