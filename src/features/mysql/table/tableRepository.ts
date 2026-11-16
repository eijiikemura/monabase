// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import { autoIncrementColumn, autoIncrementCounter, mysqlTableName } from './tableModel';
import type { MysqlColumn, MysqlRelation, MysqlStatement, MysqlTable, MysqlTableMetadata } from './tableModel';

export async function backgroundRows<Row extends object = DatabaseRow>(sql: string, binds: Record<string, unknown>): Promise<Row[]> {
  const response = await ipcRenderer.invoke<Row>('execute-sql-bg', sql, binds);
  if (!response.success) throw new Error(response.error);
  if (!Array.isArray(response.rows)) throw new Error('MySQL metadata rows are unavailable.');
  return response.rows;
}
const exactTable = `CAST(TABLE_SCHEMA AS BINARY) = CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY) = CAST(:table AS BINARY)`;
export async function loadTableMetadata(schema: string, table: string): Promise<MysqlTableMetadata> {
  const binds = { schema, table };
  const results = await Promise.allSettled([
    backgroundRows<MysqlTable>(`SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COMMENT,TABLE_ROWS,DATA_LENGTH,INDEX_LENGTH,AUTO_INCREMENT,TABLE_COLLATION,CREATE_TIME,UPDATE_TIME FROM information_schema.TABLES WHERE ${exactTable}`, binds),
    backgroundRows<MysqlColumn>(`SELECT c.COLUMN_NAME,c.DATA_TYPE,c.COLUMN_TYPE,c.IS_NULLABLE,c.COLUMN_DEFAULT,c.EXTRA,c.COLUMN_COMMENT,c.GENERATION_EXPRESSION,c.ORDINAL_POSITION,c.CHARACTER_SET_NAME,c.COLLATION_NAME,c.CHARACTER_MAXIMUM_LENGTH,c.NUMERIC_PRECISION,c.NUMERIC_SCALE,c.DATETIME_PRECISION,COALESCE(k.ORDINAL_POSITION,0) AS PK_POSITION FROM information_schema.COLUMNS c LEFT JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME='PRIMARY' AND CAST(k.TABLE_SCHEMA AS BINARY)=CAST(c.TABLE_SCHEMA AS BINARY) AND CAST(k.TABLE_NAME AS BINARY)=CAST(c.TABLE_NAME AS BINARY) AND CAST(k.COLUMN_NAME AS BINARY)=CAST(c.COLUMN_NAME AS BINARY) WHERE CAST(c.TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(c.TABLE_NAME AS BINARY)=CAST(:table AS BINARY) ORDER BY c.ORDINAL_POSITION`, binds),
    backgroundRows(`SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,EXPRESSION,COLLATION,CARDINALITY,SUB_PART,INDEX_TYPE,IS_VISIBLE,INDEX_COMMENT FROM information_schema.STATISTICS WHERE ${exactTable} ORDER BY INDEX_NAME,SEQ_IN_INDEX`, binds),
    backgroundRows(`SELECT tc.CONSTRAINT_NAME,tc.ENFORCED,cc.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON CAST(cc.CONSTRAINT_SCHEMA AS BINARY)=CAST(tc.CONSTRAINT_SCHEMA AS BINARY) AND CAST(cc.CONSTRAINT_NAME AS BINARY)=CAST(tc.CONSTRAINT_NAME AS BINARY) WHERE tc.CONSTRAINT_TYPE='CHECK' AND CAST(tc.TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(tc.TABLE_NAME AS BINARY)=CAST(:table AS BINARY) ORDER BY tc.CONSTRAINT_NAME`, binds),
    backgroundRows(`SELECT TRIGGER_SCHEMA,TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,ACTION_ORDER,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE CAST(EVENT_OBJECT_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(EVENT_OBJECT_TABLE AS BINARY)=CAST(:table AS BINARY) ORDER BY TRIGGER_NAME`, binds),
    loadTableRelations(schema, table)
  ]);
  // Finish every background read before releasing the UI guard, including failure paths.
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const [tables, columns, indexes, checks, triggers, relations] = results.map(result => result.status === 'fulfilled' ? result.value : []);
  if (tables.length !== 1 || !columns.length) throw new Error('The MySQL table or its column metadata is unavailable.');
  const metadata = { table: tables[0] as MysqlTable, columns: columns as MysqlColumn[], indexes: indexes as DatabaseRow[], checks: checks as DatabaseRow[], triggers: triggers as DatabaseRow[], relations: relations as MysqlRelation[] };
  if (autoIncrementColumn(metadata)) {
    const source = (await backgroundRows(`SHOW CREATE TABLE ${mysqlTableName(schema, table)}`, {}))[0]?.['Create Table'];
    if (typeof source !== 'string' || !source.trim()) throw new Error('The live AUTO_INCREMENT definition is unavailable.');
    metadata.table = { ...metadata.table, AUTO_INCREMENT: autoIncrementCounter(source) };
  }
  return metadata;
}
export function loadTableRelations(schema: string, table: string): Promise<MysqlRelation[]> {
  return backgroundRows<MysqlRelation>(`SELECT k.CONSTRAINT_SCHEMA,k.CONSTRAINT_NAME,k.TABLE_SCHEMA,k.TABLE_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,k.ORDINAL_POSITION,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON CAST(r.CONSTRAINT_SCHEMA AS BINARY)=CAST(k.CONSTRAINT_SCHEMA AS BINARY) AND CAST(r.CONSTRAINT_NAME AS BINARY)=CAST(k.CONSTRAINT_NAME AS BINARY) AND CAST(r.TABLE_NAME AS BINARY)=CAST(k.TABLE_NAME AS BINARY) WHERE k.REFERENCED_TABLE_NAME IS NOT NULL AND ((CAST(k.TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(k.TABLE_NAME AS BINARY)=CAST(:table AS BINARY)) OR (CAST(k.REFERENCED_TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(k.REFERENCED_TABLE_NAME AS BINARY)=CAST(:table AS BINARY))) ORDER BY k.CONSTRAINT_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`, { schema, table });
}
export async function executeTableStatement(statement: MysqlStatement) {
  return ipcRenderer.invoke('execute-sql', statement.sql, statement.binds);
}
