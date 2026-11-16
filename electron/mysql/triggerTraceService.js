// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {randomBytes,createHash}=require('node:crypto');
const {getTrigger}=require('./triggerService');
const {quoteTriggerIdentifier:q}=require('./triggerDefinition');
const {buildTraceProgram,scalarType}=require('./traceProgram');
const {describeTraceTables,validateFixtures,createTableSandbox}=require('./traceTables');
const {createTraceDatabase}=require('../services/traceStore');
const {createTraceIdentity}=require('../services/traceFiles');
const DatabaseDefault=createTraceDatabase('mysql');
const hash=value=>createHash('sha256').update(value).digest('hex');
async function getTriggerTraceInputs(client,request){
 const trigger=await getTrigger(client,request),binds={schema:trigger.schema,table:trigger.table};
 const tables=(await client.execute('SELECT ENGINE,TABLE_TYPE FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY :schema AND BINARY TABLE_NAME=BINARY :table',binds,null,false,true)).rows;
 if(tables.length!==1||tables[0].ENGINE!=='InnoDB'||tables[0].TABLE_TYPE!=='BASE TABLE')throw new Error('Trigger tracing requires an accessible InnoDB table.');
 const rows=(await client.execute('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY :schema AND BINARY TABLE_NAME=BINARY :table ORDER BY ORDINAL_POSITION',binds,null,false,true)).rows;
 if(!rows.length||rows.length>64)throw new Error('Trigger tracing supports tables with 1 to 64 columns.');
 const ddl=(await client.execute(`SHOW CREATE TABLE ${q(trigger.schema)}.${q(trigger.table)}`,{},null,false,true)).rows[0]?.['Create Table'];
 if(typeof ddl!=='string'||/\b(?:TABLESPACE|DATA DIRECTORY|INDEX DIRECTORY)\b/i.test(ddl))throw new Error('This table storage definition is not supported for isolated trigger tracing.');
 return {trigger,tableFingerprint:hash(ddl),columns:rows.map(r=>({name:String(r.COLUMN_NAME),type:String(r.COLUMN_TYPE),nullable:r.IS_NULLABLE==='YES',defaultValue:r.COLUMN_DEFAULT,extra:String(r.EXTRA),generated:Boolean(r.GENERATION_EXPRESSION)}))};
}
function validateRows(input,spec){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['oldRow','newRow'].includes(k)))throw new Error('Provide OLD and NEW row objects.');
 const result={};
 for(const name of ['oldRow','newRow']){
  const row=input[name]??{};
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Trigger row inputs must be JSON objects.');
  if((name==='oldRow'&&spec.trigger.event==='INSERT'||name==='newRow'&&spec.trigger.event==='DELETE')&&Object.keys(row).length)throw new Error('This trigger event does not have that OLD/NEW row.');
  const entries=Object.entries(row);
  for(const [key,value] of entries){const column=spec.columns.find(c=>c.name===key);if(!column||column.generated||!scalarType.test(column.type))throw new Error('Unknown, generated or unsupported trigger input column.');if(value!==null&&!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isSafeInteger(value)||typeof value==='string'&&Buffer.byteLength(value)>8192)throw new Error('Trigger inputs must be bounded scalar values; use strings for exact decimals.');}
  result[name]=Object.fromEntries(entries);
 }
 if(spec.trigger.event!=='INSERT'&&!Object.keys(result.oldRow).length)throw new Error('Provide OLD seed values for UPDATE or DELETE.');
 if(spec.trigger.event==='UPDATE'&&!Object.keys(result.newRow).length)throw new Error('Provide at least one NEW value for UPDATE.');
 if(Buffer.byteLength(JSON.stringify(result))>65536)throw new Error('Trigger row inputs exceed 64 KiB.');
 return result;
}
async function executeMysqlTriggerTrace(client,request,{Database=DatabaseDefault}={}){
 if(!request||request.objectType!=='TRIGGER'||request.skipParse)throw new Error('Invalid MySQL trigger trace target.');
 return client.enqueue(async()=>{
  if(client.readonly||client.closing||!client.main||client.getMainTransactionState()!==false)throw new Error('Trigger tracing requires a writable connection without pending changes and with known transaction state.');
  const spec=await getTriggerTraceInputs(client,{schema:request.schema,name:request.objectName}),info=spec.trigger;
  if(request.mysqlFingerprint!==info.fingerprint||request.mysqlTableFingerprint!==spec.tableFingerprint||request.sourceText!==info.body)throw new Error('The trigger or table changed. Reload its saved source and inputs.');
  if(/\b(ANSI_QUOTES|NO_BACKSLASH_ESCAPES)\b/.test(info.mode)||!/^utf8(?:mb3|mb4)?$/i.test(info.charset))throw new Error('This SQL mode or character set is not supported for trigger tracing.');
  const input=validateRows(request.triggerInput,spec),name='mbt_trace_'+randomBytes(12).toString('hex'),table=name+'_t',qualified=q(info.schema)+'.'+q(table);
  const tables=await describeTraceTables(client,{schema:info.schema,source:info.body});if(tables.length&&(!request.mysqlTraceTableFingerprints||Object.keys(request.mysqlTraceTableFingerprints).length!==tables.length||tables.some(t=>!Object.hasOwn(request.mysqlTraceTableFingerprints,t.name)||request.mysqlTraceTableFingerprints[t.name]!==t.fingerprint)))throw new Error('Trace SQL tables changed. Reload their inputs.');
 const fixtures=validateFixtures(request.mysqlTraceFixtures,tables,{targetTable:info.table});
  let worker,tableCreated=false,triggerCreated=false,ddlPending=false,failure,cleanupError,executionError=null,steps=[],outcome=[];
  const query=async(sql,values=[])=>{try{return await worker.promise().query({sql,values,timeout:30000});}catch(error){const code=/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'UNKNOWN';throw Object.assign(new Error('MySQL trigger trace database request failed ('+code+').'),{code});}};
  const insert=async row=>{const entries=Object.entries(row);await query(`INSERT INTO ${qualified} (${entries.map(([key])=>q(key)).join(',')}) VALUES (${entries.map(()=>'?').join(',')})`,entries.map(([,v])=>v));};
  const ensureEmpty=async()=>{const [rows]=await query('SELECT COUNT(*) FROM '+qualified);if(Number(rows[0][0])!==0)throw new Error('Rollback not confirmed.');};
  const fields=spec.columns.filter(c=>!c.generated&&scalarType.test(c.type));
  if(!fields.length)throw new Error('Trigger tracing requires at least one supported scalar table column.');
  const readRow=async()=>{const [rows]=await query('SELECT '+fields.map(c=>'CAST('+q(c.name)+' AS CHAR)').join(',')+' FROM '+qualified);return rows.map(row=>Object.fromEntries(fields.map((c,i)=>[c.name,row[i]])));};
  const sandbox=createTableSandbox(query,info.schema,tables.filter(t=>t.name!==info.table),name);
  const mapped=tables.map(t=>t.name===info.table?{...t,copyName:table}:sandbox.tables.find(copy=>copy.name===t.name));
  const program=buildTraceProgram({...info,kind:'TRIGGER',parameters:[],source:info.body,traceColumns:spec.columns,copyTable:table,traceTables:mapped},name);
  try{
   worker=await client.openTraceConnection();await query('SET SESSION sql_mode = ?',[info.mode]);await query('SET SESSION character_set_client = ?, collation_connection = ?',[info.charset,info.collation]);await query('SET SESSION time_zone = ?',[client.aiEnvironment.timezone]);
   ddlPending=true;await query(`CREATE TABLE ${qualified} LIKE ${q(info.schema)}.${q(info.table)}`);tableCreated=true;ddlPending=false;await sandbox.create();
   ddlPending=true;await query(program.sql);triggerCreated=true;ddlPending=false;
   const current=await getTriggerTraceInputs(client,{schema:info.schema,name:info.name});if(current.tableFingerprint!==spec.tableFingerprint||current.trigger.fingerprint!==info.fingerprint)throw new Error('The trigger or table changed during trace setup.');
   const sqlCurrent=await describeTraceTables(client,{schema:info.schema,source:info.body});if(JSON.stringify(sqlCurrent.map(t=>t.fingerprint))!==JSON.stringify(tables.map(t=>t.fingerprint)))throw new Error('SQL table definitions changed during setup.');
   await query('START TRANSACTION');await sandbox.seed(fixtures);if(info.event!=='INSERT')await insert(input.oldRow);
   await query(`SET ${program.prefix}_data=JSON_ARRAY(),${program.prefix}_count=0,${program.prefix}_limited=0,${program.prefix}_path=''`);
   try{
    if(info.event==='INSERT')await insert(input.newRow);
    else if(info.event==='UPDATE'){const entries=Object.entries(input.newRow);await query(`UPDATE ${qualified} SET ${entries.map(([key])=>q(key)+'=?').join(',')}`,entries.map(([,v])=>v));}
    else await query('DELETE FROM '+qualified);
    outcome=await readRow();
   }catch(error){executionError='Trigger execution stopped ('+(error.code||'UNKNOWN')+'). Later behavior is unknown.';}
   const [rows]=await query(`SELECT ${program.prefix}_data,${program.prefix}_limited`),raw=typeof rows[0][0]==='string'?JSON.parse(rows[0][0]):rows[0][0];
   if(Number(rows[0][1])===1){executionError='Trace stopped at its record or isolated-row limit.';outcome=[];}
   if(!Array.isArray(raw)||raw.length>10000||Buffer.byteLength(JSON.stringify(raw))>2*1024*1024)throw new Error('Invalid or oversized trigger trace records.');
   steps=raw.map(s=>({lineNum:s.line,loopPath:s.loopPath,variables:Object.fromEntries(Object.entries(s.variables).map(([key,value])=>[key,value===null?'[SQL NULL]':/^(?:var)?char\b/i.test(program.types[key]||'')?JSON.stringify(String(value)):String(value)])),logText:s.phase}));
  }catch(error){failure=error;if(ddlPending&&!String(error.code||'').startsWith('ER_'))cleanupError='Trigger trace setup result is unknown: '+info.schema+'.'+table+' / '+name+'. Verify these isolated copy names manually; execution was not repeated.';}finally{
   if(worker){try{await query('ROLLBACK');if(tableCreated)await ensureEmpty();if(triggerCreated){await query(`DROP TRIGGER ${q(info.schema)}.${q(name)}`);triggerCreated=false;}if(tableCreated){await query('DROP TABLE '+qualified);tableCreated=false;}await sandbox.remove();}catch{cleanupError='Trigger trace cleanup could not be confirmed: '+info.schema+'.'+table+' / '+name+' / '+sandbox.names().join(', ')+'. Check these isolated copies manually; execution was not repeated.';}worker.destroy();}
  }
  if(cleanupError)throw new Error(cleanupError);if(failure)throw failure;if(!steps.length)throw new Error('No trigger trace records were produced; the previous recording was preserved.');
  const record={compile_date:new Date().toISOString(),arguments:JSON.stringify(input),executed_source:info.body,source_sha256:hash(info.body),source_kind:'original',line_mapping:'original_source_1_based',source_scope:'trigger_body',original_definition:info.native,variable_types:program.types,execution_status:executionError?'incomplete':'complete',execution_error:executionError,instrumented_copy:name,isolated_table:table,trigger_event:info.event,trigger_timing:info.timing,trigger_table:info.table,trigger_outcome:outcome,table_fixtures:fixtures,sql_tables:tables.map(t=>({name:t.name,columns:t.columns.map(c=>({name:c.name,type:c.type}))})),trace_environment:{session:'isolated InnoDB table copy; DML rolled back',sql_mode:info.mode,time_zone:client.aiEnvironment.timezone,charset:info.charset,collation:info.collation},scope:'Selected trigger only. No existing rows, peer triggers or foreign keys are copied. Not a full integration test.',limits:{maxSteps:program.maxSteps,maxTraceBytes:1048576,maxIsolatedRows:1000,maxFixtureRows:1000,maxTables:8},return_values:[]};
  const db=new Database(createTraceIdentity(client.lastConfig,{schema:info.schema,objectName:info.name,objectType:'TRIGGER'}));try{await db.saveTraceRun(record,steps);}finally{db.close();}
  return {info:record,steps,returnValues:[],traceDate:record.compile_date,dbmsOutput:executionError?[executionError]:[]};
 });
}
module.exports={getTriggerTraceInputs,validateRows,executeMysqlTriggerTrace};
