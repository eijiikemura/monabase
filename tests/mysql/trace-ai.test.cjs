// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),{runCase}=require('../live-ai/mysql-trace-effect.cjs');
for(const kind of ['FUNCTION','PROCEDURE'])test('MySQL '+kind+' trace AI pipeline uses persisted production evidence and verifies the narrowly reviewed repair without paid requests',{timeout:15000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');let calls=0;
 const result=await runCase(kind,async prompt=>{
  calls++;assert.ok(prompt.includes('MySQL 8.4'));assert.ok(prompt.includes('log_text identifies before/after'));assert.ok(!prompt.includes('[TRACE LINE]'),'MySQL direct JSON snapshots must not inherit legacy marker timing instructions.');
  const payload=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"currentSource"'))),trace=payload.trace,line=trace.traceInfo.executed_source.split('\n').findIndex(line=>line.includes('v_total - v_amount'))+1;
  const evidence=trace.traceSteps.filter(s=>s.line_num===line&&s.loop_path==='L1_iter3');assert.equal(evidence.length,2);
  return {answer:JSON.stringify({line,iteration:3,before:30,after:0,operator:'+',explanation:'Synthetic test response, not an AI result.',evidenceStepIds:evidence.map(s=>s.step_id)}),usage:{promptTokens:1,completionTokens:1}};
 });assert.equal(calls,1);assert.equal(result.status,'passed');assert.equal(result.afterResult,150);
});
