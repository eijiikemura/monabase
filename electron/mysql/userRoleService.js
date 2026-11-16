// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const mysql=require('mysql2');const {createHash,randomUUID}=require('node:crypto');
const reviews=new WeakMap();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=account=>JSON.stringify([account.user,account.host]);
const accountSql=account=>`${mysql.escape(account.user)}@${mysql.escape(account.host)}`;
const label=account=>`${account.user}@${account.host}`;
const privileges=['SELECT','INSERT','UPDATE','DELETE','CREATE','ALTER','DROP','INDEX','REFERENCES','CREATE TEMPORARY TABLES','LOCK TABLES','EXECUTE','CREATE VIEW','SHOW VIEW','CREATE ROUTINE','ALTER ROUTINE','EVENT','TRIGGER'];
const fail=key=>{const error=new Error('mysql_user_'+key);error.safe=true;throw error;};
function strict(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('invalid');}
function account(value){strict(value,['user','host']);if(typeof value.user!=='string'||!value.user||[...value.user].length>32||typeof value.host!=='string'||!value.host||value.host.length>255||[...value.user+value.host].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))fail('invalid');return {user:value.user,host:value.host};}
function limits(value){strict(value,['queries','updates','connections','concurrent']);for(const key of ['queries','updates','connections','concurrent'])if(!Number.isSafeInteger(value[key])||value[key]<0||value[key]>4294967295)fail('invalid');return {...value};}
const internal=user=>user==='root'||user.startsWith('mysql.')||user==='';
const permission=error=>/^ER_(?:TABLEACCESS_DENIED_ERROR|DBACCESS_DENIED_ERROR|SPECIFIC_ACCESS_DENIED_ERROR|ACCESS_DENIED_ERROR):/.test(error.message||'');
const safeError=error=>error.safe?error.message:'mysql_user_load_failed';
function state(client){if(!client.main||client.closing)fail('unavailable');}
async function query(client,sql,binds={}){return (await client.execute(sql,binds,null,false,true)).rows;}
const rowsSql='SELECT User AS user,Host AS host,plugin,account_locked,password_expired,password_last_changed,max_questions,max_updates,max_connections,max_user_connections,Create_user_priv,Create_role_priv,Grant_priv,Super_priv,File_priv,Shutdown_priv,Reload_priv,Process_priv,Repl_slave_priv,Repl_client_priv,Create_tablespace_priv FROM mysql.user ORDER BY User,Host LIMIT 2001';
async function snapshot(client){
 state(client);
 const identity=(await query(client,'SELECT CURRENT_USER() AS currentAccount,@@server_uuid AS server,CURRENT_ROLE() AS activeRoles'))[0];
 if(!identity?.server||typeof identity.currentAccount!=='string')fail('identity');
 const separator=identity.currentAccount.lastIndexOf('@');if(separator<0)fail('identity');
 const current={user:identity.currentAccount.slice(0,separator),host:identity.currentAccount.slice(separator+1)};
 let rows,edges,dynamic,grants;
 try{
  rows=await query(client,rowsSql);if(rows.length>2000)fail('too_many');
  edges=await query(client,'SELECT FROM_USER,FROM_HOST,TO_USER,TO_HOST,WITH_ADMIN_OPTION FROM mysql.role_edges');
  dynamic=await query(client,'SELECT USER,HOST,PRIV,WITH_GRANT_OPTION FROM mysql.global_grants');
  grants=await query(client,'SELECT GRANTEE,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.USER_PRIVILEGES');
 }catch(error){
  if(!permission(error))throw error;
  return {accounts:[{...current,id:id(current),plugin:null,locked:null,expired:null,protected:true,self:true,referencedRole:false,limits:{queries:0,updates:0,connections:0,concurrent:0}}],context:{server:String(identity.server),current,scope:'self',readonly:Boolean(client.readonly),canCreate:false,canGrant:false,canRole:false,canDrop:false,roles:String(identity.activeRoles||'NONE')},fetchedAt:new Date().toISOString()};
 }
 const closure=target=>{const found=new Set([id(target)]),queue=[target];for(let i=0;i<queue.length;i++)for(const edge of edges)if(id({user:edge.TO_USER,host:edge.TO_HOST})===id(queue[i])){const role={user:edge.FROM_USER,host:edge.FROM_HOST};if(!found.has(id(role))){found.add(id(role));queue.push(role);}}return found;};
 const elevated=target=>{const all=closure(target);return rows.some(row=>all.has(id(row))&&(row.Create_user_priv==='Y'||row.Create_role_priv==='Y'||row.Grant_priv==='Y'||row.Super_priv==='Y'||['File_priv','Shutdown_priv','Reload_priv','Process_priv','Repl_slave_priv','Repl_client_priv','Create_tablespace_priv'].some(key=>row[key]==='Y')))||dynamic.some(row=>all.has(id({user:row.USER,host:row.HOST})))||grants.some(row=>rows.some(a=>all.has(id(a))&&row.GRANTEE===accountSql(a))&&(row.IS_GRANTABLE==='YES'||!privileges.includes(row.PRIVILEGE_TYPE)&&row.PRIVILEGE_TYPE!=='USAGE'));};
 const own=closure(current),ownRows=rows.filter(row=>own.has(id(row))),ownDynamic=dynamic.filter(row=>own.has(id({user:row.USER,host:row.HOST}))),ownGrants=grants.filter(row=>[...ownRows].some(a=>row.GRANTEE===accountSql(a)));
 const global=name=>ownGrants.some(row=>row.PRIVILEGE_TYPE===name);
 const writable=!client.readonly,canCreate=writable&&ownRows.some(row=>row.Create_user_priv==='Y');
 const context={server:String(identity.server),current,scope:'all',readonly:Boolean(client.readonly),canCreate,canGrant:writable&&ownRows.some(row=>row.Grant_priv==='Y'),canRole:writable&&ownDynamic.some(row=>row.PRIV==='ROLE_ADMIN'),canDrop:canCreate&&['SELECT','SHOW VIEW','TRIGGER','EVENT'].every(global)&&ownDynamic.some(row=>row.PRIV==='SHOW_ROUTINE'),roles:String(identity.activeRoles||'NONE')};
 const accounts=rows.map(row=>({user:row.user,host:row.host,id:id(row),plugin:typeof row.plugin==='string'?row.plugin:null,locked:row.account_locked==='Y',expired:row.password_expired==='Y',passwordChanged:row.password_last_changed||null,self:id(row)===id(current),protected:internal(row.user)||id(row)===id(current)||elevated(row),referencedRole:edges.some(edge=>edge.FROM_USER===row.user&&edge.FROM_HOST===row.host),limits:{queries:Number(row.max_questions),updates:Number(row.max_updates),connections:Number(row.max_connections),concurrent:Number(row.max_user_connections)}}));
 return {accounts,context,fetchedAt:new Date().toISOString()};
}
async function list(client){try{return {success:true,snapshot:await snapshot(client)};}catch(error){return {success:false,error:safeError(error)};}}
async function detailFrom(client,snap,target){
 const selected=snap.accounts.find(row=>row.id===id(target));if(!selected)fail('changed');
 const sql=accountSql(target),binds={grantee:sql,user:target.user,host:target.host};
 // This fixed metadata command is serialized separately; the generic SQL read policy rejects FOR.
 const raw=await client.enqueue(async()=>{state(client);const [rows]=await client.background.promise().query({sql:`SHOW GRANTS FOR ${sql}`,rowsAsArray:true,timeout:10000});if(rows.length>2000||Buffer.byteLength(JSON.stringify(rows))>1024*1024)fail('too_many');return rows.map(row=>row[0]);},true);
 if(raw.some(row=>typeof row!=='string'||row.length>65535||!/^GRANT |^REVOKE /.test(row)||/\bIDENTIFIED\s+(?:BY|WITH|AS)\b/.test(row)))fail('grants_unavailable');
 let grantRows=[],roleRows=[],defaultRows=[],recipients=[],definers=[],databases=[],dependenciesComplete=false;
 if(snap.context.scope==='all'){
  grantRows=await query(client,"SELECT 'global' AS scope,'' AS databaseName,PRIVILEGE_TYPE AS privilegeName,IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=:grantee UNION ALL SELECT 'database',TABLE_SCHEMA,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=:grantee",binds);
  roleRows=await query(client,'SELECT FROM_USER,FROM_HOST,WITH_ADMIN_OPTION FROM mysql.role_edges WHERE CAST(TO_USER AS BINARY)=CAST(:user AS BINARY) AND CAST(TO_HOST AS BINARY)=CAST(:host AS BINARY)',binds);
  defaultRows=await query(client,'SELECT DEFAULT_ROLE_USER,DEFAULT_ROLE_HOST FROM mysql.default_roles WHERE CAST(USER AS BINARY)=CAST(:user AS BINARY) AND CAST(HOST AS BINARY)=CAST(:host AS BINARY)',binds);
  recipients=await query(client,'SELECT TO_USER,TO_HOST,WITH_ADMIN_OPTION FROM mysql.role_edges WHERE CAST(FROM_USER AS BINARY)=CAST(:user AS BINARY) AND CAST(FROM_HOST AS BINARY)=CAST(:host AS BINARY)',binds);
  if(snap.context.canDrop){
   definers=await query(client,"SELECT TABLE_SCHEMA AS schemaName,TABLE_NAME AS objectName,'VIEW' AS kind FROM information_schema.VIEWS WHERE DEFINER=:definer UNION ALL SELECT ROUTINE_SCHEMA,ROUTINE_NAME,ROUTINE_TYPE FROM information_schema.ROUTINES WHERE DEFINER=:definer UNION ALL SELECT TRIGGER_SCHEMA,TRIGGER_NAME,'TRIGGER' FROM information_schema.TRIGGERS WHERE DEFINER=:definer UNION ALL SELECT EVENT_SCHEMA,EVENT_NAME,'EVENT' FROM information_schema.EVENTS WHERE DEFINER=:definer LIMIT 201",{definer:label(target)});dependenciesComplete=definers.length<=200;
  }
  databases=(await query(client,'SHOW DATABASES')).map(row=>String(Object.values(row)[0])).filter(name=>!['mysql','sys','information_schema','performance_schema'].includes(name));
 }
 const normalized={target:selected,grants:grantRows.map(row=>({scope:row.scope,database:row.databaseName,privilege:row.privilegeName,grantable:row.IS_GRANTABLE==='YES'})),roles:roleRows.map(row=>({user:row.FROM_USER,host:row.FROM_HOST,admin:row.WITH_ADMIN_OPTION==='Y',defaultRole:defaultRows.some(d=>d.DEFAULT_ROLE_USER===row.FROM_USER&&d.DEFAULT_ROLE_HOST===row.FROM_HOST)})),recipients:recipients.map(row=>({user:row.TO_USER,host:row.TO_HOST,admin:row.WITH_ADMIN_OPTION==='Y',defaultRole:false})),grantSql:raw,definers:definers.map(row=>({schema:row.schemaName,name:row.objectName,kind:row.kind})),dependenciesComplete,databases,privileges,roleCandidates:snap.accounts.filter(row=>!row.protected&&row.id!==selected.id).map(row=>({user:row.user,host:row.host}))};
 return {...normalized,fingerprint:hash([snap.context.server,snap.context.current,selected,normalized.grants,normalized.roles,normalized.recipients,raw,normalized.definers,dependenciesComplete])};
}
async function get(client,input){try{const target=account(input),snap=await snapshot(client);return {success:true,detail:await detailFrom(client,snap,target)};}catch(error){return {success:false,error:safeError(error)};}}
async function build(client,input){
 strict(input,['action','target','expected','kind','locked','privilege','scope','database','role','limits']);
 const actions=['create','password','lock','drop','grant','revoke','role-grant','role-revoke','default-role','limits'];if(!actions.includes(input.action))fail('invalid');
 const target=account(input.target),snap=await snapshot(client);if(snap.context.readonly||snap.context.scope!=='all')fail('permission');
 const request={action:input.action,target};let sql,info;
 if(input.action==='create'){
  if(!snap.context.canCreate||internal(target.user)||!['USER','ROLE'].includes(input.kind)||typeof input.locked!=='boolean')fail('protected');
  if(snap.accounts.some(row=>row.id===id(target)))fail('exists');request.kind=input.kind;request.locked=input.locked;
  sql=`CREATE ${input.kind} ${accountSql(target)}${input.kind==='USER'?` IDENTIFIED WITH caching_sha2_password BY '<redacted>' ACCOUNT ${input.locked?'LOCK':'UNLOCK'}`:''}`;
 }else{
  info=await detailFrom(client,snap,target);if(info.target.protected||input.expected!==info.fingerprint)fail('changed');request.expected=info.fingerprint;
  const q=accountSql(target);
  if(['password','lock','drop','limits'].includes(input.action)&&!snap.context.canCreate)fail('permission');
  if(input.action==='password'){if(info.target.plugin!=='caching_sha2_password')fail('authentication');sql=`ALTER USER ${q} IDENTIFIED WITH caching_sha2_password BY '<redacted>'`;}
  else if(input.action==='lock'){if(typeof input.locked!=='boolean'||input.locked===info.target.locked)fail('no_changes');request.locked=input.locked;sql=`ALTER USER ${q} ACCOUNT ${input.locked?'LOCK':'UNLOCK'}`;}
  else if(input.action==='drop'){if(!snap.context.canDrop||!info.dependenciesComplete||info.definers.length)fail('dependencies');sql=`DROP USER ${q}`;}
  else if(input.action==='limits'){request.limits=limits(input.limits);if(Object.keys(request.limits).every(key=>request.limits[key]===info.target.limits[key]))fail('no_changes');sql=`ALTER USER ${q} WITH MAX_QUERIES_PER_HOUR ${request.limits.queries} MAX_UPDATES_PER_HOUR ${request.limits.updates} MAX_CONNECTIONS_PER_HOUR ${request.limits.connections} MAX_USER_CONNECTIONS ${request.limits.concurrent}`;}
  else if(input.action==='grant'||input.action==='revoke'){
   if(!snap.context.canGrant||!privileges.includes(input.privilege)||!['global','database'].includes(input.scope))fail('permission');
   const database=input.scope==='database'?input.database:'';if(typeof database!=='string'||input.scope==='database'&&!info.databases.includes(database))fail('invalid');
   const existing=info.grants.some(row=>row.scope===input.scope&&row.database===database&&row.privilege===input.privilege);if(existing===(input.action==='grant'))fail('no_changes');
   Object.assign(request,{privilege:input.privilege,scope:input.scope,database});const scope=input.scope==='global'?'*.*':'`'+database.replaceAll('`','``')+'`.*';sql=`${input.action==='grant'?'GRANT':'REVOKE'} ${input.privilege} ON ${scope} ${input.action==='grant'?'TO':'FROM'} ${q}`;
  }else{
   if(!snap.context.canRole)fail('permission');const role=input.role===null?null:account(input.role);request.role=role;
   if(role&&!info.roleCandidates.some(row=>id(row)===id(role)))fail('protected');
   if(input.action==='default-role'){if(role&&!info.roles.some(row=>id(row)===id(role)))fail('invalid');const defaults=info.roles.filter(row=>row.defaultRole);if(!role&&!defaults.length||role&&defaults.length===1&&id(defaults[0])===id(role))fail('no_changes');sql=`SET DEFAULT ROLE ${role?accountSql(role):'NONE'} TO ${q}`;}
   else{
    if(!role)fail('invalid');const existing=info.roles.some(row=>id(row)===id(role));if(existing===(input.action==='role-grant'))fail('no_changes');
    if(input.action==='role-grant'){
     const edges=await query(client,'SELECT FROM_USER,FROM_HOST,TO_USER,TO_HOST FROM mysql.role_edges');const seen=new Set([id(role)]),queue=[role];for(let i=0;i<queue.length;i++)for(const edge of edges)if(id({user:edge.TO_USER,host:edge.TO_HOST})===id(queue[i])){const next={user:edge.FROM_USER,host:edge.FROM_HOST};if(id(next)===id(target))fail('cycle');if(!seen.has(id(next))){seen.add(id(next));queue.push(next);}}
    }
    sql=`${input.action==='role-grant'?'GRANT':'REVOKE'} ${accountSql(role)} ${input.action==='role-grant'?'TO':'FROM'} ${q}`;
   }
  }
 }
 return {request,sql,fingerprint:hash([snap.context,request,info?.fingerprint]),connection:client.main.threadId};
}
async function review(client,input){try{
 const prepared=await build(client,input),token=randomUUID(),expires=Date.now()+300000;let cache=reviews.get(client);if(!cache){cache=new Map();reviews.set(client,cache);}for(const [key,value] of cache)if(value.expires<Date.now())cache.delete(key);if(cache.size>=32)fail('too_many');cache.set(token,{...prepared,request:JSON.parse(JSON.stringify(prepared.request)),expires});
 return {success:true,review:{token,sql:prepared.sql,request:prepared.request,expiresAt:new Date(expires).toISOString()}};
}catch(error){return {success:false,error:safeError(error)};}}
async function execute(client,input){
 return client.enqueue(async()=>{
  let submitted=false;
  try{
   strict(input,['token','password','confirm','acknowledged']);if(typeof input.token!=='string')fail('invalid');const cache=reviews.get(client),saved=cache?.get(input.token);cache?.delete(input.token);
   if(!saved||saved.expires<Date.now()||saved.connection!==client.main?.threadId||input.acknowledged!==true||input.confirm!==label(saved.request.target))fail('review');
   if(client.readonly||client.getTransactionDetails().transactionStatus==='unknown')fail('unavailable');
   const fresh=await build(client,saved.request);if(fresh.fingerprint!==saved.fingerprint)fail('changed');
   let sql=fresh.sql;
   const sensitive=saved.request.action==='password'||saved.request.action==='create'&&saved.request.kind==='USER';
   if(sensitive){if(typeof input.password!=='string'||!input.password||input.password.length>1024||input.password.includes('\0'))fail('password');const marker=sql.lastIndexOf("'<redacted>'");if(marker<0)fail('invalid');sql=sql.slice(0,marker)+mysql.escape(input.password)+sql.slice(marker+12);}
   else if(input.password!==undefined)fail('invalid');
   submitted=true;await client.run(client.main,{sql,command:saved.request.action.toUpperCase()});
   return {success:true,applied:true,outcome:'applied',...client.getTransactionDetails()};
  }catch(error){
   const unknown=submitted&&client.getTransactionDetails().transactionStatus==='unknown';
   return {success:false,error:error.safe?error.message:unknown?'mysql_user_unknown':'mysql_user_operation_failed',applied:false,outcome:unknown?'unknown':'failed',...(/^(ER_[A-Z0-9_]+):/.test(error.message||'')?{errorCode:error.message.match(/^(ER_[A-Z0-9_]+):/)[1]}:{}),...client.getTransactionDetails()};
  }
 });
}
module.exports={list,get,review,execute,privileges};
