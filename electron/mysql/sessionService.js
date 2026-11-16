// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {createHash,randomUUID}=require('node:crypto');
const mysql=require('mysql2');
const accounts=require('./userRoleService');
const {inspectSqlPrivacy}=require('../services/sqlPrivacy');
const reviews=new WeakMap(),acting=new WeakSet();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{const error=new Error('mysql_session_'+code);error.safe=true;throw error;};
const permission=error=>/^ER_(?:TABLEACCESS_DENIED_ERROR|DBACCESS_DENIED_ERROR|SPECIFIC_ACCESS_DENIED_ERROR|ACCESS_DENIED_ERROR|NO_SUCH_TABLE):/.test(error.message||'');
const safe=error=>error.safe?error.message:'mysql_session_read_failed';
const numeric=value=>/^\d+$/.test(String(value))?String(value):null;
const text=value=>value===null||value===undefined?null:String(value);
function sqlText(value){if(typeof value!=='string'||!value)return null;try{return inspectSqlPrivacy(value,'mysql').sensitive?'[Sensitive SQL hidden]':value.slice(0,65536);}catch{return '[SQL unavailable]';}}
function strict(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('invalid');}
function target(input){strict(input,['id','fingerprint']);if(typeof input.id!=='string'||input.id.length>160||typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint))fail('invalid');return input;}
async function read(client,sql,binds={}){return (await client.execute(sql,binds,null,false,true)).rows;}
const threadSql='SELECT THREAD_ID,NAME,TYPE,PROCESSLIST_ID,PROCESSLIST_USER,PROCESSLIST_HOST,PROCESSLIST_DB,PROCESSLIST_COMMAND,PROCESSLIST_TIME,PROCESSLIST_STATE,PROCESSLIST_INFO FROM performance_schema.threads WHERE PROCESSLIST_ID IS NOT NULL ORDER BY PROCESSLIST_ID LIMIT 5001';
async function snapshot(client){
 if(client.closing||!client.main||!client.background||!client.control)fail('unavailable');
 const accountResult=await accounts.list(client);if(!accountResult.success)fail('read_failed');const accountInfo=accountResult.snapshot,full=accountInfo.context.scope==='all';
 let records,source='performance-schema',events=[],eventsAvailable=true;
 try{records=await read(client,threadSql);}catch(error){if(!permission(error))throw error;source='processlist';records=(await read(client,'SHOW FULL PROCESSLIST')).map(row=>({PROCESSLIST_ID:row.Id,PROCESSLIST_USER:row.User,PROCESSLIST_HOST:row.Host,PROCESSLIST_DB:row.db,PROCESSLIST_COMMAND:row.Command,PROCESSLIST_TIME:row.Time,PROCESSLIST_STATE:row.State,PROCESSLIST_INFO:row.Info,THREAD_ID:null,TYPE:'UNKNOWN',NAME:null}));}
 // Disabled Performance Schema may return an empty threads table without an error.
 if(source==='performance-schema'&&records.length===0){source='processlist';records=(await read(client,'SHOW FULL PROCESSLIST')).map(row=>({PROCESSLIST_ID:row.Id,PROCESSLIST_USER:row.User,PROCESSLIST_HOST:row.Host,PROCESSLIST_DB:row.db,PROCESSLIST_COMMAND:row.Command,PROCESSLIST_TIME:row.Time,PROCESSLIST_STATE:row.State,PROCESSLIST_INFO:row.Info,THREAD_ID:null,TYPE:'UNKNOWN',NAME:null}));}
 if(records.length>5000)fail('too_many');
 if(source==='performance-schema')try{events=await read(client,'SELECT THREAD_ID,EVENT_ID,TIMER_START,END_EVENT_ID,SQL_TEXT FROM performance_schema.events_statements_current WHERE END_EVENT_ID IS NULL LIMIT 5001');if(events.length>5000)fail('too_many');}catch(error){if(!permission(error))throw error;eventsAvailable=false;}else eventsAvailable=false;
 let canManage=false;
 if(full){
 const current=accountInfo.context.current,binds={user:current.user,host:current.host,grantee:mysql.escape(current.user)+'@'+mysql.escape(current.host)};
 const globals=await read(client,'SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=:grantee',binds),dynamic=await read(client,'SELECT PRIV FROM mysql.global_grants WHERE USER=:user AND HOST=:host',binds);
 canManage=globals.some(row=>row.PRIVILEGE_TYPE==='SUPER')||dynamic.some(row=>row.PRIV==='CONNECTION_ADMIN');
 }
 const protectionReady=full&&source==='performance-schema',protectedIds=new Set(client.connections.map(connection=>String(connection.threadId))),protectedUsers=new Set(accountInfo.accounts.filter(account=>account.protected).map(account=>account.user));
 const sessions=records.map(row=>{
 const connectionId=numeric(row.PROCESSLIST_ID),threadId=numeric(row.THREAD_ID);if(!connectionId)fail('identity');
 const user=String(row.PROCESSLIST_USER||''),host=String(row.PROCESSLIST_HOST||''),command=String(row.PROCESSLIST_COMMAND||''),event=events.find(e=>String(e.THREAD_ID)===threadId),current=event&&numeric(event.EVENT_ID)&&numeric(event.TIMER_START)&&event.SQL_TEXT&&event.END_EVENT_ID===null?event:null;
 const fingerprint=hash([accountInfo.context.server,connectionId,threadId,user,host,row.TYPE,row.NAME]);
 const execution=current?hash([fingerprint,String(current.EVENT_ID),String(current.TIMER_START),current.SQL_TEXT]):null;
 const protectedSession=!protectionReady||protectedIds.has(connectionId)||protectedUsers.has(user)||!user||user==='root'||user.startsWith('mysql.')||row.TYPE!=='FOREGROUND'||row.NAME!=='thread/sql/one_connection'||!['Query','Sleep'].includes(command);
 const canKill=!client.readonly&&canManage&&!protectedSession&&threadId!==null;
 return {id:connectionId+':'+(threadId||'visible'),fingerprint,execution,connectionId,threadId,user,host,database:text(row.PROCESSLIST_DB),command,seconds:String(row.PROCESSLIST_TIME??0),state:text(row.PROCESSLIST_STATE),sqlText:sqlText(current?.SQL_TEXT||row.PROCESSLIST_INFO),protected:protectedSession,canKill,canCancel:canKill&&command==='Query'&&Boolean(execution)};
 });
 return {sessions,fetchedAt:new Date().toISOString(),context:{server:accountInfo.context.server,scope:source==='performance-schema'?'all':'visible',source,protectionReady,readonly:Boolean(client.readonly),canManage:canManage&&protectionReady&&!client.readonly,eventsAvailable}};
}
async function list(client){try{return {success:true,snapshot:await snapshot(client)};}catch(error){return {success:false,error:safe(error)};}}
async function resolve(client,input){target(input);const info=await snapshot(client),row=info.sessions.find(row=>row.id===input.id);if(!row||row.fingerprint!==input.fingerprint)fail('changed');return {info,row};}
async function get(client,input){try{
 const {row}=await resolve(client,input);let statistics=[],statisticsAvailable=false,previousSqlText=null,historyAvailable=false;
 if(row.threadId){
 try{const rows=await read(client,'SELECT VARIABLE_NAME,VARIABLE_VALUE FROM performance_schema.status_by_thread WHERE THREAD_ID=:thread ORDER BY VARIABLE_NAME LIMIT 1001',{thread:row.threadId});if(rows.length>1000)fail('too_many');statistics=rows.map(r=>({id:r.VARIABLE_NAME,NAME:r.VARIABLE_NAME,VALUE:String(r.VARIABLE_VALUE)}));statisticsAvailable=true;}catch(error){if(!permission(error))throw error;}
 try{const rows=await read(client,'SELECT SQL_TEXT FROM performance_schema.events_statements_history WHERE THREAD_ID=:thread AND END_EVENT_ID IS NOT NULL ORDER BY EVENT_ID DESC LIMIT 1',{thread:row.threadId});previousSqlText=sqlText(rows[0]?.SQL_TEXT);historyAvailable=true;}catch(error){if(!permission(error))throw error;}
 }
 // Do not associate a completed detail read with a reused connection or a newer statement.
 const {row:latest}=await resolve(client,input);if(latest.execution!==row.execution)fail('sql_changed');
 return {success:true,detail:{sessionId:row.id,fingerprint:row.fingerprint,execution:row.execution,statistics,statisticsAvailable,sqlText:row.sqlText,previousSqlText,historyAvailable,fetchedAt:new Date().toISOString()}};
 }catch(error){return {success:false,error:safe(error)};}}
