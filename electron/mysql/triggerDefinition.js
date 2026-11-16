// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { scanSql } = require('../services/sqlTokens');
const q = name => { if(typeof name!=='string'||!name||name.length>64||name.includes('\0'))throw new Error('Invalid MySQL trigger identifier.');return '`'+name.replaceAll('`','``')+'`'; };
function validateLexical(body) {
  // Validate quote/comment termination and reject executable comments before the opaque token scan.
  for(let i=0;i<body.length;i++){
    const c=body[i];if(c==='#'||body.startsWith('--',i)&&(!body[i+2]||/\s/.test(body[i+2]))){while(i<body.length&&body[i]!=='\n')i++;continue;}
    if(body.startsWith('/*',i)){if(/^\/\*(?:!|M!)/i.test(body.slice(i)))throw new Error('Executable comments are not accepted in trigger bodies.');const end=body.indexOf('*/',i+2);if(end<0)throw new Error('Unclosed trigger comment.');i=end+1;continue;}
    if(['`',"'",'"'].includes(c)){let closed=false;for(i++;i<body.length;i++){if(body[i]==='\\'&&c!=='`'){i++;continue;}if(body[i]===c){if(body[i+1]===c)i++;else{closed=true;break;}}}if(!closed)throw new Error('Unclosed trigger quote.');}
  }
}
function validateBody(body, routine = false) {
  if(typeof body!=='string'||!body.trim()||body.includes('\0')||Buffer.byteLength(body)>1024*1024)throw new Error('Enter a trigger body of at most 1 MiB.');
  validateLexical(body);
  const tokens=scanSql(body,'mysql'), word=(i)=>tokens[i]?.kind==='word'?tokens[i].text.toUpperCase():'';
  const blocked=new Set(['CREATE','ALTER','DROP','TRUNCATE','GRANT','REVOKE','PREPARE','EXECUTE','DEALLOCATE','DELIMITER','USE','COMMIT','ROLLBACK','SAVEPOINT','START','GLOBAL','SESSION','PERSIST','AUTOCOMMIT','SQL_MODE','TIME_ZONE','OUTFILE','DUMPFILE','LOAD_FILE','GET_LOCK','RELEASE_LOCK','SLEEP','LOAD','LOCK','UNLOCK']);
  for(let i=0;i<tokens.length;i++){
    if((blocked.has(word(i))&&!(routine===true&&['COMMIT','ROLLBACK','SAVEPOINT','START'].includes(word(i))))||tokens[i].text==='@'&&tokens[i+1]?.text==='@')throw new Error('Server/session management, files and dynamic SQL are not supported in trigger bodies.');
    if(tokens[i].kind==='quoted'&&tokens[i+1]?.text==='('&&/^(?:`|'|")(?:LOAD_FILE|GET_LOCK|RELEASE_LOCK|SLEEP)(?:`|'|")$/i.test(tokens[i].text))throw new Error('Server file and advisory functions are not supported.');
  }
  let start=0,label='';if(tokens[1]?.text===':'){label=tokens[0].text;start=2;}
  const controls=new Set(['BEGIN','IF','CASE','LOOP','WHILE','REPEAT']);
  if(!controls.has(word(start))){if(![...(routine===true?['SELECT','WITH','COMMIT','ROLLBACK','SAVEPOINT','START']:routine==='function'?['RETURN']:[]),'SET','INSERT','UPDATE','DELETE','REPLACE','SIGNAL','RESIGNAL','CALL'].includes(word(start)))throw new Error('Use a trigger statement or a BEGIN ... END block.');const semis=tokens.filter(t=>t.text===';');if(semis.length>1||semis.length===1&&tokens.at(-1).text!==';')throw new Error('Only one trigger statement is allowed.');return body.trim().replace(/;\s*$/,'');}
  const stack=[];let end=-1;
  for(let i=start;i<tokens.length;i++){
    const value=word(i),previous=tokens[i-1],boundary=i===start||previous?.text===';'||previous?.text===':'||previous?.kind==='word'&&['BEGIN','THEN','ELSE','DO'].includes(previous.text.toUpperCase());
    let ifFunction=false;
    if(value==='IF'&&tokens[i+1]?.text==='('){let depth=0,commas=0;for(let j=i+1;j<tokens.length;j++){if(tokens[j].text==='(')depth++;if(tokens[j].text===')'&&--depth===0)break;if(depth===1&&tokens[j].text===',')commas++;}ifFunction=commas>=2;}
    if(value==='BEGIN'||value==='CASE'||boundary&&controls.has(value)&&!ifFunction){stack.push(value);continue;}
    if(value!=='END')continue;
    const next=word(i+1),kind=['IF','CASE','LOOP','WHILE','REPEAT'].includes(next)?next:null;
    const opened=stack.pop();if(!opened||kind&&opened!==kind||!kind&&!['BEGIN','CASE'].includes(opened))throw new Error('Unbalanced trigger block.');if(kind)i++;
    if(!stack.length){end=i+1;break;}
  }
  if(end<0)throw new Error('The trigger block is incomplete.');
  if(label&&tokens[end]?.text===label)end++;
  if(tokens[end]?.text===';')end++;
  if(end!==tokens.length)throw new Error('SQL after the trigger body is not allowed.');
  return body.trim().replace(/;\s*$/,'');
}
function buildTrigger(definition, definer='CURRENT_USER', order='') {
  const {schema,name,table,timing,event,body}=definition;q(schema);q(name);q(table);
  if(!['BEFORE','AFTER'].includes(timing)||!['INSERT','UPDATE','DELETE'].includes(event))throw new Error('Invalid MySQL trigger timing or event.');
  return `CREATE DEFINER=${definer} TRIGGER ${q(schema)}.${q(name)} ${timing} ${event} ON ${q(schema)}.${q(table)} FOR EACH ROW${order?' '+order:''}\n${validateBody(body)}`;
}
module.exports={quoteTriggerIdentifier:q,validateBody,validateLexical,buildTrigger};
