// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {randomUUID}=require('node:crypto');
const {parseFile,parseDefinition}=require('./definitionImport');
const {getProcedure,mutateProcedure}=require('./procedureService');
const {parseProcedure,buildProcedure}=require('./procedureDefinition');
const {getTrigger,mutateTrigger}=require('./triggerService');
const {buildTrigger,quoteTriggerIdentifier:q}=require('./triggerDefinition');
const tickets=new WeakMap();
function writable(client){if(!client.main||client.closing||client.readonly||client.getMainTransactionState()!==false)throw new Error('Finish pending changes and use a writable connection with known transaction state before importing definitions.');}
async function prepare(client,item){
 const rows=(await client.execute(item.kind==='TRIGGER'?'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=:schema AND TRIGGER_NAME=:name':`SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=:schema AND ROUTINE_NAME=:name AND ROUTINE_TYPE='${item.kind}'`,item,null,false,true)).rows;
 const original=rows.length?item.kind==='TRIGGER'?await getTrigger(client,item):await getProcedure(client,item,item.kind):null;
 const originalDefiner=original?item.kind==='TRIGGER'?parseDefinition(original.native,item.schema).definer:parseProcedure(original.source,item.schema,item.name,item.kind).definer:undefined;
 if(item.definer&&item.definer!==originalDefiner&&!/^CURRENT_USER(?:\s*\(\s*\))?$/i.test(item.definer))throw new Error('Imported DEFINER must be CURRENT_USER, omitted, or match the existing object.');
 if(original&&(/\b(ANSI_QUOTES|NO_BACKSLASH_ESCAPES)\b/.test(original.mode)||!/^utf8(?:mb3|mb4)?$/i.test(original.charset)))throw new Error('This saved SQL mode or character set is not supported for import.');
 if(item.kind==='TRIGGER'){
  if(original&&original.table!==item.table)throw new Error('Import cannot move a trigger to another table.');
  const table=(await client.execute('SELECT ENGINE,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table',item,null,false,true)).rows;if(table.length!==1||table[0].ENGINE!=='InnoDB'||table[0].TABLE_TYPE!=='BASE TABLE')throw new Error('Trigger import requires an existing InnoDB table.');
 }
 const index=original?.peers?.indexOf(item.name)??-1,order=item.kind==='TRIGGER'&&original&&original.timing===item.timing&&original.event===item.event?(index>=0&&index+1<original.peers.length?'PRECEDES '+q(original.peers[index+1]):index>0?'FOLLOWS '+q(original.peers[index-1]):''):'';
 const create=item.kind==='TRIGGER'?buildTrigger(item,originalDefiner||'CURRENT_USER',order):buildProcedure(item.source,item.schema,item.name,originalDefiner||'CURRENT_USER',item.kind);
 return {...item,operation:original?'replace':'create',fingerprint:original?.fingerprint,sql:(original?`DROP ${item.kind} ${q(item.schema)}.${q(item.name)};\n`:'')+create};
}
async function review(client,input){
 writable(client);if(!input||typeof input.schema!=='string')throw new Error('Choose a target database.');const items=parseFile(input.source,input.schema),plan=[];for(const item of items)plan.push(await prepare(client,item));const token=randomUUID(),map=tickets.get(client)||new Map();tickets.set(client,map);map.set(token,{at:Date.now(),plan});while(map.size>8)map.delete(map.keys().next().value);
 return {token,items:plan.map(({schema,name,kind,operation,sql})=>({schema,name,kind,operation,sql}))};
}
async function execute(client,input){return client.enqueue(async()=>{
 writable(client);const map=tickets.get(client),ticket=map?.get(input?.token);if(!ticket||Date.now()-ticket.at>5*60000)throw new Error('Import review expired. Review the file again.');map.delete(input.token);
 // All original targets are checked before the first DDL. Never silently replace a newly appeared object.
 for(const item of ticket.plan){const current=await prepare(client,item);if(current.operation!==item.operation||current.fingerprint!==item.fingerprint)throw new Error('A definition changed after review. No import was started.');}
 // Reuse reviewed per-object services while holding the original main queue for the entire batch.
 const results=[];
 for(const item of ticket.plan){
  let result;try{if(client.getMainTransactionState()!==false)throw new Error('The main transaction state is no longer idle.');const fresh=await prepare(client,item);if(fresh.operation!==item.operation||fresh.fingerprint!==item.fingerprint)throw new Error('This definition changed during import. Review remaining targets.');result=item.kind==='TRIGGER'?await mutateTrigger(client,item,{alreadyQueued:true}):await mutateProcedure(client,item,item.kind,{alreadyQueued:true});}catch(error){result={success:false,applied:false,stage:client.getMainTransactionState()===null?'unknown':'unchanged',error:error.message};}
  const native=result.trigger?.native||result.procedure?.native;results.push({schema:item.schema,name:item.name,kind:item.kind,success:result.success,applied:Boolean(result.applied),stage:result.stage,error:result.error,recovery:result.recovery,native});if(!result.success)break;
 }
 return {success:results.length===ticket.plan.length&&results.every(r=>r.success),results,total:ticket.plan.length,error:results.some(r=>!r.success)?'Import stopped. Earlier DDL remains applied. Review results; do not resend the whole file.':undefined};
});}
module.exports={review,execute};
