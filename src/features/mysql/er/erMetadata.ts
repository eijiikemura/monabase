// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { backgroundRows } from '@/features/mysql/table/tableRepository';
import { quoteMysql } from '@/features/mysql/table/tableModel';
import type { ErMetadata, ErForeignKey } from '@/features/er/erMetadata';

interface Identity { schema: string; table: string; }
const identityKey = (value: Identity) => JSON.stringify([value.schema, value.table]);
const foreignSql = `SELECT k.TABLE_SCHEMA AS CHILD_SCHEMA,k.TABLE_NAME AS CHILD_TABLE,k.COLUMN_NAME AS CHILD_COLUMN,k.REFERENCED_TABLE_SCHEMA AS PARENT_SCHEMA,k.REFERENCED_TABLE_NAME AS PARENT_TABLE,k.REFERENCED_COLUMN_NAME AS PARENT_COLUMN,k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k WHERE k.REFERENCED_TABLE_NAME IS NOT NULL`;
const empty = (): ErMetadata => ({ columns: [], primaryKeys: [], foreignKeys: [], tableComments: [], columnComments: [] });
function append(target: ErMetadata, source: ErMetadata) {
  target.columns.push(...source.columns); target.primaryKeys.push(...source.primaryKeys); target.foreignKeys.push(...source.foreignKeys);
  target.tableComments.push(...source.tableComments); target.columnComments.push(...source.columnComments);
}
async function loadGroup(schema: string, names: string[], custom: boolean): Promise<ErMetadata> {
  const result = empty();
  for (let offset = 0; offset < names.length; offset += 300) {
    const selected = names.slice(offset,offset+300), binds: Record<string,string> = { schema };
    const placeholders = selected.map((name,index) => { binds['n'+index] = name; return 'CAST(:n'+index+' AS BINARY)'; }).join(',');
    const matches = (schemaExpr: string, tableExpr: string) => `CAST(${schemaExpr} AS BINARY)=CAST(:schema AS BINARY) AND CAST(${tableExpr} AS BINARY) IN (${placeholders})`;
    const responses = await Promise.allSettled([
      backgroundRows<ErMetadata['columns'][number]>(`SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,DATA_TYPE,COLUMN_TYPE AS MYSQL_COLUMN_TYPE,CHARACTER_MAXIMUM_LENGTH AS DATA_LENGTH,NUMERIC_PRECISION AS DATA_PRECISION,NUMERIC_SCALE AS DATA_SCALE FROM information_schema.COLUMNS WHERE ${matches('TABLE_SCHEMA','TABLE_NAME')} ORDER BY TABLE_NAME,ORDINAL_POSITION`,binds),
      backgroundRows<ErMetadata['primaryKeys'][number]>(`SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_NAME='PRIMARY' AND ${matches('TABLE_SCHEMA','TABLE_NAME')} ORDER BY TABLE_NAME,ORDINAL_POSITION`,binds),
      backgroundRows<ErForeignKey>(`${foreignSql} AND ${matches('k.TABLE_SCHEMA','k.TABLE_NAME')} ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,binds),
      backgroundRows<ErMetadata['tableComments'][number]>(`SELECT TABLE_SCHEMA,TABLE_NAME,CASE WHEN TABLE_TYPE='VIEW' THEN '' ELSE TABLE_COMMENT END AS COMMENTS FROM information_schema.TABLES WHERE ${matches('TABLE_SCHEMA','TABLE_NAME')} AND TABLE_TYPE IN (${custom ? "'BASE TABLE','VIEW'" : "'BASE TABLE'"})`,binds),
      backgroundRows<ErMetadata['columnComments'][number]>(`SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,COLUMN_COMMENT AS COMMENTS FROM information_schema.COLUMNS WHERE ${matches('TABLE_SCHEMA','TABLE_NAME')} ORDER BY TABLE_NAME,ORDINAL_POSITION`,binds)
    ]);
    for (const response of responses) if (response.status === 'rejected') throw response.reason;
    const [columns,primaryKeys,foreignKeys,tableComments,columnComments] = responses.map(response => response.status === 'fulfilled' ? response.value : []);
    const snapshot = { columns,primaryKeys,foreignKeys,tableComments,columnComments } as ErMetadata;
    for (const name of selected) if (!snapshot.columns.some(column => column.TABLE_NAME===name) || !snapshot.tableComments.some(table => table.TABLE_NAME===name)) throw new Error('MySQL ER metadata is unavailable for '+schema+'.'+name);
    append(result,snapshot);
  }
  return result;
}
export async function fetchMysqlErMetadata(schema: string, target: string | null, custom: boolean): Promise<ErMetadata> {
  quoteMysql(schema); if (target) quoteMysql(target);
  const identities = new Map<string,Identity>();
  if (target) {
    const main = { schema,table:target }; identities.set(identityKey(main),main);
    if (!custom) {
      const relations = await backgroundRows<ErForeignKey>(`${foreignSql} AND ((CAST(k.TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(k.TABLE_NAME AS BINARY)=CAST(:target AS BINARY)) OR (CAST(k.REFERENCED_TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(k.REFERENCED_TABLE_NAME AS BINARY)=CAST(:target AS BINARY))) ORDER BY k.CONSTRAINT_SCHEMA,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,{schema,target});
      for(const relation of relations) for(const value of [{schema:relation.CHILD_SCHEMA!,table:relation.CHILD_TABLE},{schema:relation.PARENT_SCHEMA!,table:relation.PARENT_TABLE}]) identities.set(identityKey(value),value);
    }
  } else {
    const tables = await backgroundRows<{TABLE_NAME:string}>(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND TABLE_TYPE IN (${custom ? "'BASE TABLE','VIEW'" : "'BASE TABLE'"}) ORDER BY TABLE_NAME`,{schema});
    for(const row of tables) {const value={schema,table:row.TABLE_NAME};identities.set(identityKey(value),value);}
  }
  const groups = new Map<string,string[]>(); for(const value of identities.values()) groups.set(value.schema,[...(groups.get(value.schema)||[]),value.table]);
  const result=empty();
  for(const [owner,names] of groups) append(result,await loadGroup(owner,names,custom));
  // Schema-wide diagrams include direct external parents, but never recursively expand their FKs.
  if (!target && !custom) {
    const external = new Map<string,Identity>();
    for(const relation of result.foreignKeys) if(relation.PARENT_SCHEMA && relation.PARENT_SCHEMA!==schema) {const value={schema:relation.PARENT_SCHEMA,table:relation.PARENT_TABLE};external.set(identityKey(value),value);}
    for(const value of external.values()) {const parent=await loadGroup(value.schema,[value.table],false);parent.foreignKeys=[];append(result,parent);}
  }
  return result;
}
