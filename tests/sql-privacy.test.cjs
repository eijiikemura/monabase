// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectSqlPrivacy } = require('../electron/services/sqlPrivacy');
const { createSqlWindowHarness } = require('./helpers/sqlWindow.cjs');

const dummy = 'DUMMY_NOT_A_REAL_PASSWORD';
const sensitive = [
  ['postgresql', `ALTER ROLE demo PASSWORD '${dummy}'`],
  ['postgresql', `CREATE USER demo WITH ENCRYPTED PASSWORD E'${dummy}'`],
  ['postgresql', `ALTER USER demo PASSWORD $key$${dummy}$key$`],
  ['postgresql', `CREATE USER MAPPING FOR demo SERVER remote OPTIONS (password '${dummy}')`],
  ['postgresql', `CREATE USER MAPPING FOR demo SERVER remote OPTIONS ("password" '${dummy}')`],
  ['oracle', `ALTER USER demo IDENTIFIED /* comment */ BY "${dummy}" REPLACE "OLD_DUMMY"`],
  ['oracle', `CREATE USER demo IDENTIFIED BY VALUES '${dummy}'`],
  ['oracle', `CREATE SHARED PUBLIC DATABASE LINK demo CONNECT TO demo IDENTIFIED BY "${dummy}" USING 'db'`],
  ['oracle', `ALTER DATABASE LINK demo CONNECT TO demo IDENTIFIED BY "${dummy}"`],
  ['postgresql', `CREATE SUBSCRIPTION demo CONNECTION 'host=example.invalid password=${dummy}' PUBLICATION demo_publication`],
  ['postgresql', `ALTER SUBSCRIPTION "Demo" CONNECTION 'postgresql://demo:${dummy}@example.invalid/db'`],
  ['postgresql', `CREATE /* nested /* comment */ x */ SUBSCRIPTION "Demo" /* options */ CONNECTION $conn$postgresql://demo:${dummy}@example.invalid/db$conn$ PUBLICATION demo_publication`],
  ['postgresql', 'ALTER SUBSCRIPTION demo CONNECTION :connection'],
  ['oracle', `ADMINISTER KEY MANAGEMENT SET KEYSTORE OPEN IDENTIFIED BY "${dummy}"`],
  ['oracle', `administer /* comment */ key /* comment */ management CREATE KEYSTORE '/fictional/keystore' IDENTIFIED BY "${dummy}"`],
  ['oracle', `ADMINISTER KEY MANAGEMENT EXPORT ENCRYPTION KEYS WITH SECRET '${dummy}' TO '/fictional/export' IDENTIFIED BY "OLD_DUMMY"`],
  ['oracle', 'ADMINISTER KEY MANAGEMENT SET KEYSTORE OPEN IDENTIFIED BY EXTERNAL STORE'],
  ['oracle', `BEGIN EXECUTE IMMEDIATE 'ALTER USER demo IDENTIFIED BY "${dummy}"'; END;`],
  ['oracle', `BEGIN EXECUTE IMMEDIATE q'[ALTER USER demo IDENTIFIED BY "${dummy}"]'; END;`],
  ['oracle', `DECLARE stmt VARCHAR2(200); BEGIN stmt := 'ALTER USER demo IDENTIFIED BY "${dummy}"'; EXECUTE IMMEDIATE stmt; END;`],
  ['postgresql', `DO $do$ BEGIN EXECUTE 'ALTER ROLE demo PASSWORD ''${dummy}'''; END; $do$;`],
  ['postgresql', `DO LANGUAGE plpgsql 'BEGIN EXECUTE ''ALTER ROLE demo PASSWORD ''''${dummy}''''''; END;';`],
  ['postgresql', `DO $$ BEGIN EXECUTE 'ALTER RO' || 'LE ' || quote_ident('demo') || ' PASS' || 'WORD ' || quote_literal('${dummy}'); END; $$;`],
  ['oracle', `CREATE OR REPLACE PROCEDURE demo AS BEGIN EXECUTE IMMEDIATE 'ALTER USER demo IDENTIFIED BY "${dummy}"'; END;`],
  ['postgresql', `CREATE FUNCTION demo() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'ALTER ROLE demo PASSWORD ''${dummy}'''; END; $$;`]
];

