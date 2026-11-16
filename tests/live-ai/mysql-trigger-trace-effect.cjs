// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomBytes}=require('node:crypto');
const Client=require('../../electron/mysql/mysqlClient'),{getTriggerTraceInputs,executeMysqlTriggerTrace}=require('../../electron/mysql/triggerTraceService'),{createTraceDatabase}=require('../../electron/services/traceStore'),{createTraceIdentity}=require('../../electron/services/traceFiles');
const {triggerLoopBody}=require('../helpers/mysqlTrace.cjs'),{buildTracePrompt}=require('./trace-effect.cjs'),{createPaidSession}=require('./effect.cjs'),{readKey}=require('./runner.cjs'),{safeAiError}=require('../../electron/services/aiErrors');
function authorize(args,env=process.env){if(env.CI&&env.CI!=='false'||!args.includes('--allow-paid')||args.some(arg=>arg!=='--allow-paid'&&!/^--resume=mysql-trigger-trace-effect-\d+\.json$/.test(arg))||args.filter(arg=>arg.startsWith('--resume=')).length>1)throw new Error('Explicit fresh paid authorization required; CI and arbitrary resume paths are forbidden.');}
function validateDiagnosis(answer,trace){
 const value=JSON.parse(answer.trim().replace(/^```json\s*\n([\s\S]*?)\n?```$/i,'$1'));
 const line=trace.traceInfo.executed_source.split('\n').findIndex(line=>line.includes('v_total - v_amount'))+1;
 assert.equal(value.line,line,'AI must identify the faulty original source line.');assert.equal(value.iteration,3);assert.match(String(value.before),/^30(?:\.0+)?$/);assert.match(String(value.after),/^0(?:\.0+)?$/);assert.equal(value.operator,'+');assert.ok(typeof value.explanation==='string'&&value.explanation.trim());
 const evidence=trace.traceSteps.filter(s=>s.line_num===line&&s.loop_path==='L1_iter3'),ids=evidence.map(s=>s.step_id);
 assert.ok(Array.isArray(value.evidenceStepIds)&&value.evidenceStepIds.length>=2);assert.ok(value.evidenceStepIds.every(id=>ids.includes(id)),'AI must cite real faulty-line steps.');
 for(const phase of ['before','after'])assert.ok(evidence.some(s=>s.log_text===phase&&value.evidenceStepIds.includes(s.step_id)),'Missing '+phase+' evidence.');return value;
}
async function runCase(kind,ask,onObservation=()=>{}){
 assert.ok(['INSERT','UPDATE'].includes(kind));
 const c=new Client(),base='MBT_'+randomBytes(6).toString('hex'),name=base+'_ai',fixed=base+'_fixed',table=base+'_t',directory=fs.mkdtempSync(path.join(os.tmpdir(),'mb-ai-trigger-')),Database=createTraceDatabase('mysql',{getStoragePaths:()=>({traceDirectory:directory})});let created=false,fixedCreated=false,tableCreated=false;
 const query=(sql,values=[])=>c.main.promise().query(sql,values),q=s=>'`'+s+'`';
 const run=async(target,input)=>{const spec=await getTriggerTraceInputs(c,{schema:'mb_test',name:target});return executeMysqlTriggerTrace(c,{schema:'mb_test',objectName:target,objectType:'TRIGGER',sourceText:spec.trigger.body,mysqlFingerprint:spec.trigger.fingerprint,mysqlTableFingerprint:spec.tableFingerprint,triggerInput:input},{Database});};
 const input={oldRow:kind==='UPDATE'?{id:7,n:1,total:'10'}:{},newRow:{id:7,n:5,total:'0'}};
 try{await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});
 await query('CREATE TABLE '+q(table)+' (id INT PRIMARY KEY,n INT,total DECIMAL(30,2)) ENGINE=InnoDB');tableCreated=true;
 await query(`CREATE TRIGGER ${q(name)} BEFORE ${kind} ON ${q(table)} FOR EACH ROW ${triggerLoopBody()}`);created=true;
 const info=(await getTriggerTraceInputs(c,{schema:'mb_test',name})).trigger,result=await run(name,input);assert.equal(result.info.trigger_outcome[0].total,'90.00');
 const db=new Database(createTraceIdentity(c.lastConfig,{schema:'mb_test',objectName:name,objectType:'TRIGGER'}));await db.init();const trace={traceInfo:await db.getTraceInfo(),traceSteps:await db.getTraceSteps()};db.close();
 const reference=await buildTracePrompt(c,{db:'mysql',schema:'mb_test',name,kind:'TRIGGER',source:info.body},directory,Database);
 const prompt=reference+'\nUser requirement: This BEFORE '+kind+' trigger should set NEW.total to the sum of i * 10 for i=1 through NEW.n. For NEW.n=5, expected total is 150, but the isolated resulting row has total=90. Diagnose the bug using actual trace evidence. Return only JSON with line (original body line), iteration, before (total before the faulty assignment), after (total after it), operator (replacement arithmetic operator), explanation and evidenceStepIds (a JSON ARRAY of integer IDs, such as [12,13], for the real before and after steps of that assignment; not an object). Do not execute code or claim DB access.';
 const response=await ask(prompt);onObservation({kind,source:info.body,trace,answer:response.answer,usage:response.usage,status:'received-not-validated'});
 const diagnosis=validateDiagnosis(response.answer,trace),repaired=info.body.split('\n');assert.ok(repaired[diagnosis.line-1].includes('v_total - v_amount'));repaired[diagnosis.line-1]=repaired[diagnosis.line-1].replace('v_total - v_amount','v_total + v_amount');assert.equal(repaired.join('\n'),triggerLoopBody(true));
 // Apply only the reviewed arithmetic replacement to our own disposable fixture.
 await query('DROP TRIGGER '+q(name));created=false;
 await query(`CREATE TRIGGER ${q(fixed)} BEFORE ${kind} ON ${q(table)} FOR EACH ROW ${repaired.join('\n')}`);fixedCreated=true;
 for(const [n,expected] of [[0,0],[1,10],[5,150],[null,0]]){if(kind==='UPDATE')await query('INSERT INTO '+q(table)+' VALUES(7,1,10)');if(kind==='INSERT')await query('INSERT INTO '+q(table)+' VALUES(7,?,0)',[n]);else await query('UPDATE '+q(table)+' SET n=? WHERE id=7',[n]);const [rows]=await query('SELECT total FROM '+q(table));assert.equal(Number(rows[0][0]),expected);await c.rollback();}
 const after=await run(fixed,input);assert.equal(after.info.trigger_outcome[0].total,'150.00');assert.ok(after.steps.some(s=>s.loopPath==='L1_iter3'&&Number(s.variables.v_total)===60));assert.equal(Number((await query('SELECT COUNT(*) FROM '+q(table)))[0][0][0]),0);
 return {kind,status:'passed',diagnosis,beforeResult:90,afterResult:150,usage:response.usage,source:info.body,trace,answer:response.answer};
 }finally{try{await c.rollback();if(fixedCreated)await query('DROP TRIGGER '+q(fixed));if(created)await query('DROP TRIGGER '+q(name));if(tableCreated)await query('DROP TABLE '+q(table));}finally{await c.disconnect();fs.rmSync(directory,{recursive:true,force:true});}}
}
async function verifySaved(name){
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');assert.match(name,/^mysql-trigger-trace-effect-\d+\.json$/);const file=path.resolve('local/ai-test-reports',name),report=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const attempt of report.attempts){if(!attempt.answer||report.results.some(r=>r.kind===attempt.kind&&r.status==='passed'))continue;validateDiagnosis(attempt.answer,attempt.trace);const result=await runCase(attempt.kind,async()=>({answer:attempt.answer,usage:attempt.usage}));report.results.push({...result,reusedPaidAnswer:true});attempt.status='passed-after-validator-fix';fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log('PASS saved '+attempt.kind+' diagnosis and native repair; no API requests.');}
}
async function main(){
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1','Explicit disposable MySQL opt-in is required.');
 if(process.argv.length===3&&process.argv[2].startsWith('--verify-saved=')){await verifySaved(process.argv[2].slice(15));return;}
 authorize(process.argv.slice(2));const directory=path.resolve('local/ai-test-reports');fs.mkdirSync(directory,{recursive:true});const resume=process.argv.find(arg=>arg.startsWith('--resume='))?.slice(9),file=path.join(directory,resume||'mysql-trigger-trace-effect-'+Date.now()+'.json');const report=resume?JSON.parse(fs.readFileSync(file,'utf8')):{model:'gpt-6-luna',maxRequests:10,requests:0,results:[],attempts:[]};assert.equal(report.model,'gpt-6-luna');assert.equal(report.maxRequests,10);assert.ok(Number.isInteger(report.requests)&&report.requests>=0&&report.requests<10);const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log('Paid MySQL trigger trace verification: gpt-6-luna, at most '+(10-report.requests)+' remaining HTTP requests, 4096 output tokens each. Initial run needs only two diagnoses. Supply key on non-echo stdin.');let key=await readKey();
 try{for(const kind of ['INSERT','UPDATE']){if(report.results.some(r=>r.kind===kind&&r.status==='passed'))continue;const attempt={kind,status:'prepared'};report.attempts.push(attempt);save();
 const paid=createPaidSession(key,async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.ok(report.requests<10,'Ten-request ceiling reached.');report.requests++;attempt.status='submitted';save();return fetch(url,options);},{model:'gpt-6-luna',requestType:'debug_trigger',maxRequests:1});
 try{const result=await runCase(kind,prompt=>paid.ask(prompt),observation=>{Object.assign(attempt,observation);save();});report.results.push(result);attempt.status='passed';save();console.log('PASS MySQL '+kind+' diagnosis, actual recorded evidence and verified one-line repair (90 -> 150).');}
 catch(error){attempt.status='failed';attempt.error=safeAiError(error.message,key);save();throw error;}finally{paid.dispose();}}
 console.log('PASS paid requests='+report.requests+'; report='+path.relative(process.cwd(),file));
 }finally{key='';console.log('Report: '+path.relative(process.cwd(),file));}
}
if(require.main===module)main().catch(error=>{console.error(safeAiError(error.message));process.exitCode=1;});
module.exports={authorize,validateDiagnosis,runCase,main};
