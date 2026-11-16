// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');
const Client=require('../../electron/mysql/mysqlClient');
test('Disposable MySQL triggers: compound execution, native order, safe replacement/recovery and transaction state',{timeout:60000},async t=>{
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),base='MBT_'+randomBytes(6).toString('hex'),table=base+'_table',names=['a','b','c'].map(n=>base+'_'+n);const q=n=>'`'+n+'`';
  const form=(name,body)=>({schema:'mb_test',table,name,timing:'BEFORE',event:'INSERT',body});
  try{
    await c.connect({dbType:'mysql',host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});
    await c.execute(`CREATE TABLE ${q(table)} (id INT PRIMARY KEY,label VARCHAR(100)) ENGINE=InnoDB`);
    await t.test('Create row triggers, including compound IF/CASE/loop bodies, and preserve rollback',async()=>{
      for(let i=0;i<names.length;i++){const result=await c.mutateTrigger({...form(names[i],i===1?"BEGIN DECLARE i INT DEFAULT 0; WHILE i<2 DO SET i=i+1; END WHILE; IF NEW.id>0 THEN SET NEW.label=CONCAT(NEW.label,CASE i WHEN 2 THEN 'B' ELSE '?' END); END IF; END":`SET NEW.label=CONCAT(NEW.label,'${'ABC'[i]}')`),operation:'create'});assert.equal(result.success,true,result.error);assert.equal(result.trigger.order,i+1);}
      await c.execute(`INSERT INTO ${q(table)} VALUES(1,'')`);assert.equal((await c.execute(`SELECT label FROM ${q(table)}`)).rows[0].label,'ABC');assert.equal(c.getMainTransactionState(),true);
      const info=await c.getTrigger({schema:'mb_test',name:names[1]});assert.deepEqual(info.peers,names);assert.ok(info.native.includes('DEFINER'));assert.equal(c.getMainTransactionState(),true);await c.rollback();assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${q(table)}`)).rows[0].n,'0');
    });
    await t.test('Replacing the middle trigger keeps its execution position, definer, mode and character settings',async()=>{
      const before=await c.getTrigger({schema:'mb_test',name:names[1]});const result=await c.mutateTrigger({...form(names[1],"SET NEW.label=CONCAT(NEW.label,'X')"),operation:'replace',fingerprint:before.fingerprint});assert.equal(result.success,true,result.error);assert.equal(result.trigger.order,2);assert.equal(result.trigger.mode,before.mode);assert.equal(result.trigger.definer,before.definer);assert.equal(result.trigger.collation,before.collation);
      await c.execute(`INSERT INTO ${q(table)} VALUES(2,'')`);assert.equal((await c.execute(`SELECT label FROM ${q(table)}`)).rows[0].label,'AXC');await c.rollback();
    });
    await t.test('A changed fingerprint is refused before DDL and retains pending work',async()=>{
      await c.execute(`INSERT INTO ${q(table)} VALUES(3,'')`);const result=await c.mutateTrigger({...form(names[1],"SET NEW.label='wrong'"),operation:'replace',fingerprint:'stale'});assert.equal(result.success,false);assert.equal(result.applied,false);assert.equal(c.getMainTransactionState(),true);await c.rollback();
    });
    await t.test('A failed replacement reports the missing trigger and only explicit recovery restores the original order',async()=>{
      const before=await c.getTrigger({schema:'mb_test',name:names[1]});await c.execute(`INSERT INTO ${q(table)} VALUES(4,'')`);
      const result=await c.mutateTrigger({...form(names[1],'BEGIN SET NEW.no_such_column=1; END'),operation:'replace',fingerprint:before.fingerprint});assert.equal(result.success,false);assert.equal(result.stage,'dropped');assert.equal(result.applied,true);assert.ok(result.recovery);assert.equal(c.getMainTransactionState(),false);
      await assert.rejects(()=>c.getTrigger({schema:'mb_test',name:names[1]}));await c.rollback();assert.equal((await c.execute(`SELECT COUNT(*) n FROM ${q(table)} WHERE id=4`)).rows[0].n,'1');
      const restored=await c.mutateTrigger({schema:'mb_test',name:names[1],operation:'restore',recoveryToken:result.recovery.token});assert.equal(restored.success,true,restored.error);assert.equal(restored.trigger.order,2);assert.equal(restored.trigger.body,before.body);
      const repeated=await c.mutateTrigger({schema:'mb_test',name:names[1],operation:'restore',recoveryToken:result.recovery.token});assert.equal(repeated.success,false);
    });
    await t.test('Readonly, wrong-table and unsupported body attempts fail without changing the original',async()=>{
      const before=await c.getTrigger({schema:'mb_test',name:names[1]});for(const next of [{table:'other_table'},{body:'BEGIN SET NEW.label=1; END; DROP TABLE something'},{body:"BEGIN SELECT LOAD_FILE('/tmp/x'); END"}]){const r=await c.mutateTrigger({...form(names[1],before.body),operation:'replace',fingerprint:before.fingerprint,...next});assert.equal(r.success,false);assert.equal(r.stage,'unchanged');}
      c.readonly=true;await assert.rejects(()=>c.mutateTrigger({...form(names[1],before.body),operation:'replace',fingerprint:before.fingerprint}),/writable/);c.readonly=false;
      assert.equal((await c.getTrigger({schema:'mb_test',name:names[1]})).fingerprint,before.fingerprint);
    });
    await t.test('The actual controller records native source in isolated Git and never commits a local draft',async()=>{
      const {createGitRepository}=require('../helpers/gitRepository.cjs'),{mysqlTrigger}=require('../helpers/mysqlTrigger.cjs'),{loadTypeScript}=require('../helpers/loadTypeScript.cjs');
      const fs=require('node:fs'),path=require('node:path'),{sourceFileName}=require('../../electron/services/gitSourceNames'),repo=await createGitRepository(t),extra=base+'_git';let f;
      const invoke=async(channel,request,binds)=>{if(channel.startsWith('git-'))return repo.invoke(channel,request);if(channel==='get-mysql-trigger')return {success:true,trigger:await c.getTrigger(request)};if(channel==='mutate-mysql-trigger')return {...await c.mutateTrigger(request),...c.getTransactionDetails()};if(channel==='execute-sql-bg')return {success:true,...await c.execute(request,binds,null,false,true)};throw new Error('Unexpected trigger IPC.');};
      try{
        f=await mysqlTrigger(invoke,{initialTable:table});f.state.update({...form(extra,"SET NEW.label=CONCAT(NEW.label,'G')")});await f.flush();f.state.prepare();await f.flush();assert.ok(f.state.review);assert.equal((await repo.git.log().catch(()=>({total:0}))).total,0);
        await f.state.execute();await f.flush();assert.equal(f.state.error,'');const object=f.changes[0],file=path.join(repo.repo,'MonaBase','MYSQL','mb_test','TRIGGER','.objects-v2',sourceFileName(extra));
        const sources=loadTypeScript('src/features/objects/mysqlObjects.ts',{'@/shared/api/desktop':{ipcRenderer:{invoke}}});assert.equal(fs.readFileSync(file,'utf8'),(await sources.loadMysqlReference(object)).definition);assert.equal((await repo.git.log()).total,1);
        f.props.object=object;await f.waitFor(s=>!s.loading&&s.details);f.state.update({body:"SET NEW.label='local draft'"});await f.flush();assert.ok(!fs.readFileSync(file,'utf8').includes('local draft'));
        f.state.prepare('drop');await f.flush();await f.state.execute();await f.flush();assert.equal(f.changes.at(-1),'drop');assert.equal(fs.existsSync(file),false);assert.equal((await repo.git.log()).total,2);
      }finally{f?.unmount();await c.main.promise().query(`DROP TRIGGER IF EXISTS ${q(extra)}`);}
    });
    await t.test('Reviewed deletion removes only the exact trigger',async()=>{
      const info=await c.getTrigger({schema:'mb_test',name:names[1]});const r=await c.mutateTrigger({schema:'mb_test',name:names[1],operation:'drop',fingerprint:info.fingerprint});assert.equal(r.success,true,r.error);await assert.rejects(()=>c.getTrigger({schema:'mb_test',name:names[1]}));assert.ok(await c.getTrigger({schema:'mb_test',name:names[0]}));
    });
  }finally{c.readonly=false;await c.rollback().catch(()=>{});if(c.main){for(const name of names)await c.main.promise().query(`DROP TRIGGER IF EXISTS ${q(name)}`);await c.main.promise().query(`DROP TABLE IF EXISTS ${q(table)}`);}await c.disconnect();}
});