test('Credential-bearing SQL is recognized across comments, quoting, binds, statements and case', () => {
  for (const [dialect, sql] of sensitive) {
    assert.equal(inspectSqlPrivacy(sql, dialect).sensitive, true, sql.split(' ').slice(0, 3).join(' '));
    assert.equal(inspectSqlPrivacy(sql).sensitive, true);
    assert.ok(!JSON.stringify(inspectSqlPrivacy(sql, dialect)).includes(dummy));
  }
  assert.equal(inspectSqlPrivacy("/* leading */ alter /* nested /* x */ comment */ role demo password :p", 'postgresql').sensitive, true);
  assert.equal(inspectSqlPrivacy("SELECT 1; ALTER ROLE demo PASSWORD 'dummy'; SELECT 2").sensitive, true);
  for (const sql of ["SELECT 'PASSWORD' AS value", 'SELECT password FROM demo', 'CREATE TABLE demo(password text)',
    "-- ALTER ROLE demo PASSWORD 'dummy'\nSELECT 1", 'ALTER ROLE demo SET statement_timeout = 100',
    'CREATE ROLE password LOGIN', "SELECT 'ALTER ROLE demo PASSWORD ''dummy'''", 'ALTER USER demo IDENTIFIED EXTERNALLY',
    'ALTER SUBSCRIPTION demo ENABLE', 'ALTER SUBSCRIPTION demo DISABLE',
    'ALTER SUBSCRIPTION demo RENAME TO connection', 'ALTER SUBSCRIPTION connection ENABLE',
    'ALTER SUBSCRIPTION demo REFRESH PUBLICATION', 'DROP SUBSCRIPTION demo',
    "SELECT 'ADMINISTER KEY MANAGEMENT SET KEYSTORE OPEN'", 'SELECT subscription, administer FROM demo',
    '-- ADMINISTER KEY MANAGEMENT SET KEYSTORE OPEN\nSELECT 1',
    'CREATE TABLE subscription(connection text)', 'CREATE TABLE administer(key text)',
    "SELECT $$CREATE SUBSCRIPTION demo CONNECTION 'not a statement'$$"]) {
    assert.equal(inspectSqlPrivacy(sql).sensitive, false, sql);
  }
});

function historyFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-sql-privacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'history.json'), handlers = new Map();
  let enabled = true;
  require('../electron/ipc/files').registerFileHandlers({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, HISTORY_FILE: file,
    getValidatedSettings: () => ({ sqlHistoryEnabled: enabled, sqlHistoryLimit: 100 }), t: key => key
  });
  return { file, handlers, enable: value => { enabled = value; },
    add: sql => handlers.get('add-sql-history')({}, { sql, executeTime: 'fictional', duration: 1, rowCount: 0 }) };
}

test('Main history boundary refuses secret statements even through direct IPC and respects live history settings', t => {
  const h = historyFixture(t);
  for (const [, sql] of sensitive) assert.deepEqual(h.add(sql), []);
  assert.equal(fs.existsSync(h.file), false);
  h.add('SELECT 1'); const before = fs.readFileSync(h.file);
  h.enable(false); h.add('SELECT 2'); assert.ok(fs.readFileSync(h.file).equals(before));
  h.enable(true); h.add('SELECT 3');
  assert.deepEqual(h.handlers.get('get-sql-history')().map(row => row.sql), ['SELECT 3', 'SELECT 1']);
  assert.ok(!fs.readFileSync(h.file, 'utf8').includes(dummy));
  assert.throws(() => h.handlers.get('inspect-sql-privacy')({}, ['SELECT 1'], 'invalid'), /Invalid SQL privacy/);
  assert.throws(() => h.handlers.get('inspect-sql-privacy')({}, [null], 'oracle'), /Invalid SQL privacy/);
});

test('Legacy sensitive history is hidden from the UI without rewriting or automatically deleting user data', t => {
  const h = historyFixture(t);
  const rows = [...sensitive.map(([, sql], index) => ({ id: `old-${index}`, sql })), { id: 'safe', sql: 'SELECT 1' }];
  fs.writeFileSync(h.file, JSON.stringify(rows)); const before = fs.readFileSync(h.file);
  assert.deepEqual(h.handlers.get('get-sql-history')().map(row => row.id), ['safe']);
  h.add(sensitive[0][1]); h.enable(false); h.add('SELECT 2');
  assert.ok(fs.readFileSync(h.file).equals(before));
});

