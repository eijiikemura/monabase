// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { loadModule } = require('../helpers/loadModule.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { createSqlWindowHarness } = require('../helpers/sqlWindow.cjs');
const { createSettingsStore } = require('../../electron/services/settings');

if (process.env.MONABASE_DB_TEST_ALLOW_WRITE !== '1') throw new Error('Dedicated DB write opt-in is required. See docs/TESTING.md.');
const databases = (process.env.MONABASE_TEST_DATABASES || 'postgresql,oracle').split(',');
assert.ok(databases.length && databases.every(db => ['oracle', 'postgresql'].includes(db)), 'Invalid test databases');
const configs = process.env.MONABASE_TEST_CONFIG ? JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG, 'utf8')) : {};
const { buildGridColumns } = loadTypeScript('src/features/data-grid/dataGridHelper.tsx', { react: require('react'), i18next: { t: key => key } });
const quote = value => '"' + value.replaceAll('"', '""') + '"';

for (const db of databases) test(`${db}: persisted settings reach real connections, SQL input and output`, { timeout: 120000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-db-settings-'));
  const store = createSettingsStore({ app: { isReady: () => true, getLocale: () => 'en' }, SETTINGS_FILE: path.join(directory, 'settings.json'), t: key => key, setLanguage() {} });
  const save = patch => store.save({ ...store.load(), ...patch });
  save({ queryTimeout: 0, oracleClientPath: '', timezone: '+00:00' });
  const prefix = db === 'oracle' ? 'MONABASE_ORACLE_' : 'MONABASE_PG_';
  const config = { ...configs[db], dbType: db };
  for (const key of ['host', 'port', 'database', 'user', 'password']) {
    if (process.env[prefix + key.toUpperCase()] !== undefined) config[key] = process.env[prefix + key.toUpperCase()];
    assert.ok(config[key], `Missing ${db} ${key}`);
  }
  const Client = loadModule(`electron/${db === 'oracle' ? 'oracle/oracleClient' : 'postgres/postgresClient'}.js`, {
    electron: { app: { isPackaged: true } }, '../services/settings': { getCurrentSettings: () => store.load() }
  }, {}, { strict: false });
  const handlers = new Map(), state = {}, sender = new EventEmitter(); sender.id = 9142; sender.isDestroyed = () => false;
  const registry = loadModule('electron/ipc/database.js', {
    '../oracle/oracleClient': Client, '../postgres/postgresClient': Client,
    '../oracle/traceDb': { TraceDatabase: {} }, '../postgres/traceDb': { TraceDatabase: {} },
    '../oracle/traceExecutor': {}, '../postgres/traceExecutorPg': {}
  }, {}, { strict: false });
  registry.registerDatabaseHandlers({ getValidatedSettings: () => store.load(), state, ipcMain: { handle: (key, handler) => handlers.set(key, handler) }, t: key => key });
  const invoke = (key, ...args) => handlers.get(key)({ sender }, ...args);
  const sql = async text => { const result = await invoke('execute-sql', text); assert.equal(result.success, true, 'Dedicated settings query failed'); return result; };
  const connect = async () => { const result = await invoke('connect-db', { ...config, queryTimeout: 123 }); assert.equal(result.success, true, 'Dedicated settings connection failed'); };
  let schema, created = false, table, observer;
  t.after(async () => {
    try {
      if (created && state.client) { await state.client.rollback(); await state.client.execute(`DROP TABLE ${table}`); }
      if (observer) await observer.disconnect();
      const result = await invoke('disconnect-db'); assert.equal(result, true);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  const step = (name, run) => t.test(name, async () => {
    try { await run(); }
    catch (error) { if (error.code === 'ERR_ASSERTION') throw error; throw new Error(`Settings DB check failed (${String(error.code || error.errorNum || 'unknown').replace(/[^A-Za-z0-9_-]/g, '')}); connection details omitted.`); }
  });

  await step('Connection IPC uses the persisted timeout rather than a renderer-supplied override', async () => {
    await connect();
    const result = await sql(db === 'oracle' ? 'SELECT USER AS "schema" FROM DUAL' : 'SELECT current_schema() AS schema');
    schema = result.rows[0].schema; assert.ok(typeof schema === 'string' && schema.length);
    if (config.schema) assert.equal(schema, db === 'oracle' ? config.schema.toUpperCase() : config.schema);
    else if (db === 'oracle') assert.equal(schema, config.user.toUpperCase());
    assert.equal(db === 'oracle' ? state.client.connection.callTimeout : state.client.client.connectionParameters.query_timeout || 0, 0);
  });

  for (const [format, expected] of [
    ['YYYY/MM/DD HH:mm:ss', '2026/10/30 05:56:47'], ['YYYY-MM-DD HH:mm:ss', '2026-10-30 05:56:47'],
    ['MM/DD/YYYY HH:mm:ss', '10/30/2026 05:56:47'], ['DD/MM/YYYY HH:mm:ss', '30/10/2026 05:56:47'], ['DD-MMM-YY HH:mm:ss', '30-OCT-26 05:56:47']
  ]) await step(`Saved outputDateFormat renders real SQL dates as ${format}`, async () => {
    save({ outputDateFormat: format });
    const query = db === 'oracle' ? `SELECT TO_DATE('2026-10-30 05:56:47', 'YYYY-MM-DD HH24:MI:SS') AS "stamp" FROM DUAL`
      : `SELECT TIMESTAMP '2026-10-30 05:56:47.880908' AS stamp`;
    const h = await createSqlWindowHarness(db, query, invoke, { schema, realBatches: true, getSettings: () => store.load(), dateFormat: store.load().outputDateFormat, buildGridColumns });
    try {
      await h.state.handleExecuteSql(); await h.flush(); assert.deepEqual(h.alerts, []);
      const before = JSON.stringify(h.state.rows); const column = h.state.columns[0];
      assert.equal(column.renderCell({ value: h.state.rows[0].stamp }).props.children, expected);
      assert.equal(JSON.stringify(h.state.rows), before);
    } finally { h.unmount(); }
  });

  for (const [format, date] of [['YYYY/MM/DD', '2026/10/30'], ['YYYY-MM-DD', '2026-10-30'], ['MM/DD/YYYY', '10/30/2026'], ['DD/MM/YYYY', '30/10/2026'], ['DD-MMM-YY', '30-OCT-26']]) {
    for (const time of [false, true]) await step(`Saved inputDateFormat binds a real ${format}${time ? ' HH:mm:ss' : ''} value`, async () => {
      save({ inputDateFormat: format + (time ? ' HH:mm:ss' : '') });
      const query = `SELECT TO_CHAR(:d, 'YYYY-MM-DD HH24:MI:SS') AS "value"${db === 'oracle' ? ' FROM DUAL' : ''}`;
      const h = await createSqlWindowHarness(db, query, invoke, { schema, realBatches: true, getSettings: () => store.load() });
      try {
        h.state.setBindTypes({ D: 'DATE' }); h.state.setBindValues({ D: date + (time ? ' 05:56:47' : '') }); await h.flush();
        await h.state.handleExecuteSql(); await h.flush(); assert.deepEqual(h.alerts, []);
        assert.equal(h.state.rows[0].value, '2026-10-30 ' + (time ? '05:56:47' : '00:00:00'));
      } finally { h.unmount(); }
    });
  }

  await step('Saving preferences retains pending main-connection data and observer isolation', async () => {
    table = `${quote(schema)}.${quote('MBT_' + randomBytes(6).toString('hex').toUpperCase())}`;
    await sql(`CREATE TABLE ${table} (id ${db === 'oracle' ? 'NUMBER' : 'integer'})`); created = true;
    await sql(`INSERT INTO ${table} VALUES (1)`);
    observer = new Client(); await observer.connect({ ...config, queryTimeout: 10 });
    save({ language: 'ja', theme: 'dark', maxTabs: 9, sqlHistoryEnabled: false, numberFormat: 'space', outputDateFormat: 'DD/MM/YYYY HH:mm:ss' });
    assert.equal((await sql(`SELECT COUNT(*) AS "n" FROM ${table}`)).rows[0].n, db === 'oracle' ? 1 : '1');
    assert.equal(Number((await observer.execute(`SELECT COUNT(*) AS "n" FROM ${table}`)).rows[0].n), 0);
    assert.equal(state.client.hasUncommittedTx, true);
    await state.client.rollback(); await observer.disconnect(); observer = null;
    await sql(`DROP TABLE ${table}`); created = false;
  });

  if (db === 'oracle') for (const timezone of ['+05:45', '-07:00', '+00:00']) await step(`Saved timezone ${timezone} reaches Oracle main and background sessions on reconnect`, async () => {
    save({ timezone }); await connect();
    assert.equal((await sql('SELECT SESSIONTIMEZONE AS "zone" FROM DUAL')).rows[0].zone, timezone);
    const bg = await invoke('execute-sql-bg', 'SELECT SESSIONTIMEZONE AS "zone" FROM DUAL'); assert.equal(bg.success, true); assert.equal(bg.rows[0].zone, timezone);
  });

  await step('A saved timeout requires reconnect; zero permits a longer query and one second cancels it', async () => {
    const sleepSql = db === 'oracle' ? 'BEGIN DBMS_SESSION.SLEEP(1.5); END;' : 'SELECT pg_sleep(1.5)';
    save({ queryTimeout: 1 });
    assert.equal(db === 'oracle' ? state.client.connection.callTimeout : state.client.client.connectionParameters.query_timeout || 0, 0);
    // The live unlimited connection must still finish despite the newly saved one-second setting.
    await sql(sleepSql); await connect();
    assert.equal(db === 'oracle' ? state.client.connection.callTimeout : state.client.client.connectionParameters.query_timeout, 1000);
    const stopped = await invoke('execute-sql', sleepSql); assert.equal(stopped.success, false);
    assert.match(stopped.error, /timeout|timed out|ORA-03156|DPI-1067|DPI-1080/i);
    save({ queryTimeout: 0 }); await connect(); await sql(sleepSql);
    await sql(db === 'oracle' ? 'SELECT 1 AS "n" FROM DUAL' : 'SELECT 1 AS n');
  });
});
