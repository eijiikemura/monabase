// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');
const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');
const {viewModules,mysqlView}=require('./helpers/mysqlView.cjs');
const {componentHarness:render}=require('./helpers/componentHarness.cjs');
const {inspectSql,assertReadOnly}=require('../electron/mysql/sqlText');
const {model}=viewModules(async()=>{throw new Error('Unexpected IPC.');});
const details=()=>({native:'CREATE VIEW `demo` AS SELECT 1 id',source:'CREATE OR REPLACE VIEW `mb_test`.`demo` AS SELECT 1 id',fingerprint:'same',metadata:{status:'MySQL',columns:[],references:[],dependents:[]},settings:{SQL_SECURITY:'DEFINER'}});

test('MySQL view definitions preserve native header/security/check option and qualify exactly one target',()=>{
  const source="-- native settings\nCREATE ALGORITHM=MERGE DEFINER=`test`@`%` SQL SECURITY DEFINER VIEW `v``x` (`id`) AS SELECT 'a; b' id WITH CASCADED CHECK OPTION;";
  const statement=model.mysqlViewStatement(source,'a.b','v`x');assert.ok(statement.sql.includes('CREATE OR REPLACE ALGORITHM=MERGE DEFINER=`test`@`%` SQL SECURITY DEFINER VIEW `a.b`.`v``x`'));assert.match(statement.sql,/WITH CASCADED CHECK OPTION$/);assert.doesNotThrow(()=>inspectSql(statement.sql));
  for(const text of ['CREATE VIEW other AS SELECT 1','CREATE VIEW wrong.demo AS SELECT 1','CREATE VIEW demo AS SELECT 1; DROP TABLE demo','ALTER VIEW demo AS SELECT 1','CREATE DEFINER=CURRENT_USER() TABLE demo(id INT)','/*!50000 CREATE VIEW demo AS SELECT 1 */'])assert.throws(()=>model.mysqlViewStatement(text,'mb_test','demo'));
  assert.doesNotThrow(()=>model.mysqlViewStatement('CREATE SQL SECURITY INVOKER VIEW demo AS WITH a AS (SELECT 1 x) SELECT * FROM a','mb_test','demo'));
});
test('MySQL SQL policy accepts native view security headers while preserving readonly and stored-program restrictions',()=>{
  for(const sql of ['CREATE OR REPLACE ALGORITHM=UNDEFINED DEFINER=`test`@`%` SQL SECURITY DEFINER VIEW `s`.`v` AS SELECT 1','CREATE DEFINER=CURRENT_USER() SQL SECURITY INVOKER VIEW v AS SELECT 1','ALTER SQL SECURITY DEFINER VIEW v AS SELECT 1']){const s=inspectSql(sql);assert.throws(()=>assertReadOnly(s));}
  for(const sql of ['CREATE DEFINER=`test`@`%` PROCEDURE p() SELECT 1','CREATE DEFINER=`test`@`%` TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET NEW.x=1','CREATE DEFINER=`test`@`%` TEMPORARY TABLE t(id INT)','CREATE VIEW v AS SELECT 1; DROP TABLE t','CREATE DEFINER=`test`@`%` VIEW v AS SELECT LOAD_FILE(\'/tmp/x\')'])assert.throws(()=>inspectSql(sql));
});
test('MySQL view preview is non-executing, validates identity and preserves native transaction feedback without automatic retry',async()=>{
  let executions=0;const f=await mysqlView(async(channel)=>{if(channel==='execute-sql'){executions++;return {success:false,error:'DDL denied',transactionStatus:'idle',hasUncommittedTx:false};}throw new Error('Unexpected Git.');},{},async()=>details());
  f.state.setText('CREATE VIEW other AS SELECT 1');await f.flush();f.state.prepare();await f.flush();assert.equal(f.state.review,undefined);assert.equal(executions,0);
  f.state.setText(f.state.saved);await f.flush();f.state.prepare();await f.flush();assert.ok(f.state.review);assert.equal(executions,0);
  await f.state.execute();await f.flush();assert.equal(f.state.error,'DDL denied');assert.equal(f.states[0].hasUncommittedTx,false);assert.equal(f.calls.find(call=>call[0]==='execute-sql')[3],'mb_test');await f.state.execute();assert.equal(executions,1);
  f.state.closeReview();await f.flush();f.props.readonly=true;await f.flush();f.state.prepare();await f.flush();assert.equal(f.state.review,undefined);f.unmount();
});
test('MySQL view reload keeps local drafts, rejects changed definitions and blocks dependent deletion',async()=>{
  let current=details(),executions=0;const f=await mysqlView(async()=>{executions++;throw new Error('No SQL expected.');},{},async()=>current);
  f.state.setText('CREATE VIEW mb_test.demo AS SELECT 2 id');await f.flush();await f.state.load();await f.flush();assert.ok(f.state.text.includes('SELECT 2'));
  f.state.prepare();await f.flush();current={...details(),fingerprint:'changed'};await f.state.execute();await f.flush();assert.equal(f.state.error,'mysql_view_changed_reload');assert.equal(executions,0);
  current={...details(),metadata:{...details().metadata,dependents:[{schema:'mb_test',name:'child',type:'VIEW'}]}};await f.state.load();await f.flush();f.state.prepare(true);await f.flush();assert.equal(f.state.review,undefined);assert.equal(f.state.error,'mysql_view_dependents_blocked');f.unmount();
});
test('MySQL view initial metadata failures remain errors and successful retry enables safe editing',async()=>{
  let fail=true;const f=await mysqlView(async()=>{throw new Error('No IPC.');},{},async()=>{if(fail)throw new Error('SHOW VIEW denied');return details();});
  assert.equal(f.state.error,'SHOW VIEW denied');assert.equal(f.state.locked,true);fail=false;await f.state.load();await f.flush();assert.equal(f.state.error,'');assert.equal(f.state.locked,false);f.unmount();
});
test('MySQL view sidebar exposes Oracle-style inline search, SQL template, selection, context export/delete and readonly guards',()=>{
  const object={key:'view',name:'summary',schema:'demo',category:'VIEW'},calls=[],views={expanded:['demo'],pages:{demo:{rows:[object],filter:'',applied:'',loading:false,more:true}},toggle:v=>calls.push(['toggle',v]),filter:(...v)=>calls.push(['filter',...v]),refresh(){},retry(){},more(){}};
  const f=render('src/features/mysql/view/ViewSidebarCategory.tsx',{views,schema:'demo',busy:false,readonly:false,canOpen:true,selected:'',onSelect:v=>calls.push(['select',v]),onOpen:(...v)=>calls.push(['open',...v]),onSql:(...v)=>calls.push(['sql',...v]),onExport:v=>calls.push(['export',v])},{dependencies:{'../table/tableModel':loadTypeScript('src/features/mysql/table/tableModel.ts')}});
  f.node('ListItemButton',n=>n.props['data-sidebar-object']).props.onDoubleClick();assert.deepEqual(calls.pop(),['open',object]);f.button('new_view_opens_sql_window').props.onClick();const created=calls.pop();assert.match(created[2],/^CREATE VIEW `demo`\.`NEW_VIEW_NAME`/);
  f.node('TextField').props.onChange({target:{value:'sum'}});assert.deepEqual(calls.pop(),['filter','demo','sum']);
  f.node('ListItemButton',n=>n.props['data-sidebar-object']).props.onContextMenu({preventDefault(){},clientX:1,clientY:2});f.render();f.node('MenuItem',n=>n.children.includes('delete')).props.onClick();assert.deepEqual(calls.pop(),['open',object,'delete']);
  f.props.readonly=true;f.render();assert.equal(f.button('new_view_opens_sql_window').props.disabled,true);assert.equal(f.node('MenuItem',n=>n.children.includes('delete')).props.disabled,true);f.unmount();
});

