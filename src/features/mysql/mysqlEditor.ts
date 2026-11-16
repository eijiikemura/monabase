// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {tokenizeSql} from '@/features/sql/sqlScript';
export interface MysqlEditorSymbol {label:string;type:string;detail?:string;}
const builtinNames=['ABS','AVG','CHAR_LENGTH','COALESCE','CONCAT','COUNT','DATE_ADD','DATE_FORMAT','DATEDIFF','IFNULL','JSON_EXTRACT','JSON_OBJECT','LOWER','MAX','MIN','NOW','NULLIF','ROUND','SUM','UPPER'];
export const mysqlBuiltins:MysqlEditorSymbol[]=builtinNames.map(label=>({label,type:'function'}));
// Completion is local to the editor; never load a whole database catalog.
export function mysqlLocalSymbols(source:string,position:number):MysqlEditorSymbol[]{
 if(source.length>262144)return [];
 let tokens:ReturnType<typeof tokenizeSql>;try{tokens=tokenizeSql(source.slice(0,position),'mysql');}catch{return [];}
 const blocks:string[]=[];
 const scopes:Map<string,MysqlEditorSymbol>[]=[new Map()];
 const id=(n:number)=>{const t=tokens[n];return t?.kind==='word'?t.text:t?.kind==='quoted'&&t.text.startsWith('`')?t.text.slice(1,-1).replaceAll('``','`'):'';};
 const word=(n:number)=>tokens[n]?.kind==='word'?tokens[n].text.toUpperCase():'';
 const add=(name:string,type:string,detail:string)=>{if(name&&!/^\d/.test(name))scopes.at(-1)!.set(name.toLowerCase(),{label:name,type,detail});};
 // Read the declaration header, not calls or strings that merely contain parentheses.
 let header=-1;for(let n=0;n<tokens.length-1;n++)if(word(n)==='CREATE'&&tokens.slice(n,n+8).some(t=>t.kind==='word'&&['PROCEDURE','FUNCTION'].includes(t.text.toUpperCase()))){header=tokens.findIndex((t,k)=>k>n&&t.text==='(');break;}
 if(header>=0){let depth=1,start=header+1;for(let n=start;n<tokens.length&&depth;n++){if(tokens[n].text==='(')depth++;if(tokens[n].text===')')depth--;if(depth===1&&tokens[n].text===','||depth===0){let p=start;if(['IN','OUT','INOUT'].includes(word(p)))p++;add(id(p),'variable',source.slice(tokens[p+1]?.start||0,tokens[n].start).trim());start=n+1;}}}
 for(let n=0;n<tokens.length;n++){
  if(word(n)==='BEGIN'){blocks.push('BEGIN');scopes.push(new Map());}
  else if(word(n)==='CASE'&&word(n-1)!=='END')blocks.push('CASE');
  else if(word(n)==='END'){if(['IF','WHILE','LOOP','REPEAT'].includes(word(n+1)))continue;const closed=blocks.pop();if(closed==='BEGIN'&&scopes.length>1)scopes.pop();}
  else if(word(n)==='DECLARE'&&!['CONTINUE','EXIT','CONDITION'].includes(word(n+1))){const name=id(n+1),type=word(n+2);if(type==='CONDITION')continue;add(name,'variable',type);}
 }
 const visible=new Map<string,MysqlEditorSymbol>();for(const scope of scopes)for(const [key,value] of scope)visible.set(key,value);return [...visible.values()].slice(0,256);
}
export interface MysqlEditorError {source:string;line:number;message:string;}
export function mysqlErrorLocation(source:string,statement:string,start:number,serverLine:unknown):number|null{
 if(typeof serverLine!=='number'||!Number.isSafeInteger(serverLine)||serverLine<1||serverLine>statement.split('\n').length||start<0||source.slice(start,start+statement.length)!==statement)return null;
 return source.slice(0,start).split('\n').length+serverLine-1;
}
