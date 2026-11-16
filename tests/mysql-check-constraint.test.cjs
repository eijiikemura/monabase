// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');const {createHookHarness}=require('./helpers/renderHook.cjs');const {componentHarness}=require('./helpers/componentHarness.cjs');
const model=loadTypeScript('src/features/mysql/constraint/checkModel.ts',{}, {Error});
const details={condition:'(`amount` >= 0)',definition:'CONSTRAINT `positive` CHECK ((`amount` >= 0))',enforced:true,fingerprint:'original'};
test('MySQL CHECK builders preserve quoted identity and use a single ALTER for rename and enforcement',()=>{
 assert.equal(model.checkStatement('a.b','t`b',{name:'n`x',condition:"value > 0 AND text <> ';'",enforced:false}).sql,"ALTER TABLE `a.b`.`t``b` ADD CONSTRAINT `n``x` CHECK (value > 0 AND text <> ';') NOT ENFORCED");
 assert.equal(model.checkStatement('s','t',{name:'positive',condition:details.condition,enforced:false},details,'positive').sql,'ALTER TABLE `s`.`t` ALTER CHECK `positive` NOT ENFORCED');
 assert.equal(model.checkStatement('s','t',{name:'renamed',condition:details.condition,enforced:true},details,'positive').sql,'ALTER TABLE `s`.`t` DROP CHECK `positive`, ADD CONSTRAINT `renamed` CHECK ((`amount` >= 0)) ENFORCED');
 assert.match(model.checkStatement('s','t',{name:'positive',condition:details.condition,enforced:true},details,'positive',true).sql,/DROP CHECK `positive`$/);
 assert.match(model.checkStatement('s','t',{name:'',condition:details.condition,enforced:true},details,'positive',true).sql,/DROP CHECK `positive`$/);
 assert.throws(()=>model.checkStatement('s','t',{name:'positive',condition:details.condition,enforced:true},details,'positive'),/No CHECK changes/);
 assert.throws(()=>model.checkStatement('s','t',{name:'positive',condition:'amount < 0',enforced:true},details,'positive'),/read only/);
 for(const condition of ['', 'x); DROP TABLE t;(', 'EXISTS(SELECT 1)', 'x > :bind', '@user > 0', '1 /* comment */', '(x > 0', 'SLEEP(1)=0'])assert.throws(()=>model.checkExpression(condition),undefined,condition);
 assert.throws(()=>model.assertCheckTable({table:{TABLE_TYPE:'BASE TABLE',ENGINE:'MyISAM'}}));
});
test('Native CHECK extraction preserves nested expressions and quoted commas without including other constraints',()=>{
 const source="CREATE TABLE `t` (`amount` int, CONSTRAINT `positive` CHECK (((`amount` > 0) and ('x,y)' <> 'z'))) /*!80016 NOT ENFORCED */, CONSTRAINT `other` CHECK ((`amount` < 100))) ENGINE=InnoDB";
 const actual=model.nativeCheckDefinition(source,'positive');assert.equal(actual.condition,"((`amount` > 0) and ('x,y)' <> 'z'))");assert.match(actual.definition,/NOT ENFORCED/);assert.ok(!actual.definition.includes('`other`'));assert.throws(()=>model.nativeCheckDefinition(source,'missing'));
});
async function fixture({existing=false,denied=false,stale=false,refreshFails=false,readonly=false,ddlFails=false}={}){
 const h=createHookHarness(),window=new EventTarget(),writes=[],states=[],changed=[],events=[];let loads=0,result;
 for(const kind of ['reload-statistics','reload-source','mysql-transaction-finished'])window.addEventListener(kind,event=>events.push(event));
 const props={schema:'s',table:'t',constraintName:existing?'positive':undefined,active:true,busy:false,readonly,theme:'simple',setBusy(){},onState:s=>states.push(s),onChanged:n=>changed.push(n),onDropped:()=>changed.push('dropped')};
 const metadata={table:{TABLE_TYPE:'BASE TABLE',ENGINE:'InnoDB'},columns:[{COLUMN_NAME:'amount'}],checks:[]};
 const hook=loadTypeScript('src/features/mysql/constraint/useMysqlCheck.ts',{
 react:h.react,'react-i18next':{useTranslation:()=>({t:key=>key})},'./checkModel':model,
 '../table/tableRepository':{loadTableMetadata:async()=>{if(denied)throw new Error('metadata denied');return metadata;}},
 './checkRepository':{loadMysqlCheck:async()=>{loads++;if(refreshFails&&writes.length)throw new Error('refresh denied');return {...details,fingerprint:stale&&loads>1?'changed':'original'};}},
 '@/shared/api/desktop':{ipcRenderer:{invoke:async(channel,sql)=>{assert.equal(channel,'execute-sql');writes.push(sql);return ddlFails?{success:false,error:'native DDL denied',transactionStatus:'idle',hasUncommittedTx:false}:{success:true,transactionStatus:'idle',hasUncommittedTx:false};}}}
 },{window,CustomEvent,Event,Error});
 const render=()=>result=h.render(()=>hook.useMysqlCheck(props));const flush=async()=>{for(let i=0;i<5;i++){render();h.commit();await h.settle();}render();};await flush();return {get state(){return result;},props,flush,writes,states,changed,events,unmount:h.unmount};
}
test('MySQL CHECK preview is read only and a failed DDL is never automatically resent',async()=>{
 const f=await fixture({ddlFails:true});f.state.update({name:'new',condition:'amount >= 0'});await f.flush();f.state.prepare();await f.flush();assert.ok(f.state.review);assert.equal(f.writes.length,0);
 await f.state.execute();await f.flush();assert.equal(f.writes.length,1);assert.equal(f.state.error,'native DDL denied');assert.equal(f.states[0].hasUncommittedTx,false);await f.state.execute();assert.equal(f.writes.length,1);assert.equal(f.changed.length,0);assert.ok(f.events.some(e=>e.type==='reload-statistics'));f.unmount();
});
test('MySQL CHECK mutation rechecks stale definitions and separates successful DDL from failed refresh',async()=>{
 for(const options of [{stale:true},{refreshFails:true}]){const f=await fixture({existing:true,...options});f.state.update({enforced:false,condition:'must not replace original'});await f.flush();assert.equal(f.state.form.condition,details.condition);f.state.prepare();await f.flush();await f.state.execute();await f.flush();
 if(options.stale){assert.equal(f.writes.length,0);assert.equal(f.state.error,'mysql_check_changed');}else{assert.equal(f.writes.length,1);assert.equal(f.state.error,'mysql_check_applied_refresh_failed');assert.equal(f.state.details,undefined);assert.equal(f.state.locked,true);}f.unmount();}
});
test('MySQL CHECK readonly and unavailable metadata block mutations while delete requests require review',async()=>{
 for(const options of [{readonly:true},{denied:true}]){const f=await fixture({existing:true,...options});f.state.prepare(true);await f.flush();assert.equal(f.state.review,undefined);assert.equal(f.state.locked,true);assert.equal(f.writes.length,0);f.unmount();}
 const f=await fixture({existing:true});f.props.request='delete-request';await f.flush();assert.equal(f.state.review.drop,true);assert.equal(f.writes.length,0);await f.state.execute();await f.flush();assert.deepEqual(f.changed,['dropped']);assert.equal(f.writes.length,1);f.unmount();
});
test('MySQL CHECK editor exposes edit/source, read-only existing conditions and exact-name reviewed execution',()=>{
 const state={form:{name:'positive',condition:details.condition,enforced:true},details,columns:['amount'],locked:false,loading:false,error:'',review:{sql:'ALTER TABLE `s`.`t` DROP CHECK `positive`',drop:true,form:{name:'positive'}},logs:[],attempted:false,prepare(){},update(){},load(){},closeReview(){},execute(){}};
 const f=componentHarness('src/features/mysql/constraint/CheckConstraintWindow.tsx',{schema:'s',table:'t',constraintName:'positive',theme:'simple',busy:false},{dependencies:{'./useMysqlCheck':{useMysqlCheck:()=>state},'@uiw/react-codemirror':'Editor','@codemirror/lang-sql':{sql:()=>[],MySQL:{}}}});
 assert.deepEqual(f.nodes().filter(n=>n.type==='Tab').map(n=>n.props.label),['edit','source']);assert.equal(f.node('Editor').props.readOnly,true);assert.equal(f.button('execute').props.disabled,true);
 f.node('TextField',n=>n.props.label==='mysql_check_confirm_name').props.onChange({target:{value:'positive'}});f.render();assert.equal(f.button('execute').props.disabled,false);f.node('Tabs').props.onChange(null,1);f.render();assert.ok(f.node('Editor').props.value.includes('ADD CONSTRAINT `positive`'));f.unmount();
});
test('MySQL table structure routes CHECK creation, opening and deletion to the dedicated window',()=>{
 const calls=[],metadata={table:{ENGINE:'InnoDB'},columns:[],indexes:[],checks:[{CONSTRAINT_NAME:'positive',CHECK_CLAUSE:'amount >= 0',ENFORCED:'YES'}],triggers:[],relations:[]};
 const f=componentHarness('src/features/mysql/table/TableMetadataTab.tsx',{mode:'structure',controller:{metadata},props:{schema:'s',table:'t',active:true,onOpenCheck:(...args)=>calls.push(args)}},{dependencies:{'../VerticalSplit':'Split','./ColumnEditorDialog':'Column','./TableDdlDialog':'DDL','@/components/data/ExportDialog':'Export','@/features/data-grid/GridViewport':{GridViewport:'Viewport'},'@mui/x-data-grid':{DataGrid:'Grid',enUS:require('@mui/x-data-grid').enUS,jaJP:require('@mui/x-data-grid').jaJP}}});
 const grid=f.nodes().find(n=>n.type==='Grid'&&n.props.columns.some(c=>c.field==='CHECK_CLAUSE'));
 const cell=grid.props.columns[0].renderCell({row:metadata.checks[0]});cell.children[0].children[0].props.onClick();assert.deepEqual(calls.pop(),['positive']);
 grid.props.columns.find(c=>c.field==='__actions').renderCell({row:metadata.checks[0]}).children[0].children[0].props.onClick();assert.deepEqual(calls.pop(),['positive',true]);
 const header=f.nodes().find(n=>n.type==='Box'&&Array.isArray(n.children)&&n.children.some(child=>child?.props?.['data-testid']==='mysql-structure-checks'));header.children.find(n=>n?.type==='Button'&&!n.props['data-testid']).props.onClick();assert.deepEqual(calls.pop(),[]);f.unmount();
});
