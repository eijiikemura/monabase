// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildTraceProgram}=require('../electron/mysql/traceProgram'),{validateRows}=require('../electron/mysql/triggerTraceService');
const info={schema:'mb_test',name:'saved',kind:'TRIGGER',parameters:[],timing:'BEFORE',event:'UPDATE',copyTable:'mbt_trace_table',traceColumns:[{name:'amount',type:'decimal(12,2)'},{name:'computed',type:'int',generated:true}]};
test('MySQL trigger instrumentation validates native row aliases, before-only NEW assignments and generated columns before DDL',()=>{
 const result=buildTraceProgram({...info,source:'SET NEW.amount=OLD.amount+1'},'mbt_trace_trigger');assert.ok(result.sql.includes('CREATE TRIGGER'));assert.ok(result.sql.includes('ON `mb_test`.`mbt_trace_table`'));assert.ok(result.sql.includes('CAST(OLD.`amount` AS CHAR)'));assert.ok(result.sql.includes('SET NEW.`amount`=OLD.amount+1;'));
 for(const delta of [{source:'SET OLD.amount=1'},{source:'SET NEW.computed=1'},{source:'SET NEW.amount=custom_function(1)'},{source:'SET NEW.amount=OLD.amount',event:'INSERT'},{source:'SET NEW.amount=1',timing:'AFTER'},{source:'SET NEW.amount=1',event:'DELETE'},{source:'BEGIN CALL other(); END'}])assert.throws(()=>buildTraceProgram({...info,...delta},'mbt_trace_trigger'),/Unsupported syntax/);
});
test('MySQL trigger row validation preserves NULL and empty text and rejects non-scalars, unsafe numbers, wrong aliases and generated input',()=>{
 const spec={trigger:{event:'UPDATE'},columns:[{name:'amount',type:'decimal(12,2)'},{name:'label',type:'varchar(32)'},{name:'computed',type:'int',generated:true}]};
 const input={oldRow:{amount:'9007199254740993'},newRow:{label:'',amount:null}};assert.deepEqual(validateRows(input,spec),input);
 for(const bad of [[],null,{oldRow:[],newRow:{}},{oldRow:{amount:1},newRow:{label:{}}},{oldRow:{amount:1},newRow:{computed:1}},{oldRow:{amount:1},newRow:{amount:9007199254740992}},{oldRow:{amount:1},newRow:{label:'x'.repeat(8193)}},{oldRow:{amount:1},newRow:{}}])assert.throws(()=>validateRows(bad,spec));
 assert.throws(()=>validateRows(input,{...spec,trigger:{event:'INSERT'}}),/OLD\/NEW/);
});
test('MySQL trigger paid tests require fresh authorization, reject CI and forbid arbitrary resume paths',()=>{
 const {authorize}=require('./live-ai/mysql-trigger-trace-effect.cjs');assert.throws(()=>authorize([],{}));assert.throws(()=>authorize(['--allow-paid'],{CI:'true'}));assert.throws(()=>authorize(['--allow-paid','--resume=../../key.json'],{}));assert.doesNotThrow(()=>authorize(['--allow-paid','--resume=mysql-trigger-trace-effect-123.json'],{}));
});
test('MySQL trigger trace UI loads schema and replay, submits JSON rows, prevents invalid JSON, read-only and draft execution',async()=>{
 const {componentHarness}=require('./helpers/componentHarness.cjs'),calls=[],details={schema:'mb_test',name:'trg',table:'orders',body:'SET NEW.amount=1',fingerprint:'fresh',event:'INSERT',timing:'BEFORE'},props={details,sourceText:details.body,active:true,disabled:false,readonly:false,theme:'mona',aiEnabled:true,setBusy(){},onOpenAi(){}};
 const sim={executionSteps:[],currentStepIndex:-1,currentVariables:{},loadSimulation(){},clearSimulation(){}};
 const f=componentHarness('src/features/mysql/trigger/TriggerTracePanel.tsx',props,{dependencies:{'@/shared/api/desktop':{ipcRenderer:{invoke:async(channel,input)=>{calls.push([channel,input]);return channel==='get-mysql-trigger-trace-inputs'?{success:true,trigger:details,tableFingerprint:'table-hash',columns:[]}:{success:true,info:null,steps:[]};}}},'@/features/stored/useTraceSimulator':{useTraceSimulator:()=>sim},'@/features/stored/TraceDebugArea':{TraceDebugArea:'TraceArea'},'@/features/ai/useAiTraceDebug':{useAiTraceDebug:()=>({isPreparing:false})},'../procedure/TracePanel':{escapeTraceLine:s=>s},'../VerticalSplit':'VerticalSplit'}});
 try{assert.equal(f.button('mysql_trace_run').props.disabled,true);await f.flush();assert.equal(f.button('mysql_trace_run').props.disabled,false);const field=f.node('TextField',v=>v.props.label==='mysql_trigger_trace_new');field.props.onChange({target:{value:'{"amount":"10.50"}'}});await f.flush();await f.click('mysql_trace_run');await f.flush();const request=calls.find(([channel])=>channel==='execute-trace')[1];assert.equal(request.objectType,'TRIGGER');assert.equal(request.mysqlTableFingerprint,'table-hash');assert.equal(request.triggerInput.newRow.amount,'10.50');
 f.node('TextField',v=>v.props.label==='mysql_trigger_trace_new').props.onChange({target:{value:'invalid'}});await f.flush();await f.click('mysql_trace_run');await f.flush();assert.equal(calls.filter(([c])=>c==='execute-trace').length,1);props.readonly=true;f.render();assert.equal(f.button('mysql_trace_run').props.disabled,true);props.readonly=false;props.sourceText='SET NEW.amount=2';f.render();assert.equal(f.button('mysql_trace_run').props.disabled,true);
 }finally{f.unmount();}
});

