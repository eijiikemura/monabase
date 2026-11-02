// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const {test}=require('node:test');
const service=require('../electron/postgres/schemaManagement');
const {createSchemaManagerHarness,schemaFixture}=require('./helpers/schemaManagerData.cjs');
const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');
const {createHookHarness}=require('./helpers/renderHook.cjs');
const writes=f=>f.calls.filter(([sql])=>/^(CREATE|ALTER|DROP|GRANT|REVOKE) /.test(sql));
async function selected(f){const h=await createSchemaManagerHarness(f.invoke);h.state.select(h.state.rows[0].identity);await h.flush();return h;}
test('Schema discovery preserves pgx, toast and exact-case names while protecting system, public and extension schemas',async()=>{
 const f=schemaFixture();f.schemas.push({...f.schemas[0],oid:'55',name:'Extension',extension_owned:true});const snapshot=await f.manager.list(f.query,f.options);
 for(const name of ['pgx','toast'])assert.equal(snapshot.schemas.find(row=>row.name===name).protected,false);
 for(const name of ['public','pg_catalog','Extension'])assert.equal(snapshot.schemas.find(row=>row.name===name).protected,true);
 const first=snapshot.schemas[0];f.schemas.reverse();assert.equal((await f.manager.list(f.query,f.options)).schemas.at(-1).identity,first.identity);
 f.options.connectionId='new';assert.notEqual((await f.manager.list(f.query,f.options)).schemas.at(-1).identity,first.identity);
});
test('Empty schema deletion uses RESTRICT and requires exact-name confirmation',async()=>{
 const f=schemaFixture(),input=await f.request('drop'),review=await f.manager.review(f.query,input,f.options);assert.match(review.sql,/RESTRICT$/);assert.ok(!review.sql.includes('CASCADE'));
 await assert.rejects(f.manager.execute(f.query,{...review.request,token:review.token,confirmName:'wrong'},f.options),/confirmation_mismatch/);assert.equal(writes(f).length,0);
 const result=await f.manager.execute(f.query,{...review.request,token:review.token,confirmName:input.target.name},f.options);assert.equal(result.selectedOid,null);assert.equal(result.applied,true);
});
test('CASCADE requires explicit choice, exposes cross-schema dependencies and refuses truncated or system graphs',async()=>{
 const f=schemaFixture();f.objects=[{class_id:'1259',object_id:'60',sub_id:0,type:'table',schema:f.schemas[0].name,name:'orders',identity:'orders'}];
 f.dependencies=[{class_id:'1259',object_id:'70',sub_id:0,type:'view',schema:'another',name:'linked',identity:'another.linked'}];
 await assert.rejects(f.manager.review(f.query,await f.request('drop'),f.options),/not_empty/);
 const review=await f.manager.review(f.query,await f.request('drop',{cascade:true}),f.options);assert.match(review.sql,/CASCADE$/);assert.equal(review.detail.dependencies[1].schema,'another');
 f.dependencyTotal=501;await assert.rejects(f.manager.review(f.query,await f.request('drop',{cascade:true}),f.options),/dependencies_unknown/);
 f.dependencyTotal=null;f.dependencies[0].schema='pg_catalog';await assert.rejects(f.manager.review(f.query,await f.request('drop',{cascade:true}),f.options),/dependencies_unknown/);assert.equal(writes(f).length,0);
});
test('Structural operations quote names, preserve OIDs and validate length, duplicates and reserved prefixes',async()=>{
 const f=schemaFixture(),input=await f.request('rename',{newName:'Mi"xed\'Name'}),review=await f.manager.review(f.query,input,f.options);assert.match(review.sql,/"Mi""xed'Name"$/);
 const result=await f.manager.execute(f.query,{...review.request,token:review.token},f.options);assert.equal(result.selectedOid,input.target.oid);assert.equal(result.snapshot.schemas[0].name,'Mi"xed\'Name');
 for(const newName of ['', ' leading','trailing ','pg_reserved','\nname','あ'.repeat(22)])await assert.rejects(f.manager.review(f.query,{action:'create',newName},f.options),/invalid_name/);
 await assert.rejects(f.manager.review(f.query,{action:'create',newName:'toast'},f.options),/name_exists/);
 const create=await f.manager.review(f.query,{action:'create',newName:'あ'.repeat(21),ownerId:'10'},f.options);assert.match(create.sql,/AUTHORIZATION "test"$/);assert.equal((await f.manager.execute(f.query,{...create.request,token:create.token},f.options)).selectedOid,'90');
});
test('Ownership candidates require verified SET ROLE/database CREATE and schema ownership remains separate from contained objects',async()=>{
 const f=schemaFixture(),review=await f.manager.review(f.query,await f.request('owner'),f.options);assert.match(review.sql,/OWNER TO "other_owner"$/);const result=await f.manager.execute(f.query,{...review.request,token:review.token},f.options);assert.equal(result.snapshot.schemas[0].ownerId,'20');assert.equal(result.snapshot.schemas[0].oid,'50');
 const g=schemaFixture();await assert.rejects(g.manager.review(g.query,await g.request('owner',{ownerId:'30'}),g.options),/permission/);await assert.rejects(g.manager.review(g.query,await g.request('owner',{ownerId:'10'}),g.options),/no_changes/);
});
test('Protected schemas, readonly connections and lost authority cannot be bypassed through structured requests',async()=>{
 for(const mode of ['protected','readonly','permission']){const f=schemaFixture();if(mode==='protected')f.schemas[0].name='public';if(mode==='readonly')f.options.readonly=true;if(mode==='permission'){f.roles[0].settable=false;f.roles[0].usable=false;}await assert.rejects(f.manager.review(f.query,await f.request('drop'),f.options),/protected|readonly|permission/);assert.equal(writes(f).length,0);}
 const f=schemaFixture();f.schemas[0].name='pg_catalog';const detail=await f.manager.detail(f.query,await f.target(),f.options);assert.deepEqual(detail.privileges.grantors.USAGE,[]);assert.ok(detail.privileges.grants.every(grant=>!grant.canRevoke));
});
test('Reviews are connection-bound and revalidate owner, object inventory and dependency changes; failed verification is not success',async()=>{
 for(const mode of ['owner','objects','dependencies']){const f=schemaFixture(),review=await f.manager.review(f.query,await f.request(),f.options);if(mode==='owner')f.schemas[0].owner_id='20';if(mode==='objects')f.objects.push({class_id:'1',object_id:'2',sub_id:0,type:'table',schema:'test',name:'new',identity:'new'});if(mode==='dependencies')f.dependencies.push({class_id:'1',object_id:'3',sub_id:0,type:'view',schema:'outside',name:'new',identity:'outside.new'});await assert.rejects(f.manager.execute(f.query,{...review.request,token:review.token},f.options),/conflict/);assert.equal(writes(f).length,0);}
 const f=schemaFixture(),review=await f.manager.review(f.query,await f.request(),f.options);await assert.rejects(f.manager.execute(f.query,{...review.request,token:review.token},{...f.options,connectionId:'other'}),/review_expired/);f.noEffect=true;await assert.rejects(f.manager.execute(f.query,{...review.request,token:review.token},f.options),/not_applied/);await assert.rejects(f.manager.execute(f.query,{...review.request,token:review.token},f.options),/review_expired/);
});
test('Schema ACL uses shared direct/effective/PUBLIC grants, bound identities and owner ordinary rights',async()=>{
 const f=schemaFixture();f.acl=[{grantee_id:'10',grantor_id:'10',privilege:'USAGE',grantable:false},{grantee_id:'0',grantor_id:'10',privilege:'CREATE',grantable:false}];
 const detail=await f.manager.detail(f.query,await f.target(),f.options);assert.deepEqual(detail.privileges.privileges,['CREATE','USAGE']);assert.ok(detail.privileges.effective.some(row=>row.principal_id==='30'&&row.privilege==='CREATE'&&row.effective));
 const review=await f.privilegeManager.review(f.query,{object:detail.privileges.object,action:'grant',principalId:'30',privilege:'USAGE',expected:detail.privileges.fingerprint},f.options);assert.match(review.sql,/ON SCHEMA "Te'st""" TO "reader"$/);await f.privilegeManager.mutate(f.query,{...review.request,token:review.token},f.options);assert.ok(f.acl.some(grant=>grant.grantee_id==='30'));
 const lookup=f.calls.find(([sql])=>sql.includes('FROM pg_namespace p WHERE p.oid=$1::oid'));assert.equal(lookup[1][0],'50');
});
test('Hook retains failed list/detail observations, blocks edits until retry and preserves renamed selection',async()=>{
 const f=schemaFixture(),h=await selected(f);assert.ok(h.state.can('rename'));f.failDetail=true;await h.state.retryDetail();await h.flush();assert.ok(h.state.detail);assert.equal(h.state.detailReady,false);assert.equal(h.state.can('rename'),false);f.failDetail=false;await h.state.retryDetail();await h.flush();
 f.failList=true;await h.state.reload();await h.flush();assert.ok(h.state.rows.length);assert.equal(h.state.ready,false);f.failList=false;await h.state.reload();await h.flush();h.state.open('rename');await h.flush();h.state.updateSchema({newName:'Renamed'});await h.flush();await h.state.prepare();await h.flush();assert.equal(h.state.canExecute,false);h.state.setAcknowledged(true);await h.flush();await Promise.all([h.state.execute(),h.state.execute()]);await h.flush();assert.equal(writes(f).length,1);assert.equal(h.state.selected.name,'Renamed');assert.ok(h.events.some(event=>event.detail?.action==='rename'));h.unmount();
});
test('Hook delete requires typed name, refusal writes nothing and hidden selections cannot be changed',async()=>{
 const f=schemaFixture(),h=await selected(f);h.state.open('drop');await h.flush();await h.state.prepare();await h.flush();h.state.setAcknowledged(true);await h.flush();assert.equal(h.state.canExecute,false);h.state.setConfirmName('wrong');await h.flush();assert.equal(h.state.canExecute,false);h.state.close();await h.flush();assert.equal(writes(f).length,0);h.state.setSearch('missing');await h.flush();assert.equal(h.state.can('drop'),false);h.unmount();
});
test('Late reads and mutation failures from hidden activations do not replace current state',async()=>{
 const f=schemaFixture();let finish;const h=await createSchemaManagerHarness((channel,input)=>channel==='get-postgres-schema-detail'?new Promise(resolve=>{finish=resolve;}):f.invoke(channel,input));h.state.select(h.state.rows[0].identity);await h.flush();h.updateActive(false);await h.flush();finish(await f.invoke('get-postgres-schema-detail',await f.target()));await h.flush();assert.equal(h.state.detail,null);assert.equal(h.state.ready,false);h.unmount();
});
test('Schema IPC rejects other databases, sanitizes failures and never publishes main transaction state',async()=>{
 const {createDatabaseIpc}=require('./helpers/ddlEditors.cjs');const client={executeSchemaOperation:async()=>{throw Object.assign(Error('private SQL'),{code:'42501'});}};const response=await createDatabaseIpc(client,'postgresql')('execute-postgres-schema-operation',{});assert.equal(response.errorCode,'42501');assert.equal(Object.hasOwn(response,'hasUncommittedTx'),false);assert.ok(!JSON.stringify(response).includes('private'));assert.equal((await createDatabaseIpc(client,'oracle')('execute-postgres-schema-operation',{})).success,false);
});
test('Shared column splitter measures width, supports keyboard and restores cursor on blur, hide and unmount',async()=>{
 const h=createHookHarness(),listeners=new Map(),body={style:{cursor:'crosshair'}};let resize,active=true;
 const {useDbaSplit}=loadTypeScript('src/features/dba/hooks/useDbaSplit.ts',{react:h.react},{document:{body},window:{addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)},ResizeObserver:class{constructor(fn){resize=fn;}observe(){}disconnect(){}}});let state;const render=()=>state=h.render(()=>useDbaSplit(active,'columns'));
 render();state.container.current={getBoundingClientRect:()=>({left:20,width:700,top:0,height:300})};h.commit();await h.settle();render();resize();await h.settle();render();const before=state.leftWidth;state.key({key:'ArrowRight',preventDefault(){}});await h.settle();render();assert.ok(state.leftWidth>before);const element={setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}};state.start({button:0,pointerId:1,currentTarget:element,preventDefault(){}});assert.equal(body.style.cursor,'col-resize');listeners.get('blur')();assert.equal(body.style.cursor,'crosshair');state.start({button:0,pointerId:2,currentTarget:element,preventDefault(){}});active=false;render();h.commit();assert.equal(body.style.cursor,'crosshair');h.unmount();
});
test('Schema error results preserve unknown commit outcomes without exposing SQL',()=>{
 assert.equal(service.safeError(Object.assign(Error('commit lost'),{pgPrivUnknown:true})).error,'pg_priv_outcome_unknown');assert.equal(service.safeError(Error('pg_schema_conflict')).error,'pg_schema_conflict');assert.equal(service.safeError(Error('private SQL')).error,'pg_schema_operation_failed');
});
test('Schema refresh updates expanded and saved names, prunes deletions and ignores older responses',async()=>{
 const h=createHookHarness(),listeners=new Map(),storage=new Map([['pg_expandedSchemas_demo_test','["Old","public"]'],['pg_select_schema_demo_test','Old']]),pending=[];
 const events=loadTypeScript('src/shared/hooks/useEventCallback.ts',{react:h.react});
 const workspace=loadTypeScript('src/shared/hooks/useWorkspaceTabs.ts',{react:h.react,'./useEventCallback':events});
 const {useAppPostgresql}=loadTypeScript('src/features/postgresql/useAppPostgresql.ts',{react:h.react,'./triggerIdentity':loadTypeScript('src/features/postgresql/triggerIdentity.ts'),'./routineIdentity':loadTypeScript('src/features/postgresql/routineIdentity.ts'),'@/shared/hooks/useEventCallback':events,'@/shared/hooks/useWorkspaceTabs':workspace,'react-i18next':{useTranslation:()=>({t:key=>key})},'@/features/table/useTableOpening':{useTableOpening:()=>open=>open()},'../ai/aiHistoryCleanup':{deleteAiHistoryForObject(){}},'../git/useGlobalGit':{useGlobalGit:()=>({})},'../ai/useAiSettings':{useAiSettings:()=>({})},'@/shared/api/desktop':{ipcRenderer:{invoke:()=>new Promise(resolve=>pending.push(resolve))},subscribeTransactionState:()=>()=>{},resetGlobalLoading(){}}},{window:{addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event),dispatchEvent:()=>true},document:{body:{style:{}},getElementById:()=>null},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},setTimeout:()=>0,clearTimeout(){},alert(){}});
 const initial=['Old','public'];let state;const render=()=>state=h.render(()=>useAppPostgresql({user:'test',database:'demo'},{maxTabs:20},initial));
 render();h.commit();await h.settle();render();h.commit();
 const refresh=listeners.get('refresh-schemas');const older=refresh({});const newest=refresh({detail:{action:'rename',oldName:'Old',newName:'New',oid:'50'}});pending[1]({success:true,schemas:['New','public']});await newest;render();h.commit();assert.deepEqual([...state.localSchemas],['New','public']);assert.deepEqual(JSON.parse(storage.get('pg_expandedSchemas_demo_test')),['New','public']);assert.equal(storage.get('pg_select_schema_demo_test'),'New');
 pending[0]({success:true,schemas:['Old','public']});await older;render();h.commit();assert.deepEqual([...state.localSchemas],['New','public']);
 const deletion=refresh({detail:{action:'drop',oldName:'New',newName:null,oid:'50'}});pending[2]({success:true,schemas:['public']});await deletion;render();h.commit();assert.deepEqual([...state.expandedSchemas],['public']);assert.equal(storage.get('pg_select_schema_demo_test'),'public');h.unmount();
});
test('A hidden mutation result triggers current metadata and navigation refresh without replaying the write',async()=>{
 const f=schemaFixture();let finish;const base=f.invoke,h=await createSchemaManagerHarness((channel,input)=>channel==='execute-postgres-schema-operation'?new Promise(resolve=>{finish=()=>base(channel,input).then(resolve);}):base(channel,input));h.state.select(h.state.rows[0].identity);await h.flush();h.state.open('rename');await h.flush();h.state.updateSchema({newName:'AfterHidden'});await h.flush();await h.state.prepare();await h.flush();h.state.setAcknowledged(true);await h.flush();const task=h.state.execute();while(!finish)await new Promise(resolve=>setImmediate(resolve));h.updateActive(false);await h.flush();h.updateActive(true);await h.flush();finish();await task;await h.waitFor(state=>state.ready&&state.detailReady&&!state.isLoading);assert.equal(h.state.selected.name,'AfterHidden');assert.equal(writes(f).length,1);assert.ok(h.events.some(event=>event.type==='refresh-schemas'));h.unmount();
});
test('Schema structural commands use one independent transaction, preserve main work and block duplicates or busy background transactions',async()=>{
 const {loadModule}=require('./helpers/loadModule.cjs'),Client=loadModule('electron/postgres/postgresClient.js',{electron:{app:{isPackaged:true}}},{},{strict:false}),client=new Client(),f=schemaFixture(),calls=[];let status='I';
 const slot={id:1,isExecuting:false,client:{getTransactionStatus:()=>status,query:async(sql,binds)=>{calls.push(sql);if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL search_path)/.test(sql))return{};return f.query(sql,binds);}}};client.client={query:()=>{throw Error('Main connection must remain untouched');}};client.bgPool=[slot];client.hasUncommittedTx=true;
 const row=(await client.listManagedSchemas()).schemas[0],target={oid:row.oid,identity:row.identity,name:row.name},detail=await client.getManagedSchemaDetail(target);
 const review=await client.reviewSchemaOperation({action:'rename',target,expected:detail.fingerprint,newName:'Independent'}),base=slot.client.query;let finish;
 slot.client.query=(sql,binds)=>sql.startsWith('ALTER SCHEMA')?new Promise(resolve=>{finish=()=>base(sql,binds).then(resolve);}):base(sql,binds);
 const pending=client.executeSchemaOperation({...review.request,token:review.token});while(!finish)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(client.executeSchemaOperation({...review.request,token:review.token}),/busy/);finish();const result=await pending;assert.equal(result.snapshot.schemas[0].name,'Independent');assert.equal(client.hasUncommittedTx,true);assert.equal(slot.isExecuting,false);assert.ok(calls.includes('COMMIT'));
 slot.client.query=base;const nextRow=result.snapshot.schemas[0],nextTarget={oid:nextRow.oid,identity:nextRow.identity,name:nextRow.name},nextDetail=await client.getManagedSchemaDetail(nextTarget),next=await client.reviewSchemaOperation({action:'rename',target:nextTarget,expected:nextDetail.fingerprint,newName:'NoEffect'});f.noEffect=true;const commits=calls.filter(sql=>sql==='COMMIT').length;await assert.rejects(client.executeSchemaOperation({...next.request,token:next.token}),/not_applied/);assert.equal(calls.filter(sql=>sql==='COMMIT').length,commits);assert.equal(calls.at(-1),'ROLLBACK');
 status='T';const before=calls.length;await assert.rejects(client.listManagedSchemas(),/busy/);assert.equal(calls.length,before);assert.equal(slot.isExecuting,false);assert.equal(client.hasUncommittedTx,true);
});
