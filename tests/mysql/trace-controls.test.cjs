// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Client=require('../../electron/mysql/mysqlClient'),{getProcedure}=require('../../electron/mysql/procedureService'),{executeMysqlTrace}=require('../../electron/mysql/traceService'),{createTraceDatabase}=require('../../electron/services/traceStore');
const controls=`DECLARE i INT DEFAULT 0;
DECLARE total INT DEFAULT 0;
outer_loop: LOOP
 SET i=i+1;
 IF i=2 THEN ITERATE outer_loop; END IF;
 CASE i
 WHEN 1 THEN SET total=total+10;
 WHEN 3 THEN SET total=total+30;
 ELSE SET total=total+1;
 END CASE;
 IF i=4 THEN LEAVE outer_loop; END IF;
END LOOP outer_loop;
repeat_loop: REPEAT
 SET total=total+1;
 SET i=i-1;
UNTIL i=2 END REPEAT repeat_loop;
while_loop: WHILE i>0 DO
 SET i=i-1;
 CASE WHEN i=1 THEN ITERATE while_loop; ELSE SET total=total+5; END CASE;
END WHILE while_loop;`;
test('MySQL native CASE, LOOP, REPEAT, labelled WHILE and LEAVE/ITERATE trace matches native results and real iteration evidence',{timeout:15000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),name='MBT_'+randomBytes(6).toString('hex'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mb-controls-')),Database=createTraceDatabase('mysql',{getStoragePaths:()=>({traceDirectory:dir})});let made=false;
 try{await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});await c.main.promise().query('CREATE FUNCTION `'+name+'`() RETURNS INT DETERMINISTIC BEGIN '+controls+' RETURN total; END');made=true;
 const [rows]=await c.main.promise().query('SELECT `'+name+'`()');assert.equal(Number(rows[0][0]),48);const info=await getProcedure(c,{schema:'mb_test',name},'FUNCTION');const result=await executeMysqlTrace(c,{schema:'mb_test',objectName:name,objectType:'FUNCTION',sourceText:info.source,mysqlFingerprint:info.fingerprint,args:{}},{Database});assert.equal(result.info.execution_status,'complete');assert.equal(Number(result.returnValues[0].value),48);assert.ok(result.steps.some(s=>s.logText==='control-flow'&&s.loopPath==='L1_iter2'));assert.ok(result.steps.some(s=>s.loopPath==='L2_iter2'));assert.ok(result.steps.some(s=>s.loopPath==='L3_iter2'));
 }finally{if(made)await c.main.promise().query('DROP FUNCTION `'+name+'`');await c.disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
module.exports={controls};

test('MySQL extended controls also trace procedures, labelled block exits, native trigger rows and bounded endless LOOP',{timeout:20000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),base='MBT_'+randomBytes(6).toString('hex'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mb-controls-all-')),Database=createTraceDatabase('mysql',{getStoragePaths:()=>({traceDirectory:dir})}),created=[];const native=sql=>c.main.promise().query(sql),q=s=>'`'+s+'`';
 const runRoutine=async(name,kind,sql)=>{await native(sql);created.push([kind,name]);const info=await getProcedure(c,{schema:'mb_test',name},kind);return executeMysqlTrace(c,{schema:'mb_test',objectName:name,objectType:kind,sourceText:info.source,mysqlFingerprint:info.fingerprint,args:{}},{Database});};
 try{await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});
 let r=await runRoutine(base+'_p','PROCEDURE','CREATE PROCEDURE '+q(base+'_p')+'(OUT result INT) BEGIN '+controls+' SET result=total; END');assert.equal(Number(r.returnValues[0].value),48);
 r=await runRoutine(base+'_label','PROCEDURE','CREATE PROCEDURE '+q(base+'_label')+'(OUT result INT) outer_block: BEGIN SET result=3; LEAVE outer_block; SET result=99; END outer_block');assert.equal(Number(r.returnValues[0].value),3);assert.ok(r.steps.some(s=>s.logText==='control-flow'));assert.ok(!r.steps.some(s=>s.variables.result==='99'));
 await native('CREATE TABLE '+q(base)+'(id INT PRIMARY KEY,n INT) ENGINE=InnoDB');created.push(['TABLE',base]);await native('CREATE TRIGGER '+q(base+'_tr')+' BEFORE INSERT ON '+q(base)+' FOR EACH ROW BEGIN '+controls+' SET NEW.n=total; END');created.push(['TRIGGER',base+'_tr']);
 const {getTriggerTraceInputs,executeMysqlTriggerTrace}=require('../../electron/mysql/triggerTraceService'),spec=await getTriggerTraceInputs(c,{schema:'mb_test',name:base+'_tr'});r=await executeMysqlTriggerTrace(c,{schema:'mb_test',objectName:base+'_tr',objectType:'TRIGGER',sourceText:spec.trigger.body,mysqlFingerprint:spec.trigger.fingerprint,mysqlTableFingerprint:spec.tableFingerprint,triggerInput:{oldRow:{},newRow:{id:1,n:0}}},{Database});assert.equal(r.info.trigger_outcome[0].n,'48');assert.equal((await c.execute('SELECT COUNT(*) n FROM '+q(base))).rows[0].n,'0');
 r=await runRoutine(base+'_infinite','FUNCTION','CREATE FUNCTION '+q(base+'_infinite')+'() RETURNS INT DETERMINISTIC BEGIN endless: LOOP ITERATE endless; END LOOP endless; RETURN 1; END');assert.equal(r.info.execution_status,'incomplete');assert.equal(r.steps.length,2000);
 r=await runRoutine(base+'_root','PROCEDURE','CREATE PROCEDURE '+q(base+'_root')+'(OUT result INT) root_loop: LOOP SET result=7; LEAVE root_loop; END LOOP root_loop');assert.equal(Number(r.returnValues[0].value),7);
 r=await runRoutine(base+'_null','FUNCTION','CREATE FUNCTION '+q(base+'_null')+'() RETURNS INT DETERMINISTIC BEGIN CASE NULL WHEN NULL THEN RETURN 1; ELSE RETURN 2; END CASE; END');assert.equal(Number(r.returnValues[0].value),2);
 }finally{for(const [kind,name] of created.reverse())await native('DROP '+kind+' IF EXISTS '+q(name));await c.disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
