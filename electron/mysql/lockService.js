// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {createHash,randomUUID}=require('node:crypto');
const sessions=require('./sessionService');
const reviews=new WeakMap(),acting=new WeakSet();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{const error=new Error('mysql_lock_'+code);error.safe=true;throw error;};
const safe=error=>error.safe?error.message:'mysql_lock_read_failed';
const text=value=>value===null||value===undefined?null:String(value);
const numeric=value=>/^\d+$/.test(String(value))?String(value):null;
const key=(engine,id)=>JSON.stringify([engine,id]);
async function read(client,sql,binds={}){return (await client.execute(sql,binds,null,false,true)).rows;}
function target(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['id','fingerprint'].includes(key))||typeof input.id!=='string'||input.id.length>2048||typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint))fail('invalid');}
async function snapshot(client){
 if(!client.main||client.closing)fail('unavailable');
 const enabled=(await read(client,'SELECT @@performance_schema AS enabled'))[0];if(!['1','ON'].includes(String(enabled?.enabled)))fail('instrumentation');
 const locks=await read(client,"SELECT ENGINE,ENGINE_LOCK_ID,ENGINE_TRANSACTION_ID,THREAD_ID,OBJECT_SCHEMA,OBJECT_NAME,PARTITION_NAME,INDEX_NAME,LOCK_TYPE,LOCK_MODE,LOCK_STATUS FROM performance_schema.data_locks WHERE ENGINE IN ('INNODB') ORDER BY ENGINE_LOCK_ID LIMIT 5001");
 const edges=await read(client,"SELECT ENGINE,REQUESTING_ENGINE_LOCK_ID,BLOCKING_ENGINE_LOCK_ID FROM performance_schema.data_lock_waits WHERE ENGINE IN ('INNODB') LIMIT 5001");
 if(locks.length>5000||edges.length>5000)fail('too_many');
 const result=await sessions.list(client);if(!result.success)fail('read_failed');const info=result.snapshot;
 const ids=new Map();for(const row of locks){if(!row.ENGINE_LOCK_ID||ids.has(key(row.ENGINE,row.ENGINE_LOCK_ID)))fail('identity');ids.set(key(row.ENGINE,row.ENGINE_LOCK_ID),hash([info.context.server,row.ENGINE,row.ENGINE_LOCK_ID]));}
 // Performance Schema tables are live observations, not a transactional snapshot.
 const consistent=locks.every(row=>row.LOCK_STATUS!=='WAITING'||edges.some(edge=>edge.ENGINE===row.ENGINE&&edge.REQUESTING_ENGINE_LOCK_ID===row.ENGINE_LOCK_ID))&&edges.every(edge=>ids.has(key(edge.ENGINE,edge.REQUESTING_ENGINE_LOCK_ID))&&ids.has(key(edge.ENGINE,edge.BLOCKING_ENGINE_LOCK_ID)));
 let bytes=0;
 const rows=locks.map(row=>{
 const id=ids.get(key(row.ENGINE,row.ENGINE_LOCK_ID)),threadId=numeric(row.THREAD_ID),session=threadId?info.sessions.find(session=>session.threadId===threadId)||null:null;
 const blockers=[...new Set(edges.filter(edge=>edge.ENGINE===row.ENGINE&&edge.REQUESTING_ENGINE_LOCK_ID===row.ENGINE_LOCK_ID).map(edge=>ids.get(key(edge.ENGINE,edge.BLOCKING_ENGINE_LOCK_ID))).filter(Boolean))].sort();
 const waiters=[...new Set(edges.filter(edge=>edge.ENGINE===row.ENGINE&&edge.BLOCKING_ENGINE_LOCK_ID===row.ENGINE_LOCK_ID).map(edge=>ids.get(key(edge.ENGINE,edge.REQUESTING_ENGINE_LOCK_ID))).filter(Boolean))].sort();
 const protectedLock=!consistent||!session||session.protected||!threadId;
 const item={id,engine:String(row.ENGINE),lockId:String(row.ENGINE_LOCK_ID),transactionId:String(row.ENGINE_TRANSACTION_ID??''),threadId,schema:text(row.OBJECT_SCHEMA),table:text(row.OBJECT_NAME),index:text(row.INDEX_NAME),partition:text(row.PARTITION_NAME),type:String(row.LOCK_TYPE),mode:String(row.LOCK_MODE),status:String(row.LOCK_STATUS),blockers,waiters,session,protected:protectedLock,canKill:!protectedLock&&session.canKill,canCancel:!protectedLock&&row.LOCK_STATUS==='WAITING'&&session.canCancel};
 const fingerprint=hash([info.context.server,item.engine,item.lockId,item.transactionId,item.threadId,item.schema,item.table,item.index,item.partition,item.type,item.mode,item.status,blockers,waiters,session?.fingerprint]);
 const complete={...item,fingerprint};bytes+=Buffer.byteLength(JSON.stringify(complete));if(bytes>8*1024*1024)fail('too_many');return complete;
 });
 return {locks:rows,fetchedAt:new Date().toISOString(),context:{server:info.context.server,readonly:Boolean(client.readonly),consistent,protectionReady:info.context.protectionReady,canManage:consistent&&info.context.canManage}};
}
async function list(client){try{return {success:true,snapshot:await snapshot(client)};}catch(error){return {success:false,error:safe(error)};}}
async function resolve(client,input){target(input);const info=await snapshot(client),row=info.locks.find(row=>row.id===input.id);if(!row||row.fingerprint!==input.fingerprint)fail('changed');return row;}
async function get(client,input){try{
 const row=await resolve(client,input);if(!row.session)fail('identity');const result=await sessions.get(client,{id:row.session.id,fingerprint:row.session.fingerprint});if(!result.success)return result;
 await resolve(client,input);return {success:true,detail:{lockId:row.id,fingerprint:row.fingerprint,session:result.detail}};
 }catch(error){return {success:false,error:safe(error)};}}
