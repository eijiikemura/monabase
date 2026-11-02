// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {test}=require('node:test');
const {plan,validateAnswer,inspectSource,digest,loadReviewed}=require('./live-ai/program-effect.cjs');
const {referenceAnswer}=require('./live-ai/program-fixtures.cjs');
const specs=plan('MBT_012345ABCDEF');
for(const spec of specs)test(`${spec.db} ${spec.kind}: production prompt review/adoption accepts the declared identity and response contract`,()=>{
  const answer=referenceAnswer(spec);const adopted=validateAnswer(answer,spec);assert.ok(adopted.source);
  if(spec.kind==='TRIGGER')assert.equal(adopted.settings.forEachRow,true);
  else assert.throws(()=>validateAnswer(answer.replaceAll(spec.name,'EXISTING_OBJECT'),spec));
});
test('Program source guard rejects additional definitions, unsafe execution and other schemas',()=>{
  const spec=specs[0],source=JSON.parse(referenceAnswer(spec)).source;
  for(const extra of ['DROP TABLE x;','COMMIT;','EXECUTE dynamic_text;','CREATE FUNCTION x() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$;'])assert.throws(()=>inspectSource(source+'\n'+extra,spec));
  assert.throws(()=>inspectSource(source.replaceAll('"test"','"production"'),spec));
  const proc=specs.find(s=>s.kind==='PROCEDURE');assert.throws(()=>inspectSource(JSON.parse(referenceAnswer(proc)).source.replaceAll(proc.table,'EXISTING_TABLE'),proc));
});
test('Review fingerprint prevents changed code/specs from entering the real DB phase',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mb-program-guard-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'responses.json');const record={token:'MBT_012345ABCDEF',entries:specs.map(spec=>({spec,answer:referenceAnswer(spec)}))};fs.writeFileSync(file,JSON.stringify(record));
  const hash=digest(fs.readFileSync(file));assert.equal(loadReviewed(file,hash).entries.length,8);
  fs.appendFileSync(file,' ');assert.throws(()=>loadReviewed(file,hash));
  record.entries[0].spec.name='EXISTING';fs.writeFileSync(file,JSON.stringify(record));assert.throws(()=>loadReviewed(file,digest(fs.readFileSync(file))));
});

test('Missing trigger message remains a format failure while the separate diagnostic preserves original code',()=>{
  const {diagnosticTrigger}=require('./live-ai/program-effect.cjs');
  const spec=specs.find(s=>s.kind==='TRIGGER');const value=JSON.parse(referenceAnswer(spec));delete value.message;
  assert.throws(()=>validateAnswer(JSON.stringify(value),spec));
  assert.equal(diagnosticTrigger(JSON.stringify(value),spec).source,value.source);
  assert.throws(()=>diagnosticTrigger(JSON.stringify({...value,source:'CREATE FUNCTION other()'}),spec));
});

test('Controlled model comparison keeps the same endpoint, request type and output limit',async()=>{
  const {createPaidSession}=require('./live-ai/effect.cjs');
  const paid=createPaidSession('sk-fictional-program-model-comparison',async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/chat/completions');const payload=JSON.parse(options.body);assert.equal(payload.model,'gpt-4.1-mini');assert.equal(payload.max_completion_tokens,1024);
    return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}),{headers:{'content-type':'application/json'}});
  },{requestType:'coding_function',maxRequests:1,model:'gpt-4.1-mini'});
  try{await paid.ask('Synthetic program only.');await assert.rejects(paid.ask('No second call.'),/ceiling/);}finally{paid.dispose();}
  assert.throws(()=>createPaidSession('fictional',async()=>{},{model:'unreviewed-model'}));
});

test('Every program entry mode refuses CI before opening config files or consuming a key',()=>{
  const {spawnSync}=require('node:child_process');
  for(const args of [['--allow-paid'],['--fixtures-only'],['--verify=does-not-exist','--review-sha256=x']]){
    const child=spawnSync(process.execPath,['tests/live-ai/program-effect.cjs',...args],{cwd:path.resolve(__dirname,'..'),env:{...process.env,CI:'true',MONABASE_TEST_CONFIG:'does-not-exist'},input:'sk-fictional-ci-program-key',encoding:'utf8',timeout:10000});
    assert.equal(child.status,1);assert.match(child.stderr,/forbidden in CI/);assert.ok(!child.stderr.includes('sk-fictional-ci-program-key'));
  }
});

test('Explicit GPT-6 Luna comparison preserves default reasoning and bounds all completion tokens',async()=>{
  const {createPaidSession}=require('./live-ai/effect.cjs');let calls=0;
  const paid=createPaidSession('sk-fictional-luna-program-comparison',async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');
    const payload=JSON.parse(options.body);assert.equal(payload.model,'gpt-6-luna');assert.equal(payload.max_completion_tokens,4096);
    assert.equal(payload.reasoning_effort,undefined);assert.equal(payload.tools,undefined);
    return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:2}}),{headers:{'content-type':'application/json'}});
  },{requestType:'coding_package',maxRequests:1,model:'gpt-6-luna'});
  try{await paid.ask('Synthetic package only.');await assert.rejects(paid.ask('No retry.'),/ceiling/);assert.equal(calls,1);}finally{paid.dispose();}
});
