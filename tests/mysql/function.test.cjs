// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');
const Client=require('../../electron/mysql/mysqlClient');
const config={host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'};
test('Disposable MySQL functions: typed scalar returns, native pending data, replacement and explicit recovery',{timeout:60000},async t=>{
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),base='MBT_'+randomBytes(6).toString('hex'),name=base+'_fn',table=base+'_data',schema='mb_test',q=n=>'`'+n.replaceAll('`','``')+'`';
  const source=(body='RETURN p+1',type='DECIMAL(30,8)',parameter='p DECIMAL(30,8)')=>`CREATE FUNCTION ${q(schema)}.${q(name)}(${parameter}) RETURNS ${type} DETERMINISTIC SQL SECURITY INVOKER ${body}`;
  const change=(operation,sql,fingerprint)=>c.mutateFunction({schema,name,source:sql,operation,fingerprint});
  const replace=async sql=>{const before=await c.getFunction({schema,name});return change('replace',sql,before.fingerprint);};
  const call=async(args={p:'41'})=>{const before=await c.getFunction({schema,name});return c.executeStored({schema,objectName:name,objectType:'FUNCTION',args,mysqlFingerprint:before.fingerprint});};
  try{
    await c.connect(config);await c.execute(`CREATE TABLE ${q(table)}(id INT PRIMARY KEY,amount DECIMAL(30,8)) ENGINE=InnoDB`);
    await t.test('Create and read native function metadata without exposing the return row as an input',async()=>{
      const r=await change('create',source());assert.equal(r.success,true,r.error);assert.equal(r.routine.kind,'FUNCTION');assert.equal(r.routine.returnType,'decimal(30,8)');assert.deepEqual(r.routine.parameters.map(p=>[p.name,p.direction]),[['p','IN']]);assert.equal(r.routine.security,'INVOKER');assert.ok(r.routine.native.includes('RETURNS'));
    });
    await t.test('A function returns exact decimals and NULL using the dedicated main-session invocation',async()=>{
      assert.equal((await call({p:'1234567890123456789012.12345678'})).returnValues[0].value,'1234567890123456789013.12345678');assert.equal((await call({p:''})).returnValues[0].value,null);assert.equal(c.getMainTransactionState(),false);
    });
    await t.test('Functions see uncommitted rows while metadata and evaluation preserve native transaction state',async()=>{
      assert.equal((await replace(source(`BEGIN DECLARE v DECIMAL(30,8); SELECT amount INTO v FROM ${q(table)} WHERE id=p; RETURN v; END`))).success,true);await c.execute(`INSERT INTO ${q(table)} VALUES(1,25.125)`);assert.equal((await call({p:'1'})).returnValues[0].value,'25.12500000');assert.equal(c.getMainTransactionState(),true);await c.getFunction({schema,name});assert.equal(c.getMainTransactionState(),true);assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${q(table)}`,{},null,false,true)).rows[0].n,'0');await c.rollback();assert.equal((await call({p:'1'})).returnValues[0].value,null);
    });
    await t.test('A function with DML remains pending and Rollback undoes only its current transaction',async()=>{
      const r=await replace(source(`BEGIN INSERT INTO ${q(table)} VALUES(p,p); RETURN p; END`));assert.equal(r.success,true,r.error);assert.equal((await call({p:'5'})).returnValues[0].value,'5.00000000');assert.equal(c.getMainTransactionState(),true);await c.rollback();assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${q(table)}`)).rows[0].n,'0');
    });
    await t.test('A failing function is not replayed or followed by an application-wide rollback',async()=>{
      const r=await replace(source("BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='expected function failure'; RETURN p; END"));assert.equal(r.success,true,r.error);await c.execute(`INSERT INTO ${q(table)} VALUES(8,8)`);await assert.rejects(()=>call(),/expected function failure/);assert.equal(c.getMainTransactionState(),true);assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${q(table)} WHERE id=8`)).rows[0].n,'1');await c.rollback();
    });
    await t.test('Readonly and stale fingerprints reject execution without changing the function',async()=>{
      const before=await c.getFunction({schema,name});await assert.rejects(()=>c.executeStored({schema,objectName:name,objectType:'FUNCTION',args:{p:'1'},mysqlFingerprint:'stale'}),/changed/);c.readonly=true;await assert.rejects(call,/writable/);await assert.rejects(()=>change('drop','',before.fingerprint),/writable/);c.readonly=false;assert.equal((await c.getFunction({schema,name})).fingerprint,before.fingerprint);
    });
    await t.test('Replacement preserves native security, mode and definer and uses the actual DDL implicit commit',async()=>{
      const before=await c.getFunction({schema,name});await c.execute(`INSERT INTO ${q(table)} VALUES(9,9)`);const r=await change('replace',source('RETURN p+2'),before.fingerprint);assert.equal(r.success,true,r.error);for(const key of ['security','definer','mode','charset','collation'])assert.equal(r.routine[key],before[key]);assert.equal(c.getMainTransactionState(),false);await c.rollback();assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${q(table)} WHERE id=9`)).rows[0].n,'1');
    });
    await t.test('Server compilation failure retains the original source for explicit recovery',async()=>{
      const before=await c.getFunction({schema,name}),r=await change('replace',source('RETURN p+'),before.fingerprint);assert.equal(r.success,false);assert.equal(r.stage,'dropped');assert.ok(r.recovery.sql.includes('RETURN p+2'));await assert.rejects(()=>c.getFunction({schema,name}));
      const wrong=await c.mutateProcedure({schema,name,source:'',operation:'restore',recoveryToken:r.recovery.token});assert.equal(wrong.success,false);assert.equal(wrong.applied,false);
      const restored=await c.mutateFunction({schema,name,source:'',operation:'restore',recoveryToken:r.recovery.token});assert.equal(restored.success,true,restored.error);assert.equal(restored.routine.source,before.source);
    });
    await t.test('Unsafe or mismatched definitions fail before DROP and retain pending work',async()=>{
      const before=await c.getFunction({schema,name});await c.execute(`INSERT INTO ${q(table)} VALUES(10,10)`);
      for(const sql of [source('RETURN p; DROP TABLE nope'),source('BEGIN COMMIT; RETURN p; END'),source().replace('RETURNS','SONAME'),source().replace(q(name),q('other'))]){const r=await change('replace',sql,before.fingerprint);assert.equal(r.success,false);assert.equal(r.applied,false);assert.equal(c.getMainTransactionState(),true);}
      assert.equal((await c.getFunction({schema,name})).source,before.source);await c.rollback();
    });
    await t.test('String returns preserve Unicode and escaped input as data',async()=>{
      const r=await replace(source('RETURN CONCAT(p,\' ✓\')','VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci','p VARCHAR(100)'));assert.equal(r.success,true,r.error);assert.equal((await call({p:"日本語'); DROP TABLE x; --"})).returnValues[0].value,"日本語'); DROP TABLE x; -- ✓");
    });
    await t.test('Date returns and binary returns retain their exact native values',async()=>{
      const date=await replace(source('RETURN p','DATETIME(6)','p DATETIME(6)'));assert.equal(date.success,true,date.error);assert.equal((await call({p:'2026-11-14 12:30:40.123456'})).returnValues[0].value,'2026-11-14 12:30:40.123456');const binary=await replace(source("RETURN X'00FF10'",'VARBINARY(3)',''));assert.equal(binary.success,true,binary.error);assert.equal((await call({})).returnValues[0].value,'00ff10');
    });
    await t.test('Delete requires the fresh fingerprint and removes only the selected function',async()=>{const info=await c.getFunction({schema,name});assert.equal((await change('drop','',info.fingerprint)).success,true);await assert.rejects(()=>c.getFunction({schema,name}));});
  }finally{try{await c.rollback();await c.main.promise().query(`DROP FUNCTION IF EXISTS ${q(name)}`);await c.execute(`DROP TABLE IF EXISTS ${q(table)}`);}finally{await c.disconnect();}}
});
