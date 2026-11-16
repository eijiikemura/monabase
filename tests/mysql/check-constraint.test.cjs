// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');const Client=require('../../electron/mysql/mysqlClient');const {loadTypeScript}=require('../helpers/loadTypeScript.cjs');
test('Disposable MySQL CHECK window: native source, enforcement, atomic rename, DDL commit and safe failures',{timeout:60000},async t=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),table='MBT_'+randomBytes(6).toString('hex')+'_check',q='`'+table+'`',schema='mb_test',name=table+'_positive',renamed=name+'_new';
 const dependencies={'@/shared/api/desktop':{ipcRenderer:{invoke:async(channel,sql,binds)=>{assert.equal(channel,'execute-sql-bg');return {success:true,...await c.execute(sql,binds,null,false,true)};}}}};
 const model=loadTypeScript('src/features/mysql/constraint/checkModel.ts',{}, {Error}),repo=loadTypeScript('src/features/mysql/constraint/checkRepository.ts',dependencies,{Error});
 const run=(form,details,old,drop=false)=>c.execute(model.checkStatement(schema,table,form,details,old,drop).sql);
 const read=(n=name)=>repo.loadMysqlCheck(schema,table,n);let form={name,condition:"amount >= 0 AND label <> 'a,b)'",enforced:true};
 try{
 await c.connect({host:'127.0.0.1',port:'13306',database:schema,user:'test',password:'test'});await c.execute(`CREATE TABLE ${q}(id INT PRIMARY KEY,amount DECIMAL(12,3),label VARCHAR(80)) ENGINE=InnoDB`);
 await t.test('Creating a reviewed CHECK implicitly commits pending main rows; metadata reads do not',async()=>{await c.execute(`INSERT INTO ${q} VALUES(1,1.25,'日本語')`);assert.equal(c.getMainTransactionState(),true);await run(form);assert.equal(c.getMainTransactionState(),false);await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM '+q)).rows[0].n,'1');const d=await read();assert.equal(d.enforced,true);assert.match(d.condition,/amount/);assert.match(d.condition,/a,b\)/);});
 await t.test('Enforced CHECK rejects invalid DML while a not-enforced CHECK allows it and can be rolled back',async()=>{
 await assert.rejects(()=>c.execute(`INSERT INTO ${q} VALUES(2,-1,'bad')`),/check/i);
 let d=await read();form={name,condition:d.condition,enforced:false};await run(form,d,name);assert.equal((await read()).enforced,false);
 await c.execute(`INSERT INTO ${q} VALUES(2,-1,'temporary')`);await read();assert.equal(c.getMainTransactionState(),true);await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM '+q+' WHERE id=2')).rows[0].n,'0');
 });
 await t.test('Re-enforcement fails on committed invalid rows, retains NOT ENFORCED and never resends automatically',async()=>{
 await c.execute(`INSERT INTO ${q} VALUES(3,-1,'invalid')`);await c.commit();const d=await read();await assert.rejects(()=>run({...form,enforced:true},d,name),/check/i);assert.equal((await read()).enforced,false);await c.execute(`DELETE FROM ${q} WHERE id=3`);await c.commit();const now=await read();form={...form,enforced:true};await run(form,now,name);assert.equal((await read()).enforced,true);
 });
 await t.test('Renaming uses one native ALTER, preserves the condition and rejects stale target identities',async()=>{
 const d=await read();form={name:renamed,condition:d.condition,enforced:true};await run(form,d,name);await assert.rejects(()=>read(name),/unavailable/);assert.equal((await read(renamed)).condition,d.condition);
 const current=await read(renamed);assert.throws(()=>model.checkStatement(schema,table,{...form,condition:'amount < 0'},current,renamed),/read only/);
 });
 await t.test('A failed rename to an existing CHECK leaves both original definitions intact',async()=>{
 const other=name+'_other';await run({name:other,condition:'id > 0',enforced:true});const d=await read(renamed);
 await assert.rejects(()=>run({...form,name:other},d,renamed));assert.equal((await read(renamed)).condition,d.condition);assert.equal((await read(other)).enforced,true);
 });
 await t.test('Exact native identity, quoted names and deletion preserve unrelated CHECKs',async()=>{
 const odd=name+'_`odd';await run({name:odd,condition:'id <> 0',enforced:false});const d=await read(odd);assert.equal(d.enforced,false);assert.match(d.definition,/``odd/);await run({name:odd,condition:d.condition,enforced:false},d,odd,true);await assert.rejects(()=>read(odd),/unavailable/);assert.equal((await read(renamed)).enforced,true);
 });
 }finally{try{await c.rollback();await c.execute('DROP TABLE IF EXISTS '+q);}finally{await c.disconnect();}}
});
