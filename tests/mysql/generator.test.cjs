// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const MysqlClient = require('../../electron/mysql/mysqlClient');
const { mysqlGenerator } = require('../helpers/mysqlGenerator.cjs');
test('Disposable MySQL generator: native metadata, all generation rules, AI reference context and reversible batches', { timeout: 60000 }, async () => {
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE, '1');
  const client = new MysqlClient(), observer = new MysqlClient();
  const table = 'MBT_' + randomBytes(6).toString('hex'), parent = table + '_p'; let f;
  const config = { dbType: 'mysql', host: '127.0.0.1', port: '13306', database: 'mb_test', user: 'test', password: 'test' };
  try {
    await client.connect(config); await observer.connect(config);
    await client.execute(`CREATE TABLE \`${parent}\` (tenant INT, code INT, PRIMARY KEY(tenant,code)) ENGINE=InnoDB`);
    await client.execute(`CREATE TABLE \`${table}\` (id BIGINT AUTO_INCREMENT PRIMARY KEY, seq BIGINT UNSIGNED UNIQUE, label VARCHAR(40), amount DECIMAL(40,18), choice_value VARCHAR(20), optional_value INT NULL, day_value DATE, clock TIME, parent_tenant INT, parent_code INT, computed BIGINT UNSIGNED GENERATED ALWAYS AS (seq + 1), FOREIGN KEY(parent_tenant,parent_code) REFERENCES \`${parent}\`(tenant,code)) ENGINE=InnoDB`);
    await client.execute(`INSERT INTO \`${parent}\` VALUES (7,11)`);
    f = await mysqlGenerator(async (channel, sql, binds) => {
      assert.ok(['execute-sql', 'execute-sql-bg'].includes(channel));
      try { return { success: true, ...await client.execute(sql, binds, null, false, channel === 'execute-sql-bg'), ...client.getTransactionDetails() }; }
      catch (error) { return { success: false, error: error.message, ...client.getTransactionDetails() }; }
    });
    f.state.setSelectedTable(table); await f.waitFor(s => s.columnRules.length > 0 || !!s.error); assert.equal(f.state.columnRules.length, 11, f.state.error);
    await f.state.handleExportForAI(); await f.flush(); assert.equal(f.contexts.length, 1); assert.match(f.contexts[0].initialPrompt, /Existing reference tuples/); assert.match(f.contexts[0].initialPrompt, /"tenant":"?7"?/);
    assert.equal(client.getMainTransactionState(), true);
    const change = (name, values) => { const index = f.state.columnRules.findIndex(r => r.COLUMN_NAME === name); for (const [key, value] of Object.entries(values)) f.state.handleRuleChange(index, key, value); };
    change('seq', { ruleType: 'SEQ_NUM', seqStart: '9007199254740993', seqStep: 1 });
    change('label', { ruleType: 'RANDOM_CHAR', randCharType: 'REGEX', randCharRegex: '^EMP-[A-Z]{4}$' });
    change('amount', { ruleType: 'RANDOM_NUM', randNumMin: '1.25', randNumMax: '1.25', randNumRound: '0.25' });
    change('choice_value', { ruleType: 'CHOICE', choiceValues: 'ACTIVE,LEAVE' });
    change('optional_value', { nullRatio: 100 });
    change('day_value', { ruleType: 'SEQ_DATE', seqStartDate: '2024-02-28' });
    change('parent_tenant', { ruleType: 'FIXED', fixedValue: '7' }); change('parent_code', { ruleType: 'FIXED', fixedValue: '11' });
    f.state.setGenerateCount(3); await f.flush(); f.state.handlePreview(); await f.flush(); assert.equal(f.state.previewRows.length, 3, f.alerts.join('\n'));
    const preview = f.state.previewRows.map(row => ({ ...row }));
    await f.state.handleGenerate(); await f.flush(); assert.equal(f.state.result.status, 'success', f.alerts.join('\n'));
    const rows = (await client.execute(`SELECT * FROM \`${table}\` ORDER BY seq`)).rows;
    assert.equal(rows.length, 3); assert.equal(rows[0].seq, '9007199254740993'); assert.equal(rows[2].day_value, '2024-03-01');
    rows.forEach((row, i) => { assert.equal(row.label, preview[i].label); assert.match(row.label, /^EMP-[A-Z]{4}$/); assert.equal(row.amount, '1.250000000000000000'); assert.ok(['ACTIVE', 'LEAVE'].includes(row.choice_value)); assert.equal(row.optional_value, null); assert.equal(row.parent_code, 11); assert.match(row.clock, /^\d{2}:\d{2}:\d{2}$/); });
    assert.equal(client.getMainTransactionState(), true);
    assert.equal((await observer.execute(`SELECT COUNT(*) n FROM \`${table}\``)).rows[0].n, '0');
    await client.rollback(); await observer.rollback(); assert.equal((await client.execute(`SELECT COUNT(*) n FROM \`${table}\``)).rows[0].n, '0');
    assert.ok(!f.requests.some(r => /commit|rollback/.test(r[0])));
  } finally {
    f?.unmount(); await client.rollback().catch(() => {}); await observer.rollback().catch(() => {});
    await client.execute(`DROP TABLE IF EXISTS \`${table}\``).catch(() => {}); await client.execute(`DROP TABLE IF EXISTS \`${parent}\``).catch(() => {});
    await client.disconnect(); await observer.disconnect();
  }
});
