// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {randomUUID,createHash}=require('node:crypto');
const {quoteTriggerIdentifier:q}=require('./triggerDefinition');
const tickets=new WeakMap();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function writable(client){if(!client.main||client.closing||client.readonly||client.getMainTransactionState()!==false)throw new Error('Database changes require a writable idle connection without pending changes.');}
function target(input){if(!input||!['create','alter'].includes(input.action)||typeof input.name!=='string'||!input.name||input.name.length>64||/[.\s/\\\0]/.test(input.name)||/^(mysql|sys|information_schema|performance_schema)$/i.test(input.name)||!['charset','collation'].every(key=>typeof input[key]==='string'&&/^[A-Za-z0-9_]{1,64}$/.test(input[key])))throw new Error('Invalid or protected MySQL database settings.');return {action:input.action,name:input.name,charset:input.charset,collation:input.collation};}
async function rows(client,sql,values={}){return (await client.execute(sql,values,null,false,true)).rows;}
async function current(client,name){const values=await rows(client,'SELECT SCHEMA_NAME,DEFAULT_CHARACTER_SET_NAME,DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name',{name});return values.map(r=>({name:r.SCHEMA_NAME,charset:r.DEFAULT_CHARACTER_SET_NAME,collation:r.DEFAULT_COLLATION_NAME}));}
async function options(client){const result=await rows(client,'SELECT CHARACTER_SET_NAME,COLLATION_NAME,IS_DEFAULT FROM information_schema.COLLATIONS ORDER BY CHARACTER_SET_NAME,COLLATION_NAME');if(!result.length||result.length>2000)throw new Error('Database charset options are unavailable.');return {options:result.map(r=>({charset:String(r.CHARACTER_SET_NAME),collation:String(r.COLLATION_NAME),isDefault:r.IS_DEFAULT==='Yes'}))};}
async function validate(client,input){
 const draft=target(input),existing=await current(client,draft.name);
 if(draft.action==='create'?existing.length!==0:existing.length!==1||existing[0].name!==draft.name)throw new Error('The database changed or is unavailable. Refresh and review again.');
 const valid=await rows(client,'SELECT COLLATION_NAME FROM information_schema.COLLATIONS WHERE CHARACTER_SET_NAME=:charset AND COLLATION_NAME=:collation',draft);if(valid.length!==1)throw new Error('The collation does not belong to the selected character set.');
 return {draft,expected:digest(existing),sql:`${draft.action==='create'?'CREATE':'ALTER'} DATABASE ${q(draft.name)} DEFAULT CHARACTER SET ${draft.charset} COLLATE ${draft.collation}`};
}
async function review(client,input){writable(client);const entry=await validate(client,input),token=randomUUID(),map=tickets.get(client)||new Map();tickets.set(client,map);map.set(token,{...entry,at:Date.now()});while(map.size>16)map.delete(map.keys().next().value);return {token,sql:entry.sql};}
async function execute(client,input){
 return client.enqueue(async()=>{
  writable(client);const map=tickets.get(client),entry=map?.get(input?.token);if(!entry||Date.now()-entry.at>60000)throw new Error('Database review expired. Review again.');map.delete(input.token);
  const fresh=await validate(client,entry.draft);if(fresh.expected!==entry.expected)throw new Error('Database settings changed after review. Review again.');let acknowledged=false;
  try{await client.run(client.main,{sql:entry.sql});acknowledged=true;const database=(await current(client,entry.draft.name))[0];if(!database||database.charset!==entry.draft.charset||database.collation!==entry.draft.collation)throw new Error('Database settings could not be confirmed.');return {success:true,applied:true,outcome:'applied',database};}
  catch(error){
   if(acknowledged)return {success:false,applied:true,outcome:'applied',error:'The database change was applied but refresh failed. Refresh manually; do not repeat.'};
   const code=error.code||/^([A-Z0-9_]+):/.exec(error.message||'')?.[1];
   if(['ER_DB_CREATE_EXISTS','ER_DBACCESS_DENIED_ERROR','ER_ACCESS_DENIED_ERROR','ER_SPECIFIC_ACCESS_DENIED_ERROR'].includes(code))return {success:false,applied:false,outcome:'unchanged',error:'The database change was refused ('+code+'). Review privileges and current settings.'};
   client.monitor.invalidate();client.main.destroy();return {success:false,applied:false,outcome:'unknown',error:'The database change result is unknown. Reconnect and inspect it; do not repeat automatically.'};
  }
 });
}
module.exports={options,review,execute};
