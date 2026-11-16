// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const fail=code=>{const error=new Error('mysql_storage_'+code);error.safe=true;throw error;};
const text=value=>value==null?null:String(value);
const integer=value=>{if(value==null)return null;const result=String(value);if(!/^\d+$/.test(result)||typeof value==='number'&&!Number.isSafeInteger(value))fail('invalid_catalog');return result;};
function safe(error){if(error.safe)return error.message;return /ER_(?:SPECIFIC_ACCESS_DENIED_ERROR|TABLEACCESS_DENIED_ERROR|DBACCESS_DENIED_ERROR)/.test(String(error.code||error.message))?'mysql_storage_privilege_required':'mysql_storage_read_failed';}
async function read(client,sql,binds={}){
 if(!client.main||client.closing)fail('unavailable');
 const result=await client.execute(sql,binds,null,false,true);
 if(!Array.isArray(result.rows))fail('read_failed');
 if(result.rows.length>5000||Buffer.byteLength(JSON.stringify(result.rows))>8*1024*1024)fail('too_many');
 return result.rows;
}
async function snapshot(client,space){
 const where=space===undefined?'':' WHERE SPACE = :space';
 const metadata=await read(client,'SELECT SPACE,NAME,SPACE_TYPE,ROW_FORMAT,PAGE_SIZE,FS_BLOCK_SIZE,FILE_SIZE,ALLOCATED_SIZE,ENCRYPTION,STATE FROM information_schema.INNODB_TABLESPACES'+where+' ORDER BY SPACE LIMIT 5001',space===undefined?{}:{space});
 const files=await read(client,"SELECT FILE_ID,FILE_NAME,TABLESPACE_NAME,STATUS FROM information_schema.FILES WHERE ENGINE IN ('InnoDB') AND FILE_TYPE = 'TABLESPACE'"+(space===undefined?'':' AND FILE_ID = :space')+' ORDER BY FILE_ID,FILE_NAME LIMIT 5001',space===undefined?{}:{space});
 const rows=new Map();
 for(const item of metadata){const id=integer(item.SPACE);if(id===null||rows.has(id)||!item.NAME)fail('invalid_catalog');rows.set(id,{id,name:String(item.NAME),type:text(item.SPACE_TYPE),rowFormat:text(item.ROW_FORMAT),pageSize:integer(item.PAGE_SIZE),blockSize:integer(item.FS_BLOCK_SIZE),fileSize:integer(item.FILE_SIZE),allocatedSize:integer(item.ALLOCATED_SIZE),encryption:text(item.ENCRYPTION),state:text(item.STATE),files:[]});}
 for(const file of files){const id=integer(file.FILE_ID);if(id===null||!file.TABLESPACE_NAME)fail('invalid_catalog');let row=rows.get(id);
 if(!row){row={id,name:String(file.TABLESPACE_NAME),type:null,rowFormat:null,pageSize:null,blockSize:null,fileSize:null,allocatedSize:null,encryption:null,state:null,files:[]};rows.set(id,row);}
 // FILES names may differ from InnoDB's display name. SPACE/FILE_ID is the native join key.
 row.files.push({id:JSON.stringify([id,file.FILE_NAME]),path:text(file.FILE_NAME),status:text(file.STATUS)});
 }
 const tablespaces=[...rows.values()];if(tablespaces.length>5000||Buffer.byteLength(JSON.stringify(tablespaces))>8*1024*1024)fail('too_many');
 return {tablespaces,fetchedAt:new Date().toISOString()};
}
async function list(client){try{return {success:true,snapshot:await snapshot(client)};}catch(error){return {success:false,error:safe(error)};}}
async function get(client,input){try{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['id','name'].includes(key))||typeof input.id!=='string'||!/^\d{1,20}$/.test(input.id)||typeof input.name!=='string'||!input.name||input.name.length>1024)fail('invalid');
 const info=await snapshot(client,input.id),row=info.tablespaces.find(row=>row.id===input.id&&row.name===input.name);if(!row)fail('changed');
 const tables=await read(client,'SELECT TABLE_ID,NAME,SPACE,ROW_FORMAT,N_COLS FROM information_schema.INNODB_TABLES WHERE SPACE = :space ORDER BY TABLE_ID LIMIT 5001',{space:input.id});
 const items=tables.map(table=>{const id=integer(table.TABLE_ID);if(id===null||integer(table.SPACE)!==row.id)fail('changed');return {id,name:String(table.NAME),rowFormat:text(table.ROW_FORMAT),columns:integer(table.N_COLS)};});
 return {success:true,detail:{tablespace:row,tables:items,fetchedAt:new Date().toISOString()}};
 }catch(error){return {success:false,error:safe(error)};}}
module.exports={list,get};
