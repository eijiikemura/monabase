// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { loadModule } = require('../helpers/loadModule.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { createGitRepository } = require('../helpers/gitRepository.cjs');
const { snapshotDesktop } = require('../helpers/exportSnapshot.cjs');
const { createTableHarness, createStructureHarness } = require('../helpers/tableData.cjs');
const { createViewHarness } = require('../helpers/viewData.cjs');
const { createSqlWindowHarness } = require('../helpers/sqlWindow.cjs');
const { createRelationHarness } = require('../helpers/relationData.cjs');
const { createMviewHarness, mviewModules } = require('../helpers/mviewData.cjs');
const { createMviewLogHarness, logModules } = require('../helpers/mviewLogData.cjs');
const { createDbLinkHarness } = require('../helpers/dbLinkData.cjs');
const { createDirectoryHarness } = require('../helpers/directoryData.cjs');
const { createLockHarness } = require('../helpers/lockData.cjs');
const { createSynonymHarness, synonymModules } = require('../helpers/synonymData.cjs');
const { createSequenceHarness } = require('../helpers/sequenceData.cjs');
const { createDdlEditor, createDatabaseIpc, readSidebarTypes } = require('../helpers/ddlEditors.cjs');
const { createTypeHarness } = require('../helpers/typeData.cjs');
const { createVersionControl } = require('../helpers/versionControl.cjs');
const { createPackageHarness } = require('../helpers/packageLogic.cjs');
const { createStoredHarness } = require('../helpers/storedLogic.cjs');
const { createGeneratorHarness, seededRandom, createSeededRandExp } = require('../helpers/dataGenerator.cjs');
const { createExportSnapshots } = require('../../electron/services/exportSnapshots');
const { EventEmitter } = require('node:events');
const { renameTraceProcedure } = require('../../electron/services/traceProgram');

// Explicit opt-in: these tests create and remove only their own randomly named objects.
if (process.env.MONABASE_DB_TEST_ALLOW_WRITE !== '1') {
  throw new Error('Set MONABASE_DB_TEST_ALLOW_WRITE=1 to allow disposable test objects. See docs/TESTING.md.');
}
const databases = (process.env.MONABASE_TEST_DATABASES || 'postgresql,oracle').split(',');
assert.ok(databases.length && databases.every(db => ['postgresql', 'oracle'].includes(db)), 'Invalid MONABASE_TEST_DATABASES');
const fileConfig = process.env.MONABASE_TEST_CONFIG ? JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG, 'utf8')) : {};
const { quoteIdentifier: q, qualifiedObjectName } = loadTypeScript('src/shared/utils/objectIdentity.ts');
const scripts = loadTypeScript('src/features/sql/sqlScript.ts');
const { parseDelimitedText } = loadTypeScript('src/features/table/importData.ts');
const { translate } = require('../../electron/i18n');
const { compareNumericValues } = loadTypeScript('src/shared/utils/numberValues.ts');
const { postgresTypeSource } = loadTypeScript('src/features/postgresql/typeDefinition.ts', { '@/shared/api/desktop': {} });

for (const db of databases) {
  test(`${db}: real database integration`, { timeout: db === 'oracle' ? 300000 : 180000 }, async t => {
    const prefix = db === 'oracle' ? 'MONABASE_ORACLE_' : 'MONABASE_PG_';
    const config = { ...fileConfig[db] };
    for (const key of ['host', 'port', 'database', 'user', 'password']) {
      if (process.env[prefix + key.toUpperCase()] !== undefined) config[key] = process.env[prefix + key.toUpperCase()];
      assert.ok(config[key], `Missing ${db} ${key}; see docs/TESTING.md`);
    }
    // Never print connection errors or configuration: drivers may include secrets in errors.
    const Client = loadModule(`electron/${db === 'oracle' ? 'oracle/oracleClient' : 'postgres/postgresClient'}.js`,
      { electron: { app: { isPackaged: true } } }, {}, { strict: false });
    const main = new Client(), observer = new Client();
    const created = [];
    const sql = (text, binds = {}, background = false) => main.execute(text, binds, null, false, background);
    const read = async (client, text) => (await client.execute(text)).rows;
    const value = row => row[db === 'oracle' ? 'VALUE' : 'value'];
    const token = `MBT_${randomBytes(6).toString('hex').toUpperCase()}`;
    let table, schema;
    t.after(async () => {
      const failures = [];
      if (created.length) {
        try { await main.rollback(); } catch { failures.push('rollback'); }
      }
      for (const object of created.reverse()) {
        try { await sql(`DROP ${object.type} ${object.name}`); }
        catch (error) {
          if (object.type === 'DATABASE LINK' && (error.errorNum === 2024 || error.code === 'ORA-02024')) continue;
          if (object.type === 'DIRECTORY' && (error.errorNum === 4043 || error.code === 'ORA-04043')) continue;
          failures.push(`drop ${object.type} ${object.name}`);
        }
      }
      for (const client of [main, observer]) {
        try { await client.disconnect(); } catch { failures.push('disconnect'); }
      }
      assert.deepEqual(failures, [], 'Test cleanup failed; remove only the listed MBT_ objects manually.');
    });
    const step = async (name, run) => t.test(name, async () => {
      try { await run(); }
      catch (error) {
        if (error.code === 'ERR_ASSERTION') throw error;
        const code = String(error.code || error.errorNum || error.message?.match(/\b(?:ORA|NJS)-\d+\b/)?.[0] || 'unknown').replace(/[^A-Za-z0-9_-]/g, '');
        const location = error.stack?.match(/database\.test\.cjs:\d+:\d+/)?.[0] ?? 'unknown location';
        const kind = String(error.name || 'Error').replace(/[^A-Za-z]/g, '');
        throw new Error(`Database operation failed (${code}, ${kind}, ${location}); connection details and SQL are omitted.`);
      }
    });

    await step('Connect two independent application clients and create a quoted test table', async () => {
      await main.connect({ ...config, queryTimeout: 15 });
      await observer.connect({ ...config, queryTimeout: 15 });
      const version = db === 'oracle' ? main.connection.oracleServerVersionString :
        value((await read(main, "SELECT current_setting('server_version') AS value"))[0]);
      t.diagnostic(`Database server version: ${version}`);
      schema = value((await read(main, db === 'oracle' ? 'SELECT USER AS value FROM DUAL' : 'SELECT current_schema() AS value'))[0]);
      assert.ok(schema);
      if (config.schema) {
        assert.equal(schema, db === 'oracle' ? config.schema.toUpperCase() : config.schema, 'Connection must use the configured test schema before creating objects');
      }
      table = qualifiedObjectName({ schema, objectName: `${token}.Items` });
      await sql(`CREATE TABLE ${table} (id ${db === 'oracle' ? 'NUMBER(38)' : 'bigint'} PRIMARY KEY, amount ${db === 'oracle' ? 'NUMBER' : 'numeric'}, label ${db === 'oracle' ? 'VARCHAR2(100)' : 'text'})`);
      created.push({ type: 'TABLE', name: table });
    });
    // Stop after a failed setup rather than cascading through unrelated assertions.
    if (!table || !created.length) return;

    if (db === 'postgresql') await step('Inspect all session states, cancel a run-owned SQL and terminate only that test connection without changing pending main work', async () => {
      await sql(`INSERT INTO ${table} (id,amount,label) VALUES (749,1,'session pending')`);
      const PgClient = require('pg').Client, params = main.client.connectionParameters;
      const worker = new PgClient({ host: params.host, port: params.port, database: params.database, user: params.user, password: params.password, ssl: params.ssl, application_name: token + '_session', connectionTimeoutMillis: 5000, query_timeout: 15000 });
      worker.on('error', () => {});
      let h, pending;
      try {
        await worker.connect(); await worker.query('BEGIN');
        const invoke = createDatabaseIpc(main, db);
        const { createPostgresSessionHarness } = require('../helpers/postgresSessionData.cjs');
        h = await createPostgresSessionHarness((channel, input) => {
          assert.ok(['list-postgres-sessions','manage-postgres-session'].includes(channel));
          if (channel === 'manage-postgres-session') assert.equal(h.state.snapshot.sessions.find(row => row.id === input.id)?.pid, worker.processID, 'Signal only this run-owned connection');
          return invoke(channel, input);
        });
        await h.waitFor(state => !state.loading && (state.ready || state.error)); assert.equal(h.state.ready, true, h.state.error + ' ' + h.state.errorCode);
        const idle = h.state.rows.find(row => row.pid === worker.processID); assert.ok(idle); assert.equal(idle.state, 'idle in transaction'); assert.equal(idle.querySeconds, null); assert.ok(idle.transactionStart);
        const own = h.state.rows.find(row => row.pid === main.currentPid); assert.ok(own); assert.equal(own.protected, true); assert.equal(own.canTerminate, false);
        pending = worker.query('SELECT pg_sleep(30)').then(() => null, error => error);
        let active;
        for (let attempt=0; attempt<60 && !active; attempt++) {
          await h.state.load(); await h.flush(); active=h.state.rows.find(row => row.pid===worker.processID && row.state==='active' && row.query?.includes('pg_sleep'));
          if (!active) await new Promise(resolve => setTimeout(resolve,25));
        }
        assert.ok(active,h.state.error + ' ' + h.state.errorCode); h.state.select(active.id); await h.flush(); assert.equal(h.state.can('cancel'),true); assert.equal(typeof h.state.selected.querySeconds,'string');
        await h.state.command('cancel'); await h.flush(); const cancelled=await pending; assert.equal(cancelled?.code,'57014'); assert.equal(h.state.error,'',h.state.errorCode);
        await worker.query('ROLLBACK'); assert.equal((await worker.query('SELECT 7 AS value')).rows[0].value,7,'Cancellation keeps the connection usable');
        await h.state.load(); await h.flush(); const target=h.state.rows.find(row=>row.pid===worker.processID); assert.ok(target); h.state.select(target.id); await h.flush(); assert.equal(h.state.can('cancel'),false); assert.equal(h.state.can('terminate'),true);
        await h.state.command('terminate'); await h.flush(); assert.equal(h.state.error,'',h.state.errorCode); assert.ok(!h.state.rows.some(row=>row.pid===worker.processID));
        assert.equal(main.getMainTransactionState(),true); assert.equal((await read(observer,`SELECT * FROM ${table} WHERE id=749`)).length,0);
      } finally { h?.unmount(); await worker.end(); if (pending) await pending; await main.rollback(); }
    });
    if (db === 'oracle') await step('Read Oracle user identities, grants and exact quotas without changing users, roles or pending work',async()=>{
      await sql(`INSERT INTO ${table} (id,amount,label) VALUES (745,1,'oracle user pending')`);
      const invoke=createDatabaseIpc(main,db),{createOracleUserRoleHarness}=require('../helpers/oracleUserRoleData.cjs');
      const h=await createOracleUserRoleHarness((channel,input)=>{assert.ok(['list-oracle-user-roles','get-oracle-user-role-detail'].includes(channel),'Native Oracle user tests never change users, roles, passwords, grants or quotas');return invoke(channel,input);});
      try{
        await h.waitFor(state=>!state.isLoading && (state.ready || state.error));assert.equal(h.state.ready,true,h.state.error+' '+h.state.errorCode);assert.equal(h.state.snapshot.context.scope,'all','Required Oracle user/role dictionary privileges are missing');
        const row=h.state.rows.find(row=>row.name===config.user.toUpperCase());assert.ok(row);assert.equal(row.self,true);assert.equal(row.canDrop,false);assert.equal(row.canLock,false);
        h.state.select(row.identity);await h.waitFor(state=>!state.isLoading && (state.detailReady || state.detailError));assert.equal(h.state.detailReady,true,h.state.detailError+' '+h.state.errorCode);assert.equal(h.state.detail.dependenciesError,'','Oracle dependency read privileges are required');assert.equal(h.state.detail.quotaError,'','Oracle quota read privileges are required');
        assert.ok(h.state.detail.dependencyCount>0);assert.ok(h.state.detail.quotas.length>0);assert.ok(h.state.detail.quotas.every(row=>/^\d+$/.test(row.usedBytes) && (row.maxBytes===null || /^-?\d+$/.test(row.maxBytes))));
        await h.state.reload();await h.waitFor(state=>state.ready && state.detailReady && !state.isLoading);assert.equal(h.state.selectedId,row.identity);
        assert.equal(main.getMainTransactionState(),true);assert.equal((await read(observer,`SELECT * FROM ${table} WHERE id=745`)).length,0);
      }finally{h.unmount();await main.rollback();}
    });
    if (db === 'postgresql') await step('Read role identities, attributes, memberships and cluster dependencies without changing existing roles or main work', async () => {
      await sql(`INSERT INTO ${table} (id,amount,label) VALUES (746,1,'role pending')`);
      const invoke=createDatabaseIpc(main,db),{createPostgresRoleHarness}=require('../helpers/postgresRoleData.cjs');
      const h=await createPostgresRoleHarness((channel,input)=>{assert.ok(['list-postgres-roles','get-postgres-role-detail'].includes(channel),'Native role tests never mutate existing roles, credentials or membership');return invoke(channel,input);});
      try{
        await h.waitFor(state=>!state.isLoading && (state.ready || state.error));assert.equal(h.state.ready,true,h.state.error+' '+h.state.errorCode);
        const role=h.state.rows.find(row=>row.oid===h.state.snapshot.context.userId);assert.ok(role);assert.equal(role.name,config.user);assert.equal(role.self,true);assert.equal(role.canDrop,false);assert.equal(role.canSuperuser,false);assert.equal(role.canLogin,false);
        h.state.select(role.identity);await h.waitFor(state=>!state.isLoading && (state.detailReady || state.detailError));assert.equal(h.state.detailReady,true,h.state.detailError+' '+h.state.errorCode);
        assert.equal(h.state.detail.role.oid, role.oid);
        // initdb's pinned bootstrap role (OID 10) has no pg_shdepend entries.
        if (role.oid === '10') {
          assert.equal(h.state.detail.dependencyCount, 0);
          assert.deepEqual(h.state.detail.dependencies, []);
        } else {
          assert.ok(h.state.detail.dependencyCount > 0);
          assert.ok(h.state.detail.dependencies.some(row => row.database === config.database));
        }
        assert.ok(Array.isArray(h.state.detail.memberships));assert.ok(Array.isArray(h.state.detail.effectiveRoles));assert.equal(typeof h.state.detail.role.connectionLimit,'number');
        const bootstrap = h.state.snapshot.roles.find(row => row.oid === '10');
        assert.ok(bootstrap);
        if (bootstrap.oid !== role.oid) {
          h.state.select(bootstrap.identity);
          await h.waitFor(state => !state.isLoading && (state.detailReady || state.detailError));
          assert.equal(h.state.detailReady, true, h.state.detailError);
          assert.equal(h.state.detail.role.oid, '10');
          assert.equal(h.state.detail.dependencyCount, 0);
          assert.deepEqual(h.state.detail.dependencies, []);
          h.state.select(role.identity);
          await h.waitFor(state => !state.isLoading && (state.detailReady || state.detailError));
          assert.equal(h.state.detailReady, true, h.state.detailError);
        }
        await h.state.reload();await h.waitFor(state=>state.ready && state.detailReady && !state.isLoading);assert.equal(h.state.selectedId,role.identity);
        assert.equal(main.getMainTransactionState(),true);assert.equal((await read(observer,`SELECT * FROM ${table} WHERE id=746`)).length,0);
      }finally{h.unmount();await main.rollback();}
    });
    if (db === 'postgresql') await step('Inspect tablespace metadata and default objects without changing storage or committing pending work', async () => {
      await sql(`INSERT INTO ${table} (id,amount,label) VALUES (747,1,'tablespace pending')`);
      const invoke = createDatabaseIpc(main, db), { createPostgresTablespaceHarness } = require('../helpers/postgresTablespaceData.cjs');
      const h = await createPostgresTablespaceHarness((channel, input) => {
        assert.ok(['list-postgres-tablespaces','get-postgres-tablespace-detail'].includes(channel), 'Native tablespace tests are strictly read-only');
        return invoke(channel,input);
      });
      try {
        await h.waitFor(state=>!state.isLoading && (state.ready || state.error)); assert.equal(h.state.ready,true,h.state.error+' '+h.state.errorCode);
        const row=h.state.rows.find(row=>row.oid===h.state.snapshot.context.defaultId);assert.ok(row);assert.equal(row.protected,true);
        h.state.select(row.identity);await h.waitFor(state=>!state.isLoading && (state.detailReady || state.detailError));assert.equal(h.state.detailReady,true,h.state.detailError+' '+h.state.errorCode);
        // Required metadata failures are not successful skips; the dedicated role must be able to inspect usage.
        assert.equal(h.state.detail.sizeError,'','Tablespace size read privilege is required for this test');assert.equal(h.state.detail.databasesError,'','Tablespace database usage read privilege is required');
        assert.match(h.state.detail.bytes,/^\d+$/);assert.ok(h.state.detail.databases.some(db=>db.name===config.database && db.default_space));
        assert.ok(h.state.detail.objectCount>0);assert.equal(h.state.detail.tablespace.oid,row.oid);
        await h.state.reload();await h.waitFor(state=>state.ready && state.detailReady && !state.isLoading);assert.equal(h.state.selectedId,row.identity);
        assert.equal(main.getMainTransactionState(),true);assert.equal((await read(observer,`SELECT * FROM ${table} WHERE id=747`)).length,0);
      } finally { h.unmount();await main.rollback(); }
    });
    if (db === 'postgresql') await step('Read schema identities, ACLs and catalog dependencies without changing schemas or committing pending main data', async () => {
      await sql(`INSERT INTO ${table} (id,amount,label) VALUES (748,1,'schema pending')`);
      const invoke = createDatabaseIpc(main, db);
      const { createSchemaManagerHarness } = require('../helpers/schemaManagerData.cjs');
      const h = await createSchemaManagerHarness((channel, input) => {
        assert.ok(['list-postgres-schemas','get-postgres-schema-detail'].includes(channel), 'Native schema tests never create, rename, drop, transfer or grant schemas');
        return invoke(channel, input);
      });
      try {
        await h.waitFor(state => !state.isLoading && (state.ready || state.error)); assert.equal(h.state.ready, true, h.state.error + ' ' + h.state.errorCode);
        const selected = h.state.snapshot.schemas.find(row => row.name === schema); assert.ok(selected);
        assert.equal(h.state.snapshot.schemas.find(row => row.name === 'pg_catalog').protected, true);
        h.state.select(selected.identity); await h.waitFor(state => !state.isLoading && (state.detailReady || state.detailError)); assert.equal(h.state.detailReady, true, h.state.detailError + ' ' + h.state.errorCode);
        assert.equal(h.state.detail.schema.oid, selected.oid); assert.equal(h.state.detail.privileges.object.type, 'SCHEMA'); assert.ok(h.state.detail.objectCount > 0); assert.ok(h.state.detail.dependencies.length > 0);
        assert.deepEqual([...h.state.detail.privileges.privileges].sort(), ['CREATE','USAGE']); assert.ok(h.state.detail.privileges.principals.some(role => role.id === '0'));
        const identity = h.state.selectedId; await h.state.reload(); await h.waitFor(state => state.ready && state.detailReady && !state.isLoading); assert.equal(h.state.selectedId, identity);
        assert.equal(main.getMainTransactionState(), true); assert.equal((await read(observer, `SELECT * FROM ${table} WHERE id=748`)).length, 0);
      } finally { h.unmount(); await main.rollback(); }
    });
    if (db === 'postgresql') await step('Review and verify PostgreSQL object ACLs, exact overloads and sequence rights using only run-owned objects and the test role', async () => {
      const objectName = token + '_Priv\'"', relation = `${q(schema)}.${q(objectName)}`;
      const sequenceName = token + '_PrivSeq', sequence = `${q(schema)}.${q(sequenceName)}`;
      const functionName = token + '_PrivFn', fn = `${q(schema)}.${q(functionName)}`;
      const procedureName = token + '_PrivProc', proc = `${q(schema)}.${q(procedureName)}`;
      const pendingName = `${q(schema)}.${q(token + '_PrivPending')}`;
      await sql(`CREATE TABLE ${relation} (id integer, "Col'umn" text)`); created.push({ type: 'TABLE', name: relation });
      await sql(`GRANT SELECT ("Col'umn") ON TABLE ${relation} TO ${q(config.user)}`);
      await sql(`CREATE SEQUENCE ${sequence}`); created.push({ type: 'SEQUENCE', name: sequence });
      for (const type of ['integer', 'text']) { await sql(`CREATE FUNCTION ${fn}(value ${type}) RETURNS ${type} LANGUAGE sql AS 'SELECT value'`); created.push({ type: 'FUNCTION', name: `${fn}(${type})` }); }
      await sql(`CREATE PROCEDURE ${proc}(value integer) LANGUAGE plpgsql AS 'BEGIN NULL; END'`); created.push({ type: 'PROCEDURE', name: `${proc}(integer)` });
      await sql(`CREATE TABLE ${pendingName} (id integer)`); created.push({ type: 'TABLE', name: pendingName }); await sql(`INSERT INTO ${pendingName} VALUES (748)`);
      const invoke = createDatabaseIpc(main, db);
      const { createPostgresPrivilegeHarness } = require('../helpers/postgresPrivilegeData.cjs');
      const h = await createPostgresPrivilegeHarness((channel, input) => {
        if (['review-postgres-object-privilege','mutate-postgres-object-privilege'].includes(channel)) {
          assert.equal(input.principalId, h.state.detail.context.userId, 'Native changes target only the test role itself');
          assert.ok([objectName, sequenceName, functionName, procedureName].includes(input.object.name));
        }
        return invoke(channel, input);
      });
      const find = async (type, name) => {
        const result = await invoke('list-postgres-privilege-objects', { schema, type, search: name, offset: 0 }); assert.equal(result.success, true, result.error + ' ' + result.errorCode); return result.objects;
      };
      const select = async target => { h.state.select(target); await h.waitFor(s => !s.isLoading && (s.ready || s.error)); assert.equal(h.state.ready, true, h.state.error + ' ' + h.state.errorCode); };
      const change = async (action, privilege) => {
        const self = h.state.detail.context.userId;
        h.state.open(self, privilege, action, action === 'revoke' ? h.state.detail.ownerId : undefined); await h.flush(); await h.state.prepare(); await h.flush();
        assert.ok(h.state.review, h.state.error + ' ' + h.state.errorCode); assert.equal(h.state.canExecute, false); h.state.setAcknowledged(true); await h.flush(); await h.state.execute(); await h.flush();
        assert.equal(h.state.error, '', h.state.errorCode); assert.equal(h.state.applied, true);
      };
      try {
        await h.waitFor(s => s.peopleReady && !s.isLoading);
        await select((await find('TABLE', objectName))[0]); assert.equal(h.state.detail.object.name, objectName); assert.ok(h.state.detail.columnGrants.some(grant => grant.column === "Col'umn"));
        await change('revoke', 'SELECT'); assert.ok(!h.state.detail.grants.some(grant => grant.grantee_id === h.state.detail.context.userId && grant.privilege === 'SELECT'));
        assert.ok(!h.state.detail.columnGrants.some(grant => grant.column === "Col'umn"), 'Table revocation also removes matching column grants'); await change('grant', 'SELECT');
        await select((await find('SEQUENCE', sequenceName))[0]); assert.deepEqual([...h.state.detail.privileges].sort(), ['SELECT','UPDATE','USAGE']); await change('revoke', 'SELECT'); await change('grant', 'SELECT');
        const overloads = await find('FUNCTION', functionName); assert.equal(overloads.length, 2); assert.notEqual(overloads[0].identity, overloads[1].identity);
        const integer = overloads.find(object => object.args.includes('integer')), text = overloads.find(object => object.args.includes('text'));
        const beforeOther = await invoke('get-postgres-object-privileges', text); assert.equal(beforeOther.success, true);
        await select(integer); assert.ok(h.state.detail.grants.some(grant => grant.grantee_id === '0' && grant.privilege === 'EXECUTE'));
        await change('revoke', 'EXECUTE'); assert.ok(h.state.detail.grants.some(grant => grant.grantee_id === '0'), 'Default PUBLIC access remains distinct from the removed direct grant');
        const afterOther = await invoke('get-postgres-object-privileges', text); assert.equal(afterOther.success, true); assert.equal(afterOther.detail.fingerprint, beforeOther.detail.fingerprint); await change('grant','EXECUTE');
        await select((await find('PROCEDURE', procedureName))[0]); await change('revoke','EXECUTE'); await change('grant','EXECUTE');
        assert.equal(main.getMainTransactionState(), true); assert.equal((await read(observer, `SELECT * FROM ${pendingName}`)).length, 0);
      } finally { h.unmount(); await main.rollback(); }
    });
    if (db === 'postgresql') await step('Inspect run-owned PostgreSQL blockers, cancel only the waiter and terminate only the test holder while preserving pending main data', async () => {
      const target = qualifiedObjectName({ schema, objectName: token + '_PGLOCK' });
      await sql(`CREATE TABLE ${target} (id integer PRIMARY KEY, value integer)`); created.push({ type: 'TABLE', name: target });
      await sql(`INSERT INTO ${target} VALUES (1,0)`); await main.commit();
      await sql(`INSERT INTO ${target} VALUES (2,99)`);
      const PgClient = require('pg').Client, params = main.client.connectionParameters;
      // The driver intentionally makes passwords non-enumerable; copy only the explicit connection fields.
      const rawConfig = { host: params.host, port: params.port, database: params.database, user: params.user, password: params.password, ssl: params.ssl, connectionTimeoutMillis: 5000, query_timeout: 10000 };
      const holder = new PgClient({ ...rawConfig, application_name: token + '_holder' });
      const waiter = new PgClient({ ...rawConfig, application_name: token + '_waiter' });
      holder.on('error', () => {}); waiter.on('error', () => {});
      let pending, h, stage = 'connect';
      try {
        await holder.connect(); await waiter.connect(); stage = 'hold';
        await holder.query('BEGIN'); await holder.query(`UPDATE ${target} SET value=1 WHERE id=1`);
        stage = 'start-waiter'; await waiter.query('BEGIN'); pending = waiter.query(`UPDATE ${target} SET value=2 WHERE id=1`).then(() => null, error => error);
        const invoke = createDatabaseIpc(main, db);
        const { createPostgresLockHarness } = require('../helpers/postgresLockData.cjs');
        stage = 'load-locks'; h = await createPostgresLockHarness((channel, input) => {
          assert.ok(['list-postgres-locks', 'manage-postgres-lock'].includes(channel));
          if (channel === 'manage-postgres-lock') {
            const row = h.state.snapshot.locks.find(row => row.id === input.id);
            assert.ok(row && [holder.processID, waiter.processID].includes(row.pid), 'Signal only this run-owned connection');
          }
          return invoke(channel, input);
        });
        for (let attempt = 0; attempt < 40 && !h.state.rows.some(row => row.pid === waiter.processID && !row.granted && row.blockers.includes(holder.processID)); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 25)); await h.state.load(); await h.flush();
        }
        stage = 'find-waiter'; const waiting = h.state.rows.find(row => row.pid === waiter.processID && !row.granted && row.blockers.includes(holder.processID));
        assert.ok(waiting, h.state.error + ' ' + h.state.errorCode); h.state.select(waiting.id); await h.flush();
        assert.equal(h.state.can('cancel'), true); assert.ok(h.state.blockers.some(row => row.pid === holder.processID));
        h.state.inspectBlocker(holder.processID); await h.flush(); assert.equal(h.state.selected.pid, holder.processID);
        stage = 'cancel'; h.state.select(waiting.id); await h.flush(); await h.state.command('cancel'); await h.flush();
        const cancelled = await pending; assert.equal(cancelled?.code, '57014'); assert.equal(h.state.error, '');
        stage = 'waiter-reuse'; await waiter.query('ROLLBACK'); assert.equal((await waiter.query('SELECT 1 AS value')).rows[0].value, 1, 'Cancellation preserves the connection');
        await h.state.load(); await h.flush();
        const held = h.state.rows.find(row => row.pid === holder.processID); assert.ok(held); h.state.select(held.id); await h.flush(); assert.equal(h.state.can('terminate'), true);
        stage = 'terminate'; await h.state.command('terminate'); await h.flush(); assert.equal(h.state.error, '');
        assert.equal(h.state.rows.some(row => row.pid === holder.processID), false);
        const own = h.state.rows.filter(row => row.pid === main.currentPid); assert.ok(own.length); assert.ok(own.every(row => row.protected && !row.canTerminate));
        assert.equal(main.getMainTransactionState(), true); assert.equal((await read(observer, `SELECT * FROM ${target} WHERE id=2`)).length, 0);
        assert.equal((await read(observer, `SELECT value FROM ${target} WHERE id=1`))[0].value, 0, 'Terminating the holder rolls back its own update');
      } catch (error) { t.diagnostic('PostgreSQL lock scenario stage: ' + stage); throw error; } finally {
        h?.unmount();
        try { await holder.query('ROLLBACK'); } catch { /* This run intentionally terminated the holder. */ }
        try { await waiter.query('ROLLBACK'); } catch { /* Cancellation or termination can close the test connection. */ }
        await Promise.all([holder.end(), waiter.end()]); if (pending) await pending;
        await main.rollback();
      }
    });
    if (db === 'oracle') await step('Observe only run-owned lock contention and inspect its blocker without terminating any sessions', async () => {
      const name = token + '_LOCK', target = qualifiedObjectName({ schema, objectName: name });
      await sql(`CREATE TABLE ${target} (ID NUMBER PRIMARY KEY, VALUE NUMBER)`); created.push({ type: 'TABLE', name: target });
      await sql(`INSERT INTO ${target} VALUES (1, 0)`); await sql(`INSERT INTO ${target} VALUES (2, 0)`); await main.commit();
      const blocker = new Client(), waiter = new Client();
      let pending, h;
      try {
        await blocker.connect({ ...config, queryTimeout: 20 }); await waiter.connect({ ...config, queryTimeout: 20 });
        const identitySql = 'SELECT SID, SERIAL# AS SERIAL FROM V$SESSION WHERE SID = TO_NUMBER(SYS_CONTEXT(\'USERENV\',\'SID\'))';
        const blockIdentity = (await read(blocker, identitySql))[0], waitIdentity = (await read(waiter, identitySql))[0];
        await blocker.execute(`UPDATE ${target} SET VALUE = 1 WHERE ID = 1`);
        await sql(`UPDATE ${target} SET VALUE = 9 WHERE ID = 2`);
        pending = waiter.execute(`UPDATE ${target} SET VALUE = 2 WHERE ID = 1`).then(() => ({ success: true }), error => ({ success: false, code: error.code || error.errorNum }));
        const lockIpc = createDatabaseIpc(main, db);
        h = await createLockHarness(async channel => {
          assert.equal(channel, 'list-oracle-locks', 'Native lock tests never terminate a session');
          return lockIpc(channel);
        });
        const deadline = Date.now() + 10000;
        let waiting;
        do {
          await h.state.load(); await h.flush();
          waiting = h.state.rows.find(row => row.SID === Number(waitIdentity.SID) && row.TYPE === 'TX' && row.REQUEST_MODE > 0);
          if (waiting?.BLOCKING_SID === Number(blockIdentity.SID)) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
        assert.equal(h.state.ready, true, h.state.error); assert.ok(waiting, 'A run-owned TX waiter must be visible');
        assert.equal(waiting.BLOCKING_SID, Number(blockIdentity.SID));
        assert.equal(waiting.SERIAL, Number(waitIdentity.SERIAL)); assert.ok(waiting.WAIT_SECONDS >= 0);
        assert.ok(waiting.SQL_TEXT?.includes(name));
        h.state.select(waiting.id); await h.flush(); assert.equal(h.state.blocker.SID, Number(blockIdentity.SID));
        h.state.inspectBlocker(); await h.flush(); assert.equal(h.state.selected.SID, Number(blockIdentity.SID));
        assert.ok(h.state.selected.WAITERS >= 1);
        const heldTx = h.state.snapshot.locks.find(row => row.SID === Number(blockIdentity.SID) && row.TYPE === 'TX' && row.REQUEST_MODE === 0);
        assert.equal(heldTx.OBJECT_NAME, null, 'TX holder objects are not guessed');
        const ownSid = main.managedSessions.get(main.connection).sid;
        assert.ok(h.state.snapshot.locks.filter(row => row.SID === ownSid).every(row => row.protected));
        assert.equal(h.state.snapshot.context.protectionReady, true);
        assert.equal(main.getMainTransactionState(), true);
        assert.equal(Number((await read(observer, `SELECT VALUE AS VALUE FROM ${target} WHERE ID = 2`))[0].VALUE), 0);
        await blocker.rollback(); assert.equal((await pending).success, true); await waiter.rollback();
        await h.state.load(); await h.flush(); assert.ok(!h.state.rows.some(row => row.SID === Number(waitIdentity.SID) && row.REQUEST_MODE > 0));
      } finally {
        h?.unmount();
        try { await blocker.rollback(); } finally {
          if (pending) await pending;
          await waiter.rollback(); await blocker.disconnect(); await waiter.disconnect(); await main.rollback();
        }
      }
    });

    await step('Execute visual-builder ANSI outer joins, composite keys, quoted columns and aggregate ordering', async () => {
      const { generateQuerySql } = loadTypeScript('src/features/query-builder/queryBuilderModel.ts');
      const keyColumn = db === 'oracle' ? 'Part Key' : 'Part"Key';
      const names = ['QA', 'QB', 'QC'].map(suffix => qualifiedObjectName({ schema, objectName: token + '_' + suffix }));
      for (const name of names) {
        await sql(`CREATE TABLE ${name} (${q('ID')} INTEGER, ${q(keyColumn)} INTEGER, ${q('Amount')} INTEGER)`);
        created.push({ type: 'TABLE', name });
      }
      for (const [id, key, amount] of [[1, 10, 0], [2, 20, 0], [3, 30, 0]]) await sql(`INSERT INTO ${names[0]} VALUES (:id, :key, :amount)`, { id, key, amount });
      for (const [id, key, amount] of [[1, 10, 5], [1, 99, 500], [2, 20, 20]]) await sql(`INSERT INTO ${names[1]} VALUES (:id, :key, :amount)`, { id, key, amount });
      await sql(`INSERT INTO ${names[2]} VALUES (1, 1, 1)`); await sql(`INSERT INTO ${names[2]} VALUES (2, 2, 2)`);
      const [a, b, c] = names.map((name, index) => ({ id: 'q' + index, name, columns: ['ID', keyColumn, 'Amount'], x: 0, y: 0 }));
      const field = (table, col, extra = {}) => ({ id: table.id + col, tableId: table.id, tableName: table.name, columnName: col,
        sort: '', criteria: '', orCriteria: '', show: true, groupBy: '', ...extra });
      const joins = ['ID', keyColumn].map((column, index) => ({ id: 'join' + index, fromTableId: a.id, fromCol: column, toTableId: b.id, toCol: column, joinType: 'LEFT' }));
      const query = { queryTables: [b, a], queryFields: [field(a, 'ID', { sort: 'ASC' }), field(b, 'Amount')], queryJoins: joins };
      const forward = (await sql(generateQuerySql(query))).rows;
      assert.equal(forward.length, 3); assert.deepEqual(Array.from(forward, row => row.Amount), [5, 20, null]);
      const reordered = (await sql(generateQuerySql({ ...query, queryTables: [a, b] }))).rows;
      assert.deepEqual(reordered, forward);
      const right = (await sql(generateQuerySql({ ...query, queryJoins: joins.map(join => ({ ...join, joinType: 'RIGHT' })) }))).rows;
      assert.equal(right.length, 3); assert.ok(right.some(row => row.ID === null && row.Amount === 500));
      const aggregate = { ...query, queryFields: [field(a, 'ID'), field(b, 'Amount', { groupBy: 'SUM', sort: 'DESC' })] };
      const grouped = (await sql(generateQuerySql(aggregate))).rows;
      assert.equal(grouped.length, 3); assert.deepEqual(Array.from(grouped, row => row.ID).sort(), [1, 2, 3]);
      const cross = (await sql(generateQuerySql({ ...query, queryTables: [b, a, c] }))).rows;
      assert.equal(cross.length, 6);
      await main.rollback();
    });

    await step('Review DB source changes and record selected definitions in real Git without changing pending data', async () => {
      const name = token + '_Git', routine = qualifiedObjectName({ schema, objectName: name });
      const definition = value => db === 'oracle'
        ? `CREATE OR REPLACE FUNCTION ${routine} RETURN NUMBER AS BEGIN RETURN ${value}; END;`
        : `CREATE OR REPLACE FUNCTION ${routine}() RETURNS integer LANGUAGE sql AS $$ SELECT ${value} $$;`;
      await sql(definition(1), {}, true); created.push({ type: 'FUNCTION', name: routine + (db === 'postgresql' ? '()' : '') });
      const invoke = createDatabaseIpc(main, db);
      const sources = loadTypeScript('src/features/git/gitDatabaseSources.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } } });
      const objects = await sources.listGitDatabaseObjects(db, schema, 'FUNCTION'), object = objects.find(item => item.name === name);
      assert.ok(object);
      const first = await sources.readGitDatabaseSource(object, key => key);
      assert.ok(first.sourceText.includes(name)); if (db === 'postgresql') assert.equal(first.signature, '');
      const repo = await createGitRepository(t);
      assert.equal((await repo.invoke('git-commit', { ...first, message: 'Initial function' })).success, true);
      await sql(`INSERT INTO ${table} (id, amount, label) VALUES (88001, 1, 'pending Git review')`);
      await sql(definition(2), {}, true);
      const next = await sources.readGitDatabaseSource(object, key => key);
      assert.notEqual(first.sourceText, next.sourceText);
      const snapshot = await repo.invoke('git-review-sources', [next]); assert.equal(snapshot.success, true, snapshot.error);
      assert.equal(snapshot.rows[0].headSource, first.sourceText);
      const committed = await repo.invoke('git-commit-sources', { ...snapshot, message: 'Change function return value' });
      assert.equal(committed.success, true, committed.error);
      assert.equal((await repo.git.log()).total, 2);
      assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${table} WHERE id=88001`))[0].CNT), 1);
      assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${table} WHERE id=88001`))[0].CNT), 0);
      assert.equal(main.getMainTransactionState(), true); await main.rollback();
    });

    if (db === 'oracle') {
      await step('Refuse stored target changes and compile slash-only comment and quoted lines as one real program', async () => {
        const name = token + '_Compile', otherName = token + '_Other';
        const target = qualifiedObjectName({ schema, objectName: name });
        const original = `CREATE OR REPLACE PROCEDURE ${target} AS BEGIN NULL; END;`;
        await sql(original, {}, true); created.push({ type: 'PROCEDURE', name: target });
        const invokeDatabase = createDatabaseIpc(main, 'oracle');
        const h = createStoredHarness((channel, ...args) => channel === 'get-trace-data' || channel === 'delete-trace-db'
          ? { success: true } : invokeDatabase(channel, ...args), { schema, objectName: name });
        try {
          await h.render().loadObjectInfo();
          const count = h.calls.length;
          const wrong = `CREATE OR REPLACE PROCEDURE ${qualifiedObjectName({ schema, objectName: otherName })} AS BEGIN NULL; END;`;
          h.render().setSourceText(wrong); await h.render().handleCompile(() => {});
          assert.equal(h.calls.length, count);
          assert.equal(h.render().sourceText, wrong);
          const absent = await sql('SELECT COUNT(*) AS VALUE FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :name', { owner: schema, name: otherName }, true);
          assert.equal(Number(absent.rows[0].VALUE), 0);
          const body = `CREATE OR REPLACE PROCEDURE ${target} AS\nv VARCHAR2(200);\nBEGIN\n/* documentation\n/\ncontinued */\nv := 'text\n/\nlast';\nv := q'[owner's\n/\ntext]';\nEND;\n/`;
          h.render().setSourceText(body); await h.render().handleCompile(() => {});
          assert.equal(h.render().compileErrors.length, 0);
          const sent = h.calls.filter(([channel, query]) => channel === 'execute-sql' && query.startsWith('CREATE OR REPLACE PROCEDURE'));
          assert.equal(sent.length, 1); assert.equal(sent[0][1], body.slice(0, -2));
          assert.ok(h.render().sourceText.includes("owner's\n/\ntext"));
          assert.equal(h.render().hasUnsavedChanges, false);
          await sql(`BEGIN ${target}; END;`, {}, true);
        } finally { h.dispose(); }
      });

      await step('Check exact quoted compilation names and separate package specification errors from body errors', async () => {
        const invokeDatabase = createDatabaseIpc(main, 'oracle');
        const { executeCompile } = loadTypeScript('src/features/stored/storedCommon.ts', {
          i18next: { t: key => key }, '@/shared/api/desktop': { ipcRenderer: { invoke: (channel, ...args) =>
            channel === 'delete-trace-db' ? Promise.resolve({ success: true }) : invokeDatabase(channel, ...args) } }
        });
        const name = token + "_Mi'x", upper = name.toUpperCase();
        for (const objectName of [name, upper]) {
          const target = qualifiedObjectName({ schema, objectName });
          await sql(`CREATE OR REPLACE PROCEDURE ${target} AS BEGIN NULL; END;`, {}, true);
          created.push({ type: 'PROCEDURE', name: target });
        }
        const invalid = await executeCompile(schema, name,
          `CREATE OR REPLACE PROCEDURE ${qualifiedObjectName({ schema, objectName: name })} AS BEGIN MBT_MISSING_CALL; END;`, 'PROCEDURE');
        assert.equal(invalid.success, false); assert.equal(invalid.isSyntaxError, true);
        assert.ok(invalid.errors.length > 0);
        const fixed = await executeCompile(schema, name,
          `CREATE OR REPLACE PROCEDURE ${qualifiedObjectName({ schema, objectName: name })} AS BEGIN NULL; END;`, 'PROCEDURE');
        assert.equal(fixed.success, true);
        const packageName = token + '_Types', target = qualifiedObjectName({ schema, objectName: packageName });
        const spec = `CREATE OR REPLACE PACKAGE ${target} AS PROCEDURE A; END;`;
        await sql(spec, {}, true); created.push({ type: 'PACKAGE', name: target });
        const body = await executeCompile(schema, packageName,
          `CREATE OR REPLACE PACKAGE BODY ${target} AS PROCEDURE A IS BEGIN MBT_MISSING_CALL; END; END;`, 'PACKAGE BODY');
        assert.equal(body.success, false); assert.equal(body.isSyntaxError, true);
        assert.equal((await executeCompile(schema, packageName, spec, 'PACKAGE')).success, true);
      });

      await step('Block package execution after argument metadata failure and retry with the correct real signature', async () => {
        const name = token + '_Args', target = qualifiedObjectName({ schema, objectName: name });
        await sql(`CREATE OR REPLACE PACKAGE ${target} AS PROCEDURE A(AMOUNT NUMBER DEFAULT NULL); PROCEDURE B(LABEL VARCHAR2 DEFAULT NULL); END;`, {}, true);
        created.push({ type: 'PACKAGE', name: target });
        await sql(`CREATE OR REPLACE PACKAGE BODY ${target} AS PROCEDURE A(AMOUNT NUMBER DEFAULT NULL) IS BEGIN NULL; END; PROCEDURE B(LABEL VARCHAR2 DEFAULT NULL) IS BEGIN NULL; END; END;`, {}, true);
        const invoke = createDatabaseIpc(main, 'oracle');
        let failB = true;
        const h = createPackageHarness((channel, query, binds) => {
          if (channel === 'execute-sql-bg' && binds?.subProgram === 'B' && failB) return { success: false, error: 'Simulated metadata interruption' };
          return invoke(channel, query, binds);
        }, { schema, objectName: name });
        try {
          await h.render().loadObjectInfo(); await h.flush();
          h.render().setSelectedSubProgram('A'); await h.render().loadArguments('A');
          h.render().setArgValues({ AMOUNT: '123' });
          h.render().setSelectedSubProgram('B'); await h.render().loadArguments('B');
          await h.render().handleExecute(() => {}); await h.render().handleTraceExecute(false, () => {});
          assert.equal(h.calls.filter(([channel]) => channel === 'execute-stored' || channel === 'execute-trace').length, 0);
          failB = false; await h.render().loadArguments('B');
          assert.equal(h.render().canExecuteSubProgram, true);
          h.render().setArgValues({ LABEL: 'Retry B' });
          let success; await h.render().handleExecute(result => { success = result; });
          assert.equal(success, true);
          const sent = h.calls.find(([channel]) => channel === 'execute-stored')[1];
          assert.equal(sent.args.LABEL, 'Retry B'); assert.equal(sent.args.AMOUNT, undefined);
        } finally { h.dispose(); }
      });
    }

    if (db === 'oracle') await step('Select exact package overloads, preserve defaults and literals in traces, inspect metadata and compile on the main connection', async () => {
      const name = token + '_PkgCase', target = `${q(schema)}.${q(name)}`;
      const spec = `CREATE OR REPLACE PACKAGE ${target} AS
FUNCTION PICK(P NUMBER) RETURN VARCHAR2;
FUNCTION PICK(P VARCHAR2) RETURN VARCHAR2;
FUNCTION DEFAULT_VALUE(P VARCHAR2 DEFAULT 'fallback') RETURN VARCHAR2;
PROCEDURE "Quoted Call"("Input Value" IN VARCHAR2, "Output Value" OUT VARCHAR2);
END;`;
      const body = `CREATE OR REPLACE PACKAGE BODY ${target} AS
FUNCTION PICK(P NUMBER) RETURN VARCHAR2 IS
BEGIN
RETURN 'number:' || TO_CHAR(P);
END;
FUNCTION PICK(P VARCHAR2) RETURN VARCHAR2 IS
BEGIN
RETURN 'text:' || P;
END;
FUNCTION DEFAULT_VALUE(P VARCHAR2 DEFAULT 'fallback') RETURN VARCHAR2 IS
BEGIN
RETURN '${name}:' || COALESCE(P, '<NULL>');
END;
PROCEDURE "Quoted Call"("Input Value" IN VARCHAR2, "Output Value" OUT VARCHAR2) IS
BEGIN
"Output Value" := "Input Value";
END;
END;`;
      await sql(spec); created.push({ type: 'PACKAGE', name: target }); await sql(body);
      const invoke = createDatabaseIpc(main, db), h = createPackageHarness(invoke, { schema, objectName: name });
      const { loadPackageInformation } = loadTypeScript('src/features/stored/packageMetadata.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } } });
      class TraceDatabase { static deleteDatabase() {} async init() {} async insertSteps() {} async saveTraceInfo() {} close() {} }
      const { executeTrace } = loadModule('electron/oracle/traceExecutor.js', { './traceDb': { TraceDatabase } }, {}, { strict: false });
      try {
        await h.render().loadObjectInfo(); await h.flush(); assert.equal(h.render().canExecuteSubProgram, true);
        assert.equal(h.render().subPrograms.filter(program => program.PROCEDURE_NAME === 'PICK').length, 2);
        for (const [type, input, expected] of [['NUMBER', '123', 'number:123'], ['VARCHAR2', '123', 'text:123']]) {
          const program = h.render().subPrograms.find(item => item.PROCEDURE_NAME === 'PICK' && item.SIGNATURE === type);
          h.render().setSelectedSubProgram(program.key); await h.render().loadArguments(program.key); await h.flush();
          h.render().setArgValues({ P: input }); h.render().setArgumentModes({ P: 'value' }); await h.flush();
          let success; await h.render().handleExecute(ok => { success = ok; }); await h.flush();
          assert.equal(success, true); assert.equal(h.render().returnValues[0].value, expected); await main.rollback();
          const request = h.calls.filter(call => call[0] === 'execute-stored').at(-1)[1];
          const traced = await executeTrace(main.connection, { ...request, objectType: 'PACKAGE BODY', sourceText: h.render().sourceText });
          assert.equal(traced.returnValues[0].value, expected);
        }
        for (const [mode, input, expected] of [['default', '', 'fallback'], ['null', '', '<NULL>'], ['value', '', '<NULL>'], ['value', '  ', '  ']]) {
          h.render().setSelectedSubProgram('DEFAULT_VALUE'); await h.render().loadArguments('DEFAULT_VALUE'); await h.flush();
          h.render().setArgValues({ P: input }); h.render().setArgumentModes({ P: mode }); await h.flush();
          let success; await h.render().handleExecute(ok => { success = ok; }); await h.flush();
          assert.equal(success, true); assert.equal(h.render().returnValues[0].value, name + ':' + expected); await main.rollback();
          const request = h.calls.filter(call => call[0] === 'execute-stored').at(-1)[1];
          const traced = await executeTrace(main.connection, { ...request, objectType: 'PACKAGE BODY', sourceText: h.render().sourceText });
          assert.equal(traced.returnValues[0].value, name + ':' + expected);
          assert.ok(traced.generatedSource.includes("'" + name + ":'"), 'Package-name text literals must survive trace renaming');
          await assert.rejects(() => executeTrace(main.connection, { ...request, objectType: 'PACKAGE BODY', sourceText: h.render().sourceText + '\n-- unsaved' }));
        }
        h.render().setSelectedSubProgram('Quoted Call'); await h.render().loadArguments('Quoted Call'); await h.flush();
        h.render().setArgValues({ 'Input Value': 'quoted argument' }); await h.flush(); await h.render().handleExecute(() => {}); await h.flush();
        assert.equal(h.render().returnValues[0].name, 'Output Value'); assert.equal(h.render().returnValues[0].value, 'quoted argument'); await main.rollback();
        const dependent = `${q(schema)}.${q(token + '_PkgView')}`;
        await sql(`CREATE VIEW ${dependent} AS SELECT ${target}.DEFAULT_VALUE('info') AS "VALUE" FROM DUAL`); created.push({ type: 'VIEW', name: dependent });
        const info = await loadPackageInformation(schema, name);
        assert.ok(info.status.every(row => row.STATUS === 'VALID')); assert.equal(info.programs.length, 4);
        assert.ok(info.dependents.some(row => row.NAME === token + '_PkgView'));
        const pending = `${q(schema)}.${q(token + '_PkgPending')}`;
        await sql(`CREATE TABLE ${pending}(ID INTEGER)`); created.push({ type: 'TABLE', name: pending }); await sql(`INSERT INTO ${pending} VALUES (1)`);
        const saved = h.render().sourceText;
        h.render().setSourceText(saved + '\n-- compile snapshot'); await h.flush(); await h.render().handleCompile(() => {}); await h.flush();
        assert.equal(h.render().compileErrors.length, 0); assert.equal(main.getMainTransactionState(), false);
        assert.equal(Number(value((await read(observer, `SELECT COUNT(*) AS value FROM ${pending}`))[0])), 1);
        const invalid = '-- leading editor comment\n\n' + saved.replace('"Output Value" := "Input Value";', 'missing_routine_variable := 1;');
        h.render().setSourceText(invalid); await h.flush(); await h.render().handleCompile(() => {}); await h.flush();
        const line = invalid.slice(0, invalid.indexOf('missing_routine_variable')).split('\n').length;
        assert.ok(h.render().compileErrors.some(error => error.line === line)); assert.equal(h.render().objectValid, false);
        h.render().setSourceText(saved); await h.flush(); await h.render().handleCompile(() => {}); await h.flush(); assert.equal(h.render().objectValid, true);
      } finally { h.dispose(); }
    });

    if (db === 'postgresql') await step('Format current_timestamp and typed SQL result dates without altering raw database values', async () => {
      const { buildGridColumns } = loadTypeScript('src/features/data-grid/dataGridHelper.tsx', {
        react: require('react'), i18next: { t: key => key }
      });
      const query = `SELECT current_timestamp AS now_value, TIMESTAMP '2026-10-30 05:56:47.880908' AS stamp,
        DATE '2026-10-30' AS day, '2026-10-30 05:56:47.880908+00'::text AS label`;
      const h = await createSqlWindowHarness(db, query, createDatabaseIpc(main, db), {
        realBatches: true, schema, dateFormat: 'DD-MMM-YY HH:mm:ss', buildGridColumns
      });
      try {
        await h.state.handleExecuteSql(); await h.flush();
        assert.deepEqual(h.alerts, []); assert.equal(h.state.rows.length, 1);
        const row = h.state.rows[0], before = JSON.stringify(row);
        const display = name => h.state.columns.find(column => column.field === name).renderCell({ value: row[name] }).props.children;
        assert.equal(typeof row.now_value, 'string');
        assert.match(display('now_value'), /^\d{2}-[A-Z]{3}-\d{2} \d{2}:\d{2}:\d{2}$/);
        assert.equal(display('stamp'), '30-OCT-26 05:56:47');
        assert.equal(display('day'), '30-OCT-26');
        assert.equal(display('label'), '2026-10-30 05:56:47.880908+00');
        assert.equal(row.stamp, '2026-10-30 05:56:47.880908');
        assert.equal(JSON.stringify(row), before);
      } finally { h.unmount(); }
    });

    await step('Execute SQL window binds without losing decimal precision or interpolating input text', async () => {
      const suffix = db === 'oracle' ? ' FROM DUAL' : '';
      const text = db === 'oracle'
        ? `SELECT :n AS "number", :s AS "text", TO_CHAR(:d, 'YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM') AS "date"${suffix}`
        : `SELECT :n AS "number", :s AS "text", to_char(:d AT TIME ZONE INTERVAL '+05:45', 'YYYY-MM-DD HH24:MI:SS.US') || ' +05:45' AS "date"`;
      const invoke = createDatabaseIpc(main, db);
      const h = await createSqlWindowHarness(db, text, invoke, { realBatches: true, schema });
      try {
        const number = '9007199254740993.123456789', input = "owner's text; SELECT 999 --";
        h.state.setBindValues({ N: number, S: input, D: '2026-10-25 12:34:56.123456 +05:45' });
        h.state.setBindTypes({ N: 'NUMBER', S: 'STRING', D: 'DATE' }); await h.flush();
        await h.state.handleExecuteSql(); await h.flush();
        assert.deepEqual(h.alerts, []); assert.equal(h.state.rows[0].number, number); assert.equal(h.state.rows[0].text, input);
        assert.match(h.state.rows[0].date, /^2026-10-25 12:34:56\.123456(?:000)? \+05:45$/);
        const call = h.calls.find(([channel]) => channel === 'execute-sql');
        assert.ok(!call[1].includes(input)); assert.equal(call[2].mb_input_0, number);
      } finally { h.unmount(); }
    });

    await step('Retain successful SQL window results and pending writes after failure and idle cancellation', async () => {
      const target = `${q(schema)}.${q(token + '_SQL_BATCH')}`;
      await sql(`CREATE TABLE ${target} ("ID" ${db === 'oracle' ? 'NUMBER' : 'integer'})`);
      created.push({ type: 'TABLE', name: target }); await main.commit();
      const invoke = createDatabaseIpc(main, db), first = db === 'oracle' ? 'SELECT 7 AS "value" FROM DUAL' : 'SELECT 7 AS "value"';
      const h = await createSqlWindowHarness(db, `${first}; INSERT INTO ${target} ("ID") VALUES (1); SELECT "MISSING_COLUMN" FROM ${target}; INSERT INTO ${target} ("ID") VALUES (2);`, invoke, { realBatches: true, schema });
      try {
        await h.state.handleExecuteSql(); await h.flush(); assert.equal(h.alerts.length, 1); assert.equal(h.state.logs.length, 3);
        assert.equal(Number(h.state.rows[0].value), 7); assert.equal(h.state.bottomTab, 1);
        assert.equal((await sql(`SELECT * FROM ${target}`)).rows.length, 1);
        assert.equal((await observer.execute(`SELECT * FROM ${target}`)).rows.length, 0);
        assert.equal((await invoke('begin-sql-batch', 'idle-test')).success, true);
        assert.equal((await invoke('cancel-execution', 'idle-test')).success, true);
        assert.equal((await invoke('execute-sql', `INSERT INTO ${target} ("ID") VALUES (2)`, {}, schema, 'idle-test')).success, false);
        assert.equal((await invoke('end-sql-batch', 'idle-test')).success, true);
        assert.equal((await sql(`SELECT * FROM ${target}`)).rows.length, 1); await main.rollback();
        assert.equal((await sql(`SELECT * FROM ${target}`)).rows.length, 0);
      } finally { h.unmount(); await main.rollback(); }
    });

    await step('Build AI tuning context from exact quoted metadata without sending AI requests or changing pending data', async () => {
      const name = token + (db === 'oracle' ? "_AI'Mix" : "_AI'\".Mix"), target = `${q(schema)}.${q(name)}`;
      let extraColumns = '';
      if (db === 'postgresql') {
        const type = `${q(schema)}.${q(token + '_AI_State')}`;
        await sql(`CREATE TYPE ${type} AS ENUM ('open', 'closed')`); created.push({ type: 'TYPE', name: type });
        extraColumns = `, "tags" text[], "state" ${type}, "states" ${type}[]`;
      }
      await sql(`CREATE TABLE ${target} ("ID" ${db === 'oracle' ? 'NUMBER' : 'integer'}, "amount" ${db === 'oracle' ? 'NUMBER(10,2)' : 'numeric(10,2)'} CHECK ("amount" > 0), "NOTE" ${db === 'oracle' ? 'VARCHAR2(40)' : 'varchar(40)'}${extraColumns})`);
      created.push({ type: 'TABLE', name: target });
      const indexName = token + "_AI'Index";
      await sql(`CREATE INDEX ${db === 'oracle' ? `${q(schema)}.` : ''}${q(indexName)} ON ${target} ("NOTE")`);
      created.push({ type: 'INDEX', name: `${q(schema)}.${q(indexName)}` });
      await sql(`COMMENT ON COLUMN ${target}."NOTE" IS 'owner''s note'`); await main.commit();
      await sql(`INSERT INTO ${target} ("ID", "amount", "NOTE") VALUES (1, 12.34, 'pending')`);
      const invoke = createDatabaseIpc(main, db), calls = [], contexts = [], alerts = [];
      const analyzedSql = `SELECT * FROM ${target} WHERE "ID" = CAST(:mb_input_0 AS ${db === 'oracle' ? 'NUMBER' : 'NUMERIC'})`;
      const firstSql = db === 'oracle' ? 'SELECT 0 FROM DUAL' : 'SELECT 0';
      const sqlWindow = await createSqlWindowHarness(db, `${firstSql};\nSELECT * FROM ${target} WHERE "ID" = :id;`, invoke, { realBatches: true, schema });
      try {
        sqlWindow.state.setIsExplainMode(true); sqlWindow.state.setBindValues({ ID: '1' }); sqlWindow.state.setBindTypes({ ID: 'NUMBER' });
        await sqlWindow.flush(); await sqlWindow.state.handleExecuteSql(); await sqlWindow.flush();
        assert.deepEqual(sqlWindow.alerts, []);
        const snapshot = sqlWindow.state.explainSnapshot;
        assert.ok(snapshot); assert.equal(snapshot.sql, analyzedSql); assert.equal(snapshot.schema, schema);
        const plan = { rows: snapshot.rows };
        if (db === 'postgresql') assert.equal(JSON.parse(plan.rows[0].PLAN_TABLE_OUTPUT)[0].Plan.Schema, schema);
        sqlWindow.state.setSqlText('SELECT 999 AS editor_changed');
        if (db === 'postgresql') sqlWindow.state.setSelectedSchema('another_schema');
        await sqlWindow.flush();
        let failureStage;
        const { useSqlWindowBottom } = loadTypeScript('src/features/sql/useSqlWindowBottom.ts', {
          './explainIdentity': loadTypeScript('src/features/sql/explainIdentity.ts'),
          react: { useMemo: callback => callback(), useState: value => [value, () => {}] },
          'react-i18next': { useTranslation: () => ({ t: (key, values) => translate(key, 'en', values), i18n: { language: 'en' } }) },
          '../data-grid/dataGridHelper': { buildTransposedColumns: () => [] },
          '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, query, binds) => {
            assert.equal(channel, 'execute-sql-bg', 'Tuning context must only read background metadata');
            calls.push({ query, binds });
            const stage = /FROM ALL_TABLES|FROM pg_class c JOIN/.test(query) ? 'table statistics'
              : /FROM ALL_TAB_COLUMNS|FROM pg_stats/.test(query) ? 'column statistics'
              : /FROM ALL_INDEXES|FROM pg_indexes/.test(query) ? 'indexes' : undefined;
            if (failureStage && stage === failureStage) return invoke(channel, `SELECT "MBT_MISSING" FROM ${target}`);
            return invoke(channel, query, binds);
          } } }
        }, { alert: message => alerts.push(message) });
        const h = useSqlWindowBottom({ rows: plan.rows, columns: [], isExplainResult: true, dbType: db,
          explainSnapshot: snapshot,
          dateFormat: 'YYYY-MM-DD', selectedSchema: sqlWindow.state.selectedSchema, sqlText: sqlWindow.state.sqlText, title: 'Tuning test',
          isAiEnabled: true, onOpenAiSidebar: context => contexts.push(context) });
        const planTables = [];
        const visit = nodes => nodes.forEach(node => { if (node.table) planTables.push(node.table); visit(node.children); });
        visit(h.parsedExplain.tree);
        assert.ok(planTables.some(table => table.schema === schema && table.objectName === name));
        await h.handleExportForAI();
        assert.deepEqual(alerts, []); assert.equal(contexts.length, 1);
        const prompt = contexts[0].initialPrompt;
        assert.ok(prompt.includes(analyzedSql)); assert.ok(!prompt.includes('editor_changed'));
        assert.ok(prompt.includes(name)); assert.ok(prompt.includes(indexName));
        assert.match(prompt, db === 'oracle' ? /NUMBER\(10,2\)/ : /numeric\(10,2\)/);
        if (db === 'postgresql') {
          assert.ok(prompt.includes("owner''s note"));
          assert.ok(prompt.includes('text[]')); assert.ok(prompt.includes(q(token + '_AI_State')));
          assert.ok(prompt.includes('CHECK')); assert.ok(calls.some(call => call.binds.target === target));
        } else assert.ok(calls.some(call => call.binds.tableName === name));
        assert.ok(calls.every(call => !call.query.includes(name) && !call.query.includes(indexName)));
        for (const stage of ['table statistics', 'column statistics', 'indexes']) {
          failureStage = stage; contexts.length = 0; alerts.length = 0;
          await h.handleExportForAI();
          assert.equal(contexts.length, 0); assert.equal(alerts.length, 1);
        }
        failureStage = undefined; contexts.length = 0; alerts.length = 0;
        await h.handleExportForAI(); assert.equal(contexts.length, 1); assert.deepEqual(alerts, []);
        assert.equal(main.getMainTransactionState(), true);
        assert.equal((await read(observer, `SELECT * FROM ${target}`)).length, 0);
        assert.equal((await read(main, `SELECT "NOTE" FROM ${target}`))[0].NOTE, 'pending');
      } finally { sqlWindow.unmount(); await main.rollback(); }
    });

    if (db === 'postgresql') await step('Round-trip precise table types and named constraints through renderer source and real Git refreshes', async () => {
      const name = `${token}_SOURCE`, target = `${q(schema)}.${q(name)}`;
      const enumType = `${q(schema)}.${q(token + '_State')}`, domain = `${q(schema)}.${q(token + '_Money')}`, parent = `${q(schema)}.${q(token + '_SourceParent')}`;
      await sql(`CREATE TYPE ${enumType} AS ENUM ('open', 'closed')`); created.push({ type: 'TYPE', name: enumType });
      await sql(`CREATE DOMAIN ${domain} AS numeric(12,4)`); created.push({ type: 'DOMAIN', name: domain });
      await sql(`CREATE TABLE ${parent} (id integer PRIMARY KEY)`); created.push({ type: 'TABLE', name: parent });
      await sql(`INSERT INTO ${parent} VALUES (1)`); await main.commit();
      await sql(`CREATE TABLE ${target} (
        id bigint GENERATED ALWAYS AS IDENTITY, "Second" text NOT NULL, "quote""col" varchar(25) DEFAULT 'owner''s note',
        amount numeric(10,2) NOT NULL, tags text[], state ${enumType}, states ${enumType}[], money ${domain},
        happened timestamp(3) with time zone, parent_id integer DEFAULT 1,
        total numeric(12,2) GENERATED ALWAYS AS (amount * 2) STORED,
        CONSTRAINT ${q(token + '_Source_PK')} PRIMARY KEY ("Second", id),
        CONSTRAINT ${q(token + '_Source_UQ')} UNIQUE ("Second"),
        CONSTRAINT ${q(token + '_Source_CK')} CHECK (amount > 0),
        CONSTRAINT ${q(token + '_Source_FK')} FOREIGN KEY (parent_id) REFERENCES ${parent}(id)
      )`); created.push({ type: 'TABLE', name: target });
      await sql(`COMMENT ON COLUMN ${target}."quote""col" IS 'owner''s note'`);
      await sql(`CREATE INDEX ${q(token + '_Source_IDX')} ON ${target} (lower("Second"))`);
      const invoke = createDatabaseIpc(main, db), repo = await createGitRepository(t);
      const { getFullTableDDL } = loadTypeScript('src/features/postgresql/windows/common/ddlHelper.ts');
      const h = createVersionControl((channel, args) => repo.invoke(channel, args), { schema, objectName: name });
      const identity = { dbType: 'POSTGRESQL', schema, objectType: 'TABLE', objectName: name };
      const getSource = () => getFullTableDDL({ invoke }, schema, name, translate, false);
      try {
        const original = await getSource();
        assert.ok(original.includes('numeric(10,2)')); assert.ok(original.includes('text[]'));
        assert.ok(original.includes(q(token + '_State'))); assert.ok(original.includes(q(token + '_Money')));
        assert.ok(original.includes('timestamp(3) with time zone'));
        h.props.currentSource = original; await h.flush(); await h.render().handleCommit();
        // Only this scenario's own table is replaced; referenced types and parent remain.
        await sql(`DROP TABLE ${target}`);
        for (const statement of scripts.splitSqlScript(original, 'postgresql')) await sql(statement.text);
        assert.equal(await getSource(), original, 'Recreated catalog source must match exactly');
        await sql(`INSERT INTO ${target} ("Second", amount, tags, state, states, money) VALUES ('key', 12.34, ARRAY['a', 'b'], 'open', ARRAY['open']::${enumType}[], 1.2345)`);
        const row = (await read(main, `SELECT id, total, tags, "quote""col" FROM ${target}`))[0];
        assert.equal(String(row.id), '1'); assert.equal(String(row.total), '24.68'); assert.deepEqual(row.tags, ['a', 'b']); assert.equal(row['quote"col'], "owner's note");
        await main.rollback();
        await sql(`ALTER TABLE ${target} DROP CONSTRAINT ${q(token + '_Source_CK')}`);
        await sql(`ALTER TABLE ${target} ADD CONSTRAINT ${q(token + '_Source_CK')} CHECK (amount > 10)`);
        h.props.currentSource = ''; await h.flush(); h.props.currentSource = await getSource(); await h.flush(); await h.render().handleCommit();
        const history = await repo.invoke('git-get-history', identity); assert.equal(history.history.length, 2);
        const latest = await repo.invoke('git-get-file-content', { ...identity, commitId: history.history[0].fullId });
        const earlier = await repo.invoke('git-get-file-content', { ...identity, commitId: history.history[1].fullId });
        assert.ok(latest.content.includes('amount > (10)')); assert.ok(earlier.content.includes('amount > (0)'));
        for (const source of [latest.content, earlier.content]) { assert.ok(source.includes('FOREIGN KEY')); assert.ok(source.includes('numeric(10,2)')); }
      } finally { h.unmount(); }
    });

    await step('Recover failed table initialization and retain complete results after count or data failures', async () => {
      const name = token + '_RETRY', target = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${target} ("ID" ${db === 'oracle' ? 'NUMBER' : 'integer'} PRIMARY KEY, "NOTE" ${db === 'oracle' ? 'VARCHAR2(40)' : 'varchar(40)'})`); created.push({ type: 'TABLE', name: target });
      await sql(`INSERT INTO ${target} VALUES (1, 'original')`); await sql(`INSERT INTO ${target} VALUES (2, 'second')`); await main.commit();
      await sql(`UPDATE ${target} SET "NOTE" = 'pending' WHERE "ID" = 1`);
      const invoke = createDatabaseIpc(main, db), ids = loadTypeScript('src/features/data-grid/rowIdentity.ts');
      let failMetadata = true, failCount = false, failData = false, reads = 0, metadataReads = 0;
      const h = await createTableHarness(db, async (channel, query, binds) => {
        if (channel === 'execute-sql-bg') {
          metadataReads++;
          if (failMetadata) return invoke(channel, `SELECT "MBT_MISSING" FROM ${target}`);
        } else if (channel === 'execute-sql' && /COUNT\(/.test(query)) {
          if (failCount) return invoke(channel, `SELECT COUNT("MBT_MISSING") AS "CNT" FROM ${target}`);
        } else if (channel === 'execute-sql') {
          reads++;
          if (failData) return invoke(channel, `SELECT "MBT_MISSING" FROM ${target}`);
        }
        return invoke(channel, query, binds);
      }, { schema, tableName: name });
      try {
        await h.waitFor(state => !state.isLoading);
        assert.equal(h.state.displayRows.length, 0); assert.equal(h.state.columns.length, 0); assert.equal(h.alerts.length, 1); assert.equal(reads, 0);
        failMetadata = false; h.state.handleExecuteSearchClick(); await h.waitFor(state => !state.isLoading && state.displayRows.length === 2);
        assert.equal(metadataReads, 2); assert.equal(h.state.rowCount, 2);
        const rows = h.state.displayRows, page = h.state.paginationModel;
        h.state.setSelectedRowIds([ids.getRowIdentity(rows[0])]); await h.flush();
        failCount = true; const before = reads;
        await h.state.executeSearch({}, 1, 100); await h.flush();
        assert.equal(reads, before); assert.equal(h.state.displayRows, rows); assert.equal(h.state.rowCount, 2); assert.equal(h.state.paginationModel, page); assert.equal(h.state.selectedRowIds.length, 1);
        failCount = false; failData = true;
        await h.state.executeSearch({}, 1, 100); await h.flush();
        assert.equal(h.state.displayRows, rows); assert.equal(h.state.rowCount, 2); assert.equal(h.state.paginationModel, page);
        assert.equal((await read(main, `SELECT "NOTE" FROM ${target} WHERE "ID" = 1`))[0].NOTE, 'pending');
        assert.equal((await read(observer, `SELECT "NOTE" FROM ${target} WHERE "ID" = 1`))[0].NOTE, 'original');
        assert.equal(main.getMainTransactionState(), true);
        failData = false; h.state.handleExecuteSearchClick(); await h.flush();
        await h.waitFor(state => !state.isLoading && state.bottomTab === 0);
        assert.equal(h.state.displayRows.length, 2); assert.equal(h.state.selectedRowIds.length, 0);
        for (const [field, expectedId, failing] of [['ID', 1, false], ['ID', 2, false], ['NOTE', undefined, true]]) {
          const previous = h.state.conditions, saved = JSON.stringify(previous), rowsBeforeSort = h.state.displayRows;
          Object.values(previous).forEach(Object.freeze); Object.freeze(previous);
          failCount = failing;
          h.state.handleColumnHeaderClick({ field }); await h.waitFor(state => !state.isLoading);
          assert.equal(JSON.stringify(previous), saved);
          assert.notEqual(h.state.conditions.ID, previous.ID); assert.notEqual(h.state.conditions.NOTE, previous.NOTE);
          if (failing) assert.equal(h.state.displayRows, rowsBeforeSort);
          else assert.equal(Number(h.state.displayRows[0].ID), expectedId);
        }
        failCount = false; h.state.handleExecuteSearchClick(); await h.waitFor(state => !state.isLoading);
        assert.equal(h.state.displayRows[0].NOTE, 'pending');
        assert.equal((await read(observer, `SELECT "NOTE" FROM ${target} WHERE "ID" = 1`))[0].NOTE, 'original');
        await h.state.executeSearch({ ID: { value: '999', type: 'NUMBER', operator: '=', sort: '' } }, 0, 50); await h.flush();
        assert.equal(h.state.rowCount, 0); assert.equal(h.state.displayRows.length, 0); assert.equal(h.state.bottomTab, 0);
        assert.equal(main.getMainTransactionState(), true);
      } finally { h.unmount(); await main.rollback(); }
    });

    await step('Duplicate NULL defaults and exact timestamps independently of display formats and timestamp keys', async () => {
      const name = `${token}_TIME`, target = `${q(schema)}.${q(name)}`, digits = db === 'oracle' ? '123456789' : '123456';
      const timestampType = `TIMESTAMP(${digits.length})`;
      await sql(`CREATE TABLE ${target} ("ID" ${db === 'oracle' ? 'NUMBER' : 'integer'}, "STAMP" ${timestampType}, "ZONED" ${timestampType} WITH TIME ZONE, "LOCAL" ${timestampType}${db === 'oracle' ? ' WITH LOCAL TIME ZONE' : ''}, "DAY" DATE, "NOTE" ${db === 'oracle' ? 'VARCHAR2(40)' : 'varchar(40)'} DEFAULT 'fallback', PRIMARY KEY ("ID", "STAMP"))`);
      created.push({ type: 'TABLE', name: target });
      const viewName = token + '_TIME_VIEW', view = `${q(schema)}.${q(viewName)}`;
      await sql(`CREATE VIEW ${view} AS SELECT * FROM ${target}`); created.push({ type: 'VIEW', name: view });
      const { canonicalTemporalSql, oracleColumnProjection } = loadTypeScript('src/shared/utils/temporalValues.ts');
      const stamp = `2026-10-23 12:34:56.${digits}`, zoned = `${stamp} +05:45`;
      await sql(`INSERT INTO ${target} VALUES (1, ${canonicalTemporalSql({ DATA_TYPE: timestampType }, stamp, db)}, ${db === 'oracle' ? `FROM_TZ(${canonicalTemporalSql({ DATA_TYPE: timestampType }, stamp, db)}, 'America/New_York')` : canonicalTemporalSql({ DATA_TYPE: timestampType + ' WITH TIME ZONE' }, zoned, db)}, ${canonicalTemporalSql({ DATA_TYPE: timestampType }, stamp, db)}, ${canonicalTemporalSql({ DATA_TYPE: 'DATE' }, db === 'oracle' ? '2026-10-23 12:34:56' : '2026-10-23', db)}, NULL)`); await main.commit();
      const invoke = createDatabaseIpc(main, db), desktop = snapshotDesktop(invoke, db);
      const h = await createTableHarness(db, desktop.ipcRenderer.invoke, { schema, tableName: name, inputDateFormat: 'YYYY/MM/DD', outputDateFormat: 'YYYY/MM/DD' });
      const definitions = [{ COLUMN_NAME: 'STAMP', DATA_TYPE: timestampType }, { COLUMN_NAME: 'ZONED', DATA_TYPE: timestampType + ' WITH TIME ZONE' }, { COLUMN_NAME: 'LOCAL', DATA_TYPE: timestampType + (db === 'oracle' ? ' WITH LOCAL TIME ZONE' : '') }, { COLUMN_NAME: 'DAY', DATA_TYPE: 'DATE' }];
      const projection = db === 'oracle' ? definitions.map(column => oracleColumnProjection(column)).join(', ') : 't."STAMP", t."ZONED", t."LOCAL", t."DAY"';
      const values = async id => (await read(main, `SELECT ${projection}, "NOTE" FROM ${target} t WHERE "ID" = ${id}`))[0];
      try {
        const deadline = Date.now() + 10000;
        while (h.state.isLoading && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 10)); await h.flush(); }
        assert.equal(h.state.displayRows.length, 1, h.alerts.at(-1));
        assert.equal(h.state.displayRows[0].STAMP, '2026/10/23');
        const initial = await values(1); assert.ok(initial.STAMP.includes(digits));
        await h.state.handleOpenDuplicate(h.state.displayRows[0]); await h.flush();
        assert.equal(h.state.recordDialog.recordData.NOTE, null);
        assert.ok(h.state.recordDialog.recordData.STAMP.includes(digits));
        h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { ...h.state.recordDialog.recordData, ID: 2 } }); await h.flush();
        await h.state.submitRecord(); await h.flush();
        assert.equal(h.state.recordDialog.isOpen, false, h.alerts.at(-1));
        const duplicate = await values(2); assert.equal(duplicate.STAMP, initial.STAMP); assert.equal(duplicate.ZONED, initial.ZONED); assert.equal(duplicate.NOTE, null); assert.equal(duplicate.LOCAL, initial.LOCAL); assert.equal(duplicate.DAY, initial.DAY);
        // The grid hides the time, but the WHERE clause must use its full original key.
        const old = h.state.displayRows.find(row => Number(row.ID) === 1);
        const result = await h.state.handleProcessRowUpdate({ ...old, NOTE: 'changed' }, old); await h.flush();
        assert.equal(result.NOTE, 'changed'); assert.equal((await values(1)).NOTE, 'changed');
        assert.equal((await values(1)).STAMP, initial.STAMP);
        const condition = (value, operator = '=') => ({ value, type: 'DATE', operator, sort: '' });
        const nextStamp = `2026-10-23 12:34:56.${String(BigInt(digits) + 1n).padStart(digits.length, '0')}`;
        for (const [column, value, operator, count] of [['STAMP', stamp, '=', 2], ['STAMP', nextStamp, '>=', 0], ['ZONED', initial.ZONED, '=', 2]]) {
          await h.state.executeSearch({ [column]: condition(value, operator) }, 0, 50); await h.flush();
          assert.equal(h.state.displayRows.length, count, h.alerts.at(-1));
        }
        const v = await createViewHarness(db, desktop, { schema, viewName, dateFormat: 'DD/MM/YYYY HH:mm:ss' });
        try {
          await v.waitFor(state => !state.isLoading && state.displayRows.length === 2);
          for (const [column, value, operator, count] of [['STAMP', stamp, '=', 2], ['STAMP', nextStamp, '>=', 0], ['ZONED', initial.ZONED, '=', 2]]) {
            await v.state.executeSearch({ [column]: condition(value, operator) }, 0, 50); await v.flush();
            assert.equal(v.state.displayRows.length, count, v.alerts.at(-1));
          }
        } finally { v.unmount(); }

        // Export with a time-bearing format must retain every fractional digit.
        const context = { schema, tableName: name, structureDefs: h.state.structureDefs, resultColumns: [], outputDateFormat: 'DD/MM/YYYY HH:mm:ss', conditions: {}, paginationModel: { page: 0, pageSize: 50 }, t: key => key,
          buildQueryStrings: () => ({ whereStr: '', orderStr: '' }), formatSqlValue() {}, executeSearch: async () => {}, setIsLoading() {}, setLogs() {}, setBottomTab() {} };
        const { createTableDataTransfer } = loadTypeScript(`src/features/${db}/windows/table/tableDataTransfer.ts`, { '@/shared/api/desktop': desktop });
        const fetch = createTableDataTransfer(context).fetchDataForExport;
        try { const rows = await fetch(0, 50); assert.ok(rows.every(row => row.STAMP.includes(digits) && row.ZONED.includes(digits))); }
        finally { await fetch.close(); }
        await main.rollback();
      } finally { h.unmount(); desktop.close(); await main.rollback(); }
    });

    if (db === 'postgresql') await step('Edit, duplicate, search and import TIME values with exact microseconds and offsets', async () => {
      const name = token + '_CLOCK', target = `${q(schema)}.${q(name)}`, viewName = token + '_CLOCK_VIEW', view = `${q(schema)}.${q(viewName)}`;
      await sql(`CREATE TABLE ${target} ("ID" integer, "CLOCK" time(6) without time zone, "ZCLOCK" time(6) with time zone, "NOTE" varchar(40), PRIMARY KEY ("ID", "CLOCK"))`); created.push({ type: 'TABLE', name: target });
      await sql(`CREATE VIEW ${view} AS SELECT * FROM ${target}`); created.push({ type: 'VIEW', name: view });
      const time = '12:34:56.123456', zone = '12:34:56.123456+05:45';
      await sql(`INSERT INTO ${target} VALUES (1, '${time}', '${zone}', 'initial')`); await main.commit();
      const invoke = createDatabaseIpc(main, db), desktop = snapshotDesktop(invoke, db);
      const h = await createTableHarness(db, desktop.ipcRenderer.invoke, { schema, tableName: name, inputDateFormat: 'YYYY/MM/DD', outputDateFormat: 'YYYY/MM/DD' });
      const get = async id => (await read(main, `SELECT * FROM ${target} WHERE "ID" = ${id}`))[0];
      try {
        const deadline = Date.now() + 10000;
        while (h.state.isLoading && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 10)); await h.flush(); }
        assert.equal(h.state.conditions.CLOCK.type, 'TIME'); assert.equal(h.state.conditions.ZCLOCK.type, 'TIME');
        await h.state.handleOpenDuplicate(h.state.displayRows[0]); await h.flush();
        assert.equal(h.state.recordDialog.recordData.CLOCK, time); assert.equal(h.state.recordDialog.recordData.ZCLOCK, zone);
        h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { ...h.state.recordDialog.recordData, ID: 2 } }); await h.flush();
        await h.state.submitRecord(); await h.flush(); assert.equal(h.state.recordDialog.isOpen, false, h.alerts.at(-1));
        assert.equal((await get(2)).CLOCK, time); assert.equal((await get(2)).ZCLOCK, zone);
        h.state.handleOpenInsert(); await h.flush();
        h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { ID: 3, CLOCK: '23:59:59.999999', ZCLOCK: '00:00:00.000001-03:30', NOTE: 'added' } }); await h.flush();
        await h.state.submitRecord(); await h.flush(); assert.equal(h.state.recordDialog.isOpen, false, h.alerts.at(-1));
        assert.equal((await get(3)).CLOCK, '23:59:59.999999'); assert.equal((await get(3)).ZCLOCK, '00:00:00.000001-03:30');
        const third = h.state.displayRows.find(row => row.ID === 3);
        await h.state.handleProcessRowUpdate({ ...third, ZCLOCK: '01:02:03.000004-03:30' }, third); await h.flush();
        assert.equal((await get(3)).ZCLOCK, '01:02:03.000004-03:30');
        const old = h.state.displayRows.find(row => row.ID === 1);
        await h.state.handleProcessRowUpdate({ ...old, NOTE: 'inline' }, old); await h.flush(); assert.equal((await get(1)).NOTE, 'inline');
        const condition = (value, operator = '=') => ({ value, type: 'TIME', operator, sort: '' });
        for (const [column, value, operator, count] of [['CLOCK', time, '=', 2], ['CLOCK', time, '>', 1], ['ZCLOCK', zone, '=', 2]]) {
          await h.state.executeSearch({ [column]: condition(value, operator) }, 0, 50); await h.flush(); assert.equal(h.state.displayRows.length, count, h.alerts.at(-1));
        }
        const v = await createViewHarness(db, desktop, { schema, viewName });
        try {
          await v.waitFor(state => !state.isLoading && state.displayRows.length === 3);
          assert.equal(v.state.conditions.CLOCK.type, 'TIME'); assert.equal(v.state.conditions.ZCLOCK.type, 'TIME');
          await v.state.executeSearch({ CLOCK: condition(time) }, 0, 50); await v.flush(); assert.equal(v.state.displayRows.length, 2, v.alerts.at(-1));
        } finally { v.unmount(); }
        const definitions = h.state.structureDefs;
        const builder = loadTypeScript('src/features/postgresql/windows/table/tableQueryBuilder.ts').createTableQueryBuilder({ schema, structureDefs: definitions, inputDateFormat: 'YYYY/MM/DD', outputDateFormat: 'YYYY/MM/DD' });
        const { createTableDataTransfer } = loadTypeScript('src/features/postgresql/windows/table/tableDataTransfer.ts', { '@/shared/api/desktop': desktop }, { alert() {} });
        const context = { schema, tableName: name, structureDefs: definitions, resultColumns: [], outputDateFormat: 'YYYY/MM/DD', conditions: {}, paginationModel: { page: 0, pageSize: 50 }, t: key => key,
          ...builder, executeSearch: async () => {}, setIsLoading() {}, setLogs() {}, setBottomTab() {} };
        await createTableDataTransfer(context).processBulkInsertData([['ID', 'CLOCK', 'ZCLOCK', 'NOTE'], ['4', '03:04:05.000006', '03:04:05.000006+02:45', 'table']], () => {}, true);
        const { createSidebarDataTransfer } = loadTypeScript('src/features/postgresql/sidebarDataTransfer.ts', { '@/shared/api/desktop': desktop }, { alert() {}, window: { dispatchEvent() {} }, CustomEvent: class {} });
        await createSidebarDataTransfer({ importTarget: { schema, tableName: name, structureDefs: definitions, dbColumns: definitions.map(column => column.COLUMN_NAME) }, outputDateFormat: 'YYYY/MM/DD', t: key => key,
          setIsLoading() {}, setImportTarget() {} }).processSidebarBulkInsertData([['ID', 'CLOCK', 'ZCLOCK', 'NOTE'], ['5', '03:04:05.000006', '03:04:05.000006+02:45', 'sidebar']], () => {}, true);
        for (const id of [4, 5]) { assert.equal((await get(id)).CLOCK, '03:04:05.000006'); assert.equal((await get(id)).ZCLOCK, '03:04:05.000006+02:45'); }
        await h.state.handleOpenUpdate(h.state.displayRows.find(row => row.ID === 1)); await h.flush();
        h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { ...h.state.recordDialog.recordData, ZCLOCK: 'not-a-time' } }); await h.flush();
        await h.state.submitRecord(); await h.flush(); assert.equal(h.state.recordDialog.isOpen, true); assert.equal(h.state.recordDialog.recordData.ZCLOCK, 'not-a-time');
        assert.equal((await get(1)).ZCLOCK, zone); assert.equal((await get(1)).NOTE, 'inline');
        assert.equal((await read(observer, `SELECT "NOTE" FROM ${target} WHERE "ID" = 1`))[0].NOTE, 'initial');
      } finally { h.unmount(); desktop.close(); await main.rollback(); }
    });

    await step('Preserve literal search values, NULL text keys and confirmed deletion counts through table hooks', async () => {
      const name = `${token}_SAFE`, target = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${target} ("ID" ${db === 'oracle' ? 'VARCHAR2(40)' : 'varchar(40)'} PRIMARY KEY, "NOTE" ${db === 'oracle' ? 'VARCHAR2(100)' : 'varchar(100)'} DEFAULT 'fallback', "AMOUNT" ${db === 'oracle' ? 'NUMBER' : 'numeric'})`);
      created.push({ type: 'TABLE', name: target });
      for (const [id, note] of [['null', 'null'], ['one', " O'Reilly 50%_! "], ['two', ' OReilly 500x! '], ['partial', 'old']]) {
        await sql(`INSERT INTO ${target} VALUES (:id, :note, 12345678901234567890.1234567)`, { id, note });
      }
      await main.commit();
      if (db === 'postgresql') {
        const child = `${q(schema)}.${q(token + '_SAFE_CHILD')}`;
        await sql(`CREATE TABLE ${child} ("ID" varchar(40) REFERENCES ${target}("ID"))`);
        created.push({ type: 'TABLE', name: child });
        await sql(`INSERT INTO ${child} VALUES ('two')`); await main.commit();
      }
      const invoke = async (channel, query, binds) => {
        try { return { success: true, ...await sql(query, binds, channel === 'execute-sql-bg') }; }
        catch { return { success: false, error: 'Database operation failed' }; }
      };
      const h = await createTableHarness(db, invoke, { schema, tableName: name });
      try {
        for (let i = 0; i < 100 && h.state.isLoading; i++) { await new Promise(resolve => setTimeout(resolve, 20)); await h.flush(); }
        assert.equal(h.state.displayRows.length, 4, h.alerts.at(-1));
        const filter = (value, type = 'STRING', operator = '=') => ({ value, type, operator, sort: '' });
        await h.state.executeSearch({ NOTE: filter(" O'Reilly 50%_! ", 'STRING', 'LIKE') }, 0, 50); await h.flush();
        assert.equal(h.state.displayRows.length, 1); assert.equal(h.state.displayRows[0].ID, 'one');
        await h.state.executeSearch({ AMOUNT: filter('12345678901234567890.1234567', 'NUMBER') }, 0, 50); await h.flush();
        assert.equal(h.state.displayRows.length, 4);
        const oldRows = h.state.displayRows;
        await h.state.executeSearch({ AMOUNT: filter('1 OR 1=1', 'NUMBER') }, 0, 50); await h.flush();
        assert.equal(h.state.displayRows, oldRows); assert.ok(h.alerts.at(-1).includes('Invalid numeric'));
        await h.state.executeSearch({ ID: filter('null') }, 0, 50); await h.flush();
        assert.equal(h.state.displayRows.length, 1);
        await h.state.handleOpenUpdate(h.state.displayRows[0]); await h.flush();
        h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { ...h.state.recordDialog.recordData, NOTE: 'NULL' } }); await h.flush();
        await h.state.submitRecord(); await h.flush();
        assert.equal((await read(main, `SELECT "NOTE" FROM ${target} WHERE "ID" = 'null'`))[0].NOTE, 'NULL');
        await main.rollback();
        // A concurrent deletion produces zero affected rows and retains the user's selection.
        await h.state.executeSearch({}, 0, 50); await h.flush();
        const ids = loadTypeScript('src/features/data-grid/rowIdentity.ts');
        const row = h.state.displayRows.find(row => row.ID === 'null');
        h.state.setSelectedRowIds([ids.getRowIdentity(row)]); await h.flush();
        await observer.execute(`DELETE FROM ${target} WHERE "ID" = 'null'`); await observer.commit();
        await sql(`UPDATE ${target} SET "NOTE" = 'pending' WHERE "ID" = 'partial'`);
        await h.state.handleDeleteSelected(); await h.flush();
        assert.equal(h.state.selectedRowIds.length, 1); assert.ok(h.alerts.at(-1).includes('Confirmed deletions: 0'));
        assert.equal((await read(observer, `SELECT "NOTE" FROM ${target} WHERE "ID" = 'partial'`))[0].NOTE, 'old');
        await main.rollback();
        if (db === 'postgresql') {
          // The second DELETE violates a real foreign key; the first deletion and unrelated work remain pending.
          await h.state.executeSearch({}, 0, 50); await h.flush();
          h.state.setSelectedRowIds(['one', 'two'].map(key => ids.getRowIdentity(h.state.displayRows.find(row => row.ID === key)))); await h.flush();
          await sql(`UPDATE ${target} SET "NOTE" = 'pending' WHERE "ID" = 'partial'`);
          await h.state.handleDeleteSelected(); await h.flush();
          assert.ok(h.alerts.at(-1).includes('Confirmed deletions: 1')); assert.equal(h.state.selectedRowIds.length, 2);
          assert.equal((await read(main, `SELECT "ID" FROM ${target} WHERE "ID" = 'one'`)).length, 0);
          assert.equal((await read(observer, `SELECT "ID" FROM ${target} WHERE "ID" = 'one'`)).length, 1);
          assert.equal((await read(main, `SELECT "NOTE" FROM ${target} WHERE "ID" = 'partial'`))[0].NOTE, 'pending');
          await main.rollback();
          // Explicit NULL overrides a default; an omitted field still uses its default.
          for (const [key, note] of [['explicit', null], ['omitted', '']]) {
            h.state.handleOpenInsert(); await h.flush();
            h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { ID: key, NOTE: note, AMOUNT: '' } }); await h.flush();
            await h.state.submitRecord(); await h.flush();
            assert.equal((await read(main, `SELECT "NOTE" FROM ${target} WHERE "ID" = '${key}'`))[0].NOTE, note === null ? null : 'fallback');
          }
          await main.rollback();
        }
      } finally { h.unmount(); await main.rollback(); }
    });

    await step('Keep table pages stable for duplicate sort values and separate draft filters from displayed results', async () => {
      const name = token + '_PAGE', target = qualifiedObjectName({ schema, objectName: name });
      await sql(`CREATE TABLE ${target} ("ID" INTEGER PRIMARY KEY, "LABEL" ${db === 'oracle' ? 'VARCHAR2(20)' : 'text'})`);
      created.push({ type: 'TABLE', name: target });
      const values = Array.from({ length: 60 }, (_, i) => { const id = 60 - i; return { id, label: id % 2 ? 'odd' : 'even' }; });
      await sql(db === 'oracle' ? `INSERT ALL ${values.map(({ id, label }) => `INTO ${target} ("ID", "LABEL") VALUES (${id}, '${label}')`).join(' ')} SELECT 1 FROM DUAL`
        : `INSERT INTO ${target} ("ID", "LABEL") VALUES ${values.map(({ id, label }) => `(${id}, '${label}')`).join(',')}`);
      await main.commit(); await sql(`INSERT INTO ${target} ("ID", "LABEL") VALUES (99, 'pending')`);
      const invoke = createDatabaseIpc(main, db), h = await createTableHarness(db, (channel, ...args) => channel === 'load-settings' ? {} : invoke(channel, ...args), { schema, tableName: name });
      try {
        await h.waitFor(state => !state.isLoading && state.structureDefs.length === 2 && state.displayRows.length === 50);
        const conds = { ...h.state.conditions, LABEL: { ...h.state.conditions.LABEL, sort: '1' } };
        const expected = Array.from({ length: 30 }, (_, i) => String((i + 1) * 2));
        const actual = [];
        for (let page = 0; page < 3; page++) {
          await h.state.executeSearch(conds, page, 10); await h.flush();
          assert.deepEqual(h.alerts, [], 'Sorted-page requests must succeed before reading retained rows.');
          assert.equal(h.state.displayRows.length, 10);
          assert.equal(h.state.paginationModel.page, page);
          assert.equal(h.state.paginationModel.pageSize, 10);
          actual.push(...h.state.displayRows.map(row => String(row.ID)));
        }
        assert.deepEqual(actual, expected);
        h.state.handleConditionChange('LABEL', 'value', 'odd'); await h.flush();
        assert.equal(h.state.conditionsPending, true);
        await h.state.executeSearch(h.state.appliedConditions, 0, 10); await h.flush();
        assert.deepEqual(Array.from(h.state.displayRows, row => String(row.ID)), expected.slice(0, 10));
        assert.equal(h.state.rowCount, 61);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 60);
        assert.equal(main.getMainTransactionState(), true);
      } finally { h.unmount(); await main.rollback(); }
    });

    await step('Search sidebar names literally with bound case-preserving metadata and retain pending changes', async () => {
      const wanted = token + '_MiX_%!x', decoy = token + '_MiXaZZ!x';
      for (const name of [wanted, decoy]) {
        const target = qualifiedObjectName({ schema, objectName: name });
        await sql(`CREATE TABLE ${target} ("ID" INTEGER)`); created.push({ type: 'TABLE', name: target });
      }
      const target = qualifiedObjectName({ schema, objectName: wanted });
      await sql(`INSERT INTO ${target} ("ID") VALUES (1)`);
      const invoke = createDatabaseIpc(main, db), calls = [];
      const record = (channel, ...args) => { calls.push([channel, ...args]); return invoke(channel, ...args); };
      let names;
      if (db === 'postgresql') names = await readSidebarTypes(schema, '_mix_%!x', record, 'TABLE');
      else {
        const { buildCategoryQuery } = loadTypeScript('src/features/oracle/sidebarQueries.ts');
        const query = buildCategoryQuery(schema, 'TABLE', '_mix_%!x', 0, 100);
        const response = await record('execute-sql-bg', query.sql, query.binds);
        assert.equal(response.success, true, response.error); names = response.rows.map(row => row.OBJECT_NAME);
      }
      assert.ok(names.includes(wanted)); assert.ok(!names.includes(decoy));
      assert.ok(calls.every(([channel]) => channel === 'execute-sql-bg'));
      assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 1);
      assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
      assert.equal(main.getMainTransactionState(), true); await main.rollback();
    });

    await step('Generate exact quoted columns with defaults and stop on unconfirmed or suppressed batches without committing', async () => {
      const name = token + (db === 'oracle' ? '.Gen x' : '.Gen"x'), target = qualifiedObjectName({ schema, objectName: name });
      const a = q(db === 'oracle' ? 'A code' : 'A"code'), b = q('B.value'), type = db === 'oracle' ? 'VARCHAR2(40)' : 'text';
      await sql(`CREATE TABLE ${target} (${a} ${type} DEFAULT 'left-default', ${b} ${type} DEFAULT 'right-default')`);
      created.push({ type: 'TABLE', name: target });
      const invoke = createDatabaseIpc(main, db);
      let hideSecondCount = false, batches = 0;
      const h = await createGeneratorHarness(db, async (channel, ...args) => {
        if (channel === 'load-settings') return {};
        const result = await invoke(channel, ...args);
        if (channel === 'execute-sql' && /^INSERT/.test(args[0])) {
          batches++;
          if (db === 'oracle' && hideSecondCount && batches === 2) return { ...result, rowsAffected: undefined };
        }
        return result;
      }, { schema, randomValues: [0.9, 0.1, 0.1, 0.9] });
      try {
        await h.waitFor(state => !state.isLoading && !!state.selectedSchema);
        h.state.setSelectedTable(name);
        await h.waitFor(state => !state.isLoading && state.columnRules.length === 2);
        for (let index = 0; index < 2; index++) {
          h.state.handleRuleChange(index, 'ruleType', 'FIXED');
          h.state.handleRuleChange(index, 'fixedValue', index ? "beta's" : 'alpha');
          h.state.handleRuleChange(index, 'nullRatio', 50);
        }
        h.state.setGenerateCount(2); await h.flush(); await h.state.handleGenerate(); await h.flush();
        assert.equal(h.alerts.length, 1); assert.match(h.alerts[0], /^2 row generation and insertion completed/);
        const rows = await read(main, `SELECT ${a} AS "A", ${b} AS "B" FROM ${target}`);
        assert.deepEqual(Array.from(rows, row => [row.A, row.B]).sort(), [['alpha', null], [null, "beta's"]].sort());
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        await main.rollback();
        // Preview retains exact input values; unspecified columns retain DB defaults.
        h.state.handleRuleChange(0, 'ruleType', 'SEQ_NUM');
        h.state.handleRuleChange(0, 'nullRatio', 0);
        h.state.handleRuleChange(1, 'ruleType', 'UNSPECIFIED');
        h.state.setGenerateCount(12); await h.flush();
        h.state.handlePreview(); await h.flush();
        const preview = h.state.previewRows.map(row => String(row[db === 'oracle' ? 'A code' : 'A"code']));
        assert.equal(preview.length, 10);
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        await h.state.handleGenerate(); await h.flush();
        const previewRows = await read(main, `SELECT ${a} AS "A", ${b} AS "B" FROM ${target}`);
        assert.equal(previewRows.length, 12);
        for (const value of preview) assert.ok(previewRows.some(row => row.A === value && row.B === 'right-default'));
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        await main.rollback();
        // Request a stop immediately after the real first batch returns, leaving it pending.
        h.state.setGenerateCount(1001); await h.flush();
        const stopInvoke = h.requests.length;
        const originalExecute = main.execute;
        let stopBatches = 0;
        main.execute = async function (...args) {
          const result = await originalExecute.apply(this, args);
          if (/^INSERT/.test(args[0]) && args[0].includes(target)) { stopBatches++; h.state.handleStop(); }
          return result;
        };
        try { await h.state.handleGenerate(); await h.flush(); } finally { main.execute = originalExecute; }
        assert.equal(stopBatches, 1);
        assert.equal(h.state.result.status, 'stopped'); assert.equal(h.state.result.confirmed, 500);
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 500);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        assert.ok(h.requests.slice(stopInvoke).every(([channel]) => !['commit-db', 'rollback-db', 'cancel-sql'].includes(channel)));
        await main.rollback();
        h.state.handleRuleChange(1, 'ruleType', 'FIXED'); await h.flush();
        if (db === 'postgresql') {
          const fn = `${q(schema)}.${q(token + '_GEN_SKIP_FN')}`, trigger = token + '_GEN_SKIP';
          await sql(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.${a} ~ '^[0-9]+$' THEN IF NEW.${a}::integer > 500 THEN RETURN NULL; END IF; END IF; RETURN NEW; END;$$`);
          created.push({ type: 'FUNCTION', name: `${fn}()` });
          await sql(`CREATE TRIGGER ${q(trigger)} BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
          created.push({ type: 'TRIGGER', name: `${q(trigger)} ON ${target}` });
        }
        for (let index = 0; index < 2; index++) h.state.handleRuleChange(index, 'nullRatio', 0);
        h.state.handleRuleChange(0, 'ruleType', 'SEQ_NUM');
        h.state.setGenerateCount(1001); await h.flush();
        batches = 0; hideSecondCount = true;
        await sql(`INSERT INTO ${target} (${a}) VALUES ('pending')`);
        await h.state.handleGenerate(); await h.flush();
        assert.equal(batches, 2); assert.equal(h.alerts.length, 4);
        assert.match(h.alerts.at(-1), /Data generation stopped/);
        assert.match(h.alerts.at(-1), /Confirmed inserted rows: 500/);
        assert.match(h.alerts.at(-1), /No automatic commit or rollback/);
        assert.equal(h.state.generateCount, 1001); assert.equal(h.state.isLoading, false);
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), db === 'oracle' ? 1001 : 501);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        assert.equal(main.getMainTransactionState(), true);
        assert.ok(h.requests.every(([channel]) => !['commit-db', 'rollback-db'].includes(channel)));
      } finally { h.unmount(); await main.rollback(); }
      assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
    });

    await step('Build generator AI prompts from exact quoted names and ordered composite foreign keys without mixing same-named constraints', async () => {
      const parentName = token + (db === 'oracle' ? ".Par'ent" : '.Par"ent');
      const childName = token + ".Chi'ld", parent = qualifiedObjectName({ schema, objectName: parentName });
      const child = qualifiedObjectName({ schema, objectName: childName });
      const p1 = 'P.Key', p2 = db === 'oracle' ? "Q'id" : 'Q"id', c1 = 'A mixed', c2 = "B'id";
      const type = db === 'oracle' ? 'VARCHAR2(40)' : 'text', constraint = token + '_GEN_FK';
      await sql(`CREATE TABLE ${parent} (${q(p1)} ${type}, ${q(p2)} ${type}, PRIMARY KEY (${q(p2)}, ${q(p1)}))`);
      created.push({ type: 'TABLE', name: parent });
      await sql(`CREATE TABLE ${child} (${q(c1)} ${type}, ${q(c2)} ${type}, CONSTRAINT ${q(constraint)} FOREIGN KEY (${q(c1)}, ${q(c2)}) REFERENCES ${parent} (${q(p2)}, ${q(p1)}))`);
      created.push({ type: 'TABLE', name: child });
      if (db === 'postgresql') {
        const otherParent = qualifiedObjectName({ schema, objectName: token + '_OTHER_PAR' });
        const otherChild = qualifiedObjectName({ schema, objectName: token + '_OTHER_CH' });
        await sql(`CREATE TABLE ${otherParent} ("unrelated" text PRIMARY KEY)`);
        created.push({ type: 'TABLE', name: otherParent });
        await sql(`CREATE TABLE ${otherChild} ("other_child" text CONSTRAINT ${q(constraint)} REFERENCES ${otherParent} ("unrelated"))`);
        created.push({ type: 'TABLE', name: otherChild });
      }
      await sql(`INSERT INTO ${parent} VALUES ('parent-b', 'parent-a')`);
      await sql(`INSERT INTO ${child} VALUES ('parent-a', 'parent-b')`);
      await main.commit();
      if (db === 'postgresql') await sql(`ANALYZE ${child}`);
      await sql(`INSERT INTO ${parent} VALUES ('pending-b', 'pending-a')`);
      const invoke = createDatabaseIpc(main, db), references = [], statistics = [], samples = [];
      const ddlDependencies = db === 'oracle'
        ? { './loadOracleDdl': loadTypeScript('src/features/oracle/windows/common/loadOracleDdl.ts') } : {};
      const getFullTableDDL = loadTypeScript(`src/features/${db}/windows/common/ddlHelper.ts`, ddlDependencies).getFullTableDDL;
      let context;
      const h = await createGeneratorHarness(db, async (channel, query, ...args) => {
        if (channel === 'load-settings') return {};
        const response = await invoke(channel, query, ...args);
        if (channel === 'execute-sql-bg' && /FROM pg_stats|NUM_DISTINCT, NUM_NULLS/.test(query)) {
          assert.equal(response.success, true); statistics.push(...response.rows);
          assert.equal(args[0].owner, schema); assert.equal(args[0].tableName, childName);
        }
        if (channel === 'execute-sql-bg' && /fk\.contype|ac\.CONSTRAINT_TYPE = 'R'/.test(query)) {
          assert.equal(response.success, true); references.push(...response.rows);
          assert.equal(args[0].owner, schema); assert.equal(args[0].tableName, childName);
        }
        if (channel === 'execute-sql') { samples.push(query); assert.equal(response.success, true); }
        return response;
      }, { schema, getFullTableDDL, onOpenAiSidebar: value => { context = value; } });
      try {
        await h.waitFor(state => !state.isLoading && !!state.selectedSchema);
        h.state.setSelectedTable(childName);
        await h.waitFor(state => !state.isLoading && state.columnRules.length === 2);
        await h.state.handleExportForAI(); await h.flush();
        assert.ok(context, h.alerts.at(-1)); assert.equal(h.alerts.length, 0);
        assert.equal(references.length, 2);
        assert.deepEqual(Array.from(references, row => [row.COLUMN_NAME, row.R_OWNER, row.R_TABLE_NAME, row.R_COLUMN_NAME]),
          [[c1, schema, parentName, p2], [c2, schema, parentName, p1]]);
        assert.deepEqual(statistics.map(row => row.COLUMN_NAME).sort(), [c1, c2].sort());
        assert.equal(samples.length, 2); assert.ok(samples.every(query => query.includes(parent)));
        for (const value of ['parent-a', 'parent-b', 'pending-a', 'pending-b']) assert.ok(context.initialPrompt.includes(value));
        assert.ok(context.initialPrompt.includes(childName)); assert.ok(!context.initialPrompt.includes('other_child'));
        assert.ok(!context.initialPrompt.includes('unrelated'));
        assert.equal(main.getMainTransactionState(), true);
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${parent}`))[0].CNT), 2);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${parent}`))[0].CNT), 1);
        assert.ok(!h.requests.some(([channel]) => ['ask-ai', 'commit-db', 'rollback-db'].includes(channel)));
      } finally { h.unmount(); await main.rollback(); }
      assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${parent}`))[0].CNT), 1);
    });

    await step('Generate the documented fictional order scenario and every string/date rule through real INSERTs without committing', async () => {
      assert.equal(main.getMainTransactionState(), false, 'The order scenario must start without unrelated pending work');
      const parent = qualifiedObjectName({ schema, objectName: token + '_GEN_CUSTOMERS' });
      const targetName = token + '_GEN_ORDERS', target = qualifiedObjectName({ schema, objectName: targetName });
      const varchar = length => db === 'oracle' ? `VARCHAR2(${length} BYTE)` : `varchar(${length})`;
      await sql(`CREATE TABLE ${parent} ("CUSTOMER_ID" INTEGER PRIMARY KEY)`);
      created.push({ type: 'TABLE', name: parent });
      await sql(`CREATE TABLE ${target} (
        "ORDER_ID" INTEGER PRIMARY KEY,
        "ORDER_CODE" ${varchar(10)} NOT NULL UNIQUE,
        "CUSTOMER_ID" INTEGER NOT NULL REFERENCES ${parent}("CUSTOMER_ID"),
        "STATUS" ${varchar(8)} NOT NULL CHECK ("STATUS" IN ('NEW','PAID','SHIPPED')),
        "AMOUNT" ${db === 'oracle' ? 'NUMBER(12,2)' : 'numeric(12,2)'} NOT NULL CHECK ("AMOUNT" BETWEEN 100 AND 10000),
        "ORDER_DATE" TIMESTAMP NOT NULL,
        "MEMO" ${varchar(30)}, "SEQ_CODE" ${varchar(12)} NOT NULL, "PADDED_CODE" ${varchar(6)} NOT NULL,
        "POSTAL_CODE" ${varchar(8)} NOT NULL,
        "ALPHA" ${varchar(8)} NOT NULL, "DIGITS" ${varchar(8)} NOT NULL,
        "TOKEN" ${varchar(8)} NOT NULL, "FULLWIDTH" ${varchar(60)} NOT NULL,
        "DAY_SEQ" DATE NOT NULL)`);
      created.push({ type: 'TABLE', name: target });
      for (const id of [101, 102, 103]) await sql(`INSERT INTO ${parent} ("CUSTOMER_ID") VALUES (${id})`);
      await main.commit();
      const native = createDatabaseIpc(main, db);
      const h = await createGeneratorHarness(db, (channel, ...args) => channel === 'load-settings' ? {} : native(channel, ...args),
        { schema, language: 'ja', random: seededRandom(424242), RandExp: createSeededRandExp(123456) });
      try {
        await h.waitFor(state => !state.isLoading && !!state.selectedSchema);
        h.state.setSelectedTable(targetName);
        await h.waitFor(state => !state.isLoading && state.columnRules.length === 15);
        const settings = {
          ORDER_ID: { ruleType: 'SEQ_NUM', seqStart: '1001', seqStep: '1' },
          ORDER_CODE: { ruleType: 'RANDOM_CHAR', randCharType: 'REGEX', randCharRegex: 'ORD-[0-9]{6}', randCharUnique: true },
          CUSTOMER_ID: { ruleType: 'CHOICE', choiceValues: '101,102,103' },
          STATUS: { ruleType: 'CHOICE', choiceValues: 'NEW,PAID,SHIPPED' },
          AMOUNT: { ruleType: 'RANDOM_NUM', randNumMin: '100', randNumMax: '10000', randNumRound: '0.01' },
          ORDER_DATE: { ruleType: 'RANDOM_DATE', randDateMin: '2026/01/01 00:00:00', randDateMax: '2026/01/31 23:59:59', randDateIncludeTime: true },
          MEMO: { ruleType: 'CHOICE', choiceValues: "Gift,Standard,Rush,O'Reilly", nullRatio: 20 },
          SEQ_CODE: { ruleType: 'SEQ_NUM', seqStart: '1001', seqStep: '1', seqPrefix: 'ORD-' },
          PADDED_CODE: { ruleType: 'SEQ_NUM', seqStart: '1', seqStep: '1', seqPadZero: true },
          POSTAL_CODE: { ruleType: 'RANDOM_CHAR', randCharType: 'REGEX', randCharRegex: '[0-9]{3}-[0-9]{4}' },
          ALPHA: { ruleType: 'RANDOM_CHAR', randCharType: 'ALPHA', randCharFill: true },
          DIGITS: { ruleType: 'RANDOM_CHAR', randCharType: 'NUM', randCharFill: true },
          TOKEN: { ruleType: 'RANDOM_CHAR', randCharType: 'ALPHANUM', randCharFill: true },
          FULLWIDTH: { ruleType: 'RANDOM_CHAR', randCharType: 'ZENKAKU', randCharFill: true },
          DAY_SEQ: { ruleType: 'SEQ_DATE', seqStartDate: '2024/02/28' }
        };
        for (const [columnName, fields] of Object.entries(settings)) {
          const index = h.state.columnRules.findIndex(rule => rule.COLUMN_NAME === columnName);
          assert.notEqual(index, -1);
          h.state.handleRuleChange(index, 'nullRatio', 0);
          for (const [key, setting] of Object.entries(fields)) h.state.handleRuleChange(index, key, setting);
        }
        h.state.setGenerateCount(100); await h.flush();
        const beforePreview = h.requests.filter(([channel]) => channel === 'execute-sql').length;
        h.state.handlePreview(); await h.flush();
        assert.deepEqual(h.alerts, []); assert.equal(h.state.previewRows.length, 10);
        assert.equal(h.requests.filter(([channel]) => channel === 'execute-sql').length, beforePreview);
        const preview = Array.from(h.state.previewRows, row => ({ id: String(row.ORDER_ID), code: row.ORDER_CODE, memo: row.MEMO }));
        await h.state.handleGenerate(); await h.flush();
        assert.equal(h.state.result?.status, 'success', h.state.result?.error);
        assert.equal(h.state.result.confirmed, 100); assert.equal(h.alerts.length, 1);
        const rows = await read(main, `SELECT "ORDER_ID", "ORDER_CODE", "CUSTOMER_ID", "STATUS",
          ${db === 'oracle' ? 'TO_CHAR("AMOUNT", \'TM9\')' : '"AMOUNT"::text'} AS "EXACT_AMOUNT",
          TO_CHAR("ORDER_DATE", 'YYYY-MM-DD HH24:MI:SS') AS "ORDER_STAMP",
          "MEMO", "SEQ_CODE", "PADDED_CODE", "POSTAL_CODE", "ALPHA", "DIGITS", "TOKEN", "FULLWIDTH",
          TO_CHAR("DAY_SEQ", 'YYYY-MM-DD') AS "CALENDAR_DAY" FROM ${target} ORDER BY "ORDER_ID"`);
        assert.equal(rows.length, 100);
        assert.equal(new Set(rows.map(row => row.ORDER_CODE)).size, 100);
        assert.deepEqual([...new Set(rows.map(row => String(row.CUSTOMER_ID)))].sort(), ['101', '102', '103']);
        assert.deepEqual([...new Set(rows.map(row => row.STATUS))].sort(), ['NEW', 'PAID', 'SHIPPED']);
        let nulls = 0;
        for (const [index, row] of rows.entries()) {
          assert.equal(String(row.ORDER_ID), String(1001 + index));
          assert.match(row.ORDER_CODE, /^ORD-[0-9]{6}$/);
          assert.ok(compareNumericValues(row.EXACT_AMOUNT, '100') >= 0 && compareNumericValues(row.EXACT_AMOUNT, '10000') <= 0);
          assert.match(row.EXACT_AMOUNT, /^\d+(?:\.\d{1,2})?$/);
          assert.ok(row.ORDER_STAMP >= '2026-01-01 00:00:00' && row.ORDER_STAMP <= '2026-01-31 23:59:59');
          assert.ok(row.MEMO === null || ['Gift', 'Standard', 'Rush', "O'Reilly"].includes(row.MEMO));
          if (row.MEMO === null) nulls++;
          assert.equal(row.SEQ_CODE, `ORD-${1001 + index}`);
          assert.equal(row.PADDED_CODE, String(index + 1).padStart(6, '0'));
          assert.match(row.POSTAL_CODE, /^[0-9]{3}-[0-9]{4}$/);
          assert.match(row.ALPHA, /^[A-Za-z]{8}$/); assert.match(row.DIGITS, /^[0-9]{8}$/);
          assert.match(row.TOKEN, /^[A-Za-z0-9]{8}$/); assert.match(row.FULLWIDTH, /^[あ-ん０-９Ａ-Ｆ]{20}$/u);
          assert.equal(row.CALENDAR_DAY, new Date(Date.UTC(2024, 1, 28 + index)).toISOString().slice(0, 10));
          if (index < preview.length) assert.deepEqual({ id: String(row.ORDER_ID), code: row.ORDER_CODE, memo: row.MEMO }, preview[index]);
        }
        assert.equal(rows[1].CALENDAR_DAY, '2024-02-29'); assert.equal(rows[2].CALENDAR_DAY, '2024-03-01');
        assert.ok(nulls > 0 && nulls < rows.length, 'The fixed random stream must exercise both NULL and non-NULL rows');
        assert.ok(rows.some(row => row.MEMO === "O'Reilly"), 'Quoted choices must survive a real database round trip');
        const orphanCount = value((await read(main, `SELECT COUNT(*) AS value FROM ${target} o LEFT JOIN ${parent} p ON p."CUSTOMER_ID" = o."CUSTOMER_ID" WHERE p."CUSTOMER_ID" IS NULL`))[0]);
        assert.equal(Number(orphanCount), 0);
        assert.equal(main.getMainTransactionState(), true);
        assert.equal(Number(value((await read(observer, `SELECT COUNT(*) AS value FROM ${target}`))[0])), 0);
        assert.ok(h.requests.every(([channel]) => !['commit-db', 'rollback-db', 'ask-ai'].includes(channel)));
        await main.rollback();
        assert.equal(Number(value((await read(main, `SELECT COUNT(*) AS value FROM ${target}`))[0])), 0);
        assert.equal(Number(value((await read(observer, `SELECT COUNT(*) AS value FROM ${parent}`))[0])), 3);
      } finally { h.unmount(); await main.rollback(); }
    });

    await step('Reject oversized regex strings without changing pending rows and insert full unique strings', async () => {
      const name = token + '_GEN_REGEX', target = qualifiedObjectName({ schema, objectName: name });
      await sql(`CREATE TABLE ${target} ("CODE" ${db === 'oracle' ? 'VARCHAR2(1)' : 'varchar(1)'} PRIMARY KEY)`);
      created.push({ type: 'TABLE', name: target });
      await sql(`INSERT INTO ${target} ("CODE") VALUES ('Z')`);
      const invoke = createDatabaseIpc(main, db);
      const h = await createGeneratorHarness(db, (channel, ...args) => channel === 'load-settings' ? {} : invoke(channel, ...args), { schema });
      try {
        await h.waitFor(state => !state.isLoading && !!state.selectedSchema);
        h.state.setSelectedTable(name);
        await h.waitFor(state => !state.isLoading && state.columnRules.length === 1);
        for (const [key, value] of Object.entries({ ruleType: 'RANDOM_CHAR', randCharType: 'REGEX', randCharRegex: 'A[0-9]', randCharUnique: true })) {
          h.state.handleRuleChange(0, key, value);
        }
        h.state.setGenerateCount(2); await h.flush(); await h.state.handleGenerate(); await h.flush();
        assert.match(h.alerts.at(-1), /CODE.*2 characters.*limit of 1/);
        assert.ok(!h.requests.some(([channel]) => channel === 'execute-sql'));
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 1);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        assert.equal(main.getMainTransactionState(), true);
        h.state.handleRuleChange(0, 'randCharRegex', '[AB]');
        await h.flush(); await h.state.handleGenerate(); await h.flush();
        assert.match(h.alerts.at(-1), /^2 row generation and insertion completed/);
        assert.deepEqual(Array.from(await read(main, `SELECT "CODE" FROM ${target} ORDER BY "CODE"`), row => row.CODE), ['A', 'B', 'Z']);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        assert.equal(main.getMainTransactionState(), true);
      } finally { h.unmount(); await main.rollback(); }
    });

    await step('Generate typed numeric and temporal literals without expressions and retain timestamp precision and time-only values', async () => {
      const name = token + '_GEN_VALUES', target = qualifiedObjectName({ schema, objectName: name });
      await sql(db === 'oracle'
        ? `CREATE TABLE ${target} ("N" NUMBER(38,20), "STAMP" TIMESTAMP(9), "ZONE" TIMESTAMP(9) WITH TIME ZONE, "LOCAL_STAMP" TIMESTAMP(9) WITH LOCAL TIME ZONE, "DAY" DATE, "LABEL" VARCHAR2(40))`
        : `CREATE TABLE ${target} ("N" numeric(38,20), "STAMP" timestamp(6), "ZONE" timestamp(6) with time zone, "DAY" date, "LABEL" text, "CLOCK" time(6), "ZCLOCK" time(6) with time zone, "LOCATION" point, "SPAN" interval, "IDS" integer[])`);
      created.push({ type: 'TABLE', name: target });
      const invoke = createDatabaseIpc(main, db);
      const h = await createGeneratorHarness(db, (channel, ...args) => channel === 'load-settings'
        ? { inputDateFormat: 'YYYY/MM/DD HH:mm:ss' } : invoke(channel, ...args), { schema });
      const stamp = db === 'oracle' ? '2026/10/24 12:34:56.123456789' : '2026/10/24 12:34:56.123456';
      const values = { N: '9007199254740993', STAMP: stamp, ZONE: stamp + '+05:45', LOCAL_STAMP: stamp + '+05:45',
        DAY: db === 'oracle' ? '2026/10/24 12:34:56' : '2026/10/24', LABEL: "owner's data",
        CLOCK: '12:34:56.123456', ZCLOCK: '12:34:56.123456+05:45' };
      try {
        await h.waitFor(state => !state.isLoading && !!state.selectedSchema);
        h.state.setSelectedTable(name);
        await h.waitFor(state => !state.isLoading && state.columnRules.length === (db === 'oracle' ? 6 : 10));
        const index = column => h.state.columnRules.findIndex(rule => rule.COLUMN_NAME === column);
        for (const rule of h.state.columnRules) {
          if (rule.ruleType === 'DISABLED') continue;
          h.state.handleRuleChange(index(rule.COLUMN_NAME), 'ruleType', 'FIXED');
          h.state.handleRuleChange(index(rule.COLUMN_NAME), 'fixedValue', values[rule.COLUMN_NAME]);
        }
        if (db === 'postgresql') {
          for (const column of ['LOCATION', 'SPAN', 'IDS']) assert.equal(h.state.columnRules[index(column)].ruleType, 'DISABLED');
        }
        h.state.setGenerateCount(1); await h.flush(); await h.state.handleGenerate(); await h.flush();
        assert.equal(h.alerts.length, 1); assert.match(h.alerts[0], /^1 row generation and insertion completed/);
        const rows = await read(main, db === 'oracle'
          ? `SELECT TO_CHAR("N", 'TM9') AS "N", TO_CHAR("STAMP", 'YYYY-MM-DD HH24:MI:SS.FF9') AS "STAMP", TO_CHAR("ZONE", 'YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM') AS "ZONE", TO_CHAR("DAY", 'YYYY-MM-DD HH24:MI:SS') AS "DAY", "LABEL" FROM ${target}`
          : `SELECT "N"::text AS "N", "STAMP"::text AS "STAMP", ("ZONE" AT TIME ZONE 'UTC')::text AS "ZONE", "DAY"::text AS "DAY", "LABEL", "CLOCK"::text AS "CLOCK", "ZCLOCK"::text AS "ZCLOCK", "LOCATION", "SPAN", "IDS" FROM ${target}`);
        assert.equal(rows.length, 1); const row = rows[0];
        assert.equal(compareNumericValues(row.N, values.N), 0);
        assert.equal(row.STAMP, db === 'oracle' ? '2026-10-24 12:34:56.123456789' : '2026-10-24 12:34:56.123456');
        assert.equal(row.DAY, db === 'oracle' ? '2026-10-24 12:34:56' : '2026-10-24');
        assert.equal(row.LABEL, values.LABEL);
        if (db === 'oracle') {
          assert.equal(row.ZONE, '2026-10-24 12:34:56.123456789 +05:45');
          assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target} WHERE "LOCAL_STAMP" = TO_TIMESTAMP_TZ('2026-10-24 12:34:56.123456789 +05:45', 'YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM')`))[0].CNT), 1);
        } else {
          assert.equal(row.ZONE, '2026-10-24 06:49:56.123456'); assert.equal(row.CLOCK, values.CLOCK);
          assert.equal(row.ZCLOCK, values.ZCLOCK); assert.equal(row.LOCATION, null); assert.equal(row.SPAN, null); assert.equal(row.IDS, null);
        }
        const writes = () => h.requests.filter(([channel]) => channel === 'execute-sql').length;
        const before = writes();
        h.state.setGenerateCount(1001);
        h.state.handleRuleChange(index('N'), 'fixedValue', '1+2'); await h.flush(); await h.state.handleGenerate();
        h.state.handleRuleChange(index('N'), 'ruleType', 'CHOICE');
        h.state.handleRuleChange(index('N'), 'choiceValues', '1,2,3+4'); await h.flush(); await h.state.handleGenerate();
        h.state.handleRuleChange(index('N'), 'ruleType', 'FIXED'); h.state.handleRuleChange(index('N'), 'fixedValue', values.N);
        h.state.handleRuleChange(index('STAMP'), 'fixedValue', "2026-10-24'); SELECT 1;--");
        await h.flush(); await h.state.handleGenerate(); await h.flush(); assert.equal(writes(), before);
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 1);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        assert.equal(main.getMainTransactionState(), true); await main.rollback();
        if (db === 'postgresql') {
          h.state.handleRuleChange(index('STAMP'), 'fixedValue', values.STAMP);
          for (const column of ['CLOCK', 'ZCLOCK']) {
            h.state.handleRuleChange(index(column), 'ruleType', 'RANDOM_DATE');
            h.state.handleRuleChange(index(column), 'randDateMin', '12:00:00');
            h.state.handleRuleChange(index(column), 'randDateMax', '12:00:01');
          }
          h.state.setGenerateCount(2); await h.flush(); await h.state.handleGenerate(); await h.flush();
          const randomRows = await read(main, `SELECT "CLOCK"::text AS "CLOCK", "ZCLOCK"::text AS "ZCLOCK" FROM ${target}`);
          assert.equal(randomRows.length, 2); assert.ok(randomRows.every(row => row.CLOCK === '12:00:01' && row.ZCLOCK === '12:00:01+00'));
        }
      } finally { h.unmount(); await main.rollback(); }
    });

    await step('Generate exact large and fractional numeric values and reject invalid settings before database writes', async () => {
      const name = token + '_GEN_NUM', target = qualifiedObjectName({ schema, objectName: name });
      await sql(`CREATE TABLE ${target} ("ID" ${db === 'oracle' ? 'NUMBER(38,20)' : 'numeric(38,20)'})`);
      created.push({ type: 'TABLE', name: target });
      const invoke = createDatabaseIpc(main, db);
      const h = await createGeneratorHarness(db, (channel, ...args) => channel === 'load-settings' ? {} : invoke(channel, ...args), { schema });
      const values = async () => Array.from(await read(main, `SELECT ${db === 'oracle' ? 'TO_CHAR("ID", \'TM9\')' : '"ID"::text'} AS "VALUE" FROM ${target} ORDER BY "ID"`), row => row.VALUE);
      try {
        await h.waitFor(state => !state.isLoading && !!state.selectedSchema);
        h.state.setSelectedTable(name);
        await h.waitFor(state => !state.isLoading && state.columnRules.length === 1);
        h.state.handleImportSettings(); h.inputs.at(-1).onchange();
        h.readers.at(-1).onload({ target: { result: JSON.stringify({ schema, table: name, generateCount: '2',
          rules: [{ COLUMN_NAME: 'ID', ruleType: 'SEQ_NUM', seqStart: '9007199254740993', seqStep: '1' }] }) } });
        await h.flush(); await h.state.handleGenerate(); await h.flush();
        assert.equal(h.alerts.length, 2); assert.match(h.alerts.at(-1), /^2 row generation and insertion completed/);
        let actual = await values();
        assert.equal(actual.length, 2); assert.equal(compareNumericValues(actual[0], '9007199254740993'), 0);
        assert.equal(compareNumericValues(actual[1], '9007199254740994'), 0);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        await main.rollback();
        h.state.handleRuleChange(0, 'seqStart', '0.1'); h.state.handleRuleChange(0, 'seqStep', '0.2');
        await h.flush(); await h.state.handleGenerate(); await h.flush();
        actual = await values(); assert.equal(actual.length, 2);
        assert.equal(compareNumericValues(actual[0], '0.1'), 0); assert.equal(compareNumericValues(actual[1], '0.3'), 0);
        await main.rollback();
        h.state.handleRuleChange(0, 'ruleType', 'RANDOM_NUM');
        h.state.handleRuleChange(0, 'randNumMin', '0.1'); h.state.handleRuleChange(0, 'randNumMax', '0.3');
        h.state.handleRuleChange(0, 'randNumRound', '0.1');
        await h.flush(); await h.state.handleGenerate(); await h.flush();
        actual = await values(); assert.equal(actual.length, 2);
        assert.ok(actual.every(value => compareNumericValues(value, '0.3') === 0)); await main.rollback();
        await sql(`INSERT INTO ${target} VALUES (42)`);
        const requests = h.requests.filter(([channel]) => channel === 'execute-sql').length;
        for (const invalid of [1.5, '', '1e309']) {
          h.state.setGenerateCount(invalid); await h.flush(); await h.state.handleGenerate();
        }
        h.state.setGenerateCount('2'); h.state.handleRuleChange(0, 'randNumRound', '0');
        await h.flush(); await h.state.handleGenerate();
        assert.equal(h.requests.filter(([channel]) => channel === 'execute-sql').length, requests);
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 1);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        assert.equal(main.getMainTransactionState(), true);
      } finally { h.unmount(); await main.rollback(); }
    });

    await step('Stop bulk imports on unconfirmed or suppressed batches and preserve pending changes', async () => {
      const { translate } = require('../../electron/i18n');
      const name = `${token}_BULK_COUNT`, target = `${q(schema)}.${q(name)}`;
      const defs = [{ COLUMN_NAME: 'LABEL', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text', NULLABLE: 'Y' }];
      await sql(`CREATE TABLE ${target} ("LABEL" ${db === 'oracle' ? 'VARCHAR2(40)' : 'text'})`);
      created.push({ type: 'TABLE', name: target });
      if (db === 'postgresql') {
        const fn = `${q(schema)}.${q(token + '_BULK_SKIP_FN')}`, trigger = token + '_BULK_SKIP';
        await sql(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW."LABEL" LIKE 'blocked%' THEN RETURN NULL; END IF; RETURN NEW; END;$$`);
        created.push({ type: 'FUNCTION', name: `${fn}()` });
        await sql(`CREATE TRIGGER ${q(trigger)} BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
        created.push({ type: 'TRIGGER', name: `${q(trigger)} ON ${target}` });
      }
      const builder = loadTypeScript(`src/features/${db}/windows/table/tableQueryBuilder.ts`).createTableQueryBuilder({ schema, structureDefs: defs, inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD' });
      for (const sidebar of [false, true]) {
        const requests = [], alerts = [], progress = [], targets = [];
        let refreshes = 0;
        const invoke = createDatabaseIpc(main, db);
        const module = loadTypeScript(sidebar ? `src/features/${db}/sidebarDataTransfer.ts` : `src/features/${db}/windows/table/tableDataTransfer.ts`, {
          '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, query, ...args) => {
            requests.push({ channel, query });
            const response = await invoke(channel, query, ...args);
            return db === 'oracle' && requests.length === 2 ? { ...response, rowsAffected: undefined } : response;
          } } }
        }, { alert: message => alerts.push(message), window: { dispatchEvent: () => { refreshes++; } }, CustomEvent: class {} });
        const context = { schema, tableName: name, structureDefs: defs, resultColumns: [], conditions: {}, paginationModel: { page: 0, pageSize: 50 },
          importTarget: { schema, tableName: name, structureDefs: defs }, t: (key, options) => translate(key, 'en', options),
          formatSqlValue: builder.formatSqlValue, buildQueryStrings: builder.buildQueryStrings,
          executeSearch: async () => { refreshes++; }, setIsLoading() {}, setLogs() {}, setBottomTab() {}, setImportTarget: target => targets.push(target) };
        const transfer = module[sidebar ? 'createSidebarDataTransfer' : 'createTableDataTransfer'](context);
        try {
          await sql(`INSERT INTO ${target} VALUES ('existing-pending')`);
          const records = [['LABEL'], ...Array.from({ length: 2001 }, (_, index) => [index < 1000 ? `kept${index}` : index < 2000 ? `blocked${index}` : 'not-sent'])];
          await assert.rejects(transfer[sidebar ? 'processSidebarBulkInsertData' : 'processBulkInsertData'](records, value => progress.push(value), true), error => {
            assert.match(error.message, /Confirmed inserted rows: 1000/);
            assert.match(error.message, /No automatic commit or rollback/); return true;
          });
          assert.equal(requests.length, 2); assert.ok(requests.every(request => request.channel === 'execute-sql' && /^INSERT/.test(request.query)));
          assert.equal(progress.includes(100), false); assert.deepEqual(alerts, []); assert.deepEqual(targets, []); assert.equal(refreshes, 0);
          assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), db === 'oracle' ? 2001 : 1001);
          assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
          assert.equal(main.getMainTransactionState(), true);
        } finally { await main.rollback(); }
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
      }
    });

    await step('Read ordered primary keys, index definitions and exact object owners through table hooks', async () => {
      const name = token + '_DEFINITION', target = qualifiedObjectName({ schema, objectName: name });
      const type = db === 'oracle' ? 'NUMBER' : 'integer';
      await sql(`CREATE TABLE ${target} ("before" ${type}, "after" ${type}, "meo" ${type}, PRIMARY KEY ("after", "before")${db === 'postgresql' ? ' INCLUDE ("meo")' : ''})`);
      created.push({ type: 'TABLE', name: target });
      const indexName = token + '_DEF_EXPR';
      await sql(`CREATE INDEX ${db === 'oracle' ? `${q(schema)}.` : ''}${q(indexName)} ON ${target} ${db === 'oracle' ? '("before" + 1, "after")' : '(("before" + 1), "after")'}`);
      if (db === 'oracle') {
        await sql(`CREATE TRIGGER ${q(schema)}.${q(token + '_DEF_TRG')} BEFORE INSERT ON ${target} FOR EACH ROW BEGIN NULL; END;`);
      }
      await sql(`INSERT INTO ${target} VALUES (1, 2, NULL)`);
      const invoke = createDatabaseIpc(main, db);
      const structure = await createStructureHarness(db, invoke, { schema, tableName: name });
      const data = await createTableHarness(db, invoke, { schema, tableName: name });
      try {
        await structure.waitFor(state => !state.isLoading && state.structureRows.length === 3);
        await data.waitFor(state => !state.isLoading && state.structureDefs.length === 3);
        assert.deepEqual(Array.from(structure.state.structureRows, r => String(r.PK_POSITION)), ['2', '1', '']);
        assert.deepEqual(Array.from(data.state.structureDefs, r => String(r.PK_POSITION)), ['2', '1', '']);
        assert.ok(structure.state.structureRows.every(r => r.IS_PK_COMPOSITE));
        assert.deepEqual(Array.from(structure.state.structureRows[2].UK_DATA), []);
        if (db === 'postgresql') {
          const idx = structure.state.indexRows.find(r => r.INDEX_NAME === indexName);
          assert.match(idx.COLUMNS, /before.*\+ 1.*\(1\).*after\(2\)/);
          assert.match(structure.state.indexRows.find(r => r.IS_PRIMARY).COLUMNS, /after\(1\).*before\(2\).*meo\(3\) INCLUDE/);
          // Same-named user types must not break either production function-list path.
          const prefix = "WITH pg_type AS (SELECT oid, typname FROM pg_catalog.pg_type UNION ALL SELECT 0::oid, 'trigger') ";
          const isolated = Object.create(Object.getPrototypeOf(main));
          isolated.bgPool = []; isolated.client = { query: (text, values) => observer.client.query(prefix + text, values) };
          assert.ok(Array.isArray(await isolated.getObjects(schema, 'FUNCTION')));
          const { invokeDbaRead } = loadTypeScript('src/features/dba/api/dbaBackgroundQueries.ts', {
            i18next: { t: key => key },
            '@/shared/api/desktop': { ipcRenderer: { invoke: (_channel, text, binds) => sql(prefix + text, binds, true).then(result => ({ success: true, ...result })) } }
          });
          assert.equal((await invokeDbaRead(true, 'get-objects', schema, 'FUNCTION')).success, true);
        } else {
          assert.ok(structure.state.indexRows.every(r => r.OWNER === schema));
          assert.equal(structure.state.triggerRows[0].OWNER, schema);
          const { getFullTableDDL } = loadTypeScript('src/features/oracle/windows/common/ddlHelper.ts', {
            './loadOracleDdl': loadTypeScript('src/features/oracle/windows/common/loadOracleDdl.ts')
          });
          const ddl = await getFullTableDDL({ invoke }, schema, name, translate);
          assert.ok(ddl.includes(indexName)); assert.ok(ddl.includes(token + '_DEF_TRG'));
        }
        assert.deepEqual(structure.alerts, []); assert.deepEqual(data.alerts, []);
        assert.equal(main.getMainTransactionState(), true);
        assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
      } finally { structure.unmount(); data.unmount(); await main.rollback(); }
    });

    if (db === 'oracle') await step('Load three-column tables without mixing same-named constraints from other owners', async () => {
      for (const withPrimaryKey of [false, true]) {
        const name = `${token}_COLS_${withPrimaryKey ? 'PK' : 'PLAIN'}`;
        const target = qualifiedObjectName({ schema, objectName: name }), checkName = name + '_CK';
        await sql(`CREATE TABLE ${target} ("before" NUMBER, "after" NUMBER, "meo" NUMBER, CONSTRAINT ${q(checkName)} CHECK ("meo" >= 0)${withPrimaryKey ? ', PRIMARY KEY ("after", "before")' : ''})`);
        created.push({ type: 'TABLE', name: target });
        await sql(`INSERT INTO ${target} VALUES (1, 2, 3)`);
        const invoke = createDatabaseIpc(main, db);
        let metadataQuery;
        // Add read-only dictionary fixtures for other owners; never create or modify other schemas.
        const catalog = `WITH ALL_CONSTRAINTS AS (
          SELECT OWNER, TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM SYS.ALL_CONSTRAINTS
          UNION ALL SELECT 'MBT_OTHER_OWNER_A', '${name}', '${checkName}', 'P' FROM DUAL
          UNION ALL SELECT 'MBT_OTHER_OWNER_B', '${name}', '${checkName}', 'P' FROM DUAL
        ) `;
        const h = await createTableHarness(db, async (channel, query, ...args) => {
          if (channel === 'execute-sql-bg' && /FROM ALL_TAB_COLUMNS c/.test(query)) {
            metadataQuery = query;
            return invoke(channel, catalog + query, ...args);
          }
          return invoke(channel, query, ...args);
        }, { schema, tableName: name });
        try {
          await h.waitFor(state => !state.isLoading && state.structureDefs.length === 3);
          assert.deepEqual(Array.from(h.state.structureDefs, column => [column.COLUMN_NAME, String(column.PK_POSITION)]),
            [['before', withPrimaryKey ? '2' : ''], ['after', withPrimaryKey ? '1' : ''], ['meo', '']]);
          assert.equal(h.state.displayRows.length, 1);
          assert.equal(Number(h.state.displayRows[0].meo), 3);
          assert.deepEqual(h.alerts, []);
          // The previous join reproduces the reported Oracle error against the same dictionary fixture.
          const previousQuery = metadataQuery.replace('cc.OWNER = pc.OWNER AND cc.TABLE_NAME = pc.TABLE_NAME AND ', '');
          assert.notEqual(previousQuery, metadataQuery);
          await assert.rejects(sql(catalog + previousQuery, {}, true), error => error.errorNum === 1427);
          assert.equal(main.getMainTransactionState(), true);
          assert.equal(Number((await read(observer, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 0);
        } finally { h.unmount(); await main.rollback(); }
      }
    });

    await step('Guard record insertion across rerenders and retain drafts when a trigger suppresses insertion', async () => {
      const name = `${token}_INS_GUARD`, target = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${target} ("LABEL" ${db === 'oracle' ? 'VARCHAR2(40)' : 'text'})`);
      created.push({ type: 'TABLE', name: target });
      let release, writes = 0, firstWrite = true, save;
      const gate = new Promise(resolve => { release = resolve; });
      const invoke = createDatabaseIpc(main, db);
      const h = await createTableHarness(db, async (channel, query, ...args) => {
        if (/^INSERT/.test(query)) {
          writes++;
          if (firstWrite) { firstWrite = false; await gate; }
        }
        return invoke(channel, query, ...args);
      }, { schema, tableName: name });
      try {
        await h.waitFor(state => !state.isLoading && state.structureDefs.length > 0);
        h.state.handleOpenInsert(); await h.flush();
        h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { LABEL: 'once' } }); await h.flush();
        save = h.state.submitRecord(); await h.flush();
        await h.state.submitRecord(); h.state.handleCloseDialog();
        h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { LABEL: 'changed' } }); await h.flush();
        assert.equal(writes, 1); assert.equal(h.state.isSavingRecord, true);
        assert.equal(h.state.recordDialog.isOpen, true); assert.equal(h.state.recordDialog.recordData.LABEL, 'once');
        release(); await save; await h.flush();
        assert.equal(h.state.recordDialog.isOpen, false, h.alerts.at(-1)); assert.equal(h.state.isSavingRecord, false);
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 1);
        await h.state.handleOpenDuplicate(h.state.displayRows[0]); await h.flush();
        await h.state.submitRecord(); await h.flush();
        assert.equal(h.state.recordDialog.isOpen, false);
        assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 2);
        await main.commit();
        if (db === 'postgresql') {
          const fn = `${q(schema)}.${q(token + '_INS_SKIP_FN')}`, trigger = token + '_INS_SKIP';
          await sql(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END;$$`);
          created.push({ type: 'FUNCTION', name: `${fn}()` });
          await sql(`CREATE TRIGGER ${q(trigger)} BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
          created.push({ type: 'TRIGGER', name: `${q(trigger)} ON ${target}` });
          h.state.handleOpenInsert(); await h.flush();
          h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { LABEL: 'retained' } }); await h.flush();
          await h.state.submitRecord(); await h.flush();
          assert.equal(h.state.recordDialog.isOpen, true); assert.equal(h.state.recordDialog.recordData.LABEL, 'retained');
          assert.ok(h.alerts.some(message => message.includes('No record was inserted')));
          assert.equal(Number((await read(main, `SELECT COUNT(*) AS "CNT" FROM ${target}`))[0].CNT), 2);
        }
      } finally {
        release(); if (save) await save;
        h.unmount(); await main.rollback();
      }
    });

    await step('Retain failed update input and preserve concurrent binary changes without no-op trigger executions', async () => {
      const name = `${token}_UPD`, target = `${q(schema)}.${q(name)}`, audit = `${q(schema)}.${q(token + '_UPD_AUDIT')}`;
      await sql(`CREATE TABLE ${target} ("ID" ${db === 'oracle' ? 'NUMBER' : 'integer'} PRIMARY KEY, "NOTE" ${db === 'oracle' ? 'VARCHAR2(40)' : 'varchar(40)'}, "BIN" ${db === 'oracle' ? 'BLOB' : 'bytea'})`); created.push({ type: 'TABLE', name: target });
      await sql(`CREATE TABLE ${audit} (ID ${db === 'oracle' ? 'NUMBER' : 'integer'})`); created.push({ type: 'TABLE', name: audit });
      for (const id of [1,2,3]) await sql(`INSERT INTO ${target} VALUES (:id, :note, :binary)`, { id, note: `old${id}`, binary: Buffer.from([0, id]) }); await main.commit();
      const trigger = `${token}_UPD_TRG`, fn = `${q(schema)}.${q(token + '_UPD_FN')}`;
      if (db === 'postgresql') {
        await sql(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO ${audit} VALUES (NEW."ID"); RETURN NEW; END;$$`); created.push({ type: 'FUNCTION', name: `${fn}()` });
        await sql(`CREATE TRIGGER ${q(trigger)} AFTER UPDATE ON ${target} FOR EACH ROW EXECUTE FUNCTION ${fn}()`); created.push({ type: 'TRIGGER', name: `${q(trigger)} ON ${target}` });
      } else {
        await sql(`CREATE TRIGGER ${q(schema)}.${q(trigger)} AFTER UPDATE ON ${target} FOR EACH ROW BEGIN INSERT INTO ${audit} VALUES (:NEW."ID"); END;`); created.push({ type: 'TRIGGER', name: `${q(schema)}.${q(trigger)}` });
      }
      const ids = loadTypeScript('src/features/data-grid/rowIdentity.ts'), dialogs = [], alerts = [], writes = [];
      let searches = 0, gridUpdates = 0, logs = [];
      const defs = [{ COLUMN_NAME: 'ID', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'integer', PK_POSITION: 1 }, { COLUMN_NAME: 'NOTE', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'varchar' }, { COLUMN_NAME: 'BIN', DATA_TYPE: db === 'oracle' ? 'BLOB' : 'bytea' }];
      const builder = loadTypeScript(`src/features/${db}/windows/table/tableQueryBuilder.ts`).createTableQueryBuilder({ schema, structureDefs: defs, inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD' });
      const invoke = createDatabaseIpc(main, db);
      const { createTableRecordEditor } = loadTypeScript(`src/features/${db}/windows/table/tableRecordEditor.ts`, { '@/shared/api/desktop': { ipcRenderer: { invoke: (channel, query, binds) => {
        if (/^UPDATE/.test(query)) writes.push(query); return invoke(channel, query, binds);
      } } } }, { alert: message => alerts.push(message), window: { confirm: () => true } });
      const originalRows = await read(main, `SELECT ${db === 'oracle' ? 'ROWID AS "physical",' : ''} t.* FROM ${target} t ORDER BY "ID"`);
      const row = index => ids.withRowIdentity(originalRows[index], index, originalRows[index].physical || '');
      const context = { schema, tableName: name, structureDefs: defs, inputDateFormat: 'YYYY-MM-DD', hasLobColumns: true, isTransposed: false,
        recordSaving: { current: false }, recordDialog: { isOpen: false, mode: 'update', recordData: {}, initialRecordData: {}, targetRowId: '' }, conditions: {}, paginationModel: { page: 0, pageSize: 50 }, t: key => key,
        formatSqlValue: builder.formatSqlValue, getPkWhereClause: source => `"ID" = ${source.ID}`, executeSearch: async () => { searches++; },
        setRecordDialog: dialog => dialogs.push(dialog), setDataContextMenu() {}, setIsLoading() {}, setLogs: update => { logs = update(logs); }, setBottomTab() {}, setResultRows() { gridUpdates++; } };
      await createTableRecordEditor(context).handleOpenUpdate(row(0)); context.recordDialog = dialogs.pop();
      await createTableRecordEditor(context).submitRecord(); assert.equal(writes.length, 0); assert.ok(alerts.includes('no_data_modified'));
      assert.equal(Number(value((await read(main, `SELECT COUNT(*) AS value FROM ${audit}`))[0])), 0, 'No-op saves must not fire database triggers');
      await observer.execute(`UPDATE ${target} SET "BIN" = :binary WHERE "ID" = 1`, { binary: Buffer.from([0xaa, 0xbb]) }); await observer.commit();
      context.recordDialog = { ...context.recordDialog, recordData: { ...context.recordDialog.recordData, NOTE: 'new1' } };
      await createTableRecordEditor(context).submitRecord(); assert.equal(writes.length, 1); assert.ok(!writes[0].includes('"BIN"'));
      const updated = (await read(main, `SELECT "NOTE", "BIN" FROM ${target} WHERE "ID" = 1`))[0];
      assert.equal(updated.NOTE, 'new1'); assert.equal(Buffer.isBuffer(updated.BIN) ? updated.BIN.toString('hex') : String(updated.BIN).toLowerCase(), 'aabb');
      assert.equal((await read(observer, `SELECT "NOTE" FROM ${target} WHERE "ID" = 1`))[0].NOTE, 'old1');
      assert.equal(Number(value((await read(main, `SELECT COUNT(*) AS value FROM ${audit}`))[0])), 2, 'Only the two actual updates should fire the audit trigger');
      await main.rollback();
      // Keep a different pending edit while the stale target disappears on another connection.
      await sql(`UPDATE ${target} SET "NOTE" = 'pending3' WHERE "ID" = 3`);
      await observer.execute(`DELETE FROM ${target} WHERE "ID" = 2`); await observer.commit();
      const old = row(1); context.recordDialog = { isOpen: true, mode: 'update', recordData: { ID: 2, NOTE: 'new2', BIN: { isBlob: true, hex: '0002' } }, initialRecordData: { ID: 2, NOTE: 'old2', BIN: { isBlob: true, hex: '0002' } }, targetRowId: originalRows[1].physical || '' };
      dialogs.length = 0; alerts.length = 0; logs = []; const priorSearches = searches;
      await createTableRecordEditor(context).submitRecord();
      assert.equal(dialogs.length, 0); assert.equal(context.recordDialog.recordData.NOTE, 'new2'); assert.equal(searches, priorSearches);
      assert.ok(alerts[0].includes('record_update_no_rows')); assert.equal(logs[0].resultMsg, 'update_error_2');
      const returned = await createTableRecordEditor(context).handleProcessRowUpdate({ ...old, NOTE: 'new2' }, old);
      assert.equal(returned, old); assert.equal(gridUpdates, 0); assert.ok(alerts.at(-1).includes('record_update_no_rows'));
      assert.equal((await read(main, `SELECT "NOTE" FROM ${target} WHERE "ID" = 3`))[0].NOTE, 'pending3');
      assert.equal((await read(observer, `SELECT "NOTE" FROM ${target} WHERE "ID" = 3`))[0].NOTE, 'old3');
      assert.equal(main.getMainTransactionState(), true); await main.rollback();
    });

    await step('Refuse stale or failed LOB record loads and duplicate complete values through the real editor', async () => {
      const name = `${token}_LOB_EDIT`, target = `${q(schema)}.${q(name)}`, text = 'Long text '.repeat(800);
      await sql(`CREATE TABLE ${target} ("ID" ${db === 'oracle' ? 'NUMBER' : 'integer'} PRIMARY KEY, "NOTE" ${db === 'oracle' ? 'CLOB' : 'text'}, "PAYLOAD" ${db === 'oracle' ? 'BLOB' : 'bytea'})`); created.push({ type: 'TABLE', name: target });
      await sql(`INSERT INTO ${target} VALUES (:id, :note, :payload)`, { id: 1, note: text, payload: Buffer.from([0, 1, 254, 255]) }); await main.commit();
      const ids = loadTypeScript('src/features/data-grid/rowIdentity.ts');
      const physical = db === 'oracle' ? (await read(main, `SELECT ROWID AS rid FROM ${target}`))[0].RID : '';
      const preview = ids.withRowIdentity({ ID: 1, NOTE: '[CLOB preview]', PAYLOAD: db === 'oracle' ? '[BLOB preview]' : '[BYTEA preview]' }, 1, physical);
      const defs = [{ COLUMN_NAME: 'ID', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'integer', PK_POSITION: 1 }, { COLUMN_NAME: 'NOTE', DATA_TYPE: db === 'oracle' ? 'CLOB' : 'text' }, { COLUMN_NAME: 'PAYLOAD', DATA_TYPE: db === 'oracle' ? 'BLOB' : 'bytea' }];
      const builder = loadTypeScript(`src/features/${db}/windows/table/tableQueryBuilder.ts`).createTableQueryBuilder({ schema, structureDefs: defs, inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD' });
      const invoke = createDatabaseIpc(main, db), dialogs = [], alerts = []; let fail = true;
      const { createTableRecordEditor } = loadTypeScript(`src/features/${db}/windows/table/tableRecordEditor.ts`, { '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, query, binds) => fail ? { success: false, error: 'Simulated read failure' } : invoke(channel, query, binds) } } }, { alert: message => alerts.push(message), window: { confirm: () => true } });
      const context = { schema, tableName: name, structureDefs: defs, inputDateFormat: 'YYYY-MM-DD', hasLobColumns: true, isTransposed: false,
        recordSaving: { current: false }, recordDialog: { isOpen: false, mode: 'duplicate', recordData: {}, initialRecordData: {}, targetRowId: '' }, conditions: {}, paginationModel: { page: 0, pageSize: 50 },
        t: key => key, formatSqlValue: builder.formatSqlValue, getPkWhereClause: row => `"ID" = ${row.ID}`, executeSearch: async () => {},
        setRecordDialog: dialog => dialogs.push(dialog), setDataContextMenu() {}, setIsLoading() {}, setLogs() {}, setBottomTab() {}, setResultRows() {} };
      for (const operation of ['handleOpenUpdate', 'handleOpenDuplicate']) await createTableRecordEditor(context)[operation](preview);
      assert.equal(dialogs.length, 0); assert.equal(alerts.length, 2); fail = false;
      await createTableRecordEditor(context).handleOpenDuplicate(preview); assert.equal(dialogs.length, 1);
      assert.equal(dialogs[0].recordData.NOTE, text); assert.equal(String(dialogs[0].recordData.PAYLOAD.hex).toLowerCase(), '0001feff');
      context.recordDialog = { ...dialogs[0], recordData: { ...dialogs[0].recordData, ID: 2 } };
      const before = alerts.length; await createTableRecordEditor(context).submitRecord(); assert.equal(alerts.length, before + 1);
      const copy = (await read(main, `SELECT "NOTE", "PAYLOAD" FROM ${target} WHERE "ID" = 2`))[0];
      assert.equal(copy.NOTE, text); assert.equal((Buffer.isBuffer(copy.PAYLOAD) ? copy.PAYLOAD.toString('hex') : String(copy.PAYLOAD)).toLowerCase(), '0001feff');
      for (const [id, binary] of [[3, { isBlob: true, hex: '' }], [4, null]]) {
        context.recordDialog = { ...dialogs[0], recordData: { ...dialogs[0].recordData, ID: id, PAYLOAD: binary } };
        await createTableRecordEditor(context).submitRecord();
        const length = db === 'oracle' ? 'DBMS_LOB.GETLENGTH("PAYLOAD")' : 'octet_length("PAYLOAD")';
        assert.equal(Number(value((await read(main, `SELECT CASE WHEN "PAYLOAD" IS NULL THEN -1 ELSE ${length} END AS value FROM ${target} WHERE "ID" = ${id}`))[0])), id === 3 ? 0 : -1);
      }
      const successfulAlerts = alerts.length;
      await main.rollback(); assert.equal((await read(observer, `SELECT * FROM ${target}`)).length, 1);
      await sql(`DELETE FROM ${target} WHERE "ID" = 1`); await main.commit(); dialogs.length = 0;
      for (const operation of ['handleOpenUpdate', 'handleOpenDuplicate']) await createTableRecordEditor(context)[operation](preview);
      assert.equal(dialogs.length, 0); assert.equal(alerts.length, successfulAlerts + 2); assert.equal((await read(main, `SELECT * FROM ${target}`)).length, 0);
    });

    if (db === 'postgresql') await step('Retain exact enum identity and values through metadata, record editing and both CSV import paths', async () => {
      const types = ['PrintStatus', 'DateState', 'BooleanState'].map(suffix => `${token}_${suffix}`), name = `${token}_ENUM_EDIT`, target = `${q(schema)}.${q(name)}`;
      for (const type of types) { await sql(`CREATE TYPE ${q(schema)}.${q(type)} AS ENUM ('open', 'closed', ' padded ')`); created.push({ type: 'TYPE', name: `${q(schema)}.${q(type)}` }); }
      await sql(`CREATE TABLE ${target} ("ID" integer PRIMARY KEY, "PRINT" ${q(schema)}.${q(types[0])}, "DAY" ${q(schema)}.${q(types[1])}, "BOOL" ${q(schema)}.${q(types[2])})`); created.push({ type: 'TABLE', name: target });
      const invoke = createDatabaseIpc(main, db), api = { ipcRenderer: { invoke } };
      const { postgresColumnMetadataSql, postgresColumnKind } = loadTypeScript('src/features/postgresql/columnTypes.ts');
      const defs = (await invoke('execute-sql-bg', postgresColumnMetadataSql, { schema, tableName: name })).rows;
      assert.deepEqual(Array.from(defs.slice(1), definition => postgresColumnKind(definition)), ['other', 'other', 'other']);
      assert.equal(defs[1].PG_TYPE_NAME, types[0]);
      const builder = loadTypeScript('src/features/postgresql/windows/table/tableQueryBuilder.ts').createTableQueryBuilder({ schema, structureDefs: defs, inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD' });
      const alerts = [], dialogs = [];
      const { createTableRecordEditor } = loadTypeScript('src/features/postgresql/windows/table/tableRecordEditor.ts', { '@/shared/api/desktop': api }, { alert: message => alerts.push(message), window: { confirm: () => true } });
      const context = { schema, tableName: name, structureDefs: defs, inputDateFormat: 'YYYY-MM-DD', hasLobColumns: false, isTransposed: false,
        recordSaving: { current: false }, recordDialog: { isOpen: true, mode: 'insert', recordData: { ID: '1', PRINT: 'open', DAY: 'open', BOOL: 'open' }, initialRecordData: {} }, conditions: {}, paginationModel: { page: 0, pageSize: 50 }, t: key => key,
        formatSqlValue: builder.formatSqlValue, getPkWhereClause: row => `"ID" = ${row.ID}`, executeSearch: async () => {}, setRecordDialog: dialog => dialogs.push(dialog), setDataContextMenu() {}, setIsLoading() {}, setLogs() {}, setBottomTab() {}, setResultRows() {} };
      await createTableRecordEditor(context).submitRecord(); assert.ok(dialogs.at(-1).isOpen === false, alerts.at(-1));
      const row = (await read(main, `SELECT * FROM ${target}`))[0]; await createTableRecordEditor(context).handleOpenUpdate(row);
      assert.equal(dialogs.at(-1).recordData.BOOL, 'open');
      context.recordDialog = { ...dialogs.at(-1), recordData: { ...dialogs.at(-1).recordData, PRINT: ' padded ', DAY: 'closed' } };
      await createTableRecordEditor(context).submitRecord(); assert.ok(dialogs.at(-1).isOpen === false, alerts.at(-1));
      const { createTableDataTransfer } = loadTypeScript('src/features/postgresql/windows/table/tableDataTransfer.ts', { '@/shared/api/desktop': api }, { alert() {} });
      await createTableDataTransfer({ ...context, resultColumns: [], buildQueryStrings: builder.buildQueryStrings }).processBulkInsertData([['ID','PRINT','DAY','BOOL'],['2','open',' padded ','closed']], () => {}, true);
      const { createSidebarDataTransfer } = loadTypeScript('src/features/postgresql/sidebarDataTransfer.ts', { '@/shared/api/desktop': api }, { alert() {}, window: { dispatchEvent() {} }, CustomEvent: class {} });
      await createSidebarDataTransfer({ importTarget: { schema, tableName: name, structureDefs: defs }, outputDateFormat: 'YYYY-MM-DD', t: key => key, setIsLoading() {} }).processSidebarBulkInsertData([['ID','PRINT','DAY','BOOL'],['3','closed','open',' padded ']], () => {}, true);
      const rows = await read(main, `SELECT * FROM ${target} ORDER BY "ID"`);
      assert.deepEqual(Array.from(rows, record => [record.ID, record.PRINT, record.DAY, record.BOOL]), [[1,' padded ','closed','open'],[2,'open',' padded ','closed'],[3,'closed','open',' padded ']]);
      assert.equal((await read(observer, `SELECT * FROM ${target}`)).length, 0); await main.rollback();
    });

    await step('Retain native index DDL and inspect real constraint dependencies before deletion', async () => {
      const table = token + '_IDX_TAB', indexName = token + '_EXPR', pk = token + '_Key', child = token + '_IDX_CHILD';
      const target = qualifiedObjectName({ schema, objectName: table }), indexTarget = qualifiedObjectName({ schema, objectName: indexName });
      await sql(`CREATE TABLE ${target} ("ID" INTEGER, "Text" ${db === 'oracle' ? 'VARCHAR2(40)' : 'text'}, "Payload" INTEGER, CONSTRAINT ${q(pk)} PRIMARY KEY ("ID"))`);
      created.push({ type: 'TABLE', name: target });
      await sql(`CREATE INDEX ${db === 'oracle' ? indexTarget : q(indexName)} ON ${target} (LOWER("Text") DESC)${db === 'postgresql' ? ' INCLUDE ("Payload") WHERE "Payload" > 0' : ''}`);
      created.push({ type: 'INDEX', name: indexTarget });
      const invoke = createDatabaseIpc(main, db), calls = [];
      const record = async (channel, ...args) => { calls.push([channel, ...args]); return channel.startsWith('git-') ? { success: true } : invoke(channel, ...args); };
      const h = await createDdlEditor('index', db, record, { schema, indexName, initialTable: table, isNew: false, allSchemas: [schema] });
      try {
        assert.equal(h.render().canExecute, true, h.alerts.at(-1));
        assert.match(h.render().sourceSql, /CREATE INDEX/i);
        if (db === 'postgresql') { assert.match(h.render().sourceSql, /INCLUDE/); assert.match(h.render().sourceSql, /WHERE/); assert.match(h.render().sourceSql, /DESC/); }
        else {
          assert.match(h.render().sourceSql, /DESC/);
          h.render().updateFormField('isVisible', false); await h.flush();
          await h.render().handleExecute(); await h.flush();
          assert.equal(h.render().details.visible, false); assert.match(h.render().sourceSql, /INVISIBLE/);
        }
        h.setConfirm(() => true); await h.render().handleDelete();
        assert.equal(calls.filter(([channel, query]) => channel === 'execute-sql' && /^DROP INDEX/.test(query)).length, 1);
        created.splice(created.findIndex(object => object.name === indexTarget), 1);
      } finally { h.unmount(); }
      const primary = await createDdlEditor('index', db, record, { schema, indexName: pk, initialTable: table, isNew: false, allSchemas: [schema] });
      try {
        assert.equal(primary.render().canExecute, true); assert.equal(primary.render().details.constraints[0].name, pk);
        const childTarget = qualifiedObjectName({ schema, objectName: child });
        await sql(`CREATE TABLE ${childTarget} ("ID" INTEGER REFERENCES ${target}("ID"))`); created.push({ type: 'TABLE', name: childTarget });
        calls.length = 0; primary.setConfirm(() => true); await primary.render().handleDelete();
        assert.equal(calls.filter(([channel]) => channel === 'execute-sql').length, 0);
        await sql(`DROP TABLE ${childTarget}`); created.splice(created.findIndex(object => object.name === childTarget), 1);
        calls.length = 0; await primary.render().handleDelete();
        const writes = calls.filter(([channel]) => channel === 'execute-sql');
        assert.equal(writes.length, db === 'oracle' ? 0 : 1);
        if (db === 'postgresql') assert.equal(writes[0][1], `ALTER TABLE ${target} DROP CONSTRAINT ${q(pk)}`);
      } finally { primary.unmount(); }
    });

    await step('Create CHECK constraints and ordinary/expression indexes with exact names and literal semicolons', async () => {
      const name = `${token}_DDL;Mix`, column = 'MiX;Column', target = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${target} (${q(column)} ${db === 'oracle' ? 'VARCHAR2(40)' : 'text'})`);
      created.push({ type: 'TABLE', name: target });
      const invoke = createDatabaseIpc(main, db), calls = [];
      const record = async (...args) => { const result = await invoke(...args); calls.push({ args, result }); return result; };
      const h = await createDdlEditor('constraint', db, record, { schema, tableName: name });
      try {
        h.find(h.render(), node => node.type === 'TextField' && node.props.label === 'constraint_name_required').props.onChange({ target: { value: `${token}_CK` } });
        h.find(h.render(), node => node.type === 'CodeMirror' && node.props.onChange).props.onChange(`${q(column)} <> 'a;b'`);
        calls.length = 0;
        await h.find(h.render(), node => node.type === 'Button' && node.children.includes('create')).props.onClick();
        const writes = calls.filter(call => call.args[0] === 'execute-sql');
        assert.equal(writes.length, 1); assert.equal(writes[0].result.success, true);
        await assert.rejects(sql(`INSERT INTO ${target} VALUES ('a;b')`));
        await main.rollback();
        await sql(`INSERT INTO ${target} VALUES ('okay')`); await main.commit();
      } finally { h.unmount(); }
      const idxName = `${token}_Ix;Mix`;
      const index = await createDdlEditor('index', db, record, { schema, initialTable: name, indexName: idxName, allSchemas: [schema] });
      try {
        index.render().handleLeftDoubleClick(column); await index.flush();
        calls.length = 0; await index.render().handleExecute();
        let writes = calls.filter(call => call.args[0] === 'execute-sql');
        assert.equal(writes.length, 1); assert.equal(writes[0].result.success, true);
        created.push({ type: 'INDEX', name: `${q(schema)}.${q(idxName)}` });
        index.render().updateFormField('indexType', 'FUNCTION'); await index.flush();
        index.render().updateFormField('indexName', `${token}_Fn`);
        index.render().updateFormField('functionExpression', `replace(${q(column)}, 'a;b', '')`); await index.flush();
        calls.length = 0; await index.render().handleExecute();
        writes = calls.filter(call => call.args[0] === 'execute-sql');
        assert.equal(writes.length, 1); assert.equal(writes[0].result.success, true);
        created.push({ type: 'INDEX', name: `${q(schema)}.${q(token + '_Fn')}` });
      } finally { index.unmount(); }
    });

    if (db === 'postgresql') await step('Replace a trigger atomically and retain the previous function and trigger after failed creation', async () => {
      const tableName = `${token}_TrgTable`, name = `${token}_Trg;Mix`, target = `${q(schema)}.${q(tableName)}`;
      await sql(`CREATE TABLE ${target} (amount integer)`); created.push({ type: 'TABLE', name: target });
      const invoke = createDatabaseIpc(main, db);
      const h = await createDdlEditor('trigger', db, invoke, { schema, initialTable: tableName, triggerName: name });
      try {
        h.render().setWizEvents(['INSERT']);
        h.render().setWizBody('BEGIN NEW.amount := NEW.amount + 1; RETURN NEW; END;'); await h.flush();
        await h.render().handleCreateTrigger(); await h.flush();
        assert.ok(h.events.some(event => event.type === 'trigger-created'));
        const metadata = (await invoke('get-postgres-trigger', { schema, tableName, triggerName: name })).trigger;
        created.push({ type: 'FUNCTION', name: `${q(metadata.function_schema)}.${q(metadata.function_name)}()` });
        created.push({ type: 'TRIGGER', name: `${q(name)} ON ${target}` });
      } finally { h.unmount(); }
      const query = `SELECT t.oid, t.tgfoid, pg_get_functiondef(t.tgfoid) AS source FROM pg_trigger t WHERE t.tgrelid = '${target.replaceAll("'", "''")}'::regclass AND t.tgname = '${name}'`;
      const before = (await read(main, query))[0]; assert.ok(before);
      const edit = await createDdlEditor('trigger', db, invoke, { schema, triggerName: name, initialTable: tableName, isNew: false });
      try {
        edit.render().setWizBody('BEGIN NEW.amount := NEW.amount + 100; RETURN NEW; END;');
        await edit.flush();
        const current = (await invoke('get-postgres-trigger', { schema, tableName, triggerName: name })).trigger;
        const failed = await invoke('save-postgres-trigger', { schema, tableName, triggerName: name, isNew: false, body: 'BEGIN NEW.amount := NEW.amount + 999; RETURN NEW; END;', timing: 'BEFORE', events: ['TRUNCATE'], forEachRow: true, expected: { triggerOid: current.trigger_oid, triggerDefinition: current.trigger_ddl, functionDefinition: current.function_ddl, enabled: current.enabled } });
        assert.equal(failed.success, false);
        assert.deepEqual((await read(main, query))[0], before);
        edit.render().setWizBody('BEGIN invalid SQL syntax; END;'); await edit.flush();
        await edit.render().handleCreateTrigger(); await edit.flush();
        assert.ok(edit.alerts.includes('an_error_occurred_please_check_the_console'));
        const after = (await read(main, query))[0]; assert.deepEqual(after, before);
        await sql(`INSERT INTO ${target} VALUES (10)`); assert.equal((await read(main, `SELECT amount FROM ${target}`))[0].amount, 11);
        await main.rollback();
        edit.render().setWizBody('BEGIN NEW.amount := NEW.amount + 100; RETURN NEW; END;'); await edit.flush();
        await edit.render().handleCreateTrigger(); await edit.flush();
        await sql(`INSERT INTO ${target} VALUES (10)`); assert.equal((await read(main, `SELECT amount FROM ${target}`))[0].amount, 110);
        await main.rollback();
        assert.equal(main.getMainTransactionState(), false);
      } finally { edit.unmount(); }
    });

    await step('Preserve exact integer and decimal trigger trace input through real column metadata and database numeric parsing', async () => {
      const name = `${token}_TraceNum`, target = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${target} ("EXACT_INT" ${db === 'oracle' ? 'NUMBER(38)' : 'numeric'}, "EXACT_DECIMAL" ${db === 'oracle' ? 'NUMBER' : 'numeric'})`);
      created.push({ type: 'TABLE', name: target });
      const invoke = createDatabaseIpc(main, db); let trace;
      const h = await createDdlEditor('trigger', db, async (channel, ...args) => {
        if (channel === 'execute-trace') { trace = args[0]; return { success: false, errorCode: 'TRACE_MAIN_CONNECTION_BUSY', error: 'Stopped before trace execution' }; }
        return invoke(channel, ...args);
      }, { schema, initialTable: name });
      try {
        // Match the enabled UI interaction after metadata effects and event callbacks are committed.
        await h.flush(); assert.equal(h.render().canTrace, true); assert.equal(h.render().isLoading, false);
        await h.render().handleTraceExecuteClick(); await h.flush();
        assert.equal(h.render().isTraceDialogOpen, true); assert.equal(h.render().structureDefs.length, 2);
        h.render().setTraceInputData({ EXACT_INT: '9007199254740993', EXACT_DECIMAL: '0.1234567890123456789' }); await h.flush();
        await h.render().handleStartTrace(); assert.ok(trace);
        const integer = /EXACT_INT"? := ([^;]+);/.exec(trace.sourceText)?.[1];
        const decimal = /EXACT_DECIMAL"? := ([^;]+);/.exec(trace.sourceText)?.[1];
        assert.equal(integer, '9007199254740993', trace.sourceText); assert.equal(decimal, '0.1234567890123456789', trace.sourceText);
        assert.equal(String(value((await read(main, `SELECT ${integer} AS value${db === 'oracle' ? ' FROM DUAL' : ''}`))[0])), integer);
        assert.equal(compareNumericValues(value((await read(main, `SELECT ${decimal} AS value${db === 'oracle' ? ' FROM DUAL' : ''}`))[0]), decimal), 0);
      } finally { h.unmount(); }
    });

    if (db === 'postgresql') await step('Isolate same-named trigger functions on separate tables and refuse updates to shared functions', async () => {
      const triggerName = `${token}_Audit`, tables = [`${token}_First`, `${token}_Second`], functions = [];
      const repository = await createGitRepository(t);
      const invoke = createDatabaseIpc(main, db);
      for (let i = 0; i < tables.length; i++) {
        const tableName = tables[i], target = `${q(schema)}.${q(tableName)}`;
        await sql(`CREATE TABLE ${target} (amount integer)`); created.push({ type: 'TABLE', name: target });
        const h = await createDdlEditor('trigger', db, invoke, { schema, initialTable: tableName, triggerName });
        try {
          h.render().setWizEvents(['INSERT']); h.render().setWizBody(`BEGIN NEW.amount := NEW.amount + ${i ? 10 : 1}; RETURN NEW; END;`); await h.flush();
          await h.render().handleCreateTrigger();
          const metadata = (await invoke('get-postgres-trigger', { schema, tableName, triggerName })).trigger;
          assert.ok(metadata); functions.push(metadata);
          assert.equal((await repository.invoke('git-commit', { dbType: 'POSTGRESQL', schema, tableName, objectType: 'TRIGGER', objectName: triggerName, sourceText: metadata.function_ddl + metadata.trigger_ddl, message: 'Store selected trigger' })).success, true);
          created.push({ type: 'FUNCTION', name: `${q(metadata.function_schema)}.${q(metadata.function_name)}()` });
          created.push({ type: 'TRIGGER', name: `${q(triggerName)} ON ${target}` });
        } finally { h.unmount(); }
      }
      assert.notEqual(functions[0].function_name, functions[1].function_name);
      for (let i = 0; i < tables.length; i++) {
        const object = { dbType: 'POSTGRESQL', schema, tableName: tables[i], objectType: 'TRIGGER', objectName: triggerName };
        const history = await repository.invoke('git-get-history', object); assert.equal(history.history.length, 1);
        const content = await repository.invoke('git-get-file-content', { ...object, commitId: history.history[0].fullId });
        assert.equal(content.content, functions[i].function_ddl + functions[i].trigger_ddl);
      }
      assert.equal((await invoke('get-postgres-trigger', { schema, triggerName })).success, false, 'A table-less ambiguous trigger identity must not select another table');
      const edit = await createDdlEditor('trigger', db, invoke, { schema, initialTable: tables[0], triggerName, isNew: false });
      try {
        edit.render().setWizBody('BEGIN NEW.amount := NEW.amount + 100; RETURN NEW; END;'); await edit.flush(); await edit.render().handleCreateTrigger();
        for (let i = 0; i < tables.length; i++) {
          const target = `${q(schema)}.${q(tables[i])}`;
          await sql(`INSERT INTO ${target} VALUES (10)`);
          assert.equal((await read(main, `SELECT amount FROM ${target}`))[0].amount, i ? 20 : 110);
        }
        await main.rollback();
      } finally { edit.unmount(); }
      const second = `${q(schema)}.${q(tables[1])}`;
      await sql(`DROP TRIGGER ${q(triggerName)} ON ${second}`);
      await sql(`CREATE TRIGGER ${q(triggerName)} BEFORE INSERT ON ${second} FOR EACH ROW EXECUTE FUNCTION ${q(functions[0].function_schema)}.${q(functions[0].function_name)}()`);
      const shared = await createDdlEditor('trigger', db, invoke, { schema, initialTable: tables[0], triggerName, isNew: false });
      try {
        const before = (await invoke('get-postgres-trigger', { schema, tableName: tables[0], triggerName })).trigger;
        assert.equal(String(before.function_users), '2');
        shared.render().setWizBody('BEGIN NEW.amount := NEW.amount + 999; RETURN NEW; END;'); await shared.flush(); await shared.render().handleCreateTrigger();
        assert.equal(shared.render().canSave, false); assert.ok(shared.alerts.includes('trigger_not_ready'));
        const after = (await invoke('get-postgres-trigger', { schema, tableName: tables[0], triggerName })).trigger;
        assert.equal(after.function_ddl, before.function_ddl);
        await sql(`INSERT INTO ${second} VALUES (10)`); assert.equal((await read(main, `SELECT amount FROM ${second}`))[0].amount, 110); await main.rollback();
      } finally { shared.unmount(); }
    });

    if (db === 'oracle') await step('Preserve Oracle trigger WHEN, UPDATE OF, aliases, ordering and disabled state through the actual editor', async () => {
      const tableName = `${token}_TrgTable`, name = `${token}_TrgMixed`, first = `${token}_TrgFirst`;
      const target = `${q(schema)}.${q(tableName)}`, trigger = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${target} ("MiXeD" NUMBER, "Other" NUMBER)`); created.push({ type: 'TABLE', name: target });
      await sql(`INSERT INTO ${target} VALUES (0, 0)`); await main.commit();
      await sql(`CREATE TRIGGER ${q(schema)}.${q(first)} BEFORE UPDATE ON ${target} FOR EACH ROW BEGIN NULL; END;`);
      created.push({ type: 'TRIGGER', name: `${q(schema)}.${q(first)}` });
      await sql(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF "MiXeD" ON ${target} REFERENCING NEW AS N OLD AS O FOR EACH ROW FOLLOWS ${q(first)} DISABLE WHEN (N."MiXeD" > 0) BEGIN :N."Other" := :O."Other" + 1; END;`);
      created.push({ type: 'TRIGGER', name: trigger });
      const invoke = createDatabaseIpc(main, db), identity = { schema, triggerName: name };
      const beforeResult = await invoke('get-oracle-trigger', identity); assert.equal(beforeResult.success, true);
      const before = beforeResult.trigger; assert.equal(before.editable, true, JSON.stringify({ action: before.ACTION_TYPE, edition: before.CROSSEDITION, base: before.BASE_OBJECT_TYPE, owner: before.TABLE_OWNER })); assert.equal(before.STATUS, 'DISABLED');
      assert.deepEqual(Array.from(before.updateColumns), ['MiXeD']); assert.match(before.header, /FOLLOWS/);
      const h = await createDdlEditor('trigger', db, invoke, { schema, initialTable: tableName, triggerName: name, isNew: false });
      try {
        assert.equal(h.render().canSave, true); assert.equal(h.render().wizAliasNew, 'N');
        h.render().setWizBody('BEGIN :N."Other" := :O."Other" + 10; END;'); await h.flush();
        await h.render().handleCreateTrigger(); await h.flush();
        assert.ok(!h.alerts.includes('an_error_occurred_please_check_the_console'));
        const after = (await invoke('get-oracle-trigger', identity)).trigger;
        assert.equal(after.STATUS, 'DISABLED'); assert.equal(after.WHEN_CLAUSE, before.WHEN_CLAUSE);
        assert.deepEqual(Array.from(after.updateColumns), ['MiXeD']); assert.match(after.header, /FOLLOWS/); assert.match(after.header, /NEW AS N OLD AS O/);
        assert.equal(after.errors.length, 0); assert.match(after.body, /\+ 10/);
        const stale = await invoke('save-oracle-trigger', { ...identity, isNew: false, body: 'BEGIN NULL; END;', expected: { source: before.source, status: before.STATUS } });
        assert.equal(stale.success, false); assert.equal((await invoke('get-oracle-trigger', identity)).trigger.source, after.source);
        await sql(`UPDATE ${target} SET "MiXeD" = 1`); assert.equal(Number((await read(main, `SELECT "Other" AS value FROM ${target}`))[0].VALUE), 0); await main.rollback();
        await sql(`ALTER TRIGGER ${trigger} ENABLE`);
        await sql(`UPDATE ${target} SET "Other" = 1`); assert.equal(Number((await read(main, `SELECT "Other" AS value FROM ${target}`))[0].VALUE), 1);
        await sql(`UPDATE ${target} SET "MiXeD" = -1`); assert.equal(Number((await read(main, `SELECT "Other" AS value FROM ${target}`))[0].VALUE), 1);
        await sql(`UPDATE ${target} SET "MiXeD" = 1`); assert.equal(Number((await read(main, `SELECT "Other" AS value FROM ${target}`))[0].VALUE), 11); await main.rollback();
      } finally { h.unmount(); }
      const newName = token + "_New'Name", newIdentity = { schema, triggerName: newName };
      const create = { ...newIdentity, tableName, isNew: true, timing: 'BEFORE', events: ['INSERT'], forEachRow: true,
        updateColumns: [], aliasNew: 'NEW', aliasOld: 'OLD', body: 'BEGIN :NEW."Other" := 3; END;' };
      const added = await invoke('save-oracle-trigger', create); assert.equal(added.success, true);
      created.push({ type: 'TRIGGER', name: `${q(schema)}.${q(newName)}` });
      assert.equal(added.trigger.errors.length, 0); assert.equal(added.trigger.STATUS, 'ENABLED');
      const duplicate = await invoke('save-oracle-trigger', { ...create, body: 'BEGIN NULL; END;' });
      assert.equal(duplicate.success, false); assert.equal((await invoke('get-oracle-trigger', newIdentity)).trigger.source, added.trigger.source);
      await sql(`INSERT INTO ${target} VALUES (0, 0)`);
      assert.equal(Number((await read(main, `SELECT MAX("Other") AS value FROM ${target}`))[0].VALUE), 3); await main.rollback();
    });

    if (db === 'postgresql') await step('Retain custom function identity, WHEN, UPDATE OF, disabled mode and security settings on existing trigger saves', async () => {
      const tableName = `${token}_Conditions`, triggerName = `${token}_Conditional`, functionName = `${token}_CustomHandler`;
      const target = `${q(schema)}.${q(tableName)}`, fn = `${q(schema)}.${q(functionName)}`;
      await sql(`CREATE TABLE ${target} (amount integer, other integer)`); created.push({ type: 'TABLE', name: target });
      await sql(`INSERT INTO ${target} VALUES (0, 0)`); await main.commit();
      await sql(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$ BEGIN NEW.other := NEW.other + 1; RETURN NEW; END; $$`);
      created.push({ type: 'FUNCTION', name: `${fn}()` });
      await sql(`CREATE TRIGGER ${q(triggerName)} BEFORE UPDATE OF amount ON ${target} FOR EACH ROW WHEN (NEW.amount > 0) EXECUTE FUNCTION ${fn}()`);
      created.push({ type: 'TRIGGER', name: `${q(triggerName)} ON ${target}` });
      await sql(`ALTER TABLE ${target} DISABLE TRIGGER ${q(triggerName)}`);
      const invoke = createDatabaseIpc(main, db), identity = { schema, tableName, triggerName };
      const h = await createDdlEditor('trigger', db, invoke, { schema, initialTable: tableName, triggerName, isNew: false });
      try {
        const before = (await invoke('get-postgres-trigger', identity)).trigger;
        await h.render().handleCreateTrigger(); await h.flush();
        assert.deepEqual((await invoke('get-postgres-trigger', identity)).trigger, before);
        h.render().setWizBody('BEGIN NEW.other := NEW.other + 10; RETURN NEW; END;'); await h.flush(); await h.render().handleCreateTrigger(); await h.flush();
        const after = (await invoke('get-postgres-trigger', identity)).trigger;
        assert.equal(after.trigger_oid, before.trigger_oid); assert.equal(after.trigger_ddl, before.trigger_ddl);
        assert.equal(after.enabled, 'D'); assert.equal(after.function_name, functionName);
        assert.match(after.function_ddl, /SECURITY DEFINER/); assert.match(after.function_ddl, /SET search_path TO 'pg_catalog'/);
        h.render().setWizEvents(['INSERT']); await h.flush(); await h.render().handleCreateTrigger();
        assert.ok(h.alerts.includes('an_error_occurred_please_check_the_console'));
        assert.deepEqual((await invoke('get-postgres-trigger', identity)).trigger, after);
      } finally { h.unmount(); }
      await sql(`UPDATE ${target} SET amount = 1`); assert.equal((await read(main, `SELECT other FROM ${target}`))[0].other, 0); await main.rollback();
      await sql(`ALTER TABLE ${target} ENABLE TRIGGER ${q(triggerName)}`);
      await sql(`UPDATE ${target} SET other = 1`); assert.equal((await read(main, `SELECT other FROM ${target}`))[0].other, 1);
      await sql(`UPDATE ${target} SET amount = -1`); assert.equal((await read(main, `SELECT other FROM ${target}`))[0].other, 1);
      await sql(`UPDATE ${target} SET amount = 1`); assert.equal((await read(main, `SELECT other FROM ${target}`))[0].other, 11); await main.rollback();
    });

    await step('Preserve handled, reraised and unhandled exceptions and literal placeholders through the actual trace executor', async () => {
      const name = `${token}_ERR`, target = `${q(schema)}.${q(name)}`, audit = `${q(schema)}.${q(token + '_ERR_AUDIT')}`;
      await sql(`CREATE TABLE ${target} ("AMOUNT" ${db === 'oracle' ? 'NUMBER' : 'integer'})`); created.push({ type: 'TABLE', name: target });
      await sql(`CREATE TABLE ${audit} (AMOUNT ${db === 'oracle' ? 'NUMBER' : 'integer'})`); created.push({ type: 'TABLE', name: audit });
      const { buildTriggerTraceProgram } = loadTypeScript(`src/features/${db}/windows/trigger/triggerTraceProgram.ts`);
      let saved = 0;
      class TraceDatabase {
        static deleteDatabase() {} async init() {} async insertSteps() { saved++; } async saveTraceInfo() {} close() {}
      }
      const executor = loadModule(db === 'oracle' ? 'electron/oracle/traceExecutor.js' : 'electron/postgres/traceExecutorPg.js', {
        './traceDb': { TraceDatabase }
      }, {}, { strict: false });
      const execute = db === 'oracle' ? executor.executeTrace : executor.executeTracePg;
      const raise = db === 'oracle' ? "RAISE_APPLICATION_ERROR(-20001, 'MBT expected exception');" : "RAISE EXCEPTION 'MBT expected exception';";
      const assign = result => `${db === 'oracle' ? ':NEW.AMOUNT' : 'NEW."AMOUNT"'} := ${result};`;
      const output = db === 'oracle' ? "DBMS_OUTPUT.PUT_LINE('__placeholder__');" : "RAISE NOTICE '__placeholder__';";
      const temporary = db === 'oracle' ? `MONA_${name.slice(0, 20)}_1` : `mona_${name.slice(0, 20)}_1`.toLowerCase();
      const remaining = async () => Number(value((await sql(db === 'oracle'
        ? "SELECT COUNT(*) AS value FROM ALL_OBJECTS WHERE OWNER = :schema AND OBJECT_NAME = :name AND OBJECT_TYPE = 'PROCEDURE'"
        : 'SELECT COUNT(*) AS value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=:schema AND p.proname=:name', { schema, name: temporary })).rows[0]));
      try {
        for (const variant of ['handled', 'reraised', 'unhandled']) {
          const nested = variant === 'reraised' ? ` BEGIN\n  ${raise}\n EXCEPTION WHEN OTHERS THEN\n  RAISE;\n END;` : ` ${raise}`;
          const inner = variant === 'unhandled' ? raise : ` BEGIN\n${nested}\n EXCEPTION WHEN OTHERS THEN\n  ${assign(variant === 'handled' ? 99 : 77)}\n END;`;
          const body = `BEGIN\n${db === 'oracle' && variant === 'unhandled' ? " DBMS_OUTPUT.PUT_LINE('MBT_FAILED_TRACE');\n" : ''} INSERT INTO ${audit} VALUES (1);\n${inner}\n ${output}\n${db === 'postgresql' ? ' RETURN NEW;\n' : ''}END;`;
          const program = buildTriggerTraceProgram({ wizBody: body, wizSchema: schema, wizTargetObject: name, wizTiming: 'BEFORE', wizForEachRow: true,
            traceTargetDml: 'INSERT', traceInputData: { AMOUNT: '1' }, structureDefs: [{ COLUMN_NAME: 'AMOUNT', DATA_TYPE: 'NUMBER' }], checkWhere: '1=1',
            formatSqlValue: (_col, input) => input, wizAliasOld: 'OLD', newAliasRaw: 'NEW' });
          const before = saved;
          const run = () => execute(db === 'oracle' ? main.connection : main, { schema, objectName: name, objectType: 'PROCEDURE', sourceText: program.sqlText, args: {}, skipParse: true });
          if (variant === 'unhandled') {
            await assert.rejects(run(), error => error.message.split('__GENERATED_SOURCE__')[0].includes('MBT expected exception'));
            assert.equal(saved, before, 'An unhandled exception must not save a successful trace');
          } else {
            const result = await run(); assert.equal(result.success, true);
            assert.ok(result.variablesTrace.some(line => line.includes(`V_N.AMOUNT = ${variant === 'handled' ? 99 : 77}`)), 'Native exception handler must update the simulated record');
            assert.ok(result.dbmsOutput.includes('__placeholder__'), 'Literal output must retain the original placeholder text');
            assert.ok(result.generatedSource.includes("'__placeholder__'")); assert.equal(saved, before + 1);
          }
          assert.equal(await remaining(), 0, 'Temporary trace procedure must be removed after success and failure');
          assert.equal(Number(value((await read(main, `SELECT COUNT(*) AS value FROM ${audit}`))[0])), 0, 'Trace side effects must be rolled back even on error');
          assert.equal(main.getMainTransactionState(), false);
        }
        const routineName = `${token}_ERR_FN`, routine = `${q(schema)}.${q(routineName)}`;
        const source = db === 'oracle'
          ? `CREATE OR REPLACE FUNCTION ${routine} RETURN NUMBER IS\nBEGIN\n BEGIN\n  ${raise}\n EXCEPTION WHEN OTHERS THEN\n  RETURN 66;\n END;\n RETURN 0;\nEND;`
          : `CREATE OR REPLACE FUNCTION ${routine}() RETURNS integer LANGUAGE plpgsql AS $$\nBEGIN\n BEGIN\n  ${raise}\n EXCEPTION WHEN OTHERS THEN\n  RETURN 66;\n END;\n RETURN 0;\nEND;\n$$;`;
        await sql(source); created.push({ type: 'FUNCTION', name: routine + (db === 'postgresql' ? '()' : '') });
        const expected = value((await read(main, `SELECT ${routine}() AS value${db === 'oracle' ? ' FROM DUAL' : ''}`))[0]); assert.equal(Number(expected), 66);
        let sourceText = source;
        if (db === 'postgresql') {
          const { buildPgTraceProgram } = loadTypeScript('src/features/postgresql/windows/stored/traceProgramBuilder.ts', { '../../sqlTokens': loadTypeScript('src/features/postgresql/sqlTokens.ts') });
          sourceText = buildPgTraceProgram({ schema, objectType: 'FUNCTION', sourceText: source, finalArgs: {}, argumentsList: [], inputDateFormat: '', t: key => key });
        }
        const traced = await execute(db === 'oracle' ? main.connection : main, { schema, objectName: routineName, objectType: 'FUNCTION', sourceText, args: {}, skipParse: db === 'postgresql' });
        assert.ok(!traced.dbmsOutput.includes('MBT_FAILED_TRACE'), 'A failed prior trace must not leak output into the next trace');
        assert.equal(traced.success, true); assert.equal(Number(traced.returnValues[0].value), Number(expected), 'Stored-function trace must match native exception handling');
      } finally {
        // Remove only this scenario's known temporary program if an assertion interrupts execution.
        if (await remaining()) await sql(`DROP PROCEDURE ${q(schema)}.${q(temporary)}${db === 'postgresql' ? '()' : ''}`);
      }
    });

    await step('Execute generated trigger simulations once without firing live triggers or changing source rows', async () => {
      const name = `${token}_Sim'Table`, target = `${q(schema)}.${q(name)}`, trigger = `${token}_LIVE`, fn = `${token}_SIM_FN`, audit = `${q(schema)}.${q(token + '_SIM_AUDIT')}`;
      await sql(`CREATE TABLE ${target} ("AMOUNT" ${db === 'oracle' ? 'NUMBER' : 'integer'})`);
      created.push({ type: 'TABLE', name: target });
      await sql(`CREATE TABLE ${audit} (AMOUNT ${db === 'oracle' ? 'NUMBER' : 'integer'})`); created.push({ type: 'TABLE', name: audit });
      await sql(`INSERT INTO ${target} VALUES (10)`); await main.commit();
      if (db === 'oracle') {
        await sql(`CREATE TRIGGER ${q(schema)}.${q(trigger)} BEFORE INSERT OR UPDATE OR DELETE ON ${target} FOR EACH ROW BEGIN DBMS_OUTPUT.PUT_LINE('MBT_LIVE_TRIGGER'); END;`);
        created.push({ type: 'TRIGGER', name: `${q(schema)}.${q(trigger)}` });
      } else {
        await sql(`CREATE FUNCTION ${q(schema)}.${q(fn)}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE NOTICE 'MBT_LIVE_TRIGGER'; RETURN NULL; END;$$`);
        created.push({ type: 'FUNCTION', name: `${q(schema)}.${q(fn)}()` });
        await sql(`CREATE TRIGGER ${q(trigger)} BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON ${target} FOR EACH STATEMENT EXECUTE FUNCTION ${q(schema)}.${q(fn)}()`);
        created.push({ type: 'TRIGGER', name: `${q(trigger)} ON ${target}` });
      }
      const { buildTriggerTraceProgram } = loadTypeScript(`src/features/${db}/windows/trigger/triggerTraceProgram.ts`);
      const notices = [];
      if (db === 'oracle') await sql('BEGIN DBMS_OUTPUT.ENABLE(NULL); END;');
      for (const timing of ['BEFORE', 'AFTER', 'INSTEAD OF']) for (const event of ['INSERT', 'UPDATE', 'DELETE', ...(db === 'postgresql' ? ['TRUNCATE'] : [])]) {
        const procedure = `${token}_${timing.replaceAll(' ', '')}_${event}`, qualified = `${q(schema)}.${q(procedure)}`;
        const body = db === 'oracle' ? `BEGIN\n :NEW.AMOUNT := NVL(:NEW.AMOUNT, 0) + 1;\n IF UPDATING('AMOUNT') THEN\n DBMS_OUTPUT.PUT_LINE('MBT_COLUMN_MATCH');\n END IF;\n INSERT INTO ${audit} VALUES (:NEW.AMOUNT);\n DBMS_OUTPUT.PUT_LINE('MBT_SIMULATED');\nEND;`
          : `BEGIN\n NEW."AMOUNT" := COALESCE(NEW."AMOUNT", 0) + 1;\n INSERT INTO ${audit} VALUES (NEW."AMOUNT");\n RAISE NOTICE 'MBT_SIMULATED';\n RETURN NEW;\nEND;`;
        const program = buildTriggerTraceProgram({ wizBody: body, wizSchema: schema, wizTargetObject: name, wizTiming: timing,
          wizForEachRow: event !== 'TRUNCATE', traceTargetDml: event, traceInputData: { AMOUNT: '1' },
          structureDefs: [{ COLUMN_NAME: 'AMOUNT', DATA_TYPE: 'NUMBER' }], checkWhere: '1=1', formatSqlValue: (_col, input) => input, wizAliasOld: 'OLD', newAliasRaw: 'NEW' });
        await sql(renameTraceProcedure(program.sqlText, procedure, db));
        created.push({ type: 'PROCEDURE', name: qualified + (db === 'postgresql' ? '()' : '') });
        notices.length = 0;
        const execution = await sql(db === 'oracle' ? `BEGIN ${qualified}; END;` : `CALL ${qualified}()`);
        if (db === 'postgresql') notices.push(...execution.notices);
        if (db === 'oracle') {
          const driver = require('oracledb');
          for (;;) {
            const result = await main.connection.execute('BEGIN DBMS_OUTPUT.GET_LINE(:line, :status); END;', {
              line: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 32767 }, status: { dir: driver.BIND_OUT, type: driver.NUMBER }
            });
            if (result.outBinds.status !== 0) break;
            notices.push(result.outBinds.line);
          }
        }
        assert.equal(notices.filter(line => line === 'MBT_SIMULATED').length, 1, `${timing} ${event}: simulate exactly once`);
        if (db === 'oracle') assert.equal(notices.includes('MBT_COLUMN_MATCH'), event === 'UPDATE');
        assert.equal(Number(value((await read(main, `SELECT COUNT(*) AS value FROM ${audit}`))[0])), 0, 'Body SQL must be rolled back');
        assert.ok(!notices.includes('MBT_LIVE_TRIGGER'), `${timing} ${event}: live trigger must not fire`);
        if (event === 'INSERT' || event === 'UPDATE') assert.ok(notices.some(line => line.includes('V_N.AMOUNT = 2')), 'Trace must retain the once-modified value');
        assert.equal(Number((await read(main, `SELECT "AMOUNT" AS value FROM ${target}`))[0][db === 'oracle' ? 'VALUE' : 'value']), 10);
      }
    });

    if (db === 'oracle') await step('Match native Oracle UPDATING column predicates for selected and unselected columns', async () => {
      const name = `${token}_PRED`, target = `${q(schema)}.${q(name)}`, trigger = `${q(schema)}.${q(token + '_PRED_TRG')}`;
      await sql(`CREATE TABLE ${target} (AMOUNT NUMBER, OTHER NUMBER, NOTE VARCHAR2(30))`); created.push({ type: 'TABLE', name: target });
      await sql(`INSERT INTO ${target} VALUES (1, 1, NULL)`); await main.commit();
      const predicates = ["UPDATING('AMOUNT')", "UPDATING('amount')", "UPDATING('OTHER')", "UPDATING(UPPER('amount'))", 'UPDATING', 'INSERTING', 'DELETING'];
      const body = `BEGIN\n :NEW.NOTE := 'P';\n${predicates.map(predicate => ` IF ${predicate} THEN :NEW.NOTE := :NEW.NOTE || '1'; ELSE :NEW.NOTE := :NEW.NOTE || '0'; END IF;`).join('\n')}\nEND;`;
      await sql(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE OR DELETE ON ${target} FOR EACH ROW ${body}`); created.push({ type: 'TRIGGER', name: trigger });
      const { rewriteTriggerTraceReferences } = loadTypeScript('src/features/stored/triggerTraceTokens.ts');
      for (const columns of [['AMOUNT'], ['OTHER'], ['AMOUNT', 'OTHER']]) {
        await sql(`UPDATE ${target} SET ${columns.map(column => `${column} = ${column}`).join(', ')}`);
        const expected = value((await read(main, `SELECT NOTE AS value FROM ${target}`))[0]); await main.rollback();
        const rewritten = rewriteTriggerTraceReferences(body, 'oracle', { dml: 'UPDATE', updatedColumns: columns });
        const driver = require('oracledb');
        const result = await main.connection.execute(`DECLARE v_n ${target}%ROWTYPE; ${rewritten.slice(0, -4)} :result := v_n.NOTE; END;`, { result: { dir: driver.BIND_OUT, type: driver.STRING, maxSize: 100 } });
        assert.equal(result.outBinds.result, expected, `Column predicates must match native Oracle: ${columns.join(', ')}`);
      }
    });

    await step('Keep literal trigger-reference text unchanged when executing the token-rewritten program', async () => {
      const name = `${token}_Literal`, target = `${q(schema)}.${q(name)}`, marker = db === 'oracle' ? ':NEW.ID' : 'NEW.ID';
      await sql(`CREATE TABLE ${target} ("NOTE" ${db === 'oracle' ? 'VARCHAR2(80)' : 'text'})`); created.push({ type: 'TABLE', name: target });
      const { rewriteTriggerTraceReferences } = loadTypeScript('src/features/stored/triggerTraceTokens.ts');
      const prefix = db === 'oracle' ? ':' : '';
      const program = `DECLARE v_n ${target}%ROWTYPE; BEGIN ${prefix}NEW."NOTE" := '${marker}'; INSERT INTO ${target} VALUES (${prefix}NEW."NOTE"); END;`;
      const rewritten = rewriteTriggerTraceReferences(program, db, { dml: 'INSERT' });
      assert.ok(rewritten.includes(`'${marker}'`));
      if (db === 'postgresql') await sql('BEGIN');
      await sql(db === 'oracle' ? rewritten : `DO $mb_test$${rewritten}$mb_test$`);
      assert.equal(value((await read(main, `SELECT "NOTE" AS value FROM ${target}`))[0]), marker);
      await main.rollback(); assert.equal((await read(observer, `SELECT "NOTE" FROM ${target}`)).length, 0);
    });

    if (db === 'oracle') await step('Create exact synonym names, preserve no-op transactions, review concurrent targets and inspect native definitions', async () => {
      const name = token + "_Sy'Case", synonym = `${q(schema)}.${q(name)}`;
      const targets = ['A', 'B', 'C'].map(suffix => token + '_SynRows' + suffix);
      for (const target of targets) {
        const full = `${q(schema)}.${q(target)}`; await sql(`CREATE TABLE ${full}(ID INTEGER)`); created.push({ type: 'TABLE', name: full });
      }
      const native = createDatabaseIpc(main, db), calls = [], invoke = (channel, ...args) => { calls.push([channel, ...args]); return native(channel, ...args); };
      const createdHook = await createSynonymHarness(invoke, { schema, synonymName: name, isNew: true, allSchemas: [schema] });
      try {
        createdHook.state.setFormData(previous => ({ ...previous, targetObject: targets[0] })); await createdHook.flush();
        await createdHook.state.handleExecute(); await createdHook.flush();
        assert.equal(createdHook.state.operationError, ''); created.push({ type: 'SYNONYM', name: synonym });
        assert.match(calls.find(call => call[0] === 'execute-sql')[1], /^CREATE SYNONYM/);
      } finally { createdHook.unmount(); }
      const h = await createSynonymHarness(invoke, { schema, synonymName: name, allSchemas: [schema] }), metadata = synonymModules(invoke);
      try {
        await h.waitFor(state => state.ready && !state.isLoading); assert.ok(h.state.sourceText.includes(name.replaceAll('"', '""')));
        await sql(`INSERT INTO ${q(schema)}.${q(targets[0])} VALUES (7)`); assert.equal(main.getMainTransactionState(), true); calls.length = 0;
        await h.state.handleExecute(); await h.flush(); assert.equal(calls.length, 0); assert.equal(main.getMainTransactionState(), true);
        assert.equal((await read(observer, `SELECT * FROM ${q(schema)}.${q(targets[0])}`)).length, 0); await main.rollback();
        h.state.setFormData(previous => ({ ...previous, targetObject: targets[2] })); await h.flush();
        await observer.execute(`CREATE OR REPLACE SYNONYM ${synonym} FOR ${q(schema)}.${q(targets[1])}`); calls.length = 0;
        await h.state.handleExecute(); await h.flush(); assert.equal(h.state.conflict.targetObject, targets[1]); assert.equal(calls.filter(call => call[0] === 'execute-sql').length, 0);
        h.state.keepLocalChanges(); await h.flush(); await h.state.handleExecute(); await h.flush(); assert.equal(h.state.operationError, '');
        assert.equal((await metadata.readSynonym(schema, name)).targetObject, targets[2]);
        const view = `${q(schema)}.${q(token + '_SynView')}`; await sql(`CREATE VIEW ${view} AS SELECT ID FROM ${synonym}`); created.push({ type: 'VIEW', name: view });
        assert.ok((await metadata.readSynonymDependents(schema, name)).some(row => row.NAME === token + '_SynView'));
        assert.equal((await metadata.inspectSynonymTarget(await metadata.readSynonym(schema, name))).state, 'found');
        const missing = token + '_FutureRows';
        h.state.setFormData(previous => ({ ...previous, targetObject: missing })); await h.flush(); await h.state.handleExecute(); await h.flush();
        assert.equal(h.state.operationError, ''); assert.equal((await metadata.inspectSynonymTarget(await metadata.readSynonym(schema, name))).state, 'missing');
        const remote = token + '_RemoteSyn', remoteName = `${q(schema)}.${q(remote)}`;
        await sql(metadata.synonymSql({ owner: schema, name: remote, targetSchema: 'REMOTE_SCHEMA', targetObject: 'REMOTE_ROWS', dbLink: 'MBT_UNCONNECTED.EXAMPLE', editionable: null }, false));
        created.push({ type: 'SYNONYM', name: remoteName });
        const reference = await metadata.readSynonym(schema, remote); calls.length = 0;
        assert.equal((await metadata.inspectSynonymTarget(reference)).state, 'remote'); assert.equal(calls.length, 0);
        const duplicate = await createSynonymHarness(invoke, { schema, synonymName: name, isNew: true, allSchemas: [schema] });
        try {
          duplicate.state.setFormData(previous => ({ ...previous, targetObject: targets[0] })); await duplicate.flush(); calls.length = 0;
          await duplicate.state.handleExecute(); await duplicate.flush(); assert.equal(duplicate.state.operationError, 'synonym_name_exists'); assert.equal(calls.filter(call => call[0] === 'execute-sql').length, 0);
        } finally { duplicate.unmount(); }
        await h.state.handleDelete(); await h.flush(); assert.equal(await metadata.readSynonym(schema, name), null);
        created.splice(created.findIndex(object => object.type === 'SYNONYM' && object.name === synonym), 1);
        assert.equal((await read(main, `SELECT * FROM ${q(schema)}.${q(targets[2])}`)).length, 0);
      } finally { h.unmount(); }
    });
    await step('Refresh exact materialized views, retain native Git source and preserve pending edits on metadata and no-op operations', async () => {
      const name = token + "_Mv'Case", target = `${q(schema)}.${q(name)}`, baseName = token + '_MvRows', base = `${q(schema)}.${q(baseName)}`, indexName = token + '_MvIndex';
      await sql(`CREATE TABLE ${base}("ID" INTEGER)`); created.push({ type: 'TABLE', name: base });
      await sql(`INSERT INTO ${base} VALUES (1)`); await main.commit();
      const repo = await createGitRepository(t), native = createDatabaseIpc(main, db), calls = [];
      const invoke = (channel, ...args) => { calls.push([channel, ...args]); return channel.startsWith('git-') ? repo.invoke(channel, args[0]) : native(channel, ...args); };
      const create = await createMviewHarness(db, invoke, { schema, mviewName: name, isNew: true, allSchemas: [schema] });
      try {
        create.state.setFormData(previous => ({ ...previous, selectSql: `SELECT "ID" FROM ${base}`, refreshMethod: 'COMPLETE', withData: db === 'oracle' })); await create.flush();
        await create.state.handleExecute(); await create.flush(); assert.equal(create.state.error, ''); created.push({ type: 'MATERIALIZED VIEW', name: target });
        assert.ok(create.events.some(event => event.type === 'mview-created'));
      } finally { create.unmount(); }
      await sql(`CREATE UNIQUE INDEX ${db === 'oracle' ? q(schema) + '.' : ''}${q(indexName)} ON ${target}("ID")`);
      const h = await createMviewHarness(db, invoke, { schema, mviewName: name, allSchemas: [schema] });
      const { metadata: reader } = mviewModules(invoke);
      try {
        // A fresh Oracle service can spend substantially longer in the first DBMS_METADATA call.
        await h.waitFor(state => !state.isLoading && (state.ready || Boolean(state.loadError)), db === 'oracle' ? 120000 : 10000);
        assert.equal(h.state.loadError, '', 'Materialized-view source loading must succeed before refresh assertions.');
        assert.equal(h.state.ready, true);
        assert.ok(h.state.sourceText.includes(indexName));
        if (db === 'postgresql') { assert.equal(h.state.metadata.populated, false); assert.equal(h.state.metadata.concurrent, false); }
        await sql(`INSERT INTO ${base} VALUES (2)`); assert.equal(main.getMainTransactionState(), true);
        await h.state.loadSource(); await h.flush(); if (db === 'oracle') await h.state.handleExecute();
        assert.equal(main.getMainTransactionState(), true); assert.equal((await read(observer, `SELECT * FROM ${base}`)).length, 1);
        await main.commit();
        h.state.setRenameTo('NotTheSavedName'); await h.flush(); calls.length = 0;
        await h.state.handleRefreshMView(); await h.flush(); assert.equal(h.state.error, '');
        assert.equal(calls.filter(call => call[0] === 'execute-sql').length, 1);
        assert.deepEqual(Array.from(await read(main, `SELECT "ID" FROM ${target} ORDER BY "ID"`), row => Number(row.ID)), [1, 2]);
        if (db === 'postgresql') {
          assert.equal(h.state.metadata.concurrent, true); h.state.setConcurrent(true); await h.flush(); await h.state.handleRefreshMView(); await h.flush(); assert.equal(h.state.error, '');
        } else {
          h.state.setFormData(previous => ({ ...previous, refreshMethod: 'FORCE' })); await h.flush(); calls.length = 0; await h.state.handleExecute(); await h.flush(); assert.equal(h.state.error, '');
          const mutation = calls.find(call => call[0] === 'execute-sql'); assert.ok(mutation[1].endsWith('REFRESH FORCE')); assert.ok(!mutation[1].includes('NEXT'));
          const commit = calls.find(call => call[0] === 'git-commit'); assert.ok(commit[1].sourceText.includes('CREATE MATERIALIZED VIEW'));
        }
        await sql(`INSERT INTO ${base} VALUES (3)`); assert.equal(main.getMainTransactionState(), true);
        if (db === 'postgresql') { h.state.setConcurrent(false); await h.flush(); }
        await h.state.handleRefreshMView(); await h.flush(); assert.equal(h.state.error, '');
        assert.equal((await read(main, `SELECT * FROM ${target}`)).length, 3);
        if (db === 'postgresql') {
          assert.equal(main.getMainTransactionState(), true); assert.equal(h.state.refreshPending, true);
          assert.equal((await read(observer, `SELECT * FROM ${base}`)).length, 2);
          await main.rollback(); h.transactionChanged(false); await h.flush(); assert.equal(h.state.refreshPending, false);
          assert.equal((await read(main, `SELECT * FROM ${target}`)).length, 2);
        } else {
          assert.equal(main.getMainTransactionState(), false); assert.equal((await read(observer, `SELECT * FROM ${base}`)).length, 3);
        }
        const info = await reader.readMviewRelations(db, schema, name); assert.ok(info.some(item => item.includes(baseName))); assert.ok(info.some(item => item.includes(indexName)));
        if (db === 'postgresql') {
          const cloneName = token + '_MvClone', clone = `${q(schema)}.${q(cloneName)}`;
          const source = (await reader.readMviewSource(db, schema, name)).split(target).join(clone).split(q(indexName)).join(q(token + '_MvCloneIdx'));
          for (const statement of scripts.splitSqlScript(source, db)) { await sql(statement.text); if (!created.some(item => item.name === clone)) created.push({ type: 'MATERIALIZED VIEW', name: clone }); }
          assert.equal((await read(main, `SELECT * FROM ${clone}`)).length, 2);
          const renamedName = token + "_Mv'New", renamed = `${q(schema)}.${q(renamedName)}`;
          h.state.setRenameTo(renamedName); await h.flush(); await h.state.handleRename(); await h.flush(); assert.equal(h.state.error, '');
          created.find(item => item.name === target).name = renamed;
          assert.ok(h.events.some(event => event.type === 'open-mview-tab' && event.detail.mviewName === renamedName));
          assert.equal((await read(main, `SELECT * FROM ${renamed}`)).length, 2);
        }
      } finally { h.unmount(); }
    });
    if (db === 'oracle') await step('Manage native materialized view logs, quoted filters, DML records and fast refresh without destructive no-ops', async () => {
      const name = token + '_LogMaster', target = `${q(schema)}.${q(name)}`;
      const mvName = token + '_LogMv', mv = `${q(schema)}.${q(mvName)}`;
      await sql(`CREATE TABLE ${target} ("ID" NUMBER PRIMARY KEY, "a,b" NUMBER, "Order Total" NUMBER)`);
      created.push({ type: 'TABLE', name: target });
      const native = createDatabaseIpc(main, db), calls = [];
      const invoke = (channel, ...args) => { calls.push([channel, ...args]); return native(channel, ...args); };
      const model = logModules(invoke);
      const fresh = await createMviewLogHarness(invoke, { schema, tableName: name, isNew: true, allSchemas: [schema] });
      try {
        await fresh.waitFor(s => s.ready && !s.isLoading);
        fresh.state.setFormData(previous => ({ ...previous, withRowid: true, withSequence: true, filterColumns: ['a,b'], includingNewValues: true })); await fresh.flush();
        await fresh.state.handleExecute(); await fresh.flush();
        assert.equal(fresh.state.error, ''); created.push({ type: 'MATERIALIZED VIEW LOG ON', name: target });
        assert.ok(fresh.events.some(e => e.type === 'mview-log-created'));
        assert.deepEqual(Array.from((await model.readMviewLog(schema, name)).form.filterColumns), ['a,b']);
      } finally { fresh.unmount(); }
      const h = await createMviewLogHarness(invoke, { schema, tableName: name, allSchemas: [schema] });
      try {
        await h.waitFor(s => s.ready && !s.isLoading);
        assert.ok(h.state.metadata.source.includes('TABLESPACE')); assert.equal(h.state.formData.withPrimaryKey, true);
        await sql(`INSERT INTO ${target} VALUES (99, 1, 1)`);
        calls.length = 0; await h.state.handleExecute(); assert.equal(calls.length, 0);
        assert.equal(main.getMainTransactionState(), true);
        assert.equal((await read(observer, `SELECT * FROM ${target}`)).length, 0);
        await main.rollback();
        h.state.toggleColumn('Order Total', true); await h.flush(); await h.state.handleExecute(); await h.flush(); assert.equal(h.state.error, '');
        assert.ok(h.state.metadata.source.includes('"Order Total"')); assert.equal(h.state.alterSql, '');
        h.state.setFormData(previous => ({ ...previous, includingNewValues: false })); await h.flush(); await h.state.handleExecute(); await h.flush(); assert.equal(h.state.error, ''); assert.equal(h.state.metadata.form.includingNewValues, false);
        h.state.setFormData(previous => ({ ...previous, includingNewValues: true })); await h.flush(); await h.state.handleExecute(); await h.flush(); assert.equal(h.state.error, '');
        await sql(`CREATE MATERIALIZED VIEW ${mv} REFRESH FAST ON DEMAND WITH PRIMARY KEY AS SELECT "ID", "a,b", "Order Total" FROM ${target}`);
        created.push({ type: 'MATERIALIZED VIEW', name: mv });
        await sql(`INSERT INTO ${target} VALUES (1, 10, 20)`); await main.commit();
        const physical = `${q(schema)}.${q(h.state.metadata.logTable)}`;
        const records = await read(main, `SELECT "DMLTYPE$$" FROM ${physical}`); assert.ok(records.some(r => r['DMLTYPE$$'] === 'I'));
        await sql('BEGIN DBMS_MVIEW.REFRESH(:target, \'F\'); END;', { target: mv });
        assert.equal(Number((await read(main, `SELECT "a,b" AS VALUE FROM ${mv} WHERE "ID" = 1`))[0].VALUE), 10);
        await sql(`UPDATE ${target} SET "a,b" = 30 WHERE "ID" = 1`); await main.commit();
        assert.ok((await read(main, `SELECT "DMLTYPE$$" FROM ${physical}`)).some(r => r['DMLTYPE$$'] === 'U'));
        await sql('BEGIN DBMS_MVIEW.REFRESH(:target, \'F\'); END;', { target: mv });
        assert.equal(Number((await read(main, `SELECT "a,b" AS VALUE FROM ${mv} WHERE "ID" = 1`))[0].VALUE), 30);
        await sql(`DELETE FROM ${target} WHERE "ID" = 1`); await main.commit();
        assert.ok((await read(main, `SELECT "DMLTYPE$$" FROM ${physical}`)).some(r => r['DMLTYPE$$'] === 'D'));
        await sql('BEGIN DBMS_MVIEW.REFRESH(:target, \'F\'); END;', { target: mv });
        assert.equal((await read(main, `SELECT * FROM ${mv}`)).length, 0);
        // A concurrent settings change must not be silently overwritten by the editor.
        await sql(`ALTER MATERIALIZED VIEW LOG ON ${target} EXCLUDING NEW VALUES`);
        h.state.setFormData(previous => ({ ...previous, includingNewValues: false })); await h.flush(); calls.length = 0;
        await h.state.handleExecute(); await h.flush(); assert.equal(h.state.error, 'mview_log_conflict'); assert.equal(calls.filter(c => c[0] === 'execute-sql').length, 0);
        h.state.retry(); await h.flush(); await h.waitFor(s => s.ready && !s.isLoading);
        await sql(`DROP MATERIALIZED VIEW ${mv}`); created.splice(created.findIndex(o => o.name === mv), 1);
        await h.state.handleDelete(); await h.flush(); assert.equal(h.state.error, ''); assert.equal(await model.readMviewLog(schema, name), null);
        created.splice(created.findIndex(o => o.type === 'MATERIALIZED VIEW LOG ON' && o.name === target), 1);
        // A primary-key column can be an explicit filter in a ROWID-only log.
        await sql(`CREATE MATERIALIZED VIEW LOG ON ${target} WITH ROWID ("ID")`);
        created.push({ type: 'MATERIALIZED VIEW LOG ON', name: target });
        const rowidOnly = await model.readMviewLog(schema, name);
        assert.equal(rowidOnly.form.withPrimaryKey, false);
        assert.deepEqual(Array.from(rowidOnly.form.filterColumns), ['ID']);
        // Ordinary tables without a primary key default to explicit ROWID logging.
        const noPkName = token + '_LogLob', noPk = `${q(schema)}.${q(noPkName)}`;
        await sql(`CREATE TABLE ${noPk} ("ID" NUMBER, "BODY" CLOB)`); created.push({ type: 'TABLE', name: noPk });
        const other = await createMviewLogHarness(invoke, { schema, tableName: noPkName, isNew: true, allSchemas: [schema] });
        try {
          await other.waitFor(s => s.ready && !s.isLoading); assert.equal(other.state.formData.withPrimaryKey, false); assert.equal(other.state.formData.withRowid, true);
          other.state.setFormData(p => ({ ...p, withCommitScn: true })); await other.flush(); calls.length = 0;
          await other.state.handleExecute(); await other.flush(); assert.equal(other.state.error, 'mview_log_lob_scn'); assert.equal(calls.filter(c => c[0] === 'execute-sql').length, 0);
        } finally { other.unmount(); }
      } finally { h.unmount(); }
    });
    if (db === 'oracle') await step('Create, verify and alter a private database link without deleting it or exposing credentials and retain pending DML', async () => {
      const name = token + '_LINK', native = createDatabaseIpc(main, db), calls = [];
      const invoke = (channel, ...args) => { calls.push([channel, ...args]); return native(channel, ...args); };
      const h = await createDbLinkHarness(invoke, { schema, dbLinkName: '', isNew: true, allSchemas: [schema] });
      let actualName;
      const forget = () => { const index = created.findIndex(o => o.type === 'DATABASE LINK' && o.name === actualName); if (index >= 0) created.splice(index, 1); };
      try {
        await h.waitFor(s => s.ready && !s.isLoading);
        assert.equal(h.state.context.createPrivate, true, 'The dedicated test account needs CREATE DATABASE LINK.');
        assert.equal(h.state.context.alterPrivate, true, 'The dedicated test account needs ALTER DATABASE LINK.');
        h.state.setFormData({ name, username: schema, password: config.password, host: `127.0.0.1:1521/${config.database}`, isPublic: false }); await h.flush();
        actualName = name + (h.state.context.domain ? '.' + h.state.context.domain.toUpperCase() : '');
        created.push({ type: 'DATABASE LINK', name: actualName });
        await h.state.execute(); await h.flush(); assert.equal(h.state.error, '');
        actualName = h.events.find(e => e.type === 'dblink-created')?.detail.linkName;
        assert.ok(actualName);
        assert.equal(h.state.form.password, ''); assert.ok(h.state.saved.source.includes('********'));
      } finally { h.unmount(); }
      const edit = await createDbLinkHarness(invoke, { schema, dbLinkName: actualName, allSchemas: [schema] });
      try {
        await edit.waitFor(s => s.ready && !s.isLoading); assert.equal(edit.state.saved.auth, 'fixed');
        await sql(`INSERT INTO ${table} (id, amount, label) VALUES (987654, 1, 'link pending')`);
        const observerBefore = (await read(observer, `SELECT * FROM ${table} WHERE id = 987654`)).length;
        calls.length = 0; await edit.state.execute(); assert.equal(calls.length, 0); assert.equal(main.getMainTransactionState(), true);
        edit.state.setFormData(p => ({ ...p, host: p.host + ' ', password: '' })); await edit.flush();
        await edit.state.testConnection(); await edit.flush(); assert.equal(edit.state.error, ''); assert.equal(typeof edit.state.testResult, 'number');
        assert.equal(main.getMainTransactionState(), true); assert.equal((await read(observer, `SELECT * FROM ${table} WHERE id = 987654`)).length, observerBefore);
        assert.ok(calls.every(c => c[0] !== 'execute-sql'));
        await main.rollback();
        // This would fail with ORA-02080 if the connection test had left the link open in the main session.
        edit.state.setFormData(p => ({ ...p, password: config.password })); await edit.flush();
        assert.equal(edit.state.plan.kind, 'alter');
        await edit.state.execute(); await edit.flush(); assert.equal(edit.state.error, ''); assert.equal(edit.state.form.password, '');
        assert.equal(edit.state.saved.created, h.state.saved.created, 'Password updates must not recreate the link.');
        const duplicate = await main.saveDatabaseLink({ schema, name: actualName, action: 'create', form: { name: actualName, username: schema, password: config.password, host: edit.state.saved.host, isPublic: false } }).then(() => null, error => require('../../electron/oracle/databaseLink').safeError(error));
        assert.equal(duplicate.error, 'dblink_exists');
        await sql(`ALTER DATABASE LINK ${actualName} CONNECT TO ${q(schema)} IDENTIFIED BY "MBT_INVALID_PASSWORD"`);
        await edit.state.testConnection(); await edit.flush(); assert.equal(edit.state.error, 'dblink_operation_failed'); assert.equal(edit.state.errorCode, 'ORA-01017');
        edit.state.setFormData(p => ({ ...p, password: config.password })); await edit.flush(); await edit.state.execute(); await edit.flush(); assert.equal(edit.state.error, '');
        await edit.state.testConnection(); await edit.flush(); assert.equal(edit.state.error, '');
        edit.state.setFormData(p => ({ ...p, host: `127.0.0.1:1521/${config.database} `, password: config.password })); await edit.flush(); assert.equal(edit.state.plan.kind, 'alter');
        await edit.state.execute(); await edit.flush(); assert.equal(edit.state.error, '');
        // Force a native CREATE failure after the approved DROP, then explicitly recover.
        let failCreation = true;
        const originalSave = main.saveDatabaseLink.bind(main);
        main.saveDatabaseLink = async request => {
          if (failCreation && request.confirmRecreate) {
            const service = require('../../electron/oracle/databaseLink');
            return service.saveLink(async (text, binds) => {
              if (text.startsWith('CREATE')) return sql('CREATE DATABASE LINK', {});
              return sql(text, binds);
            }, request);
          }
          return originalSave(request);
        };
        edit.state.setFormData(p => ({ ...p, host: `localhost:1521/${config.database}`, password: config.password })); await edit.flush();
        try {
          await edit.state.execute(); await edit.flush(); assert.equal(edit.state.phase, 'dropped-only'); assert.equal(edit.state.ready, false); forget();
          failCreation = false;
          await edit.state.execute(); await edit.flush(); assert.equal(edit.state.error, ''); created.push({ type: 'DATABASE LINK', name: actualName });
          assert.equal(edit.confirmations.some(text => text.includes('dblink_recreate_confirm')), true);
        } finally { main.saveDatabaseLink = originalSave; }
        await edit.state.execute(true); await edit.flush(); assert.equal(edit.state.error, ''); forget();
        assert.equal((await main.getDatabaseLink({ schema, name: actualName })).link, null);
        for (const mode of ['connected', 'shared']) {
          const special = token + (mode === 'shared' ? '_SHARED_LINK' : '_CONNECTED_LINK');
          const credentials = mode === 'shared' ? `CONNECT TO ${q(schema)} IDENTIFIED BY ${q(config.password)} AUTHENTICATED BY ${q(schema)} IDENTIFIED BY ${q(config.password)}` : '';
          await sql(`CREATE ${mode === 'shared' ? 'SHARED ' : ''}DATABASE LINK ${special} ${credentials} USING '127.0.0.1:1521/${config.database}'`);
          const fullName = special + (edit.state.context.domain ? '.' + edit.state.context.domain.toUpperCase() : '');
          created.push({ type: 'DATABASE LINK', name: fullName });
          const metadata = await main.getDatabaseLink({ schema, name: special });
          const resolved = metadata.link || (await main.getDatabaseLink({ schema, name: fullName })).link;
          assert.ok(resolved); assert.equal(resolved.editable, false, 'Unconfirmed or shared authentication must not be recreated as a fixed-user link.');
        }

      } finally { edit.unmount(); }
    });
    if (db === 'oracle') await step('Read tablespace kinds, files and dependencies without changing storage or committing pending edits', async () => {
      const name = `${q(schema)}.${q(token + '_TsPending')}`;
      await sql(`CREATE TABLE ${name} (id NUMBER)`); created.push({ type: 'TABLE', name });
      await sql(`INSERT INTO ${name} VALUES (746)`);
      const invoke = createDatabaseIpc(main, db);
      const { createTablespaceHarness } = require('../helpers/tablespaceData.cjs');
      const h = await createTablespaceHarness((channel, ...args) => {
        assert.ok(['list-oracle-tablespaces', 'get-oracle-tablespace-detail'].includes(channel), 'Native tablespace tests never modify storage');
        return invoke(channel, ...args);
      });
      try {
        await h.waitFor(s => !s.isLoading && (s.ready || s.error));
        assert.equal(h.state.ready, true, h.state.error + ' ' + h.state.errorCode);
        assert.equal(h.state.snapshot.context.scope, 'all', 'Full tablespace metadata must be readable');
        assert.ok(h.state.rows.some(row => row.kind === 'TEMPORARY'), 'TEMP must remain in the list');
        assert.ok(h.state.snapshot.files.some(file => file.kind === 'TEMPFILE'));
        const own = (await read(main, 'SELECT DEFAULT_TABLESPACE FROM USER_USERS'))[0].DEFAULT_TABLESPACE;
        const target = h.state.rows.find(row => row.name === own); assert.ok(target); assert.equal(target.dropProtected, true);
        h.state.select(target.id); await h.waitFor(s => !s.isLoading && (s.detailReady || s.detailError));
        assert.equal(h.state.detailReady, true, h.state.detailError + ' ' + h.state.errorCode);
        assert.ok(h.state.detail.files.length); assert.ok(h.state.detail.users.some(row => row.USERNAME === schema));
        const id = target.id; await h.state.reload(); await h.waitFor(s => s.ready && s.detailReady && !s.isLoading); assert.equal(h.state.selectedId, id);
        assert.equal(main.getMainTransactionState(), true); assert.equal((await read(observer, `SELECT * FROM ${name}`)).length, 0);
      } finally { h.unmount(); await main.rollback(); }
    });
    if (db === 'oracle') await step('Read verified sessions and exact session statistics without terminating sessions or changing pending main data', async () => {
      const name = `${q(schema)}.${q(token + '_SessionPending')}`;
      await sql(`CREATE TABLE ${name} (id NUMBER)`); created.push({ type: 'TABLE', name });
      await sql(`INSERT INTO ${name} VALUES (745)`);
      const invoke = createDatabaseIpc(main, db), calls = [];
      const { createSessionHarness } = require('../helpers/sessionData.cjs');
      const h = await createSessionHarness((channel, ...args) => {
        assert.ok(['list-oracle-sessions', 'get-oracle-session-detail'].includes(channel), 'Native session tests never send termination or cancellation commands');
        calls.push(channel); return invoke(channel, ...args);
      });
      try {
        await h.waitFor(s => s.ready && !s.loading);
        const own = h.state.snapshot.sessions.find(row => row.SID === main.managedSessions.get(main.connection).sid);
        assert.ok(own); assert.equal(own.protected, true);
        h.state.select(own.id); await h.waitFor(s => !s.detailLoading && (s.detailReady || s.detailError));
        assert.equal(h.state.detailReady, true, h.state.detailError + ' ' + h.state.detailErrorCode);
        assert.ok(h.state.detail.statistics.length > 0, 'Positive native session statistics must be available');
        assert.ok(h.state.detail.statistics.every(row => typeof row.VALUE === 'string'));
        assert.equal(h.state.canKill, false); assert.equal(h.state.canCancel, false);
        const id = h.state.selectedId; await h.state.reload(); await h.waitFor(s => s.ready && s.detailReady && !s.loading && !s.detailLoading); assert.equal(h.state.selectedId, id);
        assert.equal(main.getMainTransactionState(), true);
        assert.equal((await read(observer, `SELECT * FROM ${name}`)).length, 0);
        await main.rollback(); assert.equal((await read(observer, `SELECT * FROM ${name}`)).length, 0);
        assert.ok(calls.includes('get-oracle-session-detail'));
      } finally { h.unmount(); await main.rollback(); }
    });
    if (db === 'oracle') await step('Inspect PDB access on a dedicated connection and reject local-user root management without touching PDBs or pending edits', async () => {
      const qualified = `${q(schema)}.${q(token + '_PdbPending')}`;
      await sql(`CREATE TABLE ${qualified} (id NUMBER)`); created.push({ type: 'TABLE', name: qualified });
      await sql(`INSERT INTO ${qualified} VALUES (744)`);
      const invoke = createDatabaseIpc(main, db);
      const access = await invoke('inspect-oracle-pdb-access');
      assert.equal(access.success, true, access.error); assert.equal(access.user, schema); assert.equal(access.common, false);
      assert.equal(Object.hasOwn(access, 'hasUncommittedTx'), false);
      const list = await invoke('list-oracle-pdbs');
      assert.equal(list.success, false); assert.equal(list.error, 'pdb_root_required');
      assert.equal(Object.hasOwn(list, 'hasUncommittedTx'), false);
      assert.equal(main.getMainTransactionState(), true);
      assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0);
      await main.rollback(); assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0);
    });
    if (db === 'oracle') await step('Read exact object privileges through background IPC without committing pending data, and reject stale or readonly changes', async () => {
      const name = token + "_Priv'Mix", target = { owner: schema, name, type: 'TABLE' };
      const qualified = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${qualified} (id NUMBER)`); created.push({ type: 'TABLE', name: qualified });
      await sql(`INSERT INTO ${qualified} VALUES (731)`);
      const invoke = createDatabaseIpc(main, db);
      const { createObjectPrivilegeHarness } = require('../helpers/objectPrivilegeData.cjs');
      const h = await createObjectPrivilegeHarness(invoke);
      try {
        await h.waitFor(s => s.principalsReady && !s.isLoading);
        h.state.select(target); await h.waitFor(s => !s.isLoading && (s.ready || s.error));
        assert.equal(h.state.ready, true, h.state.error + ' ' + h.state.errorCode); assert.equal(h.state.principalsReady, true, h.state.error);
        assert.equal(h.state.detail.object.name, name); assert.equal(h.state.detail.grants.length, 0);
        assert.equal(h.state.detail.canGrant.SELECT, true); assert.equal(h.state.editable(schema, 'SELECT'), false);
        assert.equal(main.getMainTransactionState(), true);
        assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0);
        const invalid = await invoke('mutate-oracle-object-privileges', { object: target, action: 'grant', grantee: schema, privilege: 'SELECT', expected: 'stale' });
        assert.equal(invalid.success, false); assert.equal(invalid.error, 'object_priv_conflict'); assert.equal(invalid.hasUncommittedTx, true);
        main.isReadonly = true;
        try {
          const denied = await invoke('mutate-oracle-object-privileges', { object: target, action: 'grant', grantee: schema, privilege: 'SELECT', expected: h.state.detail.fingerprint });
          assert.equal(denied.success, false); assert.equal(denied.error, 'object_priv_readonly');
        } finally { main.isReadonly = false; }
        assert.equal(main.getMainTransactionState(), true);
        await main.rollback(); assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0);
        const mviewName = token + "_PrivMV", mview = `${q(schema)}.${q(mviewName)}`;
        await sql(`CREATE MATERIALIZED VIEW ${mview} AS SELECT id FROM ${qualified}`); created.push({ type: 'MATERIALIZED VIEW', name: mview });
        const definition = await invoke('get-oracle-object-privileges', { owner: schema, name: mviewName, type: 'MATERIALIZED VIEW' });
        assert.equal(definition.success, true, definition.error); assert.deepEqual(Array.from(definition.detail.privileges), ['SELECT']);
      } finally { h.unmount(); await main.rollback(); }
    });
    if (db === 'oracle') await step('Manage only a disposable global directory definition, retain grants and verify main DDL commit and background read isolation', async () => {
      const name = token + "_Dir'Mix", path = "/__monabase_test__/owner's", target = q(name);
      const native = createDatabaseIpc(main, db), calls = [];
      const invoke = (channel, ...args) => { calls.push([channel, ...args]); return native(channel, ...args); };
      const h = await createDirectoryHarness(invoke);
      const pending = `${q(schema)}.${q(token + '_DirPending')}`;
      await sql(`CREATE TABLE ${pending} (id NUMBER)`); created.push({ type: 'TABLE', name: pending });
      created.push({ type: 'DIRECTORY', name: target });
      try {
        await h.waitFor(s => s.listReady && !s.isLoading);
        assert.equal(h.state.list.context.canCreate, true, 'The dedicated account needs CREATE ANY DIRECTORY.');
        assert.equal(h.state.list.context.canDrop, true, 'The dedicated account needs DROP ANY DIRECTORY.');
        await sql(`INSERT INTO ${pending} VALUES (987655)`);
        assert.equal(main.getMainTransactionState(), true);
        h.state.openCreate(); await h.flush(); h.state.setDialog(current => ({ ...current, name: target, path })); await h.flush();
        await h.state.submit(); await h.flush(); assert.equal(h.state.writeError, '');
        await h.waitFor(s => s.ready && !s.isLoading && s.selected === name);
        assert.equal(h.state.detail.directory.path, path); assert.equal(h.state.detail.directory.owner, 'SYS');
        assert.equal(main.getMainTransactionState(), false);
        assert.equal((await read(observer, `SELECT * FROM ${pending} WHERE id = 987655`)).length, 1);
        const before = h.state.detail, own = before.grants.filter(grant => grant.grantee === schema);
        assert.ok(own.some(grant => grant.privilege === 'READ')); assert.ok(own.some(grant => grant.privilege === 'WRITE')); assert.ok(own.some(grant => grant.privilege === 'EXECUTE'));
        await sql(`INSERT INTO ${pending} VALUES (987656)`);
        await h.state.reload(); await h.flush(); assert.equal(main.getMainTransactionState(), true);
        const noop = await main.mutateDirectoryDefinition({ action: 'grant', name, grantee: schema, privilege: 'READ', expected: h.state.detail.fingerprint });
        assert.equal(noop.applied, false); assert.equal(main.getMainTransactionState(), true);
        assert.equal((await read(observer, `SELECT * FROM ${pending} WHERE id = 987656`)).length, 0);
        h.state.openReplace(); await h.flush(); calls.length = 0; await h.state.submit(); assert.equal(calls.length, 0);
        await main.rollback();
        h.state.setDialog(current => ({ ...current, path: path + '/next' })); await h.flush(); await h.state.submit(); await h.flush(); assert.equal(h.state.writeError, '');
        assert.equal(h.state.detail.directory.objectId, before.directory.objectId); assert.deepEqual(Array.from(h.state.detail.grants, grant => [grant.grantee, grant.privilege, grant.grantable]), Array.from(before.grants, grant => [grant.grantee, grant.privilege, grant.grantable]));
        assert.ok(h.confirmations.some(message => message.includes(path) && message.includes(path + '/next')));
        const duplicate = await main.mutateDirectoryDefinition({ action: 'create', name, path: '/must-not-overwrite' }).then(() => null, error => require('../../electron/oracle/directoryDefinition').safeDirectoryError(error));
        assert.equal(duplicate.error, 'directory_exists');
        await sql(`CREATE OR REPLACE DIRECTORY ${target} AS '/__monabase_test__/external'`);
        h.state.openReplace(); await h.flush(); h.state.setDialog(current => ({ ...current, path: '/__monabase_test__/reviewed' })); await h.flush();
        await h.state.submit(); await h.flush(); assert.equal(h.state.writeError, 'directory_conflict'); assert.equal(h.state.canDrop, false);
        await h.state.reload(); await h.flush(); assert.equal(h.state.dialog.path, '/__monabase_test__/reviewed');
        await h.state.submit(); await h.flush(); assert.equal(h.state.writeError, ''); assert.equal(h.state.detail.directory.path, '/__monabase_test__/reviewed');
        assert.ok(calls.every(([channel]) => !['execute-sql', 'execute-sql-bg'].includes(channel)));
        await h.state.drop(); await h.flush(); assert.equal(h.state.writeError, ''); assert.equal(h.state.selected, null);
        created.splice(created.findIndex(object => object.type === 'DIRECTORY' && object.name === target), 1);
        await assert.rejects(main.getDirectoryDefinition(name), /directory_missing/);
      } finally { h.unmount(); }
    });
    await step('Alter a sequence in place, retain dependencies and exact limits, and restart explicitly', async () => {
      const name = db === 'oracle' ? `${token}_SEQ'MIX` : `${token}_seq'mix`.toLowerCase();
      const qualified = `${q(schema)}.${q(name)}`;
      const tableName = `${q(schema)}.${q(token + '_SeqRows')}`;
      const maximum = db === 'oracle' ? '9000000000000000000000000000' : '8000000000000000000';
      const start = '9007199254740993';
      const calls = [];
      const invoke = async (channel, query, binds) => {
        if (channel === 'get-db-info') return { success: true, info: await main.getDbVersion() };
        assert.ok(['execute-sql', 'execute-sql-bg'].includes(channel)); if (channel === 'execute-sql') calls.push(query);
        const result = await sql(query, binds, channel === 'execute-sql-bg');
        if (/^CREATE SEQUENCE/.test(query)) created.push({ type: 'SEQUENCE', name: qualified });
        return { success: true, ...result };
      };
      const fresh = await createSequenceHarness(db, invoke, { schema, sequenceName: '', isNew: true });
      try {
        fresh.state.setSeqName(name); fresh.state.setStartWith(start); fresh.state.setHasMaxValue(true); fresh.state.setMaxValue(maximum);
        fresh.state.setHasCache(false); await fresh.flush(); await fresh.state.handleSave();
        assert.equal(fresh.alerts.length, 1); assert.ok(created.some(object => object.type === 'SEQUENCE' && object.name === qualified));
      } finally { fresh.unmount(); }
      const nextValue = async client => String(value((await read(client, db === 'oracle' ? `SELECT ${qualified}.NEXTVAL AS value FROM DUAL` : `SELECT nextval('${qualified.replaceAll("'", "''")}') AS value`))[0]));
      assert.equal(await nextValue(main), start);
      await sql(`CREATE TABLE ${tableName} (id ${db === 'oracle' ? `NUMBER DEFAULT ${qualified}.NEXTVAL` : `bigint DEFAULT nextval('${qualified.replaceAll("'", "''")}')`})`);
      created.push({ type: 'TABLE', name: tableName });
      if (db === 'postgresql') await sql(`ALTER SEQUENCE ${qualified} OWNED BY ${tableName}.id`);
      const identitySql = db === 'oracle'
        ? `SELECT object_id AS value FROM ALL_OBJECTS WHERE owner = '${schema.replaceAll("'", "''")}' AND object_name = '${name.replaceAll("'", "''")}' AND object_type = 'SEQUENCE'`
        : `SELECT '${qualified.replaceAll("'", "''")}'::regclass::oid AS value`;
      const identity = String(value((await read(main, identitySql))[0]));
      const h = await createSequenceHarness(db, invoke, { schema, sequenceName: name });
      try {
        await h.waitFor(state => !state.isLoading);
        assert.deepEqual(h.alerts, []); assert.equal(h.state.maxValue, maximum); assert.equal(h.state.hasMaxValue, true);
        // A value issued after metadata loading must not be reused by a settings save.
        assert.equal(await nextValue(observer), '9007199254740994');
        h.state.setIsCycle(true); await h.flush(); calls.length = 0; await h.state.handleSave(); await h.flush();
        assert.ok(calls.some(query => /^ALTER SEQUENCE/.test(query))); assert.ok(!calls.some(query => /^DROP|^CREATE/.test(query)));
        assert.equal(String(value((await read(main, identitySql))[0])), identity);
        assert.equal(await nextValue(main), '9007199254740995');
        // Invalid on the database because the stored start/current value is above this limit.
        h.state.setMaxValue(db === 'oracle' ? '3' : '2'); await h.flush(); calls.length = 0; await h.state.handleSave(); await h.flush();
        assert.equal(calls.length, 1); assert.match(calls[0], /^ALTER SEQUENCE/);
        assert.equal(String(value((await read(main, identitySql))[0])), identity);
        assert.equal(await nextValue(main), '9007199254740996');
        await sql(db === 'oracle' ? `INSERT INTO ${tableName} (id) VALUES (DEFAULT)` : `INSERT INTO ${tableName} DEFAULT VALUES`);
        assert.equal(String((await read(main, `SELECT id AS value FROM ${tableName}`))[0][db === 'oracle' ? 'VALUE' : 'value']), '9007199254740997');
        await main.rollback();
        h.state.handleIncrementCurrentValue(); await h.flush();
        const restartAt = h.state.currentValue; calls.length = 0; await h.state.handleRestart(); await h.flush();
        assert.equal(calls.length, 1); assert.match(calls[0], /^ALTER SEQUENCE .* RESTART /);
        assert.equal(String(value((await read(main, identitySql))[0])), identity);
        assert.equal(await nextValue(main), restartAt);
      } finally {
        h.unmount();
        // Remove OWNED BY so cleanup can verify both deletions even after an assertion failure.
        if (db === 'postgresql') await sql(`ALTER SEQUENCE ${qualified} OWNED BY NONE`);
      }
    });
    await step('Review concurrent sequence changes, preserve pending work on no-op saves and reproduce typed sequence DDL without issuing numbers', async () => {
      const name = token + '_SeqReview', target = `${q(schema)}.${q(name)}`, records = `${q(schema)}.${q(token + '_SeqReviewRows')}`;
      await sql(`CREATE SEQUENCE ${target}${db === 'postgresql' ? ' AS integer' : ''} INCREMENT BY 10 START WITH 10 MINVALUE -1000 MAXVALUE 1000 CACHE 5`);
      created.push({ type: 'SEQUENCE', name: target }); await sql(`CREATE TABLE ${records}(ID INTEGER DEFAULT ${db === 'oracle' ? target + '.NEXTVAL' : `nextval('${target.replaceAll("'", "''")}')`})`); created.push({ type: 'TABLE', name: records });
      if (db === 'postgresql') await sql(`ALTER SEQUENCE ${target} OWNED BY ${records}.ID`);
      const dependentName = db === 'oracle' ? token + '_SeqReviewProc' : token + '_SeqReviewRows';
      if (db === 'oracle') {
        const procedure = `${q(schema)}.${q(dependentName)}`;
        await sql(`CREATE PROCEDURE ${procedure} AS n NUMBER; BEGIN SELECT ${target}.NEXTVAL INTO n FROM DUAL; END;`);
        created.push({ type: 'PROCEDURE', name: procedure });
      }
      const native = createDatabaseIpc(main, db), calls = [];
      const invoke = (channel, ...args) => { calls.push([channel, ...args]); return native(channel, ...args); };
      const h = await createSequenceHarness(db, invoke, { schema, sequenceName: name });
      const { sequenceModules } = require('../helpers/sequenceData.cjs'); const { metadata } = sequenceModules(invoke);
      let clone;
      try {
        const waitForMetadata = async () => {
          await h.waitFor(state => !state.isLoading && (state.metadataReady || state.loadError));
          assert.equal(h.state.loadError, '');
          assert.equal(h.state.metadataReady, true, 'Sequence metadata must be ready before reviewing a save');
        };
        await waitForMetadata();
        const source = await metadata.readSequenceSource(db, schema, name), usage = await metadata.readSequenceUsage(db, schema, name);
        if (db === 'postgresql') { assert.ok(source.includes('AS integer')); assert.equal(usage.owner.table, token + '_SeqReviewRows'); assert.ok(source.includes('OWNED BY')); }
        assert.ok(usage.dependents.some(item => item.includes(dependentName)));
        const nextValue = async () => Number(value((await read(main, db === 'oracle' ? `SELECT ${target}.NEXTVAL AS value FROM DUAL` : `SELECT nextval('${target.replaceAll("'", "''")}') AS value`))[0]));
        assert.equal(await nextValue(), 10, 'Metadata, dependency and source reads must never consume a sequence number');
        await sql(`INSERT INTO ${records}(ID) VALUES (7)`); assert.equal(main.getMainTransactionState(), true); calls.length = 0;
        await h.state.handleSave(); await h.flush(); assert.equal(calls.filter(call => call[0] === 'execute-sql').length, 0); assert.equal(main.getMainTransactionState(), true);
        assert.equal(Number(value((await read(observer, `SELECT COUNT(*) AS value FROM ${records}`))[0])), 0); await main.rollback();
        h.state.setCacheValue('30'); await h.flush(); h.update({ isActive: false }); await h.flush(); h.update({ isActive: true }); await waitForMetadata(); assert.equal(h.state.cacheValue, '30');
        await observer.execute(`ALTER SEQUENCE ${target} CACHE 40`); calls.length = 0; await h.state.handleSave(); await h.flush();
        assert.equal(h.state.isLoading, false);
        assert.ok(h.state.conflict, 'A completed save must report the concurrent sequence change');
        assert.ok(h.state.conflict.fields.includes('cache')); assert.equal(calls.filter(call => call[0] === 'execute-sql').length, 0);
        h.state.keepLocalChanges(); await h.flush(); await h.state.handleSave(); await h.flush();
        assert.equal((await metadata.readSequenceMetadata(db, schema, name)).settings.cache, '30');
        assert.ok(calls.filter(call => call[0] === 'execute-sql').every(call => /CACHE 30/.test(call[1]) && !/MINVALUE|MAXVALUE/.test(call[1])));
        h.state.setCacheValue('50'); await h.flush(); await observer.execute(`ALTER SEQUENCE ${target} CYCLE`); await h.state.handleSave(); await h.flush();
        assert.equal((await metadata.readSequenceMetadata(db, schema, name)).settings.cycle, true);
        h.state.setIncrementBy('-10'); await h.flush(); await h.state.handleSave(); await h.flush(); h.state.setCurrentValue('-100'); await h.flush(); await h.state.handleRestart(); await h.flush();
        assert.equal(await nextValue(), -100);
        const newest = await metadata.readSequenceSource(db, schema, name); clone = `${q(schema)}.${q(token + '_SeqClone')}`;
        const recreated = newest.split(target).join(clone);
        for (const statement of scripts.splitSqlScript(recreated, db)) {
          await sql(statement.text);
          if (!created.some(object => object.name === clone)) created.push({ type: 'SEQUENCE', name: clone });
        }
        const copy = await metadata.readSequenceMetadata(db, schema, token + '_SeqClone'), original = await metadata.readSequenceMetadata(db, schema, name);
        assert.deepEqual(JSON.parse(JSON.stringify(copy.settings)), JSON.parse(JSON.stringify(original.settings)));
      } finally {
        h.unmount();
        if (db === 'postgresql') {
          await sql(`ALTER SEQUENCE ${target} OWNED BY NONE`);
          if (clone && created.some(object => object.name === clone)) await sql(`ALTER SEQUENCE ${clone} OWNED BY NONE`);
        }
      }
    });
    await step('Recover type drafts, inspect actual type dependencies and validate type change outcomes', async () => {
      const name = token + "_Ty'Case", target = `${q(schema)}.${q(name)}`;
      const repository = await createGitRepository(t), calls = [], native = createDatabaseIpc(main, db);
      let failRead = false, failSecond = false, writes = 0;
      const invoke = async (channel, ...args) => {
        calls.push([channel, ...args]);
        if (channel.startsWith('git-')) return repository.invoke(channel, args[0]);
        if (failRead && channel === 'execute-sql-bg') return { success: false, error: 'Simulated type metadata failure' };
        if (failSecond && channel === 'execute-sql' && ++writes === 2) return native(channel, `ALTER TYPE ${target} ADD VALUE 'c' BEFORE 'MBT_missing_enum_value'`);
        return native(channel, ...args);
      };
      const valid = db === 'oracle' ? `CREATE OR REPLACE TYPE ${target} AS OBJECT ("Id Key" NUMBER, MEMBER FUNCTION F RETURN NUMBER);` : postgresTypeSource({ schema, objectName: name, kind: 'enum', labels: ['a'] });
      await sql(valid); created.push({ type: 'TYPE', name: target });
      if (db === 'oracle') await sql(`CREATE TYPE BODY ${target} AS MEMBER FUNCTION F RETURN NUMBER IS BEGIN RETURN 1; END; END;`);
      const h = await createTypeHarness(invoke, { schema, typeName: name }, { database: db, confirm: () => false });
      const { loadTypeInformation } = loadTypeScript('src/features/type/typeInformation.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } }, i18next: { t: key => key } });
      try {
        await h.waitFor(state => !state.isLoading); assert.equal(h.state.sourceReady, true);
        const saved = h.state.sourceText, draft = saved + '\n-- local edit';
        h.state.setSourceText(draft); await h.flush(); failRead = true; await h.state.loadObjectInfo(); await h.flush();
        assert.equal(h.state.sourceReady, false); assert.equal(h.state.sourceText, draft);
        const count = calls.length; await h.state.handleCompile(); assert.equal(calls.length, count);
        failRead = false; await h.state.loadObjectInfo(); await h.flush(); assert.equal(h.state.sourceText, draft);
        if (db === 'oracle') {
          for (const invalid of [valid.replace(q(name), q(token + '_OtherType')), valid + '\n/\nDROP TABLE test.invalid_target']) {
            h.state.setSourceText(invalid); await h.flush(); const count = calls.filter(call => call[0] === 'execute-sql').length;
            await h.state.handleCompile(); await h.flush(); assert.equal(calls.filter(call => call[0] === 'execute-sql').length, count);
          }
          h.state.setSourceText('-- editor comment\n\n' + valid.replace('RETURN NUMBER', 'RETURN MBT_MISSING_TYPE')); await h.flush();
          await h.state.handleCompile(); await h.flush(); assert.ok(h.state.compileErrors.some(error => error.line >= 3 && error.severity === 'error'));
          assert.equal(calls.filter(call => call[0] === 'git-commit').length, 0, 'Invalid TYPE must never be recorded as successful');
          h.state.setSourceText('-- editor comment\n\n' + valid); await h.flush(); await h.state.handleCompile(); await h.flush();
          assert.equal(h.state.compileErrors.filter(error => error.severity === 'error').length, 0);
          assert.equal(calls.filter(call => call[0] === 'git-commit').length, 1);
          await sql(`CREATE OR REPLACE TYPE BODY ${target} AS MEMBER FUNCTION F RETURN NUMBER IS BEGIN RETURN MBT_MISSING_CALL; END; END;`);
        } else {
          h.state.setSourceText(postgresTypeSource({ schema, objectName: name, kind: 'enum', labels: ['a', 'b', 'c'] })); await h.flush();
          await h.state.handleCompile(); await h.flush(); assert.equal(h.state.changePlan.statements.length, 2);
          assert.equal(calls.filter(call => call[0] === 'execute-sql').length, 0);
          failSecond = true; await h.state.handleConfirmCompile(); await h.flush();
          assert.equal(h.state.changePlan.completed, 1); assert.equal(h.state.changePlan.failed, true);
          assert.equal(calls.filter(call => call[0] === 'git-commit').length, 0);
          failSecond = false; await h.state.retryChangePlan(); await h.flush(); assert.equal(h.state.changePlan.statements.length, 1);
          await h.state.handleConfirmCompile(); await h.flush(); assert.equal(h.state.changePlan, null);
          assert.equal(calls.filter(call => call[0] === 'git-commit').length, 1);
        }
        const dependent = `${q(schema)}.${q(token + '_TypeRows')}`;
        await sql(`CREATE TABLE ${dependent}(PAYLOAD ${target})`); created.push({ type: 'TABLE', name: dependent });
        const info = await loadTypeInformation(db, schema, name);
        assert.ok(info.dependents.some(item => item.includes(token + '_TypeRows')));
        if (db === 'oracle') {
          assert.ok(info.attributes.some(item => item.name === 'Id Key')); assert.ok(info.methods.some(item => item.name === 'F'));
          assert.ok(info.body.source.includes('MBT_MISSING_CALL')); assert.ok(info.body.diagnostics.some(item => item.kind === 'TYPE BODY' && item.severity === 'error'));
          const collection = `${q(schema)}.${q(token + '_Collection')}`;
          await sql(`CREATE TYPE ${collection} AS VARRAY(10) OF NUMBER`); created.push({ type: 'TYPE', name: collection });
          assert.ok((await loadTypeInformation(db, schema, token + '_Collection')).kind.includes('NUMBER'));
        } else assert.deepEqual(Array.from(info.labels), ['a', 'b', 'c']);
        const history = await repository.invoke('git-get-history', { dbType: db === 'oracle' ? 'ORACLE' : 'POSTGRES', schema, objectType: 'TYPE', objectName: name });
        assert.equal(history.history.length, 1);
      } finally { h.unmount(); }
    });

    if (db === 'postgresql') await step('Save enum types without deleting dependent columns, data, views or functions', async () => {
      const name = token + '_Enum', qualified = `${q(schema)}.${q(name)}`;
      const records = `${q(schema)}.${q(token + '_EnumRows')}`, view = `${q(schema)}.${q(token + '_EnumView')}`, fn = `${q(schema)}.${q(token + '_EnumFn')}`;
      const original = { schema, objectName: name, kind: 'enum', labels: ["can't", 'semi;colon', 'done'] };
      await sql(postgresTypeSource(original)); created.push({ type: 'TYPE', name: qualified });
      await sql(`CREATE TABLE ${records} (id integer, label ${qualified})`); created.push({ type: 'TABLE', name: records });
      await sql(`INSERT INTO ${records} VALUES (1, 'can''t'), (2, 'semi;colon')`); await main.commit();
      await sql(`CREATE VIEW ${view} AS SELECT label FROM ${records}`); created.push({ type: 'VIEW', name: view });
      await sql(`CREATE FUNCTION ${fn}() RETURNS ${qualified} LANGUAGE SQL AS $$ SELECT 'done'::${qualified} $$`); created.push({ type: 'FUNCTION', name: `${fn}()` });
      const repository = await createGitRepository(t), calls = [];
      const invoke = async (channel, ...args) => {
        if (channel.startsWith('git-')) return repository.invoke(channel, args[0]);
        assert.ok(['execute-sql', 'execute-sql-bg'].includes(channel));
        if (channel === 'execute-sql') calls.push(args[0]);
        return { success: true, ...await sql(args[0], args[1], channel === 'execute-sql-bg') };
      };
      const h = await createTypeHarness(invoke, { schema, typeName: name }, { confirm: message => !message.startsWith('database_updated_but_git_failed_retry') });
      const identitySql = `SELECT '${qualified.replaceAll("'", "''")}'::regtype::oid AS value`;
      const identity = String(value((await read(main, identitySql))[0]));
      const verifyData = async () => {
        assert.deepEqual(Array.from(await read(main, `SELECT label::text AS value FROM ${records} ORDER BY id`), value), ["can't", 'semi;colon']);
        assert.equal((await read(main, `SELECT * FROM ${view}`)).length, 2);
        assert.equal(value((await read(main, `SELECT ${fn}()::text AS value`))[0]), 'done');
        assert.equal(String(value((await read(main, identitySql))[0])), identity);
      };
      try {
        await h.waitFor(state => !state.isLoading);
        assert.match(h.state.sourceText, /can''t/); assert.match(h.state.sourceText, /semi;colon/);
        await h.state.handleCompile(); await h.flush(); if (h.state.changePlan && !h.state.changePlan.failed) { await h.state.handleConfirmCompile(); await h.flush(); }
        assert.equal(calls.length, 0); assert.deepEqual(h.alerts, ['save_compile_successful']); await verifyData();
        const desired = { ...original, labels: ['first', ...original.labels, 'new'] };
        h.state.setSourceText(postgresTypeSource(desired)); await h.flush(); calls.length = 0;
        await h.state.handleCompile(); await h.flush(); if (h.state.changePlan && !h.state.changePlan.failed) { await h.state.handleConfirmCompile(); await h.flush(); }
        assert.equal(calls.length, 2); assert.ok(calls.every(query => /^ALTER TYPE .* ADD VALUE/.test(query)));
        await verifyData();
        const target = { dbType: 'POSTGRES', schema, objectType: 'TYPE', objectName: name };
        const history = await repository.invoke('git-get-history', target); assert.equal(history.history.length, 2);
        const saved = await repository.invoke('git-get-file-content', { ...target, commitId: history.history[0].fullId });
        assert.equal(saved.content, h.state.sourceText); assert.match(saved.content, /'first'/); assert.match(saved.content, /'new'/);
        h.state.setSourceText(postgresTypeSource({ ...desired, labels: ['first', "can't", 'done', 'new'] })); await h.flush(); calls.length = 0;
        await h.state.handleCompile(); await h.flush(); if (h.state.changePlan && !h.state.changePlan.failed) { await h.state.handleConfirmCompile(); await h.flush(); } assert.equal(calls.length, 0);
        assert.match(h.alerts.at(-1), /postgres_type_save_failed/); await verifyData();
        calls.length = 0; await h.state.handleDelete(); await h.flush();
        assert.equal(calls.length, 1); assert.match(calls[0], / RESTRICT$/); await verifyData();
      } finally { h.unmount(); }
    });
    if (db === 'postgresql') await step('Append composite attributes atomically while preserving dependent composite values', async () => {
      const name = token + '_Composite', qualified = `${q(schema)}.${q(name)}`, table = `${q(schema)}.${q(token + '_CompRows')}`;
      const original = { schema, objectName: name, kind: 'composite', attributes: [{ name: 'Code "Id', typeSql: 'integer' }, { name: 'amount', typeSql: 'numeric(10,2)' }] };
      await sql(postgresTypeSource(original)); created.push({ type: 'TYPE', name: qualified });
      await sql(`CREATE TABLE ${table} (payload ${qualified})`); created.push({ type: 'TABLE', name: table });
      await sql(`INSERT INTO ${table} VALUES (ROW(7, 12.34)::${qualified})`); await main.commit();
      const repository = await createGitRepository(t), calls = [], nativeType = createDatabaseIpc(main, db);
      const invoke = async (channel, ...args) => {
        if (channel.startsWith('git-')) return repository.invoke(channel, args[0]);
        if (channel === 'execute-sql') calls.push(args[0]);
        return nativeType(channel, ...args);
      };
      const h = await createTypeHarness(invoke, { schema, typeName: name }, { confirm: () => false });
      try {
        await h.waitFor(state => !state.isLoading);
        const desired = { ...original, attributes: [...original.attributes, { name: 'Note; "Text', typeSql: 'text' }] };
        h.state.setSourceText(postgresTypeSource(desired)); await h.flush(); calls.length = 0; await h.state.handleCompile(); await h.flush(); if (h.state.changePlan && !h.state.changePlan.failed) { await h.state.handleConfirmCompile(); await h.flush(); }
        assert.equal(calls.length, 1); assert.match(calls[0], /ADD ATTRIBUTE "Note; ""Text" text RESTRICT/);
        assert.deepEqual(h.alerts, ['save_compile_successful']);
        const row = (await read(main, `SELECT (payload)."Code ""Id" AS code, (payload).amount AS amount, (payload)."Note; ""Text" AS note FROM ${table}`))[0];
        assert.equal(String(row.code), '7'); assert.equal(row.amount, '12.34'); assert.equal(row.note, null);
        const { loadTypeInformation } = loadTypeScript('src/features/type/typeInformation.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } }, i18next: { t: key => key } });
        const information = await loadTypeInformation(db, schema, name);
        assert.ok(information.attributes.some(item => item.name === 'Note; "Text'));
        assert.equal(information.kind, 'composite');
        const invalid = { ...desired, attributes: [...desired.attributes, { name: 'must not remain', typeSql: 'integer' }, { name: 'bad', typeSql: 'mb_missing_datatype' }] };
        h.state.setSourceText(postgresTypeSource(invalid)); await h.flush(); calls.length = 0; await h.state.handleCompile(); await h.flush(); if (h.state.changePlan && !h.state.changePlan.failed) { await h.state.handleConfirmCompile(); await h.flush(); }
        assert.equal(calls.length, 1); assert.ok(!/DROP|CASCADE/.test(calls[0]));
        assert.ok(h.state.compileErrors.some(error => error.line === postgresTypeSource(invalid).slice(0, postgresTypeSource(invalid).indexOf('mb_missing_datatype')).split('\n').length));
        const check = loadTypeScript('src/features/postgresql/typeDefinition.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } } });
        const actual = await check.readPostgresType(schema, name);
        assert.deepEqual(Array.from(actual.attributes, attribute => attribute.name), desired.attributes.map(attribute => attribute.name));
        assert.equal((await read(main, `SELECT * FROM ${table}`)).length, 1);
        const listedTypes = await readSidebarTypes(schema, token, createDatabaseIpc(main, db));
        assert.ok(listedTypes.includes(token + '_Enum'));
        assert.ok(listedTypes.includes(name));
        assert.equal(listedTypes.includes(token + '_CompRows'), false);
        assert.equal(listedTypes.includes(token + '_EnumRows'), false);
      } finally { h.unmount(); }
    });
    await step('Load exact ER identifiers, composite foreign keys, and independent same-named constraints', async () => {
      const parentName = `${token}_Parent`, childName = `${token}_Child`;
      const parent = `${q(schema)}.${q(parentName)}`, child = `${q(schema)}.${q(childName)}`;
      const number = db === 'oracle' ? 'NUMBER' : 'integer';
      await sql(`CREATE TABLE ${parent} ("id" ${number}, "ID" ${number}, PRIMARY KEY ("id", "ID"))`);
      created.push({ type: 'TABLE', name: parent });
      await sql(`CREATE TABLE ${child} ("ref" ${number}, "REF" ${number}, CONSTRAINT ${q(token + '_FK')} FOREIGN KEY ("ref", "REF") REFERENCES ${parent}("id", "ID"))`);
      created.push({ type: 'TABLE', name: child });
      await main.commit();
      const { fetchErMetadata } = loadTypeScript('src/features/er/erMetadata.ts', {
        '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, query, binds) => {
          assert.equal(channel, 'execute-sql-bg');
          return { success: true, ...await sql(query, binds, true) };
        } } }
      });
      const viewName = token + '_ER_View', view = `${q(schema)}.${q(viewName)}`;
      await sql(`CREATE VIEW ${view} AS SELECT "id", "ID" FROM ${parent}`);
      created.push({ type: 'VIEW', name: view });
      const { listObjects } = loadTypeScript('src/features/objects/objectRepository.ts', {
        '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, query, binds) => {
          assert.equal(channel, 'execute-sql-bg'); return { success: true, ...await sql(query, binds, true) };
        } } }
      });
      const objects = await listObjects({ dbType: db, schema, category: 'VIEW', searchText: viewName, offset: 0 });
      assert.ok(objects.some(object => object.name === viewName && object.category === 'VIEW'));
      const viewMetadata = await fetchErMetadata(db === 'postgresql', schema, viewName, true);
      assert.deepEqual(Array.from(viewMetadata.columns.filter(row => row.TABLE_NAME === viewName), row => row.COLUMN_NAME), ['id', 'ID']);
      const metadata = await fetchErMetadata(db === 'postgresql', schema, childName, false);
      assert.deepEqual(Array.from(metadata.columns.filter(row => row.TABLE_NAME === parentName), row => row.COLUMN_NAME), ['id', 'ID']);
      const links = metadata.foreignKeys.filter(row => row.CHILD_TABLE === childName);
      assert.equal(links.length, 2, 'Composite keys must not form a Cartesian product');
      assert.deepEqual(Array.from(links, row => [row.CHILD_COLUMN, row.PARENT_COLUMN]).sort(), [['REF', 'ID'], ['ref', 'id']]);
      assert.ok(links.every(row => row.PARENT_SCHEMA === schema && row.CHILD_SCHEMA === schema));
      if (db === 'postgresql') {
        // PostgreSQL permits equal foreign-key names on different tables.
        const secondName = `${token}_Other`, second = `${q(schema)}.${q(secondName)}`;
        await sql(`CREATE TABLE ${second} ("other" integer, "OTHER" integer, CONSTRAINT ${q(token + '_FK')} FOREIGN KEY ("other", "OTHER") REFERENCES ${parent}("id", "ID"))`);
        created.push({ type: 'TABLE', name: second });
        await main.commit();
        const result = await fetchErMetadata(true, schema, parentName, false);
        assert.deepEqual(Array.from(result.foreignKeys.filter(row => row.CHILD_TABLE === childName), row => row.CHILD_COLUMN).sort(), ['REF', 'ref']);
        assert.deepEqual(Array.from(result.foreignKeys.filter(row => row.CHILD_TABLE === secondName), row => row.CHILD_COLUMN).sort(), ['OTHER', 'other']);
      }
    });
    await step('Create, display and drop ordered foreign keys with exact quoted object names', async () => {
      const parentName = `${token}_Parent'sMix`, childName = `${token}_ChildMix`;
      const parent = `${q(schema)}.${q(parentName)}`, child = `${q(schema)}.${q(childName)}`;
      const constraint = token + (db === 'oracle' ? '_Mixed FK' : '_FK "mix');
      const number = db === 'oracle' ? 'NUMBER' : 'integer';
      await sql(`CREATE TABLE ${parent} ("Ref Id" ${number}, "Other Ref" ${number}, UNIQUE ("Other Ref", "Ref Id"))`);
      created.push({ type: 'TABLE', name: parent });
      await sql(`CREATE TABLE ${child} ("Key Value" ${number}, "Other Key" ${number})`);
      created.push({ type: 'TABLE', name: child });
      await main.commit();
      const invoke = async (channel, query, binds) => {
        assert.ok(['execute-sql', 'execute-sql-bg'].includes(channel));
        return { success: true, ...await sql(query, binds, channel === 'execute-sql-bg') };
      };
      const edit = await createRelationHarness(db, invoke, { schema, tableName: childName, isActive: false });
      try {
        await edit.state.handleOpenAddDialog(); await edit.flush();
        assert.ok(edit.state.allTables.includes(parentName));
        assert.deepEqual(Array.from(edit.state.currentTableCols), ['Key Value', 'Other Key']);
        await edit.state.handleTargetTableChange(parentName); await edit.flush();
        assert.deepEqual(Array.from(edit.state.targetTableCols), ['Ref Id', 'Other Ref']);
        edit.state.setFkName(constraint); edit.state.setSourceColumns(['Key Value', 'Other Key']);
        edit.state.setTargetColumns(['Other Ref', 'Ref Id']); edit.state.setDeleteRule('CASCADE'); await edit.flush();
        await edit.state.submitRelation(); await edit.flush();
        assert.ok(edit.alerts.includes('relation_foreign_key_added'));
        if (db === 'postgresql') {
          const other = `${q(schema)}.${q(token + '_OtherFK')}`;
          await sql(`CREATE TABLE ${other} (u integer, v integer, CONSTRAINT ${q(constraint)} FOREIGN KEY (u, v) REFERENCES ${parent} ("Other Ref", "Ref Id"))`);
          created.push({ type: 'TABLE', name: other });
          await main.commit();
        }
        const list = await createRelationHarness(db, invoke, { schema, tableName: childName });
        try {
          await list.waitFor(state => !state.isLoading);
          assert.deepEqual(list.alerts, []); assert.equal(list.state.relationsRows.length, 1);
          const row = list.state.relationsRows[0];
          assert.equal(row.CONSTRAINT_NAME, constraint); assert.equal(row.TARGET_TABLE, parentName);
          assert.deepEqual(Array.from(row.SOURCE_COLS), ['Key Value', 'Other Key']);
          assert.deepEqual(Array.from(row.TARGET_COLS), ['Other Ref', 'Ref Id']); assert.equal(row.DELETE_RULE, 'CASCADE');
        } finally { list.unmount(); }
        await edit.state.handleDropRelation(constraint); await edit.flush();
        assert.ok(edit.alerts.includes('foreign_key_dropped'));
        const dropped = await createRelationHarness(db, invoke, { schema, tableName: childName });
        try {
          await dropped.waitFor(state => !state.isLoading);
          assert.deepEqual(dropped.alerts, []); assert.equal(dropped.state.relationsRows.length, 0);
        } finally { dropped.unmount(); }
      } finally { edit.unmount(); }
    });
    if (db === 'postgresql') await step('Preserve SHOW, EXPLAIN and DML RETURNING results with independent affected counts', async () => {
      const name = `${token}_Returning`, qualified = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${qualified} (id numeric(38,0) PRIMARY KEY, amount numeric)`);
      created.push({ type: 'TABLE', name: qualified });
      const shown = await sql('SHOW server_version');
      assert.equal(shown.command, 'SHOW'); assert.ok(shown.rows[0].server_version); assert.equal(shown.metaData[0].name, 'server_version');
      assert.equal(shown.rowsAffected, 0);
      const explained = await sql('EXPLAIN SELECT 1');
      assert.equal(explained.command, 'EXPLAIN'); assert.ok(explained.rows[0]['QUERY PLAN']); assert.equal(explained.metaData[0].name, 'QUERY PLAN');
      assert.equal(explained.rowsAffected, 0);
      const id = '9007199254740993';
      const inserted = await sql(`INSERT INTO ${qualified} (id, amount) VALUES (:id, 1) RETURNING id, amount`, { id });
      assert.equal(inserted.command, 'INSERT'); assert.equal(inserted.rowsAffected, 1); assert.equal(inserted.rows[0].id, id);
      assert.deepEqual(Array.from(inserted.metaData, column => column.name), ['id', 'amount']);
      const updated = await sql(`WITH selected AS (SELECT :id::numeric AS id) UPDATE ${qualified} target SET amount = 2 FROM selected WHERE target.id = selected.id RETURNING target.id, target.amount`, { id });
      assert.equal(updated.command, 'UPDATE'); assert.equal(updated.rowsAffected, 1); assert.equal(updated.rows[0].id, id);
      const empty = await sql(`UPDATE ${qualified} SET amount = 3 WHERE false RETURNING id`);
      assert.equal(empty.rowsAffected, 0); assert.equal(empty.rows.length, 0); assert.equal(empty.metaData[0].name, 'id');
      assert.equal(main.getMainTransactionState(), true);
      assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0, 'RETURNING must not commit changes');
      const deleted = await sql(`DELETE FROM ${qualified} RETURNING id`);
      assert.equal(deleted.command, 'DELETE'); assert.equal(deleted.rowsAffected, 1); assert.equal(deleted.rows[0].id, id);
      assert.equal(main.getMainTransactionState(), true);
      await main.rollback();
    });
    await step('Preserve exact large integers, decimals, Unicode, and bound literals', async () => {
      const big = '9007199254740993', decimal = '0.1234567890123456789012345';
      await sql(`INSERT INTO ${table} (id, amount, label) VALUES (:id, :amount, :label)`, { id: big, amount: decimal, label: "日本語 ' :bind;" });
      const row = (await read(main, `SELECT id AS value, amount, label FROM ${table}`))[0];
      assert.equal(value(row), big);
      assert.equal(String(row[db === 'oracle' ? 'AMOUNT' : 'amount']).replace(/^\./, '0.'), decimal);
      assert.equal(row[db === 'oracle' ? 'LABEL' : 'label'], "日本語 ' :bind;");
      assert.equal((await read(observer, `SELECT * FROM ${table}`)).length, 0);
      await main.commit();
      assert.equal((await read(observer, `SELECT * FROM ${table}`)).length, 1);
    });
    await step('Roll back an update without changing committed data', async () => {
      await sql(`UPDATE ${table} SET label = :label`, { label: 'pending' });
      assert.equal(main.getMainTransactionState(), true);
      assert.equal(value((await read(main, `SELECT label AS value FROM ${table}`))[0]), 'pending');
      assert.equal(value((await read(observer, `SELECT label AS value FROM ${table}`))[0]), "日本語 ' :bind;");
      await main.rollback();
      assert.equal(value((await read(main, `SELECT label AS value FROM ${table}`))[0]), "日本語 ' :bind;");
    });
    await step('A failed statement preserves earlier edits and permits subsequent statements', async () => {
      await sql(`UPDATE ${table} SET label = :label`, { label: 'kept after error' });
      await assert.rejects(sql(`INSERT INTO ${table} (id) VALUES (:id)`, { id: '9007199254740993' }));
      assert.equal(main.getMainTransactionState(), true);
      assert.equal(value((await read(main, `SELECT label AS value FROM ${table}`))[0]), 'kept after error');
      await sql(`UPDATE ${table} SET amount = :amount`, { amount: '42' });
      await main.commit();
      assert.equal(value((await read(observer, `SELECT label AS value FROM ${table}`))[0]), 'kept after error');
    });
    await step('Background metadata does not commit or cancel pending main edits', async () => {
      await sql(`UPDATE ${table} SET label = :label`, { label: 'main pending' });
      await sql(db === 'oracle' ? 'SELECT OBJECT_NAME FROM USER_OBJECTS' : 'SELECT tablename FROM pg_tables', {}, true);
      assert.equal(main.getMainTransactionState(), true);
      assert.equal(value((await read(observer, `SELECT label AS value FROM ${table}`))[0]), 'kept after error');
      await main.rollback();
    });
    await step('DDL commits earlier DML consistently with the application policy', async () => {
      await sql(`UPDATE ${table} SET label = :label`, { label: 'committed by DDL' });
      const view = qualifiedObjectName({ schema, objectName: `${token}.View` });
      await sql(`CREATE VIEW ${view} AS SELECT * FROM ${table}`);
      created.push({ type: 'VIEW', name: view });
      assert.equal(value((await read(observer, `SELECT label AS value FROM ${table}`))[0]), 'committed by DDL');
      assert.equal((await read(main, `SELECT * FROM ${view}`)).length, 1);
    });
    await step('Create, execute, and retrieve source for a stored function', async () => {
      const name = `${token}_FN`, qualified = `${q(schema)}.${q(name)}`;
      await sql(db === 'oracle' ? `CREATE FUNCTION ${qualified} RETURN NUMBER AS BEGIN RETURN 42; END;` :
        `CREATE FUNCTION ${qualified}() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RETURN 42; END; $$`);
      created.push({ type: 'FUNCTION', name: db === 'oracle' ? qualified : `${qualified}()` });
      assert.equal(Number(value((await read(main, `SELECT ${qualified}() AS value${db === 'oracle' ? ' FROM DUAL' : ''}`))[0])), 42);
      const executed = await main.executeStored({ schema, objectName: name, objectType: 'FUNCTION', args: {}, signature: '' });
      assert.notEqual(executed.success, false, 'Stored-function execution failed');
      assert.equal(Number(executed.returnValues[0].value), 42);
      const source = await sql(db === 'oracle' ? 'SELECT TEXT FROM USER_SOURCE WHERE NAME = :name ORDER BY LINE' :
        'SELECT p.prosrc AS source FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=:schema AND p.proname=:name', db === 'oracle' ? { name } : { schema, name }, true);
      assert.ok(source.rows.some(row => String(row.TEXT || row.source).includes('RETURN 42')));
      const definition = await sql(db === 'oracle' ? "SELECT DBMS_METADATA.GET_DDL('FUNCTION', :name, :owner) AS source FROM DUAL" :
        'SELECT pg_get_functiondef(to_regprocedure(:routine)) AS source', db === 'oracle' ? { name, owner: schema } : { routine: `${qualified}()` }, true);
      const originalSource = definition.rows[0][db === 'oracle' ? 'SOURCE' : 'source'];
      const repository = await createGitRepository(t);
      const target = { dbType: db === 'oracle' ? 'ORACLE' : 'POSTGRESQL', schema, objectType: 'FUNCTION', objectName: name,
        ...(db === 'oracle' ? {} : { signature: '' }) };
      assert.equal((await repository.invoke('git-commit', { ...target, sourceText: originalSource, message: 'Store original database function' })).success, true);
      await sql(originalSource.replace('RETURN 42', 'RETURN 43'));
      const updated = await sql(db === 'oracle' ? "SELECT DBMS_METADATA.GET_DDL('FUNCTION', :name, :owner) AS source FROM DUAL" :
        'SELECT pg_get_functiondef(to_regprocedure(:routine)) AS source', db === 'oracle' ? { name, owner: schema } : { routine: `${qualified}()` }, true);
      const updatedSource = updated.rows[0][db === 'oracle' ? 'SOURCE' : 'source'];
      assert.match(updatedSource, /RETURN 43/);
      assert.equal((await repository.invoke('git-commit', { ...target, sourceText: updatedSource, message: 'Store changed database function' })).success, true);
      const history = await repository.invoke('git-get-history', target);
      assert.equal(history.history.length, 2);
      const old = await repository.invoke('git-get-file-content', { ...target, commitId: history.history[1].fullId });
      assert.equal(old.content, originalSource);
      const difference = await repository.git.raw(['diff', history.history[1].fullId, history.history[0].fullId]);
      assert.match(difference, /RETURN 42/); assert.match(difference, /RETURN 43/);
    });
    if (db === 'oracle') await step('Preserve NUMBER input and IN/OUT precision through real stored execution', async () => {
      const name = `${token}_ECHO`, qualified = `${q(schema)}.${q(name)}`;
      await sql(`CREATE PROCEDURE ${qualified}(input_value IN NUMBER, output_value OUT NUMBER, io_value IN OUT NUMBER) AS BEGIN output_value := input_value; END;`);
      created.push({ type: 'PROCEDURE', name: qualified });
      for (const input of ['9007199254740993', '0.1234567890123456789012345', '0']) {
        const result = await main.executeStored({ schema, objectName: name, objectType: 'PROCEDURE',
          args: { INPUT_VALUE: input, OUTPUT_VALUE: '', IO_VALUE: input },
          argTypes: { INPUT_VALUE: 'NUMBER', OUTPUT_VALUE: 'NUMBER', IO_VALUE: 'NUMBER' },
          argDirections: { INPUT_VALUE: 'IN', OUTPUT_VALUE: 'OUT', IO_VALUE: 'IN/OUT' } });
        assert.equal(result.success, true, 'Stored execution must preserve string numeric binds');
        for (const returned of result.returnValues) assert.equal(String(returned.value).replace(/^\./, '0.'), input);
      }
    });
    await step('Execute routine argument modes, compile on the main connection and inspect exact routine information', async () => {
      const name = token + "_Routine'Case", target = `${q(schema)}.${q(name)}`, parameter = db === 'oracle' ? 'P' : 'p';
      const body = db === 'oracle'
        ? `CREATE OR REPLACE FUNCTION ${target}(P IN VARCHAR2 DEFAULT 'fallback') RETURN VARCHAR2 AS\nBEGIN\nRETURN COALESCE(P, '<NULL>');\nEND;`
        : `CREATE OR REPLACE FUNCTION ${target}(p text DEFAULT 'fallback') RETURNS text LANGUAGE plpgsql AS $body$\nBEGIN\nRETURN COALESCE(p, '<NULL>');\nEND;\n$body$;`;
      await sql(body); created.push({ type: 'FUNCTION', name: target + (db === 'postgresql' ? '(text)' : '') });
      const native = createDatabaseIpc(main, db);
      const invoke = (channel, ...args) => ['git-commit', 'git-delete-object', 'delete-trace-db', 'get-trace-data'].includes(channel)
        ? Promise.resolve({ success: true }) : native(channel, ...args);
      const h = createStoredHarness(invoke, { database: db, schema, objectName: name, objectType: 'FUNCTION', signature: db === 'postgresql' ? 'text' : undefined });
      try {
        await h.render().loadObjectInfo(); await h.flush(); assert.equal(h.render().metadataReady, true);
        assert.equal(h.render().argumentsList.find(arg => arg.ARGUMENT_NAME === parameter).DEFAULTED, 'Y');
        for (const [mode, value, expected] of [['default', '', 'fallback'], ['null', '', '<NULL>'], ['value', '', '<NULL>'], ['value', '  ', '  '], ['value', '日本語', '日本語']]) {
          h.render().setArgumentModes({ [parameter]: mode }); h.render().setArgValues({ [parameter]: value }); await h.flush();
          let success; await h.render().handleExecute(ok => { success = ok; }); await h.flush();
          assert.equal(success, true); assert.equal(h.render().returnValues[0].value, expected); await main.rollback();
        }
        const dependency = token + '_RoutineView';
        await sql(`CREATE VIEW ${q(schema)}.${q(dependency)} AS SELECT ${target}('info') AS "VALUE"${db === 'oracle' ? ' FROM DUAL' : ''}`); created.push({ type: 'VIEW', name: `${q(schema)}.${q(dependency)}` });
        const { loadRoutineInformation } = loadTypeScript('src/features/stored/routineMetadata.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } } });
        const info = await loadRoutineInformation(db, schema, name, 'FUNCTION', db === 'postgresql' ? 'text' : undefined);
        assert.ok(info.dependents.some(item => item.schema === schema && item.name === dependency));
        assert.ok(info.result); assert.ok(info.language); assert.ok(info.security);
        const pendingName = token + '_RoutinePending', pendingTable = `${q(schema)}.${q(pendingName)}`;
        await sql(`CREATE TABLE ${pendingTable}(id INTEGER)`); created.push({ type: 'TABLE', name: pendingTable });
        await sql(`INSERT INTO ${pendingTable} VALUES (1)`); assert.equal(main.getMainTransactionState(), true);
        h.render().setSourceText(body.replace("COALESCE(P, '<NULL>')", "'compiled'").replace("COALESCE(p, '<NULL>')", "'compiled'")); await h.flush();
        await h.render().handleCompile(() => {}); await h.flush(); assert.equal(h.render().compileErrors.length, 0);
        assert.equal(main.getMainTransactionState(), false);
        assert.equal(Number(value((await read(observer, `SELECT COUNT(*) AS value FROM ${pendingTable}`))[0])), 1, 'DDL must follow the application main-connection commit policy');
        h.render().setSourceText('-- editor note\n\n' + body.replace(/RETURN COALESCE\([Pp], '<NULL>'\);/, 'missing_routine_variable := 1;')); await h.flush();
        await h.render().handleCompile(() => {}); await h.flush();
        assert.ok(h.render().compileErrors.some(error => error.line === 5), 'Native compiler diagnostics must map to the original editor line');
        if (db === 'oracle') assert.equal(h.render().objectValid, false);
        h.render().setSourceText(body); await h.flush(); await h.render().handleCompile(() => {}); await h.flush();
        assert.equal(h.render().compileErrors.length, 0); assert.equal(h.render().objectValid, true);
        if (db === 'postgresql') {
          await sql(`CREATE FUNCTION ${target}(p integer) RETURNS text LANGUAGE sql AS 'SELECT p::text'`);
          created.push({ type: 'FUNCTION', name: target + '(integer)' });
          h.render().setArgumentModes({ [parameter]: 'default' }); await h.flush();
          let success; await h.render().handleExecute(ok => { success = ok; }); await h.flush();
          assert.equal(success, false, 'Omitted defaults must not call an ambiguous overload');
          h.render().setArgumentModes({ [parameter]: 'value' }); h.render().setArgValues({ [parameter]: 'selected text overload' }); await h.flush();
          await h.render().handleExecute(ok => { success = ok; }); await h.flush();
          assert.equal(success, true); assert.equal(h.render().returnValues[0].value, 'selected text overload'); await main.rollback();
        }
      } finally { h.dispose(); }
      if (db === 'oracle') {
        const quoted = token + '_QuotedArg';
        await sql(`CREATE PROCEDURE ${q(schema)}.${q(quoted)}("Input Value" IN VARCHAR2, "Output Value" OUT VARCHAR2) AS BEGIN "Output Value" := "Input Value"; END;`);
        created.push({ type: 'PROCEDURE', name: `${q(schema)}.${q(quoted)}` });
        const result = await main.executeStored({ schema, objectName: quoted, objectType: 'PROCEDURE', args: { 'Input Value': 'quoted argument', 'Output Value': '' },
          argTypes: { 'Input Value': 'VARCHAR2', 'Output Value': 'VARCHAR2' }, argDirections: { 'Input Value': 'IN', 'Output Value': 'OUT' } });
        assert.equal(result.success, true); assert.equal(result.returnValues[0].name, 'Output Value'); assert.equal(result.returnValues[0].value, 'quoted argument');
      }
    });

    await step('Search and edit quoted columns using real query builders and record editors', async () => {
      const name = `${token}.Columns`, qualified = `${q(schema)}.${q(name)}`;
      const id = db === 'oracle' ? 'Id Key' : 'I"D', label = db === 'oracle' ? 'Order Name' : 'N"AME', binary = db === 'oracle' ? 'Binary Data' : 'B"IN';
      const structureDefs = [
        { COLUMN_NAME: id, DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'bigint', PK_POSITION: 1 },
        { COLUMN_NAME: label, DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text' },
        { COLUMN_NAME: binary, DATA_TYPE: db === 'oracle' ? 'BLOB' : 'bytea' }
      ];
      await sql(`CREATE TABLE ${qualified} (${q(id)} ${db === 'oracle' ? 'NUMBER' : 'bigint'} PRIMARY KEY, ${q(label)} ${db === 'oracle' ? 'VARCHAR2(100)' : 'text'}, ${q(binary)} ${db === 'oracle' ? 'BLOB' : 'bytea'})`);
      created.push({ type: 'TABLE', name: qualified });
      const builder = loadTypeScript(`src/features/${db}/windows/table/tableQueryBuilder.ts`).createTableQueryBuilder({
        schema, inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD', structureDefs
      });
      let operationFailed = false;
      const { createTableRecordEditor } = loadTypeScript(`src/features/${db}/windows/table/tableRecordEditor.ts`, {
        '@/shared/api/desktop': { ipcRenderer: { invoke: async (_channel, query, binds) => {
          try { return { success: true, ...await sql(query, binds) }; }
          catch { operationFailed = true; return { success: false, error: 'Test record operation failed' }; }
        } } }
      }, { alert() {}, window: { confirm: () => true } });
      const context = { schema, tableName: name, structureDefs, inputDateFormat: 'YYYY-MM-DD', hasLobColumns: true, isTransposed: false,
        recordSaving: { current: false }, recordDialog: { isOpen: true, mode: 'insert', recordData: { [id]: '1', [label]: 'inserted', [binary]: { isBlob: true, data: Buffer.from([1, 2, 3]) } }, initialRecordData: {}, targetRowId: '' },
        conditions: {}, paginationModel: { page: 0, pageSize: 50 }, t: key => key,
        formatSqlValue: builder.formatSqlValue, getPkWhereClause: row => `${q(id)} = ${builder.formatSqlValue(structureDefs[0], row[id])}`,
        executeSearch: async () => {}, setRecordDialog() {}, setDataContextMenu() {}, setIsLoading() {}, setLogs() {}, setBottomTab() {}, setResultRows() {} };
      await createTableRecordEditor(context).submitRecord(); assert.equal(operationFailed, false);
      const clauses = builder.buildQueryStrings({ [label]: { type: 'STRING', value: 'inserted', operator: '=', sort: '1 ASC' } });
      const rows = await read(main, `SELECT ${db === 'oracle' ? 'ROWID AS RID, ' : ''} t.* FROM ${qualified} t ${clauses.whereStr} ${clauses.orderStr}`);
      assert.equal(rows.length, 1);
      context.recordDialog = { ...context.recordDialog, mode: 'update', targetRowId: rows[0].RID || '',
        recordData: { [id]: '1', [label]: 'updated', [binary]: { isBlob: true, data: Buffer.from([0xaa, 0xbb]) } }, initialRecordData: { [id]: '1', [label]: 'inserted', [binary]: null } };
      await createTableRecordEditor(context).submitRecord(); assert.equal(operationFailed, false);
      const row = (await read(main, `SELECT * FROM ${qualified}`))[0];
      assert.equal(row[label], 'updated');
      assert.equal((Buffer.isBuffer(row[binary]) ? row[binary].toString('hex') : String(row[binary])).toLowerCase(), 'aabb');
      await main.rollback();
    });
    if (db === 'postgresql') await step('Import CSV rows with different missing fields without column shifts', async () => {
      const name = `${token}.Import`, qualified = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${qualified} (id integer GENERATED ALWAYS AS IDENTITY, "A" text DEFAULT 'default-a', "B" text DEFAULT 'default-b')`);
      created.push({ type: 'TABLE', name: qualified });
      const structureDefs = ['A', 'B'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: 'text', NULLABLE: 'Y', DATA_DEFAULT: "'default'" }));
      const builder = loadTypeScript('src/features/postgresql/windows/table/tableQueryBuilder.ts').createTableQueryBuilder({ schema, structureDefs, inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD' });
      const { createTableDataTransfer } = loadTypeScript('src/features/postgresql/windows/table/tableDataTransfer.ts', {
        '@/shared/api/desktop': { ipcRenderer: { invoke: async (_channel, query) => ({ success: true, ...await sql(query) }) } }
      }, { alert() {} });
      const transfer = createTableDataTransfer({ schema, tableName: name, structureDefs, resultColumns: [], conditions: {},
        paginationModel: { page: 0, pageSize: 50 }, t: key => key, formatSqlValue: builder.formatSqlValue,
        buildQueryStrings: builder.buildQueryStrings, executeSearch: async () => {},
        setIsLoading() {}, setLogs() {}, setBottomTab() {} });
      await transfer.processBulkInsertData([['A', 'B'], ['alpha', ''], ['', 'beta'], ['', 'gamma'], ['', '']], () => {}, true);
      const rows = await read(main, `SELECT "A", "B" FROM ${qualified} ORDER BY id`);
      assert.deepEqual(Array.from(rows, row => [row.A, row.B]), [['alpha', 'default-b'], ['default-a', 'beta'], ['default-a', 'gamma'], ['default-a', 'default-b']]);
      assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0);
      await main.rollback();
    });
    if (db === 'postgresql') await step('Read exact quoted metadata names through the real background clients', async () => {
      const name = `${token}.Order'Items"Mix`, qualified = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${qualified} ("Id Key" integer, "N""ame" text, "Other Name" text DEFAULT 'fallback')`);
      created.push({ type: 'TABLE', name: qualified });
      const columns = await main.getColumns(schema, name);
      assert.equal(JSON.stringify(columns), JSON.stringify(['Id Key', 'N"ame', 'Other Name']));
      const objects = await main.getObjects(schema, 'TABLE');
      assert.ok(objects.some(object => object.name === name));
      assert.equal((await main.getObjects(schema.toUpperCase(), 'TABLE')).length, 0);
      assert.equal((await main.getObjects("MBT_missing's schema", 'TABLE')).length, 0);
      assert.ok(Array.isArray(await main.getSessions()));
      assert.ok(Array.isArray(await main.getLocks()));
      assert.ok(main.bgPool.every(connection => connection.isExecuting === false));
      const requests = [], alerts = [];
      const { createSidebarDataTransfer } = loadTypeScript('src/features/postgresql/sidebarDataTransfer.ts', {
        '@/shared/api/desktop': snapshotDesktop(async (channel, query, binds) => {
          requests.push(channel);
          if (channel === 'get-columns') return { success: true, columns: await main.getColumns(query, binds) };
          return { success: true, ...await sql(query, binds, channel === 'execute-sql-bg') };
        }, db)
      }, { alert: message => alerts.push(message), setTimeout: callback => callback(), window: { dispatchEvent() {} }, CustomEvent: class {} });
      const context = { sidebarContextMenu: { schema, value: name, objType: 'TABLE' }, exportTarget: null, importTarget: null,
        exportContainerRef: { current: null }, importContainerRef: { current: null }, t: key => key, outputDateFormat: 'YYYY-MM-DD',
        setSidebarContextMenu() {}, setIsLoading() {}, setExportTarget(target) { context.exportTarget = target; }, setImportTarget(target) { context.importTarget = target; } };
      await createSidebarDataTransfer(context).handleExportClick();
      await createSidebarDataTransfer(context).handleImportClick();
      assert.equal(context.exportTarget.tableName, name); assert.equal(context.importTarget.tableName, name);
      assert.equal(context.importTarget.structureDefs[1].COLUMN_NAME, 'N"ame');
      assert.ok(requests.includes('get-columns')); assert.equal(requests.filter(channel => channel === 'execute-sql-bg').length, 2);
      assert.equal(alerts.length, 0, 'Sidebar metadata preparation must succeed');
      await createSidebarDataTransfer(context).processSidebarBulkInsertData([['N"ame', 'Other Name'], ['alpha', ''], ['', 'beta'], ['', '']], () => {}, true);
      const imported = await read(main, `SELECT "N""ame", "Other Name" FROM ${qualified} ORDER BY "N""ame" NULLS LAST, "Other Name"`);
      const pairs = Array.from(imported, row => [row['N"ame'], row['Other Name']]);
      assert.equal(JSON.stringify(pairs), JSON.stringify([['alpha', 'fallback'], [null, 'beta'], [null, 'fallback']]));
      assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0);
      await main.rollback();
    });
    if (db === 'oracle') await step('Prepare sidebar export and import with bound quoted Oracle identifiers', async () => {
      const name = `${token}.Order'Items`, qualified = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${qualified} ("Id Key" NUMBER(38) PRIMARY KEY, "Note" VARCHAR2(100))`);
      created.push({ type: 'TABLE', name: qualified });
      await sql(`INSERT INTO ${qualified} ("Id Key", "Note") VALUES (:id, :note)`, { id: '9007199254740993', note: 'initial' });
      const requests = [], alerts = [], opened = [];
      const { createSidebarDataTransfer } = loadTypeScript('src/features/oracle/sidebarDataTransfer.ts', {
        '@/shared/api/desktop': snapshotDesktop(async (channel, query, binds) => {
          requests.push([channel, query, binds]);
          if (channel === 'get-columns') return { success: true, columns: await main.getColumns(query, binds) };
          return { success: true, ...await sql(query, binds, channel === 'execute-sql-bg') };
        }, db)
      }, { alert: message => alerts.push(message), setTimeout: callback => callback(), window: { dispatchEvent() {} }, CustomEvent: class {} });
      const context = { sidebarContextMenu: { schema, value: name, objType: 'TABLE' }, exportTarget: null, importTarget: null,
        exportContainerRef: { current: { querySelector: () => ({ click: () => opened.push('export') }) } },
        importContainerRef: { current: { querySelector: () => ({ click: () => opened.push('import') }) } },
        t: key => key, outputDateFormat: 'YYYY-MM-DD', setSidebarContextMenu() {}, setIsLoading() {},
        setExportTarget(target) { context.exportTarget = target; }, setImportTarget(target) { context.importTarget = target; } };
      await createSidebarDataTransfer(context).handleExportClick();
      await createSidebarDataTransfer(context).handleImportClick();
      assert.deepEqual(opened, ['export', 'import']); assert.equal(alerts.length, 0);
      assert.equal(context.exportTarget.totalCount, 1); assert.equal(context.exportTarget.tableName, name);
      assert.deepEqual(Array.from(context.exportTarget.columns, col => col.field), ['Id Key', 'Note']);
      assert.equal(context.importTarget.structureDefs[0].PK_POSITION, 1);
      for (const [, query, binds] of requests.filter(request => request[0] === 'execute-sql-bg')) {
        assert.equal(binds.schema, schema); assert.equal(binds.tableName, name); assert.ok(!query.includes(name));
      }
      const rows = await createSidebarDataTransfer(context).fetchExportDataChunk(0, 50);
      assert.equal(rows[0]['Id Key'], '9007199254740993');
      await createSidebarDataTransfer(context).processSidebarBulkInsertData([['Id Key', 'Note'], ['9007199254740994', "O'Brien"]], () => {}, true);
      assert.equal(main.getMainTransactionState(), true);
      assert.equal((await read(main, `SELECT * FROM ${qualified}`)).length, 2);
      assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0);
      await main.rollback();
    });
    await step('Separate grid identities from real columns and preserve row targets during cell editing', async () => {
      const name = `${token}_Grid`, qualified = `${q(schema)}.${q(name)}`;
      const number = db === 'oracle' ? 'NUMBER' : 'integer', text = db === 'oracle' ? 'VARCHAR2(100)' : 'varchar(100)';
      await sql(`CREATE TABLE ${qualified} ("key" ${number} PRIMARY KEY, "id" ${number}, "__row_id" ${text}, "ORACLE_ROWID" ${text}, "__MONABASE_ROWID" ${text}, "label" ${text}, "day" DATE, "DAY" DATE)`);
      created.push({ type: 'TABLE', name: qualified });
      for (const key of [1, 2]) await sql(`INSERT INTO ${qualified} ("key", "id", "__row_id", "ORACLE_ROWID", "__MONABASE_ROWID", "label", "day", "DAY") VALUES (:key, 0, 'business-grid', 'business-rowid', 'business-alias', :label, ${key === 1 ? "DATE '2026-10-22', NULL" : "NULL, DATE '2026-10-23'"})`, { key, label: `record${key}` });
      const identities = loadTypeScript('src/features/data-grid/rowIdentity.ts');
      const defs = ['key', 'id', '__row_id', 'ORACLE_ROWID', '__MONABASE_ROWID', 'label', 'day', 'DAY'].map(COLUMN_NAME => ({
        COLUMN_NAME, DATA_TYPE: ['day', 'DAY'].includes(COLUMN_NAME) ? (db === 'oracle' ? 'DATE' : 'date') : ['key', 'id'].includes(COLUMN_NAME) ? (db === 'oracle' ? 'NUMBER' : 'integer') : (db === 'oracle' ? 'VARCHAR2' : 'varchar'), PK_POSITION: COLUMN_NAME === 'key' ? 1 : ''
      }));
      const alias = identities.oracleRowIdAlias(defs.map(col => col.COLUMN_NAME));
      const raw = await read(main, `SELECT ${db === 'oracle' ? `t.ROWID AS ${q(alias)}, ` : ''}t.* FROM ${qualified} t ORDER BY "key"`);
      let displayed = db === 'oracle' ? raw.map((row, index) => identities.identifyOracleRow(row, alias, index + 1)) :
        loadTypeScript('src/features/postgresql/windows/table/tableResultRows.ts', { '@/features/data-grid/rowIdentity': identities }).formatTableResultRows(raw, defs, 'YYYY-MM-DD', key => key);
      assert.equal(new Set(displayed.map(identities.getRowIdentity)).size, 2);
      assert.ok(displayed.every(row => String(row.id) === '0' && row.__row_id === 'business-grid' && row.ORACLE_ROWID === 'business-rowid' && row.__MONABASE_ROWID === 'business-alias'));
      if (db === 'postgresql') assert.deepEqual(Array.from(displayed, row => [row.day, row.DAY]), [['2026-10-22', ''], ['', '2026-10-23']]);
      const { createTableRecordEditor } = loadTypeScript(`src/features/${db}/windows/table/tableRecordEditor.ts`, {
        '@/features/data-grid/rowIdentity': identities,
        '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, query, binds) => {
          assert.equal(channel, 'execute-sql'); return { success: true, ...await sql(query, binds) };
        } } }
      }, { alert(message) { throw new Error(message); } });
      const editor = createTableRecordEditor({ schema, tableName: name, structureDefs: defs, isTransposed: false,
        t: key => key, formatSqlValue: (_col, value) => `'${String(value).replace(/'/g, "''")}'`,
        getPkWhereClause: row => `"key" = ${row.key}`, setLogs() {}, setBottomTab() {}, setIsLoading() {},
        setResultRows(update) { displayed = update(displayed); } });
      const old = displayed[1];
      const edited = await editor.handleProcessRowUpdate({ ...old, label: 'edited' }, old);
      assert.equal(identities.getRowIdentity(edited), identities.getRowIdentity(old));
      assert.deepEqual(Array.from(await read(main, `SELECT "label" FROM ${qualified} ORDER BY "key"`), row => row.label), ['record1', 'edited']);
      assert.equal(displayed[0].label, 'record1'); assert.equal(displayed[1].label, 'edited');
      assert.equal(main.getMainTransactionState(), true); assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0);
      await main.rollback();
    });
    await step('Export exact business IDs and independent case-sensitive date columns through both paths', async () => {
      const name = `${token}_Export`, qualified = `${q(schema)}.${q(name)}`;
      const number = db === 'oracle' ? 'NUMBER(38)' : 'numeric(38,0)';
      const text = db === 'oracle' ? 'VARCHAR2(100)' : 'text';
      await sql(`CREATE TABLE ${qualified} ("id" ${number}, "__row_id" ${text}, "ORACLE_ROWID" ${text}, "day" DATE, "DAY" DATE)`);
      created.push({ type: 'TABLE', name: qualified });
      await sql(`INSERT INTO ${qualified} ("id", "__row_id", "ORACLE_ROWID", "day", "DAY") VALUES (:id, :rowValue, :oracleValue, DATE '2026-10-22', NULL)`,
        { id: '9007199254740993', rowValue: 'business-row-1', oracleValue: 'business-oracle-1' });
      await sql(`INSERT INTO ${qualified} ("id", "__row_id", "ORACLE_ROWID", "day", "DAY") VALUES (:id, :rowValue, :oracleValue, NULL, DATE '2026-10-23')`,
        { id: '9007199254740994', rowValue: 'business-row-2', oracleValue: 'business-oracle-2' });
      const structureDefs = [
        { COLUMN_NAME: 'id', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'numeric' },
        ...['__row_id', 'ORACLE_ROWID'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text' })),
        ...['day', 'DAY'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: db === 'oracle' ? 'DATE' : 'date' }))
      ];
      const desktop = snapshotDesktop(async (channel, query, binds) => {
        assert.equal(channel, 'execute-sql', 'Exports must retain the main connection');
        return { success: true, ...await sql(query, binds) };
      }, db);
      for (const sidebar of [false, true]) {
        const module = loadTypeScript(sidebar ? `src/features/${db}/sidebarDataTransfer.ts` : `src/features/${db}/windows/table/tableDataTransfer.ts`, {
          '@/shared/api/desktop': desktop
        });
        const context = { schema, tableName: name, structureDefs, conditions: {}, outputDateFormat: 'YYYY-MM-DD', t: key => key,
          buildQueryStrings: () => ({ whereStr: '', orderStr: 'ORDER BY t."id"' }),
          exportTarget: { schema, tableName: name, structureDefs } };
        const transfer = sidebar ? module.createSidebarDataTransfer(context) : module.createTableDataTransfer(context);
        const rows = await (sidebar ? transfer.fetchExportDataChunk(0, 50) : transfer.fetchDataForExport(0, 50));
        rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        assert.deepEqual(Array.from(rows, row => [row.id, row.__row_id, row.ORACLE_ROWID]), [
          ['9007199254740993', 'business-row-1', 'business-oracle-1'],
          ['9007199254740994', 'business-row-2', 'business-oracle-2']
        ]);
        assert.deepEqual(Object.keys(rows[0]).sort(), ['id', '__row_id', 'ORACLE_ROWID', 'day', 'DAY'].sort());
        if (db === 'postgresql' || !sidebar) {
          assert.deepEqual(Array.from(rows, row => [row.day, row.DAY]), [['2026-10-22', ''], ['', '2026-10-23']]);
        }
        assert.equal(main.getMainTransactionState(), true);
        assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0, 'Export must not commit pending inserts');
      }
      await main.rollback();
    });
    await step('Save exact view identities, refresh their data columns and inspect real direct dependencies', async () => {
      const { createViewEditor } = require('../helpers/viewEditor.cjs');
      const { loadViewMetadata } = loadTypeScript('src/features/view/viewMetadata.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, text, binds) => ({ success: true, ...await sql(text, binds, channel === 'execute-sql-bg') }) } } });
      const baseName = token + "_View'Base", name = token + "_View'Mixed", dependentName = token + '_Dependent';
      const base = `${q(schema)}.${q(baseName)}`, target = `${q(schema)}.${q(name)}`, dependent = `${q(schema)}.${q(dependentName)}`;
      await sql(`CREATE TABLE ${base} ("KEEP" ${db === 'oracle' ? 'VARCHAR2(20)' : 'text'}, "Added" INTEGER)`); created.push({ type: 'TABLE', name: base });
      await sql(`INSERT INTO ${base} VALUES ('wanted', 7)`); await main.commit();
      await sql(`CREATE VIEW ${target} AS SELECT "KEEP" FROM ${base}`); created.push({ type: 'VIEW', name: target });
      await sql(`CREATE VIEW ${dependent} AS SELECT "KEEP" FROM ${target}`); created.push({ type: 'VIEW', name: dependent });
      const dataProps = { schema, viewName: name, isActive: true, revision: 0 };
      const invoke = async (channel, ...args) => {
        if (channel === 'git-commit' || channel === 'git-delete-object') return { success: true };
        if (channel === 'get-columns') return { success: true, columns: await main.getColumns(...args) };
        try { return { success: true, ...await sql(args[0], args[1], channel === 'execute-sql-bg') }; }
        catch (error) { return { success: false, error: error.message, errorPosition: Number(error.position) || undefined }; }
      };
      const data = await createViewHarness(db, { ipcRenderer: { invoke } }, dataProps);
      const editor = await createViewEditor(db, invoke, { fullViewName: target });
      try {
        await data.waitFor(state => state.displayRows.length === 1 && !state.isLoading);
        data.state.handleConditionChange('KEEP', 'value', 'wanted'); await data.flush();
        await editor.render().loadSource(); await editor.flush(); assert.equal(editor.render().canSave, true);
        const changed = `CREATE OR REPLACE VIEW ${target} AS SELECT "KEEP", "Added" FROM ${base}`;
        editor.render().setSourceText(changed); await editor.flush();
        await editor.render().handleSave(); await editor.flush();
        assert.equal(editor.render().dataRevision, 1); assert.ok(editor.alerts.includes('view_updated_successfully'));
        dataProps.revision = editor.render().dataRevision;
        await data.waitFor(state => state.columns.includes('Added') && !state.isLoading && state.displayRows.length === 1);
        assert.equal(data.state.conditions.KEEP.value, 'wanted'); assert.equal(Number(data.state.displayRows[0].Added), 7);
        const metadata = await loadViewMetadata(db, schema, name);
        assert.deepEqual(Array.from(metadata.columns, col => col.name), ['KEEP', 'Added']);
        assert.ok(metadata.references.some(ref => ref.schema === schema && ref.name === baseName));
        assert.ok(metadata.dependents.some(ref => ref.schema === schema && ref.name === dependentName));
        const previousRevision = editor.render().dataRevision;
        editor.render().setSourceText(changed.replace(q(name), q(dependentName))); await editor.flush();
        await editor.render().handleSave(); assert.ok(editor.alerts.includes('view_target_definition_required'));
        editor.render().setSourceText(`CREATE OR REPLACE ${db === 'oracle' ? 'FORCE ' : ''}VIEW ${target} AS SELECT "MISSING" FROM ${base}`); await editor.flush();
        await editor.render().handleSave(); await editor.flush();
        assert.ok(!editor.render().dbmsOutputs.includes('view_updated_successfully')); assert.ok(editor.render().compileErrors.length > 0);
        if (db === 'postgresql') assert.equal(editor.render().dataRevision, previousRevision);
      } finally { editor.unmount(); data.unmount(); }
    });

    await step('Display, page, filter and export a real view without changing business values', async () => {
      const name = token + '_ViewData', source = `${q(schema)}.${q(name + '_Rows')}`, view = `${q(schema)}.${q(name)}`;
      const text = db === 'oracle' ? 'VARCHAR2(100)' : 'text', number = db === 'oracle' ? 'NUMBER' : 'integer';
      const special = db === 'oracle' ? 'Quote Name' : 'A"Name';
      const stamp = '2026-10-22T12:34:56.000Z';
      await sql(`CREATE TABLE ${source} ("ordinal" ${number}, "id" ${text}, "stamp" ${text}, "day" TIMESTAMP, "DAY" TIMESTAMP, ${q(special)} ${text})`);
      created.push({ type: 'TABLE', name: source });
      await sql(`INSERT INTO ${source} SELECT ${db === 'oracle' ? 'LEVEL' : 'generate_series(1, 115)'}, '9007199254740993', '${stamp}', TIMESTAMP '2026-10-22 12:34:56', NULL, 'keep' ${db === 'oracle' ? 'FROM DUAL CONNECT BY LEVEL <= 115' : ''}`);
      await main.commit();
      await sql(`CREATE VIEW ${view} AS SELECT * FROM ${source}`);
      created.push({ type: 'VIEW', name: view });
      await sql(`INSERT INTO ${source} VALUES (116, 'pending', '${stamp}', NULL, TIMESTAMP '2026-10-23 12:34:56', 'keep')`);
      let failStage;
      const desktop = snapshotDesktop(async (channel, query, binds) => {
        if (channel === 'get-columns') return { success: true, columns: await main.getColumns(query, binds) };
        assert.ok(['execute-sql', 'execute-sql-bg'].includes(channel));
        if (channel === 'execute-sql' && failStage === (/COUNT\(/.test(query) ? 'count' : 'data')) {
          try { await sql(`SELECT "MBT_MISSING_COLUMN" FROM ${view}`); }
          catch (error) { return { success: false, error: error.message }; }
          throw new Error('Expected invalid view SQL to fail');
        }
        return { success: true, ...await sql(query, binds, channel === 'execute-sql-bg') };
      }, db);
      const h = await createViewHarness(db, desktop, { schema, viewName: name });
      try {
        await h.waitFor(state => state.displayRows.length === 50 && !state.isLoading);
        assert.equal(h.state.displayRows.length, 50); assert.deepEqual(h.alerts, []);
        const first = h.state.displayRows[0];
        assert.equal(first.id, '9007199254740993'); assert.equal(first.stamp, stamp);
        assert.equal(first.day, '2026/10/22 12:34:56'); assert.equal(first.DAY, '');
        h.state.handleConditionChange('ordinal', 'sort', '1'); await h.flush();
        h.state.handleExecuteSearchClick(); await h.waitFor(state => !state.isLoading);
        h.state.setPaginationModel({ page: 1, pageSize: 50 }); await h.waitFor(state => !state.isLoading);
        assert.equal(String(h.state.displayRows[0].ordinal), '51');
        for (const stage of ['count', 'data']) {
          const previousRows = h.state.displayRows;
          failStage = stage;
          h.state.setPaginationModel({ page: 2, pageSize: 50 }); await h.waitFor(state => !state.isLoading);
          assert.equal(h.state.paginationModel.page, 1); assert.equal(h.state.displayRows, previousRows);
          assert.equal(h.state.rowCount, 116);
          failStage = undefined;
          h.state.setPaginationModel({ page: 2, pageSize: 50 }); await h.waitFor(state => !state.isLoading);
          assert.equal(h.state.paginationModel.page, 2); assert.equal(String(h.state.displayRows[0].ordinal), '101');
          h.state.setPaginationModel({ page: 1, pageSize: 50 }); await h.waitFor(state => !state.isLoading);
        }
        assert.equal(h.alerts.length, 2); h.alerts.length = 0;
        h.state.setPaginationModel({ page: 1, pageSize: 100 }); await h.waitFor(state => !state.isLoading);
        assert.equal(h.state.displayRows.length, 100); assert.equal(String(h.state.displayRows[0].ordinal), '1');
        h.state.handleConditionChange(special, 'value', 'keep'); await h.flush();
        const previousConditions = h.state.conditions;
        const previousSort = previousConditions.ordinal.sort;
        h.state.handleColumnHeaderClick({ field: special }); await h.waitFor(state => !state.isLoading);
        assert.equal(previousConditions.ordinal.sort, previousSort);
        assert.notEqual(previousConditions.ordinal, h.state.conditions.ordinal);
        assert.equal(h.state.rowCount, 116); assert.deepEqual(h.alerts, []);
        const exported = await h.state.fetchDataForExport(0, 5000); await h.state.fetchDataForExport.close();
        assert.equal(exported.length, 116); assert.ok(exported.every(row => row.stamp === stamp));
        assert.equal(exported.filter(row => row.id === '9007199254740993').length, 115);
        assert.equal(main.getMainTransactionState(), true);
        assert.equal(String(value((await read(observer, `SELECT COUNT(*) AS value FROM ${view}`))[0])), '115');
        h.state.setIsTransposed(true); await h.flush();
        assert.equal(h.state.displayRows.find(row => row.colName === 'stamp').row_0, stamp);
      } finally { h.unmount(); desktop.close(); await main.rollback(); }
    });
    await step('Keep one export result while another connection deletes, updates and inserts rows', async () => {
      const qualified = `${q(schema)}.${q(token + '_Snapshot')}`;
      await sql(`CREATE TABLE ${qualified} (id ${db === 'oracle' ? 'NUMBER' : 'integer'} PRIMARY KEY, label ${db === 'oracle' ? 'VARCHAR2(30)' : 'text'})`);
      created.push({ type: 'TABLE', name: qualified });
      await sql(db === 'oracle'
        ? `INSERT INTO ${qualified} SELECT LEVEL, 'initial' FROM DUAL CONNECT BY LEVEL <= 6000`
        : `INSERT INTO ${qualified} SELECT generate_series(1, 6000), 'initial'`);
      await main.commit();
      await sql(`UPDATE ${qualified} SET label = 'pending' WHERE id = 6000`);
      const owner = new EventEmitter(), calls = [];
      const snapshots = createExportSnapshots({ getClient: () => main, getDialect: () => db, t: key => key });
      const desktop = { ipcRenderer: { async invoke(channel, ...args) {
        calls.push(channel);
        if (channel === 'open-data-export') return { success: true, ...await snapshots.open(owner, ...args) };
        if (channel === 'read-data-export') return { success: true, ...snapshots.read(owner, ...args) };
        if (channel === 'close-data-export') { snapshots.close(owner, ...args); return { success: true }; }
        throw new Error('Unexpected snapshot channel');
      } } };
      const { createExportSnapshotFetcher } = loadTypeScript('src/features/table/exportSnapshot.ts', { '@/shared/api/desktop': desktop });
      const fetch = createExportSnapshotFetcher(() => `SELECT id AS "id", label AS "label" FROM ${qualified} ORDER BY id`);
      try {
        const first = await fetch(0, 5000);
        assert.equal(first.length, 5000);
        await observer.execute(`DELETE FROM ${qualified} WHERE id = 1`);
        await observer.execute(`UPDATE ${qualified} SET label = 'changed' WHERE id = 2`);
        await observer.execute(`INSERT INTO ${qualified} (id, label) VALUES (6001, 'new')`);
        await observer.commit();
        const last = await fetch(5000, 5000), rows = [...first, ...last];
        assert.equal(rows.length, 6000); assert.equal(last.length, 1000);
        assert.deepEqual(rows.map(row => String(row.id)), Array.from({ length: 6000 }, (_, i) => String(i + 1)));
        assert.equal(rows[1].label, 'initial'); assert.equal(rows[5999].label, 'pending');
        assert.equal(main.getMainTransactionState(), true, 'Export must not finish pending changes');
        const observed = await read(observer, `SELECT label AS value FROM ${qualified} WHERE id = 6000`);
        assert.equal(value(observed[0]), 'initial', 'Other connection must not see pending edits');
        assert.equal(calls.filter(channel => channel === 'open-data-export').length, 1);
      } finally {
        await fetch.close(); snapshots.clear(); await observer.rollback(); await main.rollback();
      }
      assert.equal(owner.listenerCount('destroyed'), 0);
    });
    await step('Import parsed CSV defaults and exact-case columns through table and sidebar paths', async () => {
      const name = `${token}.ImportCase`, qualified = `${q(schema)}.${q(name)}`;
      const type = db === 'oracle' ? 'VARCHAR2(100)' : 'text';
      await sql(`CREATE TABLE ${qualified} ("code" ${type} DEFAULT 'lower-default', "CODE" ${type} DEFAULT 'upper-default')`);
      created.push({ type: 'TABLE', name: qualified });
      const structureDefs = ['code', 'CODE'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text', NULLABLE: 'Y', DATA_DEFAULT: "'default'" }));
      const translateImport = (key, values) => translate(key, 'en', values);
      const records = parseDelimitedText('CODE,code\nupper,lower\n,\n"   ",\n', ',', translateImport);
      assert.equal(records.length, 4);
      const builder = loadTypeScript(`src/features/${db}/windows/table/tableQueryBuilder.ts`).createTableQueryBuilder({ schema, structureDefs, inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD' });
      for (const sidebar of [false, true]) {
        const file = sidebar ? `src/features/${db}/sidebarDataTransfer.ts` : `src/features/${db}/windows/table/tableDataTransfer.ts`;
        const factory = sidebar ? 'createSidebarDataTransfer' : 'createTableDataTransfer';
        let requestCount = 0;
        const module = loadTypeScript(file, { '@/shared/api/desktop': { ipcRenderer: { async invoke(_channel, query) {
          requestCount++; return { success: true, ...await sql(query) };
        } } } }, { alert() {}, window: { dispatchEvent() {} }, CustomEvent: class {} });
        const transfer = module[factory]({ schema, tableName: name, structureDefs, resultColumns: [], conditions: {}, paginationModel: { page: 0, pageSize: 50 },
          t: translateImport, formatSqlValue: builder.formatSqlValue, buildQueryStrings: builder.buildQueryStrings, executeSearch: async () => {},
          setIsLoading() {}, setLogs() {}, setBottomTab() {}, setImportTarget() {}, importTarget: { schema, tableName: name, structureDefs } });
        const run = sidebar ? transfer.processSidebarBulkInsertData : transfer.processBulkInsertData;
        await assert.rejects(run([['Code'], ['wrong column']], () => {}, true), /matches multiple database columns/);
        assert.equal(requestCount, 0);
        await run(records, () => {}, true);
        const rows = await read(main, `SELECT "code", "CODE" FROM ${qualified} ORDER BY "CODE", "code"`);
        const pairs = Array.from(rows, row => [row.code, row.CODE]);
        assert.equal(JSON.stringify(pairs), JSON.stringify([['lower-default', '   '], ['lower', 'upper'], ['lower-default', 'upper-default']]));
        assert.equal((await read(observer, `SELECT * FROM ${qualified}`)).length, 0);
        await main.rollback();
      }
    });
    await step('Protect dynamic and manually private SQL without changing execution or pending transactions', async () => {
      const name = `${token}_Privacy`, target = `${q(schema)}.${q(name)}`;
      await sql(`CREATE TABLE ${target}(ID INTEGER)`); created.push({ type: 'TABLE', name: target });
      await sql(`INSERT INTO ${target} VALUES (1)`);
      const marker = 'DUMMY_NATIVE_PRIVACY_VALUE';
      const statement = db === 'oracle'
        ? `DECLARE stmt VARCHAR2(500) := 'SELECT ''${marker}'' FROM dual'; result VARCHAR2(100); BEGIN EXECUTE IMMEDIATE stmt INTO result; END;`
        : `DO $$ DECLARE stmt text := 'SELECT ''${marker}'''; result text; BEGIN EXECUTE stmt INTO result; END; $$`;
      const h = await createSqlWindowHarness(db, statement, createDatabaseIpc(main, db), { realBatches: true, schema });
      try {
        await h.state.handleExecuteSql(); await h.flush();
        assert.equal(h.alerts.length, 0); assert.equal(h.state.logs.length, 1);
        assert.ok(!JSON.stringify(h.state.logs).includes(marker));
        assert.ok(h.state.logs[0].sql.includes('DYNAMIC SQL'));
        h.state.setPrivateExecution(true);
        h.state.setSqlText(`SELECT '${marker}' AS "VALUE"${db === 'oracle' ? ' FROM dual' : ''}`);
        await h.flush(); await h.state.handleExecuteSql(); await h.flush();
        assert.equal(h.alerts.length, 0); assert.equal(h.state.rows[0].VALUE, marker);
        assert.ok(!JSON.stringify(h.state.logs).includes(marker));
        assert.equal(h.historyCalls.filter(args => args.includes('add-sql-history')).length, 0);
        assert.equal((await read(observer, `SELECT * FROM ${target}`)).length, 0);
        assert.equal((await sql(`SELECT * FROM ${target}`)).rows.length, 1);
      } finally { h.unmount(); await main.rollback(); }
    });
    await step('Run parsed scripts with database-specific quoting and procedural blocks', async () => {
      const script = db === 'oracle' ? "SELECT q'[a;b :ignored]' AS value FROM dual;\nBEGIN NULL; END;\n/\nSELECT 7 AS value FROM dual;" :
        "SELECT $$a;b :ignored$$ AS value; DO $$ BEGIN PERFORM 1; END; $$; SELECT 7 AS value;";
      assert.equal(scripts.findSqlBindNames(script, db).length, 0);
      const statements = scripts.splitSqlScript(script, db);
      assert.equal(statements.length, 3);
      let result;
      for (const statement of statements) result = await sql(statement.text);
      assert.equal(Number(value(result.rows[0])), 7);
      await main.rollback();
    });
    await step('Application read-only mode blocks procedural, function, CTE and multi-statement writes', async () => {
      const readonly = new Client();
      const name = `${token}_WRITE`, qualified = `${q(schema)}.${q(name)}`;
      await sql(db === 'oracle'
        ? `CREATE FUNCTION ${qualified} RETURN NUMBER AS PRAGMA AUTONOMOUS_TRANSACTION; BEGIN UPDATE ${table} SET label = 'forbidden'; COMMIT; RETURN 1; END;`
        : `CREATE FUNCTION ${qualified}() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN UPDATE ${table} SET label = 'forbidden'; RETURN 1; END; $$`);
      created.push({ type: 'FUNCTION', name: db === 'oracle' ? qualified : `${qualified}()` });
      const before = value((await read(observer, `SELECT label AS value FROM ${table}`))[0]);
      try {
        await readonly.connect({ ...config, readonly: true, queryTimeout: 15 });
        const writes = [`UPDATE ${table} SET label = 'forbidden'`,
          db === 'oracle' ? `BEGIN UPDATE ${table} SET label = 'forbidden'; END;` : `DO $$ BEGIN UPDATE ${table} SET label = 'forbidden'; END $$`,
          `SELECT ${qualified}() AS value${db === 'oracle' ? ' FROM DUAL' : ''}`,
          `SELECT 1${db === 'oracle' ? ' FROM DUAL' : ''}; UPDATE ${table} SET label = 'forbidden'`];
        if (db === 'postgresql') writes.push(`WITH changed AS (UPDATE ${table} SET label = 'forbidden' RETURNING *) SELECT * FROM changed`, 'SET transaction_read_only = off');
        for (const background of [false, true]) {
          for (const query of writes) await assert.rejects(readonly.execute(query, {}, null, false, background));
          assert.equal((await readonly.execute(`SELECT * FROM ${table}`, {}, null, false, background)).rows.length, 1);
        }
        if (db === 'oracle') {
          const definition = await readonly.execute("SELECT DBMS_METADATA.GET_DDL('TABLE', :name, :owner) AS SOURCE FROM DUAL", { name: `${token}.Items`, owner: schema }, null, false, true);
          assert.match(definition.rows[0].SOURCE, /CREATE TABLE/);
        }
        assert.equal(value((await read(observer, `SELECT label AS value FROM ${table}`))[0]), before);
        assert.equal(readonly.getMainTransactionState(), false);
        // Closing each read transaction lets the next query see newly committed data.
        await sql(`UPDATE ${table} SET label = 'visible on next read'`); await main.commit();
        assert.equal(value((await read(readonly, `SELECT label AS value FROM ${table}`))[0]), 'visible on next read');
      } finally { await readonly.disconnect(); }
    });
    await step('Serialize overlapping connection and disconnect IPC requests with real clients', async () => {
      const candidates = [], state = { client: null, type: null }, handlers = new Map();
      class Candidate {
        constructor() { const client = new Client(); candidates.push(client); return client; }
      }
      const { registerDatabaseHandlers } = loadModule('electron/ipc/database.js', {
        '../oracle/traceDb': {}, '../postgres/traceDb': {}, '../oracle/traceExecutor': {}, '../postgres/traceExecutorPg': {},
        '../oracle/oracleClient': Candidate, '../postgres/postgresClient': Candidate
      }, {}, { strict: false });
      registerDatabaseHandlers({ state, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        getValidatedSettings: () => ({ queryTimeout: 15 }), t: key => key });
      const invoke = (channel, ...args) => handlers.get(channel)(null, ...args);
      const disconnected = client => db === 'oracle' ? client.connection === null : client.client === null;
      try {
        const results = await Promise.all([invoke('connect-db', { ...config, dbType: db }), invoke('connect-db', { ...config, dbType: db })]);
        assert.ok(results.every(result => result.success));
        assert.match(results[0].aiHistoryScope, /^[a-f0-9]{64}$/);
        assert.equal(results[0].aiHistoryScope, results[1].aiHistoryScope);
        assert.equal(state.aiHistoryScopes.get(results[0].aiHistoryScope), db === 'oracle' ? 'oracle' : 'postgresql');
        assert.equal(candidates.length, 2); assert.ok(disconnected(candidates[0])); assert.equal(state.client, candidates[1]);
        assert.equal((await invoke('get-schemas')).success, true);
        const disconnectedFirst = invoke('disconnect-db');
        const connectedLast = invoke('connect-db', { ...config, dbType: db });
        await Promise.all([disconnectedFirst, connectedLast]);
        assert.ok(disconnected(candidates[1])); assert.equal(state.client, candidates[2]);
        await invoke('disconnect-db'); assert.equal(state.client, null); assert.equal(state.type, null);
      } finally {
        // Close every candidate even when an assertion fails before it is published.
        for (const client of candidates) await client.disconnect();
      }
    });
    await step('Reconnect and delete data with rollback', async () => {
      await main.rollback();
      await main.disconnect();
      await main.connect({ ...config, queryTimeout: 15 });
      await sql(`DELETE FROM ${table}`);
      assert.equal((await read(main, `SELECT * FROM ${table}`)).length, 0);
      await main.rollback();
      assert.equal((await read(main, `SELECT * FROM ${table}`)).length, 1);
    });
  });
}
