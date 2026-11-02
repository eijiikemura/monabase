// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const {test}=require('node:test');
const service=require('../electron/postgres/sessionManagement');
const {createPostgresSessionHarness,postgresSessionFixture}=require('./helpers/postgresSessionData.cjs');
function fixture(){
 const f={rows:[postgresSessionFixture(),postgresSessionFixture({pid:21,state:'idle in transaction',blockers:[]}),postgresSessionFixture({pid:22,state:'idle',xact_start:null,blockers:[]}),postgresSessionFixture({pid:23,session_database_id:'6',session_database:'other'})],calls:[],requests:[],options:{readonly:false,ownPids:[10,11,12],protectionReady:true,connectionId:'scope'},failRead:false,accepted:true,ended:true,signalError:null};
 f.query=async(sql,binds)=>{f.calls.push([sql,binds]);if(sql===service.CONTEXT_SQL)return{rows:[{database:'demo',database_id:'5',reader_pid:12,version:160000,superuser:false,signal:false}]};if(sql===service.SESSION_SQL){if(f.failRead)throw Error('Read failed');return{rows:f.rows.map(row=>({...row}))};}if(sql===service.TARGET_SQL)return{rows:f.ended?[]:[{pid:20,state:'active',query_start:f.rows[0].query_start}]};if(sql.startsWith('SELECT pg_')){if(f.signalError)throw f.signalError;return{rows:[{accepted:f.accepted}]};}throw Error('Unexpected session query');};
 f.invoke=async(channel,input)=>{f.requests.push([channel,input]);if(channel==='copy-to-clipboard')return true;try{return{success:true,...await(channel==='list-postgres-sessions'?service.readSessions(f.query,f.options):service.manageSession(f.query,input,f.options))};}catch(error){return{success:false,...service.safeError(error)};}};return f;
}
const target=async(f,action='terminate')=>({...((await service.readSessions(f.query,f.options)).sessions[0]),action});
const signals=f=>f.calls.filter(([sql])=>sql.startsWith('SELECT pg_'));
async function selected(f,options){const h=await createPostgresSessionHarness(f.invoke,options);h.state.select(h.state.rows[0].id);await h.flush();return h;}
test('Session identities survive reorder, include sessions without locks and distinguish connection, backend, database and user generations',async()=>{
 const f=fixture(),first=await target(f);assert.ok(!service.SESSION_SQL.includes('pg_locks'));assert.equal((await service.readSessions(f.query,f.options)).sessions.length,4);f.rows.reverse();assert.equal((await service.readSessions(f.query,f.options)).sessions.at(-1).id,first.id);f.rows.reverse();
 for(const override of [{backend_start:'later'},{session_database_id:'9'},{user_id:'101'}]){const original=f.rows[0];f.rows[0]={...original,...override};assert.notEqual((await target(f)).id,first.id);f.rows[0]=original;}
 f.options.connectionId='new';assert.notEqual((await target(f)).id,first.id);assert.equal(first.querySeconds,'9007199254740993.000001');assert.equal(first.transactionSeconds,'3600.000001');
});
test('All application connections, internal sessions, missing identities, readonly and unprivileged targets are protected',async()=>{
 for(const override of [{pid:10},{pid:11},{pid:12},{backend_type:'autovacuum worker'},{backend_start:null},{session_database_id:null},{user_id:null},{member:false},{target_superuser:true}]){const f=fixture();Object.assign(f.rows[0],override);await assert.rejects(service.manageSession(f.query,await target(f),f.options),/protected/);assert.equal(signals(f).length,0);}
 for(const option of [{readonly:true},{protectionReady:false}]){const f=fixture();Object.assign(f.options,option);await assert.rejects(service.manageSession(f.query,await target(f),f.options),/readonly|protected/);assert.equal(signals(f).length,0);}
});
test('Restricted or disabled SQL is explicit; cancellation requires visible active SQL while idle queries remain observable as last SQL',async()=>{
 for(const [override,visibility]of [[{query:'<insufficient privilege>',state:null},'restricted'],[{query:'<command string not enabled>',state:'disabled'},'disabled'],[{query:null,state:'idle'},'unavailable']]){const f=fixture();Object.assign(f.rows[0],override);const row=await target(f);assert.equal(row.query,null);assert.equal(row.queryVisibility,visibility);assert.equal(row.canCancel,false);}
 const f=fixture();f.rows[0].state='idle in transaction';assert.equal((await target(f)).canCancel,false);assert.equal((await target(f)).query,'UPDATE DEMO SET VALUE=1');assert.match(service.SESSION_SQL,/CASE WHEN a.state='active'/);
});
test('Changed query start or text cannot be signalled using a stale selection',async()=>{
 for(const override of [{query_start:'later'},{query:'SELECT NEW'},{backend_type:'background worker'}]){const f=fixture(),request=await target(f);Object.assign(f.rows[0],override);await assert.rejects(service.manageSession(f.query,request,f.options),/target_changed/);assert.equal(signals(f).length,0);}
});
test('Common signal guard binds backend generation, ownership and observed SQL and distinguishes acceptance from completion',async()=>{
 const f=fixture();assert.equal((await service.manageSession(f.query,await target(f),f.options)).status,'ended');const [sql,binds]=signals(f)[0];assert.match(sql,/backend_start::text=\$2/);assert.match(sql,/query_start IS NOT DISTINCT FROM \$5/);assert.equal(binds[0],20);
 f.ended=false;assert.equal((await service.manageSession(f.query,await target(f),f.options)).status,'requested');f.accepted=false;await assert.rejects(service.manageSession(f.query,await target(f),f.options),/not_accepted/);
});
test('Cancellation verifies an active query, reports query completion and preserves unknown signal or observation outcomes',async()=>{
 const f=fixture(),base=f.query;f.query=(sql,binds)=>sql===service.TARGET_SQL?Promise.resolve({rows:[{state:'idle',query_start:f.rows[0].query_start}]}):base(sql,binds);assert.equal((await service.manageSession(f.query,await target(f,'cancel'),f.options)).status,'query-ended');assert.match(signals(f)[0][0],/AND state='active'/);
 f.query=(sql,binds)=>{if(sql===service.TARGET_SQL)throw Error('Lost observation');return base(sql,binds);};assert.equal((await service.manageSession(f.query,await target(f),f.options)).observationFailed,true);
 f.query=base;f.signalError=Object.assign(Error('Transport lost'),{code:'08006'});await assert.rejects(service.manageSession(f.query,await target(f),f.options),error=>{assert.equal(service.safeError(error).error,'pg_session_outcome_unknown');return true;});
});
test('Hook defaults to current database, filters states/search and disables actions for hidden selections',async()=>{
 const f=fixture(),h=await selected(f);assert.equal(h.state.rows.length,3);h.state.setScope('all');await h.flush();assert.equal(h.state.rows.length,4);h.state.select(h.state.rows.find(row=>row.pid===23).id);await h.flush();assert.equal(h.state.can('terminate'),true);h.state.setScope('current');await h.flush();assert.equal(h.state.can('terminate'),false);h.state.setFilter('idle-transaction');await h.flush();assert.deepEqual(h.state.rows.map(row=>row.pid),[21]);h.state.select(h.state.rows[0].id);await h.flush();assert.equal(h.state.can('cancel'),false);h.state.setSearch('unmatched');await h.flush();assert.equal(h.state.rows.length,0);assert.equal(h.state.can('terminate'),false);h.unmount();
});
test('Failed refresh retains old observations, blocks actions until retry and clears vanished connections',async()=>{
 const f=fixture(),h=await selected(f);f.failRead=true;await h.state.load();await h.flush();assert.ok(h.state.rows.length);assert.equal(h.state.ready,false);assert.equal(h.state.can('terminate'),false);f.failRead=false;await h.state.load();await h.flush();assert.equal(h.state.can('terminate'),true);f.rows=[];await h.state.load();await h.flush();assert.equal(h.state.selectedId,null);h.unmount();
});
test('Confirmation refusal writes nothing and duplicate requests send only one signal',async()=>{
 const f=fixture(),h=await selected(f,{confirm:()=>false});await h.state.command('terminate');assert.equal(signals(f).length,0);assert.ok(h.confirmations[0].includes('test'));h.unmount();const g=fixture(),j=await selected(g);await Promise.all([j.state.command('cancel'),j.state.command('cancel')]);await j.flush();assert.equal(signals(g).length,1);assert.equal(j.state.notice,'pg_session_ended');j.unmount();
});
test('Timers stop while hidden, late reads cannot overwrite activation, and mutation failure requires explicit reload',async()=>{
 const f=fixture(),h=await selected(f);h.state.setRefreshSeconds(5);await h.flush();assert.equal(h.timers.size,1);f.signalError=Object.assign(Error('private SQL'),{code:'42501'});await h.state.command('terminate');await h.flush();assert.equal(h.state.ready,false);assert.equal(h.state.errorCode,'42501');assert.equal(h.state.error,'pg_session_operation_failed');h.updateActive(false);await h.flush();assert.equal(h.timers.size,0);h.unmount();
 let finish;const g=fixture(),k=await createPostgresSessionHarness((channel,input)=>channel==='list-postgres-sessions'?new Promise(resolve=>{finish=resolve;}):g.invoke(channel,input));k.updateActive(false);await k.flush();finish({success:true,...await service.readSessions(g.query,g.options)});await k.flush();assert.equal(k.state.snapshot,null);assert.equal(k.state.ready,false);k.unmount();
});
test('A late mutation failure after reactivation triggers fresh observation instead of a stale error',async()=>{
 const f=fixture(),h=await selected(f),base=f.query;let reject;f.query=(sql,binds)=>sql.startsWith('SELECT pg_')?new Promise((_resolve,fail)=>{reject=fail;}):base(sql,binds);const pending=h.state.command('terminate');while(!reject)await new Promise(resolve=>setImmediate(resolve));h.updateActive(false);await h.flush();h.updateActive(true);await h.flush();reject(Error('Late error'));await pending;await h.waitFor(state=>state.ready&&!state.loading&&!state.acting);assert.equal(h.state.error,'');h.unmount();
});
test('Dedicated session IPC rejects other databases and never exposes SQL or main transaction state',async()=>{
 const {createDatabaseIpc}=require('./helpers/ddlEditors.cjs');const client={managePostgresSession:async()=>{throw Object.assign(Error('secret SQL'),{code:'42501'});}};const response=await createDatabaseIpc(client,'postgresql')('manage-postgres-session',{});assert.equal(response.errorCode,'42501');assert.equal(Object.hasOwn(response,'hasUncommittedTx'),false);assert.ok(!JSON.stringify(response).includes('secret'));assert.equal((await createDatabaseIpc(client,'oracle')('manage-postgres-session',{})).success,false);
});
test('One activity slot protects main work, blocks concurrent lock/session commands and rejects PID-only legacy operations',async()=>{
 const {loadModule}=require('./helpers/loadModule.cjs');const Client=loadModule('electron/postgres/postgresClient.js',{electron:{app:{isPackaged:true}}},{},{strict:false});const f=fixture(),client=new Client(),slot={id:1,isExecuting:false,client:{processID:12,getTransactionStatus:()=> 'I',query:f.query}};client.client={processID:10,query:()=>{throw Error('Main connection must remain untouched');}};client.metaClient={processID:11};client.bgPool=[slot];client.hasUncommittedTx=true;
 const row=(await client.readPostgresSessions()).sessions[0];let finish;slot.client.query=(sql,binds)=>sql.startsWith('SELECT pg_')?new Promise(resolve=>{finish=resolve;}):f.query(sql,binds);const pending=client.managePostgresSession({action:'terminate',id:row.id,fingerprint:row.fingerprint});while(!finish)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(client.managePostgresLock({}),/busy/);await assert.rejects(client.managePostgresSession({}),/busy/);finish({rows:[{accepted:true}]});await pending;assert.equal(slot.isExecuting,false);assert.equal(client.hasUncommittedTx,true);assert.equal((await client.killSession(20,null)).success,false);assert.equal((await client.cancelSQL(20,null)).success,false);
});
