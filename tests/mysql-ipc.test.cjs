// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/loadModule.cjs');

function fixture() {
  const handlers = new Map(), state = {}, calls = [];
  let status = 'idle', fail = false;
  class MysqlClient {
    async connect(config) { calls.push(['connect', config]); }
    async disconnect() { calls.push(['disconnect']); }
    getTransactionDetails() { return { transactionStatus: status, autocommit: false }; }
    getMainTransactionState() { return status === 'unknown' ? undefined : status === 'active'; }
    async execute(sql) { calls.push(['execute', sql]); if (fail) throw new Error('SQL fixture failed'); return { rows: [], metaData: [], executionTime: 1 }; }
    async explain(sql) { calls.push(['explain', sql]); if (fail) throw new Error('Plan fixture failed'); return { rows: [{ PLAN_TABLE_OUTPUT: '{}' }], metaData: [{ name: 'PLAN_TABLE_OUTPUT' }], executionTime: 1 }; }
    async executeStored(request){calls.push(['stored',request]);if(fail)throw new Error('Procedure failed');return {returnValues:[],resultSets:[]};}
    async getFunction(request){calls.push(['function',request]);return {name:request.name,returnType:'int'};}
    async mutateFunction(request){calls.push(['mutate-function',request]);return {success:true,applied:true,stage:'applied'};}
    async getProcedure(request){calls.push(['procedure',request]);return {name:request.name};}
    async mutateProcedure(request){calls.push(['mutate-procedure',request]);return {success:true,applied:true,stage:'applied'};}
    async commit() { status = 'idle'; }
    async rollback() { status = 'idle'; }
  }
  const { registerDatabaseHandlers } = loadModule('electron/ipc/database.js', { '../mysql/databaseService':{list:async()=>({success:true,snapshot:{databases:[]}}),get:async()=>({success:true,detail:{}})}, '../mysql/tablespaceService':{list:async()=>({success:true,snapshot:{tablespaces:[]}}),get:async()=>({success:true,detail:{}})}, '../mysql/lockService':{list:async()=>({success:true,snapshot:{}}),get:async()=>({success:true,detail:{}}),review:async()=>({success:true,review:{}}),execute:async()=>({success:true,submitted:true,status:'requested'})}, '../mysql/sessionService':{list:async()=>({success:true,snapshot:{}}),get:async()=>({success:true,detail:{}}),review:async()=>({success:true,review:{}}),execute:async()=>{calls.push(['session-control']);return {success:true,submitted:true,status:'requested'};}}, '../mysql/objectPrivileges':{get:async()=>({success:true,detail:{}}),review:async()=>({success:true,review:{}}),execute:async()=>{calls.push(['privileges-execute']);return {success:true,applied:true,transactionStatus:status};}}, '../mysql/mysqlClient': MysqlClient, '../mysql/userRoleService':{list:async()=>{calls.push(['accounts-list']);return {success:true,snapshot:{}};},get:async()=>({success:true,detail:{}}),review:async()=>({success:true,review:{token:'review'}}),execute:async(_client,request)=>{calls.push(['accounts-execute',request.token]);if(request.token==='throw')throw new Error('sentinel-secret');return {success:true,applied:true,outcome:'applied',transactionStatus:status};}} }, {}, { strict: false });
  registerDatabaseHandlers({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, state, getValidatedSettings: () => ({ queryTimeout: 7 }), t: key => key });
  const event = { sender: { id: 17, once() {}, isDestroyed: () => false } };
  return { state, calls, invoke: (channel, ...args) => handlers.get(channel)(event, ...args), setStatus: value => { status = value; }, fail: () => { fail = true; } };
}
test('MySQL connects through the shared IPC and receives the configured timeout with a MySQL-scoped AI history identity', async () => {
  const f = fixture();
  const result = await f.invoke('connect-db', { dbType: 'mysql', database: 'demo' });
  assert.equal(result.success, true);
  assert.match(result.aiHistoryScope, /^[a-f0-9]{64}$/);
  assert.equal(f.state.type, 'mysql');
  assert.equal(f.calls[0][1].queryTimeout, 7);
  assert.equal(f.state.aiHistoryScopes.get(result.aiHistoryScope), 'mysql');
});
test('MySQL unsupported feature channels fail before invoking PostgreSQL services', async () => {
  const f = fixture(); await f.invoke('connect-db', { dbType: 'mysql' });
  for (const channel of ['get-objects', 'open-data-export']) {
    const result = await f.invoke(channel);
    assert.equal(result.success, false, channel);
    assert.match(result.error, /not yet supported for MySQL/);
  }
  assert.equal(f.calls.filter(call => call[0] === 'execute').length, 0);
});
test('MySQL IPC reports actual active/idle/unknown state on successful and failed main operations only', async () => {
  const f = fixture(); await f.invoke('connect-db', { dbType: 'mysql' });
  f.setStatus('active');
  const active = await f.invoke('execute-sql', 'SELECT 1');
  assert.equal(active.hasUncommittedTx, true);
  assert.equal(active.transactionStatus, 'active');
  const background = await f.invoke('execute-sql-bg', 'SELECT 1');
  assert.equal(background.transactionStatus, undefined);
  assert.equal((await f.invoke('commit-db')).transactionStatus, 'idle');
  f.setStatus('unknown'); f.fail();
  const failed = await f.invoke('execute-sql', 'SELECT 1');
  assert.equal(failed.success, false);
  assert.equal(failed.transactionStatus, 'unknown');
  assert.equal(failed.hasUncommittedTx, undefined);
});

