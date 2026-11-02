// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { loadModule } = require('../helpers/loadModule.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { getAiDatabaseContext } = require('../../electron/services/aiDatabaseContext');
if (process.env.MONABASE_DB_TEST_ALLOW_WRITE !== '1') throw new Error('Set MONABASE_DB_TEST_ALLOW_WRITE=1; see docs/TESTING.md.');
const configs = process.env.MONABASE_TEST_CONFIG ? JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG, 'utf8')) : {};
const q = name => '"' + name.replaceAll('"', '""') + '"';
const databases = (process.env.MONABASE_TEST_DATABASES || 'postgresql,oracle').split(',');
assert.ok(databases.every(db => ['postgresql', 'oracle'].includes(db)));
for (const db of databases) test(`${db}: AI context uses the main session and catalog references without changing pending rows`, { timeout: 60000 }, async t => {
  const config = { ...configs[db] }, prefix = db === 'oracle' ? 'MONABASE_ORACLE_' : 'MONABASE_PG_';
  for (const key of ['host','port','database','user','password']) {
    if (process.env[prefix + key.toUpperCase()] !== undefined) config[key] = process.env[prefix + key.toUpperCase()];
    assert.ok(config[key], `Missing ${db} ${key}`);
  }
  const Client = loadModule(`electron/${db === 'oracle' ? 'oracle/oracleClient' : 'postgres/postgresClient'}.js`, { electron: { app: { isPackaged: true } } }, {}, { strict: false });
  const client = new Client(), observer = new Client(), created = [];
  const token = 'MBT_' + randomBytes(6).toString('hex').toUpperCase();
  const execute = (text, binds = {}) => client.execute(text, binds);
  t.after(async () => {
    const failures = [];
    try { await client.rollback(); } catch { failures.push('rollback'); }
    for (const object of created.reverse()) {
      try { await execute(`DROP ${object.kind} ${object.name}`); } catch { failures.push(object.kind); }
    }
    try { await client.commit(); } catch { failures.push('cleanup commit'); }
    for (const connection of [observer, client]) try { await connection.disconnect(); } catch { failures.push('disconnect'); }
    assert.deepEqual(failures, []);
  });
  try {
    await client.connect(config); await observer.connect(config);
    const environment = await getAiDatabaseContext(client, db);
    const expectedSchema = db === 'oracle' ? (config.schema || config.user).toUpperCase() : config.schema || 'public';
    assert.equal(environment.schema, expectedSchema, 'Verify the configured dedicated schema before creating any objects.');
    assert.ok(environment.version); assert.ok(environment.timezone);
    if (db === 'oracle') {
      await client.connection.execute("ALTER SESSION SET NLS_DATE_FORMAT='YYYY/MM/DD'");
      assert.equal((await getAiDatabaseContext(client, db)).dateFormat, 'YYYY/MM/DD');
    } else {
      await client.client.query("SET DateStyle TO 'SQL, DMY'");
      assert.match((await getAiDatabaseContext(client, db)).dateStyle, /DMY/);
    }
    const schema = environment.schema, parent = `${q(schema)}.${q(token + '_P')}`, child = `${q(schema)}.${q(token + '_C')}`, view = `${q(schema)}.${q(token + '_V')}`;
    for (const [kind, name, definition] of [
      ['TABLE', parent, `("id" ${db === 'oracle' ? 'NUMBER' : 'integer'} PRIMARY KEY)`],
      ['TABLE', child, `("id" ${db === 'oracle' ? 'NUMBER' : 'integer'}, FOREIGN KEY ("id") REFERENCES ${parent}("id"))`],
      ['VIEW', view, `AS SELECT "id" FROM ${parent}`],
    ]) { await execute(`CREATE ${kind} ${name} ${definition}`); created.push({ kind, name }); }
    await client.commit();
    await execute(`INSERT INTO ${parent} VALUES (1)`);
    assert.equal(client.getMainTransactionState(), true);
    await getAiDatabaseContext(client, db);
    assert.equal(client.getMainTransactionState(), true);
    assert.equal(Number(Object.values((await observer.execute(`SELECT COUNT(*) FROM ${parent}`)).rows[0])[0]), 0);
    const invoke = async (channel, text, binds) => { assert.equal(channel, 'execute-sql-bg'); return { success: true, ...await client.execute(text, binds, null, false, true) }; };
    const deps = { '@/shared/api/desktop': { ipcRenderer: { invoke } } };
    const repository = loadTypeScript('src/features/objects/objectRepository.ts', deps);
    const { listRelatedObjects } = loadTypeScript('src/features/ai/relatedObjects.ts', { ...deps, '../objects/objectRepository': repository });
    for (const [category, name] of [['VIEW', token + '_V'], ['TABLE', token + '_C']]) {
      const objects = await repository.listObjects({ dbType: db, schema, category, searchText: name, offset: 0 });
      const target = objects.find(object => object.name === name); assert.ok(target);
      const related = await listRelatedObjects(target);
      assert.ok(related.some(object => object.schema === schema && object.name === token + '_P' && object.category === 'TABLE'));
      assert.equal(client.getMainTransactionState(), true);
    }
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    throw new Error(`${db}: AI context integration failed (${String(error.code || error.errorNum || 'operation').replace(/[^A-Za-z0-9_-]/g,'')}); connection details omitted.`);
  }
});
