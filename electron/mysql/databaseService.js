// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const fail=code=>{const error=new Error('mysql_database_'+code);error.safe=true;throw error;};
const exact=value=>{if(value==null)return null;const text=String(value);if(!/^\d+$/.test(text)||typeof value==='number'&&!Number.isSafeInteger(value))fail('read_failed');return text;};
async function read(client,sql,binds={}){
 if(!client.main||client.closing)fail('unavailable');const {rows}=await client.execute(sql,binds,null,false,true);
 if(!Array.isArray(rows))fail('read_failed');if(rows.length>5000||Buffer.byteLength(JSON.stringify(rows))>8*1024*1024)fail('too_many');return rows;
}
const errorResult=error=>({success:false,error:error.safe?error.message:/ER_(?:SPECIFIC_ACCESS_DENIED_ERROR|DBACCESS_DENIED_ERROR|TABLEACCESS_DENIED_ERROR)/.test(String(error.code||error.message))?'mysql_database_denied':'mysql_database_read_failed'});
async function schemas(client,name){return (await read(client,'SELECT SCHEMA_NAME,DEFAULT_CHARACTER_SET_NAME,DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA'+(name===undefined?'':' WHERE SCHEMA_NAME = :name')+' ORDER BY SCHEMA_NAME LIMIT 5001',name===undefined?{}:{name})).map(row=>({id:String(row.SCHEMA_NAME),name:String(row.SCHEMA_NAME),charset:String(row.DEFAULT_CHARACTER_SET_NAME),collation:String(row.DEFAULT_COLLATION_NAME)}));}
async function list(client){try{return {success:true,snapshot:{databases:await schemas(client),scope:'visible',fetchedAt:new Date().toISOString()}};}catch(error){return errorResult(error);}}
async function get(client,input){try{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='name')||typeof input.name!=='string'||!input.name||input.name.length>64)fail('invalid');
 const database=(await schemas(client,input.name)).find(row=>row.name===input.name);if(!database)fail('changed');
 const tables=await read(client,'SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_ROWS,DATA_LENGTH,INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = :name ORDER BY TABLE_NAME LIMIT 5001',{name:input.name});
 const routines=await read(client,'SELECT ROUTINE_NAME,ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = :name ORDER BY ROUTINE_TYPE,ROUTINE_NAME LIMIT 5001',{name:input.name});
 const triggers=await read(client,'SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = :name ORDER BY TRIGGER_NAME LIMIT 5001',{name:input.name});
 const objects=[...tables.map(row=>({id:JSON.stringify([row.TABLE_TYPE,row.TABLE_NAME]),name:String(row.TABLE_NAME),type:row.TABLE_TYPE==='VIEW'?'VIEW':'TABLE',engine:row.ENGINE==null?null:String(row.ENGINE),rows:exact(row.TABLE_ROWS),dataBytes:exact(row.DATA_LENGTH),indexBytes:exact(row.INDEX_LENGTH),parent:null})),...routines.map(row=>({id:JSON.stringify([row.ROUTINE_TYPE,row.ROUTINE_NAME]),name:String(row.ROUTINE_NAME),type:String(row.ROUTINE_TYPE),engine:null,rows:null,dataBytes:null,indexBytes:null,parent:null})),...triggers.map(row=>({id:JSON.stringify(['TRIGGER',row.TRIGGER_NAME]),name:String(row.TRIGGER_NAME),type:'TRIGGER',engine:null,rows:null,dataBytes:null,indexBytes:null,parent:String(row.EVENT_OBJECT_TABLE)}))];
 if(objects.length>5000||Buffer.byteLength(JSON.stringify(objects))>8*1024*1024)fail('too_many');
 return {success:true,detail:{database,objects,scope:'visible',fetchedAt:new Date().toISOString()}};
 }catch(error){return errorResult(error);}}
module.exports={list,get};
