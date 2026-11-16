// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {scanSql}=require('../services/sqlTokens');
const {validateLexical,validateBody,quoteTriggerIdentifier:q}=require('./triggerDefinition');
const {parseProcedure}=require('./procedureDefinition');
function splitDefinitions(source){
 if(typeof source!=='string'||Buffer.byteLength(source)>1024*1024||source.includes('\0'))throw new Error('Definition files must be text of at most 1 MiB.');validateLexical(source);
 let delimiter=';',buffer='',quote=null;const result=[];
 for(let i=0;i<source.length;){
  if(!quote&&(i===0||source[i-1]==='\n')){const match=/^[\t ]*DELIMITER[\t ]+(\S+)[\t ]*(?:\r?\n|$)/i.exec(source.slice(i));if(match){if(scanSql(buffer,'mysql').length)throw new Error('DELIMITER cannot interrupt a definition.');delimiter=match[1];if(!/^[!$%&*+/:;<=>?^|~_-]{1,16}$/.test(delimiter)||delimiter.startsWith('--')||delimiter.startsWith('/*'))throw new Error('Unsupported DELIMITER.');buffer='';i+=match[0].length;continue;}}
  const c=source[i];if(quote){buffer+=c;i++;if(c==='\\'&&quote!=='`'){buffer+=source[i++]||'';}else if(c===quote){if(source[i]===quote)buffer+=source[i++];else quote=null;}continue;}
  if(source.startsWith(delimiter,i)){if(scanSql(buffer,'mysql').length)result.push(buffer.trim());buffer='';i+=delimiter.length;if(result.length>50)throw new Error('Import at most 50 definitions per file.');continue;}
  if(c==='#'||source.startsWith('--',i)&&(!source[i+2]||/\s/.test(source[i+2]))){const end=source.indexOf('\n',i);buffer+=source.slice(i,end<0?source.length:end);i=end<0?source.length:end;continue;}
  if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);buffer+=source.slice(i,end+2);i=end+2;continue;}
  if(['`',"'",'"'].includes(c))quote=c;buffer+=c;i++;
 }
 if(scanSql(buffer,'mysql').length){if(delimiter!==';')throw new Error('The final definition is missing its delimiter.');result.push(buffer.trim());}
 if(!result.length||result.length>50)throw new Error('Import 1 to 50 definitions.');return result;
}
function parseDefinition(source,schema){
 q(schema);const tokens=scanSql(source,'mysql');let i=0;
 const word=()=>tokens[i]?.kind==='word'?tokens[i].text.toUpperCase():'';
 const expect=value=>{if(word()!==value)throw new Error('Only complete CREATE PROCEDURE/FUNCTION/TRIGGER definitions are accepted.');i++;};
 const id=()=>{const token=tokens[i++];if(token?.kind==='word')return token.text;if(token?.kind==='quoted'&&token.text[0]==='`')return token.text.slice(1,-1).replaceAll('``','`');throw new Error('Invalid definition identifier.');};
 const qualified=()=>{let name=id(),database=schema;if(tokens[i]?.text==='.'){i++;database=name;name=id();}if(database!==schema)throw new Error('Every imported definition must belong to the selected database.');q(name);return name;};
 expect('CREATE');let definer;
 if(word()==='DEFINER'){i++;if(tokens[i++]?.text!=='=')throw new Error('Invalid DEFINER.');const start=tokens[i]?.start;if(word()==='CURRENT_USER'){i++;if(tokens[i]?.text==='('){i++;if(tokens[i++]?.text!==')')throw new Error('Invalid DEFINER.');}}else{if(!['word','quoted'].includes(tokens[i++]?.kind)||tokens[i++]?.text!=='@'||!['word','quoted'].includes(tokens[i++]?.kind))throw new Error('Invalid DEFINER.');}definer=source.slice(start,tokens[i-1].end);}
 const kind=word();if(!['PROCEDURE','FUNCTION','TRIGGER'].includes(kind))throw new Error('Only CREATE PROCEDURE/FUNCTION/TRIGGER may be imported. No other statements are executed.');i++;const name=qualified();
 if(kind!=='TRIGGER'){parseProcedure(source,schema,name,kind);return {schema,name,kind,source,definer};}
 const timing=word();i++;const event=word();i++;if(!['BEFORE','AFTER'].includes(timing)||!['INSERT','UPDATE','DELETE'].includes(event))throw new Error('Unsupported trigger timing/event.');expect('ON');const table=qualified();expect('FOR');expect('EACH');expect('ROW');if(!tokens[i])throw new Error('Missing trigger body.');const body=validateBody(source.slice(tokens[i].start));return {schema,name,kind,source,definer,table,timing,event,body};
}
function parseFile(source,schema){if(typeof source!=='string'||Buffer.byteLength(source)>1024*1024||source.includes('\0'))throw new Error('Definition files must be text of at most 1 MiB.');validateLexical(source);let statements;if(typeof source==='string'&&!/^[\t ]*DELIMITER\b/im.test(source)){try{parseDefinition(source,schema);statements=[source];}catch{/* Fall through to the bounded multi-definition parser. */}}const items=(statements||splitDefinitions(source)).map(text=>parseDefinition(text,schema)),keys=new Set();for(const item of items){const key=item.kind+':'+item.name.toLowerCase();if(keys.has(key))throw new Error('Duplicate definition target in file.');keys.add(key);}return items;}
module.exports={splitDefinitions,parseDefinition,parseFile};