test('MySQL trigger setup refuses collisions without deleting an unowned table and reports uncertain CREATE results without replay',async()=>{
 const {loadModule}=require('./helpers/loadModule.cjs');
 for(const code of ['ER_TABLE_EXISTS_ERROR','ETIMEDOUT']){
  const queries=[],trigger={schema:'mb_test',name:'saved',table:'original',body:'SET NEW.amount=1',event:'INSERT',timing:'BEFORE',mode:'',charset:'utf8mb4',collation:'utf8mb4_0900_ai_ci',fingerprint:'f'};
  const client={main:{},getMainTransactionState:()=>false,enqueue:fn=>fn(),aiEnvironment:{timezone:'+00:00'},execute:async sql=>({rows:sql.startsWith('SELECT ENGINE')?[{ENGINE:'InnoDB',TABLE_TYPE:'BASE TABLE'}]:sql.startsWith('SELECT COLUMN')?[{COLUMN_NAME:'amount',COLUMN_TYPE:'int',IS_NULLABLE:'YES',EXTRA:''}]:[{'Create Table':'CREATE TABLE original(amount INT) ENGINE=InnoDB'}]}),openTraceConnection:async()=>({destroy(){},promise:()=>({query:async({sql})=>{queries.push(sql);if(sql.startsWith('CREATE TABLE'))throw Object.assign(new Error('Synthetic failure'),{code});return [[]];}})})};
  const {getTriggerTraceInputs,executeMysqlTriggerTrace}=loadModule('electron/mysql/triggerTraceService.js',{'./triggerService':{getTrigger:async()=>trigger}},{},{strict:false}),spec=await getTriggerTraceInputs(client,{schema:'mb_test',name:'saved'});
  await assert.rejects(executeMysqlTriggerTrace(client,{objectType:'TRIGGER',schema:'mb_test',objectName:'saved',sourceText:trigger.body,mysqlFingerprint:'f',mysqlTableFingerprint:spec.tableFingerprint,triggerInput:{oldRow:{},newRow:{amount:1}}}),code==='ETIMEDOUT'?/result is unknown/:/ER_TABLE_EXISTS_ERROR/);
  assert.equal(queries.filter(sql=>sql.startsWith('CREATE TABLE')).length,1);assert.ok(queries.every(sql=>!sql.startsWith('DROP')));
 }
});

test('MySQL trigger paid CLI refuses a missing disposable-environment opt-in before reading a key or reaching the DB',()=>{
 const {spawnSync}=require('node:child_process');const result=spawnSync(process.execPath,['tests/live-ai/trace-effect.cjs','--mysql-trigger','--allow-paid'],{encoding:'utf8',env:{...process.env,MONABASE_MYSQL_DISPOSABLE:'0'}});assert.equal(result.status,1);assert.match(result.stderr,/Explicit disposable MySQL opt-in is required/);assert.ok(!result.stdout.includes('Supply key'));
});
