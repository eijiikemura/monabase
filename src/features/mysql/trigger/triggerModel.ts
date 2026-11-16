// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { tokenizeSql } from '@/features/sql/sqlScript';
import { mysqlTableName } from '@/features/mysql/table/tableModel';
import type { MysqlTriggerDefinition, MysqlTriggerInfo } from '@/shared/api/desktopContract';
export const emptyTrigger = (schema: string, table = ''): MysqlTriggerDefinition => ({ schema, table, name: '', timing: 'BEFORE', event: 'INSERT', body: 'BEGIN\n  -- Add row-level trigger statements here.\nEND' });
export function triggerSource(form: MysqlTriggerDefinition, details?: MysqlTriggerInfo) {
  const definer = details ? details.native.match(/^\s*CREATE\s+(DEFINER\s*=\s*(?:`(?:[^`]|``)*`|'(?:[^']|'')*')\s*@\s*(?:`(?:[^`]|``)*`|'(?:[^']|'')*'))/im)?.[1] : undefined;
  const i=details?.peers.indexOf(details.name)??-1;
  const order=details&&form.timing===details.timing&&form.event===details.event?(i>=0&&i+1<details.peers.length?' PRECEDES `'+details.peers[i+1].replaceAll('`','``')+'`':i>0?' FOLLOWS `'+details.peers[i-1].replaceAll('`','``')+'`':''):'';
  return `CREATE ${definer || 'DEFINER=CURRENT_USER'} TRIGGER ${mysqlTableName(form.schema, form.name)} ${form.timing} ${form.event} ON ${mysqlTableName(form.schema, form.table)} FOR EACH ROW${order}\n${form.body}`;
}
export function parseTriggerAnswer(source: string, target: MysqlTriggerDefinition, details?: MysqlTriggerInfo): MysqlTriggerDefinition {
  const tokens=tokenizeSql(source,'mysql');let i=0;
  const word=(value:string)=>tokens[i]?.kind==='word'&&tokens[i].text.toUpperCase()===value;
  const expect=(value:string)=>{if(!word(value))throw new Error('Return one complete MySQL CREATE TRIGGER definition.');i++;};
  const id=()=>{const token=tokens[i++];if(token?.kind==='quoted'&&token.text.startsWith('`'))return token.text.slice(1,-1).replaceAll('``','`');if(token?.kind==='word')return token.text;throw new Error('Invalid trigger identity.');};
  const name=()=>{let schema=target.schema,value=id();if(tokens[i]?.text==='.'){i++;schema=value;value=id();}return {schema,value};};
  expect('CREATE');
  if(word('DEFINER')){i++;if(tokens[i++]?.text!=='=')throw new Error('Invalid trigger definer.');if(word('CURRENT_USER')){i++;if(tokens[i]?.text==='('){i++;if(tokens[i++]?.text!==')')throw new Error('Invalid definer.');}}else{i++;if(tokens[i++]?.text!=='@')throw new Error('Invalid definer.');i++;}}
  expect('TRIGGER');const trigger=name();const timing=tokens[i++]?.text.toUpperCase(),event=tokens[i++]?.text.toUpperCase();expect('ON');const table=name();expect('FOR');expect('EACH');expect('ROW');
  if(trigger.schema!==target.schema||trigger.value!==target.name||table.schema!==target.schema||table.value!==target.table)throw new Error('The trigger answer changes the selected database, trigger or table.');
  if(!['BEFORE','AFTER'].includes(timing)||!['INSERT','UPDATE','DELETE'].includes(event))throw new Error('Unsupported MySQL trigger event.');
  if(word('FOLLOWS')||word('PRECEDES')){
    const relation=tokens[i++].text.toUpperCase(),peer=id(),position=details?.peers.indexOf(target.name)??-1;
    const expected=relation==='PRECEDES'?details?.peers[position+1]:details?.peers[position-1];
    if(!details||peer!==expected)throw new Error('Trigger order must match the actual database metadata.');
  }
  if(!tokens[i])throw new Error('The trigger body is missing.');
  return {...target,timing:timing as MysqlTriggerDefinition['timing'],event:event as MysqlTriggerDefinition['event'],body:source.slice(tokens[i].start).trim()};
}
