// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const MysqlClient = require('../../electron/mysql/mysqlClient');
const { indexModules, mysqlIndex } = require('../helpers/mysqlIndex.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');

test('Disposable MySQL indexes: table-scoped identity, native metadata/DDL, dependencies, transactions and paginated catalog reads', { timeout: 90000 }, async t => {
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE, '1');
  const client = new MysqlClient(), base = 'MBT_' + randomBytes(6).toString('hex'), first = base + '_p', child = base + '_c', second = base + '_s'; let f;
  const quote = name => '`' + name.replaceAll('`', '``') + '`';
  const object = (table, name) => ({ key: JSON.stringify(['mysql', 'mb_test', 'INDEX', table, name]), dbType: 'mysql', category: 'INDEX', schema: 'mb_test', parentName: table, name, displayName: `${name} (${table})` });
  const invoke = async (channel, sql, binds = {}) => {
    try { const result = await client.execute(sql, binds, null, false, channel === 'execute-sql-bg'); return { success: true, ...result, ...(channel === 'execute-sql' ? client.getTransactionDetails() : {}) }; }
    catch (error) { return { success: false, error: error.message, ...(channel === 'execute-sql' ? client.getTransactionDetails() : {}) }; }
  };
  const { model, repository } = indexModules(invoke);
  const listing = loadTypeScript('src/features/objects/mysqlObjects.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } } });
  try {
    await client.connect({ dbType: 'mysql', host: '127.0.0.1', port: '13306', database: 'mb_test', user: 'test', password: 'test' });
    for (const table of [first, second]) await client.execute(`CREATE TABLE ${quote(table)} (id INT PRIMARY KEY,label VARCHAR(100) NOT NULL,amount INT,KEY shared(label(10) DESC)) ENGINE=InnoDB`);
    await client.execute(`CREATE TABLE ${quote(child)}(id INT PRIMARY KEY,ref INT,KEY shared(ref),CONSTRAINT ${quote(base + '_fk')} FOREIGN KEY(ref) REFERENCES ${quote(first)}(id)) ENGINE=InnoDB`);
    await t.test('Native catalog reads retain pending data, exact source, key order, direction and per-table duplicate names', async () => {
      await client.execute(`INSERT INTO ${quote(first)} VALUES(1,'pending',10)`);
      const a = await repository.loadMysqlIndex(object(first, 'shared')), b = await repository.loadMysqlIndex(object(second, 'shared'));
      assert.match(a.ddl, /`label`\(10\) DESC/); assert.ok(a.ddl.includes(quote(first))); assert.ok(b.ddl.includes(quote(second))); assert.equal(String(a.keys[0].SUB_PART), '10');
      assert.equal(client.getMainTransactionState(), true); await client.rollback();
      assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${quote(first)}`)).rows[0].n, '0');
      const reference = await listing.loadMysqlReference(object(first, 'shared')); assert.equal(reference.definition, a.ddl);
    });
    await t.test('Create review is read-only until confirmed; successful native DDL commits pending main-session work', async () => {
      f = await mysqlIndex(invoke); f.state.update({ table: first, name: 'created', unique: true }); await f.waitFor(s => !s.loading && s.columns.length);
      f.state.update({ parts: [{ column: 'amount', expression: '', prefix: '', descending: true }, { column: 'label', expression: '', prefix: '12', descending: false }] }); await f.flush();
      await client.execute(`INSERT INTO ${quote(first)} VALUES(33,'creation',42)`); f.state.prepare(); await f.flush(); assert.ok(f.state.review); assert.equal(client.getMainTransactionState(), true);
      assert.ok(!(await listing.listMysqlObjects('mb_test','INDEX','created',0)).some(row => row.parentName === first));
      await f.state.execute(); await f.flush(); assert.equal(f.state.error, ''); assert.equal(f.changes.at(-1).name, 'created'); assert.equal(f.states.at(-1).hasUncommittedTx, false);
      await client.rollback(); assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${quote(first)} WHERE id=33`)).rows[0].n,'1');
      const created = await repository.loadMysqlIndex(object(first,'created')); assert.equal(created.unique,true); assert.equal(created.keys[0].COLUMN_NAME,'amount'); assert.equal(created.keys[0].COLLATION,'D'); assert.equal(created.keys[1].SUB_PART,'12');
      await client.execute(repository.dropIndexStatement(object(first,'created'),created).sql); f.unmount(); f = undefined;
    });
    await t.test('Native creation, separately reviewed rename/visibility, stale review refusal and confirmed deletion run once on the main session', async () => {
      f = await mysqlIndex(invoke, { object: object(first, 'shared') }); await f.waitFor(s => !s.loading && s.details);
      f.state.update({ name: 'renamed' }); await f.flush(); f.state.prepare(); await f.flush(); assert.ok(f.state.review, f.state.error);
      await f.state.execute(); await f.flush(); assert.equal(f.state.error, ''); assert.equal(f.changes.at(-1).name, 'renamed'); assert.equal(f.states.at(-1).hasUncommittedTx, false);
      const renamed = await repository.loadMysqlIndex(object(first, 'renamed')); assert.equal(renamed.visible, true); assert.equal(renamed.keys[0].COLUMN_NAME, 'label');
      f.props.object = object(first, 'renamed'); await f.waitFor(s => !s.loading && s.details && s.form.name === 'renamed');
      f.state.update({ visible: false }); await f.flush(); f.state.prepare(); await f.flush(); await f.state.execute(); await f.flush(); assert.equal(f.state.error, ''); assert.equal(f.state.details.visible, false);
      f.state.update({ visible: true }); await f.flush(); f.state.prepare(); await f.flush();
      await client.execute(`ALTER TABLE ${quote(first)} ALTER INDEX renamed VISIBLE`);
      const before = f.calls.filter(call => call[0] === 'execute-sql').length; await f.state.execute(); await f.flush();
      assert.equal(f.state.error, 'index_changed_reload'); assert.equal(f.calls.filter(call => call[0] === 'execute-sql').length, before);
      await f.state.execute(); await f.flush(); assert.equal(f.calls.filter(call => call[0] === 'execute-sql').length, before);
      await f.state.load(); await f.flush(); f.state.prepare(true); await f.flush(); assert.ok(f.state.review); await f.state.execute(); await f.flush(); assert.equal(f.changes.at(-1), 'drop');
      await assert.rejects(() => repository.loadMysqlIndex(object(first, 'renamed')), /no longer/); f.unmount(); f = undefined;
      const metadata = await loadTypeScript('src/features/mysql/table/tableRepository.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } } }).loadTableMetadata('mb_test', first);
      const statement = model.createIndexStatement({ ...model.blankIndexForm('mb_test'), table: first, name: 'functional', parts: [{ column: '', expression: 'LOWER(`label`)', prefix: '', descending: false }] }, metadata.columns);
      await client.execute(statement.sql); const func = await repository.loadMysqlIndex(object(first, 'functional')); assert.match(String(func.keys[0].EXPRESSION), /lower/i); assert.match(func.ddl, /KEY `functional` \(\(/);
      await client.execute(repository.dropIndexStatement(object(first, 'functional'), func).sql);
    });
    await t.test('FULLTEXT, SPATIAL and escaped index names retain native source and type without Oracle assumptions', async () => {
      const odd = 'odd`(.*)日本語'; await client.execute(`CREATE INDEX ${quote(odd)} ON ${quote(second)} (label(4))`);
      const escaped = await repository.loadMysqlIndex(object(second,odd)); assert.ok(escaped.ddl.includes(quote(odd))); assert.equal(escaped.keys[0].SUB_PART,'4');
      await client.execute(`CREATE FULLTEXT INDEX fulltext_key ON ${quote(second)} (label)`);
      const fulltext = await repository.loadMysqlIndex(object(second,'fulltext_key')); assert.ok(fulltext.definition.startsWith('FULLTEXT KEY'));
      await client.execute(`ALTER TABLE ${quote(second)} ADD COLUMN point_value POINT NOT NULL SRID 4326, ADD SPATIAL INDEX spatial_key(point_value)`);
      const spatial = await repository.loadMysqlIndex(object(second,'spatial_key')); assert.ok(spatial.definition.startsWith('SPATIAL KEY')); assert.equal(spatial.keys[0].INDEX_TYPE,'SPATIAL');
    });
    await t.test('Primary and foreign-key-supporting indexes cannot be dropped through index actions', async () => {
      const primary = await repository.loadMysqlIndex(object(first, 'PRIMARY')), fk = await repository.loadMysqlIndex(object(child, 'shared'));
      assert.equal(primary.primary, true); assert.ok(primary.references.length); assert.ok(fk.references.length);
      assert.throws(() => repository.dropIndexStatement(object(first, 'PRIMARY'), primary), /primary key/);
      assert.throws(() => repository.dropIndexStatement(object(child, 'shared'), fk), /foreign keys/);
    });
    await t.test('Search returns 100 indexes per page with distinct identities even when names repeat across tables', async () => {
      for (const table of [first, second, child]) await client.execute(`ALTER TABLE ${quote(table)} ` + Array.from({ length: 35 }, (_, i) => `ADD INDEX ${quote(base + '_page' + i)} (id)`).join(', '));
      const page1 = await listing.listMysqlObjects('mb_test', 'INDEX', base + '_page', 0), page2 = await listing.listMysqlObjects('mb_test', 'INDEX', base + '_page', 100);
      assert.equal(page1.length, 100); assert.equal(page2.length, 5); assert.equal(new Set([...page1, ...page2].map(row => row.key)).size, 105);
      const schemaOnly = await listing.listMysqlObjects('MB_TEST', 'INDEX', base, 0); assert.equal(schemaOnly.length, 0);
    });
  } finally {
    f?.unmount(); await client.rollback().catch(() => {});
    for (const table of [child, first, second]) await client.execute(`DROP TABLE IF EXISTS ${quote(table)}`).catch(() => {});
    await client.disconnect();
  }
});
