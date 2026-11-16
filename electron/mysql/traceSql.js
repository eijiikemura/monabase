// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const q=value=>'`'+value.replaceAll('`','``')+'`';
const id=t=>t?.kind==='word'?t.text:t?.kind==='quoted'&&t.text[0]==='`'?t.text.slice(1,-1).replaceAll('``','`'):null;
const word=t=>t?.kind==='word'?t.text.toUpperCase():t?.text;
function groups(parts){let level=0,start=0;const result=[];for(let i=0;i<parts.length;i++){if(parts[i].text==='(')level++;if(parts[i].text===')')level--;if(parts[i].text===','&&level===0){result.push(parts.slice(start,i));start=i+1;}if(level<0)throw new Error('Invalid trace SQL expression.');}if(level)throw new Error('Invalid trace SQL parentheses.');result.push(parts.slice(start));return result;}
function indexes(parts,words){let level=0;const result={};for(let i=0;i<parts.length;i++){if(parts[i].text==='(')level++;if(parts[i].text===')')level--;if(!level&&words.includes(word(parts[i]))){if(result[word(parts[i])]!==undefined)throw new Error('Repeated trace SQL clause.');result[word(parts[i])]=i;}}return result;}
function tableAt(parts,index,info){let name=id(parts[index++]),schema=info.schema;if(!name)throw new Error('A literal trace table is required.');if(parts[index]?.text==='.'){index++;schema=name;name=id(parts[index++]);}if(schema!==info.schema)throw new Error('Trace SQL cannot access another database.');const table=info.traceTables?.find(t=>t.name===name);if(!table)throw new Error('Reload the trace table inputs before using SQL.');return {table,index,alias:name};}
function compileSql(parts,{info,variables,expression,mode='statement'}){
 const command=word(parts[0]),fail=()=>{throw new Error('Trace SQL supports bounded single-table SELECT/INTO, cursor SELECT and INSERT/UPDATE/DELETE only.');};
 const locals=list=>groups(list).map(tokens=>{if(tokens.length!==1||!variables.some(v=>v.toLowerCase()===id(tokens[0])?.toLowerCase()))fail();return q(id(tokens[0]));});
 if(command==='SELECT'){
  let tokens=parts.slice(1),targets=[];const original=indexes(tokens,['INTO','FROM','WHERE','ORDER','LIMIT']);
  if(original.INTO!==undefined){const end=Math.min(...Object.values(original).filter(n=>n>original.INTO),tokens.length);targets=locals(tokens.slice(original.INTO+1,end));tokens=[...tokens.slice(0,original.INTO),...tokens.slice(end)];}
  if(mode==='cursor'?targets.length:!targets.length)fail();
  const clauses=indexes(tokens,['FROM','WHERE','ORDER','LIMIT']);let table,alias,index;
  if(clauses.FROM!==undefined){({table,index,alias}=tableAt(tokens,clauses.FROM+1,info));if(word(tokens[index])==='AS'){index++;alias=id(tokens[index++]);if(!alias)fail();}else if(id(tokens[index])&&!['WHERE','ORDER','LIMIT'].includes(word(tokens[index])))alias=id(tokens[index++]);const end=Math.min(...Object.values(clauses).filter(n=>n>clauses.FROM),tokens.length);if(index!==end)fail();}
  const context=table?{columns:table.columns,alias}:undefined,projectionEnd=Math.min(...Object.values(clauses),tokens.length);let projection=tokens.slice(0,projectionEnd),distinct='';if(word(projection[0])==='DISTINCT'){distinct='DISTINCT ';projection=projection.slice(1);}
  const project=groups(projection).map(group=>{if(group.length===1&&group[0].text==='*')fail();const as=group.findIndex(t=>word(t)==='AS');let suffix='';if(as>=0){if(as!==group.length-2||!id(group.at(-1)))fail();suffix=' AS '+q(id(group.at(-1)));group=group.slice(0,as);}return expression(group,context)+suffix;});
  let sql='SELECT '+distinct+project.join(',')+(targets.length?' INTO '+targets.join(','):'')+(table?' FROM '+q(info.schema)+'.'+q(table.copyName)+' AS '+q(alias):'');
  const endOf=start=>Math.min(...Object.values(clauses).filter(n=>n>start),tokens.length);
  if(clauses.WHERE!==undefined)sql+=' WHERE '+expression(tokens.slice(clauses.WHERE+1,endOf(clauses.WHERE)),context);
  if(clauses.ORDER!==undefined){if(word(tokens[clauses.ORDER+1])!=='BY')fail();sql+=' ORDER BY '+groups(tokens.slice(clauses.ORDER+2,endOf(clauses.ORDER))).map(group=>{let direction='';if(['ASC','DESC'].includes(word(group.at(-1)))){direction=' '+word(group.at(-1));group=group.slice(0,-1);}return expression(group,context)+direction;}).join(',');}
  if(clauses.LIMIT!==undefined){const limit=tokens.slice(clauses.LIMIT+1);if(limit.length!==1||!/^\d+$/.test(limit[0].text)||Number(limit[0].text)>1000)fail();sql+=' LIMIT '+limit[0].text;}
  // Reject clauses in non-native order rather than inventing different query semantics.
  const sequence=['FROM','WHERE','ORDER','LIMIT'].filter(k=>clauses[k]!==undefined).map(k=>clauses[k]);if(sequence.some((n,i)=>i&&n<sequence[i-1]))fail();
  return sql;
 }
 if(!['INSERT','UPDATE','DELETE'].includes(command))fail();let index=1;
 if(command==='INSERT'){if(word(parts[index++])!=='INTO')fail();}
 if(command==='DELETE'){if(word(parts[index++])!=='FROM')fail();}
 let {table,index:next,alias}=tableAt(parts,index,info);index=next;
 const column=token=>{const name=id(token),found=table.columns.find(c=>c.name===name&&!c.generated&&c.supported);if(!found)fail();return q(name);};
 if(command==='INSERT'){
  if(parts[index++]?.text!=='(')fail();const close=parts.findIndex((t,i)=>i>=index&&t.text===')');if(close<index)fail();const columns=groups(parts.slice(index,close)).map(g=>{if(g.length!==1)fail();return column(g[0]);});if(new Set(columns).size!==columns.length)fail();index=close+1;if(word(parts[index++])!=='VALUES')fail();const rows=[];
  while(index<parts.length){if(parts[index++]?.text!=='(')fail();const start=index;let depth=1;while(index<parts.length&&depth){if(parts[index].text==='(')depth++;if(parts[index].text===')')depth--;if(depth)index++;}if(depth)fail();const values=groups(parts.slice(start,index));if(values.length!==columns.length)fail();rows.push('('+values.map(v=>expression(v)).join(',')+')');index++;if(index<parts.length&&parts[index++]?.text!==',')fail();if(rows.length>1000)fail();}
  return 'INSERT INTO '+q(info.schema)+'.'+q(table.copyName)+'('+columns.join(',')+') VALUES '+rows.join(',');
 }
 if(word(parts[index])==='AS'){index++;alias=id(parts[index++]);if(!alias)fail();}
 const context={columns:table.columns,alias},tail=parts.slice(index),clauses=indexes(tail,['WHERE','ORDER','LIMIT']);
 let sql=command+' '+(command==='DELETE'?'FROM ':'')+q(info.schema)+'.'+q(table.copyName)+' AS '+q(alias);
 if(command==='UPDATE'){if(word(tail[0])!=='SET')fail();const end=Math.min(...Object.values(clauses),tail.length);sql+=' SET '+groups(tail.slice(1,end)).map(group=>{let start=1;if(group[1]?.text==='.'){if(id(group[0])!==alias)fail();start=3;}if(group[start]?.text!=='=')fail();return column(group[start===3?2:0])+'='+expression(group.slice(start+1),context);}).join(',');}
 else if(Math.min(...Object.values(clauses),tail.length)!==0)fail();
 const endOf=start=>Math.min(...Object.values(clauses).filter(n=>n>start),tail.length);
 if(clauses.WHERE!==undefined)sql+=' WHERE '+expression(tail.slice(clauses.WHERE+1,endOf(clauses.WHERE)),context);
 if(clauses.ORDER!==undefined){if(word(tail[clauses.ORDER+1])!=='BY')fail();sql+=' ORDER BY '+groups(tail.slice(clauses.ORDER+2,endOf(clauses.ORDER))).map(group=>{let direction='';if(['ASC','DESC'].includes(word(group.at(-1)))){direction=' '+word(group.at(-1));group=group.slice(0,-1);}return expression(group,context)+direction;}).join(',');}
 if(clauses.LIMIT!==undefined){const rest=tail.slice(clauses.LIMIT+1);if(rest.length!==1||!/^\d+$/.test(rest[0].text)||Number(rest[0].text)>1000)fail();sql+=' LIMIT '+rest[0].text;}
 const order=['WHERE','ORDER','LIMIT'].filter(k=>clauses[k]!==undefined).map(k=>clauses[k]);if(order.some((n,i)=>i&&n<order[i-1]))fail();return sql;
}
module.exports={compileSql,id,word};
