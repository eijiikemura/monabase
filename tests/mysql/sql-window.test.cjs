// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const MysqlClient = require('../../electron/mysql/mysqlClient');
const { employeeInsert, employees } = require('../fixtures/mysql/employees.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');

test('Disposable MySQL SQL workspace: reported employee INSERT, estimated plans and isolated tuning metadata', async t => {
  if (process.env.MONABASE_MYSQL_DISPOSABLE !== '1') throw new Error('Explicit disposable MySQL permission is required.');
  const config = { host: '127.0.0.1', port: '13306', database: 'mb_test', user: 'test', password: 'test' };
  const client = new MysqlClient(), outside = new MysqlClient();
  const table = 'MBT_' + randomBytes(6).toString('hex');
  let created = false;
  const read = sql => outside.execute(sql, {}, 'mb_test', false, true);
  try {
    await client.connect(config); await outside.connect(config);
    await client.execute(`CREATE TABLE ${table}(employee_code VARCHAR(10) PRIMARY KEY,department_id INT NOT NULL,employee_name VARCHAR(100),email VARCHAR(100),job_title VARCHAR(100),hire_date DATE,salary DECIMAL(12,2),employment_status VARCHAR(20)) ENGINE=InnoDB`); created = true;
    await t.test('The exact fifteen-row statement preserves Unicode, decimals and dates and can be rolled back', async () => {
      const response = await client.execute(employeeInsert(table)); assert.equal(response.rowsAffected, 15);
      assert.equal((await read(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n, '0');
      const rows = (await client.execute(`SELECT employee_name,hire_date,salary FROM ${table} ORDER BY employee_code`)).rows;
      assert.equal(rows[0].employee_name, employees[0][2]); assert.equal(rows[0].salary, '650000.00'); assert.equal(rows[0].hire_date, '2015-04-01');
      await client.rollback(); assert.equal((await read(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n, '0');
      await client.execute(employeeInsert(table)); await client.commit(); assert.equal((await read(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n, '15');
    });
    await t.test('Estimated plans preserve pending rows/savepoints, bindings and native state without extra target execution', async () => {
      await client.execute(`UPDATE ${table} SET salary=salary+1 WHERE employee_code='E001'`);
      await client.execute('SAVEPOINT mb_plan');
      const result = await client.explain(`SELECT e.employee_name,e.salary FROM ${table} e WHERE e.employee_code=:code`, { code: 'E001' }, 'mb_test');
      assert.ok(JSON.parse(result.rows[0].PLAN_TABLE_OUTPUT).query_block);
      assert.equal(client.getMainTransactionState(), true);
      assert.equal((await read(`SELECT salary FROM ${table} WHERE employee_code='E001'`)).rows[0].salary, '650000.00');
      assert.equal((await client.execute(`SELECT salary FROM ${table} WHERE employee_code='E001'`)).rows[0].salary, '650001.00');
      await client.execute('ROLLBACK TO SAVEPOINT mb_plan');
      await client.rollback();
      await assert.rejects(client.explain(`DELETE FROM ${table}`), /SELECT statements only/);
      await assert.rejects(client.explain(`SELECT * FROM ${table} FOR UPDATE`), /read-only/);
      await assert.rejects(client.explain('SELECT 1; COMMIT'), /one MySQL statement/);
      await assert.rejects(client.explain(`SELECT * FROM ${table}_missing`), /ER_NO_SUCH_TABLE/);
      assert.notEqual(client.getTransactionDetails().transactionStatus, 'unknown');
    });
    await t.test('Native JSON trees, alias-safe metadata and offline tuning prompts use only catalogs and SHOW CREATE', async () => {
      const requests = [];
      const dependencies = { '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, sql, binds) => {
        requests.push([channel, sql]);
        return { success: true, ...await client.execute(sql, binds, null, false, true) };
      } } } };
      const planTools = loadTypeScript('src/features/mysql/sqlPlan.ts', dependencies);
      const sql = `WITH selected AS (SELECT * FROM mb_test.${table} WHERE salary>:salary) SELECT employee_name FROM selected ORDER BY employee_code`;
      const result = await client.explain(sql, { salary: '300000.00' }, 'mb_test');
      assert.ok(planTools.parseMysqlPlan(result.rows).tree.length);
      const snapshot = { sql, schema: 'mb_test', rows: result.rows, planKind: 'estimated', binds: [{ name: 'salary', placeholder: 'salary', type: 'string', value: '300000.00' }] };
      const prompt = await planTools.buildMysqlTuningPrompt(snapshot, client.getDbVersion(), false, 'en');
      assert.match(prompt, new RegExp(table)); assert.match(prompt, /CREATE TABLE/); assert.match(prompt, /PRIMARY/);
      assert.ok(!prompt.includes('300000.00')); assert.ok(!prompt.includes('佐藤 花子'));
      assert.ok(requests.every(([channel, sql]) => channel === 'execute-sql-bg' && (sql.includes('information_schema.') || sql.startsWith('SHOW CREATE TABLE'))));
      const readonly = new MysqlClient();
      try { await readonly.connect({ ...config, readonly: true }); assert.ok((await readonly.explain(`SELECT * FROM ${table}`)).rows.length); }
      finally { await readonly.disconnect(); }
    });
  } finally {
    try { if (client.main) { await client.rollback(); if (created) await client.execute(`DROP TABLE ${table}`); } }
    finally { await client.disconnect(); await outside.disconnect(); }
  }
});
