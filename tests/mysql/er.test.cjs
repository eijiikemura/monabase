// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {randomBytes}=require('node:crypto');
const MysqlClient=require('../../electron/mysql/mysqlClient');
const {mysqlEr}=require('../helpers/mysqlEr.cjs');
const {createGitRepository}=require('../helpers/gitRepository.cjs');
const {registerErHandlers}=require('../../electron/ipc/er');
const {loadTypeScript}=require('../helpers/loadTypeScript.cjs');
const {quoteMysql:q}=loadTypeScript('src/features/mysql/table/tableModel.ts');
test('Disposable MySQL ER: native composite keys, views, reviewed synchronization and real isolated Git history', {timeout:60000},async t=>{
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');
  const repo=await createGitRepository(t),handlers=new Map();registerErHandlers({ipcMain:{handle:(channel,fn)=>handlers.set(channel,fn)},gitDirectory:repo.repo,t:key=>key,createGit:()=>repo.client(repo.repo)});
  const client=new MysqlClient(),other=new MysqlClient(),base='MBT_'+randomBytes(6).toString('hex'),parent=base+'_p',child=base+'_c',grand=base+'_g',view=base+'_v';let f;
  const config={dbType:'mysql',host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'};
  const object=(name,category='TABLE')=>({key:name,dbType:'mysql',schema:'mb_test',category,name,displayName:name});
  try{
    await client.connect(config);await other.connect(config);
    await client.execute(`CREATE TABLE ${q(parent)} (tenant INT,id BIGINT UNSIGNED,label ENUM('low','HIGH') COMMENT 'Logical label',amount DECIMAL(30,8),PRIMARY KEY(tenant,id)) ENGINE=InnoDB COMMENT='Fictional parent'`);
    await client.execute(`CREATE TABLE ${q(child)} (tenant INT,id BIGINT UNSIGNED,CONSTRAINT ${q(base+'_fk')} FOREIGN KEY(tenant,id) REFERENCES ${q(parent)}(tenant,id),PRIMARY KEY(tenant,id)) ENGINE=InnoDB`);
    await client.execute(`CREATE TABLE ${q(grand)} (tenant INT,id BIGINT UNSIGNED,FOREIGN KEY(tenant,id) REFERENCES ${q(child)}(tenant,id)) ENGINE=InnoDB`);
    await client.main.promise().query(`CREATE VIEW ${q(view)} AS SELECT tenant,id,label FROM ${q(parent)}`);
    await client.execute(`INSERT INTO ${q(parent)} VALUES(1,7,'low',1.25)`);await client.commit();await client.execute(`INSERT INTO ${q(child)} VALUES(1,7)`);
    f=await mysqlEr(async(channel,sql,binds)=>{
      if(handlers.has(channel))return handlers.get(channel)(null,sql);
      if(channel==='git-status-check')return repo.invoke(channel);
      if(channel==='get-schemas')return {success:true,schemas:['mb_test']};
      assert.equal(channel,'execute-sql-bg');try{return {success:true,...await client.execute(sql,binds,null,false,true)};}catch(error){return {success:false,error:error.message};}
    });
    await f.waitFor(s=>!s.isLoading);
    await t.test('Automatic ER shows only direct neighbors with one composite relation and exact physical/logical metadata',async()=>{
      const diagram=await f.diagram('mysql','mb_test',parent,true,true,false);
      assert.deepEqual(Array.from(diagram.nodes,node=>node.id).sort(),[parent,child].sort());assert.equal(diagram.edges.length,1);assert.equal(diagram.edges[0].data.isIdentifying,true);
      const p=diagram.nodes.find(node=>node.id===parent);assert.equal(p.data.tableComment,'Fictional parent');assert.equal(p.data.columns.find(c=>c.name==='label').type,"enum('low','HIGH')");assert.equal(p.data.columns.find(c=>c.name==='id').type,'bigint unsigned');assert.equal(p.data.columns.find(c=>c.name==='amount').type,'decimal(30,8)');assert.equal(p.data.columns.find(c=>c.name==='label').comment,'Logical label');
      assert.equal(client.getMainTransactionState(),true);assert.equal((await other.execute(`SELECT COUNT(*) n FROM ${q(child)}`)).rows[0].n,'0');await other.rollback();
    });
    await t.test('Custom table/view placement and virtual relations save and reload under MYSQL with a real commit',async()=>{
      f.state.handleCreateNewCustomEr();await f.waitFor(s=>s.isLocalRepo);f.state.setErDiagramName(base);await f.flush();await f.state.handleAddObjectsToCustomCanvas([object(parent),object(view,'VIEW')]);await f.flush();assert.equal(f.state.customNodes.length,2);
      f.state.handleOpenAddRelationDialog();await f.flush();f.state.handleSaveRelation();await f.flush();assert.equal(f.state.customEdges.length,1);f.state.setCommitMessage('Create MySQL ER diagram');await f.flush();await f.state.handleCommit();await f.waitFor(s=>s.historyList.length===1);
      const saved=path.join(repo.repo,'MonaBase','MYSQL','ErDiagram',base+'.json');assert.equal(JSON.parse(fs.readFileSync(saved,'utf8')).schema,'mb_test');assert.equal(f.state.historyList.length,1,f.alerts.join('\n'));assert.equal(client.getMainTransactionState(),true);
      f.state.handleCloseCustomEr();await f.flush();await f.state.handleOpenCustomEr(base+'.json');await f.flush();assert.equal(f.state.customNodes.length,2);assert.equal(f.state.customEdges.length,1);assert.equal(f.state.customNodes.find(node=>node.id===parent).data.tableComment,'Fictional parent');
    });
    await t.test('Schema sync is reviewed, preserves virtual edges and pending DML, and Git comparison/restoration is undoable',async()=>{
      await client.rollback();await client.execute(`ALTER TABLE ${q(parent)} ADD COLUMN sync_value VARCHAR(30)`);await client.execute(`INSERT INTO ${q(child)} VALUES(1,7)`);
      await f.state.handleSyncWithDatabase();await f.flush();assert.ok(f.state.syncPreview,f.alerts.join('\n'));assert.ok(!f.state.customNodes.find(node=>node.id===parent).data.columns.some(c=>c.name==='sync_value'));
      f.state.handleApplySync();await f.flush();assert.ok(f.state.customNodes.find(node=>node.id===parent).data.columns.some(c=>c.name==='sync_value'));assert.equal(f.state.customEdges.length,1);assert.equal(client.getMainTransactionState(),true);
      f.state.setCommitMessage('Refresh MySQL ER metadata');await f.flush();await f.state.handleCommit();await f.waitFor(s=>s.historyList.length===2);assert.equal(f.state.historyList.length,2);
      await f.state.handleOpenCompareMode();await f.flush();await f.state.handleHistoryRowClick({row:f.state.historyList[1]});await f.flush();assert.equal(f.state.canRestoreHistory,true,f.alerts.join('\n'));f.state.handleRestorePastVersion();await f.flush();assert.ok(!f.state.customNodes.find(node=>node.id===parent).data.columns.some(c=>c.name==='sync_value'));
      f.state.handleUndo();await f.flush();assert.ok(f.state.customNodes.find(node=>node.id===parent).data.columns.some(c=>c.name==='sync_value'));
      assert.ok(!f.calls.some(call=>['execute-sql','commit-db','rollback-db'].includes(call[0])));await client.rollback();assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${q(child)}`)).rows[0].n,'0');
    });
  }finally{
    f?.unmount();await client.rollback().catch(()=>{});await other.rollback().catch(()=>{});await client.main?.promise().query(`DROP VIEW IF EXISTS ${q(view)}`).catch(()=>{});for(const name of[grand,child,parent])await client.execute(`DROP TABLE IF EXISTS ${q(name)}`).catch(()=>{});await client.disconnect();await other.disconnect();
  }
});
