// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');
const {loadModule}=require('./helpers/loadModule.cjs');
const globals={TextEncoder,crypto:webcrypto,structuredClone,Error};
const load=file=>loadTypeScript('src/features/quality/'+file+'.ts',{},globals);
const {captureResult,validateSnapshot,parseDocument}=load('resultSnapshot');
const {compareResults}=load('compareResults');
const {maskResult,defaultMaskRules}=load('masking');
const {storedExpectation,validateSuite,runRegressionSuite}=load('regression');
const plain=v=>JSON.parse(JSON.stringify(v));
const result=(rows,columns=['id','value'])=>captureResult(columns,rows);
const request={schema:'test',objectName:'f',objectType:'FUNCTION',args:{p:'5'},argTypes:{p:'NUMBER'},argDirections:{p:'IN'},inputDateFormat:'YYYY-MM-DD'};
const data={returnValues:[{name:'RETURN_VALUE',value:'15'}],resultSets:[]};
const one=(patch={})=>({id:'one',name:'five iterations',request,expected:storedExpectation(data),checks:[],...patch});
const suite=(cases=[one()])=>({format:'monabase-regression',version:1,dbType:'oracle',cases});
test('Result capture preserves exact decimal strings, NULL, empty text, date and binary values without grid-only fields',()=>{
 const snapshot=result([{id:'9007199254740993',value:'0.000000000000001',__row_id:77},{id:null,value:''}]);
 assert.deepEqual(plain(snapshot.rows),[['9007199254740993','0.000000000000001'],[null,'']]);
 assert.equal(captureResult(['d'],[{d:new Date('2026-01-02T03:04:05Z')}]).rows[0][0],'2026-01-02T03:04:05.000Z');
 assert.deepEqual(plain(captureResult(['b'],[{b:new Uint8Array([0,255])}]).rows),[[{binary:[0,255]}]]);
 assert.ok(!JSON.stringify(snapshot).includes('__row_id'));
});
test('Result import rejects duplicate columns, wrong row widths, missing values, non-finite numbers, excessive rows and oversized text',()=>{
 const snapshot=result([]);
 for(const input of [{...snapshot,version:2},{...snapshot,columns:['id','id']},{...snapshot,rows:[[1]]},{...snapshot,rows:[[1,NaN]]},{...snapshot,rows:Array(10001).fill([1,2])}])assert.throws(()=>validateSnapshot(input));
 assert.throws(()=>captureResult(['n'],[{n:Number.MAX_SAFE_INTEGER+1}]),/quality_inexact_number/);
 assert.throws(()=>captureResult(['missing'],[{}]));assert.throws(()=>parseDocument(' '.repeat(8*1024*1024+1)),/quality_document_limit/);assert.throws(()=>parseDocument('{bad}'));
});
test('Unordered comparison counts duplicates, reorders columns and distinguishes NULL, empty text and scalar types',()=>{
 const before=result([{id:1,value:null},{id:1,value:null},{id:2,value:''}]);
 const same=captureResult(['value','id'],[{id:2,value:''},{id:1,value:null},{id:1,value:null}]);assert.equal(compareResults(before,same).equal,true);
 const diff=compareResults(before,result([{id:1,value:null},{id:2,value:'null'},{id:3,value:''}]));assert.equal(diff.unchanged,1);assert.equal(diff.added,2);assert.equal(diff.removed,2);
 assert.equal(compareResults(result([{id:1,value:'1'}]),result([{id:1,value:1}])).equal,false);
 assert.throws(()=>compareResults(before,captureResult(['other'],[])),/quality_columns_differ/);
});
test('Key comparison reports changed cells, additions and removals; ambiguous or NULL keys are refused',()=>{
 const before=result([{id:1,value:'old'},{id:2,value:null}]),after=result([{id:1,value:'new'},{id:3,value:null}]);
 const diff=compareResults(before,after,{keys:['id'],numericStrings:false});assert.equal(diff.changed,1);assert.equal(diff.added,1);assert.equal(diff.removed,1);assert.deepEqual(plain(diff.differences[0].columns),['value']);
 assert.throws(()=>compareResults(result([{id:1,value:'x'},{id:1,value:'y'}]),after,{keys:['id'],numericStrings:false}),/quality_duplicate_key/);
 assert.throws(()=>compareResults(result([{id:null,value:'x'}]),after,{keys:['id'],numericStrings:false}),/quality_null_key/);
 assert.throws(()=>compareResults(before,after,{keys:['nope'],numericStrings:false}),/quality_invalid_keys/);
});
test('Optional numeric equivalence is decimal-exact for integers beyond 53 bits, tiny fractions and signed zero',()=>{
 for(const [left,right,equal] of [['9007199254740993','9007199254740992',false],['0001.2300','1.23',true],['-0.000','0',true],['0.00000000000000001','0.00000000000000002',false]]){
 assert.equal(compareResults(result([{id:1,value:left}]),result([{id:1,value:right}]),{keys:[],numericStrings:true}).equal,equal);
 }
 assert.equal(compareResults(result([{id:1,value:'1.00'}]),result([{id:1,value:1}]),{keys:[],numericStrings:true}).equal,true);
});
test('Masking excludes every column by default and exports no source rows, mapping or secret',async()=>{
 const input=result([{id:1,value:'佐藤花子'},{id:2,value:null}]),rules=defaultMaskRules(input);
 await assert.rejects(maskResult(input,rules,'a private phrase 123'),/quality_select_columns/);
 rules[1].mode='token';const masked=await maskResult(input,rules,'a private phrase 123');assert.deepEqual(plain(masked.columns),['value']);assert.match(masked.rows[0][0],/^anon_[a-f0-9]{32}$/);assert.equal(masked.rows[1][0],null);
 for(const forbidden of ['佐藤花子','private phrase','"id"'])assert.ok(!JSON.stringify(masked).includes(forbidden));assert.equal(input.rows[0][1],'佐藤花子');
});
test('Mask groups preserve cross-table relationships while separating groups and secrets; fictional mail uses a reserved domain',async()=>{
 const input=result([{id:'a@example.com',value:'a@example.com'}]);
 const rules=defaultMaskRules(input).map(rule=>({...rule,mode:'token',group:'person'}));
 const masked=await maskResult(input,rules,'secret phrase long enough');assert.equal(masked.rows[0][0],masked.rows[0][1]);
 assert.equal((await maskResult(input,rules,'secret phrase long enough')).rows[0][0],masked.rows[0][0]);
 rules[1].group='different';assert.notEqual((await maskResult(input,rules,'secret phrase long enough')).rows[0][1],masked.rows[0][0]);
 assert.notEqual((await maskResult(input,rules,'another private phrase')).rows[0][0],masked.rows[0][0]);
 rules[0].mode='email';assert.match((await maskResult(input,rules,'secret phrase long enough')).rows[0][0],/^user-[a-f0-9]{32}@example\.invalid$/);
 await assert.rejects(maskResult(input,rules,'short'),/quality_secret_length/);
});
test('Masking keep, NULL and fixed rules preserve explicit choices and invalidate malformed rules',async()=>{
 const input=result([{id:1,value:'original'},{id:2,value:null}]),rules=defaultMaskRules(input);rules[0].mode='keep';rules[1].mode='fixed';rules[1].value='redacted';
 assert.deepEqual(plain((await maskResult(input,rules,'')).rows),[[1,'redacted'],[2,null]]);rules[0].mode='null';assert.equal((await maskResult(input,rules,'')).rows[0][0],null);rules[0].column='wrong';await assert.rejects(maskResult(input,rules,''),/quality_invalid_rules/);
});
test('Regression documents require assertions, unique case IDs, a known dialect and valid bounded snapshots',()=>{
 assert.equal(validateSuite(suite()).cases.length,1);
 for(const value of [suite([one(),one()]),{...suite(),dbType:'mariadb'},suite([one({expected:{returnValues:[],resultSets:[]}})]),suite([one({request:{...request,args:null}})]),suite([one({checks:[{sql:'SELECT 1',binds:{},expected:{}}]})])])assert.throws(()=>validateSuite(value));
});
test('Regression runner verifies returns, row sets and main-session assertion queries; never invokes implicit transaction controls',async()=>{
 const check={sql:'SELECT id,value FROM test.fixture',binds:{},expected:result([{id:1,value:'updated'}])},calls=[];
 const outcomes=await runRegressionSuite(suite([one({checks:[check]})]),'oracle',{
 stored:async r=>{calls.push(['stored',r]);return {success:true,...data,hasUncommittedTx:true};},
 query:async(sql,binds,schema)=>{calls.push(['query',sql,binds,schema]);return {success:true,rows:[{id:1,value:'updated'}],metaData:[{name:'id'},{name:'value'}]};}
 });assert.equal(outcomes[0].status,'passed');assert.deepEqual(calls.map(c=>c[0]),['stored','query']);assert.equal(calls[1][3],'test');
});
test('Regression failures stop later cases, distinguish errors from mismatch, and reject the wrong DB before execution',async()=>{
 for(const response of [{success:true,returnValues:[{name:'RETURN_VALUE',value:'wrong'}]},{success:false,error:'routine failed'}]){
 let calls=0;const executor={stored:async()=>{calls++;return response;},query:async()=>{throw Error('unexpected');}};
 const outcomes=await runRegressionSuite(suite([one(),one({id:'two'})]),'oracle',executor);assert.equal(calls,1);assert.equal(outcomes[0].status,response.success?'failed':'error');assert.equal(outcomes[1].status,'not-run');
 await assert.rejects(runRegressionSuite(suite(),'mysql',executor),/quality_database_mismatch/);assert.equal(calls,1);
 }
});
test('Disconnect or stop between a stored call and its assertion prevents further DB requests',async()=>{
 let stopped=false,queries=0;const outcomes=await runRegressionSuite(suite([one({checks:[{sql:'SELECT 1',binds:{},expected:captureResult(['n'],[{n:1}])}]}),one({id:'two'})]),'oracle',{
 stored:async()=>{stopped=true;return {success:true,...data};},query:async()=>{queries++;throw Error('unexpected');}
 },()=>stopped);assert.equal(queries,0);assert.equal(outcomes[0].status,'error');assert.equal(outcomes[1].status,'not-run');
});
test('Regression assertion IPC rejects writes, multiple SQL statements and locking reads before DB access, reusing main SQL for SELECT',async()=>{
 const handlers=new Map(),calls=[];const client={execute:async(...args)=>{calls.push(args);return {rows:[{n:1}],metaData:[{name:'n'}]};},getMainTransactionState:()=>true};
 const {registerDatabaseHandlers}=loadModule('electron/ipc/database.js',{}, {},{strict:false});
 const state={type:'postgresql',client};registerDatabaseHandlers({ipcMain:{handle:(channel,fn)=>handlers.set(channel,fn)},state,getValidatedSettings:()=>({}),t:k=>k});const event={sender:{id:1,once(){},isDestroyed:()=>false}};
 for(const sql of ['UPDATE fixture SET n=1','SELECT 1; DELETE FROM fixture','SELECT * FROM fixture FOR UPDATE','SELECT nextval(\'x\')','SELECT 1 INTO fixture'])assert.equal((await handlers.get('execute-regression-check')(event,sql,{},'test')).success,false,sql);
 assert.equal(calls.length,0);const response=await handlers.get('execute-regression-check')(event,'SELECT COUNT(*) AS n FROM fixture',{},'test');assert.equal(response.success,true);assert.equal(response.hasUncommittedTx,true);assert.equal(calls[0][2],'test');assert.equal(calls[0][4],false);
});
test('Quality session is memory-only and resets both captured data and connection epoch',()=>{
 const session=load('qualitySession'),epoch=session.getQualityConnectionEpoch();session.publishQualityResult(['n'],[{n:'secret'}],1);session.rememberStoredExecution(request,data);assert.equal(session.getQualitySession().open,true);assert.ok(session.getQualitySession().stored);session.clearQualitySession();assert.equal(session.getQualityConnectionEpoch(),epoch+1);assert.equal(session.getQualitySession().snapshot,undefined);assert.equal(session.getQualitySession().stored,undefined);assert.equal(session.getQualitySession().open,false);
});
test('Regression suites reject connection credentials and require a nonempty run instead of reporting vacuous success',async()=>{
 assert.throws(()=>validateSuite(suite([one({request:{...request,password:'must-not-be-persisted'}})])),/quality_invalid_suite/);
 assert.throws(()=>validateSuite({...suite(),connection:{password:'must-not-be-persisted'}}),/quality_invalid_suite/);
 await assert.rejects(runRegressionSuite(suite([]),'oracle',{stored(){throw Error('unexpected');},query(){throw Error('unexpected');}}),/quality_no_cases/);
});
test('Desktop observers capture completed main requests only and ignore late responses from a previous generation',async()=>{
 const {createDesktopClient}=loadTypeScript('src/shared/api/createDesktopClient.ts'),pending=[],seen=[];
 const client=createDesktopClient({invoke:()=>new Promise(resolve=>pending.push(resolve)),on(){}},()=>{},(...args)=>seen.push(args));
 const old=client.invoke('execute-stored',request);client.resetGlobalLoading();pending.shift()({success:true,...data});await old;assert.equal(seen.length,0);
 const current=client.invoke('execute-stored',request);pending.shift()({success:true,...data});await current;assert.equal(seen.length,1);assert.equal(seen[0][0],'execute-stored');assert.equal(seen[0][1][0],request);
});
test('Regression output shape changes are assertion failures with actual evidence rather than transport errors',async()=>{
 const expected=captureResult(['before'],[{before:1}]),entry=one({expected:{returnValues:[],resultSets:[expected]}});
 const outcomes=await runRegressionSuite(suite([entry]),'oracle',{stored:async()=>({success:true,resultSets:[{rows:[{after:1}],metaData:[{name:'after'}]}]}),query(){throw Error('unexpected');}});
 assert.equal(outcomes[0].status,'failed');assert.deepEqual(plain(outcomes[0].actual.resultSets[0].columns),['after']);
});
