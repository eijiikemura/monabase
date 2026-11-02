// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {oracleUserRoleFixture:fixture,createOracleUserRoleHarness:createHarness}=require('./helpers/oracleUserRoleData.cjs');
const service=require('../electron/oracle/userRoleManagement');
const {createDatabaseIpc}=require('./helpers/ddlEditors.cjs');
const {loadModule}=require('./helpers/loadModule.cjs');
async function request(f,action='lock',extra={}){const row=(await f.manager.list(f.query,f.options)).principals.find(row=>row.name==="AppUser's"),detail=await f.manager.detail(f.query,row,f.options);return{action,target:{identity:row.identity,name:row.name,kind:row.kind},expected:detail.fingerprint,locked:true,...extra};}
async function run(f,input,extra={}){const review=await f.manager.review(f.query,input,f.options);return f.execute({...review.request,token:review.token,...extra});}
const writes=f=>f.calls.filter(([sql])=>/^(CREATE|ALTER|DROP|GRANT|REVOKE) /.test(sql));
async function selected(f){const h=await createHarness(f.invoke);h.state.select(h.state.rows.find(row=>row.name==="AppUser's").identity);await h.flush();return h;}
test('Oracle exact names, numeric identity and container generations are retained without uppercasing',async()=>{
 const f=fixture(),snapshot=await f.manager.list(f.query,f.options),row=snapshot.principals[1];assert.equal(row.name,"AppUser's");f.users.reverse();assert.equal((await f.manager.list(f.query,f.options)).principals.find(r=>r.id===row.id).identity,row.identity);f.container='4';await assert.rejects(f.manager.detail(f.query,row,f.options),/target_changed/);f.container='3';f.options.connectionId='new';await assert.rejects(f.manager.detail(f.query,row,f.options),/target_changed/);
});
test('Expired accounts are unlocked but not OPEN; timed locks and unknown account states are distinct',async()=>{
 const f=fixture();assert.equal((await f.manager.list(f.query,f.options)).principals[1].locked,false);
 f.users[1].ACCOUNT_STATUS='EXPIRED & LOCKED(TIMED)';assert.equal((await f.manager.list(f.query,f.options)).principals[1].locked,true);await run(f,await request(f,'lock',{locked:false}));assert.equal(f.users[1].ACCOUNT_STATUS,'EXPIRED');
 f.users[1].ACCOUNT_STATUS='UNKNOWN';assert.equal((await f.manager.list(f.query,f.options)).principals[1].canLock,false);
});
test('Self, Oracle maintained/common users, CDB root, read-only and incomplete catalogs cannot be destructively changed',async()=>{
 const f=fixture();let snapshot=await f.manager.list(f.query,f.options);assert.equal(snapshot.principals.find(row=>row.name==='TEST').canDrop,false);assert.equal(snapshot.principals.find(row=>row.name==='SYS').canPassword,false);
 for(const mutate of [f=>{f.options.readonly=true;},f=>{f.container='1';},f=>{f.visible=true;}]){const a=fixture();mutate(a);snapshot=await a.manager.list(a.query,a.options);assert.equal(snapshot.context.canCreateUser,false);assert.ok(snapshot.principals.every(row=>!row.canDrop));await assert.rejects(a.manager.review(a.query,{action:'create',kind:'USER',newName:'Mixed'},a.options),/readonly|restricted/);}
 f.privileges=[];assert.equal((await f.manager.list(f.query,f.options)).principals[1].canLock,false);
});
test('Password review is secret-free, preserves target case, and enforces Oracle password restrictions',async()=>{
 const f=fixture(),secret="Dummy'\\Pass1",input=await request(f,'password'),review=await f.manager.review(f.query,{...input,password:secret},f.options);assert.ok(!JSON.stringify(review).includes(secret));assert.equal(review.request.password,undefined);assert.equal(review.sql,'ALTER USER "AppUser\'s" IDENTIFIED BY "<redacted>"');
 await f.execute({...review.request,token:review.token,password:secret});assert.ok(writes(f)[0][0].endsWith('"'+secret+'"'));
 for(const password of ['', 'a"b','a\nb','a\0','x'.repeat(31)]){const r=await f.manager.review(f.query,await request(f,'password'),f.options);await assert.rejects(f.execute({...r.request,token:r.token,password}),/invalid_password/);}
});
test('Local users and ordinary roles have separate creation and deletion with no automatic CREATE SESSION grant',async()=>{
 for(const kind of ['USER','ROLE']){const f=fixture();const result=await run(f,{action:'create',kind,newName:'MiXeD'},kind==='USER'?{password:'Dummy123'}:{});const row=result.snapshot.principals.find(row=>row.name==='MiXeD');assert.equal(row.kind,kind);assert.equal(writes(f).length,1);const d=await f.manager.detail(f.query,row,f.options);await run(f,{action:'drop',target:row,expected:d.fingerprint,cascade:false},{confirmName:row.name});assert.equal(writes(f).length,2);assert.ok(!writes(f)[1][0].includes('CASCADE'));}
 const f=fixture();for(const newName of ['', ' x','bad"name','x\n','x'.repeat(129),'PUBLIC'])await assert.rejects(f.manager.review(f.query,{action:'create',kind:'USER',newName},f.options),/invalid_name/);
});
test('Owned objects require explicit CASCADE, complete dependency review and exact-name confirmation',async()=>{
 const f=fixture();f.dependencies=[{OWNER:"AppUser's",NAME:'DATA',KIND:'TABLE',RELATION:'OWNED',TOTAL:1}];await assert.rejects(f.manager.review(f.query,await request(f,'drop',{cascade:false}),f.options),/has_objects/);const review=await f.manager.review(f.query,await request(f,'drop',{cascade:true}),f.options);assert.match(review.sql,/ CASCADE$/);await assert.rejects(f.execute({...review.request,token:review.token,confirmName:'wrong'}),/confirmation_mismatch/);await f.execute({...review.request,token:review.token,confirmName:"AppUser's"});assert.equal(writes(f).length,1);
 const a=fixture();a.dependencies=[{OWNER:'OTHER',NAME:'LINK',KIND:'VIEW',RELATION:'DEPENDENT',TOTAL:201}];await assert.rejects(a.manager.review(a.query,await request(a,'drop',{cascade:true}),a.options),/dependencies_unknown/);
});
test('Direct, PUBLIC and role-derived privileges are distinct; inherited/common grants are read-only',async()=>{
 const f=fixture(),d=await f.manager.detail(f.query,(await request(f)).target,f.options);assert.equal(d.grants[0].defaultRole,true);assert.ok(d.effective.some(row=>row.source==='PUBLIC' && !row.direct));assert.ok(d.effective.some(row=>row.source==="Readers's" && row.name==='CREATE SESSION'));
 f.grants[0].INHERITED='YES';await assert.rejects(f.manager.review(f.query,await request(f,'revoke',{privilegeKind:'ROLE',privilege:"Readers's"}),f.options),/restricted/);
});
test('Role names are quoted, system privileges are catalog-allowlisted and grants support ADMIN without silent option removal',async()=>{
 const f=fixture();await run(f,await request(f,'grant',{privilegeKind:'SYSTEM',privilege:'CREATE SESSION',admin:true}));assert.match(writes(f)[0][0],/^GRANT CREATE SESSION TO "AppUser's" WITH ADMIN OPTION CONTAINER=CURRENT$/);await run(f,await request(f,'revoke',{privilegeKind:'SYSTEM',privilege:'CREATE SESSION'}));assert.ok(!writes(f).at(-1)[0].includes('RESTRICT'));
 await assert.rejects(f.manager.review(f.query,await request(f,'grant',{privilegeKind:'SYSTEM',privilege:'CREATE SESSION; DROP USER X',admin:false}),f.options),/invalid_privilege/);
 f.grants[0].ADMIN_OPTION='YES';await assert.rejects(f.manager.review(f.query,await request(f,'grant',{privilegeKind:'ROLE',privilege:"Readers's",admin:false}),f.options),/no_changes/);
});
test('Quota bytes preserve non-MB values and large integers, while null, zero and unlimited remain distinct',async()=>{
 const f=fixture(),input=await request(f,'quota',{tablespace:'USERS',amount:'1048577',unit:'B',unlimited:false});await assert.rejects(f.manager.review(f.query,input,f.options),/no_changes/);
 await run(f,await request(f,'quota',{tablespace:'USERS',amount:'9007199254740993',unit:'B',unlimited:false}));assert.equal(f.quotas[0].MAX_BYTES,'9007199254740993');assert.match(writes(f)[0][0],/QUOTA 9007199254740993 ON "USERS"/);
 await run(f,await request(f,'quota',{tablespace:'USERS',amount:'0',unit:'B',unlimited:false}));assert.equal(f.quotas[0].MAX_BYTES,'0');await run(f,await request(f,'quota',{tablespace:'USERS',unlimited:true}));assert.equal(f.quotas[0].MAX_BYTES,'-1');
 for(const value of [{amount:'1.5',unit:'M',unlimited:false},{amount:'-1',unit:'B',unlimited:false},{amount:'9223372036854775808',unit:'B',unlimited:false},{amount:'1',unit:'M;DROP',unlimited:false}])assert.throws(()=>service.quotaBytes(value),/invalid_quota/);
});
test('Reviews reject changed metadata/privileges/generations and are single-use',async()=>{
 for(const mutate of [f=>{f.users[1].ACCOUNT_STATUS='LOCKED';},f=>{f.grants[0].ADMIN_OPTION='YES';},f=>{f.privileges=[];},f=>{f.options.connectionId='new';}]){const f=fixture(),r=await f.manager.review(f.query,await request(f),f.options);mutate(f);await assert.rejects(f.execute({...r.request,token:r.token}),/conflict|protected|review_expired/);assert.equal(writes(f).length,0);}
 const f=fixture(),r=await f.manager.review(f.query,await request(f),f.options);await f.execute({...r.request,token:r.token});await assert.rejects(f.execute({...r.request,token:r.token}),/review_expired/);
});
test('DDL applied-but-unobserved results and unknown outcomes are distinct from known errors without exposing passwords',async()=>{
 for(const [kind,expected,applied]of [['observe','ora_user_operation_failed',true],['unknown','ora_user_outcome_unknown',false],['known','ora_user_operation_failed',false],['noEffect','ora_user_verification_failed',true]]){const f=fixture(),r=await f.manager.review(f.query,await request(f),f.options);if(kind==='observe')f.failAfter=true;if(kind==='unknown')f.failWrite=Object.assign(Error('SECRET'),{errorNum:3113});if(kind==='known')f.failWrite=Object.assign(Error('SECRET'),{errorNum:1031});if(kind==='noEffect')f.noEffect=true;let failure;try{await f.execute({...r.request,token:r.token});}catch(error){failure=service.safeError(error);}assert.equal(failure.error,expected);assert.equal(failure.applied,applied);assert.ok(!JSON.stringify(failure).includes('SECRET'));}
});
test('Oracle 12.1 omits unavailable role IDs/inherited columns and restricts unsafe role management',async()=>{
 const f=fixture();f.options.serverVersion='12.1.0.2';f.roles=f.roles.map(row=>({...row,ID:null}));const s=await f.manager.list(f.query,f.options);assert.equal(s.context.maxNameBytes,30);assert.equal(s.context.canCreateRole,false);assert.equal(s.principals.find(row=>row.kind==='ROLE').canDrop,false);assert.ok(!service.rolesSql(false).includes('ROLE_ID'));
});
test('Hook retains failed observations, hides protected entries, blocks filtered commands and keeps exact quota input',async()=>{
 const f=fixture(),h=await selected(f);assert.equal(h.state.rows.some(row=>row.name==='SYS'),false);h.state.open('quota');await h.flush();assert.equal(h.state.draft.amount,'1048577');assert.equal(h.state.draft.unit,'B');h.state.close();await h.flush();const detail=h.state.detail;f.failDetail=true;await h.state.retryDetail();await h.flush();assert.equal(h.state.detail,detail);assert.equal(h.state.can('lock'),false);f.failDetail=false;await h.state.retryDetail();await h.flush();h.state.setSearch('TEST');await h.flush();assert.equal(h.state.can('drop'),false);h.state.setSearch('');await h.flush();f.failList=true;await h.state.reload();await h.flush();assert.ok(h.state.rows.length);assert.equal(h.state.ready,false);h.unmount();
});
test('Hook secret-free review clears passwords after failure and requires reload, re-entry and acknowledgement',async()=>{
 const f=fixture(),h=await selected(f);h.state.open('password');await h.flush();h.state.changePassword('Dummy123');await h.flush();await h.state.prepare();await h.flush();assert.equal(f.requests.find(([c])=>c==='review-oracle-user-role-operation')[1].password,undefined);h.state.setAcknowledged(true);await h.flush();f.failWrite=Object.assign(Error('private'),{errorNum:1031});await h.state.execute();await h.flush();assert.equal(h.state.password,'');assert.equal(h.state.ready,false);assert.equal(h.state.review,null);assert.equal(h.state.draft.target.name,"AppUser's");f.failWrite=null;await h.state.reload();await h.flush();h.state.changePassword('New123');await h.flush();await h.state.prepare();await h.flush();assert.equal(h.state.canExecute,false);h.state.close();await h.flush();assert.equal(h.state.password,'');h.unmount();
});
test('Hook blocks duplicate writes and closure, discards hidden results and reloads after activation',async()=>{
 const f=fixture();let finish;const h=await createHarness((channel,input)=>channel==='execute-oracle-user-role-operation'?new Promise(resolve=>{finish=()=>f.invoke(channel,input).then(resolve);}):f.invoke(channel,input));h.state.select(h.state.rows[1].identity);await h.flush();h.state.open('lock');await h.flush();await h.state.prepare();await h.flush();h.state.setAcknowledged(true);await h.flush();const pending=h.state.execute();await h.flush();h.state.close();assert.ok(h.state.draft);await h.state.execute();h.updateActive(false);await h.flush();h.updateActive(true);await h.flush();finish();await pending;await h.flush();assert.equal(writes(f).length,1);assert.equal(h.state.error,'');h.unmount();
});
test('Structured IPC sanitizes errors and never publishes main transaction state; other DBs are rejected',async()=>{
 const client={executeUserRoleOperation:async()=>{throw Object.assign(Error('SECRET'),{errorNum:1031});}};const r=await createDatabaseIpc(client,'oracle')('execute-oracle-user-role-operation',{});assert.equal(r.errorCode,'ORA-01031');assert.equal(r.hasUncommittedTx,undefined);assert.ok(!JSON.stringify(r).includes('SECRET'));assert.equal((await createDatabaseIpc(client,'postgresql')('list-oracle-user-roles')).success,false);
});
test('Client uses a fresh connection, checks container identity, preserves pending main edits and blocks duplicate DDL',async()=>{
 const f=fixture();let closed=0,finish;const fresh={oracleServerVersionString:'23.0',execute:f.query,close:async()=>{closed++;}};
 const Client=loadModule('electron/oracle/oracleClient.js',{electron:{app:{isPackaged:true}},oracledb:{OUT_FORMAT_OBJECT:1,getConnection:async()=>fresh}},{},{strict:false});const c=new Client();c.connection={execute:async sql=>{assert.equal(sql,service.IDENTITY_SQL);return f.query(sql);}};c.dbLinkConnectOptions={};c.hasUncommittedTx=true;
 await c.listManagedUserRoles();assert.equal(closed,1);assert.equal(c.hasUncommittedTx,true);assert.equal(c.isExecuting,false);assert.ok(!f.calls.some(([sql])=>/^(COMMIT|ROLLBACK)/.test(sql)));
 c.userRoleManager={execute:()=>new Promise(resolve=>{finish=resolve;})};const pending=c.executeUserRoleOperation({});while(!finish)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(c.executeUserRoleOperation({}),/busy/);finish({applied:true});await pending;assert.equal(c.userRolePending,false);
});

