// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {getProcedure}=require('./procedureService'),{getTrigger}=require('./triggerService'),{describeTraceTables}=require('./traceTables'),{buildTraceProgram}=require('./traceProgram');
async function getTraceInputs(client,request){
 if(!request||!['FUNCTION','PROCEDURE','TRIGGER'].includes(request.kind))throw new Error('Invalid MySQL trace input target.');
 const info=request.kind==='TRIGGER'?await getTrigger(client,request):await getProcedure(client,request,request.kind);if(info.fingerprint!==request.fingerprint)throw new Error('The saved source changed. Refresh before tracing.');
 const source=info.source||info.body,tables=await describeTraceTables(client,{schema:info.schema,source});
 if(request.kind==='TRIGGER'){const spec=await require('./triggerTraceService').getTriggerTraceInputs(client,request);if(spec.trigger.fingerprint!==info.fingerprint)throw new Error('The trigger changed while loading its inputs.');buildTraceProgram({...info,kind:'TRIGGER',parameters:[],source:info.body,copyTable:'mbt_preview_target',traceColumns:spec.columns,traceTables:tables.map((t,i)=>({...t,copyName:t.name===info.table?'mbt_preview_target':'mbt_preview_t'+i}))},'mbt_preview');}
 else buildTraceProgram({...info,traceTables:tables.map((t,i)=>({...t,copyName:'mbt_preview_t'+i}))},'mbt_preview');
 return {fingerprint:info.fingerprint,tables};
}
module.exports={getTraceInputs};
