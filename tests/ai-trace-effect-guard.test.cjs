// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createProgram, iterationAt, traceEvidence, validateDiagnosis } = require('./live-ai/trace-effect.cjs');
const { createPaidSession } = require('./live-ai/effect.cjs');
function fixture(db) {
  const spec = createProgram(db, db === 'oracle' ? 'TEST' : 'test', 'MBT_012345ABCDEF_LOOP');
  const row = (id, i, total, amount, line = 8) => ({ step_id: id, line_num: line, loop_path: i ? `L1_iter${i}` : '', variables_json: JSON.stringify({ V_TOTAL: String(total), V_AMOUNT: String(amount), ...(db === 'postgresql' && i ? { I: String(i) } : {}) }) });
  const trace = { traceInfo: { arguments: '{}' }, traceSteps: [row(1,1,0,10),row(2,2,10,20),row(3,3,30,30,spec.line),row(4,3,0,30,11),row(5,4,0,40),row(6,5,40,50),row(7,null,90,50,15)] };
  const diagnosis = { line: spec.line, iteration: 3, before: 30, amount: 30, after: 0, expectedAfter: 60, actualFinal: 90, expectedFinal: 150, evidenceStepIds: [3,4], cause: '3回目に加算でなく減算を行うため。', replacement: 'v_total := v_total + v_amount;' };
  return { spec, trace, diagnosis };
}
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: correct trace diagnosis requires real before/after evidence and an exact one-line repair`, () => {
    const {spec,trace,diagnosis} = fixture(db);
    assert.equal(spec.expected,150); assert.equal(spec.line,10);
    assert.deepEqual(traceEvidence(trace,spec), {before:[3],after:[4]});
    assert.equal(iterationAt(trace.traceSteps[2]),3);
    assert.equal(validateDiagnosis(JSON.stringify(diagnosis),spec,trace).iteration,3);
    assert.equal(validateDiagnosis('```json\n'+JSON.stringify(diagnosis)+'\n```',spec,trace).line,10);
    for (const [field,value] of Object.entries({line:11,iteration:2,before:0,amount:20,after:60,expectedAfter:0,actualFinal:150,expectedFinal:90,evidenceStepIds:[3,999],cause:'',replacement:'v_total := v_total + v_amount; DELETE FROM t;'})) {
      assert.throws(()=>validateDiagnosis(JSON.stringify({...diagnosis,[field]:value}),spec,trace),field);
    }
    for (const ids of [[1,4],[3,5],[3,3]]) assert.throws(()=>validateDiagnosis(JSON.stringify({...diagnosis,evidenceStepIds:ids}),spec,trace));
    assert.throws(()=>createProgram(db,'production','MBT_012345ABCDEF_LOOP'));
    assert.throws(()=>createProgram(db,'test','EXISTING'));
  });
  test(`${db}: missing or changed snapshots cannot pass merely by guessing the bug from source`, () => {
    const {spec,trace,diagnosis}=fixture(db);
    const altered=structuredClone(trace); altered.traceSteps[3].variables_json=JSON.stringify({V_TOTAL:'60',V_AMOUNT:'30',...(db==='postgresql'?{I:'3'}:{})});
    assert.throws(()=>validateDiagnosis(JSON.stringify(diagnosis),spec,altered));
    const missing=structuredClone(trace); missing.traceSteps=missing.traceSteps.filter(step=>step.step_id!==6);
    assert.throws(()=>traceEvidence(missing,spec));
  });
}

test('Trace AI transport uses debug_function and rejects a third paid attempt without sending it', async () => {
  let calls=0;
  const paid=createPaidSession('sk-fictional-trace-effect-test-key',async(url,options)=>{
    calls++; const payload=JSON.parse(options.body); assert.equal(payload.max_completion_tokens,1024); assert.equal(payload.model,'gpt-4o-mini');
    return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}),{headers:{'content-type':'application/json'}});
  },{requestType:'debug_function',maxRequests:2});
  try { await paid.ask('Synthetic trace.'); await paid.ask('Synthetic trace.'); await assert.rejects(paid.ask('Do not send.'),/ceiling/); assert.equal(calls,2); }
  finally { paid.dispose(); }
  assert.throws(()=>createPaidSession('fictional',async()=>{},{requestType:'arbitrary',maxRequests:2}));
  assert.throws(()=>createPaidSession('fictional',async()=>{},{requestType:'debug_function',maxRequests:5}));
});


test('An adjacent IF snapshot with identical inputs is valid evidence, but another iteration is not', () => {
  const {spec,trace,diagnosis}=fixture('oracle');
  trace.traceSteps.splice(2,0,{step_id:8,line_num:9,loop_path:'L1_iter3',variables_json:JSON.stringify({V_TOTAL:'30',V_AMOUNT:'30'})});
  trace.traceSteps[2].step_id=3;trace.traceSteps[3].step_id=4;trace.traceSteps[4].step_id=5;
  trace.traceSteps[5].step_id=6;trace.traceSteps[6].step_id=7;trace.traceSteps[7].step_id=8;
  assert.equal(validateDiagnosis(JSON.stringify({...diagnosis,evidenceStepIds:[3,5]}),spec,trace).line,10);
  assert.throws(()=>validateDiagnosis(JSON.stringify({...diagnosis,evidenceStepIds:[2,5]}),spec,trace));
});