test('Late reads are discarded and applied-but-unverified failures stay explicit until a fresh observation',async()=>{
 const f=fixture();let resolve;const late=await createHarness(()=>new Promise(done=>{resolve=done;}));late.updateActive(false);await late.flush();resolve({success:true,...await f.manager.list(f.query,f.options)});await late.flush();assert.equal(late.state.snapshot,null);late.unmount();
 const h=await selected(f);h.state.open('lock');await h.flush();await h.state.prepare();await h.flush();h.state.setAcknowledged(true);await h.flush();f.failAfter=true;await h.state.execute();await h.flush();assert.equal(h.state.applied,true);assert.equal(h.state.ready,false);assert.equal(h.state.review,null);f.failList=false;await h.state.reload();await h.flush();assert.equal(h.state.applied,false,'A reload alone must not claim the failed postcondition was verified');h.unmount();
});
test('Fresh connection mismatch is rejected before administration and cleanup errors preserve completed DDL state',async()=>{
 const f=fixture();let closed=0;const fresh={oracleServerVersionString:'23.0',execute:f.query,close:async()=>{closed++;}};
 const Client=loadModule('electron/oracle/oracleClient.js',{electron:{app:{isPackaged:true}},oracledb:{OUT_FORMAT_OBJECT:1,getConnection:async()=>fresh}},{},{strict:false});const c=new Client();c.connection={execute:async()=>({rows:[{DB_NAME:'wrong',CON_ID:'3',SESSION_USER:'TEST'}]})};c.dbLinkConnectOptions={};await assert.rejects(c.listManagedUserRoles(),/connection_changed/);assert.equal(closed,1);assert.equal(c.isExecuting,false);assert.equal(writes(f).length,0);
 c.connection={execute:f.query};c.userRoleManager={execute:async()=>({applied:true})};fresh.close=async()=>{throw Error('private cleanup');};await assert.rejects(c.executeUserRoleOperation({}),error=>service.safeError(error).applied===true);assert.equal(c.userRolePending,false);assert.equal(c.isExecuting,false);
});
test('Catalog grant order does not invalidate an unchanged role review',async()=>{
 const f=fixture(),review=await f.manager.review(f.query,await request(f),f.options);f.grants.reverse();f.privileges.reverse();await f.execute({...review.request,token:review.token});assert.equal(writes(f).length,1);
});
