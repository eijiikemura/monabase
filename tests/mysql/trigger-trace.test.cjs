// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomBytes}=require('node:crypto');
const Client=require('../../electron/mysql/mysqlClient'),{getTriggerTraceInputs,executeMysqlTriggerTrace}=require('../../electron/mysql/triggerTraceService'),{createTraceDatabase}=require('../../electron/services/traceStore'),{createTraceIdentity}=require('../../electron/services/traceFiles');
test('MySQL real trigger trace fires isolated INSERT/UPDATE/DELETE and preserves original definitions, rows and pending work',{timeout:40000},async t=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),base='MBT_'+randomBytes(6).toString('hex'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mb-trigger-')),Database=createTraceDatabase('mysql',{getStoragePaths:()=>({traceDirectory:dir})});
 const native=(sql,values=[])=>c.main.promise().query(sql,values),q=s=>'`'+s+'`',names=[];
 const make=async(event,timing,body)=>{const name=base+'_'+names.length;await native(`CREATE TRIGGER ${q(name)} ${timing} ${event} ON ${q(base)} FOR EACH ROW ${body}`);names.push(name);return getTriggerTraceInputs(c,{schema:'mb_test',name});};
 const run=(spec,triggerInput)=>executeMysqlTriggerTrace(c,{schema:'mb_test',objectName:spec.trigger.name,objectType:'TRIGGER',sourceText:spec.trigger.body,mysqlFingerprint:spec.trigger.fingerprint,mysqlTableFingerprint:spec.tableFingerprint,triggerInput},{Database});
 try{await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});await native(`CREATE TABLE ${q(base)} (id INT AUTO_INCREMENT PRIMARY KEY,n INT,amount DECIMAL(20,2),label VARCHAR(50),derived INT GENERATED ALWAYS AS (n+1)) ENGINE=InnoDB`);await native(`INSERT INTO ${q(base)}(n,amount,label) VALUES(9,99,'original')`);await c.commit();
 await t.test('BEFORE INSERT records real NEW fields, exact decimals, original body lines and no OLD fields',async()=>{
  const spec=await make('INSERT','BEFORE','BEGIN\nDECLARE i INT DEFAULT 0;\nWHILE i < NEW.n DO\nSET NEW.amount=COALESCE(NEW.amount,0)+10;\nSET i=i+1;\nEND WHILE;\nEND');const result=await run(spec,{oldRow:{},newRow:{n:3,amount:'0',label:'[SQL NULL]'}});
  assert.equal(result.info.execution_status,'complete');assert.equal(result.info.trigger_outcome[0].amount,'30.00');assert.equal(result.steps.find(s=>s.logText==='entry').variables['NEW.id'],'0');assert.ok(result.steps.some(s=>s.lineNum===4&&s.loopPath==='L1_iter3'&&s.logText==='after'&&s.variables['NEW.amount']==='30.00'));assert.ok(result.steps.every(s=>!Object.keys(s.variables).some(k=>k.startsWith('OLD.'))));assert.ok(result.steps.some(s=>s.variables['NEW.label']==='"[SQL NULL]"'));assert.equal(result.info.executed_source,spec.trigger.body);
 });
 await t.test('BEFORE UPDATE uses actual OLD and NEW and only its selected trigger',async()=>{const spec=await make('UPDATE','BEFORE','SET NEW.amount=OLD.amount+NEW.n');const r=await run(spec,{oldRow:{id:5,n:2,amount:'10'},newRow:{n:7}});assert.equal(r.info.trigger_outcome[0].amount,'17.00');assert.ok(r.steps.some(s=>s.variables['OLD.amount']==='10.00'&&s.variables['NEW.n']==='7'));});
 await t.test('AFTER DELETE records OLD values and an empty outcome',async()=>{const spec=await make('DELETE','AFTER','BEGIN DECLARE v INT; SET v=OLD.n; END');const r=await run(spec,{oldRow:{id:6,n:4},newRow:{}});assert.deepEqual(r.info.trigger_outcome,[]);assert.ok(r.steps.some(s=>s.variables.v==='4'&&s.variables['OLD.n']==='4'));assert.ok(r.steps.every(s=>!('NEW.n' in s.variables)));});
 await t.test('AFTER INSERT observes generated IDs; AFTER UPDATE and BEFORE DELETE preserve native aliases',async()=>{
  for(const [event,timing,body,oldRow,newRow,variable] of [
   ['INSERT','AFTER','BEGIN DECLARE seen INT; SET seen=NEW.id; END',{}, {n:2},'NEW.id'],
   ['UPDATE','AFTER','BEGIN DECLARE seen INT; SET seen=OLD.n+NEW.n; END',{id:8,n:2},{n:3},'OLD.n'],
   ['DELETE','BEFORE','BEGIN DECLARE seen INT; SET seen=OLD.n; END',{id:8,n:2},{},'OLD.n']]){
   const spec=await make(event,timing,body),r=await run(spec,{oldRow,newRow});assert.equal(r.info.execution_status,'complete');assert.ok(r.steps.some(s=>variable in s.variables));if(event==='INSERT')assert.ok(Number(r.steps[0].variables['NEW.id'])>0);
  }
 });
 await t.test('A bounded infinite trigger retains partial evidence, rolls back copied DML and never replaces the saved definition',async()=>{
  const spec=await make('INSERT','BEFORE','BEGIN DECLARE i INT DEFAULT 0; WHILE 1 DO SET i=i+1; END WHILE; END');const r=await run(spec,{oldRow:{},newRow:{n:1}});assert.equal(r.info.execution_status,'incomplete');assert.equal(r.steps.length,2000);assert.deepEqual(r.info.trigger_outcome,[]);assert.equal((await getTriggerTraceInputs(c,{schema:'mb_test',name:spec.trigger.name})).trigger.fingerprint,spec.trigger.fingerprint);
  c.readonly=true;try{await assert.rejects(run(spec,{oldRow:{},newRow:{n:1}}),/writable/);}finally{c.readonly=false;}
 });
 await t.test('Stale sources, generated input, unsupported SQL, unavailable row aliases and pending main work are refused',async()=>{
  const spec=await getTriggerTraceInputs(c,{schema:'mb_test',name:names[0]});await assert.rejects(run(spec,{oldRow:{},newRow:{derived:2}}),/generated/);await assert.rejects(run({...spec,tableFingerprint:'stale'},{oldRow:{},newRow:{}}),/changed/);
  await c.execute(`UPDATE ${q(base)} SET n=10`);await assert.rejects(run(spec,{oldRow:{},newRow:{n:2}}),/pending/);assert.equal(c.getMainTransactionState(),true);await c.rollback();
  for(const body of ['BEGIN INSERT INTO ignored VALUES(1); END']){const bad=await make('INSERT','BEFORE',body);await assert.rejects(run(bad,{oldRow:{},newRow:{n:1}}),/accessible InnoDB base tables only/);}
 });
 await t.test('A firing failure before any snapshot preserves the prior saved recording',async()=>{
  const spec=await getTriggerTraceInputs(c,{schema:'mb_test',name:names[0]}),db=new Database(createTraceIdentity(c.lastConfig,{schema:'mb_test',objectName:names[0],objectType:'TRIGGER'}));await db.init();const before=await db.getTraceInfo();db.close();
  await assert.rejects(run(spec,{oldRow:{},newRow:{n:'not an integer'}}),/No trigger trace records/);
  const after=new Database(createTraceIdentity(c.lastConfig,{schema:'mb_test',objectName:names[0],objectType:'TRIGGER'}));await after.init();assert.equal((await after.getTraceInfo()).compile_date,before.compile_date);after.close();
 });
 await t.test('Original rows and definitions remain and all isolated copies are gone',async()=>{assert.equal((await native(`SELECT n FROM ${q(base)}`))[0][0][0],9);for(const name of names)assert.ok((await getTriggerTraceInputs(c,{schema:'mb_test',name})).trigger.body);const [rows]=await native("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='mb_test' AND TABLE_NAME LIKE 'mbt_trace_%'");assert.equal(rows.length,0);});
 }finally{try{await c.rollback();for(const name of names)await native('DROP TRIGGER IF EXISTS '+q(name));await native('DROP TABLE IF EXISTS '+q(base));}finally{await c.disconnect();fs.rmSync(dir,{recursive:true,force:true});}}
});
