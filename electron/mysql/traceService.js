// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {randomBytes,createHash}=require('node:crypto'),mysql=require('mysql2');
const {getProcedure}=require('./procedureService'),{buildTraceProgram}=require('./traceProgram');
const {describeTraceTables,validateFixtures,createTableSandbox}=require('./traceTables');
const {createTraceDatabase}=require('../services/traceStore');
const {createTraceIdentity}=require('../services/traceFiles');
const q=v=>'`'+v.replaceAll('`','``')+'`';
const TraceDatabase=createTraceDatabase('mysql');
async function executeMysqlTrace(client,request,{Database=TraceDatabase}={}){
 if(request?.objectType==='TRIGGER')return require('./triggerTraceService').executeMysqlTriggerTrace(client,request,{Database});
 if(!request||!['FUNCTION','PROCEDURE'].includes(request.objectType)||typeof request.schema!=='string'||typeof request.objectName!=='string'||request.skipParse)throw new Error('Invalid MySQL trace target.');
 return client.enqueue(async()=>{
  if(client.readonly||client.closing||!client.main)throw new Error('MySQL trace requires a writable connection.');
  if(client.getMainTransactionState()!==false)throw new Error('Finish pending changes and ensure a known transaction state before MySQL trace analysis.');
  const info=await getProcedure(client,{schema:request.schema,name:request.objectName},request.objectType);
  if(request.mysqlFingerprint!==info.fingerprint||request.sourceText!==info.source)throw new Error('The MySQL routine changed. Reload and trace its saved source.');
  if(/\b(ANSI_QUOTES|NO_BACKSLASH_ESCAPES)\b/.test(info.mode)||!/^utf8(?:mb3|mb4)?$/i.test(info.charset))throw new Error('This routine SQL mode or character set is not supported for MySQL tracing.');
  const name='mbt_trace_'+randomBytes(12).toString('hex'),tables=await describeTraceTables(client,info),fixtures=validateFixtures(request.mysqlTraceFixtures,tables),args=[],outputs=[];
  if(tables.length&&(!request.mysqlTraceTableFingerprints||Object.keys(request.mysqlTraceTableFingerprints).length!==tables.length||tables.some(t=>!Object.hasOwn(request.mysqlTraceTableFingerprints,t.name)||request.mysqlTraceTableFingerprints[t.name]!==t.fingerprint)))throw new Error('Trace tables changed. Reload the isolated table inputs.');
  const values={};for(const p of info.parameters){const value=request.args?.[p.name];if(value!=null&&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean'||typeof value==='number'&&!Number.isSafeInteger(value)||typeof value==='string'&&Buffer.byteLength(value)>8192)throw new Error('MySQL trace arguments must be bounded scalar values. Use text for exact decimals.');values[p.name]=value===undefined||value===''?null:value;}
  if(Buffer.byteLength(JSON.stringify(values))>65536)throw new Error('MySQL trace arguments exceed 64 KiB.');
  let worker,created=false,steps=[],result=[],executionError=null,cleanupError=null,failure=null;
  const query=async(sql,params=[])=>{try{return await worker.promise().query({sql,values:params,timeout:30000});}catch(error){const code=/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'UNKNOWN';throw Object.assign(new Error('MySQL trace database request failed ('+code+').'),{code});}};
  const sandbox=createTableSandbox(query,info.schema,tables,name),program=buildTraceProgram({...info,traceTables:sandbox.tables},name);
  try{
   worker=await client.openTraceConnection();
   await query('SET SESSION sql_mode = ?',[info.mode]);await query('SET SESSION character_set_client = ?, collation_connection = ?',[info.charset,info.collation]);await query('SET SESSION time_zone = ?',[client.aiEnvironment.timezone]);
   await sandbox.create();
   const current=await describeTraceTables(client,info);if(JSON.stringify(current.map(t=>t.fingerprint))!==JSON.stringify(tables.map(t=>t.fingerprint)))throw new Error('Trace table definitions changed during setup.');
   await query(program.sql);created=true;
   await query(`SET ${program.prefix}_data=JSON_ARRAY(),${program.prefix}_count=0,${program.prefix}_limited=0,${program.prefix}_path=''`);
   for(const p of info.parameters){if(p.direction==='IN')args.push(mysql.escape(values[p.name]));else{const variable=program.prefix+'_p'+p.position;await query('SET '+variable+' = ?',[p.direction==='OUT'?null:values[p.name]]);args.push(variable);outputs.push({name:p.name,variable});}}
   // Only validated SQL on isolated copies may write; the original tables are never queried.
   await query(program.hasSql?'START TRANSACTION':'START TRANSACTION READ ONLY');await sandbox.seed(fixtures);
   try{const [rows]=await query(info.kind==='FUNCTION'?`SELECT ${q(info.schema)}.${q(name)}(${args.join(',')})`:`CALL ${q(info.schema)}.${q(name)}(${args.join(',')})`);if(info.kind==='FUNCTION')result=[{name:'RETURN_VALUE',value:rows[0][0]}];
    else if(outputs.length){const [out]=await query('SELECT '+outputs.map(o=>o.variable).join(','));result=outputs.map((o,i)=>({name:o.name,value:out[0][i]}));}
   }catch(error){executionError='The traced program raised a database error ('+(error.code||'UNKNOWN')+').';}
   const [rows]=await query(`SELECT ${program.prefix}_data,${program.prefix}_limited`),raw=typeof rows[0][0]==='string'?JSON.parse(rows[0][0]):rows[0][0];
   if(Number(rows[0][1])===1){executionError='Trace stopped at its record or isolated-row limit.';result=[];}
   if(!Array.isArray(raw)||raw.length>10000||Buffer.byteLength(JSON.stringify(raw))>2*1024*1024)throw new Error('Invalid or oversized MySQL trace records.');
   steps=raw.map(s=>({lineNum:s.line,loopPath:s.loopPath,variables:Object.fromEntries(Object.entries(s.variables).map(([key,value])=>[key,value===null?'[SQL NULL]':/^(?:var)?char\b/i.test(program.types[key]||'')?JSON.stringify(String(value)):String(value)])),logText:s.phase}));
  }catch(error){failure=error;}finally{
   if(worker){try{await query('ROLLBACK');if(created){await query(`DROP ${info.kind} ${q(info.schema)}.${q(name)}`);created=false;}await sandbox.remove();}catch{cleanupError='Trace copy cleanup could not be confirmed: '+info.schema+'.'+name+' / '+sandbox.names().join(', ')+'. Verify it manually; the trace was not repeated.';}worker.destroy();}
  }
  if(cleanupError)throw new Error(cleanupError);
  if(failure)throw failure;
  if(!steps.length)throw new Error('No MySQL trace records were produced.');
  const infoRecord={trace_environment:{sql_mode:info.mode,time_zone:client.aiEnvironment.timezone,charset:info.charset,collation:info.collation,session:program.hasSql?'isolated test-table worker; DML rolled back':'isolated read-only worker',security:'INVOKER'},instrumented_copy:name,compile_date:new Date().toISOString(),arguments:JSON.stringify(values),table_fixtures:fixtures,isolated_tables:tables.map(t=>({name:t.name,columns:t.columns.map(c=>({name:c.name,type:c.type}))})),sql_scope:program.hasSql?'Only user-provided rows in empty InnoDB copies; no existing data, peer triggers, foreign keys or other routine calls.':'Scalar only',target_compile_date:info.altered,executed_source:info.source,source_sha256:createHash('sha256').update(info.source).digest('hex'),source_kind:'original',line_mapping:'original_source_1_based',variable_types:program.types,snapshot_timing:'log_text states before/after/condition/branch-entry/loop-entry/return; [SQL NULL] denotes SQL NULL',execution_status:executionError?'incomplete':'complete',execution_error:executionError,return_values:result,limits:{maxSteps:program.maxSteps,maxTraceBytes:1048576,maxIsolatedRows:1000,maxFixtureRows:1000,maxTables:8}};
  const db=new Database(createTraceIdentity(client.lastConfig,{schema:info.schema,objectName:info.name,objectType:info.kind}));
  try{await db.saveTraceRun(infoRecord,steps);}finally{db.close();}
  return {info:infoRecord,steps,returnValues:result,traceDate:infoRecord.compile_date,dbmsOutput:executionError?[executionError]:[]};
 });
}
module.exports={executeMysqlTrace};
