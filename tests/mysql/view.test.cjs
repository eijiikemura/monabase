// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');
const {sourceFileName}=require('../../electron/services/gitSourceNames');
const fs=require('node:fs');const path=require('node:path');
const MysqlClient=require('../../electron/mysql/mysqlClient');
const {loadTypeScript}=require('../helpers/loadTypeScript.cjs');
const {viewModules,mysqlView}=require('../helpers/mysqlView.cjs');
const {createGitRepository}=require('../helpers/gitRepository.cjs');

test('Disposable MySQL views: native definitions, main-session data, reviewed DDL, real Git and safe dependency/pagination handling',{timeout:90000},async t=>{
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');
  const git=await createGitRepository(t),client=new MysqlClient(),other=new MysqlClient(),token='MBT_'+randomBytes(6).toString('hex'),table=token+'_table',view=token+'_view',child=token+'_child',odd=token+'.`日本語';const views=new Set();let f;
  const q=name=>'`'+name.replaceAll('`','``')+'`';
  const object=name=>({key:JSON.stringify(['mysql','mb_test','VIEW',name]),dbType:'mysql',schema:'mb_test',name,displayName:name,category:'VIEW'});
  const invoke=async(channel,sql,binds={},schema)=>{
    if(channel.startsWith('git-'))return git.invoke(channel,sql);
    try{return {success:true,...await client.execute(sql,binds,schema,null,channel==='execute-sql-bg'),...(channel==='execute-sql'?client.getTransactionDetails():{})};}
    catch(error){return {success:false,error:error.message,...(channel==='execute-sql'?client.getTransactionDetails():{})};}
  };
  const deps={'@/shared/api/desktop':{ipcRenderer:{invoke}}},{repository}=viewModules(invoke),listing=loadTypeScript('src/features/objects/mysqlObjects.ts',deps),tableRepo=loadTypeScript('src/features/mysql/table/tableRepository.ts',deps),model=loadTypeScript('src/features/mysql/table/tableModel.ts');
  try{
    const config={dbType:'mysql',host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'};
    await client.connect(config);await other.connect(config);
    await client.execute(`CREATE TABLE ${q(table)}(id INT PRIMARY KEY,label VARCHAR(100),amount DECIMAL(30,8),stamp DATETIME(6)) ENGINE=InnoDB`);
    await client.execute(`CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW ${q(view)} AS SELECT id,label,amount,stamp FROM ${q(table)} WHERE id>0 WITH CASCADED CHECK OPTION`);views.add(view);
    await client.execute(`CREATE VIEW ${q(child)} AS SELECT id,label FROM ${q(view)}`);views.add(child);
    await client.execute(`CREATE VIEW ${q(odd)} AS SELECT id FROM ${q(table)}`);views.add(odd);
    await t.test('Exact metadata preserves security/check settings, columns, references/dependents and pending rows',async()=>{
      await client.execute(`INSERT INTO ${q(table)} VALUES(1,'pending',12345678901234567890.12345678,'2026-11-13 12:34:56.123456')`);
      const info=await repository.loadMysqlView(object(view));assert.equal(info.settings.SECURITY_TYPE,'INVOKER');assert.equal(info.settings.CHECK_OPTION,'CASCADED');assert.ok(info.source.includes('CREATE OR REPLACE ALGORITHM=MERGE'));assert.ok(info.source.includes('`mb_test`.'+q(view)));assert.equal(info.metadata.columns[2].type,'decimal(30,8)');assert.ok(info.metadata.references.some(item=>item.name===table));assert.ok(info.metadata.dependents.some(item=>item.name===child));
      assert.equal(client.getMainTransactionState(),true);assert.equal((await other.execute(`SELECT COUNT(*) n FROM ${q(table)}`)).rows[0].n,'0');await other.rollback();
      const quoted=await repository.loadMysqlView(object(odd));assert.ok(quoted.source.includes(q(odd)));
    });
    await t.test('View data and filtered complete export use the main session, exact decimal/date values and native read-only identity',async()=>{
      const meta=await tableRepo.loadTableMetadata('mb_test',view);assert.equal(meta.table.TABLE_TYPE,'VIEW');assert.equal(model.canEditTable(meta),false);
      const filters=model.defaultConditions(meta.columns);filters.id.value='1';filters.id.sort='1 DESC';const statement=model.tableQuery('mb_test',view,meta.columns,filters,0,100);
      const rows=(await client.execute(statement.sql,statement.binds)).rows;assert.equal(rows[0].amount,'12345678901234567890.12345678');assert.equal(rows[0].stamp,'2026-11-13 12:34:56.123456');
      const transfer=loadTypeScript('src/features/mysql/sidebarDataTransfer.ts',{...deps,'@/features/data-grid/dataGridHelper':{},'@/features/table/importData':{},'./table/tableRepository':tableRepo,'./table/tableModel':model});
      const states=[],fetch=transfer.createMysqlSidebarExport('mb_test',view,meta,rows=>rows,state=>states.push(state),()=>{},filters);
      const first=await fetch(0,1),second=await fetch(1,1);assert.equal(first.length,1);assert.equal(second.length,0);assert.equal(first[0].label,'pending');assert.equal(states.at(-1).hasUncommittedTx,true);await fetch.close();
      await client.rollback();assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${q(view)}`)).rows[0].n,'0');
    });
    await t.test('Dependent views block deletion and a changed review never sends SQL or auto-retries',async()=>{
      f=await mysqlView(invoke,{object:object(view)});await f.waitFor(s=>!s.loading&&s.details);f.state.prepare(true);await f.flush();assert.equal(f.state.review,undefined);assert.equal(f.state.error,'mysql_view_dependents_blocked');
      f.state.setText(f.state.text.replace('where','WHERE'));await f.flush();f.state.prepare();await f.flush();assert.ok(f.state.review);
      await client.execute(`CREATE OR REPLACE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW ${q(view)} AS SELECT id,label,amount,stamp FROM ${q(table)} WHERE id>=1 WITH LOCAL CHECK OPTION`);
      const before=f.calls.filter(call=>call[0]==='execute-sql').length;await f.state.execute();await f.flush();assert.equal(f.state.error,'mysql_view_changed_reload');await f.state.execute();assert.equal(f.calls.filter(call=>call[0]==='execute-sql').length,before);f.unmount();f=undefined;
    });
    await t.test('Successful compile preserves native semantics, commits pending DML, refreshes columns and records only actual DB source in Git',async()=>{
      await client.execute(`DROP VIEW ${q(child)}`);views.delete(child);
      f=await mysqlView(invoke,{object:object(view)});await f.waitFor(s=>!s.loading&&s.details);
      f.state.setText(`CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW mb_test.${q(view)} AS SELECT id,label,amount,stamp,amount*2 AS doubled FROM ${q(table)} WHERE id>=1 WITH LOCAL CHECK OPTION`);await f.flush();
      await client.execute(`INSERT INTO ${q(table)} VALUES(2,'compile',1.25,'2026-11-13 00:00:00')`);f.state.prepare();await f.flush();assert.ok(f.state.review);assert.equal(client.getMainTransactionState(),true);
      await f.state.execute();await f.flush();assert.equal(f.state.error,'');assert.equal(f.state.details.settings.SECURITY_TYPE,'INVOKER');assert.equal(f.state.details.settings.CHECK_OPTION,'LOCAL');assert.ok(f.state.details.metadata.columns.some(column=>column.name==='doubled'));assert.equal(f.states.at(-1).hasUncommittedTx,false);assert.equal(f.state.dataRevision,1);
      const source=fs.readFileSync(path.join(git.repo,'MonaBase','MYSQL','mb_test','VIEW','.objects-v2',sourceFileName(view)),'utf8');assert.equal(source,f.state.details.native);assert.equal((await git.git.log()).total,1);
      await client.rollback();assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${q(view)}`)).rows[0].n,'1');
    });
    await t.test('A native compile error is shown once and successful drop removes the owned view and Git definition',async()=>{
      f.state.setText(`CREATE VIEW mb_test.${q(view)} AS SELECT missing_column FROM ${q(table)}`);await f.flush();f.state.prepare();await f.flush();const before=f.calls.filter(call=>call[0]==='execute-sql').length;await f.state.execute();await f.flush();assert.match(f.state.error,/missing_column/);await f.state.execute();assert.equal(f.calls.filter(call=>call[0]==='execute-sql').length,before+1);
      await f.state.load();await f.flush();f.state.prepare(true);await f.flush();await f.state.execute();await f.flush();assert.deepEqual(f.changes,['drop']);views.delete(view);assert.equal(fs.existsSync(path.join(git.repo,'MonaBase','MYSQL','mb_test','VIEW','.objects-v2',sourceFileName(view))),false);assert.equal((await git.git.log()).total,2);f.unmount();f=undefined;
    });
    await t.test('View category pages 101 native views as 100+1 and rejects the wrong-case database',async()=>{
      for(let i=0;i<101;i++){const name=token+'_page_'+String(i).padStart(3,'0');await client.execute(`CREATE VIEW ${q(name)} AS SELECT id FROM ${q(table)}`);views.add(name);}
      const a=await listing.listMysqlObjects('mb_test','VIEW',token+'_page_',0),b=await listing.listMysqlObjects('mb_test','VIEW',token+'_page_',100);assert.equal(a.length,100);assert.equal(b.length,1);assert.equal(new Set([...a,...b].map(row=>row.key)).size,101);assert.equal((await listing.listMysqlObjects('MB_TEST','VIEW',token,0)).length,0);
    });
  }finally{
    f?.unmount();await client.rollback().catch(()=>{});await other.rollback().catch(()=>{});
    const failures=[];for(const name of [...views].reverse())try{await client.execute(`DROP VIEW IF EXISTS ${q(name)}`);}catch(error){failures.push(error.message);}
    try{await client.execute(`DROP TABLE IF EXISTS ${q(table)}`);}catch(error){failures.push(error.message);}await client.disconnect();await other.disconnect();assert.equal(failures.length,0,failures.join('\n'));
  }
});
