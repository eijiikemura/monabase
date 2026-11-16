// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {tokenizeSql} from '@/features/sql/sqlScript';
import {tableDefinitionParts} from '../index/indexModel';
import {mysqlTableName,quoteMysql,type MysqlStatement,type MysqlTableMetadata} from '../table/tableModel';
export interface MysqlCheckForm {name:string;condition:string;enforced:boolean;}
export interface MysqlCheckDetails {definition:string;condition:string;enforced:boolean;fingerprint:string;}
export function checkExpression(value:string):string {
  const input=value.trim();if(!input||input.length>65535)throw new Error('Enter a CHECK expression of at most 65535 characters.');
  const ts=tokenizeSql(input,'mysql');let depth=0,end=0;
  const denied=new Set(['SELECT','UNION','INSERT','UPDATE','DELETE','CREATE','ALTER','DROP','GRANT','REVOKE','INTO','OUTFILE','DUMPFILE','LOAD_FILE','SLEEP','BENCHMARK','GET_LOCK','RELEASE_LOCK','SET','USE']);
  for(const token of ts){
    if(input.slice(end,token.start).trim())throw new Error('Comments are not supported in CHECK expressions.');end=token.end;
    if(token.kind==='word'&&denied.has(token.text.toUpperCase())||[';', '@', '?', ':'].includes(token.text))throw new Error('Enter one CHECK expression without statements or bind variables.');
    if(token.text==='(')depth++;else if(token.text===')'&&--depth<0)throw new Error('Unbalanced CHECK expression.');
  }
  if(!ts.length||depth||input.slice(end).trim())throw new Error('Enter one balanced CHECK expression without comments.');return input;
}
export function nativeCheckDefinition(source:string,name:string):{definition:string;condition:string}{
  const matches=tableDefinitionParts(source).filter(part=>{
    const tokens=tokenizeSql(part.replace(/\/\*!(?=\d{5,6}\s)/g,'/* '),'mysql');
    return tokens[0]?.text.toUpperCase()==='CONSTRAINT'&&tokens[1]?.kind==='quoted'&&tokens[1].text==='`'+name.replaceAll('`','``')+'`'&&tokens[2]?.text.toUpperCase()==='CHECK';
  });
  if(matches.length!==1)throw new Error('The exact native CHECK definition is unavailable.');
  const definition=matches[0],ts=tokenizeSql(definition.replace(/\/\*!(?=\d{5,6}\s)/g,'/* '),'mysql');let depth=0;
  if(ts[3]?.text!=='(')throw new Error('The native CHECK expression is unavailable.');
  for(let i=3;i<ts.length;i++){if(ts[i].text==='(')depth++;else if(ts[i].text===')'&&--depth===0)return {definition,condition:definition.slice(ts[3].end,ts[i].start)};}
  throw new Error('The native CHECK expression is incomplete.');
}
export function assertCheckTable(metadata:MysqlTableMetadata){if(metadata.table.TABLE_TYPE!=='BASE TABLE'||metadata.table.ENGINE?.toLowerCase()!=='innodb')throw new Error('CHECK changes require an InnoDB base table.');}
export function checkStatement(schema:string,table:string,form:MysqlCheckForm,details?:MysqlCheckDetails,oldName?:string,drop=false):MysqlStatement{
  const target=mysqlTableName(schema,table);let clause:string;
  if(drop){if(!details||!oldName)throw new Error('Reload the CHECK definition before deletion.');clause='DROP CHECK '+quoteMysql(oldName);}
  else{
    const name=quoteMysql(form.name),condition=checkExpression(form.condition),state=form.enforced?'ENFORCED':'NOT ENFORCED';
    if(details){
      if(!oldName||condition!==details.condition)throw new Error('Existing CHECK conditions are read only.');
      if(form.name!==oldName)clause=`DROP CHECK ${quoteMysql(oldName)}, ADD CONSTRAINT ${name} CHECK (${condition}) ${state}`;
      else if(form.enforced!==details.enforced)clause=`ALTER CHECK ${name} ${state}`;
      else throw new Error('No CHECK changes to save.');
    }else clause=`ADD CONSTRAINT ${name} CHECK (${condition}) ${state}`;
  }
  return {sql:`ALTER TABLE ${target} ${clause}`,binds:{}};
}