const executionCases = [
  ['oracle', 'user password', sensitive.find(([db]) => db === 'oracle')[1]],
  ['postgresql', 'role password', sensitive.find(([db]) => db === 'postgresql')[1]],
  ['oracle', 'dynamic user password', `BEGIN EXECUTE IMMEDIATE 'ALTER USER demo IDENTIFIED BY "${dummy}"'; END;`],
  ['postgresql', 'dynamic role password', `DO $$ BEGIN EXECUTE 'ALTER ROLE demo PASSWORD ''${dummy}'''; END; $$`],
  ['oracle', 'keystore password', `ADMINISTER KEY MANAGEMENT SET KEYSTORE OPEN IDENTIFIED BY "${dummy}"`],
  ['postgresql', 'subscription URI', `CREATE SUBSCRIPTION demo CONNECTION 'postgresql://demo:${dummy}@example.invalid/db' PUBLICATION demo_publication`],
  ['postgresql', 'subscription conninfo', `ALTER SUBSCRIPTION demo CONNECTION 'host=example.invalid password=${dummy}'`]
];
for (const [dialect, label, sql] of executionCases) {
  for (const outcome of ['success', 'error', 'rejection']) {
    test(`${dialect}: sensitive ${label} ${outcome} preserves submitted SQL and hides it from logs, results and errors`, async () => {
      const h = await createSqlWindowHarness(dialect, sql, async channel => {
        assert.equal(channel, 'execute-sql');
        if (outcome === 'rejection') throw new Error('Rejected: ' + dummy);
        return outcome === 'success' ? { success: true, rows: [], metaData: [], command: 'ALTER' } : { success: false, error: 'Failed: ' + dummy };
      });
      try {
        await h.state.handleExecuteSql(); await h.flush();
        assert.equal(h.calls.find(([channel]) => channel === 'execute-sql')[1], sql);
        assert.equal(h.state.sqlText, sql);
        assert.equal(h.state.logs.length, 1);
        assert.equal(Boolean(h.state.logs[0].errorLines), outcome !== 'success');
        assert.ok(!JSON.stringify([h.state.logs, h.state.rows, h.state.compileErrors, h.alerts]).includes(dummy));
        assert.equal(h.historyCalls.filter(args => args.includes('add-sql-history')).length, 0);
      } finally { h.unmount(); }
    });
  }
}

test('Cancellation during privacy inspection sends no SQL or premature cancellation request', async () => {
  let finish;
  const h = await createSqlWindowHarness('postgresql', 'SELECT 1', async () => { throw new Error('No DB request expected'); },
    { inspectPrivacy: () => new Promise(resolve => { finish = resolve; }) });
  try {
    const pending = h.state.handleExecuteSql(); await h.flush();
    await h.state.handleCancelSql(); finish([{ sensitive: false, command: '' }]); await pending; await h.flush();
    assert.equal(h.calls.filter(([channel]) => ['execute-sql', 'begin-sql-batch', 'cancel-execution'].includes(channel)).length, 0);
    assert.equal(h.alerts.length, 0);
  } finally { h.unmount(); }
});

test('Dynamic SQL classification is bounded, conservative for unknown expressions and preserves ordinary literals', () => {
  for (const [dialect, sql] of [
    ['oracle', 'BEGIN EXECUTE IMMEDIATE statement_from_elsewhere; END;'],
    ['oracle', "BEGIN EXECUTE IMMEDIATE 'SELECT ' || expression_from_elsewhere; END;"],
    ['oracle', 'BEGIN DBMS_SQL.PARSE(cursor_id, dynamic_text, DBMS_SQL.NATIVE); END;'],
    ['postgresql', 'DO $$ BEGIN EXECUTE format(command_from_elsewhere); END; $$;']
  ]) assert.equal(inspectSqlPrivacy(sql, dialect).sensitive, true);
  for (const [dialect, sql] of [
    ['oracle', "BEGIN EXECUTE IMMEDIATE 'SELECT 1 FROM dual'; END;"],
    ['postgresql', "DO $$ BEGIN EXECUTE 'SELECT ' || '1'; END; $$;"],
    ['postgresql', "DO $$ BEGIN RAISE NOTICE 'PASSWORD'; END; $$;"],
    ['postgresql', "SELECT $$BEGIN EXECUTE 'ALTER ROLE demo PASSWORD x'; END$$;"],
    ['oracle', "SELECT 'BEGIN EXECUTE IMMEDIATE x; END;' FROM dual"]
  ]) assert.equal(inspectSqlPrivacy(sql, dialect).sensitive, false, sql);
  assert.equal(inspectSqlPrivacy('DO $$ BEGIN NULL; ' + ' '.repeat(2 * 1024 * 1024) + 'END; $$;', 'postgresql').sensitive, true);
  assert.equal(inspectSqlPrivacy(String.raw`DO $$ BEGIN EXECUTE E'AL\x54ER ROLE demo PASSWORD \'dummy\''; END; $$;`, 'postgresql').sensitive, true);
});

