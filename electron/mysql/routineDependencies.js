// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {scanSql}=require('../services/sqlTokens');
const {getProcedure}=require('./procedureService');
const id=t=>t?.kind==='word'?t.text:t?.kind==='quoted'&&t.text[0]==='`'?t.text.slice(1,-1).replaceAll('``','`'):null;
function sourceReferences(source,schema,objects){
 const tokens=scanSql(source,'mysql'),found=new Map();
 const add=(i,kind)=>{let name=id(tokens[i]),db=schema;if(!name)return;if(tokens[i+1]?.text==='.'){db=name;name=id(tokens[i+2]);i+=2;}if(!name)return;const target=objects.find(o=>o.schema===db&&o.name.toLowerCase()===name.toLowerCase()&&(kind==='TABLE'?['TABLE','VIEW'].includes(o.type):o.type===kind));if(target)found.set(JSON.stringify([target.schema,target.type,target.name]),{...target,evidence:'source'});};
 for(let i=0;i<tokens.length;i++){const word=tokens[i].kind==='word'?tokens[i].text.toUpperCase():'';if(['FROM','JOIN','UPDATE'].includes(word)||word==='INTO'&&tokens[i-1]?.text.toUpperCase()==='INSERT')add(i+1,'TABLE');if(word==='CALL')add(i+1,'PROCEDURE');if(tokens[i-1]?.text!=='.'&&id(tokens[i])&&tokens[i+1]?.text==='(')add(i,'FUNCTION');if(id(tokens[i])&&tokens[i+1]?.text==='.'&&tokens[i+3]?.text==='(')add(i,'FUNCTION');}
 return [...found.values()];
}
async function getRoutineDependencies(client,request){
 if(!request||!['PROCEDURE','FUNCTION'].includes(request.kind))throw new Error('Invalid routine dependency target.');
 const info=await getProcedure(client,request,request.kind);if(request.fingerprint!==info.fingerprint)throw new Error('The routine changed. Refresh its saved definition first.');
 const query=async(sql,binds={schema:info.schema})=>(await client.execute(sql,binds,null,false,true)).rows;
 const [tables,routines,triggers]=await Promise.all([
 query('SELECT TABLE_SCHEMA,TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema ORDER BY TABLE_NAME LIMIT 1001'),
 query('SELECT ROUTINE_SCHEMA,ROUTINE_NAME,ROUTINE_TYPE,ROUTINE_DEFINITION FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=:schema ORDER BY ROUTINE_TYPE,ROUTINE_NAME LIMIT 501'),
 query('SELECT TRIGGER_SCHEMA,TRIGGER_NAME,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=:schema ORDER BY TRIGGER_NAME LIMIT 501')]);
 const objects=[...tables.slice(0,1000).map(r=>({schema:String(r.TABLE_SCHEMA),name:String(r.TABLE_NAME),type:r.TABLE_TYPE==='VIEW'?'VIEW':'TABLE'})),...routines.slice(0,500).map(r=>({schema:String(r.ROUTINE_SCHEMA),name:String(r.ROUTINE_NAME),type:String(r.ROUTINE_TYPE)}))];
 let limited=tables.length>1000||routines.length>500||triggers.length>500,unreadable=0,bytes=0;const dependents=new Map();
 const add=(row,evidence)=>dependents.set(JSON.stringify([row.schema,row.type,row.name]),{...row,evidence});
 if(info.kind==='FUNCTION'){const views=await query('SELECT TABLE_SCHEMA,TABLE_NAME FROM information_schema.VIEW_ROUTINE_USAGE WHERE SPECIFIC_SCHEMA=:schema AND SPECIFIC_NAME=:name LIMIT 1001',{schema:info.schema,name:info.name});if(views.length>1000)limited=true;for(const r of views.slice(0,1000))add({schema:String(r.TABLE_SCHEMA),name:String(r.TABLE_NAME),type:'VIEW'},'catalog');}
 for(const row of [...routines.slice(0,500).map(r=>({schema:String(r.ROUTINE_SCHEMA),name:String(r.ROUTINE_NAME),type:String(r.ROUTINE_TYPE),source:r.ROUTINE_DEFINITION})),...triggers.slice(0,500).map(r=>({schema:String(r.TRIGGER_SCHEMA),name:String(r.TRIGGER_NAME),type:'TRIGGER',source:r.ACTION_STATEMENT}))]){
  if(typeof row.source!=='string'){unreadable++;continue;}bytes+=Buffer.byteLength(row.source);if(bytes>8*1024*1024){limited=true;break;}
  try{if(sourceReferences(row.source,info.schema,objects).some(r=>r.type===info.kind&&r.schema===info.schema&&r.name.toLowerCase()===info.name.toLowerCase()))add({schema:row.schema,name:row.name,type:row.type},'source');}catch{unreadable++;}
 }
 const own=await query(`SELECT ROUTINE_DEFINITION FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=:schema AND ROUTINE_NAME=:name AND ROUTINE_TYPE=:kind`,{schema:info.schema,name:info.name,kind:info.kind});if(typeof own[0]?.ROUTINE_DEFINITION!=='string')unreadable++;
 return {references:typeof own[0]?.ROUTINE_DEFINITION==='string'?sourceReferences(own[0].ROUTINE_DEFINITION,info.schema,objects):[],dependents:[...dependents.values()],limited,unreadable,scope:'visible-current-database',fingerprint:info.fingerprint};
}
module.exports={sourceReferences,getRoutineDependencies};
