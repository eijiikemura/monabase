// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const mysql=require('mysql2');const {createHash,randomUUID}=require('node:crypto');const accounts=require('./userRoleService');
const reviews=new WeakMap(),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const types={TABLE:['SELECT','INSERT','UPDATE','DELETE','REFERENCES','ALTER','INDEX','DROP','TRIGGER'],VIEW:['SELECT','INSERT','UPDATE','DELETE','SHOW VIEW'],PROCEDURE:['EXECUTE','ALTER ROUTINE'],FUNCTION:['EXECUTE','ALTER ROUTINE']};
const key=account=>JSON.stringify([account.user,account.host]),q=name=>'`'+name.replaceAll('`','``')+'`',qa=account=>mysql.escape(account.user)+'@'+mysql.escape(account.host);
const fail=code=>{const error=new Error('mysql_obj_'+code);error.safe=true;throw error;};
function strict(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('invalid');}
function target(value){strict(value,['schema','name','type']);if(!Object.hasOwn(types,value.type)||['schema','name'].some(k=>typeof value[k]!=='string'||!value[k]||[...value[k]].length>64||value[k].includes('\0')))fail('invalid');if(['mysql','sys','information_schema','performance_schema'].includes(value.schema.toLowerCase()))fail('protected');return {...value};}
function principal(value){strict(value,['user','host']);if(typeof value.user!=='string'||!value.user||[...value.user].length>32||typeof value.host!=='string'||!value.host||value.host.length>255||[...value.user+value.host].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))fail('invalid');return {...value};}
async function read(client,sql,binds={}){return (await client.execute(sql,binds,null,false,true)).rows;}
const safe=error=>error.safe?error.message:'mysql_obj_load_failed';
async function detail(client,input){
 const object=target(input);if(client.closing||!client.main)fail('unavailable');
 const snapshot=await accounts.list(client);if(!snapshot.success)fail('load_failed');const context=snapshot.snapshot;
 const routine=['PROCEDURE','FUNCTION'].includes(object.type),binds={schema:object.schema,name:object.name,type:object.type};
 const identity=routine?await read(client,'SELECT ROUTINE_SCHEMA,ROUTINE_NAME,ROUTINE_TYPE,CREATED,LAST_ALTERED,SECURITY_TYPE,DEFINER FROM information_schema.ROUTINES WHERE CAST(ROUTINE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(ROUTINE_NAME AS BINARY)=CAST(:name AS BINARY) AND ROUTINE_TYPE=:type',binds):await read(client,'SELECT TABLE_SCHEMA,TABLE_NAME,TABLE_TYPE,ENGINE,CREATE_TIME FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY)',binds);
 if(identity.length!==1||!routine&&identity[0].TABLE_TYPE!==(object.type==='TABLE'?'BASE TABLE':'VIEW'))fail('missing');
 const full=context.context.scope==='all';let grants=[],columnGrants=[],sourceHash=null;
 if(full){
  if(object.type==='TABLE'){
   const columns=await read(client,'SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,GENERATION_EXPRESSION,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY) ORDER BY ORDINAL_POSITION',binds);
   if(!columns.length)fail('definition');sourceHash=hash(columns);
  }else{
   const source=(await read(client,`SHOW CREATE ${object.type} ${q(object.schema)}.${q(object.name)}`))[0];
   const body=source?.['Create '+object.type[0]+object.type.slice(1).toLowerCase()];if(typeof body!=='string'||!body)fail('definition');sourceHash=hash(body);
  }
  if(routine){
   const rows=await read(client,'SELECT User,Host,Proc_priv,Grantor FROM mysql.procs_priv WHERE CAST(Db AS BINARY)=CAST(:schema AS BINARY) AND CAST(Routine_name AS BINARY)=CAST(:name AS BINARY) AND Routine_type=:type ORDER BY User,Host',binds);
   for(const row of rows){const list=String(row.Proc_priv).split(',').map(v=>v.toUpperCase());for(const privilege of list.filter(p=>p&&p!=='GRANT'))grants.push({account:{user:row.User,host:row.Host},privilege,grantable:list.includes('GRANT'),grantor:row.Grantor||null});}
  }else{
   const rows=await read(client,'SELECT User,Host,Table_priv,Grantor FROM mysql.tables_priv WHERE CAST(Db AS BINARY)=CAST(:schema AS BINARY) AND CAST(Table_name AS BINARY)=CAST(:name AS BINARY) ORDER BY User,Host',binds);
   for(const row of rows){const list=String(row.Table_priv).split(',').map(v=>v.toUpperCase());for(const privilege of list.filter(p=>p&&p!=='GRANT'))grants.push({account:{user:row.User,host:row.Host},privilege,grantable:list.includes('GRANT'),grantor:row.Grantor||null});}
   const columns=await read(client,'SELECT User,Host,Column_name,Column_priv FROM mysql.columns_priv WHERE CAST(Db AS BINARY)=CAST(:schema AS BINARY) AND CAST(Table_name AS BINARY)=CAST(:name AS BINARY) ORDER BY User,Host,Column_name',binds);
   for(const row of columns)for(const privilege of String(row.Column_priv).split(',').map(v=>v.toUpperCase()).filter(Boolean))columnGrants.push({account:{user:row.User,host:row.Host},privilege,column:row.Column_name,grantable:rows.some(r=>r.User===row.User&&r.Host===row.Host&&String(r.Table_priv).split(',').includes('Grant')),grantor:null});
  }
 }else if(!routine){
  const visible={...binds,grantee:qa(context.context.current)};
  const rows=await read(client,'SELECT PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY) AND GRANTEE=:grantee',visible);
  grants=rows.map(row=>({account:context.context.current,privilege:row.PRIVILEGE_TYPE,grantable:row.IS_GRANTABLE==='YES',grantor:null}));
  const cols=await read(client,'SELECT COLUMN_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.COLUMN_PRIVILEGES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY) AND GRANTEE=:grantee',visible);
  columnGrants=cols.map(row=>({account:context.context.current,column:row.COLUMN_NAME,privilege:row.PRIVILEGE_TYPE,grantable:row.IS_GRANTABLE==='YES',grantor:null}));
 }
 const sort=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));grants.sort(sort);columnGrants.sort(sort);
 const result={target:object,principals:context.accounts,scope:full?'all':'visible',mutable:full&&context.context.canGrant&&!client.readonly,readonly:Boolean(client.readonly),current:context.context.current,privileges:types[object.type],grants,columnGrants,complete:full};
 return {...result,fingerprint:hash([context.context.server,result,identity,sourceHash])};
}
async function get(client,input){try{return {success:true,detail:await detail(client,input)};}catch(error){return {success:false,error:safe(error)};}}
function editable(info,account,privilege){
 const row=info.principals.find(row=>key(row)===key(account));
 return Boolean(info.mutable&&row&&!row.protected&&info.privileges.includes(privilege)&&!info.columnGrants.some(g=>key(g.account)===key(account)&&g.privilege===privilege)&&!info.grants.some(g=>key(g.account)===key(account)&&g.privilege===privilege&&g.grantable));
}
async function build(client,input){
 strict(input,['target','grantee','privilege','action','expected']);const object=target(input.target),account=principal(input.grantee);
 if(!['grant','revoke'].includes(input.action)||typeof input.expected!=='string')fail('invalid');
 const info=await detail(client,object);if(info.fingerprint!==input.expected)fail('changed');if(!editable(info,account,input.privilege))fail('protected');
 const exists=info.grants.some(g=>key(g.account)===key(account)&&g.privilege===input.privilege);if(exists===(input.action==='grant'))fail('no_changes');
 const request={target:object,grantee:account,privilege:input.privilege,action:input.action,expected:input.expected};
 const objectSql=(['PROCEDURE','FUNCTION'].includes(object.type)?object.type+' ':'')+q(object.schema)+'.'+q(object.name);
 return {request,sql:`${input.action==='grant'?'GRANT':'REVOKE'} ${input.privilege} ON ${objectSql} ${input.action==='grant'?'TO':'FROM'} ${qa(account)}`,connection:client.main.threadId};
}
async function review(client,input){try{
 const prepared=await build(client,input),token=randomUUID(),expires=Date.now()+300000;let cache=reviews.get(client);if(!cache){cache=new Map();reviews.set(client,cache);}for(const [key,value] of cache)if(value.expires<Date.now())cache.delete(key);if(cache.size>=32)fail('too_many');
 cache.set(token,{...prepared,request:JSON.parse(JSON.stringify(prepared.request)),expires});return {success:true,review:{token,sql:prepared.sql,request:prepared.request,expiresAt:new Date(expires).toISOString()}};
 }catch(error){return {success:false,error:safe(error)};}}