async function prepare(client,input){
 strict(input,['id','fingerprint','action','execution']);if(!['cancel','kill'].includes(input.action))fail('invalid');
 const {row}=await resolve(client,{id:input.id,fingerprint:input.fingerprint});
 if(client.readonly||client.getTransactionDetails().transactionStatus==='unknown'||!(input.action==='cancel'?row.canCancel:row.canKill))fail('protected');
 if(input.action==='cancel'&&input.execution!==row.execution)fail('sql_changed');
 return {row,sql:`KILL ${input.action==='cancel'?'QUERY':'CONNECTION'} ${row.connectionId}`};
}
async function review(client,input){try{
 const prepared=await prepare(client,input),token=randomUUID(),expires=Date.now()+60000;let cache=reviews.get(client);if(!cache){cache=new Map();reviews.set(client,cache);}for(const [key,value] of cache)if(value.expires<Date.now())cache.delete(key);if(cache.size>=32)fail('too_many');
 cache.set(token,{request:{id:prepared.row.id,fingerprint:prepared.row.fingerprint,action:input.action,...(input.action==='cancel'?{execution:prepared.row.execution}:{})},sql:prepared.sql,expires,connection:client.control.threadId});
 return {success:true,review:{token,sql:prepared.sql,target:prepared.row,action:input.action,expiresAt:new Date(expires).toISOString()}};
 }catch(error){return {success:false,error:safe(error)};}}
