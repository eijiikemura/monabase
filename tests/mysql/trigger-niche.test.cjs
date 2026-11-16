// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomBytes}=require('node:crypto'),mysql=require('mysql2');
const Client=require('../../electron/mysql/mysqlClient'),{getTriggerTraceInputs,executeMysqlTriggerTrace}=require('../../electron/mysql/triggerTraceService'),{getTraceInputs}=require('../../electron/mysql/traceInputs'),{describeTraceTables}=require('../../electron/mysql/traceTables'),{createTraceDatabase}=require('../../electron/services/traceStore'),{createTraceIdentity}=require('../../electron/services/traceFiles');
test('MySQL niche trigger tracing compares native outcomes, saved evidence and safe unsupported-syntax refusal',{timeout:60000},async t=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),base='MBT_'+randomBytes(6).toString('hex'),target=base+'_target',lookup=base+'_lookup',procedure=base+'_procedure',dir=fs.mkdtempSync(path.join(os.tmpdir(),'mb-trigger-niche-')),Database=createTraceDatabase('mysql',{getStoragePaths:()=>({traceDirectory:dir})}),owned=[];
 const q=s=>'`'+s.replaceAll('`','``')+'`',native=async(sql,values=[])=>{try{return await c.main.promise().query(sql,values);}catch(error){await c.main.promise().query('SHOW WARNINGS');throw error;}};let serial=0,workers=0;
 const columns=['id','n','amount','label','stamp'];
 const insert=async row=>{const entries=Object.entries(row);await native(`INSERT INTO ${q(target)} (${entries.map(([k])=>q(k)).join(',')}) VALUES (${entries.map(()=>'?').join(',')})`,entries.map(([,v])=>v));};
 const read=async()=>{const [rows]=await native(`SELECT ${columns.map(n=>'CAST('+q(n)+' AS CHAR)').join(',')} FROM ${q(target)} ORDER BY id`);return rows.map(row=>Object.fromEntries(columns.map((name,i)=>[name,row[i]])));};
 const create=async(name,body,event='INSERT',timing='BEFORE')=>{await native(`CREATE TRIGGER ${q(name)} ${timing} ${event} ON ${q(target)} FOR EACH ROW ${body}`);owned.push(['TRIGGER',name]);return getTriggerTraceInputs(c,{schema:'mb_test',name});};
 const request=async(spec,input,fixtures={})=>{const tables=await describeTraceTables(c,{schema:'mb_test',source:spec.trigger.body});return {schema:'mb_test',objectName:spec.trigger.name,objectType:'TRIGGER',sourceText:spec.trigger.body,mysqlFingerprint:spec.trigger.fingerprint,mysqlTableFingerprint:spec.tableFingerprint,triggerInput:input,mysqlTraceFixtures:fixtures,mysqlTraceTableFingerprints:Object.fromEntries(tables.map(table=>[table.name,table.fingerprint]))};};
 const record=async(spec,input,fixtures)=>executeMysqlTriggerTrace(c,await request(spec,input,fixtures),{Database});
 const persisted=async spec=>{const db=new Database(createTraceIdentity(c.lastConfig,{schema:'mb_test',objectName:spec.trigger.name,objectType:'TRIGGER'}));try{await db.init();return {info:await db.getTraceInfo(),steps:await db.getTraceSteps()};}finally{db.close();}};
 const exercise=async({body,event='INSERT',input={oldRow:{},newRow:{id:1,n:0,amount:'0',label:'demo'}},expected,inspect=()=>{},fixtures={}})=>{
  const name=base+'_tr'+serial++;if(event!=='INSERT')await insert(input.oldRow);
  const spec=await create(name,body,event);const original=await read();
  try{
   if(event==='INSERT')await insert(input.newRow);else if(event==='DELETE')await native('DELETE FROM '+q(target));else{const entries=Object.entries(input.newRow);await native(`UPDATE ${q(target)} SET ${entries.map(([k])=>q(k)+'=?').join(',')}`,entries.map(([,v])=>v));}
   const actual=await read();await c.rollback();expected(actual);
   const ready=await getTraceInputs(c,{schema:'mb_test',name,kind:'TRIGGER',fingerprint:spec.trigger.fingerprint});assert.equal(ready.fingerprint,spec.trigger.fingerprint);
   const result=await record(spec,input,fixtures);assert.equal(result.info.execution_status,'complete',result.info.execution_error);assert.deepEqual(result.info.trigger_outcome,actual);assert.deepEqual(await read(),original);assert.equal(c.getMainTransactionState(),false);
   const saved=await persisted(spec);assert.equal(saved.info.executed_source,spec.trigger.body);assert.equal(saved.steps.length,result.steps.length);assert.ok(saved.steps.every(step=>Number.isSafeInteger(step.line_num)&&step.line_num>=1&&step.line_num<=spec.trigger.body.split('\n').length));await inspect(result,saved);
  }finally{await c.rollback();await native('DROP TRIGGER IF EXISTS '+q(name));await native('DELETE FROM '+q(target));await c.commit();}
 };
 try{
  await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});const open=c.openTraceConnection.bind(c);c.openTraceConnection=async(...args)=>{workers++;return open(...args);};
  await native(`CREATE TABLE ${q(target)}(id INT PRIMARY KEY,n INT,amount DECIMAL(30,6),label VARCHAR(160),stamp DATETIME(6)) ENGINE=InnoDB`);owned.push(['TABLE',target]);await native(`CREATE TABLE ${q(lookup)}(id INT PRIMARY KEY,amount INT) ENGINE=InnoDB`);owned.push(['TABLE',lookup]);await native(`INSERT INTO ${q(lookup)} VALUES(1,10),(2,20),(999,777)`);await c.commit();
  await native(`CREATE PROCEDURE ${q(procedure)}(OUT answer INT) SET answer=9`);owned.push(['PROCEDURE',procedure]);
  await t.test('A no-match CASE preserves native error 1339 and the numeric CONTINUE handler',()=>exercise({body:'BEGIN\nDECLARE seen INT DEFAULT 0;\nDECLARE CONTINUE HANDLER FOR 1339 SET seen=7;\nCASE NEW.n WHEN 99 THEN SET seen=99; END CASE;\nSET NEW.n=seen+1;\nEND',expected:rows=>assert.equal(rows[0].n,'8'),inspect:r=>assert.ok(r.steps.some(s=>s.logText==='handler-entry'))}));
  await t.test('NULL-safe equality compares OLD and NEW without treating NULL as false',()=>exercise({event:'UPDATE',body:'IF OLD.n <=> NEW.n THEN SET NEW.n=11; ELSE SET NEW.n=22; END IF',input:{oldRow:{id:1,n:null,amount:'1'},newRow:{n:null}},expected:rows=>assert.equal(rows[0].n,'11'),inspect:r=>assert.ok(r.steps.some(s=>s.variables['OLD.n']==='[SQL NULL]'))}));
  await t.test('Exact DECIMAL arithmetic and escaped Unicode/string markers survive native execution and persistence',()=>exercise({body:`BEGIN\nDECLARE exact_value DECIMAL(30,6) DEFAULT 9007199254740993.123456;\nDECLARE text_value VARCHAR(160) DEFAULT ${mysql.escape('[SQL NULL] <script>日本語 "quotes"; RETURN;\nnext')};\nSET NEW.amount=exact_value+0.000001;\nSET NEW.label=text_value;\nEND`,expected:rows=>{assert.equal(rows[0].amount,'9007199254740993.123457');assert.ok(rows[0].label.includes('日本語'));},inspect:r=>assert.ok(r.steps.some(s=>s.variables.exact_value==='9007199254740993.123456'&&s.variables.text_value===JSON.stringify('[SQL NULL] <script>日本語 "quotes"; RETURN;\nnext')))}));
  await t.test('A specific error-code handler wins over SQLSTATE and SQLEXCEPTION handlers',()=>exercise({body:"BEGIN DECLARE seen INT DEFAULT 0; DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET seen=100; DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET seen=10; DECLARE CONTINUE HANDLER FOR 1644 SET seen=1; SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='expected'; SET NEW.n=seen; END",expected:rows=>assert.equal(rows[0].n,'1')}));
  await t.test('A SQLWARNING signal invokes its warning handler and then continues',()=>exercise({body:"BEGIN DECLARE seen INT DEFAULT 0; DECLARE CONTINUE HANDLER FOR SQLWARNING SET seen=5; SIGNAL SQLSTATE '01000' SET MESSAGE_TEXT='expected warning'; SET NEW.n=seen+1; END",expected:rows=>assert.equal(rows[0].n,'6')}));
  await t.test('A labelled whole-trigger LEAVE skips unreachable assignments',()=>exercise({body:'finish: BEGIN\nSET NEW.n=3;\nLEAVE finish;\nSET NEW.n=999;\nEND finish',expected:rows=>assert.equal(rows[0].n,'3'),inspect:r=>assert.ok(!r.steps.some(s=>s.variables['NEW.n']==='999'))}));
  await t.test('A nested EXIT handler modifies NEW and exits only its own block',()=>exercise({body:"BEGIN DECLARE total INT DEFAULT 1; BEGIN DECLARE EXIT HANDLER FOR SQLSTATE '45000' BEGIN SET NEW.n=total+10; END; SIGNAL SQLSTATE '45000'; SET NEW.n=999; END; SET NEW.n=NEW.n+1; END",expected:rows=>assert.equal(rows[0].n,'12')}));
  await t.test('A multi-column cursor with FETCH NEXT FROM and NOT FOUND records the final fetch iteration',()=>exercise({body:`BEGIN
DECLARE done INT DEFAULT 0;
DECLARE item INT DEFAULT 0;
DECLARE value INT DEFAULT 0;
DECLARE total INT DEFAULT 0;
DECLARE cur CURSOR FOR SELECT id,amount FROM ${q(lookup)} WHERE id<3 ORDER BY id;
DECLARE CONTINUE HANDLER FOR NOT FOUND SET done=1;
OPEN cur;
scan_loop: LOOP
FETCH NEXT FROM cur INTO item,value;
IF done=1 THEN LEAVE scan_loop; END IF;
SET total=total+item+value;
END LOOP scan_loop;
CLOSE cur;
SET NEW.n=total;
END`,fixtures:{[lookup]:[{id:1,amount:10},{id:2,amount:20}]},expected:rows=>assert.equal(rows[0].n,'33'),inspect:r=>assert.ok(r.steps.some(s=>s.logText==='handler-entry'&&s.loopPath==='L1_iter3'))}));
  await t.test('REPEAT and ITERATE preserve the UNTIL check on the final iteration',()=>exercise({body:'BEGIN DECLARE i INT DEFAULT 0; DECLARE total INT DEFAULT 0; again: REPEAT SET i=i+1; IF i=2 THEN ITERATE again; END IF; SET total=total+i; UNTIL i>=4 END REPEAT again; SET NEW.n=total; END',expected:rows=>assert.equal(rows[0].n,'8'),inspect:r=>assert.ok(r.steps.some(s=>s.loopPath==='L1_iter4'))}));
  await t.test('An unhandled RESIGNAL records a native failure and rolls back the isolated row',async()=>{
   const name=base+'_tr'+serial++,body="BEGIN DECLARE EXIT HANDLER FOR SQLSTATE '45000' BEGIN SET NEW.n=15; RESIGNAL SET MESSAGE_TEXT='reraised'; END; SIGNAL SQLSTATE '45000'; SET NEW.n=999; END",spec=await create(name,body);
   try{let code;await assert.rejects(insert({id:1,n:0}),e=>{code=e.code;return true;});await c.rollback();assert.equal((await read()).length,0);const r=await record(spec,{oldRow:{},newRow:{id:1,n:0}});assert.equal(r.info.execution_status,'incomplete');assert.ok(r.info.execution_error.includes(code));assert.ok(!r.steps.some(s=>s.variables['NEW.n']==='999'));assert.equal((await read()).length,0);}finally{await c.rollback();await native('DROP TRIGGER IF EXISTS '+q(name));}
  });
  for(const [label,body,n] of [
   ['Named CONDITION',"BEGIN DECLARE expected CONDITION FOR SQLSTATE '45000'; DECLARE CONTINUE HANDLER FOR expected SET NEW.n=23; SIGNAL expected; END",23],
   ['GET STACKED DIAGNOSTICS',"BEGIN DECLARE code INT; DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET STACKED DIAGNOSTICS CONDITION 1 code=MYSQL_ERRNO; SIGNAL SQLSTATE '45000'; SET NEW.n=code; END",1644],
   ['JOIN SELECT',`BEGIN DECLARE value INT; SELECT SUM(a.amount+b.amount) INTO value FROM ${q(lookup)} AS a JOIN ${q(lookup)} AS b ON a.id=b.id WHERE a.id<3; SET NEW.n=value; END`,60],
   ['Scalar subquery',`SET NEW.n=(SELECT COUNT(*) FROM ${q(lookup)} WHERE id<3)`,2],
   ['Stored procedure CALL',`BEGIN DECLARE value INT; CALL ${q(procedure)}(value); SET NEW.n=value; END`,9],
   ['CASE expression','SET NEW.n=CASE WHEN NEW.n=0 THEN 4 ELSE 5 END',4],
   ['Wildcard SELECT',`BEGIN DECLARE item INT; DECLARE value INT; SELECT * INTO item,value FROM ${q(lookup)} WHERE id=1; SET NEW.n=item+value; END`,11]
  ])await t.test(label+' is valid natively but refused before trace copies are created, preserving the previous recording',async()=>{
   const name=base+'_tr'+serial++,input={oldRow:{},newRow:{id:1,n:0}},before=await create(name,'SET NEW.n=8');await record(before,input);const old=await persisted(before);await native('DROP TRIGGER '+q(name));const spec=await create(name,body);
   try{await insert(input.newRow);assert.equal((await read())[0].n,String(n));await c.rollback();const count=workers;await assert.rejects(getTraceInputs(c,{schema:'mb_test',name,kind:'TRIGGER',fingerprint:spec.trigger.fingerprint}));await assert.rejects(record(spec,input));assert.equal(workers,count);assert.equal((await persisted(spec)).info.executed_source,old.info.executed_source);assert.equal((await read()).length,0);}finally{await c.rollback();await native('DROP TRIGGER IF EXISTS '+q(name));}
  });
  await t.test('Peer triggers intentionally remain outside selected-trigger trace scope',async()=>{
   const peer=base+'_peer',name=base+'_tr'+serial++;await create(peer,'SET NEW.n=NEW.n+100');const spec=await create(name,'SET NEW.n=NEW.n+5');
   try{await insert({id:1,n:0});assert.equal((await read())[0].n,'105');await c.rollback();const r=await record(spec,{oldRow:{},newRow:{id:1,n:0}});assert.equal(r.info.trigger_outcome[0].n,'5');assert.match(r.info.scope,/No existing rows, peer triggers/);assert.equal((await read()).length,0);}finally{await c.rollback();await native('DROP TRIGGER IF EXISTS '+q(name));await native('DROP TRIGGER IF EXISTS '+q(peer));}
  });
  assert.equal(Number((await native('SELECT SUM(amount) FROM '+q(lookup)))[0][0][0]),807);
 }finally{if(c.main){try{await native('ROLLBACK');for(const [kind,name] of [...owned].reverse())await native('DROP '+kind+' IF EXISTS '+q(name));}finally{await c.disconnect();}}fs.rmSync(dir,{recursive:true,force:true});}
});