async function execute(client,input){return client.enqueue(async()=>{
 let submitted=false;
 try{
  strict(input,['token','confirm','acknowledged']);const cache=reviews.get(client),saved=cache?.get(input.token);cache?.delete(input.token);
  if(!saved||saved.expires<Date.now()||saved.connection!==client.main?.threadId||input.acknowledged!==true||input.confirm!==saved.request.grantee.user+'@'+saved.request.grantee.host)fail('review');
  if(client.closing||client.readonly||client.getTransactionDetails().transactionStatus==='unknown')fail('unavailable');
  const checked=await build(client,saved.request);if(checked.sql!==saved.sql)fail('changed');submitted=true;await client.run(client.main,{sql:checked.sql,command:checked.request.action.toUpperCase()});
  let fresh;try{fresh=await detail(client,saved.request.target);}catch{return {success:true,applied:true,outcome:'applied',refreshError:'mysql_obj_applied_unconfirmed',...client.getTransactionDetails()};}
  const actual=fresh.grants.some(row=>key(row.account)===key(saved.request.grantee)&&row.privilege===saved.request.privilege);
  return {success:true,applied:true,outcome:'applied',detail:fresh,...(actual!==(saved.request.action==='grant')?{refreshError:'mysql_obj_applied_unconfirmed'}:{}),...client.getTransactionDetails()};
 }catch(error){const unknown=submitted&&client.getTransactionDetails().transactionStatus==='unknown';return {success:false,applied:false,outcome:unknown?'unknown':'failed',error:error.safe?error.message:unknown?'mysql_obj_unknown':'mysql_obj_failed',...(/^(ER_[A-Z0-9_]+):/.test(error.message||'')?{errorCode:error.message.match(/^(ER_[A-Z0-9_]+):/)[1]}:{}),...client.getTransactionDetails()};}
 });}
module.exports={get,review,execute,editable};
