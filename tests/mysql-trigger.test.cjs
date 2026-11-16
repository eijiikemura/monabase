// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateBody,buildTrigger}=require('../electron/mysql/triggerDefinition');
const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');
const form={schema:'demo',name:'trg',table:'items',timing:'BEFORE',event:'INSERT',body:'SET NEW.value=1'};
test('MySQL trigger bodies support opaque literals, compound branches and loops but reject extra statements and server/session commands',()=>{
  for(const body of ["SET NEW.value='END; DROP TABLE t'",'BEGIN IF NEW.id>0 THEN SET NEW.value=1; ELSE SET NEW.value=2; END IF; END','BEGIN DECLARE i INT DEFAULT 0; WHILE i<3 DO SET i=i+1; END WHILE; SET NEW.value=CASE WHEN i=3 THEN 1 ELSE 0 END; END','body_label: BEGIN SET NEW.value=1; END body_label;'])assert.doesNotThrow(()=>validateBody(body),body);
  for(const body of ['BEGIN SET NEW.x=1; END; DROP TABLE t','SET NEW.x=1; DELETE FROM t','BEGIN SET GLOBAL sql_mode=1; END','BEGIN SELECT @@session.sql_mode; END',"BEGIN SET NEW.x=LOAD_FILE('/tmp/x'); END",'BEGIN /*!80000 SET NEW.x=1 */; END',"SET NEW.x='unclosed",'BEGIN SET NEW.x=1;'])assert.throws(()=>validateBody(body),undefined,body);
  assert.equal(buildTrigger(form),'CREATE DEFINER=CURRENT_USER TRIGGER `demo`.`trg` BEFORE INSERT ON `demo`.`items` FOR EACH ROW\nSET NEW.value=1');
});
test('MySQL trigger AI definitions keep the exact table/trigger identity and native event semantics',()=>{
  const model=loadTypeScript('src/features/mysql/trigger/triggerModel.ts');const sql=model.triggerSource(form);const parsed=model.parseTriggerAnswer(sql,form);assert.equal(parsed.body,form.body);assert.equal(parsed.table,'items');
  for(const source of [sql.replace('`trg`','`other`'),sql.replace('`items`','`other`'),sql.replace('BEFORE','INSTEAD OF'),sql.replace('CREATE','CREATE OR REPLACE')])assert.throws(()=>model.parseTriggerAnswer(source,form));
});