for (const dialect of ['oracle', 'postgresql']) {
  for (const outcome of ['success', 'failure', 'rejection']) test(`${dialect}: manual private execution hides arbitrary SQL and errors through ${outcome}`, async () => {
    const sql = `SELECT '${dummy}' AS private_value${dialect === 'oracle' ? ' FROM dual' : ''}`;
    const h = await createSqlWindowHarness(dialect, sql, async channel => {
      if (channel !== 'execute-sql') throw new Error('Unexpected request');
      if (outcome === 'rejection') throw new Error(dummy);
      return outcome === 'success' ? { success: true, rows: [{ private_value: dummy }], metaData: [{ name: 'private_value' }] } :
        { success: false, error: dummy };
    });
    try {
      h.state.setPrivateExecution(true); await h.flush(); await h.state.handleExecuteSql(); await h.flush();
      assert.equal(h.calls.find(([channel]) => channel === 'execute-sql')[1], sql);
      assert.ok(!JSON.stringify([h.state.logs, h.state.compileErrors, h.alerts]).includes(dummy));
      assert.equal(h.historyCalls.filter(args => args.includes('add-sql-history')).length, 0);
      assert.equal(h.state.explainSnapshot, null);
      if (outcome === 'success') assert.equal(h.state.rows[0].private_value, dummy);
      h.state.setPrivateExecution(false); await h.flush();
      assert.equal(h.state.privateExecution, false);
    } finally { h.unmount(); }
  });
  test(`${dialect}: manual private execution prevents AI plan context and applies to subsequent script statements`, async () => {
    const h = await createSqlWindowHarness(dialect, 'SELECT 1; SELECT 2;', async channel => {
      assert.equal(channel, 'explain-sql');
      return { success: true, rows: [{ PLAN: dummy }], metaData: [{ name: 'PLAN' }] };
    });
    try {
      h.state.setPrivateExecution(true); h.state.setIsExplainMode(true); await h.flush();
      await h.state.handleExecuteSql(); await h.flush();
      assert.equal(h.calls.filter(([channel]) => channel === 'explain-sql').length, 2);
      assert.equal(h.state.logs.length, 2); assert.equal(h.state.explainSnapshot, null);
      assert.equal(h.historyCalls.filter(args => args.includes('add-sql-history')).length, 0);
      const result = await h.requestTuning(); assert.equal(result.contexts.length, 0);
    } finally { h.unmount(); }
  });
}

test('Nested code and repeated credential-like tokens stop at the inspection budget without evaluating SQL', () => {
  let nested = 'SELECT 1';
  for (let index = 0; index < 10; index++) nested = `DO $depth_${index}$ ${nested} $depth_${index}$;`;
  assert.equal(inspectSqlPrivacy(nested, 'postgresql').sensitive, true);
  assert.equal(inspectSqlPrivacy('BEGIN ' + 'CREATE ROLE demo IDENTIFIED EXTERNALLY '.repeat(1500) + 'END;', 'oracle').sensitive, true);
});
for (const dialect of ['oracle', 'postgresql']) test(`${dialect}: turning private execution off restores normal history for subsequent execution`, async () => {
  const h = await createSqlWindowHarness(dialect, `SELECT 1${dialect === 'oracle' ? ' FROM dual' : ''}`, async () =>
    ({ success: true, rows: [{ VALUE: 1 }], metaData: [{ name: 'VALUE' }] }));
  try {
    h.state.setPrivateExecution(true); await h.flush(); await h.state.handleExecuteSql(); await h.flush();
    assert.equal(h.historyCalls.filter(args => args.includes('add-sql-history')).length, 0);
    h.state.setPrivateExecution(false); await h.flush(); await h.state.handleExecuteSql(); await h.flush();
    assert.equal(h.historyCalls.filter(args => args.includes('add-sql-history')).length, 1);
  } finally { h.unmount(); }
});
