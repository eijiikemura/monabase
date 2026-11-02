// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const {test}=require('node:test');
const service=require('../electron/postgres/tablespaceManagement');
const {postgresTablespaceFixture:fixture,createPostgresTablespaceHarness:createHarness}=require('./helpers/postgresTablespaceData.cjs');
const {loadModule}=require('./helpers/loadModule.cjs');
const {createDatabaseIpc}=require('./helpers/ddlEditors.cjs');
async function request(f,action='rename',extra={}){const row=(await f.manager.list(f.query,f.options)).tablespaces[0],detail=await f.manager.detail(f.query,row,f.options);return{action,target:{oid:row.oid,identity:row.identity,name:row.name},expected:detail.fingerprint,newName:'Renamed',...extra};}
const writes=f=>f.calls.filter(([sql])=>/^(CREATE|ALTER|DROP) TABLESPACE/.test(sql));
async function selected(f){const h=await createHarness(f.invoke);h.state.select(h.state.rows[0].identity);await h.flush();return h;}
test('Tablespace identities survive ordering and rename but reject connection changes; sizes remain exact strings',async()=>{
 const f=fixture(),a=(await f.manager.list(f.query,f.options)).tablespaces[0];f.tablespaces.reverse();assert.equal((await f.manager.list(f.query,f.options)).tablespaces.at(-1).identity,a.identity);f.tablespaces.reverse();
 const detail=await f.manager.detail(f.query,a,f.options);assert.equal(detail.bytes,'900719925474099312345');assert.equal(detail.objectCount,0);assert.equal((await f.manager.list(f.query,f.options)).tablespaces[1].locationKind,'default');assert.equal((await f.manager.list(f.query,f.options)).tablespaces[2].locationKind,'global');
 f.options.connectionId='new';await assert.rejects(f.manager.detail(f.query,a,f.options),/target_changed/);
});
test('Protected built-ins, read-only connections and unavailable owner authority cannot be changed',async()=>{
 for(const name of ['pg_default','pg_global']){const f=fixture(),row=(await f.manager.list(f.query,f.options)).tablespaces.find(row=>row.name===name),d=await f.manager.detail(f.query,row,f.options);assert.equal(row.canDrop,false);await assert.rejects(f.manager.review(f.query,{action:'drop',target:row,expected:d.fingerprint},f.options),/protected/);}
 const f=fixture();f.roles[0].superuser=false;f.roles[0].usable=false;const snapshot=await f.manager.list(f.query,f.options);assert.equal(snapshot.context.canCreate,false);assert.equal(snapshot.tablespaces[0].canRename,false);await assert.rejects(f.manager.review(f.query,await request(f),f.options),/permission/);
 f.options.readonly=true;await assert.rejects(f.manager.review(f.query,{action:'create',newName:'New',location:'/srv/new'},f.options),/readonly/);assert.equal(writes(f).length,0);
});
test('Names, roles and physical paths are safely quoted and invalid identifiers or paths are rejected before SQL',async()=>{
 const f=fixture(),r=await f.manager.review(f.query,{action:'create',newName:'team\'"space',ownerId:'20',location:"C:\\team's\\space"},f.options);assert.match(r.sql,/"team'""space"/);assert.match(r.sql,/OWNER "other""owner"/);assert.ok(r.sql.includes("E'C:\\\\team''s\\\\space'"));
 for(const name of ['', ' pg_test','pg_test','x\n','é'.repeat(32)])await assert.rejects(f.manager.review(f.query,{action:'create',newName:name,location:'/srv/new'},f.options),/invalid_name/);
 for(const path of ['relative',' /srv/test','/srv/test\n',''])await assert.rejects(f.manager.review(f.query,{action:'create',newName:'New',location:path},f.options),/invalid_location/);
 assert.equal(writes(f).length,0);
});
test('Deletion refuses database defaults, files, current objects and unknown usage without inventing empty usage',async()=>{
 for(const mutate of [f=>{f.databases=[{oid:'6',name:'other',default_space:true,has_files:false}];},f=>{f.objects=[{oid:'1',schema:'test',name:'t',kind:'r',total:'1'}];},f=>{f.deniedDatabases=true;},f=>{f.objects=[{oid:'1',schema:'test',name:'t',kind:'r',total:'201'}];}]){const f=fixture();mutate(f);await assert.rejects(f.manager.review(f.query,await request(f,'drop'),f.options),/not_empty|usage_unknown/);assert.equal(writes(f).length,0);}
 const f=fixture();f.deniedSize=true;const d=await f.manager.detail(f.query,(await f.manager.list(f.query,f.options)).tablespaces[0],f.options);assert.equal(d.bytes,null);assert.equal(d.sizeError,'pg_ts_permission');
 f.failDetail=true;await assert.rejects(f.manager.detail(f.query,d.tablespace,f.options),/Detail failed/);
});
test('Reviewed rename, owner transfer, creation and drop are verified and tokens cannot be replayed',async()=>{
 for(const action of ['rename','owner','create','drop']){const f=fixture();const input=action==='create'?{action,newName:'Created',location:'/srv/new',ownerId:'10'}:await request(f,action,action==='owner'?{ownerId:'20'}:{});const review=await f.manager.review(f.query,input,f.options);
 if(action==='drop')await assert.rejects(f.manager.execute(f.query,{...review.request,token:review.token,confirmName:'wrong'},f.options),/confirmation_mismatch/);
 const result=await f.manager.execute(f.query,{...review.request,token:review.token,confirmName:review.request.target?.name},f.options);assert.equal(result.applied,true);assert.equal(writes(f).length,1);assert.ok(!f.calls.some(([sql])=>/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)));await assert.rejects(f.manager.execute(f.query,{...review.request,token:review.token},f.options),/review_expired/);}
});
test('Concurrent metadata, stale reviews, unchanged owners and rejected owner roles cannot mutate tablespaces',async()=>{
 for(const mutate of [f=>{f.tablespaces[0].revision='2';},f=>{f.roles[0].superuser=false;},f=>{f.options.connectionId='other';}]){const f=fixture(),r=await f.manager.review(f.query,await request(f),f.options);mutate(f);await assert.rejects(f.manager.execute(f.query,{...r.request,token:r.token},f.options),/conflict|review_expired|permission/);assert.equal(writes(f).length,0);}
 const f=fixture();await assert.rejects(f.manager.review(f.query,await request(f,'owner',{ownerId:'10'}),f.options),/no_changes/);f.roles[1].settable=false;await assert.rejects(f.manager.review(f.query,await request(f,'owner',{ownerId:'20'}),f.options),/permission/);
});
test('Known SQL errors, uncertain execution, completed SQL with failed observation and missing application are distinguished',async()=>{
 for(const [kind,expected,applied]of [['known','pg_ts_operation_failed',false],['network','pg_ts_outcome_unknown',false],['transportState','pg_ts_outcome_unknown',false],['observe','pg_ts_operation_failed',true],['noEffect','pg_ts_verification_failed',true]]){const f=fixture(),r=await f.manager.review(f.query,await request(f),f.options);if(kind==='known')f.failWrite=Object.assign(Error('private'),{code:'42501'});if(kind==='network')f.failWrite=Error('private');if(kind==='transportState')f.failWrite=Object.assign(Error('private'),{code:'08006'});if(kind==='observe')f.failAfter=true;if(kind==='noEffect')f.noEffect=true;let failure;try{await f.manager.execute(f.query,{...r.request,token:r.token},f.options);}catch(error){failure=service.safeError(error);}assert.equal(failure.error,expected);assert.equal(failure.applied,applied);assert.ok(!JSON.stringify(failure).includes('private'));}
});
test('Hook retains failed observations, disables changes and preserves drafts for reload and renewed review',async()=>{
 const f=fixture(),h=await selected(f);assert.equal(h.state.can('rename'),true);h.state.open('rename');await h.flush();h.state.update({newName:'Renamed'});await h.flush();await h.state.prepare();await h.flush();assert.ok(h.state.review);h.state.setAcknowledged(true);await h.flush();f.failWrite=Error('Network');await h.state.execute();await h.flush();assert.equal(h.state.error,'pg_ts_outcome_unknown');assert.equal(h.state.ready,false);assert.equal(h.state.draft.newName,'Renamed');assert.equal(h.state.review,null);assert.equal(h.state.canExecute,false);
 f.failList=true;await h.state.reload();await h.flush();assert.equal(h.state.rows.length,3);assert.equal(h.state.can('rename'),false);f.failList=false;f.failWrite=null;await h.state.reload();await h.flush();assert.equal(h.state.detailReady,true);assert.equal(h.state.draft.newName,'Renamed');await h.state.prepare();await h.flush();assert.equal(h.state.canExecute,false);h.unmount();
});
test('Hook requires current detail, prevents hidden selection commands and retains failed detail',async()=>{
 const f=fixture(),h=await selected(f);const detail=h.state.detail;f.failDetail=true;await h.state.retryDetail();await h.flush();assert.equal(h.state.detail,detail);assert.equal(h.state.detailReady,false);assert.equal(h.state.can('drop'),false);f.failDetail=false;await h.state.retryDetail();await h.flush();h.state.setSearch('pg_global');await h.flush();assert.equal(h.state.can('rename'),false);assert.equal(h.state.pagination.page,0);h.unmount();
});
test('Hook blocks duplicate writes and closure, discards late activation results and reloads after hidden completion',async()=>{
 const f=fixture();let finish;const original=f.invoke;const h=await createHarness((channel,input)=>channel==='execute-postgres-tablespace-operation'?new Promise(resolve=>{finish=()=>original(channel,input).then(resolve);}):original(channel,input));h.state.select(h.state.rows[0].identity);await h.flush();h.state.open('rename');await h.flush();h.state.update({newName:'Renamed'});await h.flush();await h.state.prepare();await h.flush();h.state.setAcknowledged(true);await h.flush();const pending=h.state.execute();await h.flush();h.state.close();assert.ok(h.state.draft);await h.state.execute();h.updateActive(false);await h.flush();h.updateActive(true);await h.flush();finish();await pending;await h.flush();assert.equal(writes(f).length,1);assert.equal(h.state.error,'');assert.equal(h.state.rows[0].name,'Renamed');h.unmount();
});
test('Late initial reads do not populate hidden windows',async()=>{
 const f=fixture();let resolve;const h=await createHarness(()=>new Promise(done=>{resolve=done;}));h.updateActive(false);await h.flush();resolve({success:true,...await f.manager.list(f.query,f.options)});await h.flush();assert.equal(h.state.snapshot,null);assert.equal(h.state.ready,false);h.unmount();
});
test('Tablespace IPC rejects other DB types and sanitizes failures without transaction status',async()=>{
 const client={listPostgresTablespaces:async()=>{throw Object.assign(Error('password path SQL'),{code:'42501'});}};const response=await createDatabaseIpc(client,'postgresql')('list-postgres-tablespaces');assert.equal(response.error,'pg_ts_operation_failed');assert.equal(response.errorCode,'42501');assert.equal(response.hasUncommittedTx,undefined);assert.equal((await createDatabaseIpc(client,'oracle')('list-postgres-tablespaces')).error,'pg_ts_not_connected');
});
test('Client reserves idle background slots, refuses unknown or pending transactions and never touches main edits',async()=>{
 const Client=loadModule('electron/postgres/postgresClient.js',{electron:{app:{isPackaged:true}}},{},{strict:false});
 const f=fixture(),client=new Client(),calls=[],slot={id:1,isExecuting:false,client:{getTransactionStatus:()=> 'I',query:async(sql,binds)=>{calls.push(sql);return f.query(sql,binds);},end:async()=>{}}};client.client={query:()=>{throw Error('Main must not be used');}};client.hasUncommittedTx=true;client.bgPool=[slot];client.getAvailableBgClient=async()=>{slot.isExecuting=true;return slot;};
 await assert.rejects(client.getTablespaceDetails('name-only'),/identity_required/);await client.listPostgresTablespaces();assert.equal(slot.isExecuting,false);assert.equal(client.hasUncommittedTx,true);assert.ok(!calls.some(sql=>/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)));
 for(const status of ['T','E',undefined]){slot.client.getTransactionStatus=()=>status;await assert.rejects(client.listPostgresTablespaces(),/busy/);assert.equal(slot.isExecuting,false);}
 client.isReadonly=true;await assert.rejects(client.executePostgresTablespaceOperation({}),/readonly/);assert.equal(client.tablespaceCommandPending,false);
});

test('Client rejects simultaneous storage writes and discards broken connections after unknown execution',async()=>{
 const Client=loadModule('electron/postgres/postgresClient.js',{electron:{app:{isPackaged:true}}},{},{strict:false});const client=new Client(),f=fixture();let closed=0,finish;
 const slot={id:1,isExecuting:false,client:{getTransactionStatus:()=> 'I',query:f.query,end:async()=>{closed++;}}};client.client={};client.bgPool=[slot];client.getAvailableBgClient=async()=>{slot.isExecuting=true;return slot;};
 client.tablespaceManager={execute:()=>new Promise(resolve=>{finish=resolve;})};const pending=client.executePostgresTablespaceOperation({});while(!finish)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(client.executePostgresTablespaceOperation({}),/busy/);finish({applied:true});await pending;assert.equal(slot.isExecuting,false);
 client.tablespaceManager={execute:async()=>{throw Object.assign(Error('private'),{pgTsUnknown:true});}};await assert.rejects(client.executePostgresTablespaceOperation({}),/private/);assert.equal(client.bgPool.length,0);assert.equal(closed,1);assert.equal(client.tablespaceCommandPending,false);
});
