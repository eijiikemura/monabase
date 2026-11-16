// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const mysql=require('mysql2');
const {createHash,randomUUID}=require('node:crypto');
const {quoteTriggerIdentifier:q}=require('./triggerDefinition');
const {buildProcedure,parseProcedure}=require('./procedureDefinition');
const backups=new WeakMap();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exists=async(client,{schema,name},kind='PROCEDURE')=>(await client.execute(`SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=:schema AND ROUTINE_NAME=:name AND ROUTINE_TYPE='${kind}'`,{schema,name},null,false,true)).rows.length>0;
async function getProcedure(client,{schema,name},kind='PROCEDURE'){
  if(!['PROCEDURE','FUNCTION'].includes(kind))throw new Error('Invalid MySQL routine kind.');
  q(schema);q(name);
  const rows=(await client.execute(`SELECT ROUTINE_NAME,DEFINER,SQL_MODE,SECURITY_TYPE,SQL_DATA_ACCESS,IS_DETERMINISTIC,ROUTINE_COMMENT,CREATED,LAST_ALTERED,DTD_IDENTIFIER FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=:schema AND ROUTINE_NAME=:name AND ROUTINE_TYPE='${kind}'`,{schema,name},null,false,true)).rows;
  if(rows.length!==1)throw new Error('The MySQL procedure is unavailable. Check routine privileges.');
  const row=rows[0],nativeRow=(await client.execute(`SHOW CREATE ${kind} ${q(schema)}.${q(name)}`,{},null,false,true)).rows[0],source=nativeRow?.[kind==='FUNCTION'?'Create Function':'Create Procedure'];
  if(typeof source!=='string'||!source.trim())throw new Error('MySQL returned no procedure source. Check SHOW_ROUTINE privileges.');
  const parameters=(await client.execute(`SELECT PARAMETER_NAME,PARAMETER_MODE,DTD_IDENTIFIER,ORDINAL_POSITION FROM information_schema.PARAMETERS WHERE SPECIFIC_SCHEMA=:schema AND SPECIFIC_NAME=:name AND ROUTINE_TYPE='${kind}' AND ORDINAL_POSITION>0 ORDER BY ORDINAL_POSITION`,{schema,name},null,false,true)).rows.map(p=>({name:String(p.PARAMETER_NAME),direction:String(p.PARAMETER_MODE),type:String(p.DTD_IDENTIFIER),position:Number(p.ORDINAL_POSITION)}));
  return {schema,name,kind,...(kind==='FUNCTION'?{returnType:String(row.DTD_IDENTIFIER)}:{}),source,native:[...['sql_mode','character_set_client','collation_connection','Database Collation'].filter(k=>typeof nativeRow[k]==='string').map(k=>`-- MySQL ${k}: ${JSON.stringify(nativeRow[k])}`),source].join('\n'),parameters,mode:String(row.SQL_MODE),definer:String(row.DEFINER),security:String(row.SECURITY_TYPE),dataAccess:String(row.SQL_DATA_ACCESS),deterministic:row.IS_DETERMINISTIC==='YES',comment:String(row.ROUTINE_COMMENT),created:row.CREATED,altered:row.LAST_ALTERED,charset:String(nativeRow.character_set_client),collation:String(nativeRow.collation_connection),fingerprint:digest([kind,source,row.SQL_MODE,nativeRow.character_set_client,nativeRow.collation_connection,row.CREATED,row.LAST_ALTERED])};
}
function account(value){const at=value.lastIndexOf('@');if(at<1)throw new Error('The procedure definer is unavailable.');return mysql.escape(value.slice(0,at))+'@'+mysql.escape(value.slice(at+1));}
async function mutateProcedure(client,request,kind='PROCEDURE',{alreadyQueued=false}={}){
  if(!['PROCEDURE','FUNCTION'].includes(kind))throw new Error('Invalid MySQL routine kind.');
  if(!request||!['create','replace','drop','restore'].includes(request.operation))throw new Error('Invalid MySQL procedure operation.');q(request.schema);q(request.name);
  const enqueue=alreadyQueued?fn=>fn():fn=>client.enqueue(fn);
  return enqueue(async()=>{
    if(client.readonly||client.closing||!client.main||client.getTransactionDetails().transactionStatus==='unknown')throw new Error('Procedure changes require a writable connection with known transaction state.');
    const entries=backups.get(client)||new Map();backups.set(client,entries);
    let original,recovery,stage='unchanged',applied=false,lastSql,restoreSettings=false,outcome;
    try{
      if(['replace','drop'].includes(request.operation)){
        original=await getProcedure(client,request,kind);
        if(!request.fingerprint||request.fingerprint!==original.fingerprint)throw new Error('The procedure changed. Reload and review it again.');
      }
      if(request.operation==='restore'){
        recovery=entries.get(request.recoveryToken);original=recovery?.original;
        if(!original||Date.now()-recovery.time>900000||original.kind!==kind||original.schema!==request.schema||original.name!==request.name)throw new Error('Procedure recovery expired or does not match the target.');
      }
      if(request.operation!=='drop'&&original&&(/\b(ANSI_QUOTES|NO_BACKSLASH_ESCAPES)\b/.test(original.mode)||!/^utf8(?:mb3|mb4)?$/i.test(original.charset)))throw new Error('Editing this procedure SQL mode or character set is not supported.');
      if(!['drop','restore'].includes(request.operation)){
        const requested=parseProcedure(request.source,request.schema,request.name,kind).definer;
        const originalDefiner=original?parseProcedure(original.source,original.schema,original.name,kind).definer:undefined;
        if(requested&&requested!==originalDefiner&&!/^CURRENT_USER(?:\s*\(\s*\))?$/i.test(requested))throw new Error('Keep the existing DEFINER or omit the clause. Changing procedure ownership is not supported.');
      }
      const sql=request.operation==='drop'?`DROP ${kind} ${q(request.schema)}.${q(request.name)}`:buildProcedure(request.operation==='restore'?original.source:request.source,request.schema,request.name,original?account(original.definer):'CURRENT_USER',kind);
      // Validate the exact recovery definition before removing a working routine.
      if(original&&request.operation!=='drop')buildProcedure(original.source,original.schema,original.name,account(original.definer),kind);
      if(['create','restore'].includes(request.operation)&&await exists(client,request,kind))throw new Error('A procedure with this name already exists.');
      await client.run(client.main,{sql:'USE '+q(request.schema)});client.mainSchema=request.schema;
      if(original&&request.operation!=='drop'){
        restoreSettings=true;await client.run(client.main,{sql:`SET SESSION sql_mode=${mysql.escape(original.mode)}`});await client.run(client.main,{sql:`SET SESSION character_set_client=${mysql.escape(original.charset)}, collation_connection=${mysql.escape(original.collation)}`});
      }
      if(request.operation==='replace'){
        const token=randomUUID();recovery={token,time:Date.now(),original};entries.set(token,recovery);while(entries.size>16)entries.delete(entries.keys().next().value);
        lastSql='drop';await client.run(client.main,{sql:`DROP ${kind} ${q(request.schema)}.${q(request.name)}`});stage='dropped';applied=true;
      }
      lastSql=request.operation==='drop'?'drop':'create';await client.run(client.main,{sql});lastSql=undefined;applied=true;stage=request.operation==='drop'?'dropped':'applied';
      if(recovery)entries.delete(recovery.token);
      outcome={success:true,applied,stage,...(request.operation==='drop'?{}:{procedure:await getProcedure(client,request,kind)})};
    }catch(error){
      if(lastSql){try{const found=await exists(client,request,kind);if(lastSql==='drop'){applied=!found;stage=found?'unchanged':'dropped';}else stage=found?'unknown':recovery?'dropped':'unchanged';}catch{stage='unknown';}}
      outcome={success:false,error:error.message,applied,stage,...(stage==='dropped'&&recovery?{recovery:{token:recovery.token,sql:recovery.original.native}}:{})};
    }finally{
      if(restoreSettings){try{await client.run(client.main,{sql:`SET SESSION sql_mode=${mysql.escape(client.aiEnvironment.sqlMode)}`});await client.run(client.main,{sql:`SET SESSION character_set_client=${mysql.escape(client.aiEnvironment.characterSet)}, collation_connection=${mysql.escape(client.aiEnvironment.collation)}`});}catch{stage='unknown';outcome={success:false,applied,stage,error:'Session settings could not be restored. Reconnect before continuing.'};}}
    }
    if(stage==='unknown'){client.monitor.invalidate();client.main.destroy();outcome.error='The result could not be confirmed. Reconnect and verify the routine; do not repeat automatically. '+outcome.error;}
    return outcome;
  });
}
async function executeStored(client,request){
  if(!request||!['PROCEDURE','FUNCTION'].includes(request.objectType))throw new Error('Select a MySQL stored routine.');
  const kind=request.objectType;q(request.schema);q(request.objectName);
  return client.enqueue(async()=>{
    if(client.readonly||client.closing||!client.main||client.getTransactionDetails().transactionStatus==='unknown')throw new Error('Procedure execution requires a writable connection with known transaction state.');
    const info=await getProcedure(client,{schema:request.schema,name:request.objectName},kind);
    if(!request.mysqlFingerprint||info.fingerprint!==request.mysqlFingerprint)throw new Error('The procedure changed. Reload its definition and arguments before execution.');
    if(kind==='FUNCTION'&&info.parameters.some(p=>p.direction!=='IN'))throw new Error('MySQL function parameters must be IN parameters.');
    if(info.parameters.length>1024)throw new Error('Too many procedure arguments.');
    const prefix='@mbp_'+randomUUID().replaceAll('-',''),variables=[],args=[];let cleanupNeeded=false;
    for(const p of info.parameters){
      const value=request.args?.[p.name];if(value!==undefined&&value!==null&&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')throw new Error('Procedure inputs must be scalar values.');
      if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Procedure numeric inputs must be finite.');
      if(typeof value==='string'&&Buffer.byteLength(value)>1024*1024)throw new Error('A procedure argument exceeds 1 MiB.');
      const literal=mysql.escape(value===undefined||value===''?null:value);
      if(p.direction==='IN')args.push(literal);else {const variable=prefix+'_'+p.position;variables.push({variable,name:p.name,literal:p.direction==='OUT'?'NULL':literal});args.push(variable);}
    }
    if(Buffer.byteLength(args.join(','))+Buffer.byteLength(variables.map(v=>v.literal).join(','))>1024*1024)throw new Error('Procedure inputs exceed 1 MiB.');
    let result,error;
    try{
      await client.run(client.main,{sql:'USE '+q(request.schema)});client.mainSchema=request.schema;
      if(variables.length){cleanupNeeded=true;await client.run(client.main,{sql:'SET '+variables.map(v=>`${v.variable}=${v.literal}`).join(',')});}
      const callResult=await client.run(client.main,{sql:kind==='FUNCTION'?`SELECT ${q(request.schema)}.${q(request.objectName)}(${args.join(',')}) AS RETURN_VALUE`:`CALL ${q(request.schema)}.${q(request.objectName)}(${args.join(',')})`,collectResults:kind==='PROCEDURE'});
      const values=variables.length?(await client.run(client.main,{sql:'SELECT '+variables.map(v=>`${v.variable} AS ${q(v.name)}`).join(',')})).rows[0]:{};
      result={returnValues:kind==='FUNCTION'?[{name:'RETURN_VALUE',value:callResult.rows[0]?.RETURN_VALUE}]:variables.map(v=>({name:v.name,value:values[v.name]})),resultSets:kind==='FUNCTION'?[]:callResult.resultSets||[],dbmsOutput:callResult.notices};
      if(Buffer.byteLength(JSON.stringify(result))>16*1024*1024)throw new Error('MySQL procedure results and OUT arguments exceed 16 MiB. Reduce the procedure output.');
    }catch(failure){error=failure;}finally{
      if(cleanupNeeded){try{await client.run(client.main,{sql:'SET '+variables.map(v=>`${v.variable}=NULL`).join(',')});}catch{client.monitor.invalidate();client.main.destroy();error=new Error('Procedure output cleanup failed. Reconnect and verify transaction state; do not repeat the call automatically.');}}
    }
    // Existing routines may change session settings even when their CALL fails.
    // Never continue escaped SQL under an unexpected SQL mode or autocommit setting.
    try{
      const row=(await client.run(client.main,{sql:'SELECT @@session.sql_mode AS mode, @@character_set_connection AS charset, @@collation_connection AS collation, @@session.autocommit AS autocommit, @@session.time_zone AS timezone'})).rows[0];
      if(row.mode!==client.aiEnvironment.sqlMode||row.charset!==client.aiEnvironment.characterSet||row.collation!==client.aiEnvironment.collation||Number(row.autocommit)!==0||row.timezone!==client.aiEnvironment.timezone)throw new Error('The procedure changed protected session settings. Reconnect before continuing; the call is not repeated.');
    }catch(failure){client.monitor.invalidate();client.main.destroy();error=failure;}
    if(error)throw error;return result;
  });
}
module.exports={getProcedure,mutateProcedure,executeStored};
