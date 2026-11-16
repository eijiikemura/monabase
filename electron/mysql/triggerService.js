// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const mysql=require('mysql2');const {createHash,randomUUID}=require('node:crypto');
const {quoteTriggerIdentifier:q,buildTrigger}=require('./triggerDefinition');
const backups=new WeakMap();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function peers(client,schema,table,timing,event){return (await client.execute(`SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE CAST(TRIGGER_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(EVENT_OBJECT_TABLE AS BINARY)=CAST(:table AS BINARY) AND ACTION_TIMING=:timing AND EVENT_MANIPULATION=:event ORDER BY ACTION_ORDER`,{schema,table,timing,event},null,false,true)).rows.map(row=>String(row.TRIGGER_NAME));}
async function getTrigger(client,{schema,name}){
  q(schema);q(name);
  const rows=(await client.execute(`SELECT TRIGGER_NAME,EVENT_OBJECT_SCHEMA,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION,ACTION_ORDER,ACTION_STATEMENT,SQL_MODE,DEFINER,CHARACTER_SET_CLIENT,COLLATION_CONNECTION,DATABASE_COLLATION,CREATED FROM information_schema.TRIGGERS WHERE CAST(TRIGGER_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TRIGGER_NAME AS BINARY)=CAST(:name AS BINARY)`,{schema,name},null,false,true)).rows;
  if(rows.length!==1)throw new Error('The exact MySQL trigger is unavailable. Check TRIGGER privileges.');
  const row=rows[0],sourceRow=(await client.execute(`SHOW CREATE TRIGGER ${q(schema)}.${q(name)}`,{},null,false,true)).rows[0];
  const source=sourceRow?.['SQL Original Statement'];
  if(typeof source!=='string'||!source.trim())throw new Error('MySQL returned no trigger source.');
  const names=await peers(client,schema,row.EVENT_OBJECT_TABLE,row.ACTION_TIMING,row.EVENT_MANIPULATION);
  const result={schema,name,table:String(row.EVENT_OBJECT_TABLE),timing:String(row.ACTION_TIMING),event:String(row.EVENT_MANIPULATION),body:String(row.ACTION_STATEMENT),native:[...['sql_mode','character_set_client','collation_connection','Database Collation'].filter(key=>typeof sourceRow[key]==='string').map(key=>`-- MySQL ${key}: ${JSON.stringify(sourceRow[key])}`),source].join('\n'),mode:String(row.SQL_MODE),definer:String(row.DEFINER),charset:String(row.CHARACTER_SET_CLIENT),collation:String(row.COLLATION_CONNECTION),databaseCollation:String(row.DATABASE_COLLATION),created:row.CREATED,order:Number(row.ACTION_ORDER),peers:names};
  return {...result,fingerprint:digest([source,row.SQL_MODE,row.CHARACTER_SET_CLIENT,row.COLLATION_CONNECTION,row.CREATED,names])};
}
function account(value){const at=value.lastIndexOf('@');if(at<1)throw new Error('MySQL trigger definer is unavailable.');return mysql.escape(value.slice(0,at))+'@'+mysql.escape(value.slice(at+1));}
function orderClause(current){const i=current.peers.indexOf(current.name);return i>=0&&i+1<current.peers.length?'PRECEDES '+q(current.peers[i+1]):i>0?'FOLLOWS '+q(current.peers[i-1]):'';}
async function assertTable(client,schema,table){const rows=(await client.execute('SELECT TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:table AS BINARY)',{schema,table},null,false,true)).rows;if(rows.length!==1||rows[0].TABLE_TYPE!=='BASE TABLE'||String(rows[0].ENGINE).toLowerCase()!=='innodb')throw new Error('MySQL triggers require an accessible InnoDB table.');}
async function mutateTrigger(client,request,{alreadyQueued=false}={}){
  if(!request||!['create','replace','drop','restore'].includes(request.operation))throw new Error('Invalid MySQL trigger operation.');
  q(request.schema);q(request.name);
  const enqueue=alreadyQueued?fn=>fn():fn=>client.enqueue(fn);
  return enqueue(async()=>{
    if(client.readonly||client.closing||!client.main||client.getTransactionDetails().transactionStatus==='unknown')throw new Error('MySQL trigger changes require a writable connection with known transaction state.');
    let original,stage='unchanged',recovery,changed=false,restoreSettings=false,outcome,recoverySql,lastSql;
    const entries=backups.get(client)||new Map();backups.set(client,entries);
    try{
      if(['replace','drop'].includes(request.operation)){
        original=await getTrigger(client,request);
        if(!request.fingerprint||request.fingerprint!==original.fingerprint)throw new Error('The trigger or its execution order changed. Reload and review it again.');
      }
      if(request.operation==='restore'){
        recovery=entries.get(request.recoveryToken);
        if(!recovery||Date.now()-recovery.time>15*60*1000||recovery.original.schema!==request.schema||recovery.original.name!==request.name)throw new Error('Trigger recovery expired. Use the saved original definition for manual recovery.');
        original=recovery.original;
        const names=await peers(client,original.schema,original.table,original.timing,original.event);
        if(digest(names)!==digest(original.peers.filter(name=>name!==original.name)))throw new Error('Trigger order changed after the failed replacement. Review recovery manually.');
      }
      if(original&&request.operation!=='drop'&&/\b(ANSI_QUOTES|NO_BACKSLASH_ESCAPES)\b/.test(original.mode))throw new Error('Editing triggers created with ANSI_QUOTES or NO_BACKSLASH_ESCAPES is not supported.');
      if(original&&request.operation!=='drop'&&!/^utf8(?:mb3|mb4)?$/i.test(original.charset))throw new Error('Editing this trigger character set is not supported.');
      if(original&&request.operation!=='drop'&&request.operation!=='restore'&&request.table!==original.table)throw new Error('The trigger target table cannot be changed.');
      const definition=request.operation==='restore'?original:request;
      if(request.operation!=='drop')await assertTable(client,definition.schema,definition.table);
      const order=original&&definition.timing===original.timing&&definition.event===original.event?orderClause(original):'';
      const sql=request.operation==='drop'?`DROP TRIGGER ${q(request.schema)}.${q(request.name)}`:buildTrigger(definition,original?account(original.definer):'CURRENT_USER',order);
      if(original&&request.operation!=='drop')recoverySql=`-- MySQL sql_mode: ${JSON.stringify(original.mode)}\n-- MySQL character_set_client: ${JSON.stringify(original.charset)}\n-- MySQL collation_connection: ${JSON.stringify(original.collation)}\n`+buildTrigger(original,account(original.definer),orderClause(original));
      if(request.operation==='create'||request.operation==='restore'){
        const exists=(await client.execute('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE CAST(TRIGGER_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TRIGGER_NAME AS BINARY)=CAST(:name AS BINARY)',request,null,false,true)).rows;
        if(exists.length)throw new Error('A trigger with that name already exists.');
      }
      // Preserve creation-time semantics without exposing session changes to another main-session operation.
      await client.run(client.main,{sql:'USE '+q(request.schema)});client.mainSchema=request.schema;
      if(original&&request.operation!=='drop'){
        restoreSettings=true;
        await client.run(client.main,{sql:`SET SESSION sql_mode=${mysql.escape(original.mode)}`});
        await client.run(client.main,{sql:`SET SESSION character_set_client=${mysql.escape(original.charset)}, collation_connection=${mysql.escape(original.collation)}`});
      }
      if(request.operation==='replace'){
        const token=randomUUID();recovery={original,time:Date.now(),token};entries.set(token,recovery);while(entries.size>16)entries.delete(entries.keys().next().value);
        lastSql='drop';await client.run(client.main,{sql:`DROP TRIGGER ${q(original.schema)}.${q(original.name)}`});stage='dropped';changed=true;
      }
      lastSql=request.operation==='drop'?'drop':'create';await client.run(client.main,{sql});lastSql=undefined;changed=true;stage=request.operation==='drop'?'dropped':'applied';
      if(recovery)entries.delete(recovery.token||request.recoveryToken);
      outcome={success:true,applied:true,stage,...(request.operation!=='drop'?{trigger:await getTrigger(client,request)}:{})};
    }catch(error){
      let message=error.message;
      if(lastSql){
        try{
          const found=(await client.execute('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE CAST(TRIGGER_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TRIGGER_NAME AS BINARY)=CAST(:name AS BINARY)',{schema:request.schema,name:request.name},null,false,true)).rows;
          if(lastSql==='drop'){changed=found.length===0;stage=changed?'dropped':'unchanged';}
          else if(!found.length){stage=recovery?'dropped':'unchanged';}
          else {stage='unknown';message='The trigger result could not be confirmed. Reconnect and verify its definition; do not repeat the operation automatically. '+message;}
        }catch{stage='unknown';message='The trigger result could not be confirmed. Reconnect and verify its definition; do not repeat the operation automatically. '+message;}
      }
      outcome={success:false,error:message,applied:changed,stage,...(stage==='dropped'&&recovery?{recovery:{token:recovery.token||request.recoveryToken,sql:recoverySql}}:{})};
    }
    finally{
      if(restoreSettings){try{await client.run(client.main,{sql:`SET SESSION sql_mode=${mysql.escape(client.aiEnvironment.sqlMode)}`});await client.run(client.main,{sql:`SET SESSION character_set_client=${mysql.escape(client.aiEnvironment.characterSet)}, collation_connection=${mysql.escape(client.aiEnvironment.collation)}`});}catch{client.monitor.invalidate();client.main.destroy();outcome={success:false,applied:changed,stage,error:'The trigger operation finished, but session settings could not be restored. Reconnect before continuing.'};}}
    }
    if(stage==='unknown'){client.monitor.invalidate();client.main.destroy();}
    return outcome;
  });
}
module.exports={getTrigger,mutateTrigger};
