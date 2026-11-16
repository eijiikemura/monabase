// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const MysqlClient = require('../../electron/mysql/mysqlClient');
const config = { dbType: 'mysql', host: '127.0.0.1', port: '13306', database: 'mb_test', user: 'test', password: 'test' };

test('Disposable MySQL 8.4: SQL, transaction safety, cancellation, precision and read-only isolation', async t => {
  if (process.env.MONABASE_MYSQL_DISPOSABLE !== '1') throw new Error('Start tests/fixtures/mysql/compose.yml and set MONABASE_MYSQL_DISPOSABLE=1. These tests write only to its disposable mb_test database.');
  const client = new MysqlClient(), observer = new MysqlClient();
  const table = 'MBT_' + randomBytes(6).toString('hex');
  const q = sql => client.execute(sql, {}, config.database);
  let created = false;
  try {
    await client.connect(config); await observer.connect(config);
    await q(`CREATE TABLE ${table}(id BIGINT PRIMARY KEY, amount DECIMAL(40,20), label VARCHAR(100)) ENGINE=InnoDB`); created = true;
    assert.deepEqual(client.getTransactionDetails(), { transactionStatus: 'idle', autocommit: false, hasUncommittedTx: false });
    await t.test('Copied host whitespace is removed before connecting without changing credentials', async () => {
      const copied = new MysqlClient();
      try {
        await copied.connect({ ...config, host: ' \t127.0.0.1 \n' });
        assert.equal(copied.main.config.host, '127.0.0.1');
        assert.equal((await copied.execute('SELECT 1 n')).rows[0].n, '1');
      } finally { await copied.disconnect(); }
      const secure = new MysqlClient();
      await assert.rejects(secure.connect({ ...config, host: ' 127.0.0.1 ', mysqlSslMode: 'verify-full' }), /DNS hostname/);
    });
    await t.test('Plain SELECT and BEGIN keep a read transaction without a pending-write indicator', async () => {
      await q(`SELECT * FROM ${table}`);
      assert.equal(client.getTransactionDetails().transactionStatus, 'active');
      assert.equal(client.getMainTransactionState(), false);
      await q('BEGIN'); assert.equal(client.getMainTransactionState(), false);
      await client.rollback(); assert.equal(client.getMainTransactionState(), false);
    });
    await t.test('Locking reads and SELECT functions that write are detected from native result terminators', async () => {
      const fn = table + '_write'; let exists = false;
      try {
        await q(`INSERT INTO ${table} VALUES(90000,1,'lock fixture')`); await client.commit();
        await q(`SELECT * FROM ${table} WHERE id=90000 FOR UPDATE`);
        assert.equal(client.getMainTransactionState(), true); await client.rollback();
        await q(`DELETE FROM ${table} WHERE id=90000`); await client.commit();
        await client.main.promise().query(`CREATE FUNCTION ${fn}() RETURNS INT DETERMINISTIC MODIFIES SQL DATA BEGIN INSERT INTO ${table} VALUES(90001,1,'function fixture'); RETURN 1; END`); exists = true;
        await q(`SELECT ${fn}() AS result`);
        assert.equal(client.getMainTransactionState(), true);
        assert.equal((await observer.execute(`SELECT COUNT(*) n FROM ${table}`, {}, null, false, true)).rows[0].n, '0');
        await client.rollback();
        await q(`SELECT * FROM ${table}`); assert.equal(client.getMainTransactionState(), false);
      } finally {
        await client.rollback();
        await q(`DELETE FROM ${table} WHERE id IN (90000,90001)`); await client.commit();
        if (exists) await client.main.promise().query(`DROP FUNCTION ${fn}`);
      }
    });
    await t.test('Metadata and pending rows use independent connections', async () => {
      await q(`INSERT INTO ${table} VALUES(1,1.25,'pending')`);
      assert.equal(client.getMainTransactionState(), true);
      assert.ok((await client.getSchemas()).includes('mb_test'));
      const outside = await observer.execute(`SELECT COUNT(*) n FROM ${table}`, {}, null, false, true);
      assert.equal(outside.rows[0].n, '0');
      assert.equal(client.getMainTransactionState(), true);
      await client.rollback();
      assert.equal(client.getMainTransactionState(), false);
    });
    await t.test('No status probes overwrite ROW_COUNT or warning diagnostics', async () => {
      await q(`INSERT INTO ${table} VALUES(1,1.25,'first')`);
      assert.equal((await q('SELECT ROW_COUNT() n')).rows[0].n, '1');
      await q(`INSERT IGNORE INTO ${table} VALUES(1,1.25,'duplicate')`);
      assert.equal((await q('SHOW WARNINGS')).rows.length, 1);
      await assert.rejects(q(`INSERT INTO ${table} VALUES(1,2,'duplicate')`), /ER_DUP_ENTRY/);
      assert.equal((await q('SHOW WARNINGS')).rows.length, 1);
      assert.equal(client.getMainTransactionState(), true);
      assert.equal((await q('SELECT ROW_COUNT() n')).rows[0].n, '-1');
    });
    await t.test('A failed SQL preserves earlier DML and savepoint rollback affects only later changes', async () => {
      await q('SAVEPOINT test_sp');
      await q(`UPDATE ${table} SET label='second' WHERE id=1`);
      await q('ROLLBACK TO SAVEPOINT test_sp');
      assert.equal((await q(`SELECT label FROM ${table} WHERE id=1`)).rows[0].label, 'first');
      await client.commit();
      assert.equal((await observer.execute(`SELECT label FROM ${table}`, {}, null, false, true)).rows[0].label, 'first');
      await client.rollback();
    });
    await t.test('Failed DDL can implicitly commit earlier DML and status reports idle', async () => {
      await q(`UPDATE ${table} SET label='implicit' WHERE id=1`);
      await assert.rejects(q(`CREATE TABLE ${table}(id INT)`), /ER_TABLE_EXISTS/);
      assert.equal(client.getMainTransactionState(), false);
      assert.equal((await observer.execute(`SELECT label FROM ${table}`, {}, null, false, true)).rows[0].label, 'implicit');
    });
    await t.test('Precise numbers, duplicate labels, Unicode, NULL and date values are preserved', async () => {
      const result = await client.execute("SELECT CAST(:big AS UNSIGNED) x, CAST(:decimal AS DECIMAL(40,20)) x, :label label, NULL missing, CAST('2026-11-12 12:34:56.123456' AS DATETIME(6)) d", { big: '18446744073709551615', decimal: '12345678901234567890.12345678901234567890', label: '日本語; \' and :fake' });
      assert.equal(result.rows[0].x, '18446744073709551615');
      assert.equal(result.rows[0].x_2, '12345678901234567890.12345678901234567890');
      assert.equal(result.rows[0].label, "日本語; ' and :fake");
      assert.equal(result.rows[0].missing, null);
      assert.equal(result.rows[0].d, '2026-11-12 12:34:56.123456');
      const json = await client.execute("SELECT JSON_OBJECT('large', CAST(:big AS UNSIGNED)) j", { big: '18446744073709551615' });
      assert.equal(json.rows[0].j, '{"large": 18446744073709551615}');
    });
    await t.test('Cancellation targets only the active main query and preserves pending DML', async () => {
      await q(`UPDATE ${table} SET label='keep pending' WHERE id=1`);
      let signal;
      const started = new Promise(resolve => { signal = resolve; });
      const originalRun = client.run.bind(client);
      client.run = (db, statement) => { const result = originalRun(db, statement); if (statement.sql.includes('SLEEP')) signal(); return result; };
      const pending = assert.rejects(q('SELECT SLEEP(20)'), /INTERRUPTED|cancelled/);
      await started;
      assert.equal((await client.breakExecution()).success, true);
      await pending;
      client.run = originalRun;
      assert.equal((await q(`SELECT label FROM ${table}`)).rows[0].label, 'keep pending');
      assert.equal((await q('SELECT 123 ok')).rows[0].ok, '123');
      await client.rollback();
    });
    await t.test('Query timeout cancels at the server without replay or whole-transaction rollback', async () => {
      client.timeout = 0.1;
      await assert.rejects(q('SELECT SLEEP(20)'), /INTERRUPTED|cancelled/);
      client.timeout = 0;
      assert.equal((await q('SELECT 456 ok')).rows[0].ok, '456');
    });
    await t.test('Native read-only transactions and the SQL policy reject modifications', async () => {
      const readonly = new MysqlClient();
      try {
        await readonly.connect({ ...config, readonly: true });
        assert.equal((await readonly.execute(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n, '1');
        await assert.rejects(readonly.execute(`UPDATE ${table} SET label='bad'`), /read-only/);
        await assert.rejects(readonly.execute('START TRANSACTION READ WRITE'), /overrides/);
        await assert.rejects(readonly.main.promise().query(`UPDATE ${table} SET label='native bypass'`), /read.only/i);
        await readonly.main.promise().query('SHOW WARNINGS');
        await readonly.rollback();
      } finally { await readonly.disconnect(); }
    });
    await t.test('Native deadlock rollback is reported from the server without automatic replay', async () => {
      const deadlockTable = table + '_dl';
      let exists = false;
      try {
        await q(`CREATE TABLE ${deadlockTable}(id INT PRIMARY KEY, v INT) ENGINE=InnoDB`); exists = true;
        await q(`INSERT INTO ${deadlockTable} VALUES(1,0),(2,0)`); await client.commit();
        await q(`UPDATE ${deadlockTable} SET v=1 WHERE id=1`);
        await observer.execute(`UPDATE ${deadlockTable} SET v=2 WHERE id=2`);
        const results = await Promise.allSettled([
          q(`UPDATE ${deadlockTable} SET v=1 WHERE id=2`),
          observer.execute(`UPDATE ${deadlockTable} SET v=2 WHERE id=1`)
        ]);
        assert.equal(results.filter(result => result.status === 'rejected').length, 1);
        const rejected = results.findIndex(result => result.status === 'rejected');
        assert.match(results[rejected].reason.message, /ER_LOCK_DEADLOCK/);
        assert.equal([client, observer][rejected].getMainTransactionState(), false);
        assert.equal([client, observer][1 - rejected].getMainTransactionState(), true);
      } finally {
        await Promise.all([client.rollback(), observer.rollback()]);
        if (exists) await q(`DROP TABLE ${deadlockTable}`);
      }
    });
    await t.test('Oversized results are cancelled and the main connection remains usable', async () => {
      await assert.rejects(q(`SELECT 1 n FROM information_schema.columns a CROSS JOIN information_schema.columns b LIMIT 10001`), /exceeds/);
      assert.equal((await q('SELECT 1 n')).rows[0].n, '1');
    });
    await t.test('Multi-statement scripts and session overrides are rejected before any SQL executes', async () => {
      await assert.rejects(q(`UPDATE ${table} SET label='bad'; COMMIT;`), /one MySQL statement/);
      assert.equal((await q(`SELECT label FROM ${table}`)).rows[0].label, 'implicit');
      await assert.rejects(q('SET autocommit=1'), /not supported/);
    });
    await t.test('TLS verification fails closed for an untrusted server certificate', async () => {
      const secure = new MysqlClient();
      try { await assert.rejects(secure.connect({ ...config, host: 'localhost', mysqlSslMode: 'verify-full' }), /connection failed/); }
      finally { await secure.disconnect(); }
    });
    await t.test('Verified TLS accepts a trusted certificate with a matching DNS name', async () => {
      const secure = new MysqlClient();
      try {
        await secure.connect({ ...config, host: 'localhost', mysqlSslMode: 'verify-full', mysqlSslCaFile: path.resolve(__dirname, '../../local/mysql-test-tls/ca.pem') });
        assert.equal((await secure.execute('SELECT 777 n')).rows[0].n, '777');
        assert.equal(secure.main.stream.encrypted, true);
        assert.equal(secure.main.stream.authorized, true);
      } finally { await secure.disconnect(); }
    });
    await t.test('Unknown connection state never becomes an idle transaction or retries COMMIT', async () => {
      const lost = new MysqlClient();
      await lost.connect(config);
      lost.main.destroy(); lost.monitor.invalidate();
      assert.equal(lost.getMainTransactionState(), undefined);
      await assert.rejects(lost.commit(), /state is unknown/);
      await lost.disconnect();
    });
  } finally {
    try { await client.rollback(); if (created) await q(`DROP TABLE ${table}`); }
    finally { await Promise.all([client.disconnect(), observer.disconnect()]); }
  }
});
