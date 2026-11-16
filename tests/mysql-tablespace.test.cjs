// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');
const service=require('../electron/mysql/tablespaceService');
const {inspectSql,assertReadOnly}=require('../electron/mysql/sqlText');
const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');
const {createHookHarness}=require('./helpers/renderHook.cjs');
const {componentHarness}=require('./helpers/componentHarness.cjs');
function fixture(){
 const data={metadata:[{SPACE:'7',NAME:'demo/orders',SPACE_TYPE:'Single',PAGE_SIZE:'16384',FILE_SIZE:'9007199254740993',ALLOCATED_SIZE:'65536',ENCRYPTION:'N',STATE:'normal'}],files:[{FILE_ID:'7',TABLESPACE_NAME:'demo/orders',FILE_NAME:'./demo/orders.ibd',STATUS:'NORMAL'},{FILE_ID:'0',TABLESPACE_NAME:'innodb_system',FILE_NAME:'./ibdata1',STATUS:'NORMAL'}],tables:[{TABLE_ID:'9007199254740994',SPACE:'7',NAME:'demo/orders#P#p0',ROW_FORMAT:'Dynamic',N_COLS:'5'}],error:null};
 const calls=[],client={main:{},execute:async(sql,binds,_tab,_trace,background)=>{assert.equal(background,true);assertReadOnly(inspectSql(sql,binds));calls.push([sql,binds]);if(data.error)throw data.error;return {rows:sql.includes('INNODB_TABLESPACES')?data.metadata:sql.includes('INNODB_TABLES')?data.tables:data.files};}};
 return {data,calls,client};
}
test('MySQL storage preserves exact byte counts, files-only spaces and native partition identifiers on background reads',async()=>{
 const f=fixture(),r=await service.list(f.client);assert.equal(r.success,true,r.error);assert.equal(r.snapshot.tablespaces[0].fileSize,'9007199254740993');assert.equal(r.snapshot.tablespaces[1].type,null);assert.equal(r.snapshot.tablespaces[1].fileSize,null);assert.equal(r.transactionStatus,undefined);
 const detail=await service.get(f.client,{id:'7',name:'demo/orders'});assert.equal(detail.success,true,detail.error);assert.equal(detail.detail.tables[0].name,'demo/orders#P#p0');assert.equal(detail.detail.tables[0].id,'9007199254740994');assert.equal(detail.detail.tablespace.files[0].path,'./demo/orders.ibd');
});
test('MySQL storage catalog denial, missing connections and excessive/inexact results fail explicitly without leaking errors',async()=>{
 const f=fixture();f.data.error=new Error('ER_SPECIFIC_ACCESS_DENIED_ERROR: sentinel-secret');const denied=await service.list(f.client);assert.equal(denied.error,'mysql_storage_privilege_required');assert.equal(denied.snapshot,undefined);assert.ok(!JSON.stringify(denied).includes('sentinel-secret'));f.data.error=new Error('sentinel-secret');assert.equal((await service.list(f.client)).error,'mysql_storage_read_failed');f.data.error=null;
 f.data.metadata[0].FILE_SIZE=9007199254740992;assert.equal((await service.list(f.client)).error,'mysql_storage_invalid_catalog');f.data.metadata=Array.from({length:5001},()=>({}));assert.equal((await service.list(f.client)).error,'mysql_storage_too_many');f.client.main=null;assert.equal((await service.list(f.client)).error,'mysql_storage_unavailable');
});
test('MySQL storage detail rejects invalid input and changed identities rather than displaying unrelated objects',async()=>{
 const f=fixture();for(const input of [{id:'7 OR 1=1',name:'demo/orders'},{id:'7',name:'demo/orders',sql:'SELECT 1'},null])assert.equal((await service.get(f.client,input)).error,'mysql_storage_invalid');assert.equal(f.calls.length,0);
 assert.equal((await service.get(f.client,{id:'7',name:'different'})).error,'mysql_storage_changed');f.data.tables[0].SPACE='8';assert.equal((await service.get(f.client,{id:'7',name:'demo/orders'})).error,'mysql_storage_changed');
});
function hookFixture(invoke){const h=createHookHarness({doubleUpdates:true}),props={active:true,busy:false},setups=[];const react={...h.react,useEffect:(setup,deps)=>h.react.useEffect(()=>{setups.push(setup);return setup();},deps)};let state;
 const hook=loadTypeScript('src/features/mysql/dba/useTablespaceTab.ts',{react,'@/shared/api/desktop':{ipcRenderer:{invoke}}});
 const render=()=>state=h.render(()=>hook.useTablespaceTab(props.active,props.busy));const flush=async()=>{for(let i=0;i<5;i++){render();h.commit();await h.settle();}return render();};return {h,props,render,flush,replay:()=>{h.unmount();for(const setup of setups.slice())setup();},get state(){return state;}};
}
test('MySQL storage hook filters exact metadata, rejects stale details and offers explicit refresh after failure',async()=>{
 const rows=(await service.list(fixture().client)).snapshot.tablespaces,pending=[];let fail=false;
 const f=hookFixture(async(channel,input)=>channel==='list-mysql-tablespaces'?fail?{success:false,error:'mysql_storage_read_failed'}:{success:true,snapshot:{tablespaces:rows,fetchedAt:'now'}}:new Promise(resolve=>pending.push({input,resolve})));
 try{await f.flush();f.state.select('7');await f.flush();f.state.select('0');await f.flush();pending[0].resolve({success:true,detail:{tablespace:rows[0],tables:[]}});await f.flush();assert.equal(f.state.detail,null);pending[1].resolve({success:true,detail:{tablespace:rows[1],tables:[]}});await f.flush();assert.equal(f.state.detail.tablespace.id,'0');f.state.setSearch('orders');await f.flush();assert.equal(f.state.rows.length,1);fail=true;await f.state.reload();await f.flush();assert.equal(f.state.snapshot,null);assert.equal(f.state.detail,null);assert.equal(f.state.error,'mysql_storage_read_failed');}finally{f.h.unmount();}
});
test('MySQL storage hook survives StrictMode replay and ignores replies after disposal',async()=>{
 const pending=[];const f=hookFixture(()=>new Promise(resolve=>pending.push(resolve)));
 f.render();f.h.commit();f.replay();assert.equal(pending.length,2);pending[0]({success:false,error:'old'});pending[1]({success:true,snapshot:{tablespaces:[],fetchedAt:'now'}});await f.flush();assert.equal(f.state.error,'');assert.equal(f.state.loading,false);f.h.unmount();
});
test('MySQL storage screen exposes read-only files/tables, exact numeric sorting, export and accessible split controls',()=>{
 const row={id:'7',name:'demo/orders',fileSize:'9007199254740993',allocatedSize:'65536',files:[]};const calls=[];
 const f=componentHarness('src/features/mysql/dba/TablespaceTab.tsx',{active:true,busy:false},{dependencies:{'@/features/data-grid/GridViewport':{GridViewport:'Viewport'},'@/components/data/ExportDialog':'ExportDialog','@mui/x-data-grid':{DataGrid:'DataGrid',enUS:require('@mui/x-data-grid').enUS,jaJP:require('@mui/x-data-grid').jaJP},'./useTablespaceTab':{useTablespaceTab:()=>({rows:[row],snapshot:{tablespaces:[row]},detail:{tablespace:row,tables:[]},selectedId:'7',filter:'all',search:'',loading:false,detailLoading:false,reload:()=>calls.push('refresh'),select(){}})},'@/features/dba/hooks/useDbaSplit':{useDbaSplit:()=>({container:{current:null},topHeight:200,ratio:0.55})}}});
 try{const grid=f.node('DataGrid');assert.equal(grid.props.columns.find(c=>c.field==='fileSize').valueFormatter({value:row.fileSize}),'9,007,199,254,740,993');assert.equal(grid.props.columns.find(c=>c.field==='fileSize').sortComparator('10','2'),1);assert.equal(grid.props.columns.find(c=>c.field==='allocatedSize').valueFormatter({value:null}),'—');assert.ok(f.node('ExportDialog'));assert.equal(f.nodes().filter(n=>n.type==='Button').length,1);assert.equal(f.nodes().some(n=>n.props.role==='separator'&&n.props.tabIndex===0),true);}finally{f.unmount();}
});
