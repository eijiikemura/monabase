// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const Client=require('../../electron/mysql/mysqlClient'),{getProcedure}=require('../../electron/mysql/procedureService'),{executeMysqlTrace}=require('../../electron/mysql/traceService'),{createTraceDatabase}=require('../../electron/services/traceStore'),{createTraceIdentity}=require('../../electron/services/traceFiles'),{loopSource}=require('../helpers/mysqlTrace.cjs');
test('MySQL native trace records real function/procedure loop values, exact source lines, NULL, limits and safe refusal',{timeout:30000},async t=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),base='MBT_'+randomBytes(6).toString('hex'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'mb-mysql-trace-')),Database=createTraceDatabase('mysql',{getStoragePaths:()=>({traceDirectory:directory})}),created=[];
 const native=sql=>c.main.promise().query(sql);
 const make=async(name,kind,source)=>{await native(source);created.push([kind,name]);return getProcedure(c,{schema:'mb_test',name},kind);};
 const run=(info,args={p_count:'5'})=>executeMysqlTrace(c,{schema:info.schema,objectName:info.name,objectType:info.kind,sourceText:info.source,mysqlFingerprint:info.fingerprint,args},{Database});
 try{await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});
 for(const kind of ['FUNCTION','PROCEDURE'])await t.test(kind+' real loop evidence and saved replay',async()=>{
  const name=base+(kind==='FUNCTION'?'_f':'_p'),info=await make(name,kind,loopSource('mb_test',name,kind));const result=await run(info);assert.equal(result.info.execution_status,'complete');assert.equal(Number(result.returnValues[0].value),90);
  const badLine=info.source.split('\n').findIndex(line=>line.includes('v_total - v_amount'))+1;assert.ok(badLine>0);
  const before=result.steps.find(s=>s.lineNum===badLine&&s.loopPath==='L1_iter3'&&s.logText==='before'),after=result.steps.find(s=>s.lineNum===badLine&&s.loopPath==='L1_iter3'&&s.logText==='after');assert.equal(Number(before.variables.v_total),30);assert.equal(Number(after.variables.v_total),0);assert.equal(Number(after.variables.v_amount),30);
  assert.equal(result.info.source_sha256,createHash('sha256').update(info.source).digest('hex'));assert.equal(result.info.executed_source,info.source);const db=new Database(createTraceIdentity(c.lastConfig,{schema:'mb_test',objectName:name,objectType:kind}));await db.init();assert.equal((await db.getTraceSteps()).length,result.steps.length);db.close();assert.equal(c.getMainTransactionState(),false);assert.equal((await c.execute('SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=:schema AND ROUTINE_NAME=:name',{schema:'mb_test',name:result.info.instrumented_copy},null,false,true)).rows.length,0);
 });
 await t.test('Refuse SQL without reviewed table inputs, stale source and pending main work before creating or running a trace copy',async()=>{
  const info=await getProcedure(c,{schema:'mb_test',name:base+'_f'},'FUNCTION');await assert.rejects(executeMysqlTrace(c,{schema:'mb_test',objectName:info.name,objectType:'FUNCTION',sourceText:info.source,mysqlFingerprint:'stale',args:{}},{Database}),/changed/);
  await c.execute('CREATE TABLE `'+base+'_t`(id INT PRIMARY KEY) ENGINE=InnoDB');created.push(['TABLE',base+'_t']);await c.execute('INSERT INTO `'+base+'_t` VALUES(1)');await assert.rejects(run(info),/pending changes/);assert.equal(c.getMainTransactionState(),true);await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM `'+base+'_t`')).rows[0].n,'0');
  const bad=await make(base+'_bad','PROCEDURE','CREATE PROCEDURE `'+base+'_bad`() BEGIN INSERT INTO `'+base+'_t` VALUES(2); END');await assert.rejects(run(bad),/Trace tables changed/);assert.equal((await c.execute('SELECT COUNT(*) n FROM `'+base+'_t`')).rows[0].n,'0');
 });
 await t.test('Infinite scalar loops stop at the record budget and retain explicitly incomplete evidence',async()=>{
  const info=await make(base+'_limit','FUNCTION','CREATE FUNCTION `'+base+'_limit`() RETURNS INT DETERMINISTIC BEGIN DECLARE i INT DEFAULT 0; WHILE 1 DO SET i=i+1; END WHILE; RETURN i; END');const result=await run(info);assert.equal(result.info.execution_status,'incomplete');assert.equal(result.steps.length,2000);assert.equal(result.returnValues.length,0);
 });
 await t.test('Exact integers and NULL remain visible without JavaScript rounding',async()=>{
  const info=await make(base+'_exact','FUNCTION','CREATE FUNCTION `'+base+'_exact`() RETURNS BIGINT DETERMINISTIC BEGIN DECLARE n BIGINT DEFAULT 9007199254740993; DECLARE blank INT; SET n=n+1; RETURN n; END');const result=await run(info);assert.equal(result.returnValues[0].value,'9007199254740994');assert.ok(result.steps.some(s=>s.variables.n==='9007199254740994'&&s.variables.blank==='[SQL NULL]'));
 });
 await t.test('Character strings cannot be confused with the SQL NULL marker',async()=>{
  const info=await make(base+'_text','FUNCTION',"CREATE FUNCTION `"+base+"_text`(p_text VARCHAR(32)) RETURNS VARCHAR(64) DETERMINISTIC BEGIN DECLARE literal_value VARCHAR(32) DEFAULT p_text; DECLARE absent VARCHAR(32); RETURN literal_value; END");const result=await run(info,{p_text:'[SQL NULL]'});assert.ok(result.steps.some(s=>s.variables.literal_value==='"[SQL NULL]"'&&s.variables.absent==='[SQL NULL]'));assert.equal(result.returnValues[0].value,'[SQL NULL]');
 });
 }finally{try{await c.rollback();for(const [kind,name] of created.reverse())await native('DROP '+kind+' IF EXISTS `'+name+'`');}finally{await c.disconnect();fs.rmSync(directory,{recursive:true,force:true});}}
});
