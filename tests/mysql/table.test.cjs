// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const MysqlClient = require('../../electron/mysql/mysqlClient');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const config = { dbType: 'mysql', host: '127.0.0.1', port: '13306', database: 'mb_test', user: 'test', password: 'test' };

test('Disposable MySQL table window: native metadata, exact data, optimistic edits and explicit transactions', { timeout: 60000 }, async t => {
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE, '1', 'Opt in to the dedicated disposable MySQL fixture.');
  const client = new MysqlClient(), second = new MysqlClient();
  const name = 'MBT_' + randomBytes(6).toString('hex'), child = name + '_child', noPk = name + '_nopk';
  const model = loadTypeScript('src/features/mysql/table/tableModel.ts');
  const ddl = loadTypeScript('src/features/mysql/table/tableDdl.ts', { './tableModel': model });
  const repository = loadTypeScript('src/features/mysql/table/tableRepository.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, sql, binds) => {
    assert.ok(['execute-sql', 'execute-sql-bg'].includes(channel));
    try { return { success: true, ...await client.execute(sql, binds, null, false, channel === 'execute-sql-bg'), ...client.getTransactionDetails() }; }
    catch (error) { return { success: false, error: error.message, ...client.getTransactionDetails() }; }
  } } } });
  const run = async statement => { const result = await repository.executeTableStatement(statement); assert.equal(result.success, true, result.error); return result; };
  const field = value => ({ mode: value === null ? 'null' : 'value', value: value === null ? '' : String(value) });
  const input = (action, rest = {}) => ({ action, name: '', value: '', type: 'VARCHAR(50)', nullable: true, unique: false, columns: [], targetSchema: 'mb_test', targetTable: name, targetColumns: [], deleteRule: 'RESTRICT', updateRule: 'RESTRICT', ...rest });
  let metadata;
  const created = [];
  try {
    await client.connect(config); await second.connect(config);
    await client.execute(`CREATE TABLE ${model.quoteMysql(name)} (id BIGINT UNSIGNED PRIMARY KEY, label VARCHAR(80), amount DECIMAL(40,18), stamp DATETIME(6), payload JSON, bytes VARBINARY(10), generated_length INT GENERATED ALWAYS AS (CHAR_LENGTH(label)) STORED, CONSTRAINT ${model.quoteMysql(name + '_check')} CHECK(amount >= 0)) ENGINE=InnoDB`); created.push(name);
    await client.execute(`CREATE TABLE ${model.quoteMysql(child)} (tenant INT, parent_id BIGINT UNSIGNED, id INT, PRIMARY KEY(tenant,id), CONSTRAINT ${model.quoteMysql(child + '_fk')} FOREIGN KEY(parent_id) REFERENCES ${model.quoteMysql(name)}(id)) ENGINE=InnoDB`); created.push(child);
    await client.execute(`CREATE TABLE ${model.quoteMysql(noPk)} (label VARCHAR(30)) ENGINE=InnoDB`); created.push(noPk);
    await t.test('Columns, generated definitions, checks, composite PK order and both FK directions are exact', async () => {
      metadata = await repository.loadTableMetadata('mb_test', name);
      assert.equal(metadata.columns.length, 7); assert.equal(metadata.columns.find(c => c.COLUMN_NAME === 'id').PK_POSITION, '1');
      assert.match(metadata.columns.find(c => c.COLUMN_NAME === 'generated_length').GENERATION_EXPRESSION, /char_length/i);
      assert.equal(metadata.checks.length, 1); assert.equal(metadata.relations.length, 1); assert.equal(metadata.relations[0].TABLE_NAME, child);
      const children = await repository.loadTableMetadata('mb_test', child);
      assert.deepEqual(model.primaryColumns(children.columns).map(c => c.COLUMN_NAME), ['tenant', 'id']);
      assert.equal(children.relations[0].REFERENCED_TABLE_NAME, name);
      const noKey = await repository.loadTableMetadata('mb_test', noPk); assert.equal(model.canEditTable(noKey), false);
    });
    await t.test('Qualified table and catalog reads work from another default database without changing it', async () => {
      const reader=new MysqlClient();
      try{
        await reader.connect({...config,database:'information_schema'});
        const before=(await reader.execute('SELECT DATABASE() AS current_db',{},'information_schema')).rows[0].current_db;
        assert.equal(before,'information_schema');
        const result=await reader.execute(`SELECT id FROM ${model.mysqlTableName('mb_test',name)}`,{},'information_schema');
        assert.equal(result.rows.length,0);
        const repo=loadTypeScript('src/features/mysql/table/tableRepository.ts',{'@/shared/api/desktop':{ipcRenderer:{invoke:async(channel,sql,binds)=>{
          assert.equal(channel,'execute-sql-bg');return {success:true,...await reader.execute(sql,binds,null,false,true)};
        }}}});
        assert.equal((await repo.loadTableMetadata('mb_test',name)).columns.length,7);
        assert.equal((await reader.execute('SELECT DATABASE() AS current_db',{},'information_schema')).rows[0].current_db,'information_schema');
        await reader.execute(`INSERT INTO ${model.mysqlTableName('mb_test',name)} (id,label) VALUES(11,'cross-database pending')`,{},'information_schema');
        assert.equal(reader.getMainTransactionState(),true);
        assert.equal((await reader.execute(`SELECT label FROM ${model.quoteMysql(name)} WHERE id=11`,{},'mb_test')).rows[0].label,'cross-database pending');
        assert.equal((await reader.execute('SELECT DATABASE() AS current_db',{},'information_schema')).rows[0].current_db,'information_schema');
        assert.equal(reader.getMainTransactionState(),true,'Selecting the default database must retain pending writes.');
        await reader.rollback();
        assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${model.quoteMysql(name)} WHERE id=11`)).rows[0].n,'0');

      }finally{await reader.disconnect();}
    });
    await t.test('Inserts preserve maximum unsigned BIGINT, decimal digits, JSON, bytes, NULL and microseconds without committing', async () => {
      const fields = Object.fromEntries(Object.entries({ id: '18446744073709551615', label: '日本語 50%_', amount: '12345678901234567890.123456789012345678', stamp: '2026-11-13 12:34:56.123456', payload: '{"demo":true}', bytes: '00ff' }).map(([key, value]) => [key, field(value)]));
      await run(model.insertStatement('mb_test', name, metadata, fields));
      const result = await run(model.tableQuery('mb_test', name, metadata.columns, model.defaultConditions(metadata.columns), 0, 100));
      assert.equal(result.rows[0].id, fields.id.value); assert.equal(result.rows[0].amount, fields.amount.value); assert.equal(result.rows[0].stamp, fields.stamp.value); assert.equal(result.rows[0].bytes, '00ff'); assert.match(result.rows[0].payload, /true/);
      assert.equal(client.getMainTransactionState(), true);
      assert.equal((await second.execute(`SELECT COUNT(*) n FROM ${model.quoteMysql(name)}`)).rows[0].n, '0');
      await second.rollback(); await client.rollback();
      assert.equal((await run(model.tableQuery('mb_test', name, metadata.columns, {}, 0, 100))).rows.length, 0);
    });
    await t.test('Single-cell updates and deletes remain reversible and generated columns are refetched', async () => {
      await run(model.insertStatement('mb_test', name, metadata, { id: field('1'), label: field('first'), amount: field('1.23'), stamp: field(null), payload: field(null), bytes: field(null) }));
      await client.commit();
      let row = (await run(model.tableQuery('mb_test', name, metadata.columns, {}, 0, 100))).rows[0];
      assert.equal((await run(model.updateStatement('mb_test', name, metadata, row, { label: '' }))).rowsAffected, 1);
      row = (await run(model.tableQuery('mb_test', name, metadata.columns, {}, 0, 100))).rows[0]; assert.equal(row.label, ''); assert.equal(row.generated_length, 0);
      await client.rollback();
      row = (await run(model.tableQuery('mb_test', name, metadata.columns, {}, 0, 100))).rows[0]; assert.equal(row.label, 'first');
      assert.equal((await run(model.deleteStatement('mb_test', name, metadata, row))).rowsAffected, 1);
      await client.rollback(); assert.equal((await run(model.tableQuery('mb_test', name, metadata.columns, {}, 0, 100))).rows.length, 1);
    });
    await t.test('A concurrent case-only or trailing-space change cannot be silently overwritten', async () => {
      const original = (await run(model.tableQuery('mb_test', name, metadata.columns, {}, 0, 100))).rows[0];
      await second.execute(`UPDATE ${model.quoteMysql(name)} SET label='FIRST ' WHERE id=1`); await second.commit();
      const conflict = await run(model.updateStatement('mb_test', name, metadata, original, { amount: '9' })); assert.equal(conflict.rowsAffected, 0);
      const deletion = await run(model.deleteStatement('mb_test', name, metadata, original)); assert.equal(deletion.rowsAffected, 0);
      await client.rollback();
      const current = (await run(model.tableQuery('mb_test', name, metadata.columns, {}, 0, 100))).rows[0]; assert.equal(current.label, 'FIRST '); assert.equal(current.amount, '1.230000000000000000');
    });
    await t.test('Metadata, FK and estimated-statistics reads preserve pending data on the main connection', async () => {
      await client.execute(`UPDATE ${model.quoteMysql(name)} SET label='pending' WHERE id=1`);
      const fresh = await repository.loadTableMetadata('mb_test', name); assert.ok(fresh.table.DATA_LENGTH !== undefined); assert.ok(fresh.indexes.length);
      assert.equal(client.getMainTransactionState(), true); await second.rollback();
      assert.equal((await second.execute(`SELECT label FROM ${model.quoteMysql(name)} WHERE id=1`)).rows[0].label, 'FIRST ');
      await second.rollback(); await client.rollback();
    });
    await t.test('Structural actions use explicit native DDL, including implicit commit and composite foreign keys', async () => {
      await client.execute(`UPDATE ${model.quoteMysql(name)} SET label='ddl-committed' WHERE id=1`);
      await run(ddl.buildTableDdl('mb_test', name, input('comment', { value: "Demo's 日本語 comment" })));
      assert.equal(client.getMainTransactionState(), false);
      await client.rollback(); assert.equal((await second.execute(`SELECT label FROM ${model.quoteMysql(name)} WHERE id=1`)).rows[0].label, 'ddl-committed'); await second.rollback();
      await run(ddl.buildTableDdl('mb_test', name, input('add-column', { name: 'new_column' })));
      await run(ddl.buildTableDdl('mb_test', name, input('rename-column', { name: 'new_column', value: 'renamed' })));
      await run(ddl.buildTableDdl('mb_test', name, input('add-index', { name: 'new_index', columns: ['label', 'renamed'] })));
      let fresh = await repository.loadTableMetadata('mb_test', name);
      assert.equal(fresh.table.TABLE_COMMENT, "Demo's 日本語 comment"); assert.ok(fresh.columns.some(c => c.COLUMN_NAME === 'renamed')); assert.equal(fresh.indexes.filter(i => i.INDEX_NAME === 'new_index').length, 2);
      await run(ddl.buildTableDdl('mb_test', name, input('drop-index', { name: 'new_index' })));
      await run(ddl.buildTableDdl('mb_test', name, input('drop-column', { name: 'renamed' })));
      await run(ddl.buildTableDdl('mb_test', name, input('add-check', { name: 'new_check', value: 'id > 0' })));
      await run(ddl.buildTableDdl('mb_test', name, input('drop-check', { name: 'new_check' })));
      await run(ddl.buildTableDdl('mb_test', child, input('drop-relation', { name: child + '_fk' })));
      await run(ddl.buildTableDdl('mb_test', child, input('add-relation', { name: child + '_new_fk', columns: ['parent_id'], targetColumns: ['id'] })));
      fresh = await repository.loadTableMetadata('mb_test', child); assert.equal(fresh.relations[0].CONSTRAINT_NAME, child + '_new_fk');
    });
    await t.test('Literal LIKE filters do not treat percent and underscore as wildcards', async () => {
      const fresh = await repository.loadTableMetadata('mb_test', name);
      const row = (await run(model.tableQuery('mb_test', name, fresh.columns, {}, 0, 100))).rows[0];
      await run(model.updateStatement('mb_test', name, fresh, row, { label: '50%_literal' }));
      const conditions = model.defaultConditions(fresh.columns); conditions.label = { operator: 'LIKE', value: '%_', sort: '', type: 'STRING' };
      assert.equal((await run(model.tableQuery('mb_test', name, fresh.columns, conditions, 0, 100))).rows.length, 1);
      await client.rollback();
    });
  } finally {
    try { if (second.main) await second.rollback(); if (client.main) { await client.rollback(); for (const table of created.reverse()) await client.execute(`DROP TABLE ${model.quoteMysql(table)}`); } }
    finally { await second.disconnect(); await client.disconnect(); }
  }
});
