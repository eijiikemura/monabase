// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mysqlEr}=require('./helpers/mysqlEr.cjs');
function fixture(mode='custom'){
  let saved;
  return mysqlEr(async(channel,sql,binds)=>{
    if(channel==='get-schemas')return {success:true,schemas:['mb_test']};
    if(channel==='git-status-check')return {success:true,isRepo:false,remoteUrl:null};
    if(channel==='get-er-diagrams')return {success:true,files:[]};
    if(channel==='save-er-diagram'){assert.equal(sql.dbType,'MYSQL');saved=sql.sourceText;return {success:true,filePath:'fixture.json'};}
    if(channel==='load-er-diagram'){assert.equal(sql.dbType,'MYSQL');return {success:true,data:saved};}
    if(channel!=='execute-sql-bg')throw new Error('Unexpected ER IPC '+channel);
    const names=Object.entries(binds||{}).filter(([key])=>key.startsWith('n')).map(([,value])=>value),selected=names.length?names:['parent','child'];
    if(/AS OBJECT_NAME/.test(sql))return {success:true,rows:['parent','child'].map(OBJECT_NAME=>({OBJECT_NAME}))};
    if(/SELECT TABLE_NAME FROM/.test(sql))return {success:true,rows:selected.map(TABLE_NAME=>({TABLE_NAME}))};
    if(/MYSQL_COLUMN_TYPE/.test(sql))return {success:true,rows:selected.flatMap(TABLE_NAME=>[{TABLE_SCHEMA:'mb_test',TABLE_NAME,COLUMN_NAME:'id',DATA_TYPE:'bigint',MYSQL_COLUMN_TYPE:'bigint unsigned'},{TABLE_SCHEMA:'mb_test',TABLE_NAME,COLUMN_NAME:'label',DATA_TYPE:'enum',MYSQL_COLUMN_TYPE:"enum('low','HIGH')"}])};
    if(/CONSTRAINT_NAME='PRIMARY'/.test(sql))return {success:true,rows:selected.map(TABLE_NAME=>({TABLE_SCHEMA:'mb_test',TABLE_NAME,COLUMN_NAME:'id'}))};
    if(/REFERENCED_TABLE_NAME IS NOT NULL/.test(sql))return {success:true,rows:selected.includes('child')?[{CHILD_SCHEMA:'mb_test',CHILD_TABLE:'child',CHILD_COLUMN:'id',PARENT_SCHEMA:'mb_test',PARENT_TABLE:'parent',PARENT_COLUMN:'id',CONSTRAINT_NAME:'fk'}]:[]};
    if(/COLUMN_COMMENT/.test(sql))return {success:true,rows:selected.map(TABLE_NAME=>({TABLE_SCHEMA:'mb_test',TABLE_NAME,COLUMN_NAME:'label',COMMENTS:'Logical label'}))};
    return {success:true,rows:selected.map(TABLE_NAME=>({TABLE_SCHEMA:'mb_test',TABLE_NAME,COMMENTS:'Logical '+TABLE_NAME}))};
  },{mode});
}
test('MySQL automatic ER uses background MySQL catalogs and preserves exact type declarations, comments and foreign keys',async()=>{
  const f=await fixture('auto');try{
    await f.waitFor(s=>!s.isLoading);assert.equal(f.state.schema,'mb_test');await f.state.handleGenerateAutoEr();await f.flush();assert.equal(f.state.nodes.length,2,f.alerts.join('\n'));assert.equal(f.state.edges.length,1);
    const child=f.state.nodes.find(node=>node.id==='child');assert.equal(child.data.columns[0].type,'bigint unsigned');assert.equal(child.data.columns[1].type,"enum('low','HIGH')");assert.equal(child.data.tableComment,'Logical child');assert.equal(child.data.columns[0].isFk,true);
    assert.ok(!f.calls.some(call=>call[0]==='execute-sql'));assert.ok(f.calls.filter(call=>call[0]==='execute-sql-bg').every(call=>!call[1].includes('ALL_TAB_COLUMNS')));
  }finally{f.unmount();}
});
test('MySQL custom ER adds tables/views, persists only under MYSQL and restores the same diagram',async()=>{
  const f=await fixture();try{
    await f.waitFor(s=>!s.isLoading);f.state.handleCreateNewCustomEr();await f.flush();f.state.setErDiagramName('demo');await f.flush();
    await f.state.handleAddObjectsToCustomCanvas([{dbType:'mysql',schema:'mb_test',name:'parent',category:'TABLE'},{dbType:'mysql',schema:'mb_test',name:'view',category:'VIEW'}]);await f.flush();assert.equal(f.state.customNodes.length,2);assert.equal(f.state.dbType,'mysql');
    f.state.handleOpenAddRelationDialog();await f.flush();f.state.handleSaveRelation();await f.flush();assert.equal(f.state.customEdges.length,1);
    await f.state.handleCommit();await f.flush();f.state.handleCloseCustomEr();await f.flush();await f.state.handleOpenCustomEr('demo.json');await f.flush();assert.equal(f.state.customNodes.length,2);assert.equal(f.state.customEdges.length,1);assert.equal(f.state.customSchema,'mb_test');
    assert.ok(f.calls.filter(call=>['get-er-diagrams','save-er-diagram','load-er-diagram'].includes(call[0])).every(call=>typeof call[1]==='string'?call[1]==='MYSQL':call[1].dbType==='MYSQL'));
  }finally{f.unmount();}
});
test('MySQL ER rejects another database identity and schema before fetching or replacing the canvas',async()=>{
  const f=await fixture();try{await f.waitFor(s=>!s.isLoading);f.state.handleCreateNewCustomEr();await f.flush();const before=f.calls.length;
    for(const object of [{dbType:'oracle',schema:'mb_test',name:'parent',category:'TABLE'},{dbType:'mysql',schema:'other',name:'parent',category:'TABLE'}])await assert.rejects(f.state.handleAddObjectsToCustomCanvas([object]),/er_select_table_view_in_schema/);
    assert.equal(f.calls.length,before);assert.equal(f.state.customNodes.length,0);
  }finally{f.unmount();}
});
test('MySQL ER expands external parents once with exact schema identities and does not recurse into their foreign keys',async()=>{
  const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');const calls=[];
  const {fetchMysqlErMetadata}=loadTypeScript('src/features/mysql/er/erMetadata.ts',{'@/shared/api/desktop':{ipcRenderer:{invoke:async(channel,sql,binds)=>{
    assert.equal(channel,'execute-sql-bg');calls.push([sql,binds]);const schema=binds.schema,names=Object.entries(binds).filter(([key])=>key.startsWith('n')).map(([,value])=>value);
    if(/SELECT TABLE_NAME FROM/.test(sql))return {success:true,rows:['parent','child'].map(TABLE_NAME=>({TABLE_NAME}))};
    if(/MYSQL_COLUMN_TYPE/.test(sql))return {success:true,rows:names.map(TABLE_NAME=>({TABLE_SCHEMA:schema,TABLE_NAME,COLUMN_NAME:'id',DATA_TYPE:'int',MYSQL_COLUMN_TYPE:'int'}))};
    if(/CONSTRAINT_NAME='PRIMARY'/.test(sql))return {success:true,rows:names.map(TABLE_NAME=>({TABLE_SCHEMA:schema,TABLE_NAME,COLUMN_NAME:'id'}))};
    if(/REFERENCED_TABLE_NAME IS NOT NULL/.test(sql))return {success:true,rows:[{CHILD_SCHEMA:schema,CHILD_TABLE:schema==='mb_test'?'child':'parent',CHILD_COLUMN:'id',PARENT_SCHEMA:schema==='mb_test'?'Other':'Far',PARENT_TABLE:'parent',PARENT_COLUMN:'id',CONSTRAINT_NAME:'fk'}]};
    return {success:true,rows:names.map(TABLE_NAME=>({TABLE_SCHEMA:schema,TABLE_NAME,COLUMN_NAME:'id',COMMENTS:schema}))};
  }}}});
  const result=await fetchMysqlErMetadata('mb_test',null,false);
  assert.equal(result.columns.length,3);assert.equal(result.columns.filter(row=>row.TABLE_NAME==='parent').length,2);assert.equal(result.foreignKeys.length,1);
  assert.equal(result.columns.find(row=>row.TABLE_SCHEMA==='Other').TABLE_NAME,'parent');assert.ok(!calls.some(([,binds])=>binds.schema==='Far'));assert.ok(calls.every(([sql])=>!sql.includes('ALL_TAB_COLUMNS')));
});