test('MySQL credential retention includes TLS and default port without changing Oracle/PostgreSQL scopes', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createConnectionStore } = require('../electron/services/connections');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-mysql-credentials-'));
  let retention;
  const vault = {
    prepareWrite(record, _fields, _identity, _previous, _legacy, options) { retention = options.canRetain; return { record, commit() {} }; },
    rename() {}, isPersisted: () => false
  };
  try {
    const store = createConnectionStore(path.join(temporary, 'connections.json'), vault);
    let config = { name: 'fixture', dbType: 'mysql', host: 'localhost', database: 'demo', user: 'test' };
    store.save(config);
    store.save({ ...config, port: '3306' }, config.name);
    assert.equal(retention.password, true, 'The explicit default MySQL port has the same recipient.');
    config = { ...config, mysqlSslMode: 'verify-full', mysqlSslCaFile: '/fixture/test-ca.pem' };
    store.save(config, config.name);
    assert.equal(retention.password, false, 'Changed MySQL TLS settings require re-entered credentials.');
    for (const dbType of ['oracle', 'postgresql']) {
      config = { name: dbType, dbType, host: 'localhost', database: 'demo', user: 'test' };
      store.save(config);
      store.save({ ...config, mysqlSslMode: 'verify-full', mysqlSslCaFile: '/fixture/unused.pem' }, config.name);
      assert.equal(retention.password, true, 'Irrelevant MySQL fields must not change an existing database scope.');
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('MySQL estimated plans use the dedicated IPC and report native state without main execution', async () => {
  const f = fixture(); await f.invoke('connect-db', { dbType: 'mysql' }); f.setStatus('active');
  const response = await f.invoke('explain-sql', 'SELECT 1');
  assert.equal(response.success, true); assert.equal(response.transactionStatus, 'active');
  assert.equal(f.calls.filter(call => call[0] === 'execute').length, 0);
  assert.deepEqual(f.calls.at(-1), ['explain', 'SELECT 1']);
  f.fail(); f.setStatus('unknown');
  const failure = await f.invoke('explain-sql', 'SELECT 1');
  assert.equal(failure.success, false); assert.equal(failure.transactionStatus, 'unknown');
});

test('MySQL read-only transaction activity is not converted into a pending-write flag by IPC', async () => {
  const f = fixture(); await f.invoke('connect-db', { dbType: 'mysql' }); f.setStatus('active');
  f.state.client.getMainTransactionState = () => false;
  const response = await f.invoke('execute-sql', 'SELECT * FROM departments');
  assert.equal(response.transactionStatus, 'active'); assert.equal(response.hasUncommittedTx, false);
  const plan = await f.invoke('explain-sql', 'SELECT * FROM departments');
  assert.equal(plan.transactionStatus, 'active'); assert.equal(plan.hasUncommittedTx, false);
});

test('MySQL trigger channels use the dedicated client and only mutations return main-session transaction state',async()=>{
  const f=fixture();await f.invoke('connect-db',{dbType:'mysql'});f.state.client.getTrigger=async request=>({schema:request.schema,name:request.name});f.state.client.mutateTrigger=async()=>({success:false,error:'DDL rejected',applied:false,stage:'unchanged'});f.setStatus('active');
  const source=await f.invoke('get-mysql-trigger',{schema:'demo',name:'trg'});assert.equal(source.success,true);assert.equal(source.transactionStatus,undefined);
  const changed=await f.invoke('mutate-mysql-trigger',{schema:'demo',name:'trg',operation:'drop'});assert.equal(changed.success,false);assert.equal(changed.hasUncommittedTx,true);assert.equal(changed.transactionStatus,'active');f.state.type='oracle';assert.equal((await f.invoke('get-mysql-trigger',{schema:'demo',name:'trg'})).success,false);
});


test('MySQL procedure IPC isolates metadata from transaction state and respects the SQL batch reservation',async()=>{
  const f=fixture();await f.invoke('connect-db',{dbType:'mysql'});f.setStatus('active');
  const metadata=await f.invoke('get-mysql-procedure',{schema:'demo',name:'proc'});assert.equal(metadata.success,true);assert.equal(metadata.transactionStatus,undefined);
  assert.equal((await f.invoke('execute-stored',{schema:'demo',objectName:'proc'})).hasUncommittedTx,true);
  assert.equal((await f.invoke('mutate-mysql-procedure',{schema:'demo',name:'proc',operation:'replace'})).transactionStatus,'active');
  const batchId=require('node:crypto').randomUUID();assert.equal((await f.invoke('begin-sql-batch',batchId)).success,true);
  const calls=f.calls.length;assert.equal((await f.invoke('execute-stored',{schema:'demo',objectName:'proc'})).success,false);assert.equal((await f.invoke('mutate-mysql-procedure',{schema:'demo',name:'proc',operation:'drop'})).success,false);assert.equal(f.calls.length,calls);
  await f.invoke('end-sql-batch',batchId);f.fail();assert.equal((await f.invoke('execute-stored',{})).hasUncommittedTx,true);
});


test('MySQL function IPC separates metadata, reports native state and rejects writes during an owned SQL batch',async()=>{
  const f=fixture();await f.invoke('connect-db',{dbType:'mysql'});f.setStatus('active');const metadata=await f.invoke('get-mysql-function',{schema:'demo',name:'fn'});assert.equal(metadata.success,true);assert.equal(metadata.routine.returnType,'int');assert.equal(metadata.transactionStatus,undefined);
  assert.equal((await f.invoke('mutate-mysql-function',{schema:'demo',name:'fn',operation:'replace'})).hasUncommittedTx,true);assert.equal((await f.invoke('execute-stored',{schema:'demo',objectName:'fn',objectType:'FUNCTION'})).transactionStatus,'active');
  const batchId=require('node:crypto').randomUUID();await f.invoke('begin-sql-batch',batchId);const before=f.calls.length;assert.equal((await f.invoke('mutate-mysql-function',{schema:'demo',name:'fn',operation:'drop'})).success,false);assert.equal(f.calls.length,before);await f.invoke('end-sql-batch',batchId);f.state.type='oracle';assert.equal((await f.invoke('get-mysql-function',{schema:'demo',name:'fn'})).success,false);
});

test('MySQL account IPC separates metadata from mutations and refuses a reserved SQL batch',async()=>{
 const f=fixture();await f.invoke('connect-db',{dbType:'mysql'});const listed=await f.invoke('list-mysql-accounts');assert.equal(listed.success,true);assert.equal(listed.transactionStatus,undefined);
 await f.invoke('begin-sql-batch','account-batch');const blocked=await f.invoke('execute-mysql-account',{token:'review'});assert.equal(blocked.success,false);assert.equal(blocked.error,'mysql_user_busy');assert.ok(!f.calls.some(c=>c[0]==='accounts-execute'));await f.invoke('end-sql-batch','account-batch');
 assert.equal((await f.invoke('execute-mysql-account',{token:'review'})).success,true);const failure=await f.invoke('execute-mysql-account',{token:'throw',password:'sentinel-secret'});assert.equal(failure.success,false);assert.ok(!JSON.stringify(failure).includes('sentinel-secret'));
});

test('MySQL object privilege IPC isolates background reads and reserves main execution against SQL batches',async()=>{
 const f=fixture();assert.equal((await f.invoke('get-mysql-object-privileges',{})).success,false);await f.invoke('connect-db',{dbType:'mysql'});assert.equal((await f.invoke('get-mysql-object-privileges',{})).transactionStatus,undefined);await f.invoke('begin-sql-batch','privileges');assert.equal((await f.invoke('execute-mysql-object-privileges',{})).error,'mysql_obj_busy');assert.ok(!f.calls.some(c=>c[0]==='privileges-execute'));await f.invoke('end-sql-batch','privileges');assert.equal((await f.invoke('execute-mysql-object-privileges',{})).success,true);
});

test('MySQL session IPC never overwrites main transaction state and rejects other database types',async()=>{
 const f=fixture();assert.equal((await f.invoke('list-mysql-sessions')).success,false);await f.invoke('connect-db',{dbType:'mysql'});f.setStatus('active');for(const channel of ['list-mysql-sessions','get-mysql-session-detail','review-mysql-session','manage-mysql-session']){const r=await f.invoke(channel,{});assert.equal(r.success,true);assert.equal(r.transactionStatus,undefined);assert.equal(r.hasUncommittedTx,undefined);}assert.equal(f.calls.filter(c=>c[0]==='session-control').length,1);
});

test('MySQL lock IPC stays database-specific and never replaces main transaction state',async()=>{
 const f=fixture();assert.equal((await f.invoke('list-mysql-locks')).success,false);await f.invoke('connect-db',{dbType:'mysql'});f.setStatus('active');for(const channel of ['list-mysql-locks','get-mysql-lock-detail','review-mysql-lock','manage-mysql-lock']){const result=await f.invoke(channel,{});assert.equal(result.success,true);assert.equal(result.transactionStatus,undefined);assert.equal(result.hasUncommittedTx,undefined);}
});


test('MySQL storage IPC refuses other DBs and never replaces the main transaction state',async()=>{
 const f=fixture();for(const channel of ['list-mysql-tablespaces','get-mysql-tablespace-detail'])assert.equal((await f.invoke(channel,{})).error,'mysql_storage_unavailable');await f.invoke('connect-db',{dbType:'mysql'});f.setStatus('active');for(const channel of ['list-mysql-tablespaces','get-mysql-tablespace-detail']){const r=await f.invoke(channel,{id:'7',name:'demo/orders'});assert.equal(r.success,true);assert.equal(r.transactionStatus,undefined);assert.equal(r.hasUncommittedTx,undefined);}f.state.type='oracle';assert.equal((await f.invoke('list-mysql-tablespaces')).success,false);
});


test('MySQL database information IPC stays read-only and isolated from other DB types',async()=>{
 const f=fixture();assert.equal((await f.invoke('list-mysql-databases')).success,false);await f.invoke('connect-db',{dbType:'mysql'});f.setStatus('active');for(const channel of ['list-mysql-databases','get-mysql-database-detail']){const r=await f.invoke(channel,{name:'demo'});assert.equal(r.success,true);assert.equal(r.transactionStatus,undefined);assert.equal(r.hasUncommittedTx,undefined);}f.state.type='postgresql';assert.equal((await f.invoke('list-mysql-databases')).success,false);
});