async function review(client,input){try{
 if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['id','fingerprint','action','execution'].includes(key))||!['cancel','kill'].includes(input.action))fail('invalid');
 const row=await resolve(client,{id:input.id,fingerprint:input.fingerprint});if(!row.session||!(input.action==='cancel'?row.canCancel:row.canKill))fail('protected');
 if(input.action==='cancel'&&input.execution!==row.session.execution)fail('sql_changed');
 const prepared=await sessions.review(client,{id:row.session.id,fingerprint:row.session.fingerprint,action:input.action,...(input.action==='cancel'?{execution:row.session.execution}:{})});if(!prepared.success)return prepared;
 const token=randomUUID(),expires=Date.now()+60000;let cache=reviews.get(client);if(!cache){cache=new Map();reviews.set(client,cache);}for(const [key,value] of cache)if(value.expires<Date.now())cache.delete(key);if(cache.size>=32)fail('too_many');
 cache.set(token,{target:{id:row.id,fingerprint:row.fingerprint},action:input.action,sessionToken:prepared.review.token,expires,control:client.control.threadId,confirm:row.session.connectionId});
 return {success:true,review:{token,sql:prepared.review.sql,target:row,action:input.action,expiresAt:new Date(expires).toISOString()}};
 }catch(error){return {success:false,error:safe(error)};}}
async function execute(client,input){
 if(acting.has(client))return {success:false,error:'mysql_session_busy',submitted:false,status:'failed'};acting.add(client);let delegated=false;
 try{
 if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['token','confirm','acknowledged'].includes(key)))fail('invalid');
 const cache=reviews.get(client),saved=cache?.get(input.token);cache?.delete(input.token);
 if(!saved||saved.expires<Date.now()||saved.control!==client.control?.threadId||input.confirm!==saved.confirm||input.acknowledged!==true)fail('review');
 const row=await resolve(client,saved.target);if(!(saved.action==='cancel'?row.canCancel:row.canKill))fail('protected');
 delegated=true;return await sessions.execute(client,{token:saved.sessionToken,confirm:input.confirm,acknowledged:true});
 }catch(error){return {success:false,error:delegated?'mysql_session_unknown':safe(error),submitted:delegated,status:delegated?'unknown':'failed'};}
 finally{acting.delete(client);}
}
module.exports={list,get,review,execute};
