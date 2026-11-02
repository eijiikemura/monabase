// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {postgresRoleFixture:fixture,createPostgresRoleHarness:createHarness}=require('./helpers/postgresRoleData.cjs');
const service=require('../electron/postgres/roleManagement');
const {createDatabaseIpc}=require('./helpers/ddlEditors.cjs');
const {loadModule}=require('./helpers/loadModule.cjs');
const writes=f=>f.calls.filter(([sql])=>/^(CREATE|ALTER|DROP) ROLE|^(GRANT|REVOKE) /.test(sql));
test('Pinned bootstrap role detail remains ready with a genuine empty dependency list', async () => {
 const f=fixture(),h=await createHarness(f.invoke);
 try {
  const bootstrap=h.state.rows.find(row=>row.oid==='10');assert.ok(bootstrap);
  h.state.select(bootstrap.identity);await h.flush();
  assert.equal(h.state.detailReady,true);assert.equal(h.state.detail.role.oid,'10');
  assert.equal(h.state.detail.dependencyCount,0);assert.deepEqual(h.state.detail.dependencies,[]);
  await h.state.reload();await h.flush();assert.equal(h.state.selectedId,bootstrap.identity);assert.equal(h.state.detailReady,true);
  assert.deepEqual(writes(f),[]);
 } finally {h.unmount();}
});
async function request(f,action='login',values={}){const role=(await f.manager.list(f.query,f.options)).roles.find(row=>row.oid==='200'),detail=await f.manager.detail(f.query,role,f.options);return{action,target:{oid:role.oid,identity:role.identity,name:role.name},expected:detail.fingerprint,enabled:false,...values};}
async function run(f,input,extra={}){const review=await f.manager.review(f.query,input,f.options);return f.execute({...review.request,token:review.token,...extra});}
async function selected(f){const h=await createHarness(f.invoke);h.state.select(h.state.rows.find(row=>row.oid==='200').identity);await h.flush();return h;}
test('Role identities use OID and connection scope, preserve exact names and metadata, and survive list reorder',async()=>{
 const f=fixture(),a=await f.manager.list(f.query,f.options);f.roles.reverse();const b=await f.manager.list(f.query,f.options);assert.equal(a.roles[2].identity,b.roles.find(row=>row.oid==='200').identity);assert.equal(a.roles[2].name,'AppUser\'"');assert.equal(a.roles[2].connectionLimit,-1);f.options.connectionId='new';await assert.rejects(f.manager.detail(f.query,a.roles[2],f.options),/target_changed/);
});
test('System and session identities are protected while an explicit self-password change remains possible',async()=>{
 const f=fixture(),snapshot=await f.manager.list(f.query,f.options);
 for(const oid of ['100','500']){const row=snapshot.roles.find(row=>row.oid===oid);assert.equal(row.canDrop,false);assert.equal(row.canLogin,false);assert.equal(row.canSuperuser,false);}
 assert.equal(snapshot.roles.find(row=>row.oid==='100').canPassword,true);assert.equal(snapshot.roles.find(row=>row.oid==='500').canPassword,false);
 f.options.readonly=true;assert.ok((await f.manager.list(f.query,f.options)).roles.every(row=>!row.canPassword && !row.canDrop));await assert.rejects(f.manager.review(f.query,{action:'create',newName:'Test',login:false,passwordMode:'none'},f.options),/readonly/);
});
test('Version-specific CREATEROLE and ADMIN conditions determine authority without enabling SUPERUSER changes',async()=>{
 const f=fixture();Object.assign(f.roles.find(row=>row.oid==='100'),{superuser:false,create_role:true});let s=await f.manager.list(f.query,f.options);assert.equal(s.roles.find(row=>row.oid==='200').canDrop,false);
 f.roles.find(row=>row.oid==='200').actor_admin=true;s=await f.manager.list(f.query,f.options);assert.equal(s.roles.find(row=>row.oid==='200').canDrop,true);assert.equal(s.roles.find(row=>row.oid==='200').canSuperuser,false);
 f.version=150000;f.roles.find(row=>row.oid==='200').actor_admin=false;assert.equal((await f.manager.list(f.query,f.options)).roles.find(row=>row.oid==='200').canLogin,true);
 f.roles.find(row=>row.oid==='200').replication=true;assert.equal((await f.manager.list(f.query,f.options)).roles.find(row=>row.oid==='200').canPassword,false);
});
test('Password review never receives, retains or returns plaintext and final SQL preserves quotes, backslashes and target case',async()=>{
 const f=fixture(),secret="DUMMY-'\\secret",input=await request(f,'password',{passwordMode:'set'}),review=await f.manager.review(f.query,{...input,password:secret},f.options);
 assert.ok(!JSON.stringify(review).includes(secret));assert.equal(review.request.password,undefined);assert.ok(review.sql.includes('"AppUser\'"""'));assert.ok(review.sql.endsWith("PASSWORD '<redacted>'"));
 const result=await f.execute({...review.request,token:review.token,password:secret});assert.equal(result.passwordChanged,true);assert.ok(!JSON.stringify(result).includes(secret));assert.ok(writes(f)[0][0].endsWith("PASSWORD E'DUMMY-''\\\\secret'"));
});
test('Password markers inside role names are never replaced and password modes are explicit',async()=>{
 const f=fixture();f.roles.find(row=>row.oid==='200').name="'<redacted>'";await run(f,await request(f,'password',{passwordMode:'set'}),{password:'DUMMY'});assert.ok(writes(f)[0][0].startsWith('ALTER ROLE "\'<redacted>\'" PASSWORD E\'DUMMY\''));
 await run(f,await request(f,'password',{passwordMode:'none'}));assert.ok(writes(f).at(-1)[0].endsWith('PASSWORD NULL'));
 for(const password of ['', 'x\0', 'x'.repeat(4097)]){const review=await f.manager.review(f.query,await request(f,'password',{passwordMode:'set'}),f.options);await assert.rejects(f.execute({...review.request,token:review.token,password}),/invalid_password/);}
});
test('NOLOGIN group creation needs no password while LOGIN and password configuration are explicit',async()=>{
 for(const [login,passwordMode]of [[false,'none'],[true,'none'],[true,'set']]){const f=fixture();const r=await run(f,{action:'create',newName:'MiXeD\'"',login,passwordMode},{password:'DUMMY'});assert.equal(r.snapshot.roles.find(row=>row.oid==='700').name,'MiXeD\'"');assert.equal(r.snapshot.roles.find(row=>row.oid==='700').login,login);assert.equal(writes(f).length,1);}
 const f=fixture();for(const name of ['', ' pg_test','pg_test','PUBLIC','x\n','é'.repeat(32)])await assert.rejects(f.manager.review(f.query,{action:'create',newName:name,login:false,passwordMode:'none'},f.options),/invalid_name/);
 await assert.rejects(f.manager.review(f.query,{action:'create',newName:'Group',login:false,passwordMode:'set'},f.options),/invalid_request/);
});
test('Direct grants keep grantor and ADMIN/INHERIT/SET separate from indirect membership access',async()=>{
 const f=fixture(),d=await f.manager.detail(f.query,(await f.manager.list(f.query,f.options)).roles.find(row=>row.oid==='200'),f.options);assert.equal(d.memberships[0].grantorId,'10');assert.equal(d.memberships[0].inherit,true);assert.equal(d.effectiveRoles.find(row=>row.oid==='300').direct,true);assert.equal(d.effectiveRoles.find(row=>row.oid==='400').direct,false);
 await run(f,await request(f,'grant',{roleId:'400',grantorId:'10',admin:true,inherit:false,set:true}));assert.match(writes(f)[0][0],/WITH ADMIN TRUE, INHERIT FALSE, SET TRUE GRANTED BY "bootstrap"/);
});
test('Revocation targets one grantor with RESTRICT and supports option-only changes without removing other grants',async()=>{
 const f=fixture();f.memberships.push({roleId:'300',memberId:'200',grantorId:'100',admin:true,inherit:true,set:true});
 await run(f,await request(f,'revoke',{roleId:'300',grantorId:'100',revokeOption:'admin'}));assert.equal(f.memberships.find(m=>m.grantorId==='100').admin,false);assert.equal(f.memberships.filter(m=>m.memberId==='200').length,2);assert.match(writes(f)[0][0],/REVOKE ADMIN OPTION FOR .* GRANTED BY "TestAdmin" RESTRICT/);
 await run(f,await request(f,'revoke',{roleId:'300',grantorId:'100',revokeOption:'membership'}));assert.equal(f.memberships.filter(m=>m.memberId==='200').length,1);
});
test('Legacy membership SQL omits unsupported option columns and GRANTED BY while permitting ADMIN revocation',async()=>{
 const f=fixture();f.version=150000;f.memberships[0].admin=true;const d=await f.manager.detail(f.query,(await f.manager.list(f.query,f.options)).roles.find(row=>row.oid==='200'),f.options);assert.equal(d.memberships[0].inherit,null);assert.ok(!service.membershipSql(150000).includes('inherit_option'));
 await run(f,await request(f,'revoke',{roleId:'300',grantorId:'10',revokeOption:'admin'}));assert.ok(!writes(f)[0][0].includes('GRANTED BY'));
 await assert.rejects(f.manager.review(f.query,await request(f,'grant',{roleId:'300',grantorId:'100',admin:false,inherit:true}),f.options),/invalid_request/);
});
test('Self membership, cycles, false authority and stale grantors cannot be submitted',async()=>{
 const f=fixture();await assert.rejects(f.manager.review(f.query,await request(f,'grant',{roleId:'200',grantorId:'10',admin:false,inherit:true,set:true}),f.options),/invalid_membership/);
 f.memberships.push({roleId:'200',memberId:'400',grantorId:'10',admin:false,inherit:true,set:true});await assert.rejects(f.manager.review(f.query,await request(f,'grant',{roleId:'400',grantorId:'10',admin:false,inherit:true,set:true}),f.options),/permission/);
 Object.assign(f.roles.find(row=>row.oid==='100'),{superuser:false,create_role:false});await assert.rejects(f.manager.review(f.query,await request(f,'revoke',{roleId:'300',grantorId:'10',revokeOption:'membership'}),f.options),/permission/);assert.equal(writes(f).length,0);
});
test('Cluster dependencies block deletion and confirmed empty role deletion has no automatic ownership cleanup',async()=>{
 const f=fixture();f.dependencies=[{database_id:'6',database:'other',class_id:'1259',object_id:'1',sub_id:0,dependency_type:'o',description:null,total:'201'}];await assert.rejects(f.manager.review(f.query,await request(f,'drop'),f.options),/dependencies/);assert.equal(writes(f).length,0);f.dependencies=[];
 const review=await f.manager.review(f.query,await request(f,'drop'),f.options);await assert.rejects(f.execute({...review.request,token:review.token,confirmName:'wrong'}),/confirmation_mismatch/);await f.execute({...review.request,token:review.token,confirmName:review.request.target.name});assert.equal(writes(f).length,1);assert.match(writes(f)[0][0],/^DROP ROLE /);
});
test('Review binds identity, attributes, membership and dependencies and cannot be replayed',async()=>{
 for(const change of [f=>{f.roles[2].login=false;},f=>{f.memberships[0].admin=true;},f=>{f.dependencies=[{total:'1'}];},f=>{f.options.connectionId='other';}]){const f=fixture(),r=await f.manager.review(f.query,await request(f),f.options);change(f);await assert.rejects(f.execute({...r.request,token:r.token}),/conflict|review_expired/);assert.equal(writes(f).length,0);}
 const f=fixture(),r=await f.manager.review(f.query,await request(f),f.options);await f.execute({...r.request,token:r.token});await assert.rejects(f.execute({...r.request,token:r.token}),/review_expired/);
});
test('Warnings or suppressed mutations do not count as application and driver messages cannot expose credentials',async()=>{
 const f=fixture();f.noEffect=true;await assert.rejects(run(f,await request(f)),/not_applied/);
 const response=service.safeError(Object.assign(Error('DUMMY_PASSWORD SQL'),{code:'42501'}));assert.deepEqual(response,{error:'pg_role_operation_failed',errorCode:'42501'});assert.equal(service.safeError(Object.assign(Error('private'),{pgPrivUnknown:true})).error,'pg_role_outcome_unknown');assert.equal(service.safeError(Error('pg_role_dummy_password')).error,'pg_role_operation_failed');
});
test('Hook preserves real pgx roles, retains failed list/detail observations and disables filtered or unverified commands',async()=>{
 const f=fixture(),h=await selected(f);assert.ok(h.state.rows.some(row=>row.name==='pgx'));assert.ok(!h.state.rows.some(row=>row.name==='pg_monitor'));h.state.setIncludeSystem(true);await h.flush();assert.ok(h.state.rows.some(row=>row.name==='pg_monitor'));
 const detail=h.state.detail;f.failDetail=true;await h.state.retryDetail();await h.flush();assert.equal(h.state.detail,detail);assert.equal(h.state.detailReady,false);assert.equal(h.state.can('password'),false);f.failDetail=false;await h.state.retryDetail();await h.flush();h.state.setSearch('pgx');await h.flush();assert.equal(h.state.can('drop'),false);h.state.setSearch('');await h.flush();f.failList=true;await h.state.reload();await h.flush();assert.ok(h.state.rows.length);assert.equal(h.state.ready,false);assert.equal(h.state.can('drop'),false);h.unmount();
});
test('Hook reviews without passwords, clears secrets after execution and requires reload, new password and renewed acknowledgement after failure',async()=>{
 const f=fixture(),h=await selected(f);h.state.open('password');await h.flush();h.state.changePassword('DUMMY');await h.flush();await h.state.prepare();await h.flush();assert.ok(h.state.review);assert.equal(f.requests.find(([channel])=>channel==='review-postgres-role-operation')[1].password,undefined);h.state.setAcknowledged(true);await h.flush();f.writeError=Error('DUMMY');await h.state.execute();await h.flush();assert.equal(h.state.password,'');assert.equal(h.state.error,'pg_role_operation_failed');assert.equal(h.state.ready,false);assert.equal(h.state.review,null);assert.equal(h.state.draft.target.name,'AppUser\'"');f.writeError=null;await h.state.reload();await h.flush();h.state.changePassword('NEW_DUMMY');await h.flush();await h.state.prepare();await h.flush();assert.equal(h.state.canExecute,false);h.state.close();await h.flush();assert.equal(h.state.password,'');h.unmount();
});
test('Hook blocks duplicate writes and closure, rejects late activation responses and clears passwords on hide',async()=>{
 const f=fixture();let finish;const original=f.invoke;const h=await createHarness((channel,input)=>channel==='execute-postgres-role-operation'?new Promise(resolve=>{finish=()=>original(channel,input).then(resolve);}):original(channel,input));h.state.select(h.state.rows.find(row=>row.oid==='200').identity);await h.flush();h.state.open('login');await h.flush();await h.state.prepare();await h.flush();h.state.setAcknowledged(true);await h.flush();const pending=h.state.execute();await h.flush();h.state.close();assert.ok(h.state.draft);await h.state.execute();h.updateActive(false);await h.flush();assert.equal(h.state.password,'');h.updateActive(true);await h.flush();finish();await pending;await h.flush();assert.equal(writes(f).length,1);assert.equal(h.state.error,'');assert.equal(h.state.rows.find(row=>row.oid==='200').login,false);h.unmount();
});
test('Late reads and credential-bearing IPC errors are ignored or sanitized; other database types are rejected',async()=>{
 const f=fixture();let resolve;const h=await createHarness(()=>new Promise(done=>{resolve=done;}));h.updateActive(false);await h.flush();resolve({success:true,...await f.manager.list(f.query,f.options)});await h.flush();assert.equal(h.state.snapshot,null);h.unmount();
 const client={executeRoleOperation:async()=>{throw Object.assign(Error('DUMMY password SQL'),{code:'42501'});}};const response=await createDatabaseIpc(client,'postgresql')('execute-postgres-role-operation',{});assert.equal(response.error,'pg_role_operation_failed');assert.equal(response.hasUncommittedTx,undefined);assert.equal((await createDatabaseIpc(client,'oracle')('execute-postgres-role-operation',{})).error,'pg_role_not_connected');
});
test('Role client reuses isolated transactions, prevents duplicate writes and refuses pending background work without touching main',async()=>{
 const Client=loadModule('electron/postgres/postgresClient.js',{electron:{app:{isPackaged:true}}},{},{strict:false});const client=new Client(),f=fixture(),calls=[];let status='I',finish,closed=0;
 const slot={id:1,isExecuting:false,client:{getTransactionStatus:()=>status,query:async(sql,binds)=>{calls.push(sql);if(/^(BEGIN|ROLLBACK|COMMIT|SET LOCAL)/.test(sql))return{rows:[]};return f.query(sql,binds);},end:async()=>{closed++;}}};client.client={query:()=>{throw Error('Main must never be used');}};client.hasUncommittedTx=true;client.bgPool=[slot];client.getAvailableBgClient=async()=>{slot.isExecuting=true;return slot;};
 await client.listManagedRoles();assert.ok(calls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));assert.ok(calls.includes('ROLLBACK'));assert.equal(client.hasUncommittedTx,true);
 for(status of ['T','E',undefined])await assert.rejects(client.listManagedRoles(),/busy/);status='I';
 client.roleManager={execute:()=>new Promise(resolve=>{finish=resolve;})};const pending=client.executeRoleOperation({});while(!finish)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(client.executeRoleOperation({}),/busy/);finish({applied:true});await pending;assert.ok(calls.includes('COMMIT'));assert.equal(slot.isExecuting,false);
 const base=slot.client.query;slot.client.query=(sql,binds)=>sql==='COMMIT'?Promise.reject(Error('Disconnected')):base(sql,binds);client.roleManager={execute:async()=>({applied:true})};await assert.rejects(client.executeRoleOperation({}),error=>service.safeError(error).error==='pg_role_outcome_unknown');assert.equal(client.hasUncommittedTx,true);assert.equal(closed,0);
});

test('Option-only revocation must retain the membership row and failed statements roll back rather than report success',async()=>{
 const f=fixture();f.memberships[0].admin=true;const base=f.query;
 f.query=async(sql,binds)=>{if(sql.startsWith('REVOKE')){f.memberships=f.memberships.filter(row=>row.memberId!=='200');return{rows:[]};}return base(sql,binds);};
 await assert.rejects(run(f,await request(f,'revoke',{roleId:'300',grantorId:'10',revokeOption:'admin'})),/not_applied/);
});
