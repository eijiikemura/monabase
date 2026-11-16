// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');
const Client=require('../../electron/mysql/mysqlClient');
test('Disposable MySQL procedures: arguments, multiple results, native transactions and safe replacement',{timeout:60000},async t=>{
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),base='MBT_'+randomBytes(6).toString('hex'),name=base+'_proc',table=base+'_table',schema='mb_test';
  const source=body=>`CREATE PROCEDURE \`${schema}\`.\`${name}\`(IN p INT, OUT total DECIMAL(30,8), INOUT label VARCHAR(100)) SQL SECURITY INVOKER COMMENT 'test procedure' BEGIN ${body} END`;
  const mutation=(operation,sql,fingerprint)=>({schema,name,operation,source:sql,fingerprint});
  const call=async(args={p:'2',label:'hello'})=>{const info=await c.getProcedure({schema,name});return c.executeStored({schema,objectName:name,objectType:'PROCEDURE',args,mysqlFingerprint:info.fingerprint});};
  try{
    await c.connect({dbType:'mysql',host:'127.0.0.1',port:'13306',database:schema,user:'test',password:'test'});
    await c.execute(`CREATE TABLE ${table}(id INT PRIMARY KEY) ENGINE=InnoDB`);
    await t.test('Create a compound procedure and retrieve complete typed metadata without committing pending rows',async()=>{
      const r=await c.mutateProcedure(mutation('create',source(`SET total=1234567890123456789012.12345678; SET label=CONCAT(label,'!'); SELECT p AS value; SELECT 'second' AS label; INSERT INTO ${table} VALUES(p);`)));assert.equal(r.success,true,r.error);assert.equal(r.procedure.security,'INVOKER');assert.deepEqual(r.procedure.parameters.map(p=>p.direction),['IN','OUT','INOUT']);
      await c.execute(`INSERT INTO ${table} VALUES(1)`);assert.equal(c.getMainTransactionState(),true);await c.getProcedure({schema,name});assert.equal(c.getMainTransactionState(),true);await c.rollback();
    });
    await t.test('IN, OUT, INOUT, high precision values and distinct result sets use the main connection',async()=>{
      const r=await call();assert.deepEqual(r.resultSets.map(r=>r.metaData.map(f=>f.name)),[['value'],['label']]);assert.equal(r.resultSets[0].rows[0].value,2);assert.equal(r.returnValues[0].value,'1234567890123456789012.12345678');assert.equal(r.returnValues[1].value,'hello!');assert.equal(c.getMainTransactionState(),true);assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${table}`,{},null,false,true)).rows[0].n,'0');await c.rollback();assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n,'0');
    });
    await t.test('Readonly and stale metadata reject CALL without executing or losing pending changes',async()=>{
      const info=await c.getProcedure({schema,name});await assert.rejects(()=>c.executeStored({schema,objectName:name,objectType:'PROCEDURE',args:{p:3},mysqlFingerprint:'stale'}),/changed/);
      c.readonly=true;await assert.rejects(()=>call(),/writable/);c.readonly=false;assert.equal((await c.getProcedure({schema,name})).fingerprint,info.fingerprint);
    });
    await t.test('Replacing preserves SQL security, definer and mode and performs the native DDL implicit commit',async()=>{
      const before=await c.getProcedure({schema,name});await c.execute(`INSERT INTO ${table} VALUES(10)`);const r=await c.mutateProcedure(mutation('replace',source('SET total=p+1; SET label=CONCAT(label,\'updated\'); SELECT p AS value;'),before.fingerprint));assert.equal(r.success,true,r.error);for(const k of ['security','definer','mode','charset','collation'])assert.equal(r.procedure[k],before[k]);assert.equal(c.getMainTransactionState(),false);await c.rollback();assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${table} WHERE id=10`)).rows[0].n,'1');
    });
    await t.test('Empty inputs become NULL and quoted values cannot add SQL statements',async()=>{
      const r=await call({p:'',label:"x'); DROP TABLE nowhere; --"});assert.equal(r.returnValues[0].value,null);assert.equal(r.returnValues[1].value,"x'); DROP TABLE nowhere; --updated");assert.equal(r.resultSets[0].rows[0].value,null);
    });
    await t.test('Server syntax failure after DROP offers explicit recovery and never retries automatically',async()=>{
      const before=await c.getProcedure({schema,name});const r=await c.mutateProcedure(mutation('replace',source('SET total=;'),before.fingerprint));assert.equal(r.success,false);assert.equal(r.stage,'dropped');assert.ok(r.recovery);await assert.rejects(()=>c.getProcedure({schema,name}));
      const restore=await c.mutateProcedure({...mutation('restore',''),recoveryToken:r.recovery.token});assert.equal(restore.success,true,restore.error);assert.equal(restore.procedure.source,before.source);assert.equal((await c.mutateProcedure({...mutation('restore',''),recoveryToken:r.recovery.token})).success,false);
    });
    await t.test('An execution error preserves earlier DML and does not replay or roll back the call',async()=>{
      const before=await c.getProcedure({schema,name});const r=await c.mutateProcedure(mutation('replace',source(`INSERT INTO ${table} VALUES(p); SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='expected failure';`),before.fingerprint));assert.equal(r.success,true,r.error);await assert.rejects(()=>call({p:'20'}),/expected failure/);assert.equal(c.getMainTransactionState(),true);assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${table} WHERE id=20`)).rows[0].n,'1');await c.rollback();assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${table} WHERE id=20`)).rows[0].n,'0');
    });
    await t.test('A procedure COMMIT is reflected in native transaction state',async()=>{
      const before=await c.getProcedure({schema,name});assert.equal((await c.mutateProcedure(mutation('replace',source(`INSERT INTO ${table} VALUES(p); COMMIT;`),before.fingerprint))).success,true);await call({p:30});assert.equal(c.getMainTransactionState(),false);await c.rollback();assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${table} WHERE id=30`)).rows[0].n,'1');
    });
    await t.test('Delete checks the current fingerprint and removes only the selected routine',async()=>{
      const info=await c.getProcedure({schema,name});assert.equal((await c.mutateProcedure(mutation('drop','',info.fingerprint))).success,true);await assert.rejects(()=>c.getProcedure({schema,name}));
    });
  }finally{try{await c.rollback();await c.main.promise().query(`DROP PROCEDURE IF EXISTS ${name}`);await c.execute(`DROP TABLE IF EXISTS ${table}`);}finally{await c.disconnect();}}
});

test('Disposable MySQL procedures: cancellation, session safety and aggregate result limits',{timeout:30000},async t=>{
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const config={host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'},name='MBT_'+randomBytes(6).toString('hex')+'_guard';let c=new Client();
  const raw=async body=>{await c.main.promise().query(`DROP PROCEDURE IF EXISTS ${name}`);await c.main.promise().query(`CREATE PROCEDURE ${name}() BEGIN ${body} END`);};
  const call=async()=>{const p=await c.getProcedure({schema:'mb_test',name});return c.executeStored({schema:'mb_test',objectName:name,objectType:'PROCEDURE',args:{},mysqlFingerprint:p.fingerprint});};
  try{
    await c.connect(config);
    await t.test('A timed out CALL is cancelled without a replay and leaves the connection usable',async()=>{
      await raw('SELECT SLEEP(2);');c.timeout=0.05;await assert.rejects(call,/cancel|interrupted/i);c.timeout=0;assert.notEqual(c.getTransactionDetails().transactionStatus,'unknown');assert.equal((await c.execute('SELECT 7 AS value')).rows[0].value,'7');
    });
    await t.test('Empty result sets cannot exceed the aggregate output-set limit',async()=>{
      await raw('DECLARE i INT DEFAULT 0; WHILE i<101 DO SELECT i WHERE FALSE; SET i=i+1; END WHILE;');await assert.rejects(call,/100 result sets/);assert.notEqual(c.getTransactionDetails().transactionStatus,'unknown');
    });
    await t.test('A preexisting procedure changing autocommit invalidates the connection instead of permitting unsafe later SQL',async()=>{
      await raw('SET autocommit=1;');await assert.rejects(call,/protected session settings/);assert.equal(c.getTransactionDetails().transactionStatus,'unknown');
    });
  }finally{
    await c.disconnect();c=new Client();try{await c.connect(config);await c.main.promise().query(`DROP PROCEDURE IF EXISTS ${name}`);}finally{await c.disconnect();}
  }
});
