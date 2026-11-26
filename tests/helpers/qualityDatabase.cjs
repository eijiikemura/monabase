// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const assert=require('node:assert/strict');
const {randomBytes,webcrypto}=require('node:crypto');
const {loadTypeScript}=require('./loadTypeScript.cjs');
const globals={TextEncoder,crypto:webcrypto,Error};
const load=file=>loadTypeScript('src/features/quality/'+file+'.ts',{},globals);
const {captureResult}=load('resultSnapshot'),{maskResult,defaultMaskRules}=load('masking'),{compareResults}=load('compareResults'),{storedExpectation,runRegressionSuite}=load('regression');
async function verifyQualityDatabase(t,db,client,observer,config){
 const q=name=>(db==='mysql'?'`':'"')+name.replaceAll(db==='mysql'?'`':'"',db==='mysql'?'``':'""')+(db==='mysql'?'`':'"');
 const schema=db==='mysql'?config.database:db==='oracle'?(config.schema||config.user).toUpperCase():config.schema;
 assert.ok(schema,'Dedicated schema is required.');
 const name='MBT_'+randomBytes(5).toString('hex').toUpperCase(),table=q(schema)+'.'+q(name),f=q(schema)+'.'+q(name+'_F'),p=q(schema)+'.'+q(name+'_P'),created=[];
 const exec=(sql,binds={})=>client.execute(sql,binds);
 const first=result=>Object.values(result.rows[0])[0];
 t.after(async()=>{const failures=[];try{await client.rollback();await observer.rollback();}catch{failures.push('rollback');}for(const [kind,object]of created.reverse())try{if(db==='mysql')await client.main.promise().query('DROP '+kind+' '+object);else await exec('DROP '+kind+' '+object);}catch{failures.push('drop '+kind);}try{await client.commit();}catch{failures.push('cleanup commit');}for(const c of [observer,client])try{await c.disconnect();}catch{failures.push('disconnect');}assert.deepEqual(failures,[]);});
 await client.connect(config);await observer.connect(config);
 const actualSchema=String(first(await exec(db==='oracle'?"SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS s FROM dual":db==='mysql'?'SELECT DATABASE() AS s':'SELECT current_schema() AS s')));
 assert.equal(actualSchema,schema,'Verify the dedicated schema before writing.');
 await exec(`CREATE TABLE ${table} (${q('id')} ${db==='oracle'?'NUMBER':'INT'} PRIMARY KEY, ${q('n')} ${db==='oracle'?'NUMBER':'INT'}, ${q('email')} ${db==='oracle'?'VARCHAR2(100)':'VARCHAR(100)'})`);created.push(['TABLE',table]);
 await exec(`INSERT INTO ${table} VALUES(1,10,'demo@example.invalid')`);await client.commit();
 const functionDdl=db==='oracle'?`CREATE FUNCTION ${f}(p IN NUMBER) RETURN NUMBER AS total NUMBER:=0; BEGIN IF p IS NULL THEN RETURN 0; END IF; FOR i IN 1..p LOOP total:=total+i; END LOOP; RETURN total; END;`:
 db==='postgresql'?`CREATE FUNCTION ${f}(p integer) RETURNS integer LANGUAGE plpgsql AS $$ DECLARE total integer:=0; BEGIN IF p IS NULL THEN RETURN 0; END IF; FOR i IN 1..p LOOP total:=total+i; END LOOP; RETURN total; END $$`:
 `CREATE FUNCTION ${f}(p INT) RETURNS INT DETERMINISTIC NO SQL BEGIN DECLARE total INT DEFAULT 0; DECLARE i INT DEFAULT 1; WHILE i<=COALESCE(p,0) DO SET total=total+i; SET i=i+1; END WHILE; RETURN total; END`;
 if(db==='mysql')await client.main.promise().query(functionDdl);else await exec(functionDdl);created.push(['FUNCTION',f]);
 const procedureDdl=db==='oracle'?`CREATE PROCEDURE ${p}(p IN NUMBER, total OUT NUMBER) AS BEGIN UPDATE ${table} SET ${q('n')}=${q('n')}+p WHERE ${q('id')}=1; SELECT ${q('n')} INTO total FROM ${table} WHERE ${q('id')}=1; END;`:
 db==='postgresql'?`CREATE PROCEDURE ${p}(IN p integer, OUT total integer) LANGUAGE plpgsql AS $$ BEGIN UPDATE ${table} SET ${q('n')}=${q('n')}+p WHERE ${q('id')}=1; SELECT ${q('n')} INTO total FROM ${table} WHERE ${q('id')}=1; END $$`:
 `CREATE PROCEDURE ${p}(IN p INT,OUT total INT) BEGIN UPDATE ${table} SET ${q('n')}=${q('n')}+p WHERE ${q('id')}=1; SELECT ${q('n')} INTO total FROM ${table} WHERE ${q('id')}=1; END`;
 if(db==='mysql')await client.main.promise().query(procedureDdl);else await exec(procedureDdl);created.push(['PROCEDURE',p]);await client.commit();
 const request=async(kind,arg)=>{
  const objectName=name+(kind==='FUNCTION'?'_F':'_P'),r={schema,objectName,objectType:kind,args:{p:arg},argTypes:{p:db==='oracle'?'NUMBER':'INT',total:db==='oracle'?'NUMBER':'INT'},argDirections:{p:'IN',...(kind==='PROCEDURE'?{total:'OUT'}:{})},inputDateFormat:'YYYY-MM-DD'};
  if(db==='oracle'){r.args={P:arg,...(kind==='PROCEDURE'?{TOTAL:null}:{})};r.argTypes={P:'NUMBER',TOTAL:'NUMBER'};r.argDirections={P:'IN',TOTAL:'OUT'};}
  if(db==='mysql'){const detail=kind==='FUNCTION'?await client.getFunction({schema,name:objectName}):await client.getProcedure({schema,name:objectName});r.mysqlFingerprint=detail.fingerprint;}
  if(db==='postgresql')r.signature='integer';
  return r;
 };
 const executor={stored:async r=>{try{return {success:true,...await client.executeStored(r)};}catch{return {success:false,error:'Dedicated routine execution failed'};}},query:async(sql,binds,schema)=>({success:true,...await client.execute(sql,binds,schema)})};
 const makeSuite=cases=>({format:'monabase-regression',version:1,dbType:db,cases});
 await t.test('SQL snapshots compare exact fetched rows and mask copies without changing the main transaction',async()=>{
  await exec(`INSERT INTO ${table} VALUES(2,20,'demo@example.invalid')`);assert.equal(client.getMainTransactionState(),true);
  const result=await exec(`SELECT ${q('id')},${q('n')},${q('email')} FROM ${table} ORDER BY ${q('id')}`),snapshot=captureResult(result.metaData.map(m=>m.name),result.rows);
  assert.equal(compareResults(snapshot,{...snapshot,rows:[...snapshot.rows].reverse()}).equal,true);
  const changed={...snapshot,rows:snapshot.rows.map((r,i)=>i===0?[r[0],999,r[2]]:r)};assert.equal(compareResults(snapshot,changed,{keys:['id'],numericStrings:false}).changed,1);
  const rules=defaultMaskRules(snapshot);rules[0].mode='keep';rules[2].mode='email';const masked=await maskResult(snapshot,rules,'dedicated quality test secret');assert.equal(masked.rows[0][1],masked.rows[1][1]);assert.ok(!JSON.stringify(masked).includes('demo@example.invalid'));assert.equal(client.getMainTransactionState(),true);
  assert.equal(Number(first(await observer.execute(`SELECT COUNT(*) FROM ${table}`))),1);await client.rollback();
 });
 await t.test('Stored regression tests assert independent loop outcomes for ordinary, zero and NULL inputs and detect deliberate failures',async()=>{
  const cases=[];
  for(const [arg,want]of [['5',15],['0',0],[null,0]]){
   const r=await request('FUNCTION',arg),data=await client.executeStored(r);assert.notEqual(data.success,false,data.error);assert.equal(Number(data.returnValues[0].value),want);
   cases.push({id:String(arg),name:'loop '+arg,request:r,expected:storedExpectation(data),checks:[]});
  }
  const outcomes=await runRegressionSuite(makeSuite(cases),db,executor);assert.ok(outcomes.every(o=>o.status==='passed'));
  const wrong=JSON.parse(JSON.stringify(cases[0]));wrong.expected.returnValues[0].value='deliberately wrong';
  const failed=await runRegressionSuite(makeSuite([wrong,cases[1]]),db,executor);assert.equal(failed[0].status,'failed');assert.equal(failed[1].status,'not-run');await client.rollback();
 });
 await t.test('Procedure OUT values and verification SELECTs see pending updates while observer data and explicit rollback remain correct',async()=>{
  await exec(`INSERT INTO ${table} VALUES(3,30,'baseline@example.invalid')`);
  const r=await request('PROCEDURE','7'),baseline=await client.executeStored(r);assert.equal(Number(baseline.returnValues[0].value),17);const expected=storedExpectation(baseline);
  const sql=`SELECT ${q('n')} FROM ${table} WHERE ${q('id')}=1`,check=await exec(sql),snapshot=captureResult(check.metaData.map(m=>m.name),check.rows);await client.rollback();
  await exec(`INSERT INTO ${table} VALUES(2,20,'pending@example.invalid')`);
  const outcomes=await runRegressionSuite(makeSuite([{id:'update',name:'update and OUT',request:r,expected,checks:[{sql,binds:{},expected:snapshot}]}]),db,executor);assert.equal(outcomes[0].status,'passed',JSON.stringify(outcomes));assert.equal(client.getMainTransactionState(),true);
  assert.equal(Number(first(await observer.execute(sql))),10);assert.equal(Number(first(await observer.execute(`SELECT COUNT(*) FROM ${table}`))),1);
  await client.rollback();assert.equal(Number(first(await exec(sql))),10);assert.equal(Number(first(await exec(`SELECT COUNT(*) FROM ${table}`))),1);
 });
}
module.exports={verifyQualityDatabase};