test('MySQL view window aligns Oracle tabs, compiles only reviewed SQL, shows native Git source and protects readonly/dependency deletion',async()=>{
  const calls=[],object={key:'demo',dbType:'mysql',schema:'mb_test',name:'demo',category:'VIEW'},props={object,tabId:1,active:true,busy:false,readonly:false,disabled:false,settings:{theme:'simple'},aiEnabled:true,onOpenAi(){}};
  const c={...details(),text:details().source,saved:details().source,details:details(),loading:false,error:'',dataRevision:0,locked:false,attempted:false,logs:[],load:async()=>calls.push('reload'),setText:v=>calls.push(['text',v]),prepare:v=>calls.push(['prepare',v]),execute:async()=>calls.push('execute'),closeReview(){},clearLogs(){}};
  const f=render('src/features/mysql/view/ViewWindow.tsx',props,{dependencies:{'./useMysqlView':{useMysqlView:()=>c},'../useMysqlEditorAi':{useMysqlEditorAi:()=>({displaySql:c.text,isGenerating:false,open(){}})},'../table/TableDataTab':'DataPane','../table/useMysqlTable':{},'../sidebarDataTransfer':{},'@/features/git/VersionControlTab':'VersionControl','@/features/view/ViewMetadataTab':{ViewMetadataTab:'Metadata'},'@/features/ai/AiRequestButton':'AiButton','@/components/navigation/WorkspaceDivider':'Divider','@uiw/react-codemirror':'CodeMirror','@codemirror/lang-sql':{sql:()=>[],MySQL:'mysql'}},globals:{window:{innerWidth:1400}}});
  assert.equal(f.node('Tabs').children[0].length,4);f.node('Tabs').props.onChange(null,1);f.render();await f.click('compile_save');assert.deepEqual(calls.pop(),['prepare',undefined]);assert.equal(f.node('CodeMirror').props.readOnly,false);assert.ok(f.node('AiButton'));
  c.details.metadata.dependents=[{name:'child'}];f.render();assert.equal(f.button('delete').props.disabled,true);c.details.metadata.dependents=[];
  c.review={drop:true,sql:'DROP VIEW mb_test.demo'};f.render();assert.equal(f.button('execute').props.disabled,true);f.node('TextField',n=>n.props.helperText==='mysql_view_confirm_name').props.onChange({target:{value:'demo'}});f.render();await f.click('execute');assert.equal(calls.pop(),'execute');
  f.node('Tabs').props.onChange(null,2);f.render();assert.equal(f.node('VersionControl').props.objectType,'VIEW');assert.equal(f.node('VersionControl').props.currentSource,details().native);
  f.node('Tabs').props.onChange(null,3);f.render();assert.equal(f.node('Metadata').props.data,c.details.metadata);
  f.props.readonly=true;c.locked=true;f.node('Tabs').props.onChange(null,1);f.render();assert.equal(f.button('compile_save').props.disabled,true);assert.equal(f.node('CodeMirror').props.readOnly,true);f.unmount();
});

test('MySQL view Git failure never re-executes a completed database compile or deletion',async()=>{
  for(const drop of [false,true]){
    let executions=0;const f=await mysqlView(async channel=>{
      if(channel==='execute-sql'){executions++;return {success:true,rows:[],metaData:[],transactionStatus:'idle',hasUncommittedTx:false};}
      if(channel==='git-commit'||channel==='git-delete-object')return {success:false,error:'Git unavailable'};
      throw new Error('Unexpected IPC: '+channel);
    },{},async()=>details());
    f.state.prepare(drop);await f.flush();await f.state.execute();await f.flush();assert.equal(executions,1);assert.equal(f.state.review,undefined);
    if(drop){assert.equal(f.changes[0],'drop');assert.equal(f.alerts[0],'mysql_view_git_failed');}else assert.equal(f.state.error,'mysql_view_git_failed');
    await f.state.execute();assert.equal(executions,1);f.unmount();
  }
});