const {mysqlTrigger}=require('./helpers/mysqlTrigger.cjs');
const {componentHarness:render}=require('./helpers/componentHarness.cjs');
const info=()=>({...form,schema:'mb_test',native:'CREATE DEFINER=`test`@`%` TRIGGER trg BEFORE INSERT ON items FOR EACH ROW SET NEW.value=1',mode:'STRICT_TRANS_TABLES',charset:'utf8mb4',collation:'utf8mb4_0900_ai_ci',databaseCollation:'utf8mb4_0900_ai_ci',definer:'test@%',order:1,peers:['trg'],fingerprint:'old',created:null});
const object={key:'trg',dbType:'mysql',schema:'mb_test',category:'TRIGGER',name:'trg',displayName:'trg',parentName:'items'};
test('MySQL trigger controller keeps local drafts, requires review, forwards native state and refuses automatic resend after partial failure',async()=>{
  let edits=0;const f=await mysqlTrigger(async(channel)=>{if(channel==='get-mysql-trigger')return {success:true,trigger:info()};if(channel==='mutate-mysql-trigger'){edits++;return {success:false,error:'compile failed',applied:true,stage:'dropped',recovery:{token:'backup',sql:info().native},transactionStatus:'idle',hasUncommittedTx:false};}throw new Error('Unexpected request');},{object});
  assert.equal(f.state.form.name,'trg');f.state.update({body:'SET NEW.value=2'});await f.flush();await f.state.load();await f.flush();assert.equal(f.state.form.body,'SET NEW.value=2');
  f.state.prepare();await f.flush();assert.ok(f.state.review);assert.equal(edits,0);await f.state.execute();await f.flush();assert.equal(edits,1);assert.equal(f.states[0].hasUncommittedTx,false);assert.equal(f.state.recovery.token,'backup');assert.equal(f.state.details,undefined);await f.state.execute();assert.equal(edits,1);
  f.state.closeReview();await f.flush();f.state.prepare('restore');await f.flush();assert.equal(f.state.review.request.operation,'restore');f.props.readonly=true;await f.flush();await f.state.execute();assert.equal(edits,1);f.unmount();
});
test('MySQL trigger creation uses actual native source for Git and does not repeat DDL when Git fails',async()=>{
  let edits=0;const f=await mysqlTrigger(async(channel)=>{if(channel==='mutate-mysql-trigger'){edits++;return {success:true,applied:true,stage:'applied',trigger:info(),transactionStatus:'idle',hasUncommittedTx:false};}if(channel==='git-commit')return {success:false,error:'Git unavailable'};throw new Error('Unexpected request');});
  f.state.update({...form,schema:'mb_test'});await f.flush();f.state.prepare();await f.flush();assert.equal(f.state.review.request.operation,'create');await f.state.execute();await f.flush();assert.equal(f.changes[0].category,'TRIGGER');assert.equal(f.calls.find(call=>call[0]==='git-commit')[1].sourceText,info().native);assert.equal(f.state.error,'mysql_view_git_failed');await f.state.execute();assert.equal(edits,1);f.unmount();
});
test('MySQL trigger sidebar follows Oracle inline category operations and readonly guards',()=>{
  const calls=[],triggers={expanded:['mb_test'],pages:{mb_test:{rows:[object],filter:'',applied:'',more:false,loading:false}},toggle(){},filter(){},refresh(){},retry(){},more(){}};
  const f=render('src/features/mysql/trigger/TriggerSidebarCategory.tsx',{triggers,schema:'mb_test',busy:false,readonly:false,canOpen:true,selected:'',onSelect(){},onOpen:(...v)=>calls.push(v),onCreate:v=>calls.push(v)});
  f.node('ListItemButton',n=>n.props['data-sidebar-object']).props.onDoubleClick();assert.deepEqual(calls.pop(),[object]);f.button('create_trigger').props.onClick();assert.equal(calls.pop(),'mb_test');f.props.readonly=true;f.render();assert.equal(f.button('create_trigger').props.disabled,true);f.unmount();
});
test('MySQL trigger window exposes native edit/source/Git, table targeting, explicit replace and recovery confirmation',async()=>{
  const model=loadTypeScript('src/features/mysql/trigger/triggerModel.ts'),calls=[],c={form:{...form,schema:'mb_test'},details:info(),text:model.triggerSource({...form,schema:'mb_test'}),loading:false,error:'',locked:false,logs:[],attempted:false,update:v=>calls.push(v),load(){},setText(){},prepare:v=>calls.push(v),execute:async()=>calls.push('execute'),closeReview(){},clearLogs(){}};
  const f=render('src/features/mysql/trigger/TriggerWindow.tsx',{schema:'mb_test',tabId:7,object,active:true,busy:false,readonly:false,disabled:false,theme:'simple',aiEnabled:true,onOpenAi(){}},{dependencies:{'./TriggerTracePanel':'TriggerTracePanel','./useMysqlTrigger':{useMysqlTrigger:()=>c},'../useMysqlEditorAi':{useMysqlEditorAi:()=>({displaySql:c.text,isGenerating:false,open(){}})},'../VerticalSplit':'Split','@/features/trigger/TriggerTargetPicker':{TriggerTargetPicker:'Picker'},'@/features/git/VersionControlTab':'VersionControl','@/features/ai/AiRequestButton':'AiButton','@uiw/react-codemirror':'CodeMirror','./useMysqlEditorExtensions':{useMysqlEditorExtensions:()=>[]},'../useMysqlEditorExtensions':{useMysqlEditorExtensions:()=>[]},'@codemirror/lang-sql':{sql:()=>[],MySQL:'mysql'}}});
  assert.equal(f.node('Tabs').children.flat().filter(n=>n?.type==='Tab').length,4);assert.equal(f.node('Picker').props.database,'mysql');assert.equal(f.node('Picker').props.disabled,true);await f.click('compile_save');assert.equal(calls.pop(),'save');
  c.review={request:{operation:'replace'},sql:'DROP; CREATE'};f.render();assert.equal(f.button('execute').props.disabled,true);f.node('TextField',n=>n.props.helperText==='mysql_trigger_confirm_name').props.onChange({target:{value:'trg'}});f.render();await f.click('execute');assert.equal(calls.pop(),'execute');
  f.node('Tabs').props.onChange(null,1);f.render();assert.equal(f.node('CodeMirror').props.readOnly,true);assert.equal(f.node('CodeMirror').props.value,info().native);f.node('Tabs').props.onChange(null,2);f.render();assert.equal(f.node('VersionControl').props.objectType,'TRIGGER');f.node('Tabs').props.onChange(null,3);f.render();assert.equal(f.node('TriggerTracePanel').props.details.name,'trg');f.unmount();
});

test('MySQL trigger IF functions inside CASE expressions are not mistaken for IF statement blocks',()=>{
  assert.doesNotThrow(()=>validateBody('BEGIN SET NEW.value=CASE WHEN NEW.id>0 THEN IF(NEW.id=1,10,20) ELSE 0 END; END'));
});
test('MySQL trigger mutation marks unconfirmable CREATE results unknown instead of replaying SQL',async()=>{
  const {mutateTrigger}=require('../electron/mysql/triggerService');let lookups=0,invalid=0,destroyed=0;
  const client={enqueue:fn=>fn(),main:{destroy:()=>destroyed++},monitor:{invalidate:()=>invalid++},getTransactionDetails:()=>({transactionStatus:'idle'}),execute:async sql=>({rows:sql.includes('information_schema.TABLES')?[{TABLE_TYPE:'BASE TABLE',ENGINE:'InnoDB'}]:++lookups===1?[]:[{TRIGGER_NAME:'trg'}]}),run:async(_db,{sql})=>{if(sql.startsWith('CREATE'))throw new Error('Transport result unknown');}};
  const result=await mutateTrigger(client,{...form,operation:'create'});assert.equal(result.success,false);assert.equal(result.stage,'unknown');assert.equal(invalid,1);assert.equal(destroyed,1);assert.equal(lookups,2);
});
