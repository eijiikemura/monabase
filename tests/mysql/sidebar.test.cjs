// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const MysqlClient = require('../../electron/mysql/mysqlClient');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const config = { dbType: 'mysql', host: '127.0.0.1', port: '13306', database: 'mb_test', user: 'test', password: 'test' };

test('Disposable MySQL sidebar: native create/list/import/export/copy/rename/analyze/truncate/drop', { timeout: 60000 }, async t => {
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE, '1');
  const client = new MysqlClient();
  const token = 'MBT_' + randomBytes(6).toString('hex'), target = token + '_table', copy = token + '_copy', renamed = token + '_renamed';
  const created = new Set();
  const model = loadTypeScript('src/features/mysql/table/tableModel.ts');
  const actions = loadTypeScript('src/features/mysql/sidebarTableActions.ts', { './table/tableModel': model });
  const onState = [];
  const transport = { invoke: async (channel, sql, binds) => {
    try { return { success: true, ...await client.execute(sql, binds, null, false, channel === 'execute-sql-bg'), ...(channel === 'execute-sql' ? client.getTransactionDetails() : {}) }; }
    catch (error) { return { success: false, error: error.message, ...client.getTransactionDetails() }; }
  } };
  const deps = { react: require('react'), i18next: require('i18next'), '@/shared/api/desktop': { ipcRenderer: transport } };
  const repository = loadTypeScript('src/features/mysql/table/tableRepository.ts', deps);
  const list = loadTypeScript('src/features/objects/mysqlObjects.ts', deps);
  const transfer = loadTypeScript('src/features/mysql/sidebarDataTransfer.ts', { ...deps, './table/tableRepository': repository, './table/tableModel': model }, { Error });
  const run = async statement => {
    const result = await transport.invoke('execute-sql', statement.sql, statement.binds); assert.equal(result.success, true, result.error); return result;
  };
  let metadata;
  try {
    await client.connect(config);
    await t.test('GUI create SQL stores native keys, literals, comments and auto increment and the table appears in the list', async () => {
      const base = { nullable: false, primary: false, autoIncrement: false, defaultMode: 'none', defaultValue: '', comment: '' };
      await run(actions.buildCreateMysqlTable('mb_test', target, "Sidebar's 日本語", [
        { ...base, id: 1, name: 'id', type: 'BIGINT UNSIGNED', primary: true, autoIncrement: true },
        { ...base, id: 2, name: 'label', type: 'VARCHAR(80)', defaultMode: 'literal', defaultValue: 'demo' },
        { ...base, id: 3, name: 'amount', type: 'DECIMAL(40,18)', defaultMode: 'literal', defaultValue: '0' }
      ])); created.add(target);
      metadata = await repository.loadTableMetadata('mb_test', target);
      assert.match(metadata.columns[0].EXTRA, /auto_increment/); assert.equal(metadata.table.TABLE_COMMENT, "Sidebar's 日本語");
      const rows = await list.listMysqlObjects('mb_test', 'TABLE', token, 0); assert.ok(rows.some(row => row.name === target));
    });
    await t.test('Sidebar import preserves exact values and pending rows, and one-snapshot export includes those pending rows', async () => {
      const values = [['id', 'label', 'amount'], ['18446744073709551615', '日本語\tquoted', '12345678901234567890.123456789012345678']];
      await transfer.importMysqlSidebarRows('mb_test', target, metadata, values, true, () => {}, state => onState.push(state), (key, values) => key + ':' + values?.count);
      assert.equal(client.getMainTransactionState(), true);
      assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${model.quoteMysql(target)}`, {}, null, false, true)).rows[0].n, '0');
      const prepared = await transfer.prepareMysqlTransfer('mb_test', target, 'YYYY/MM/DD HH:mm:ss');
      const busy = [], fetch = transfer.createMysqlSidebarExport('mb_test', target, prepared.metadata, prepared.formatRows, state => onState.push(state), value => busy.push(value));
      const exported = await fetch(0, 5000);
      assert.equal(exported[0].id, values[1][0]); assert.equal(exported[0].amount, values[1][2]); assert.equal(exported[0].label, values[1][1]);
      assert.equal((await fetch(1, 5000)).length, 0); assert.deepEqual(busy, [true, false]); await fetch.close();
      await client.rollback(); assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${model.quoteMysql(target)}`)).rows[0].n, '0');
    });
    await t.test('Copy is one native CTAS, rename is exact and ANALYZE/TRUNCATE report their implicit commits', async () => {
      await client.execute(`INSERT INTO ${model.quoteMysql(target)}(id,label) VALUES(1,'source')`);
      await run(actions.buildSidebarTableAction('copy', 'mb_test', target, copy, metadata.columns)); created.add(copy);
      assert.equal(client.getMainTransactionState(), false);
      const copied = await repository.loadTableMetadata('mb_test', copy);
      assert.equal(model.primaryColumns(copied.columns).length, 0); assert.equal((await client.execute(`SELECT label FROM ${model.quoteMysql(copy)}`)).rows[0].label, 'source');
      await run(actions.buildSidebarTableAction('rename', 'mb_test', copy, renamed, [])); created.delete(copy); created.add(renamed);
      assert.ok((await list.listMysqlObjects('mb_test', 'TABLE', token, 0)).some(row => row.name === renamed));
      await client.execute(`INSERT INTO ${model.quoteMysql(target)}(id,label) VALUES(2,'before analyze')`);
      const analysis = await run(actions.buildSidebarTableAction('analyze', 'mb_test', renamed, '', []));
      assert.ok(analysis.rows.some(row => row.Msg_type === 'status' && row.Msg_text === 'OK'));
      assert.equal(client.getMainTransactionState(), false);
      await run(actions.buildSidebarTableAction('truncate', 'mb_test', renamed, '', [])); await client.rollback();
      assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${model.quoteMysql(renamed)}`)).rows[0].n, '0');
      await run(actions.buildSidebarTableAction('drop', 'mb_test', renamed, '', [])); created.delete(renamed);
    });
    await t.test('The native sidebar search returns 100 rows plus the remaining page without duplicates', async () => {
      const prefix = token + '_page_';
      for (let i = 0; i < 101; i++) { const name = prefix + String(i).padStart(3, '0'); await client.execute(`CREATE TABLE ${model.quoteMysql(name)}(id INT)`); created.add(name); }
      const first = await list.listMysqlObjects('mb_test', 'TABLE', prefix, 0), second = await list.listMysqlObjects('mb_test', 'TABLE', prefix, 100);
      assert.equal(first.length, 100); assert.equal(second.length, 1); assert.equal(new Set([...first, ...second].map(row => row.key)).size, 101);
      assert.equal((await list.listMysqlObjects('mb_test', 'TABLE', prefix + '010', 0)).length, 1);
    });
  } finally {
    try { if (client.main) { await client.rollback(); for (const name of [...created].reverse()) await client.execute(`DROP TABLE IF EXISTS ${model.quoteMysql(name)}`); } }
    finally { await client.disconnect(); }
  }
});
