// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const service=require('../electron/mysql/userRoleService');const {createHookHarness}=require('./helpers/renderHook.cjs');const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');const {componentHarness}=require('./helpers/componentHarness.cjs');
const account={user:'alice',host:'localhost'},key=a=>JSON.stringify([a.user,a.host]);
function fixture(){
 const data={readonly:false,denied:false,version:0,status:'active',runs:[],reads:[],roleEdges:[],definers:[],fail:false};
 const base=(user,admin=false)=>({user,host:'localhost',plugin:'caching_sha2_password',account_locked:'N',password_expired:'N',password_last_changed:'2026-01-01 00:00:'+data.version,max_questions:0,max_updates:0,max_connections:0,max_user_connections:0,Create_user_priv:admin?'Y':'N',Grant_priv:admin?'Y':'N',Super_priv:admin?'Y':'N'});
 const client={main:{threadId:1},readonly:false,closing:false,getTransactionDetails:()=>({transactionStatus:data.status,hasUncommittedTx:data.status==='active'}),enqueue:async(fn)=>fn(),background:{promise:()=>({query:async({sql})=>{data.reads.push(sql);return [[['GRANT USAGE ON *.* TO '+"'alice'@'localhost'"]]];}})},execute:async(sql,binds)=>{
 data.reads.push(sql);assert.ok(!sql.includes('authentication_string'));
 if(sql.includes('CURRENT_USER() AS'))return {rows:[{currentAccount:'operator@localhost',server:'server-fixture',activeRoles:'NONE'}]};
 if(sql.includes('FROM mysql.user')){if(data.denied)throw new Error('ER_TABLEACCESS_DENIED_ERROR: denied');return {rows:[base('operator',true),base('alice'),base('reader')]};}
 if(sql.includes('FROM mysql.role_edges'))return {rows:data.roleEdges.filter(row=>!binds?.user||(sql.includes('CAST(TO_USER')?row.TO_USER===binds.user:row.FROM_USER===binds.user))};
 if(sql.includes('FROM mysql.global_grants'))return {rows:[{USER:'operator',HOST:'localhost',PRIV:'ROLE_ADMIN'},{USER:'operator',HOST:'localhost',PRIV:'SHOW_ROUTINE'}]};
 if(sql.includes('SCHEMA_PRIVILEGES'))return {rows:[]};
 if(sql.includes('USER_PRIVILEGES'))return {rows:['SELECT','SHOW VIEW','TRIGGER','EVENT'].map(PRIVILEGE_TYPE=>({GRANTEE:"'operator'@'localhost'",PRIVILEGE_TYPE,IS_GRANTABLE:'YES'}))};
 if(sql.includes('mysql.default_roles'))return {rows:[]};if(sql.includes('information_schema.VIEWS'))return {rows:data.definers};if(sql==='SHOW DATABASES')return {rows:[{Database:'demo'}]};throw new Error('Unexpected account read');
 },run:async(_db,statement)=>{data.runs.push(statement.sql);if(data.fail)throw new Error('ER_ACCESS_DENIED_ERROR: password sentinel-secret');data.status='idle';return {};}};
 return {client,data};
}
async function review(f,action='lock',extra={}){const d=await service.get(f.client,account);assert.equal(d.success,true,d.error);const r=await service.review(f.client,{action,target:account,expected:d.detail.fingerprint,locked:true,...extra});assert.equal(r.success,true,r.error);return r.review;}
const execute=(f,r,extra={})=>service.execute(f.client,{token:r.token,confirm:'alice@localhost',acknowledged:true,...extra});
test('MySQL account snapshots protect self/admin identities and expose no authentication material',async()=>{
 const f=fixture(),r=await service.list(f.client);assert.equal(r.success,true);assert.equal(r.snapshot.context.scope,'all');assert.equal(r.snapshot.accounts[0].protected,true);assert.equal(r.snapshot.accounts[1].protected,false);assert.equal(f.data.runs.length,0);
 f.data.denied=true;const limited=await service.list(f.client);assert.equal(limited.snapshot.context.scope,'self');assert.equal(limited.snapshot.context.canCreate,false);assert.equal(limited.snapshot.accounts.length,1);assert.equal((await service.get(f.client,{user:'operator',host:'localhost'})).success,true);
});
test('MySQL account reviews are password-free, enforce one use and sanitize every credential failure',async()=>{
 const f=fixture(),r=await review(f,'password');assert.ok(r.sql.includes('<redacted>'));assert.ok(!JSON.stringify(r).includes('sentinel-secret'));assert.equal(f.data.runs.length,0);f.data.fail=true;const result=await execute(f,r,{password:'sentinel-secret'});assert.equal(result.success,false);assert.equal(result.error,'mysql_user_operation_failed');assert.ok(!JSON.stringify(result).includes('sentinel-secret'));await execute(f,r,{password:'sentinel-secret'});assert.equal(f.data.runs.length,1);
});
test('MySQL account mutations require current fingerprints, exact confirmation, fresh connection and non-readonly mode',async()=>{
 for(const condition of ['stale','confirm','connection','readonly','expired']){
 const f=fixture(),r=await review(f);if(condition==='stale')f.data.version++;if(condition==='connection')f.client.main.threadId++;if(condition==='readonly')f.client.readonly=true;
 const original=Date.now;if(condition==='expired')Date.now=()=>original()+360000;
 try{const result=await execute(f,r,condition==='confirm'?{confirm:'wrong'}:{});assert.equal(result.success,false,condition);assert.equal(f.data.runs.length,0,condition);}finally{Date.now=original;}
 }
});
test('MySQL account policy blocks DEFINER drops, injected privileges and protected role assignments',async()=>{
 const f=fixture();f.data.definers=[{schemaName:'demo',objectName:'v',kind:'VIEW'}];const d=await service.get(f.client,account);
 for(const request of [{action:'drop'},{action:'grant',scope:'global',database:'',privilege:'SELECT; DROP USER root'},{action:'role-grant',role:{user:'operator',host:'localhost'}}])assert.equal((await service.review(f.client,{...request,target:account,expected:d.detail.fingerprint})).success,false);
 assert.equal((await service.review(f.client,{action:'password',target:account,expected:d.detail.fingerprint,password:'sentinel-secret'})).success,false);assert.equal(f.data.runs.length,0);
 const noChange=await service.review(f.client,{action:'default-role',target:account,expected:d.detail.fingerprint,role:null});assert.equal(noChange.error,'mysql_user_no_changes');
});
test('MySQL password placeholders cannot replace an account whose name resembles a redaction marker',async()=>{
 const f=fixture(),r=await service.review(f.client,{action:'create',target:{user:'<redacted>',host:'localhost'},kind:'USER',locked:false});assert.equal(r.success,true,r.error);const result=await service.execute(f.client,{token:r.review.token,password:'sentinel-secret',confirm:'<redacted>@localhost',acknowledged:true});assert.equal(result.success,true);assert.ok(f.data.runs[0].startsWith("CREATE USER '<redacted>'@'localhost'"));assert.ok(!JSON.stringify(result).includes('sentinel-secret'));
 const locked=await review(f);locked.request.target.user='reader';assert.equal((await execute(f,locked)).success,true);assert.ok(f.data.runs.at(-1).includes("'alice'@'localhost'"));
});
function hookFixture(){
 const h=createHookHarness(),calls=[],stateChanges=[],target={...account,id:key(account),plugin:'caching_sha2_password',locked:false,expired:false,protected:false,self:false,referencedRole:false,limits:{queries:0,updates:0,connections:0,concurrent:0}},self={...target,user:'operator',id:key({user:'operator',host:'localhost'}),self:true,protected:true};
 const snapshot={accounts:[target,self],context:{current:{user:'operator',host:'localhost'},scope:'all',readonly:false,canCreate:true,canGrant:true,canRole:true,canDrop:true}};
 const detail=selected=>({target:selected,grants:[],roles:[],recipients:[],grantSql:[],definers:[],dependenciesComplete:true,fingerprint:'f',databases:['demo'],privileges:['SELECT'],roleCandidates:[]});
 const props={active:true,busy:false,readonly:false,setBusy(){},onState:s=>stateChanges.push(s)};let state;
 const hook=loadTypeScript('src/features/mysql/dba/useUserRoleTab.ts',{react:h.react,'@/shared/api/desktop':{ipcRenderer:{invoke:async(channel,input)=>{
 calls.push([channel,input]);if(channel==='list-mysql-accounts')return {success:true,snapshot};if(channel==='get-mysql-account')return {success:true,detail:detail(snapshot.accounts.find(row=>row.user===input.user))};if(channel==='review-mysql-account')return {success:true,review:{token:'one-use',request:input,sql:'ALTER USER <redacted>'}};if(channel==='execute-mysql-account')return {success:false,error:'mysql_user_operation_failed',transactionStatus:'idle',outcome:'failed'};throw new Error('Unexpected IPC');}}}},{Error});
 const render=()=>state=h.render(()=>hook.useUserRoleTab(props));const flush=async()=>{for(let i=0;i<6;i++){render();h.commit();await h.settle();}render();};return {get state(){return state;},props,calls,stateChanges,flush,unmount:h.unmount};
}
test('MySQL account UI clears passwords on attempts and hiding, excludes passwords from reviews and clears hidden selections',async()=>{
 const f=hookFixture();await f.flush();assert.equal(f.state.selected,key({user:'operator',host:'localhost'}));f.state.select(key(account));await f.flush();f.state.open('password');await f.flush();f.state.setPassword('sentinel-secret');await f.flush();await f.state.prepare();await f.flush();assert.ok(!JSON.stringify(f.calls.filter(c=>c[0]==='review-mysql-account')).includes('sentinel-secret'));
 f.state.setConfirm('alice@localhost');f.state.setAcknowledged(true);await f.flush();assert.equal(f.state.canExecute,true);await f.state.execute();await f.flush();assert.equal(f.state.password,'');assert.equal(f.state.review,undefined);assert.equal(f.calls.filter(c=>c[0]==='execute-mysql-account').length,1);assert.equal(f.stateChanges[0].transactionStatus,'idle');
 f.state.open('password');await f.flush();f.state.setPassword('sentinel-secret');await f.flush();f.props.active=false;await f.flush();assert.equal(f.state.password,'');assert.equal(f.state.draft,undefined);f.props.active=true;await f.flush();f.state.setSearch('does not exist');await f.flush();assert.equal(f.state.selected,'');assert.equal(f.state.can('drop'),false);f.unmount();
});
test('MySQL account screen follows Oracle list/detail split and disables protected changes',()=>{
 const state={rows:[],loading:false,detailLoading:false,selected:'',search:'',includeProtected:false,rolesOnly:false,pagination:{page:0,pageSize:100},can:()=>false,setSearch(){},setIncludeProtected(){},setRolesOnly(){},reload(){},setPagination(){},select(){},open(){}};
 const split={container:{current:null},ratio:0.35,leftWidth:300,start(){},move(){},stop(){},key(){}};
 const f=componentHarness('src/features/mysql/dba/UserRoleTab.tsx',{active:true,busy:false},{dependencies:{'./useUserRoleTab':{useUserRoleTab:()=>state},'@/features/dba/hooks/useDbaSplit':{useDbaSplit:()=>split},'@/features/data-grid/GridViewport':{GridViewport:'Viewport'},'@/components/data/ExportDialog':'Export','@mui/x-data-grid':{DataGrid:'Grid',enUS:require('@mui/x-data-grid').enUS,jaJP:require('@mui/x-data-grid').jaJP}}});
 assert.equal(f.node('Box',n=>n.props.role==='separator').props['aria-orientation'],'vertical');assert.equal(f.button('create_new').props.disabled,true);assert.equal(f.button('change_password').props.disabled,true);f.unmount();
});

test('MySQL create-account dialog opens while the protected operator is selected',async()=>{const f=hookFixture();await f.flush();assert.equal(f.state.can('create'),true);f.state.open('create');await f.flush();assert.equal(f.state.draft?.action,'create');assert.equal(f.state.password,'');f.unmount();});
