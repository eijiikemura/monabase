// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseProcedure,buildProcedure}=require('../electron/mysql/procedureDefinition');
const {mysqlProcedure}=require('./helpers/mysqlProcedure.cjs');
const {componentHarness:render}=require('./helpers/componentHarness.cjs');
const source='CREATE PROCEDURE `mb_test`.`proc`(IN p INT, OUT answer INT) SQL SECURITY INVOKER BEGIN SET answer=p+1; SELECT p; END';
const object={key:'procedure',dbType:'mysql',schema:'mb_test',name:'proc',category:'PROCEDURE',displayName:'proc'};
const info=()=>({schema:'mb_test',name:'proc',source,native:'-- MySQL sql_mode: "STRICT_TRANS_TABLES"\n'+source,parameters:[{name:'p',direction:'IN',type:'int',position:1},{name:'answer',direction:'OUT',type:'int',position:2}],mode:'STRICT_TRANS_TABLES',definer:'test@%',charset:'utf8mb4',collation:'utf8mb4_0900_ai_ci',security:'INVOKER',dataAccess:'CONTAINS SQL',deterministic:false,comment:'',created:null,altered:null,fingerprint:'initial'});
test('MySQL procedure grammar accepts native compound bodies and opaque comments, literals and identifiers',()=>{
  for(const sql of [source,"CREATE DEFINER=`test`@`%` PROCEDURE proc(IN p DECIMAL(30,8)) COMMENT 'END; DROP TABLE x' SELECT p",'CREATE PROCEDURE proc() BEGIN DECLARE i INT DEFAULT 0; WHILE i<2 DO SET i=i+1; END WHILE; SELECT i; COMMIT; END'])assert.doesNotThrow(()=>parseProcedure(sql,'mb_test','proc'));
  assert.ok(buildProcedure(source,'mb_test','proc',"'test'@'%'").startsWith("CREATE DEFINER='test'@'%' PROCEDURE `mb_test`.`proc`"));
});
test('MySQL procedure validation rejects target switches, appended statements and management commands before DROP',()=>{
  for(const sql of [source.replace('`proc`','`other`'),source+'; DROP TABLE important',source.replace('SET answer=p+1','SET SESSION sql_mode=1'),source.replace('SELECT p',"SELECT LOAD_FILE('/tmp/key')"),source.replace('CREATE','CREATE OR REPLACE'),source.replace('BEGIN','/*!80000 BEGIN */'),source.replace('END',"SELECT 'unclosed; END"),'CREATE PROCEDURE proc() SELECT 1; DELETE FROM t','CREATE PROCEDURE proc() BEGIN PREPARE x FROM @sql; END'])assert.throws(()=>parseProcedure(sql,'mb_test','proc'),undefined,sql);
});
test('MySQL procedure loading preserves edited drafts and argument inputs when server metadata is unchanged',async()=>{
  let metadata=info();const f=await mysqlProcedure(async()=>({success:true,procedure:metadata}),{object});
  f.state.setText(source+' -- draft');f.state.setArgs({p:'42'});await f.flush();metadata={...metadata,fingerprint:'next'};await f.state.load();await f.flush();assert.equal(f.state.text,source+' -- draft');assert.equal(f.state.args.p,'42');assert.equal(f.states.length,0);
  metadata={...metadata,parameters:[{name:'p',direction:'IN',type:'varchar(100)',position:1}]};await f.state.load();await f.flush();assert.equal(f.state.args.p,undefined);f.unmount();
});
test('MySQL procedure failed metadata loading disables definition-dependent compilation and execution',async()=>{
  const f=await mysqlProcedure(async()=>({success:false,error:'denied'}),{object});assert.equal(f.state.details,undefined);assert.equal(f.state.error,'denied');f.state.prepare();await f.flush();assert.equal(f.state.review,undefined);await f.state.call();assert.equal(f.calls.filter(c=>c[0]==='execute-stored').length,0);f.unmount();
});
test('MySQL procedure CALL uses the dedicated channel and actual metadata fingerprint, reporting native error transaction state',async()=>{
  const f=await mysqlProcedure(async channel=>channel==='get-mysql-procedure'?{success:true,procedure:info()}:{success:false,error:'call failed',transactionStatus:'active',hasUncommittedTx:true},{object});
  f.state.setArgs({p:'12345678901234567890'});await f.flush();await Promise.all([f.state.call(),f.state.call()]);await f.flush();const calls=f.calls.filter(c=>c[0]==='execute-stored');assert.equal(calls.length,1);assert.equal(calls[0][1].args.p,'12345678901234567890');assert.equal(calls[0][1].mysqlFingerprint,'initial');assert.equal(f.states[0].hasUncommittedTx,true);assert.equal(f.state.error,'call failed');f.unmount();
});
test('MySQL procedure IPC transport failure is unknown and is not replayed',async()=>{
  const f=await mysqlProcedure(async channel=>{if(channel==='get-mysql-procedure')return {success:true,procedure:info()};throw new Error('transport lost');},{object});await f.state.call();await f.flush();assert.equal(f.states[0].transactionStatus,'unknown');assert.equal(f.calls.filter(c=>c[0]==='execute-stored').length,1);f.unmount();
});
test('MySQL procedure replacement has one reviewed attempt, preserves explicit recovery and never writes failed source to Git',async()=>{
  const f=await mysqlProcedure(async channel=>channel==='get-mysql-procedure'?{success:true,procedure:info()}:{success:false,error:'syntax',stage:'dropped',applied:true,transactionStatus:'idle',recovery:{token:'backup',sql:source}},{object});
  f.state.prepare();await f.flush();assert.equal(f.state.review.request.operation,'replace');assert.ok(f.state.review.sql.startsWith('DROP PROCEDURE'));
  await Promise.all([f.state.execute(),f.state.execute()]);await f.flush();assert.equal(f.calls.filter(c=>c[0]==='mutate-mysql-procedure').length,1);assert.equal(f.state.details,undefined);assert.equal(f.state.recovery.token,'backup');assert.equal(f.calls.some(c=>c[0].startsWith('git-')),false);
  f.state.prepare('restore');await f.flush();assert.equal(f.state.review.request.recoveryToken,'backup');f.unmount();
});
test('MySQL procedure successful compilation records only the native saved source, while Git failure does not repeat DDL',async()=>{
  const f=await mysqlProcedure(async channel=>channel==='get-mysql-procedure'?{success:true,procedure:info()}:channel==='mutate-mysql-procedure'?{success:true,procedure:info(),applied:true,stage:'applied',transactionStatus:'idle'}:{success:false,error:'Git failed'},{object});f.state.setText(source+' -- local draft');await f.flush();f.state.prepare();await f.flush();await f.state.execute();await f.flush();assert.equal(f.calls.filter(c=>c[0]==='mutate-mysql-procedure').length,1);assert.equal(f.calls.find(c=>c[0]==='git-commit')[1].sourceText,info().native);assert.equal(f.changes[0].category,'PROCEDURE');assert.equal(f.state.error,'mysql_view_git_failed');f.unmount();
});
for(const restriction of ['readonly','disabled','busy'])test('MySQL procedure '+restriction+' prevents editing, compilation and CALL',async()=>{
  const f=await mysqlProcedure(async()=>({success:true,procedure:info()}),{object,[restriction]:true});assert.throws(()=>f.state.setText(source));f.state.prepare();await f.state.call();await f.flush();assert.equal(f.state.review,undefined);assert.equal(f.calls.filter(c=>c[0]==='execute-stored').length,0);f.unmount();
});
test('MySQL procedure sidebar opens on double-click, caches category actions and guards readonly creation/deletion',()=>{
  const calls=[],procedures={expanded:['mb_test'],pages:{mb_test:{rows:[object],filter:'',applied:'',loading:false,more:true}},toggle:s=>calls.push(['toggle',s]),filter:(...args)=>calls.push(['filter',...args]),refresh:s=>calls.push(['refresh',s]),retry(){},more:s=>calls.push(['more',s])};
  const f=render('src/features/mysql/procedure/ProcedureSidebarCategory.tsx',{procedures,schema:'mb_test',busy:false,readonly:false,canOpen:true,selected:'',onSelect:key=>calls.push(['select',key]),onOpen:(...args)=>calls.push(['open',...args]),onCreate:s=>calls.push(['create',s])});
  const row=()=>f.node('ListItemButton',n=>n.props['data-mysql-procedure']);row().props.onClick();assert.deepEqual(calls.pop(),['select','procedure']);row().props.onDoubleClick();assert.deepEqual(calls.pop(),['open',object]);f.button('create_procedure').props.onClick();assert.deepEqual(calls.pop(),['create','mb_test']);f.node('TextField').props.onChange({target:{value:'proc'}});assert.deepEqual(calls.pop(),['filter','mb_test','proc']);f.props.readonly=true;f.render();assert.equal(f.button('create_procedure').props.disabled,true);f.unmount();
});
test('MySQL procedure window exposes source, Git, information, arguments, trace entry and review controls',()=>{
  const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');const model=loadTypeScript('src/features/mysql/table/tableModel.ts');
  const c={name:'proc',text:source,details:info(),args:{p:'5'},output:{resultSets:[{rows:[{answer:6}],metaData:[{name:'answer',dbTypeName:'LONG'}]}]},logs:[],locked:false,setText(){},load(){},prepare(){},call(){},setArgs(){}};
  const f=render('src/features/mysql/procedure/ProcedureWindow.tsx',{schema:'mb_test',object,tabId:1,active:true,settings:{theme:'light',outputDateFormat:'YYYY-MM-DD'},aiEnabled:true},{dependencies:{'./TracePanel':'TracePanel','@mui/x-data-grid':{DataGrid:'DataGrid',enUS:{components:{MuiDataGrid:{defaultProps:{localeText:{}}}}},jaJP:{components:{MuiDataGrid:{defaultProps:{localeText:{}}}}}},'./useMysqlProcedure':{useMysqlProcedure:()=>c},'../VerticalSplit':'VerticalSplit','../useMysqlEditorAi':{useMysqlEditorAi:()=>({isGenerating:false,open(){}})},'../table/tableModel':model,'@/features/git/VersionControlTab':'VersionControl','@/features/data-grid/GridViewport':'GridViewport','@/features/data-grid/dataGridHelper':{getFormattedValue:v=>String(v),buildGridColumns:fields=>fields.map(field=>({field:field.name,headerName:field.name}))},'@/components/navigation/WorkspaceDivider':'Divider','@/features/ai/AiRequestButton':'AskAi','@uiw/react-codemirror':'CodeMirror','./useMysqlEditorExtensions':{useMysqlEditorExtensions:()=>[]},'../useMysqlEditorExtensions':{useMysqlEditorExtensions:()=>[]},'@codemirror/lang-sql':{sql:()=>[],MySQL:{}}}});
  for(const label of ['source','version_control','routine_information','mysql_trace_tab'])assert.ok(f.node('Tab',n=>n.props.label===label));assert.equal(f.text().includes('execute_trace'),false);assert.ok(f.button('execute'));assert.ok(f.button('compile'));assert.ok(f.node('TextField',n=>n.props.label==='p (IN int)'));assert.ok(f.node('TextField',n=>n.props.label==='answer (OUT int)').props.disabled);c.locked=true;f.props.readonly=true;f.render();assert.equal(f.button('execute').props.disabled,true);assert.equal(f.button('refresh').props.disabled,false);f.unmount();
});

test('MySQL procedure date arguments honor inputDateFormat without losing fractional seconds',async()=>{
  const metadata={...info(),parameters:[{name:'p_date',type:'datetime(6)',direction:'IN',position:1}]};
  const f=await mysqlProcedure(async channel=>channel==='get-mysql-procedure'?{success:true,procedure:metadata}:{success:true,transactionStatus:'idle'},{object,inputDateFormat:'DD/MM/YYYY HH:mm:ss'});
  f.state.setArgs({p_date:'14/11/2026 12:30:40.123456'});await f.flush();await f.state.call();await f.flush();assert.equal(f.calls.find(c=>c[0]==='execute-stored')[1].args.p_date,'2026-11-14 12:30:40.123456');
  f.state.setArgs({p_date:'not a date'});await f.flush();await f.state.call();await f.flush();assert.equal(f.calls.filter(c=>c[0]==='execute-stored').length,1);assert.equal(f.state.error,'mysql_procedure_date_input');f.unmount();
});