async function execute(client,input){
 if(acting.has(client))return {success:false,error:'mysql_session_busy',submitted:false,status:'failed'};acting.add(client);let submitted=false;
 try{
 strict(input,['token','confirm','acknowledged']);const cache=reviews.get(client),saved=cache?.get(input.token);cache?.delete(input.token);
 if(!saved||saved.expires<Date.now()||saved.connection!==client.control?.threadId||input.confirm!==saved.request.id.split(':')[0]||input.acknowledged!==true)fail('review');
 const checked=await prepare(client,saved.request);if(checked.sql!==saved.sql||client.closing)fail('changed');submitted=true;
 // The dedicated control connection keeps the user's main transaction untouched.
 await client.control.promise().query({sql:checked.sql,timeout:10000,rowsAsArray:true});
 let info;try{info=await snapshot(client);}catch{return {success:true,submitted:true,status:'requested'};}
 const current=info.sessions.find(row=>row.id===checked.row.id&&row.fingerprint===checked.row.fingerprint);
 const observed=saved.request.action==='kill'?!current:!current||current.command==='Sleep'||current.execution!==checked.row.execution;
 return {success:true,submitted:true,status:observed?'observed':'requested'};
 }catch(error){const rejected=['ER_NO_SUCH_THREAD','ER_KILL_DENIED_ERROR','ER_SPECIFIC_ACCESS_DENIED_ERROR','ER_ACCESS_DENIED_ERROR'].includes(error.code)||/^(ER_(?:NO_SUCH_THREAD|KILL_DENIED_ERROR|SPECIFIC_ACCESS_DENIED_ERROR|ACCESS_DENIED_ERROR)):/.test(error.message||'');return {success:false,submitted,status:submitted&&!rejected?'unknown':'failed',error:error.safe?error.message:submitted&&!rejected?'mysql_session_unknown':'mysql_session_failed'};}
 finally{acting.delete(client);}
}
module.exports={list,get,review,execute};
