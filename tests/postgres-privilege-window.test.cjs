// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const service = require('../electron/postgres/objectPrivileges');
const { createPostgresPrivilegeHarness } = require('./helpers/postgresPrivilegeData.cjs');
function fixture() {
  const f = { calls: [], requests: [], options: { readonly: false, connectionId: 'scope' }, failRead: false, noEffect: false,
    object: { oid: '50', schema: "Te'st", name: 'Mi"xed', owner_id: '10', revision: '1', args: '', sql_name: '"Te\'st"."Mi""xed"', default_acl: false, acl_type: 'r', namespace_id: '40' },
    roles: [{ id: '10', name: 'test', login: true, superuser: false, usable: true, settable: true }, { id: '20', name: 'reader', login: false, superuser: false, usable: false, settable: false }],
    grants: [{ grantee_id: '10', grantor_id: '10', privilege: 'SELECT', grantable: false }], columns: [{ column: 'Col"umn', grantee_id: '20', grantor_id: '10', privilege: 'UPDATE', grantable: false }] };
  f.query = async (sql, binds) => {
    f.calls.push([sql, binds]);
    if (sql === service.CONTEXT_SQL) return { rows: [{ database: 'demo', database_id: '5', username: 'test', user_id: '10', version: 160000 }] };
    if (sql.startsWith('SELECT oid::text AS id')) return { rows: f.roles.map(role => ({ ...role })) };
    if (sql.includes(' AS sql_name,')) { if (f.failRead) throw Error('Read failed'); return { rows: f.object ? [{ ...f.object }] : [] }; }
    if (sql.startsWith('SELECT x.grantee::text')) return { rows: f.grants.map(grant => ({ ...grant })) };
    if (sql === service.COLUMN_SQL) return { rows: f.columns.map(column => ({ ...column })) };
    if (sql.startsWith('SELECT DISTINCT privilege_type')) return { rows: (f.object.acl_type === 's' ? ['SELECT','UPDATE','USAGE'] : f.object.acl_type === 'f' ? ['EXECUTE'] : ['SELECT','UPDATE']).map(privilege => ({ privilege })) };
    if (sql.startsWith('SELECT r.oid::text AS principal_id')) return { rows: f.roles.flatMap(role => binds[1].map(privilege => ({ principal_id: role.id, privilege, effective: f.grants.some(grant => ['0',role.id].includes(grant.grantee_id) && grant.privilege === privilege), column_effective: f.columns.some(column => column.grantee_id === role.id && column.privilege === privilege), schema_usage: true, sources: f.grants.filter(grant => ['0',role.id].includes(grant.grantee_id) && grant.privilege === privilege).map(grant => grant.grantee_id) }))) };
    if (sql.startsWith('SET LOCAL ROLE')) return {};
    if (sql.startsWith('GRANT ') || sql.startsWith('REVOKE ')) {
      if (f.noEffect) return {};
      const grantee_id = sql.includes(' TO PUBLIC') || sql.includes(' FROM PUBLIC') ? '0' : sql.includes('"reader"') ? '20' : '10';
      const privilege = sql.match(/(?:GRANT |REVOKE (?:GRANT OPTION FOR )?)(\w+)/)[1];
      if (sql.startsWith('GRANT')) f.grants.push({ grantee_id, grantor_id: '10', privilege, grantable: sql.includes('WITH GRANT OPTION') });
      else if (sql.includes('GRANT OPTION FOR')) f.grants = f.grants.map(grant => grant.grantee_id === grantee_id && grant.privilege === privilege ? { ...grant, grantable: false } : grant);
      else f.grants = f.grants.filter(grant => grant.grantee_id !== grantee_id || grant.privilege !== privilege || grant.grantor_id !== '10');
      f.object.revision = String(Number(f.object.revision) + 1); return {};
    }
    throw Error('Unexpected privilege query: ' + sql);
  };
  f.manager = service.createPrivilegeManager();
  f.objectTarget = async type => (await f.manager.listObjects(f.query, { type: type || 'TABLE', schema: f.object.schema, search: '', offset: 0 }, f.options)).objects[0];
  f.request = async (extra = {}) => { const object = await f.objectTarget(extra.type), detail = await f.manager.read(f.query, object, f.options); return { object, action: 'grant', principalId: '20', privilege: 'SELECT', expected: detail.fingerprint, ...extra }; };
  f.invoke = async (channel, input) => { f.requests.push([channel,input]); try {
    const method = { 'list-postgres-privilege-principals': 'principals', 'list-postgres-privilege-objects': 'listObjects', 'get-postgres-object-privileges': 'read', 'review-postgres-object-privilege': 'review', 'mutate-postgres-object-privilege': 'mutate' }[channel];
    const result = await (method === 'principals' ? f.manager[method](f.query, f.options) : f.manager[method](f.query, input, f.options)); return { success: true, ...(method === 'read' ? { detail: result } : result) };
  } catch (error) { return { success: false, ...service.safeError(error) }; } };
  return f;
}
const writes = f => f.calls.filter(([sql]) => /^(GRANT|REVOKE) /.test(sql));
async function selected(f) { const h = await createPostgresPrivilegeHarness(f.invoke); h.state.select(await f.objectTarget()); await h.flush(); return h; }
test('Exact names and argument signatures use bound lookup, server-quoted SQL and generation-bound identities', async () => {
  const f = fixture(), first = await f.objectTarget(); assert.equal(first.name, 'Mi"xed'); assert.equal(first.schema, "Te'st");
  const lookup = f.calls.find(([sql]) => sql.includes('LIMIT 101')); assert.ok(!lookup[0].includes("Te'st")); assert.equal(lookup[1][0], "Te'st");
  f.object.args = 'integer'; f.object.acl_type = 'f'; f.object.sql_name = '"Te\'st"."Mi""xed"(integer)'; const routine = await f.objectTarget('FUNCTION'); f.object.args = 'text'; assert.notEqual((await f.objectTarget('FUNCTION')).identity, routine.identity); await assert.rejects(f.manager.read(f.query, routine, f.options), /target_changed/);
  f.options.connectionId = 'new'; assert.notEqual((await f.objectTarget()).identity, first.identity);
});
test('All roles, PUBLIC, grantors, default ACL, sequence privileges and column-only access remain distinguishable', async () => {
  const f = fixture(); f.grants.push({ grantee_id: '0', grantor_id: '10', privilege: 'SELECT', grantable: false }); f.object.default_acl = true;
  const detail = await f.manager.read(f.query, await f.objectTarget(), f.options); assert.ok(detail.principals.some(role => role.id==='20' && role.kind==='role')); assert.ok(detail.principals.some(role => role.id==='0' && role.kind==='public')); assert.equal(detail.grants[0].source,'default'); assert.equal(detail.columnGrants[0].column,'Col"umn'); assert.ok(detail.effective.find(row=>row.principal_id==='20'&&row.privilege==='SELECT').effective);
  f.object.acl_type='s'; assert.deepEqual((await f.manager.read(f.query,await f.objectTarget('SEQUENCE'),f.options)).privileges,['SELECT','UPDATE','USAGE']);
});
test('Owner ordinary rights can be revoked and restored, with explicit issuer and RESTRICT rather than CASCADE', async () => {
  const f=fixture(), input=await f.request({action:'revoke',principalId:'10',grantorId:'10'}), plan=await f.manager.review(f.query,input,f.options);
  assert.match(plan.sql,/FROM "test" RESTRICT$/); await f.manager.mutate(f.query,{...plan.request,token:plan.token},f.options); assert.ok(!f.grants.some(grant=>grant.grantee_id==='10'));
  const restore=await f.manager.review(f.query,await f.request({principalId:'10'}),f.options); await f.manager.mutate(f.query,{...restore.request,token:restore.token},f.options); assert.ok(f.grants.some(grant=>grant.grantee_id==='10')); assert.ok(f.calls.some(([sql])=>sql==='SET LOCAL ROLE "test"')); assert.ok(writes(f).every(([sql])=>!sql.includes('CASCADE')));
});
test('Review SQL includes exact routine identity and PUBLIC is unquoted while quoted identifiers remain escaped', async () => {
  const f=fixture(); f.object.acl_type='f'; f.object.args='integer'; f.object.sql_name='"Te\'st"."Mi""xed"(integer)'; f.grants=[{grantee_id:'10',grantor_id:'10',privilege:'EXECUTE',grantable:false}];
  const plan=await f.manager.review(f.query,await f.request({type:'FUNCTION',privilege:'EXECUTE',principalId:'0'}),f.options); assert.match(plan.sql,/ON FUNCTION "Te'st"\."Mi""xed"\(integer\) TO PUBLIC$/);
  await assert.rejects(f.manager.review(f.query,await f.request({type:'FUNCTION',privilege:'EXECUTE',principalId:'0',grantOption:true}),f.options),/public_option/);
});
test('Review rejects stale ACLs, roles, readonly connections and unauthorized issuers before mutation', async () => {
  for (const mode of ['acl','role','readonly','permission']) {
    const f=fixture(), input=await f.request();
    if(mode==='acl')f.object.revision='2'; if(mode==='role')f.roles[1].name='renamed'; if(mode==='readonly')f.options.readonly=true;
    if(mode==='permission'){f.roles[0].settable=false;f.roles[0].usable=false; input.expected=(await f.manager.read(f.query,input.object,f.options)).fingerprint;}
    await assert.rejects(f.manager.review(f.query,input,f.options),/conflict|readonly|permission/); assert.equal(writes(f).length,0);
  }
});
test('Tokens bind exact operation and connection; grant-option changes are verified and unsuccessful warnings cannot become success',async()=>{
  const f=fixture(),plan=await f.manager.review(f.query,await f.request({grantOption:true}),f.options);
  await assert.rejects(f.manager.mutate(f.query,{...plan.request,privilege:'UPDATE',token:plan.token},f.options),/conflict/);
  await assert.rejects(f.manager.mutate(f.query,{...plan.request,token:plan.token},{...f.options,connectionId:'new'}),/review_expired/);
  await f.manager.mutate(f.query,{...plan.request,token:plan.token},f.options); assert.ok(f.grants.find(grant=>grant.grantee_id==='20').grantable);
  const revoke=await f.manager.review(f.query,await f.request({action:'revoke',grantorId:'10',grantOptionOnly:true}),f.options); await f.manager.mutate(f.query,{...revoke.request,token:revoke.token},f.options); assert.equal(f.grants.find(grant=>grant.grantee_id==='20').grantable,false);
  const g=fixture(),p=await g.manager.review(g.query,await g.request(),g.options);g.noEffect=true;await assert.rejects(g.manager.mutate(g.query,{...p.request,token:p.token},g.options),/not_applied/); await assert.rejects(g.manager.mutate(g.query,{...p.request,token:p.token},g.options),/review_expired/);
});
test('Hook retains failed observations, disables edits until retry and requires explicit SQL acknowledgement',async()=>{
  const f=fixture(),h=await selected(f);assert.equal(h.state.editable('20','SELECT','grant'),true); f.failRead=true;await h.state.reload();await h.flush();assert.ok(h.state.detail);assert.equal(h.state.ready,false);assert.equal(h.state.editable('20','SELECT','grant'),false);
  f.failRead=false;await h.state.reload();await h.flush();h.state.open('20','SELECT','grant');await h.flush();await h.state.prepare();await h.flush();assert.ok(h.state.review);assert.equal(h.state.canExecute,false);h.state.setAcknowledged(true);await h.flush();await Promise.all([h.state.execute(),h.state.execute()]);await h.flush();assert.equal(writes(f).length,1);assert.equal(h.state.applied,true);assert.ok(h.state.detail.grants.some(grant=>grant.grantee_id==='20'));h.unmount();
});
test('Failed changes consume the UI review and preserve displayed ACLs until manual reload',async()=>{
  const f=fixture(),h=await selected(f);h.state.open('20','SELECT','grant');await h.flush();await h.state.prepare();await h.flush();h.state.setAcknowledged(true);await h.flush();f.noEffect=true;await h.state.execute();await h.flush();assert.equal(h.state.ready,false);assert.equal(h.state.review,null);assert.equal(h.state.applied,false);assert.equal(h.state.error,'pg_priv_not_applied');assert.ok(!h.state.detail.grants.some(grant=>grant.grantee_id==='20'));h.unmount();
});
test('Late reads after hiding and changing selected objects do not replace the new observation',async()=>{
  const f=fixture();let finish;const base=f.invoke;const h=await createPostgresPrivilegeHarness((channel,input)=>channel==='get-postgres-object-privileges'?new Promise(resolve=>{finish=resolve;}):base(channel,input)); h.state.select(await f.objectTarget());await h.flush();h.updateActive(false);await h.flush();finish(await base('get-postgres-object-privileges',await f.objectTarget()));await h.flush();assert.equal(h.state.detail,null);assert.equal(h.state.ready,false);h.unmount();
});
test('Object searches return 100 rows and literal wildcard characters remain bound',async()=>{
  const f=fixture(),base=f.query; f.query=(sql,binds)=>sql.includes('LIMIT 101')?Promise.resolve({rows:Array.from({length:101},(_,i)=>({...f.object,oid:String(100+i),name:'Item'+i}))}):base(sql,binds);
  const result=await f.manager.listObjects(f.query,{schema:"Te'st",type:'TABLE',search:'a%_\\',offset:100},f.options);assert.equal(result.objects.length,100);assert.equal(result.hasMore,true);
  await f.manager.listObjects(base,{schema:"Te'st",type:'TABLE',search:'a%_\\',offset:100},f.options);const [,binds]=f.calls.find(([sql,values])=>sql.includes('LIMIT 101')&&values[2]===100);assert.equal(binds[1],'%a\\%\\_\\\\%');
});
test('Column effects are included in review and matching revocations must be observed before commit',async()=>{
  const f=fixture();f.columns=[{column:'Limited',grantee_id:'10',grantor_id:'10',privilege:'SELECT',grantable:false}];
  const review=await f.manager.review(f.query,await f.request({action:'revoke',principalId:'10',grantorId:'10'}),f.options);assert.deepEqual(review.affectedColumns,['Limited']);
  await assert.rejects(f.manager.mutate(f.query,{...review.request,token:review.token},f.options),/not_applied/);
});
test('Multiple grantors remain separate and a revocation can target only its verified issuer',async()=>{
  const f=fixture();f.grants.push({grantee_id:'20',grantor_id:'10',privilege:'SELECT',grantable:false},{grantee_id:'20',grantor_id:'20',privilege:'SELECT',grantable:true});
  const plan=await f.manager.review(f.query,await f.request({action:'revoke',grantorId:'10'}),f.options);await f.manager.mutate(f.query,{...plan.request,token:plan.token},f.options);assert.ok(f.grants.some(grant=>grant.grantee_id==='20'&&grant.grantor_id==='20'));
  await assert.rejects(f.manager.review(f.query,await f.request({action:'revoke',grantorId:'20'}),f.options),/permission/);
});
test('Structured privilege IPC rejects another database, sanitizes errors and never publishes main transaction state',async()=>{
  const {createDatabaseIpc}=require('./helpers/ddlEditors.cjs');const client={mutatePostgresPrivilege:async()=>{throw Object.assign(Error('secret SQL'),{code:'42501'});}};
  const response=await createDatabaseIpc(client,'postgresql')('mutate-postgres-object-privilege',{});assert.equal(response.success,false);assert.equal(response.errorCode,'42501');assert.equal(Object.hasOwn(response,'hasUncommittedTx'),false);assert.ok(!JSON.stringify(response).includes('secret'));
  assert.equal((await createDatabaseIpc(client,'oracle')('mutate-postgres-object-privilege',{})).success,false);
});
test('Dedicated transactions commit verified writes, roll back failed verification and protect pending main or background edits',async()=>{
  const {loadModule}=require('./helpers/loadModule.cjs');const Client=loadModule('electron/postgres/postgresClient.js',{electron:{app:{isPackaged:true}}},{},{strict:false});const client=new Client(),f=fixture(),calls=[];let status='I',failCommit=false,failRollback=false,closed=false;
  const slot={id:1,isExecuting:false,client:{getTransactionStatus:()=>status,end:async()=>{closed=true;},query:async(sql,binds)=>{
    calls.push(sql);if(sql==='COMMIT'&&failCommit)throw Object.assign(Error('Commit response lost'),{code:'08006'});if(sql==='ROLLBACK'&&failRollback)throw Error('Rollback lost');if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL search_path)/.test(sql))return {};return f.query(sql,binds);
  }}};
  client.client={query:()=>{throw Error('Main connection must remain untouched');}};client.bgPool=[slot];client.hasUncommittedTx=true;
  const object=(await client.listPostgresPrivilegeObjects({schema:f.object.schema,type:'TABLE',search:'',offset:0})).objects[0],detail=await client.readPostgresPrivileges(object);
  const review=await client.reviewPostgresPrivilege({object,principalId:'20',privilege:'SELECT',action:'grant',expected:detail.fingerprint});await client.mutatePostgresPrivilege({...review.request,token:review.token});assert.ok(calls.includes('COMMIT'));assert.equal(client.hasUncommittedTx,true);assert.equal(slot.isExecuting,false);
  f.noEffect=true;const current=await client.readPostgresPrivileges(object),revoke=await client.reviewPostgresPrivilege({object,principalId:'20',privilege:'SELECT',action:'revoke',grantorId:'10',expected:current.fingerprint});const commits=calls.filter(sql=>sql==='COMMIT').length;await assert.rejects(client.mutatePostgresPrivilege({...revoke.request,token:revoke.token}),/not_applied/);assert.equal(calls.filter(sql=>sql==='COMMIT').length,commits);assert.equal(calls.at(-1),'ROLLBACK');
  status='T';await assert.rejects(client.listPostgresPrivilegePrincipals(),/busy/);assert.equal(slot.isExecuting,false);status='I';
  failCommit=true;await assert.rejects(client.withPrivilegeConnection(async()=>({applied:true}),true),error=>{assert.equal(service.safeError(error).error,'pg_priv_outcome_unknown');return true;});
  failRollback=true;await assert.rejects(client.withPrivilegeConnection(async()=>{throw Error('Operation failed');},true),/Operation failed/);assert.equal(client.bgPool.length,0);assert.equal(closed,true);assert.equal(client.hasUncommittedTx,true);
});
test('Late mutation completion after reactivation triggers a fresh read without stale success or failure messages',async()=>{
  const f=fixture();let finish;const base=f.invoke,h=await createPostgresPrivilegeHarness((channel,input)=>channel==='mutate-postgres-object-privilege'?new Promise(resolve=>{finish=()=>base(channel,input).then(resolve);}):base(channel,input));h.state.select(await f.objectTarget());await h.flush();h.state.open('20','SELECT','grant');await h.flush();await h.state.prepare();await h.flush();h.state.setAcknowledged(true);await h.flush();const task=h.state.execute();while(!finish)await new Promise(resolve=>setImmediate(resolve));h.updateActive(false);await h.flush();h.updateActive(true);await h.flush();finish();await task;await h.waitFor(state=>state.ready&&state.peopleReady&&!state.isLoading);assert.ok(h.state.detail.grants.some(grant=>grant.grantee_id==='20'));assert.equal(h.state.applied,false);assert.equal(h.state.error,'');h.unmount();
});
test('Explicit SET ROLE authority works independently of inherited ordinary access',async()=>{
  const f=fixture();f.roles[0].usable=false;f.roles[0].settable=true;const review=await f.manager.review(f.query,await f.request(),f.options);assert.equal(review.grantor.id,'10');await f.manager.mutate(f.query,{...review.request,token:review.token},f.options);assert.ok(f.grants.some(grant=>grant.grantee_id==='20'));
});
test('An inherited owner such as pg_database_owner can issue owner grants without SET ROLE to the special owner',async()=>{
 const f=fixture();f.object.owner_id='20';f.roles[1].name='pg_database_owner';f.roles[1].usable=true;f.roles[1].settable=false;f.grants=[{grantee_id:'20',grantor_id:'20',privilege:'SELECT',grantable:false}];
 const review=await f.manager.review(f.query,await f.request({principalId:'10'}),f.options);assert.equal(review.grantor.id,'20');assert.equal(review.issuer.id,'10');
 const base=f.query;f.query=async(sql,binds)=>{if(sql.startsWith('GRANT ')){f.calls.push([sql,binds]);f.grants.push({grantee_id:'10',grantor_id:'20',privilege:'SELECT',grantable:false});return{};}return base(sql,binds);};
 await f.manager.mutate(f.query,{...review.request,token:review.token},f.options);assert.ok(f.calls.some(([sql])=>sql==='SET LOCAL ROLE "test"'));assert.ok(!f.calls.some(([sql])=>sql==='SET LOCAL ROLE "pg_database_owner"'));
});
