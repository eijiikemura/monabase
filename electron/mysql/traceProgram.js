// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {scanSql}=require('../services/sqlTokens');
const {parseProcedure}=require('./procedureDefinition');
const {validateBody}=require('./triggerDefinition');
const mysql=require('mysql2');
const {compileSql}=require('./traceSql');
const q=value=>'`'+value.replaceAll('`','``')+'`';
const scalarType=/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|BOOL|BOOLEAN|DATE|DATETIME|TIMESTAMP|TIME|CHAR|VARCHAR)(?:\(\d{1,4}(?:,\s*\d{1,3})?\))?(?: UNSIGNED)?$/i;
function buildTraceProgram(info,name,{maxSteps=2000}={}){
 if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>10000)throw new Error('Invalid MySQL trace step limit.');
 if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name))throw new Error('Invalid MySQL trace copy name.');
 if(Buffer.byteLength(info.source)>65536)throw new Error('MySQL trace source exceeds 64 KiB.');
 const trigger=info.kind==='TRIGGER';
 const parsed=trigger?{body:validateBody(info.source),parameters:'()',returns:''}:parseProcedure(info.source,info.schema,info.name,info.kind),offset=info.source.lastIndexOf(parsed.body),tokens=scanSql(parsed.body,'mysql');
 const references=new Map();
 if(trigger){for(const column of info.traceColumns||[]){if(!scalarType.test(column.type)||column.generated)continue;for(const alias of info.event==='INSERT'?['NEW']:info.event==='DELETE'?['OLD']:['OLD','NEW'])references.set((alias+'.'+column.name).toLowerCase(),{name:alias+'.'+column.name,sql:alias+'.'+q(column.name),type:column.type});}if(references.size>128)throw new Error('MySQL trigger trace exceeds 128 row fields.');}
 const singleReturn=tokens[0]?.text.toUpperCase()==='RETURN',singleSet=info.kind==='PROCEDURE'&&tokens[0]?.text.toUpperCase()==='SET';
 const variables=[],types={},frames=[],labels=[];let i=0,loop=0,statements=0,nesting=0,inHandler=false,handlerOrigin=null,handlerId=0,hasSql=false;let cursors=new Set();let blockId=0,totalVariables=0,totalCursors=0;const scopes=[{id:0,locals:[]}];
 const error=()=>{throw new Error('MySQL trace supports validated scalar control flow, isolated single-table SQL, cursors and bounded handlers only. Unsupported syntax at source line '+line(tokens[i]||tokens.at(-1))+'.');};
 const line=token=>info.source.slice(0,offset+token.start).split('\n').length;
 const upper=()=>tokens[i]?.text.toUpperCase(),take=word=>{if(upper()!==word)error();return tokens[i++];};
 const statementEnd=()=>{if(upper()===';')i++;else if(tokens[i])error();};
 const identifier=token=>token?.kind==='word'?token.text:token?.kind==='quoted'&&token.text[0]==='`'?token.text.slice(1,-1).replaceAll('``','`'):null;
 const register=(name,type)=>{const scope=scopes.at(-1);if(!name||!scalarType.test(type)||!/^\w{1,64}$/.test(name)||/^mbt_trace_/i.test(name)||['__proto__','constructor','prototype'].includes(name.toLowerCase())||scope.locals.some(v=>v.name.toLowerCase()===name.toLowerCase()))error();const key=scope.id?'B'+scope.id+'.'+name:name;scope.locals.push({name,key});variables.push(name);types[key]=type;if(++totalVariables>64||totalVariables+references.size>128)error();};
 for(const p of info.parameters){if(!['IN','OUT','INOUT'].includes(p.direction))error();register(p.name,p.type);}
 for(const ref of references.values())types[ref.name]=ref.type;
 const normalizeSignature=text=>scanSql(text,'mysql').map(t=>(identifier(t)||t.text).toUpperCase()).join(' ');
 const expectedParameters='('+info.parameters.map(p=>(info.kind==='PROCEDURE'?p.direction+' ':'')+q(p.name)+' '+p.type).join(',')+')';
 if(!trigger&&normalizeSignature(parsed.parameters)!==normalizeSignature(expectedParameters))throw new Error('MySQL trace does not support parameter type modifiers that are not represented in routine metadata.');
 if(info.kind==='FUNCTION'&&!scalarType.test(parsed.returns.replace(/\s+(?:CHARSET|CHARACTER SET)\s+[A-Za-z0-9_]+(?:\s+COLLATE\s+[A-Za-z0-9_]+)?$/i,'')))error();
 const builtin=new Set(['ABS','ROUND','FLOOR','CEIL','CEILING','TRUNCATE','MOD','COALESCE','IFNULL','NULLIF','IF','CONCAT','CONCAT_WS','LENGTH','CHAR_LENGTH','LOWER','UPPER','TRIM','SUBSTRING','GREATEST','LEAST']);
 const keywords=new Set(['AND','OR','NOT','IS','NULL','TRUE','FALSE','DIV','MOD','BETWEEN','IN','LIKE','XOR']);
 function expression(parts,context){if(!parts.length)error();let depth=0;
  for(let n=0;n<parts.length;n++){const token=parts[n],id=identifier(token),word=token.text.toUpperCase();
   if(token.kind==='word'&&['SELECT','FROM','WHERE','JOIN','UNION','WITH','INTO','UPDATE','INSERT','DELETE','CALL','PREPARE','EXECUTE','OUTFILE','DUMPFILE','FOR','LOCK','GROUP','HAVING','LIMIT','ORDER','BY','AS','PROCEDURE','FUNCTION','TRIGGER','DECLARE','HANDLER','CURSOR','OPEN','FETCH','CLOSE','SIGNAL','RESIGNAL','BEGIN','END','SET','RETURN','CASE','WHEN','THEN','ELSE'].includes(word))error();
   if(trigger&&token.kind==='word'&&['NEW','OLD'].includes(word)&&parts[n+1]?.text==='.'){const column=identifier(parts[n+2]);if(parts[n+3]?.text==='('||parts[n+3]?.text==='.'||!column||!references.has((word+'.'+column).toLowerCase()))error();n+=2;continue;}
   if(context&&parts[n+1]?.text==='.'){const column=identifier(parts[n+2]);if(parts[n+3]?.text==='('||parts[n+3]?.text==='.'||id!==context.alias||!context.columns?.some(c=>c.name===column&&c.supported))error();n+=2;continue;}
   if(token.kind==='quoted'&&token.text[0]!=='`')continue;
   if(token.kind==='word'||id){if(/^\d+(?:e\d+)?$/i.test(word))continue;if(parts[n+1]?.text==='('){if(!builtin.has(word)&&!(context?.sql&&['COUNT','SUM','MIN','MAX','AVG'].includes(word)))error();}else if(!keywords.has(word)&&!variables.some(v=>v.toLowerCase()===id?.toLowerCase())&&!context?.columns?.some(c=>c.name===id&&c.supported))error();}
   else{if(token.text==='(')depth++;if(token.text===')')depth--;if(token.text==='.'&&!(parts[n-1]&&/^\d+$/.test(parts[n-1].text)&&/^\d+(?:e\d+)?$/i.test(parts[n+1]?.text||'')))error();
    if(depth<0||!['(',')',',','+','-','*','/','%','=','<','>','!','.','|','&','^','~'].includes(token.text)||token.text===','&&depth===0)error();}
  }if(depth)error();return parsed.body.slice(parts[0].start,parts.at(-1).end);
 }
 function until(stop){const result=[];let depth=0;while(tokens[i]){if(depth===0&&stop.includes(upper()))break;const token=tokens[i++];if(token.text==='(')depth++;if(token.text===')')depth--;result.push(token);}return expression(result);}
 const prefix='@'+name;
 const abort=()=>`SET ${prefix}_limited=1;\n`+(inHandler?`SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='MonaBase trace limit reached';`:'LEAVE _mb_run;');
 const snapshot=(token,phase)=>{
  const visible=new Map();for(const scope of scopes)for(const v of scope.locals)visible.set(v.name.toLowerCase(),{name:v.key,sql:q(v.name)});
  const vars=[...visible.values(),...references.values()].flatMap(v=>[mysql.escape(v.name),`CAST(${v.sql} AS CHAR)`]).join(',');
  const lexicalPath=frames.length?`CONCAT_WS(' > ',${frames.map(f=>`CONCAT('L${f}_iter',${prefix}_l${f})`).join(',')})`:"''";
  const path=inHandler?`CONCAT_WS(' > ',NULLIF(${handlerOrigin},''),NULLIF(${lexicalPath},''))`:lexicalPath;
  return `IF ${prefix}_limited=1 OR ${prefix}_count >= ${maxSteps} OR OCTET_LENGTH(${prefix}_data) > 1048576 THEN ${abort()} END IF;\nSET ${prefix}_path=${path};\nSET ${prefix}_count=${prefix}_count+1;\nSET ${prefix}_data=JSON_ARRAY_APPEND(${prefix}_data,'$',JSON_OBJECT('line',${line(token)},'phase','${phase}','loopPath',${path},'variables',JSON_OBJECT(${vars})));\n`;
 };
 function sequence(stops,one=false){if(++nesting>32)error();let result='';while(tokens[i]&&!stops.includes(upper())){if(++statements>2000)error();let token=tokens[i],word=upper(),label='';if(tokens[i+1]?.text===':'){label=identifier(tokens[i]);if(!label||(!/^[A-Za-z_][A-Za-z_0-9]{0,15}$/.test(label)||label.toLowerCase()==='_mb_run')||labels.some(l=>l.name.toLowerCase()===label.toLowerCase()))error();i+=2;token=tokens[i];word=upper();if(!['WHILE','LOOP','REPEAT','BEGIN'].includes(word))error();}
  if(word==='BEGIN'){result+=nestedBlock(token,label);}
  else if(word==='SET'){i++;const v=identifier(tokens[i++]);let target;
   if(trigger&&['NEW','OLD'].includes(v?.toUpperCase())&&tokens[i]?.text==='.'){
    i++;const column=identifier(tokens[i++]),ref=references.get((v+'.'+column).toLowerCase());if(!ref||v.toUpperCase()!=='NEW'||info.timing!=='BEFORE'||info.event==='DELETE')error();target=ref.sql;
   }else{if(!variables.some(name=>name.toLowerCase()===v?.toLowerCase()))error();target=q(v);}
   take('=');const expr=until([';']);if(upper()===';')take(';');else if(tokens[i]||!trigger&&!singleSet)error();result+=snapshot(token,'before')+`SET ${target}=${expr};\n`+snapshot(token,'after');}
  else if(['SELECT','INSERT','UPDATE','DELETE'].includes(word)){
   const parts=[];let depth=0;while(tokens[i]){if(!depth&&upper()===';')break;const next=tokens[i++];if(next.text==='(')depth++;if(next.text===')')depth--;parts.push(next);}statementEnd();hasSql=true;
   const sql=compileSql(parts,{info,variables,expression:(v,ctx)=>expression(v,{sql:true,...ctx})});result+=snapshot(token,'before')+sql+';\n'+snapshot(token,'after');
   if(word==='INSERT')for(const table of info.traceTables||[])result+=`IF (SELECT COUNT(*) FROM ${q(info.schema)}.${q(table.copyName)})>1000 THEN ${abort()} END IF;\n`;
  }else if(['OPEN','FETCH','CLOSE'].includes(word)){
   i++;if(word==='FETCH'&&upper()==='NEXT'){i++;take('FROM');}const cursor=identifier(tokens[i++]);if(!cursors.has(cursor?.toLowerCase()))error();let sql=word+' '+q(cursor);
   if(word==='FETCH'){take('INTO');const targets=[];do{const name=identifier(tokens[i++]);if(!variables.some(v=>v.toLowerCase()===name?.toLowerCase()))error();targets.push(q(name));if(upper()!==',')break;i++;}while(tokens[i]);sql+=' INTO '+targets.join(',');}statementEnd();result+=snapshot(token,'before')+sql+';\n'+snapshot(token,'after');
  }else if(word==='SIGNAL'||word==='RESIGNAL'){
   i++;let sql=word;if(upper()==='SQLSTATE'){i++;if(upper()==='VALUE')i++;const state=tokens[i++];if(state?.kind!=='quoted'||!/^['"][A-Z0-9]{5}['"]$/.test(state.text))error();sql+=' SQLSTATE '+state.text;}else if(word==='SIGNAL')error();
   if(upper()==='SET'){i++;const assignments=[];do{const key=upper();if(!['MESSAGE_TEXT','MYSQL_ERRNO'].includes(key))error();i++;take('=');const value=tokens[i++],name=identifier(value);if(key==='MYSQL_ERRNO'?!/^\d{1,5}$/.test(value?.text||''):!(value?.kind==='quoted'&&value.text[0]!=='`'||variables.some(v=>v.toLowerCase()===name?.toLowerCase())))error();assignments.push(key+'='+value.text);if(upper()!==',')break;i++;}while(tokens[i]);sql+=' SET '+assignments.join(',');}statementEnd();result+=snapshot(token,'signal')+sql+';\n';
  }
  else if(word==='RETURN'&&info.kind==='FUNCTION'){i++;const expr=until([';']);if(upper()===';')take(';');else if(!singleReturn||tokens[i])error();result+=snapshot(token,'return')+`RETURN ${expr};\n`;}
  else if(word==='IF'){i++;const cond=until(['THEN']);take('THEN');result+=snapshot(token,'condition')+`IF ${cond} THEN\n`+snapshot(token,'branch-entry')+sequence(['ELSEIF','ELSE','END']);
   while(upper()==='ELSEIF'){const branch=tokens[i++],expr=until(['THEN']);take('THEN');result+=`ELSEIF ${expr} THEN\n`+snapshot(branch,'branch-entry')+sequence(['ELSEIF','ELSE','END']);}
   if(upper()==='ELSE'){const branch=tokens[i++];result+='ELSE\n'+snapshot(branch,'branch-entry')+sequence(['END']);}take('END');take('IF');statementEnd();result+='END IF;\n';
  }else if(word==='CASE'){
   i++;const selector=upper()==='WHEN'?'':until(['WHEN']);result+=snapshot(token,'condition')+`CASE ${selector}\n`;
   if(upper()!=='WHEN')error();while(upper()==='WHEN'){const branch=tokens[i++],condition=until(['THEN']);take('THEN');result+=`WHEN ${condition} THEN\n`+snapshot(branch,'branch-entry')+sequence(['WHEN','ELSE','END']);}
   if(upper()==='ELSE'){const branch=tokens[i++];result+='ELSE\n'+snapshot(branch,'branch-entry')+sequence(['END']);}take('END');take('CASE');statementEnd();result+='END CASE;\n';
  }else if(['WHILE','LOOP','REPEAT'].includes(word)){
   i++;const cond=word==='WHILE'?until(['DO']):null;if(word==='WHILE')take('DO');const id=++loop;
   const labelSql=label?q(label)+': ':'';result+=`SET ${prefix}_l${id}=0;\n`+(word==='WHILE'?snapshot(token,'condition'):'')+labelSql+(word==='WHILE'?`WHILE ${cond} DO\n`:word+'\n')+`SET ${prefix}_l${id}=${prefix}_l${id}+1;\n`;
   frames.push(id);if(label)labels.push({name:label,loop:true});result+=snapshot(token,'loop-entry')+sequence(word==='REPEAT'?['UNTIL']:['END']);
   if(word==='REPEAT'){const untilToken=take('UNTIL'),condition=until(['END']);result+=snapshot(untilToken,'condition')+`UNTIL ${condition}\n`;}
   else if(word==='WHILE')result+=snapshot(token,'condition');
   take('END');take(word);if(label&&identifier(tokens[i])?.toLowerCase()===label.toLowerCase())i++;statementEnd();frames.pop();if(label)labels.pop();result+=`END ${word}${label?' '+q(label):''};\n`;
  }else if(word==='LEAVE'||word==='ITERATE'){
   i++;const target=identifier(tokens[i++]),scope=labels.findLast(l=>l.name.toLowerCase()===target?.toLowerCase());if(!scope||word==='ITERATE'&&!scope.loop)error();take(';');result+=snapshot(token,'control-flow')+`${word} ${q(scope.name)};\n`;
  }
  else error();
  if(one)break;
 }nesting--;return result;}
 function declarationsForBlock(){let declarations='',phase=0;const localCursors=new Set();while(upper()==='DECLARE'){
  const declaration=tokens[i++];
  if(['CONTINUE','EXIT'].includes(upper())){
   phase=2;const action=upper();i++;take('HANDLER');take('FOR');const conditions=[];
   do{if(upper()==='NOT'){i++;take('FOUND');conditions.push('NOT FOUND');}else if(['SQLEXCEPTION','SQLWARNING'].includes(upper()))conditions.push(tokens[i++].text);else if(upper()==='SQLSTATE'){i++;if(upper()==='VALUE')i++;const state=tokens[i++];if(state?.kind!=='quoted'||!/^['"][A-Z0-9]{5}['"]$/.test(state.text))error();conditions.push('SQLSTATE '+state.text);}else if(/^\d{1,5}$/.test(tokens[i]?.text||''))conditions.push(tokens[i++].text);else error();if(upper()!==',')break;i++;}while(tokens[i]);
   const previousHandler=inHandler,previousOrigin=handlerOrigin,savedFrames=frames.splice(0);inHandler=true;handlerOrigin=prefix+'_h'+(++handlerId)+'_origin';let handler=`SET ${handlerOrigin}=${prefix}_path;\n`+snapshot(declaration,'handler-entry');if(upper()==='BEGIN')handler+=nestedBlock(tokens[i]);else handler+=sequence([],true);handler+=snapshot(declaration,'handler-exit')+`SET ${prefix}_path=${handlerOrigin};\n`;inHandler=previousHandler;handlerOrigin=previousOrigin;frames.push(...savedFrames);declarations+=`DECLARE ${action} HANDLER FOR ${conditions.join(',')} BEGIN\n${handler}END;\n`;
  }else{
   const variable=identifier(tokens[i++]);if(upper()==='CURSOR'){
    if(phase>1||!variable||!/^\w{1,64}$/.test(variable)||localCursors.has(variable.toLowerCase())||++totalCursors>16)error();phase=1;cursors.add(variable.toLowerCase());localCursors.add(variable.toLowerCase());i++;take('FOR');const parts=[];while(tokens[i]&&upper()!==';')parts.push(tokens[i++]);take(';');hasSql=true;declarations+=`DECLARE ${q(variable)} CURSOR FOR ${compileSql(parts,{info,variables,expression:(v,ctx)=>expression(v,{sql:true,...ctx}),mode:'cursor'})};\n`;
   }else{if(phase)error();const type=[];let depth=0;while(tokens[i]&&!['DEFAULT',';'].includes(upper())){const next=tokens[i++];if(next.text==='(')depth++;if(next.text===')')depth--;if(depth<0)error();type.push(next.text);}const typeText=type.join(' ').replace(/\s*([(),])\s*/g,'$1');register(variable,typeText);let expr='NULL';if(upper()==='DEFAULT'){i++;expr=until([';']);}take(';');declarations+=`DECLARE ${q(variable)} ${typeText} DEFAULT ${expr};\n`;}
  }
 }

 return declarations;}
 function nestedBlock(token,label=''){
  if(scopes.length>=32)error();take('BEGIN');const count=variables.length,oldCursors=cursors;cursors=new Set(cursors);scopes.push({id:++blockId,locals:[]});if(label)labels.push({name:label,loop:false});
  const declarations=declarationsForBlock(),body=snapshot(token,'block-entry')+sequence(['END']);const endToken=take('END');if(label&&identifier(tokens[i])?.toLowerCase()===label.toLowerCase())i++;statementEnd();
  const result=(label?q(label)+': ':'')+'BEGIN\n'+declarations+body+snapshot(endToken,'block-exit')+'END'+(label?' '+q(label):'')+';\n';
  if(label)labels.pop();scopes.pop();variables.length=count;cursors=oldCursors;return result;
 }
 let declarations='',outerLabel='';const first=tokens[0];if(tokens[1]?.text===':'&&tokens[2]?.text.toUpperCase()==='BEGIN'){outerLabel=identifier(tokens[i++]);if(!outerLabel||(!/^[A-Za-z_][A-Za-z_0-9]{0,15}$/.test(outerLabel)||outerLabel.toLowerCase()==='_mb_run'))error();take(':');labels.push({name:outerLabel,loop:false});}
 if(upper()==='BEGIN'){i++;declarations=declarationsForBlock();
 }else if(!trigger&&!singleSet&&!(upper()==='RETURN'&&info.kind==='FUNCTION')&&!['BEGIN','IF','CASE','WHILE','LOOP','REPEAT','SELECT','INSERT','UPDATE','DELETE','SIGNAL','RESIGNAL'].includes(upper())&&!(tokens[1]?.text===':'&&['WHILE','LOOP','REPEAT'].includes(tokens[2]?.text.toUpperCase())))error();
 const body=sequence(['END']);if(upper()==='END'){i++;if(outerLabel&&identifier(tokens[i])?.toLowerCase()===outerLabel.toLowerCase())i++;if(upper()===';')i++;}if(i!==tokens.length)error();
 const instrumented=(exit='')=>`BEGIN\n_mb_run: BEGIN\n${outerLabel?q(outerLabel)+': BEGIN\n':''}${declarations}${snapshot(first,'entry')}${body}${exit}${outerLabel?'END '+q(outerLabel)+';\n':''}END _mb_run;\n${info.kind==='FUNCTION'?`IF ${prefix}_limited=1 THEN RETURN NULL; END IF;\nSIGNAL SQLSTATE '2F005' SET MYSQL_ERRNO=1321,MESSAGE_TEXT='FUNCTION ended without RETURN';\n`:''}END`;
 if(trigger)return {hasSql,sql:`CREATE TRIGGER ${q(info.schema)}.${q(name)} ${info.timing} ${info.event} ON ${q(info.schema)}.${q(info.copyTable)} FOR EACH ROW\n${instrumented(snapshot(tokens.at(-1),'exit'))}`,prefix,types,maxSteps};
 const parameters=info.parameters.map(p=>`${info.kind==='PROCEDURE'?p.direction+' ':''}${q(p.name)} ${p.type}`).join(',');
 return {hasSql,sql:`CREATE ${info.kind} ${q(info.schema)}.${q(name)}(${parameters})\n${info.kind==='FUNCTION'?'RETURNS '+parsed.returns+'\nDETERMINISTIC\n':''}${hasSql?'MODIFIES SQL DATA':'CONTAINS SQL'}\nSQL SECURITY INVOKER\n${instrumented()}`,prefix,types,maxSteps};
}
module.exports={buildTraceProgram,scalarType};
