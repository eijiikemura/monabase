// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');const Client=require('../../electron/mysql/mysqlClient');const {loadTypeScript}=require('../helpers/loadTypeScript.cjs');
test('Disposable MySQL AUTO_INCREMENT management: live observations, exact counters, native DDL and rollback',{timeout:60000},async t=>{
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),other=new Client(),base='MBT_'+randomBytes(6).toString('hex'),table=base+'_ai',pending=base+'_pending',plain=base+'_plain',tiny=base+'_tiny',schema='mb_test',q=n=>'`'+n+'`';
  const model=loadTypeScript('src/features/mysql/table/tableModel.ts'),ddl=loadTypeScript('src/features/mysql/table/tableDdl.ts',{'./tableModel':model});const calls=[];
  const repository=loadTypeScript('src/features/mysql/table/tableRepository.ts',{'./tableModel':model,'@/shared/api/desktop':{ipcRenderer:{invoke:async(channel,sql,binds)=>{calls.push({channel,sql});try{return {success:true,...await c.execute(sql,binds,null,false,channel==='execute-sql-bg'),...(channel==='execute-sql'?c.getTransactionDetails():{})};}catch(error){return {success:false,error:error.message,...(channel==='execute-sql'?c.getTransactionDetails():{})};}}}}});
  const read=()=>repository.loadTableMetadata(schema,table);const statement=(metadata,value)=>ddl.buildTableDdl(schema,table,{action:'auto-increment',value},metadata);const config={host:'127.0.0.1',port:'13306',database:schema,user:'test',password:'test'};
  const run=async st=>{const r=await repository.executeTableStatement(st);assert.equal(r.success,true,r.error);return r;};
  try{
    await c.connect(config);await other.connect(config);await c.execute(`CREATE TABLE ${q(table)}(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,label VARCHAR(80),INDEX label(label) INVISIBLE) ENGINE=InnoDB COMMENT='AUTO_INCREMENT=999'`);await c.execute(`CREATE TABLE ${q(pending)}(id INT PRIMARY KEY) ENGINE=InnoDB`);await c.execute(`CREATE TABLE ${q(plain)}(id INT PRIMARY KEY) ENGINE=InnoDB`);await c.execute(`CREATE TABLE ${q(tiny)}(id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB`);
    await t.test('An initial counter is 1, even when the table comment contains a fake option',async()=>{const m=await read();assert.equal(m.table.AUTO_INCREMENT,'1');assert.equal(model.autoIncrementColumn(m).COLUMN_NAME,'id');assert.equal(model.autoIncrementMaximum(m.columns[0]),'18446744073709551615');});
    await t.test('Read-only background observations bypass cached values without committing pending main rows',async()=>{
      await c.execute(`INSERT INTO ${q(table)}(label) VALUES('pending')`);const before=calls.length;assert.equal((await read()).table.AUTO_INCREMENT,'2');assert.equal(c.getMainTransactionState(),true);assert.ok(calls.slice(before).every(c=>c.channel==='execute-sql-bg'));assert.equal((await other.execute(`SELECT COUNT(*) n FROM ${q(table)}`)).rows[0].n,'0');await other.rollback();await c.rollback();assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${q(table)}`)).rows[0].n,'0');assert.equal((await read()).table.AUTO_INCREMENT,'2');
    });
    await t.test('Counter changes implicitly commit pending DML; Rollback cannot undo that DDL or those committed rows',async()=>{
      const m=await read();await c.execute(`INSERT INTO ${q(pending)} VALUES(1)`);assert.equal(c.getMainTransactionState(),true);const changed=await run(statement(m,'100'));assert.equal(changed.hasUncommittedTx,false);await c.rollback();assert.equal((await other.execute(`SELECT COUNT(*) n FROM ${q(pending)}`)).rows[0].n,'1');await other.rollback();assert.equal((await read()).table.AUTO_INCREMENT,'100');await c.execute(`INSERT INTO ${q(table)}(label) VALUES('after change')`);assert.equal((await c.execute('SELECT LAST_INSERT_ID() n')).rows[0].n,'100');await c.rollback();assert.equal((await read()).table.AUTO_INCREMENT,'101');
    });
    await t.test('Existing IDs stay unchanged and a low requested counter is adjusted by MySQL',async()=>{
      await c.execute(`INSERT INTO ${q(table)}(id,label) VALUES(500,'existing')`);await c.commit();await run(statement(await read(),'2'));assert.equal((await read()).table.AUTO_INCREMENT,'501');assert.equal((await c.execute(`SELECT id FROM ${q(table)}`)).rows[0].id,'500');await c.rollback();
    });
    await t.test('Counters above Number.MAX_SAFE_INTEGER are read, changed and used without rounding',async()=>{
      await run(statement(await read(),'9007199254740993'));assert.equal((await read()).table.AUTO_INCREMENT,'9007199254740993');await c.execute(`INSERT INTO ${q(table)}(label) VALUES('large')`);assert.equal((await c.execute('SELECT LAST_INSERT_ID() n')).rows[0].n,'9007199254740993');await c.rollback();assert.equal((await read()).table.AUTO_INCREMENT,'9007199254740994');
    });
    await t.test('Missing auto columns and type overflow are refused before sending a committing statement',async()=>{
      await c.execute(`INSERT INTO ${q(pending)} VALUES(2)`);const m=await repository.loadTableMetadata(schema,plain);assert.equal(model.autoIncrementColumn(m),undefined);assert.throws(()=>statement(m,'100'));const small=await repository.loadTableMetadata(schema,tiny);assert.equal(model.autoIncrementMaximum(small.columns[0]),'255');assert.throws(()=>statement(small,'256'));assert.equal(c.getMainTransactionState(),true);await c.rollback();
    });
    await t.test('A read-only native connection refuses the ALTER without changing the counter',async()=>{
      const info=await read(),before=info.table.AUTO_INCREMENT,ro=new Client();try{await ro.connect({...config,readonly:true});await assert.rejects(()=>ro.execute(statement(info,'9007199254741999').sql),/read.only/i);}finally{await ro.disconnect();}assert.equal((await read()).table.AUTO_INCREMENT,before);
    });
  }finally{try{await c.rollback();await other.rollback();for(const name of [tiny,plain,pending,table])await c.execute(`DROP TABLE IF EXISTS ${q(name)}`);}finally{await c.disconnect();await other.disconnect();}}
});
