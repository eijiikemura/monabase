// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const MysqlClient = require('../../electron/mysql/mysqlClient');
const { mysqlBuilder } = require('../helpers/mysqlBuilder.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { quoteMysql: q } = loadTypeScript('src/features/mysql/table/tableModel.ts');
test('Disposable MySQL builder: native table/view metadata, composite joins, exact pending results and reviewed AI settings', { timeout: 60000 }, async () => {
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE, '1');
  const client = new MysqlClient(), observer = new MysqlClient();
  const base = 'MBT_' + randomBytes(6).toString('hex'), parent = base + '_p', child = base + '_c', view = base + '_v';
  const config = { dbType: 'mysql', host: '127.0.0.1', port: '13306', database: 'mb_test', user: 'test', password: 'test' };
  let f;
  const object = (name, category = 'TABLE') => ({ key: name, dbType: 'mysql', schema: 'mb_test', category, name, displayName: name });
  try {
    await client.connect(config); await observer.connect(config);
    await client.execute(`CREATE TABLE ${q(parent)} (tenant INT, id INT, label VARCHAR(50) COMMENT 'Department name', PRIMARY KEY(tenant,id)) ENGINE=InnoDB COMMENT='Fictional departments'`);
    await client.execute(`CREATE TABLE ${q(child)} (tenant INT, parent_id INT, amount DECIMAL(40,18), label VARCHAR(50), FOREIGN KEY(tenant,parent_id) REFERENCES ${q(parent)}(tenant,id)) ENGINE=InnoDB`);
    await client.main.promise().query(`CREATE VIEW ${q(view)} AS SELECT tenant,parent_id,amount,label FROM ${q(child)}`);
    await client.execute(`INSERT INTO ${q(parent)} VALUES (1,7,'Department A'),(2,7,'Department B')`); await client.commit();
    await client.execute(`INSERT INTO ${q(child)} VALUES (1,7,12345678901234567890.123456789012345678,'pending-builder-row')`);
    f = await mysqlBuilder(async (channel, sql, binds) => {
      assert.ok(['execute-sql', 'execute-sql-bg'].includes(channel));
      try { return { success: true, ...await client.execute(sql, binds, null, false, channel === 'execute-sql-bg'), ...client.getTransactionDetails() }; }
      catch (error) { return { success: false, error: error.message, ...client.getTransactionDetails() }; }
    });
    await f.state.handleAddObjectsToBuilder([object(parent), object(child)]); await f.flush();
    const [a,b] = f.state.queryTables; assert.equal(a.columns.length, 3); assert.equal(b.columns.length, 4);
    f.state.handleFieldDoubleClick(a, 'label'); f.state.handleFieldDoubleClick(b, 'amount'); await f.flush();
    f.state.editor.setQueryJoins([{ id: 'j1', fromTableId: a.id, fromCol: 'tenant', toTableId: b.id, toCol: 'tenant', joinType: 'INNER' }, { id: 'j2', fromTableId: a.id, fromCol: 'id', toTableId: b.id, toCol: 'parent_id', joinType: 'INNER' }]); await f.flush();
    f.state.handleCriteriaChange(f.state.queryFields[0].id, "LIKE 'Department %'"); await f.flush();
    await f.state.handleExecuteSql(); await f.flush(); assert.equal(f.state.rows.length, 1, f.alerts.join('\n')); assert.equal(f.state.rows[0].amount, '12345678901234567890.123456789012345678');
    assert.equal(client.getMainTransactionState(), true); assert.equal(f.states.at(-1).hasUncommittedTx, true);
    assert.equal((await observer.execute(`SELECT COUNT(*) n FROM ${q(child)}`)).rows[0].n, '0'); await observer.rollback();
    await f.state.handleRequestAi(); await f.flush(); assert.equal(f.contexts.length, 1, f.alerts.join('\n'));
    const context = f.contexts[0]; assert.match(context.referencePrompt, /MySQL 8.4/); assert.match(context.referencePrompt, /Fictional departments/); assert.match(context.referencePrompt, /Department name/); assert.ok(!context.referencePrompt.includes('pending-builder-row'));
    const answer = { queryTables: f.state.queryTables, queryFields: f.state.queryFields.map(field => ({ ...field, groupBy: field.columnName === 'amount' ? 'SUM' : 'GROUP BY' })), queryJoins: f.state.queryJoins };
    const before = f.calls.filter(c => c[0] === 'execute-sql').length;
    context.onResponse(JSON.stringify(answer)); await f.flush(); assert.match(f.state.ai.review.afterSql, /SUM\(t2\.`amount`\)/);
    await f.state.ai.applyReview(); await f.flush(); assert.equal(f.calls.filter(c => c[0] === 'execute-sql').length, before); assert.equal(client.getMainTransactionState(), true);
    await f.state.handleExecuteSql(); await f.flush(); assert.equal(Object.values(f.state.rows[0]).includes('12345678901234567890.123456789012345678'), true);
    await f.state.handleAddObjectsToBuilder([object(view, 'VIEW')]); await f.flush(); assert.equal(f.state.queryTables.length, 3);
    const v = f.state.queryTables[2]; f.state.handleRemoveTable(a.id); f.state.handleRemoveTable(b.id); await f.flush(); f.state.handleFieldDoubleClick(v, 'amount'); await f.flush();
    await f.state.handleRequestAi(); await f.flush(); assert.match(f.contexts.at(-1).referencePrompt, /CREATE.*VIEW/s); assert.match(f.contexts.at(-1).referencePrompt, /"objectType": "VIEW"/);
    await f.state.handleExecuteSql(); await f.flush(); assert.equal(f.state.rows.length, 1); assert.equal(f.state.rows[0].amount, '12345678901234567890.123456789012345678');
    await client.rollback(); await f.state.handleExecuteSql(); await f.flush(); assert.equal(f.state.rows.length, 0); assert.equal(f.states.at(-1).hasUncommittedTx, false);
    assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${q(child)}`)).rows[0].n, '0');
    assert.ok(!f.calls.some(c => /commit|rollback/.test(c[0])));
  } finally {
    f?.unmount(); await client.rollback().catch(() => {}); await observer.rollback().catch(() => {});
    await client.main?.promise().query(`DROP VIEW IF EXISTS ${q(view)}`).catch(() => {});
    for (const name of [child,parent]) await client.execute(`DROP TABLE IF EXISTS ${q(name)}`).catch(() => {});
    await client.disconnect(); await observer.disconnect();
  }
});
